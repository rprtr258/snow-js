// Shared, lazy-loaded export UI. No capture/readback work during normal playback.
import { ANIMATION_FORMATS, animationFormat } from "./animation-formats";
import { exportCacheId, clearExportFrames } from "./export-frame-cache";
import type { AnimationRequest } from "./gif-create";
import type { ExportSession } from "./export-session";
const PREFS_KEY = "noita-gif-preferences-v1";
type AnimationMeta = {format: string; scale: number; width: number; height: number; fps: number; seconds: number; loop: boolean; fitted: boolean};
type Variant = {url: string; blob: Blob; filename: string; bytes: number; meta: AnimationMeta; keptOriginal: boolean};
type ExportOptions = {seconds: number; crop: boolean; loop: boolean; limitSize: boolean; scale: number; format: string; optimize?: boolean};
type GifWorkerMessage = {
  type: string;
  completed?: number;
  total?: number;
  stage?: string;
  attempt?: number;
  message?: string;
  bytes?: ArrayBuffer | Uint8Array;
  [key: string]: unknown;
};
export function setupGifExport(button: HTMLButtonElement, { snapshot, active = () => {} }: { snapshot: () => AnimationRequest | null; active?: (active: boolean) => void }) {
  let panel: HTMLElement | null = null, job: Worker | null = null, inlineSession: ExportSession | null = null, cacheOwner: string | null = null, serial = 0, previousFocus: HTMLElement | null = null;
  const variants = new Map<string, Variant>();
  const discardJob = () => {
    job?.terminate(); job = null;
    void inlineSession?.dispose(); inlineSession = null;
    void clearExportFrames(cacheOwner ?? ""); cacheOwner = null;
  };
  const stop = () => { serial++; discardJob(); };
  const revoke = () => { for (const item of variants.values()) URL.revokeObjectURL(item.url); variants.clear(); };
  const close = () => {
    stop(); revoke(); panel?.remove(); panel = null;
    active(false); previousFocus?.focus();
  };
  button.addEventListener("click", () => {
    if (panel) return;
    let config: AnimationRequest | null;
    try { config = snapshot(); } catch (error) { button.title = (error as Error).message; return; }
    if (!config) return;
    const preferences = { scale: 2, limitSize: false, optimize: false, format: "gif" };
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
      if ([1, 2, 3, 4].includes(saved?.scale)) preferences.scale = saved.scale;
      if (saved && Object.prototype.hasOwnProperty.call(ANIMATION_FORMATS, saved.format)) preferences.format = saved.format;
      preferences.limitSize = saved?.limitSize === true;
      preferences.optimize = saved?.optimize === true;
    } catch { /* Export also works without browser storage. */ }
    previousFocus = document.activeElement as HTMLElement | null; active(true);
    panel = document.createElement("div"); panel.className = "gif-overlay";
    panel.innerHTML = `<div class="modal-dialog"><section class="gif-dialog modal-content" role="dialog" aria-modal="true" aria-labelledby="gif-title">
      <div class="gif-heading"><h2 id="gif-title">Export animation</h2><button class="btn btn-sm btn-outline-light" type="button" data-close aria-label="Close animation export">Close</button></div>
      <p data-subject></p>
      <p>Export at the simulation's playback speed. Choose a larger download to keep more detail.</p>
      <form>
        <label class="gif-format-control" for="animation-format">Format <select class="form-select form-select-sm" id="animation-format" name="format">${Object.entries(ANIMATION_FORMATS).map(([key, info]) => `<option value="${key}">${info.label}</option>`).join("")}</select></label>
        <p data-format-note class="gif-size-note"></p>
        <label class="gif-length"><span data-length-label>Minimum length</span> <input class="form-control form-control-sm" name="seconds" type="number" min="1" max="30" step="0.5" required /> seconds</label>
        <label><input class="form-check-input" name="crop" type="checkbox" checked /> Crop around the animation with a small margin</label>
        <label><input class="form-check-input" name="loop" type="checkbox" checked /> Continuous loop</label>
        <p data-loop-note>Matching the shape's natural motion can extend the loop, up to 60 seconds.</p>
        <label><input class="form-check-input" name="limitSize" type="checkbox" /> Fit below 10 MB (may reduce dimensions)</label>
        <label data-compression hidden><input class="form-check-input" name="optimize" type="checkbox" /> Smaller WebP file (slower, lossless)</label>
        <div class="gif-export-controls">
          <div class="gif-scale-control">
            <label for="gif-scale">Scale <output id="gif-scale-value" for="gif-scale">2×</output></label>
            <input class="form-range" id="gif-scale" name="scale" type="range" min="1" max="4" step="1" value="2" aria-describedby="gif-size-note" />
          </div>
          <button class="btn btn-sm btn-outline-light" type="submit">Generate preview</button>
          <button class="btn btn-sm btn-outline-light" type="button" data-download>Download animation</button>
        </div>
        <button class="btn btn-sm btn-outline-light" type="button" data-cancel hidden>Cancel export</button>
        <p id="gif-size-note" class="gif-size-note">Scale applies to both preview and download. 1× is native size. Files can exceed 10 MB when the limit is off.</p>
        <p class="gif-size-note">Keep this dialog open to reuse the captured animation when changing format or scale.</p>
      </form>
      <progress max="1" value="0" hidden aria-label="Animation export progress"></progress>
      <p data-status role="status" aria-live="polite">Looped exports start with full trails. Controls and labels are excluded.</p>
      <img data-preview hidden alt="Exported animation preview" />
    </section></div>`;
    (document.fullscreenElement ?? document.body).append(panel);
    const find = <T extends HTMLElement = HTMLElement>(selector: string) => panel!.querySelector(selector) as T;
    const form = find<HTMLFormElement>("form");
    const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;
    const seconds = input("seconds");
    const status = find("[data-status]"), meter = find<HTMLProgressElement>("progress"), submit = find<HTMLButtonElement>('[type="submit"]'), cancel = find<HTMLButtonElement>("[data-cancel]");
    const download = find<HTMLButtonElement>("[data-download]"), preview = find<HTMLImageElement>("[data-preview]"), scaleInput = input("scale");
    preview.addEventListener("error", () => {
      if (!preview.hasAttribute("src")) return;
      preview.hidden = true;
      status.textContent = "Export complete. This browser cannot display the preview; Download animation is available.";
    });
    find("[data-subject]").textContent = config.label ?? "Current animation";
    seconds.value = String(Math.max(1, Math.min(30, config.seconds ?? 6)));
    input("limitSize").checked = preferences.limitSize;
    input("optimize").checked = preferences.optimize;
    select("format").value = preferences.format;
    const updateFormat = () => {
      const format = select("format").value;
      find("[data-compression]").hidden = format !== "webp";
      find("[data-format-note]").textContent = animationFormat(format).note + (format === "webp"
        ? input("limitSize").checked || input("optimize").checked
          ? " Tries stronger compression without changing pixels or timing. Captured frames are reused."
          : " Faster compression preserves every pixel; files can be larger."
        : "");
    };
    scaleInput.value = String(preferences.scale);
    const updateScale = () => {
      find("#gif-scale-value").textContent = `${scaleInput.value}×`;
      scaleInput.setAttribute("aria-valuetext", `${scaleInput.value}× native size`);
    };
    const savePreferences = () => {
      preferences.scale = Number(scaleInput.value);
      preferences.limitSize = input("limitSize").checked;
      preferences.optimize = input("optimize").checked;
      preferences.format = select("format").value;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(preferences)); } catch { /* Optional. */ }
    };
    updateScale(); updateFormat();
    const working = (value: boolean) => {
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) control.disabled = value;
      submit.disabled = download.disabled = value; cancel.hidden = !value; meter.hidden = !value;
    };
    const show = (item: Variant, autoDownload = false) => {
      preview.src = item.url; preview.hidden = false;
      const data = item.meta;
      status.textContent = `${animationFormat(data.format).label} · ${data.scale}× · ${data.width} × ${data.height} · ${data.fps} FPS · ${data.seconds} s · ${(item.bytes / 1e6).toFixed(2)} MB${data.loop ? " · looping" : ""}${data.fitted ? " · fitted below 10 MB" : ""}${item.keptOriginal ? " · no further size reduction" : ""}`;
      if (autoDownload) {
        const link = document.createElement("a");
        link.href = item.url; link.download = item.filename; link.hidden = true;
        panel!.append(link); link.click(); link.remove();
      }
      (autoDownload ? download : submit).focus();
    };
    const clearPreview = () => { preview.hidden = true; preview.removeAttribute("src"); };
    scaleInput.addEventListener("input", () => {
      updateScale(); savePreferences(); clearPreview();
      status.textContent = `${scaleInput.value}× selected for preview and download.`;
    });
    form.addEventListener("change", event => {
      if (event.target === scaleInput) return;
      if (event.target === seconds || event.target === input("loop")) revoke();
      clearPreview();
      find("[data-length-label]").textContent = input("loop").checked ? "Minimum length" : "Length";
      find("[data-loop-note]").hidden = !input("loop").checked;
      updateFormat(); savePreferences(); status.textContent = "Settings updated. Generate a preview or download the animation.";
    });
    find("[data-close]").addEventListener("click", close);
    panel.addEventListener("pointerdown", event => { if (event.target === panel) close(); });
    panel.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const targets = [...panel!.querySelectorAll<HTMLElement>("button, input, select, a[href]")].filter(el => !("disabled" in el && el.disabled) && !el.closest("[hidden]"));
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    cancel.addEventListener("click", () => { stop(); working(false); status.textContent = "Export cancelled."; submit.focus(); });
    const runExport = async (autoDownload = false) => {
      if (submit.disabled || !form.reportValidity()) return;
      const scale = Number(scaleInput.value);
      const options: ExportOptions = { seconds: Number(seconds.value), crop: input("crop").checked, loop: input("loop").checked, limitSize: input("limitSize").checked, scale, format: select("format").value };
      options.optimize = options.format === "webp" && input("optimize").checked;
      const key = JSON.stringify(options), cached = variants.get(key);
      if (cached) { variants.delete(key); variants.set(key, cached); show(cached, autoDownload); return; }
      const run = ++serial;
      cacheOwner ??= exportCacheId();
      const request = { ...config, ...options, cacheOwner };
      working(true); meter.value = 0; status.textContent = `Preparing ${scale}× animation…`;
      const error = (message: string) => {
        if (run !== serial || !panel) return;
        working(false); status.textContent = `Could not export animation: ${message}`;
      };
      const receive = (data: GifWorkerMessage) => {
        if (run !== serial || !panel) return;
        if (data.type === "progress") {
          meter.value = (data.completed ?? 0) / (data.total ?? 1);
          status.textContent = `${data.stage} · ${Math.round(meter.value * 100)}%${(data.attempt ?? 0) > 1 ? ` · attempt ${data.attempt}` : ""}`;
        } else if (data.type === "error") error(data.message ?? "Export failed");
        else if (data.type === "done") {
          const { bytes, ...meta } = data, info = animationFormat(request.format);
          let blob = new Blob([bytes as BlobPart], { type: info.mime }), keptOriginal = false;
          // Compression heuristics are not monotonic for every image. If the
          // existing fast export is smaller, keep those same rendered pixels.
          const original = options.optimize && variants.get(JSON.stringify({ ...options, optimize: false }));
          if (original && original.bytes <= blob.size && original.meta.width === (meta as unknown as AnimationMeta).width && original.meta.height === (meta as unknown as AnimationMeta).height) {
            blob = original.blob; keptOriginal = true;
          }
          if (request.limitSize && blob.size >= 10_000_000) { error("The file exceeds the selected size limit."); return; }
          const stem = (config.filename ?? "particles").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
          const item: Variant = { url: URL.createObjectURL(blob), blob, filename: `${stem}-${scale}x.${info.extension}`, bytes: blob.size, meta: meta as unknown as AnimationMeta, keptOriginal };
          variants.set(key, item);
          // Retain a few useful downloads without accumulating large files as
          // the format and scale controls are explored.
          while (variants.size > 1 && (variants.size > 4 || [...variants.values()].reduce((sum, v) => sum + v.bytes, 0) > 128 * 1024 * 1024)) {
            const oldest = variants.keys().next().value!;
            URL.revokeObjectURL(variants.get(oldest)!.url); variants.delete(oldest);
          }
          working(false); show(item, autoDownload);
        }
      };
      let fallbackStarted = false;
      const fallback = async () => {
        if (fallbackStarted || run !== serial || !panel) return;
        fallbackStarted = true;
        try {
          if (!inlineSession) {
            discardJob(); cacheOwner = exportCacheId();
            const { ExportSession } = await import("./export-session");
            if (run !== serial) return;
            inlineSession = new ExportSession(cacheOwner);
          }
          const { createAnimation } = await import("./gif-create"); if (run !== serial) return;
          const result = await createAnimation(request, progress => receive({ type: "progress", ...progress }), () => run !== serial, inlineSession);
          receive({ type: "done", ...result });
        } catch (failure) { error((failure as Error).message); }
      };
      if (inlineSession) { await fallback(); return; }
      try {
        job ??= new Worker(new URL("./gif-worker.js", import.meta.url), { type: "module" });
        job.onmessage = ({ data }) => data.type === "fallback" ? void fallback() : receive(data);
        job.onerror = event => { event.preventDefault(); void fallback(); };
        job.onmessageerror = () => error("The exported frame could not be decoded. Please retry.");
        job.postMessage(request);
      } catch { await fallback(); }
    };
    form.addEventListener("submit", event => { event.preventDefault(); void runExport(); });
    download.addEventListener("click", () => { void runExport(true); });
    seconds.focus();
  });
  window.addEventListener("pagehide", close);
}
