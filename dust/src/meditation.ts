// Fullscreen page (`meditation.html`): the meditation cube portal alone, on a
// canvas that fills the viewport - no controls, no status, nothing else.
// Frames stay on the shared worker so sizing, resizing and fullscreen never
// wait for the software rasterizer.
import { fullscreenView } from "./render-resolution";
import { loadRasterModule } from "./wasm-raster";
import { Catalog, RawOptions, SimulationOptions } from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("canvas");
const context = canvas.getContext("2d", { alpha: false });
if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
const options: RawOptions = { core: true, glow: true, color: null, background: null };
const replay: SimulationOptions = { worldSeed: 0, x: 0, y: 0, startFrame: 0, effect: "meditation" };

type Layout = {width: number; height: number; scale: number};
type WorkerMessage = {
  type?: string;
  message?: string;
  pixels?: ArrayBuffer;
  revision?: number;
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
  // resolution to render at: the buffer is the screen's own device resolution
  // and the world→pixel scale is an exact float (fullscreenView), so one render
  // cell is one screen pixel and the portal spans half the lower dimension.
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
  if (data.revision !== revision) return;
  ready = true;
  busy = false;
}
function loop(now: number) {
  if (ready && !busy && !document.hidden) {
    const elapsed = lastTime === null ? 0 : now - lastTime;
    lastTime = now;
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
  init();
  requestAnimationFrame(loop);
}
start().catch((error) => fail((error as Error).message));
