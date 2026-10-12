import { ViewerRuntime } from "./viewer-runtime";
import { GridRuntime, GridEntry } from "./grid-runtime";
import { ShiftRuntime } from "./shift-runtime";
import { DemoRuntime, demoView, figureBounds } from "./demo-runtime";
import { prepareContinuous } from "./gif-loop";
import { GridLayout } from "./grid-layout";
import { ShiftData } from "./material-shifts";
import { PortalSimulation } from "./portal-physics";
import { FRAME_MS } from "./timing";
import {
  Catalog,
  RawOptions,
  Rect,
  Resources,
  SimulationOptions,
  Size,
} from "./types";

export type GifCanvas = HTMLCanvasElement | OffscreenCanvas;
export type GifContext = CanvasRenderingContext2D;
export type GifSurface = {canvas: GifCanvas; context: GifContext};
export type GifConfig = {
  kind: string;
  loop?: boolean;
  key?: string;
  color?: string | null;
  viewport?: Size;
  settings?: Record<string, unknown>;
  state?: Record<string, unknown> & {
    background?: string;
    backgrounds?: Record<string, string>;
  };
  replay?: SimulationOptions;
  options?: RawOptions;
  shiftData?: ShiftData;
};
export type GifAssets = {
  catalog: Catalog;
  buffer: ArrayBuffer;
  kernelModule: WebAssembly.Module | null;
};
export type GifFrameRequest = {
  paused?: boolean;
  redraw?: boolean;
  step?: boolean;
  elapsed?: number;
  recycle?: ArrayBufferLike;
  detail?: number;
  renderScale?: number;
  options?: RawOptions;
};
export type GifFrameResult = {
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  pixelated: boolean;
  layout: GridLayout;
  pixels?: Uint8ClampedArray | null;
};
// The export scene drives four different runtimes; this is the surface it uses.
export type GifRuntime = {
  selection: string[];
  layout: {width: number; height: number};
  entries: Map<string, GridEntry>;
  simulation: PortalSimulation;
  viewer: {simulation: PortalSimulation; resources: Resources};
  frame(request: GifFrameRequest): GifFrameResult;
  restart(replay?: SimulationOptions): void;
  configure(state?: Record<string, unknown>): void;
};

export function gifSurface(width: number, height: number): GifSurface {
  let canvas: GifCanvas | undefined, context: GifContext | null | undefined;
  const options = { alpha: false, willReadFrequently: true };
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext("2d", options) as GifContext | null;
      if (ctx) { canvas = offscreen; context = ctx; }
    }
  } catch { /* Some older browsers expose OffscreenCanvas without 2D support. */ }
  if (!context && typeof document !== "undefined") {
    const element = document.createElement("canvas"); element.width = width; element.height = height;
    const ctx = element.getContext("2d", options) as GifContext | null;
    if (ctx) { canvas = element; context = ctx; }
  }
  if (!context) throw new Error("Canvas export is unavailable in this browser.");
  return { canvas: canvas!, context };
}
const rgb = (hex: string | null | undefined) => {
  const color = parseInt((hex ?? "#000000").slice(1), 16);
  return [(color >>> 16) & 255, (color >>> 8) & 255, color & 255];
};

// A separate, deterministic replay. It never touches live worker state, skips
// physics ticks, or stores a clip's worth of RGBA frames in memory.
export class GifScene {
  declare config: GifConfig;
  declare grid: boolean;
  declare looping: boolean;
  declare warmFrames: number;
  declare runtime: GifRuntime;
  declare baseWidth: number;
  declare baseHeight: number;
  declare result: GifFrameResult;
  declare width: number;
  declare height: number;
  declare settings: Record<string, unknown>;
  declare pixelated: boolean;
  declare source: GifSurface;
  declare background: GifSurface;
  declare backgrounds: number[][];
  declare ticks: number;
  constructor(config: GifConfig, assets: GifAssets, looping = !!config.loop) {
    this.config = config;
    this.grid = config.kind === "grid" || config.kind === "shifts";
    this.looping = looping;
    this.warmFrames = 0;
    const { catalog, buffer, kernelModule } = assets;
    if (this.grid) {
      const runtime: GridRuntime = config.kind === "shifts"
        ? new ShiftRuntime(catalog, buffer, kernelModule, config.shiftData!, { replayImages: false })
        : new GridRuntime(catalog, buffer, kernelModule, { replayImages: false });
      this.runtime = runtime as unknown as GifRuntime;
      runtime.configure({ ...config.state, showNames: false, restart: true });
      if (!runtime.selection.length) throw new Error("Select at least one figure first.");
      if (looping) for (const { simulation } of runtime.entries.values()) this.warmFrames = Math.max(this.warmFrames, prepareContinuous(simulation));
      this.baseWidth = runtime.layout.width; this.baseHeight = runtime.layout.height;
      this.result = this.runtime.frame({ paused: true, redraw: true });
      this.width = this.result.layout.width; this.height = this.result.layout.height;
    } else if (config.kind === "demo") {
      if (!config.key) throw new Error("Select a figure first.");
      const runtime = new DemoRuntime(catalog, buffer, kernelModule, { selection: [config.key], random: () => 0.5, replayImages: false });
      this.runtime = runtime as unknown as GifRuntime;
      // Export only the current figure. Continuous loops also repeat its emitters.
      runtime.duration = "loop";
      runtime.restart();
      if (looping) {
        this.warmFrames = prepareContinuous(runtime.viewer.simulation);
        runtime.bounds = figureBounds(runtime.viewer.simulation, catalog, runtime.viewer.resources, 90);
      }
      const item = runtime.history[runtime.historyCursor];
      item.color = item.gray = config.color ?? "#ffffff";
      const view = demoView(runtime.bounds, config.viewport!, runtime.pixelated);
      this.settings = { ...config.settings, duration: "loop", selection: [config.key], viewport: config.viewport,
        detail: Math.max(1, Math.min(4, Math.floor(2048 / Math.max(view.width, view.height)))), stats: false };
      this.result = this.runtime.frame({ ...this.settings, paused: true });
      this.width = this.result.width; this.height = this.result.height;
      this.baseWidth = this.result.baseWidth; this.baseHeight = this.result.baseHeight;
      this.pixelated = this.result.pixelated;
    } else {
      const runtime = new ViewerRuntime(catalog, buffer, 480, 320, kernelModule, { replayImages: false });
      this.runtime = runtime as unknown as GifRuntime;
      runtime.restart(config.replay);
      if (looping) this.warmFrames = prepareContinuous(runtime.simulation);
      this.settings = { options: config.options, renderScale: 4 };
      this.result = this.runtime.frame({ ...this.settings, paused: true, redraw: true });
      this.width = 480; this.height = 320;
      this.baseWidth = 480; this.baseHeight = 320;
      const sim = runtime.simulation;
      this.pixelated = !!sim.emissionPoints || !!sim.emitters?.some(e => e.config.image);
    }
    this.source = gifSurface(this.width, this.height);
    this.background = gifSurface(this.width, this.height);
    const context = this.background.context;
    context.fillStyle = "#000000"; context.fillRect(0, 0, this.width, this.height);
    if (this.grid) {
      this.backgrounds = [rgb(null)];
      this.result.layout.tiles.forEach((tile, i) => {
        const key = this.runtime.selection[i], color = config.state?.backgrounds?.[key] ?? config.state?.background;
        context.fillStyle = color ?? "#000000";
        context.fillRect(tile.x, tile.y, tile.width, tile.imageHeight);
        this.backgrounds.push(rgb(color));
      });
    } else {
      const color = config.kind === "demo" ? config.settings?.background : config.options?.background;
      context.fillStyle = (typeof color === "string" ? color : null) ?? "#000000"; context.fillRect(0, 0, this.width, this.height);
      this.backgrounds = [rgb(typeof color === "string" ? color : null)];
    }
    this.ticks = 0;
  }
  simulations(): PortalSimulation[] {
    return this.grid ? [...this.runtime.entries.values()].map(e => e.simulation)
      : [this.config.kind === "demo" ? this.runtime.viewer.simulation : this.runtime.simulation];
  }
  async prepare(report: (completed: number, total: number) => void) {
    if (!this.looping) return;
    const sims = this.simulations();
    for (let tick = 0; tick < this.warmFrames; tick++) {
      if (tick < this.warmFrames - 240) {
        for (const sim of sims) sim.step();
        this.ticks++;
      } else this.advance(this.ticks + 1, true);
      if (tick % 16 === 0 || tick + 1 === this.warmFrames) await report(tick + 1, this.warmFrames);
    }
    this.redraw();
  }
  redraw() {
    if (this.grid) this.result = this.runtime.frame({ paused: true, redraw: true }); else if (this.config.kind === "demo") this.result = this.runtime.frame({ ...this.settings, paused: true });
    else this.result = this.runtime.frame({ ...this.settings, paused: true, redraw: true });
  }
  advance(target: number, warming = false) {
    while (this.ticks < target) {
      const recycle = this.result?.pixels?.buffer;
      this.result = this.config.kind === "demo"
        ? this.runtime.frame({ ...this.settings, ...(warming ? { detail: 1 } : {}), elapsed: FRAME_MS, recycle })
        : this.runtime.frame({ ...this.settings, ...(warming ? { renderScale: 1 } : {}), step: true, recycle });
      this.ticks++;
    }
  }
  draw(context: GifContext, crop: Rect, width: number, height: number) {
    if (this.result?.pixels) this.source.context.putImageData(new ImageData(this.result.pixels as unknown as Uint8ClampedArray<ArrayBuffer>, this.width, this.height), 0, 0);
    context.imageSmoothingEnabled = !this.pixelated && (width < crop.width || height < crop.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(this.background.canvas as CanvasImageSource, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    context.drawImage(this.source.canvas as CanvasImageSource, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  }
  dispose() {
    for (const surface of [this.source, this.background]) if (surface) surface.canvas.width = surface.canvas.height = 1;
  }
}
