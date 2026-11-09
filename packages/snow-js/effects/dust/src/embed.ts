// Embeddable fullscreen viewer for the snow-js website. Runs the worker
// pipeline, sizes the render buffer to the host element's aspect ratio and
// exposes a Snow-like class API. The ported simulation and raster code are
// untouched; this module only orchestrates.
import { ViewerRuntime } from "./viewer-runtime";
import { EFFECTS } from "./portal-physics";
import { MATH_EFFECTS } from "./math-figures";
import { MATH_TRAIL_SCALE } from "./math-settings";
import { compileRenderKernel } from "./render-kernel";
import { fullscreenView, PREVIEW_HEIGHT, RESOLUTION_SCALE } from "./render-resolution";
import { Catalog, RawOptions, SimulationOptions } from "./types";

// raster.wasm lives under static/assets/; the embed loads it directly.
async function loadEmbedRasterModule(): Promise<WebAssembly.Module | null> {
  try {
    const response = await fetch(
      new URL("../static/assets/raster.wasm", import.meta.url),
    );
    return response.ok
      ? await WebAssembly.compile(await response.arrayBuffer())
      : null;
  } catch {
    return null;
  }
}

export type DustCollection = "game" | "math";
export type DustOptions = {
  collection: DustCollection;
  effect: string;
  speed: number;
  zoom: number;
  // Fullscreen geometry: the render buffer is the host's device pixels and
  // the portal spans half the smaller dimension.
  // Default off keeps the fixed 320px preview buffer.
  fullscreen: boolean;
  // Emission density multiplier; fullscreen mode adds a derived scale×2
  // boost on top (computeDensity).
  density: number;
  core: boolean;
  glow: boolean;
  portalSprite: boolean;
  color: string | null;
  background: string | null;
  mathTrailScale: number;
  minTrailLifetime: number;
  ambientRing: boolean;
  fastParticles: boolean;
  cullInvisible: boolean;
  particleMirror: boolean;
  seed: number;
  x: number;
  y: number;
};
// The effect definition's option schema is the source of defaults; these are
// only the residual fallbacks for keys a caller may omit.
const defaults: DustOptions = {
  collection: "game",
  effect: "meditation",
  speed: 1,
  zoom: 1,
  fullscreen: false,
  density: 1,
  core: true,
  glow: true,
  portalSprite: true,
  color: null,
  background: null,
  mathTrailScale: MATH_TRAIL_SCALE.default,
  minTrailLifetime: 0.35,
  ambientRing: true,
  fastParticles: false,
  cullInvisible: false,
  particleMirror: false,
  seed: 0,
  x: 0,
  y: 0,
};

// Catalog metadata (effects.json), shared by every consumer; the effect data
// (effects.bin) is fetched per viewer because it is transferred to its worker.
let catalogPromise: Promise<Catalog> | null = null;
function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= (async () => {
    const response = await fetch(
      new URL("../static/assets/effects.json", import.meta.url),
    );
    if (!response.ok)
      throw new Error("dust: effect assets could not be loaded");
    return await response.json() as Catalog;
  })();
  return catalogPromise;
}
async function fetchBin(): Promise<ArrayBuffer> {
  const response = await fetch(
    new URL("../static/assets/effects.bin", import.meta.url),
  );
  if (!response.ok)
    throw new Error("dust: effect assets could not be loaded");
  return await response.arrayBuffer();
}

type WorkerRequest = {
  type: "init" | "restart" | "frame" | "view";
  width?: number;
  height?: number;
  centerX?: number;
  centerY?: number;
  scale?: number;
  revision?: number;
  replay?: SimulationOptions;
  options?: RawOptions;
  recycle?: ArrayBufferLike | null;
  elapsed?: number;
  speed?: number;
  paused?: boolean;
  redraw?: boolean;
  mathTrailScale?: number;
  catalog?: Catalog;
  buffer?: ArrayBuffer;
  kernelModule?: WebAssembly.Module | null;
  renderKernelModule?: WebAssembly.Module | null;
};
type PreviewMessage = {
  type: string;
  revision?: number;
  stale?: boolean;
  message?: string;
  pixels?: ArrayBufferLike;
};

const clamped = (value: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, value));
const clampSeed = (value: number) => Math.floor(clamped(value, 0, 0xffffffff));
const clampWorld = (value: number) =>
  Number.isFinite(value) ? clamped(value, -1e7, 1e7) : 0;
const clampZoom = (value: number) => clamped(Math.round(value) || 1, 1, 10);

// Render buffer geometry: the preview height is fixed and the width follows
// the host element's aspect ratio, so a fullscreen background stays
// undistorted while the world→pixel scale (zoom) sizes the figure.
function bufferSize(width: number, height: number) {
  const logicalWidth = Math.max(1, Math.round(PREVIEW_HEIGHT * width / Math.max(1, height)));
  return {
    width: Math.round(logicalWidth * RESOLUTION_SCALE),
    height: Math.round(PREVIEW_HEIGHT * RESOLUTION_SCALE),
  };
}

// Render view for the two geometry modes. Preview (default): the fixed
// 320px-tall buffer at one world cell = one pixel. Fullscreen: the buffer is
// the host's device pixels and the portal spans half the smaller device
// dimension; zoom still applies
// on top.
export function computeView(
  width: number,
  height: number,
  pixelRatio: number,
  fullscreen: boolean,
  zoom: number,
): {width: number; height: number; scale: number} {
  if (!fullscreen)
    return {...bufferSize(width, height), scale: RESOLUTION_SCALE * clampZoom(zoom)};
  const view = fullscreenView(width, height, pixelRatio);
  return {width: view.width, height: view.height, scale: view.scale * clampZoom(zoom)};
}

// Emission density: the density option scales the native rate; fullscreen
// mode derives a scale×2 boost so on-screen particle
// density matches one cell = one pixel at any viewport size.
export function computeDensity(fullscreen: boolean, density: number, scale: number) {
  return density * (fullscreen ? scale * 2 : 1);
}

export class Dust {
  options: DustOptions;
  private container: Element;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private worker: Worker | null = null;
  private inline: ViewerRuntime | null = null;
  private catalog: Catalog | null = null;
  private kernelModule: WebAssembly.Module | null = null;
  private renderKernelModule: WebAssembly.Module | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  // Init-time effects.bin; detached once transferred to the worker, and
  // re-fetched by the main-thread fallback when the worker took it.
  private initBuffer: ArrayBuffer | null = null;
  private busy = false;
  private pending = 0;
  private ready = false;
  private disposed = false;
  private _running = false;
  private revision = 0;
  private lastTime: number | null = null;
  private recycled: ArrayBufferLike | null = null;
  private observer: ResizeObserver | null = null;
  private rafId: number | null = null;

  constructor(container: Element, options: Partial<DustOptions> = {}) {
    this.options = {...defaults, ...options};
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    const size = bufferSize(container.clientWidth, container.clientHeight);
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.ctx = this.canvas.getContext("2d", {alpha: false});
    container.append(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    void this.init();
  }

  // The host element's box drives the render buffer's aspect ratio.
  private hostSize() {
    return {
      width: Math.max(1, this.container.clientWidth),
      height: Math.max(1, this.container.clientHeight),
    };
  }

  private geometry() {
    return computeView(
      this.hostSize().width,
      this.hostSize().height,
      window.devicePixelRatio || 1,
      this.options.fullscreen,
      this.options.zoom,
    );
  }

  private view(): WorkerRequest {
    return {type: "view", ...this.geometry()};
  }

  private rawOptions(): RawOptions {
    return {
      core: this.options.core,
      glow: this.options.glow,
      portalSprite: this.options.portalSprite,
      color: this.options.color,
      background: this.options.background,
    };
  }

  private replay(): SimulationOptions {
    return {
      effect: this.options.effect,
      worldSeed: clampSeed(this.options.seed),
      x: clampWorld(this.options.x),
      y: clampWorld(this.options.y),
      startFrame: 0,
      density: computeDensity(
        this.options.fullscreen,
        this.options.density,
        this.geometry().scale,
      ),
      minTrailLifetime: this.options.minTrailLifetime,
      ambientRing: this.options.ambientRing,
      fastParticles: this.options.fastParticles,
      cullInvisible: this.options.cullInvisible,
      particleMirror: this.options.particleMirror,
    };
  }

  private async init() {
    try {
      const [catalog, bin, kernelModule, renderKernelModule] = await Promise.all([
        loadCatalog(),
        fetchBin(),
        loadEmbedRasterModule(),
        compileRenderKernel(),
      ]);
      if (this.disposed) return;
      this.catalog = catalog;
      this.kernelModule = kernelModule;
      this.renderKernelModule = renderKernelModule;
      const view = this.view();
      const init: WorkerRequest = {
        type: "init",
        catalog,
        buffer: bin,
        kernelModule,
        renderKernelModule,
        width: view.width,
        height: view.height,
        scale: view.scale,
        revision: this.revision,
        replay: this.replay(),
        options: this.rawOptions(),
      };
      try {
        this.worker = new Worker(
          new URL("./render-worker.ts", import.meta.url),
          {type: "module"},
        );
        this.worker.onmessage = ({data}) => this.receive(data as PreviewMessage);
        this.worker.onerror = (event) => {
          event.preventDefault();
          void this.fallback(event.message);
        };
        this.send(init);
      } catch (error) {
        await this.fallback(error);
      }
    } catch (error) {
      if (!this.disposed)
        console.error((error as Error).message);
    }
  }

  // Module workers unavailable or disallowed: run the same software renderer
  // on the main thread.
  private async fallback(error: unknown) {
    if (this.disposed) return;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.pending = 0;
    try {
      const catalog = await loadCatalog();
      if (this.disposed) return;
      const message = this.view();
      // A failed worker may already have taken ownership of its input buffer.
      const bytes = this.initBuffer && this.initBuffer.byteLength
        ? this.initBuffer
        : await fetchBin();
      const {ViewerRuntime} = await import("./viewer-runtime");
      if (this.disposed) return;
      this.inline = new ViewerRuntime(
        catalog,
        bytes,
        message.width!,
        message.height!,
        this.kernelModule,
        {scale: message.scale!, renderKernelModule: this.renderKernelModule},
      );
      this.inline.restart(this.replay(), this.revision);
      const result = this.inline.frame({
        paused: true,
        redraw: true,
        options: this.rawOptions(),
      });
      this.receive({...result, type: "init", pixels: result.pixels?.buffer} as PreviewMessage);
      if (error)
        console.warn("dust: worker unavailable; rendering on the main thread.", error);
    } catch (failure) {
      if (!this.disposed)
        console.error((failure as Error).message);
    }
  }

  private send(message: WorkerRequest) {
    if (this.disposed) return;
    if (this.worker) {
      if (message.type === "init") this.initBuffer = message.buffer ?? null;
      const transfer: ArrayBufferLike[] = [];
      if (message.buffer) transfer.push(message.buffer);
      if (message.recycle) transfer.push(message.recycle);
      this.worker.postMessage(message, transfer as Transferable[]);
      return;
    }
    const inline = this.inline;
    if (!inline) return;
    try {
      if (message.type === "view") {
        inline.setView({
          width: message.width!,
          height: message.height!,
          centerX: message.centerX,
          centerY: message.centerY,
          scale: message.scale,
        });
      } else if (message.type === "restart") {
        inline.restart(message.replay, message.revision);
        const result = inline.frame({
          paused: true,
          redraw: true,
          options: message.options,
          recycle: message.recycle,
        });
        this.receive({...result, type: "restart", pixels: result.pixels?.buffer} as PreviewMessage);
      } else if (message.type === "frame") {
        const result = inline.frame(message);
        this.receive({...result, type: "frame", pixels: result.pixels?.buffer} as PreviewMessage);
      }
    } catch (error) {
      this.receive({type: "error", message: (error as Error).message});
    }
  }

  private receive(data: PreviewMessage) {
    if (this.disposed) return;
    if (data.type === "frame") {
      this.pending = Math.max(0, this.pending - 1);
      this.busy = this.pending > 0;
    }
    if (data.type === "error") {
      if (data.message) console.error("dust:", data.message);
      this._running = false;
      return;
    }
    if (data.stale) return;
    if (data.pixels) {
      const bytes = data.pixels as ArrayBuffer;
      // A resize between request and response changes the canvas size; skip
      // the stale-size frame instead of throwing on the blit.
      if (data.revision === this.revision && this.ctx && bytes.byteLength === this.canvas.width * this.canvas.height * 4)
        this.ctx.putImageData(
          new ImageData(new Uint8ClampedArray(bytes), this.canvas.width, this.canvas.height),
          0,
          0,
        );
      this.recycled = data.pixels;
    }
    if (data.revision !== this.revision) return;
    if (data.type === "init") {
      this.ready = true;
      // A resize during async init left canvas and worker out of sync.
      this.applyView();
    }
  }

  private applyView() {
    const message = this.view();
    this.canvas.width = message.width!;
    this.canvas.height = message.height!;
    if (this.ready) this.send(message);
    if (this.ready && !this._running) this.redraw();
  }

  private resize() {
    if (this.disposed) return;
    if (this.options.fullscreen) {
      // The derived emission density tracks the view scale, so a fullscreen
      // resize rebuilds the view and the replay (debounced; dragging a
      // window edge would otherwise restart per frame).
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (this.disposed || !this.ready) return;
        this.applyView();
        this.restart();
      }, 200);
      return;
    }
    this.applyView();
  }

  // Re-request the current frame without advancing the simulation.
  private redraw() {
    if (!this.ready) return;
    this.send({
      type: "frame",
      revision: this.revision,
      paused: true,
      redraw: true,
      options: this.rawOptions(),
      recycle: this.takeBuffer(),
    });
  }

  private takeBuffer(): ArrayBufferLike | null {
    const buffer = this.recycled;
    this.recycled = null;
    return buffer;
  }

  restart() {
    if (!this.ready) return;
    const key = this.options.effect;
    const known =
      Object.prototype.hasOwnProperty.call(EFFECTS, key) ||
      Object.prototype.hasOwnProperty.call(MATH_EFFECTS, key) ||
      (this.catalog && Object.prototype.hasOwnProperty.call(this.catalog.effects, key));
    if (!known) {
      // An unknown key would make makeSimulation() throw in the worker and
      // take the animation down; keep the current effect instead.
      console.warn(`dust: unknown effect ${JSON.stringify(key)}; keeping the current one.`);
      return;
    }
    this.revision++;
    this.lastTime = null;
    this.send({
      type: "restart",
      revision: this.revision,
      replay: this.replay(),
      options: this.rawOptions(),
      recycle: this.takeBuffer(),
    });
  }

  update(options: Partial<DustOptions>) {
    const previous = this.options;
    this.options = {...previous, ...options};
    if (!this.ready) return;
    const replayKeys: (keyof DustOptions)[] = [
      "collection",
      "effect",
      "seed",
      "x",
      "y",
      "density",
      "minTrailLifetime",
      "ambientRing",
      "fastParticles",
      "cullInvisible",
      "particleMirror",
    ];
    if (replayKeys.some((key) => previous[key] !== this.options[key])) {
      this.restart();
      return;
    }
    if (previous.fullscreen !== this.options.fullscreen) {
      // The view geometry and the derived density both change with the mode.
      this.applyView();
      this.restart();
      return;
    }
    if (previous.zoom !== this.options.zoom) {
      // In fullscreen mode zoom rescales the derived density, so the replay
      // must be re-sent; the preview buffer keeps its restart-free zoom.
      this.applyView();
      if (this.options.fullscreen) this.restart();
      return;
    }
    if (
      previous.core !== this.options.core ||
      previous.glow !== this.options.glow ||
      previous.portalSprite !== this.options.portalSprite ||
      previous.color !== this.options.color ||
      previous.background !== this.options.background
    ) {
      // A running effect picks presentation changes up on its next frame
      // request; a paused one needs an explicit redraw.
      if (!this._running) this.redraw();
    }
  }

  get running(): boolean {
    return this._running;
  }
  start() {
    if (this._running || this.disposed) return;
    this._running = true;
    this.lastTime = null;
    const loop = (now: number) => {
      if (!this._running || this.disposed) return;
      if (this.ready && !this.busy && !document.hidden) {
        const elapsed = this.lastTime === null ? 0 : now - this.lastTime;
        this.lastTime = now;
        this.busy = true;
        this.pending++;
        this.send({
          type: "frame",
          revision: this.revision,
          elapsed,
          speed: clamped(this.options.speed, 0, 4),
          options: this.rawOptions(),
          ...(this.options.collection === "math"
            ? {mathTrailScale: clamped(this.options.mathTrailScale, MATH_TRAIL_SCALE.min, MATH_TRAIL_SCALE.max)}
            : {}),
          recycle: this.takeBuffer(),
        });
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  stop() {
    this._running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
  unmount() {
    this.disposed = true;
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.inline = null;
    this.observer?.disconnect();
    this.observer = null;
    this.canvas.parentNode?.removeChild(this.canvas);
  }
}
