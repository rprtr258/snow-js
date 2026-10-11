// Fullscreen page (`meditation.html`): the meditation cube portal alone, on a
// canvas that fills the viewport - no controls, no status, nothing else.
// Frames stay on the shared worker so sizing, resizing and fullscreen never
// wait for the software rasterizer. Pressing D toggles a hidden debug overlay.
import { fullscreenView } from "./render-resolution";
import { loadRasterModule } from "./wasm-raster";
import { Catalog, RawOptions, SimulationOptions } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("canvas");
const debug = $<HTMLPreElement>("debug");
const context = canvas.getContext("2d", { alpha: false });
if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
const options: RawOptions = { core: true, glow: false, color: null, background: null, portalSprite: false };
// portalSprite: false drops the catalog teleport_center.png ring graphic drawn
// additively at the portal center; only particle rendering remains.
// minTrailLifetime: every particle lives at least 500ms (the native trail
// lifeMin is 0.35s, which lets dots blink out sooner).
// ambientRing: false drops the radial ring sparks around the cube; only the
// cube trail and the center motes render. Skipping the batch also shifts the
// shared RNG stream, so trail spark placement differs from the native replay.
// fastParticles opts this page into the float64 particle integration
// (stepParticleFast): the RNG stream, emission counts and lifetimes are
// identical to the fround reference, but positions may drift within the
// visual bounds enforced by `bun scripts/render-diff.ts` (the exact-path
// reference renderer and every other consumer stay byte-exact). Chosen
// deliberately for this page: speed over bit-exactness.
const replay: SimulationOptions = { worldSeed: 0, x: 0, y: 0, startFrame: 0, effect: "meditation", mathTrailScale: 3, minTrailLifetime: 3.5, ambientRing: false, fastParticles: true };

type Layout = {width: number; height: number; scale: number};
type WorkerMessage = {
  type?: string;
  message?: string;
  pixels?: ArrayBuffer;
  revision?: number;
  stats?: { particles: number };
};
let view: Layout | null = null;
let catalog: Catalog | null = null;
let bytes: ArrayBuffer | null = null;
let kernelModule: WebAssembly.Module | null = null;
let revision = 0;
let recycled: ArrayBufferLike | null = null;
let lastTime: number | null = null;
let ready = false;
let busy = true;
let fps = 0;
let particles = 0;

const worker = new Worker(new URL("./render-worker.js", import.meta.url), {
  type: "module",
});
worker.onmessage = ({ data }) => receive(data);
worker.onerror = (event) => {
  event.preventDefault();
  ready = false;
  fail(event.message);
};

// The renderer is built for one buffer size, so a resize rebuilds it - and with
// it the effect, back at its first frame. Debounced: a window drag fires
// continuously.
function layout() {
  // The canvas is the display (CSS 100% × 100%), so its own client box is the
  // resolution to render at: the buffer is the screen's device resolution and
  // the world→pixel scale sizes the portal to half the lower device dimension
  // (fullscreenView in src/render-resolution.ts); positions and textures
  // scale with it while dynamic primitives stay pixel-fine.
  view = fullscreenView(canvas.clientWidth, canvas.clientHeight, devicePixelRatio);
  canvas.width = view!.width;
  canvas.height = view!.height;
  // Pin the display to the buffer rather than let the browser resample a
  // sub-pixel remainder.
  const ratio = devicePixelRatio || 1;
  canvas.style.width = `${view!.width / ratio}px`;
  canvas.style.height = `${view!.height / ratio}px`;
}
function init() {
  revision++;
  lastTime = null;
  busy = true;
  layout();
  // Emission density tracks the world→pixel scale, so particle counts and
  // trail sampling keep the on-screen density of one cell = one pixel
  // (a world cell is several device px here; unscaled emission would read
  // as sparse dots and dashed lines).
  replay.density = view!.scale*2;
  // The worker owns the buffer it is handed, so send a copy of the asset.
  const buffer = bytes!.slice(0);
  worker.postMessage(
    {
      type: "init",
      catalog,
      buffer,
      kernelModule,
      width: view!.width,
      height: view!.height,
      scale: view!.scale,
      revision,
      replay,
      options,
    },
    [buffer],
  );
}
function receive(data: WorkerMessage) {
  if (data.type === "error") {
    ready = false;
    busy = false;
    fail(data.message ?? "Render worker failed");
    return;
  }
  if (data.pixels) {
    if (data.revision === revision)
      context!.putImageData(
        new ImageData(
          new Uint8ClampedArray(data.pixels),
          canvas.width,
          canvas.height,
        ),
        0,
        0,
      );
    recycled = data.pixels;
  }
  if (data.stats) particles = data.stats.particles;
  if (data.revision !== revision) return;
  ready = true;
  busy = false;
}
function renderDebug() {
  if (!view) {
    debug.textContent = "starting…";
    return;
  }
  debug.textContent = [
    `buffer ${view.width}×${view.height} @ scale ${view.scale.toFixed(1)} (dpr ${devicePixelRatio})`,
    `fps ${fps.toFixed(1)} · particles ${particles} · revision ${revision} · ${
      busy ? "busy" : ready ? "ready" : "down"
    }`,
    `effect ${replay.effect} · seed ${replay.worldSeed} · density ${(replay.density ?? 0).toFixed(1)}`,
  ].join("\n");
}
function loop(now: number) {
  if (!debug.hidden) renderDebug();
  if (ready && !busy && !document.hidden) {
    const elapsed = lastTime === null ? 0 : now - lastTime;
    lastTime = now;
    if (elapsed > 0) fps = 1000 / elapsed;
    busy = true;
    const recycle = recycled;
    recycled = null;
    worker.postMessage(
      {
        type: "frame",
        revision,
        elapsed,
        speed: 1,
        options,
        recycle,
      },
      recycle ? [recycle as ArrayBuffer] : [],
    );
  }
  requestAnimationFrame(loop);
}
function fail(message: string) {
  console.error(`Meditation page: ${message}`);
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
async function start() {
  const [meta, asset, kernel] = await Promise.all([
    fetch(new URL("./assets/effects.json", import.meta.url)),
    fetch(new URL("./assets/effects.bin", import.meta.url)),
    loadRasterModule(),
  ]);
  if (!meta.ok || !asset.ok)
    throw new Error(
      "Effect assets could not be loaded. Run bun run build from the project directory.",
    );
  catalog = await meta.json();
  bytes = await asset.arrayBuffer();
  kernelModule = kernel;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(init, 200);
  });
  document.addEventListener("visibilitychange", () => {
    lastTime = null;
  });
  addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "d" || event.ctrlKey || event.metaKey || event.altKey)
      return;
    debug.hidden = !debug.hidden;
    if (!debug.hidden) renderDebug();
  });
  init();
  requestAnimationFrame(loop);
}
start().catch((error) => fail((error as Error).message));
