// Embeddable fullscreen viewer for the snow-js website. Runs the simulation
// and software renderer on the main thread, sizes the render buffer to the
// host element's aspect ratio and exposes a Snow-like class API. The ported
// simulation and raster code are untouched; this module only orchestrates.
import { ViewerRuntime } from "./viewer-runtime";
import { EFFECTS } from "./portal-physics";
import { MATH_EFFECTS } from "./math-figures";
import { MATH_TRAIL_SCALE } from "./math-settings";
import { CATALOG } from "./catalog";
import { loadRenderKernelModule } from "./render-kernel";
import { fullscreenView, PREVIEW_HEIGHT, RESOLUTION_SCALE } from "./render-resolution";
import { Catalog, RawOptions, SimulationOptions } from "./types";

// raster.wasm and render-kernel.wasm live under static/assets/; the embed
// loads both directly.
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

export type NoitaCollection = "game" | "math";
export type NoitaOptions = {
  collection: NoitaCollection;
  effect: string;
  speed: number;
  zoom: number;
  // Fullscreen geometry: the render buffer is the host's device pixels and
  // the portal spans half the smaller dimension.
  // Default off keeps the fixed 320px preview buffer.
  fullscreen: boolean;
  // Emission density multiplier; view-independent (pass-through in both
  // modes).
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
const defaults: NoitaOptions = {
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

// The effect data (effects.bin) is fetched per viewer because the runtime
// takes ownership of it.
async function fetchBin(): Promise<ArrayBuffer> {
  const response = await fetch(
    new URL("../static/assets/effects.bin", import.meta.url),
  );
  if (!response.ok)
    throw new Error("noita: effect assets could not be loaded");
  return await response.arrayBuffer();
}

type RuntimeRequest = {
  type: "restart" | "frame" | "view";
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

// Emission density is view-independent: fullscreen renders the same world
// content at a higher resolution (one cell = scale device pixels), so the
// density option passes through unchanged. A scale-derived boost was tried
// and removed — it multiplied the per-world-cell particle (and glow) density
// ~6× at 1080p, flooding the scene with a much brighter halo than the
// preview.

export class Noita {
  options: NoitaOptions;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private inline: ViewerRuntime | null = null;
  private catalog: Catalog | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
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

  // The host creates and appends the canvas; this class draws into it and
  // tracks its box for the render buffer's aspect ratio.
  constructor(canvas: HTMLCanvasElement, options: Partial<NoitaOptions> = {}) {
    this.options = {...defaults, ...options};
    this.canvas = canvas;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const size = bufferSize(canvas.clientWidth, canvas.clientHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    this.ctx = canvas.getContext("2d", {alpha: false});
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    void this.init();
  }

  private hostSize() {
    return {
      width: Math.max(1, this.canvas.clientWidth),
      height: Math.max(1, this.canvas.clientHeight),
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

  private view(): RuntimeRequest {
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
      density: this.options.density,
      minTrailLifetime: this.options.minTrailLifetime,
      ambientRing: this.options.ambientRing,
      fastParticles: this.options.fastParticles,
      cullInvisible: this.options.cullInvisible,
      particleMirror: this.options.particleMirror,
    };
  }

  private async init() {
    try {
      const [bin, kernelModule, renderKernelModule] = await Promise.all([
        fetchBin(),
        loadEmbedRasterModule(),
        loadRenderKernelModule(),
      ]);
      if (this.disposed) return;
      this.catalog = CATALOG;
      const message = this.view();
      this.inline = new ViewerRuntime(
        CATALOG,
        bin,
        message.width!,
        message.height!,
        kernelModule,
        {scale: message.scale!, renderKernelModule},
      );
      this.inline.restart(this.replay(), this.revision);
      const result = this.inline.frame({
        paused: true,
        redraw: true,
        options: this.rawOptions(),
      });
      this.receive({...result, type: "init", pixels: result.pixels?.buffer} as PreviewMessage);
    } catch (error) {
      if (!this.disposed)
        console.error((error as Error).message);
    }
  }

  private send(message: RuntimeRequest) {
    if (this.disposed) return;
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
      if (data.message) console.error("noita:", data.message);
      this._running = false;
      return;
    }
    if (data.stale) return;
    if (data.pixels) {
      const bytes = data.pixels as ArrayBuffer;
      // A resize between request and response changes the canvas size; skip
      // the stale-size frame instead of throwing on the blit.
      if (data.revision === this.revision && this.ctx && bytes.byteLength === this.canvas.width * this.canvas.height * 4) {
        this.ctx.putImageData(
          new ImageData(new Uint8ClampedArray(bytes), this.canvas.width, this.canvas.height),
          0,
          0,
        );
      }
      this.recycled = data.pixels;
    }
    if (data.revision !== this.revision) return;
    if (data.type === "init") {
      this.ready = true;
      // A resize during async init left canvas and runtime out of sync.
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
      // The render buffer is the host's device pixels, so a fullscreen
      // resize rebuilds the view (debounced; dragging a window edge would
      // otherwise reallocate the renderer per frame). The simulation is
      // view-independent and keeps running through resizes.
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (this.disposed || !this.ready) return;
        this.applyView();
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
      // An unknown key would make makeSimulation() throw in the runtime and
      // take the animation down; keep the current effect instead.
      console.warn(`noita: unknown effect ${JSON.stringify(key)}; keeping the current one.`);
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

  update(options: Partial<NoitaOptions>) {
    const previous = this.options;
    this.options = {...previous, ...options};
    if (!this.ready) return;
    const replayKeys: (keyof NoitaOptions)[] = [
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
      // Only the view geometry changes with the mode; the simulation is
      // view-independent and keeps running.
      this.applyView();
      return;
    }
    if (previous.zoom !== this.options.zoom) {
      // Zoom is view-only in both modes.
      this.applyView();
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
}
