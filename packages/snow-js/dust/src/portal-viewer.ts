import { setupFullscreen } from "./fullscreen";
import { setupGifExport } from "./gif-export";
import { createSwatch } from "./color-swatch";
import { EFFECTS } from "./portal-physics";
import { MATH_EFFECTS, MATH_GROUPS } from "./math-figures";
import { MATH_TRAIL_SCALE } from "./math-settings";
import { hexOut, hexParam, numberParam, readParams, setupCopyLink, syncUrl } from "./share-url";
import { loadRasterModule } from "./wasm-raster";
import { PREVIEW_WIDTH, PREVIEW_HEIGHT, PREVIEW_RENDER_WIDTH, PREVIEW_RENDER_HEIGHT, RESOLUTION_SCALE } from "./render-resolution";
import { Catalog, RawOptions, SimulationOptions } from "./types";
import type { ViewerRuntime } from "./viewer-runtime";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const buttonEl = (id: string) => $<HTMLButtonElement>(id);
const canvasEl = (id: string) => $<HTMLCanvasElement>(id);

type StatsPayload = {
  elapsedFrames: number;
  frame: number;
  visible: number;
  particles: number;
  simulationMS: number;
  rasterMS: number;
  accelerated: boolean;
  slow: boolean;
  dropped: number;
};
type PreviewMessage = {
  type: string;
  revision?: number;
  request?: string;
  stale?: boolean;
  message?: string;
  pixels?: ArrayBufferLike;
  stats?: StatsPayload;
};
type WorkerRequest = {
  type: string;
  revision?: number;
  replay?: SimulationOptions;
  options?: RawOptions;
  recycle?: ArrayBufferLike | null;
  elapsed?: number;
  speed?: number;
  paused?: boolean;
  redraw?: boolean;
  buffer?: ArrayBuffer;
  mathTrailScale?: number;
  catalog?: Catalog;
  kernelModule?: WebAssembly.Module | null;
  width?: number;
  height?: number;
  scale?: number;
};
type EffectEntry = {label: string};
let gifExportActive = false;
setupGifExport(buttonEl("create-gif"), {
  snapshot: () => ready ? { kind: "viewer", catalog: catalog!, replay: replayState(), options: options(),
    speed: Number(select("speed").value), label: select("effect").selectedOptions[0].textContent ?? "", filename: select("effect").value } : null,
  active: value => { gifExportActive = value; lastTime = null; },
});
let catalog: Catalog | null = null,
  worker: Worker | null = null,
  inline: ViewerRuntime | null = null,
  ctx: CanvasRenderingContext2D | null = null,
  busy = false,
  ready = false,
  running = true,
  revision = 0,
  lastTime: number | null = null,
  lastStatsTime = 0;
let pendingFrames = 0,
  mathSettingsDirty = false;
let mathTrailScale: number = MATH_TRAIL_SCALE.default;
let recycled: ArrayBufferLike | null = null,
  stats: StatsPayload | null = null,
  backend = "Worker";
let replay = { worldSeed: 0, x: 0, y: 0, startFrame: 0 };
const selected: Record<string, string> = { game: "meditation", math: "math_penrose" };
// Presentation-only recolors, kept across effect switches; null = original.
let color: string | null = null,
  background: string | null = null;
const options = (): RawOptions => ({
  core: input("core").checked,
  glow: input("glow").checked,
  color,
  background,
});
function mathSettings(): {mathTrailScale?: number} {
  return select("collection").value === "math" ? { mathTrailScale } : {};
}
function replayState(): SimulationOptions {
  return { ...replay, effect: select("effect").value, ...mathSettings() };
}
function updateMathControls() {
  const slider = input("math-trail");
  slider.min = String(MATH_TRAIL_SCALE.min);
  slider.max = String(MATH_TRAIL_SCALE.max);
  slider.step = String(MATH_TRAIL_SCALE.step);
  slider.value = String(mathTrailScale);
  const label = `${mathTrailScale.toFixed(1)}×`;
  $("math-trail-value").textContent = label;
  slider.setAttribute("aria-valuetext", `${label} meditation trail lifetime`);
}
function changeMathTrails(value: number) {
  mathTrailScale = Math.min(
    MATH_TRAIL_SCALE.max,
    Math.max(MATH_TRAIL_SCALE.min, value),
  );
  updateMathControls();
  mathSettingsDirty = true;
}
function applyColor(kind: string, hex: string | null) {
  if (kind === "background") background = hex;
  else color = hex;
  // A running effect picks the new options up on its next frame request.
  if (!running) redraw();
}
function showError(message: string) {
  $("error").hidden = false;
  $("error").textContent = message;
}
function centerCanvas() {
  const viewport = canvasEl("canvas").parentElement!;
  // Scroll only the preview, never the page. Auto margins center smaller canvases;
  // larger ones need both scroll offsets reset around the figure's center.
  viewport.scrollLeft = Math.max(0, Math.round((viewport.scrollWidth - viewport.clientWidth) / 2));
  viewport.scrollTop = Math.max(0, Math.round((viewport.scrollHeight - viewport.clientHeight) / 2));
}
// Integer scales only: fractional nearest-neighbor scaling makes pixels uneven.
function applyZoom() {
  const scale = Math.min(10, Math.max(1, Math.round(Number(input("zoom").value)) || 1));
  canvasEl("canvas").style.width = `${PREVIEW_RENDER_WIDTH * scale}px`;
  canvasEl("canvas").style.height = `${PREVIEW_RENDER_HEIGHT * scale}px`;
  $("zoom-value").textContent = `${scale}×`;
  input("zoom").setAttribute("aria-valuetext", `${scale}× pixel scale`);
  centerCanvas();
}
function describe() {
  const key = select("effect").value,
    math = (MATH_EFFECTS as Record<string, {label: string; group: string; description: string}>)[key],
    definition = (EFFECTS as Record<string, {label: string; source: string}>)[key] ?? catalog!.effects[key];
  $("source").textContent = math
    ? math.description
    : `${definition.source} · seed ${replay.worldSeed} · (${replay.x}, ${replay.y})`;
  $("origin-note").textContent = math
    ? "Original animated geometry with eight meditation-style emitters. Trail lifetime is adjustable for math only."
    : (catalog!.effects[key]?.notes ??
      "Original portal animation and native cosmetic-particle rules.");
  $("math-controls").hidden = !math;
  updateMathControls();
  $("eye-note").hidden = key !== "eye_room";
  document.body.classList.toggle("math-mode", !!math);
}
function populate() {
  const collection = select("collection").value,
    effect = select("effect");
  effect.replaceChildren();
  const groups: [string, [string, EffectEntry][]][] =
    collection === "math"
      ? Object.entries(MATH_GROUPS).map(([key, label]) => [
          label,
          Object.entries(MATH_EFFECTS).filter(([, e]) => e.group === key),
        ])
      : [
          ["Portals", Object.entries(EFFECTS)],
          [
            "Objects & ambient effects",
            Object.entries(catalog!.effects).filter(
              ([, e]) => e.group === "objects",
            ),
          ],
          [
            "Image-driven effects",
            Object.entries(catalog!.effects).filter(
              ([, e]) => e.group === "images",
            ),
          ],
        ];
  for (const [label, entries] of groups) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const [key, definition] of entries)
      group.appendChild(new Option(definition.label, key));
    effect.appendChild(group);
  }
  effect.value = selected[collection];
  describe();
}
function setEnabled(value: boolean) {
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button:not([data-ui-shell]),select,input"))
    control.disabled = !value;
}
function updateStats(force = false) {
  if (!stats || !input("debug").checked) return;
  const now = performance.now();
  if (!force && now - lastStatsTime < 250) return;
  lastStatsTime = now;
  const frame = stats.elapsedFrames
    ? `Frame ${stats.frame - 1}`
    : `Ready · next frame ${stats.frame}`;
  const renderer = `CPU${stats.accelerated ? " + WASM" : ""}`;
  $("stats").textContent =
    `${frame} · ${stats.visible.toLocaleString()} visible / ${stats.particles.toLocaleString()} live · ${backend} · ${renderer} · ${stats.simulationMS.toFixed(1)} ms CPU physics / ${stats.rasterMS.toFixed(1)} ms render/submit${!running ? " · stopped after error" : stats.slow ? " · Running below requested speed" : ""}${stats.dropped ? ` · ${stats.dropped} capacity drops` : ""}`;
}
function receive(data: PreviewMessage) {
  if (data.type === "frame") {
    pendingFrames = Math.max(0, pendingFrames - 1);
    busy = pendingFrames > 0;
  }
  if (data.type === "error") {
    if (data.request === "frame")
      pendingFrames = Math.max(0, pendingFrames - 1);
    busy = pendingFrames > 0;
    showError(data.message ?? "Render failed");
    running = false;
    return;
  }
  if (data.stale) return;
  if (data.pixels) {
    if (data.revision === revision) {
      ctx!.putImageData(
        new ImageData(new Uint8ClampedArray(data.pixels as ArrayBuffer), PREVIEW_RENDER_WIDTH, PREVIEW_RENDER_HEIGHT),
        0,
        0,
      );
    }
    recycled = data.pixels;
  }
  if (data.revision !== revision) return;
  stats = data.stats ?? null;
  if (data.type === "init") {
    ready = true;
    setEnabled(true);
    $("status").textContent = "Ready · CPU fallback available";
  }
  updateStats(data.type !== "frame");
}
function send(message: WorkerRequest) {
  if (message.type === "frame") {
    Object.assign(message, mathSettings());
    mathSettingsDirty = false;
    pendingFrames++;
    busy = true;
  }
  if (worker) {
    const transfer: ArrayBufferLike[] = [];
    if (message.buffer) transfer.push(message.buffer);
    if (message.recycle) transfer.push(message.recycle);
    worker.postMessage(message, transfer as Transferable[]);
    return;
  }
  // Only used when module workers are unavailable or disallowed. Same simulation/raster code.
  try {
    let result: ReturnType<ViewerRuntime["frame"]>;
    if (message.type === "restart") {
      inline!.restart(message.replay, message.revision);
      result = inline!.frame({
        paused: true,
        redraw: true,
        options: message.options,
        recycle: message.recycle,
      });
    } else result = inline!.frame(message);
    receive({ ...result, type: message.type, pixels: result.pixels?.buffer });
  } catch (error) {
    receive({ type: "error", request: message.type, message: (error as Error).message });
  }
}
function takeBuffer(): ArrayBufferLike | null {
  const b = recycled;
  recycled = null;
  return b;
}
function restart() {
  if (!ready) return;
  revision++;
  lastTime = null;
  running = true;
  $("error").hidden = true;
  describe();
  syncShareUrl();
  send({
    type: "restart",
    revision,
    replay: replayState(),
    options: options(),
    recycle: takeBuffer(),
  });
}
function redraw() {
  if (!ready) return;
  send({
    type: "frame",
    revision,
    paused: true,
    redraw: true,
    options: options(),
    recycle: takeBuffer(),
  });
}
function loop(now: number) {
  if (!gifExportActive && ready && !busy && !document.hidden && !running && mathSettingsDirty)
    redraw();
  if (!gifExportActive && ready && !busy && running && !document.hidden) {
    const elapsed = lastTime === null ? 0 : now - lastTime;
    lastTime = now;
    busy = true;
    send({
      type: "frame",
      revision,
      elapsed,
      speed: Number(select("speed").value),
      options: options(),
      recycle: takeBuffer(),
    });
  }
  requestAnimationFrame(loop);
}
function syncShareUrl() {
  syncUrl([
    ["e", select("effect").value === "meditation" ? null : select("effect").value],
    ["c", hexOut(color)],
    ["b", hexOut(background)],
    ["z", select("zoom").value === "1" ? null : select("zoom").value],
    ["t", mathTrailScale === MATH_TRAIL_SCALE.default ? null : String(mathTrailScale)],
    ["g", input("glow").checked ? null : "0"],
    ["s", input("core").checked ? null : "0"],
    ["v", select("speed").value === "1" ? null : select("speed").value],
    ["sd", replay.worldSeed ? String(replay.worldSeed) : null],
    ["x", replay.x ? String(replay.x) : null],
    ["y", replay.y ? String(replay.y) : null],
  ]);
}
function applyUrl() {
  const p = readParams(), key = (p.get("e") ?? "") as string;
  if (Object.prototype.hasOwnProperty.call(MATH_EFFECTS, key)) {
    selected.math = key;
    select("collection").value = "math";
  } else if (Object.prototype.hasOwnProperty.call(EFFECTS, key) || Object.prototype.hasOwnProperty.call(catalog!.effects, key)) {
    selected.game = key;
    select("collection").value = "game";
  }
  color = hexParam(p.get("c"));
  background = hexParam(p.get("b"));
  input("glow").checked = p.get("g") !== "0";
  input("core").checked = p.get("s") !== "0";
  input("zoom").value = String(numberParam(p, "z", 1, 1, 10, true));
  mathTrailScale = Math.round(numberParam(
    p, "t", MATH_TRAIL_SCALE.default, MATH_TRAIL_SCALE.min, MATH_TRAIL_SCALE.max,
  ) * 10) / 10;
  const speed = p.get("v");
  select("speed").value = [...select("speed").options].some((option) => option.value === speed) ? (speed ?? "1") : "1";
  replay = {
    worldSeed: numberParam(p, "sd", 0, 0, 0xffffffff, true),
    x: numberParam(p, "x", 0, -1e7, 1e7),
    y: numberParam(p, "y", 0, -1e7, 1e7),
    startFrame: 0,
  };
  input("seed").value = String(replay.worldSeed);
  input("world-x").value = String(replay.x);
  input("world-y").value = String(replay.y);
}
async function start() {
  setupFullscreen(buttonEl("fullscreen"), $("fullscreen-target"), showError);
  setupCopyLink(buttonEl("copy-link"), syncShareUrl, showError);
  input("debug").checked = false;
  document.body.classList.remove("debug");
  input("debug").addEventListener("change", () =>
    document.body.classList.toggle("debug", input("debug").checked),
  );
  setEnabled(false);
  const canvas = canvasEl("canvas");
  // The backing store must equal the render buffer, which is derived from the
  // shared resolution constants (never a fixed 480×320/960×640 literal).
  canvas.width = PREVIEW_RENDER_WIDTH;
  canvas.height = PREVIEW_RENDER_HEIGHT;
  ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
  const [meta, asset] = await Promise.all([
    fetch(new URL("./assets/effects.json", import.meta.url)),
    fetch(new URL("./assets/effects.bin", import.meta.url)),
  ]);
  if (!meta.ok || !asset.ok)
    throw new Error(
      "Effect assets could not be loaded. Run npm start from the project directory.",
    );
  catalog = await meta.json();
  const [buffer, kernelModule] = await Promise.all([
    asset.arrayBuffer(),
    loadRasterModule(),
  ]);
  select("collection").value = "game";
  applyUrl();
  populate();
  applyZoom();
  const viewportObserver = new ResizeObserver(centerCanvas);
  viewportObserver.observe(canvas.parentElement!);
  document.addEventListener("fullscreenchange", centerCanvas);
  syncShareUrl();
  const init: WorkerRequest = {
    type: "init",
    catalog: catalog!,
    buffer,
    kernelModule,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    scale: RESOLUTION_SCALE,
    revision,
    replay: replayState(),
    options: options(),
  };
  async function fallback(error: unknown) {
    worker?.terminate();
    worker = null;
    backend = "Main thread";
    busy = false;
    pendingFrames = 0;
    try {
      const { ViewerRuntime } = await import("./viewer-runtime");
      // A failed worker may already have taken ownership of its input buffer.
      const bytes = init.buffer!.byteLength
        ? init.buffer!
        : await (await fetch(new URL("./assets/effects.bin", import.meta.url))).arrayBuffer();
      inline = new ViewerRuntime(catalog!, bytes, PREVIEW_WIDTH, PREVIEW_HEIGHT, kernelModule, { scale: RESOLUTION_SCALE });
      inline.restart(replayState(), revision);
      const result = inline.frame({
        paused: true,
        redraw: true,
        options: options(),
      });
      receive({ ...result, type: "init", pixels: result.pixels?.buffer });
      if (error)
        console.warn(
          "Worker unavailable; using the same software renderer on the main thread.",
          error,
        );
    } catch (failure) {
      showError((failure as Error).message);
    }
  }
  try {
    worker = new Worker(new URL("./render-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => receive(data);
    worker.onerror = (event) => {
      event.preventDefault();
      fallback(event.message);
    };
    send(init);
  } catch (error) {
    await fallback(error);
  }
  select("collection").addEventListener("change", () => {
    populate();
    restart();
  });
  select("effect").addEventListener("change", () => {
    selected[select("collection").value] = select("effect").value;
    restart();
  });
  input("math-trail").addEventListener("input", () => {
    changeMathTrails(Number(input("math-trail").value));
    syncShareUrl();
  });
  buttonEl("math-trail-reset").addEventListener("click", () => {
    changeMathTrails(MATH_TRAIL_SCALE.default);
    syncShareUrl();
  });
  buttonEl("restart").addEventListener("click", restart);
  select("speed").addEventListener("change", () => {
    lastTime = null;
    syncShareUrl();
  });
  for (const id of ["core", "glow"])
    input(id).addEventListener("change", () => { redraw(); syncShareUrl(); });
  createSwatch($("particle-swatch"), {
    onChange: (hex) => { applyColor("color", hex); syncShareUrl(); },
  }).set(color);
  createSwatch($("background-swatch"), {
    onChange: (hex) => { applyColor("background", hex); syncShareUrl(); },
  }).set(background);
  input("zoom").addEventListener("input", () => { applyZoom(); syncShareUrl(); });
  $<HTMLFormElement>("replay").addEventListener("submit", (event) => {
    event.preventDefault();
    const candidate = {
      worldSeed: Number(input("seed").value),
      x: Number(input("world-x").value),
      y: Number(input("world-y").value),
      startFrame: 0,
    };
    if (
      !Number.isInteger(candidate.worldSeed) ||
      candidate.worldSeed < 0 ||
      candidate.worldSeed > 0xffffffff ||
      ![candidate.x, candidate.y].every(
        (x) => Number.isFinite(x) && Math.abs(x) <= 1e7,
      )
    ) {
      showError("Invalid replay state");
      return;
    }
    replay = candidate;
    $("error").hidden = true;
    restart();
  });
  document.addEventListener("visibilitychange", () => {
    lastTime = null;
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      worker?.terminate();
      viewportObserver.disconnect();
    }
  });
  requestAnimationFrame(loop);
}
start().catch((error) => {
  setEnabled(false);
  showError((error as Error).message);
});
