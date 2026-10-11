// Shared by the browser worker, main-thread fallback, and headless Node tests.
import { decodeAssets, makeSimulation } from "./effect-simulation";
import { SoftwareRenderer } from "./software-renderer";
import { packColor, validateColor } from "./particle-color";
import { imageReplay, ImageReplay } from "./image-replay";
import { PortalSimulation, TrailScalableSimulation, ImageSettableSimulation } from "./portal-physics";
import { FRAME_MS } from "./timing";
import {
  Catalog,
  NormalizedOptions,
  RawOptions,
  Resources,
  SimulationOptions,
  ViewerFrameRequest,
} from "./types";
// Presentation-only settings: hex strings in, packed colors out to the renderer.
export function normalizeOptions(options: RawOptions): NormalizedOptions {
  return {
    core: !!options.core,
    glow: !!options.glow,
    color: validateColor(options.color),
    background: validateColor(options.background),
    monochrome: !!options.monochrome,
    smoothGlow: !!options.smoothGlow,
    // Absent means drawn: every existing page relies on the portal sprite.
    portalSprite: options.portalSprite !== false,
  };
}
export function renderOptions(options: NormalizedOptions) {
  return {
    core: options.core,
    glow: options.glow,
    color: packColor(options.color),
    background: packColor(options.background) ?? 0,
    monochrome: options.monochrome,
    smoothGlow: options.smoothGlow,
    portalSprite: options.portalSprite,
  };
}
export class ViewerRuntime {
  declare catalog: Catalog;
  declare resources: Resources;
  declare kernelModule: WebAssembly.Module | null;
  declare renderer: SoftwareRenderer;
  declare renderScale: number;
  declare options: NormalizedOptions;
  declare pending: number;
  declare revision: number;
  declare slow: boolean;
  declare cost: {simulation: number; raster: number};
  declare lastSteps: number;
  declare setupSimulation: (simulation: PortalSimulation) => void;
  declare imageReplay: ImageReplay | null;
  declare replayImages: boolean;
  declare replayInput: SimulationOptions;
  declare imageCycles: number;
  declare simulation: PortalSimulation;
  declare allowImageReplay: (cycleFrames: number) => boolean;
  declare scale: number;
  declare viewWidth: number;
  declare viewHeight: number;
  constructor(
    catalog: Catalog,
    buffer: ArrayBuffer,
    width = 480,
    height = 320,
    kernelModule: WebAssembly.Module | null = null,
    {
      replayImages = true,
      setupSimulation = () => {},
      allowImageReplay = () => true,
      scale = 1,
    }: {
      replayImages?: boolean;
      setupSimulation?: (simulation: PortalSimulation) => void;
      allowImageReplay?: (cycleFrames: number) => boolean;
      scale?: number;
    } = {},
  ) {
    this.catalog = catalog;
    this.resources = decodeAssets(catalog, buffer);
    this.kernelModule = kernelModule;
    // `scale` is the world→pixel factor only - it must stay exact (no flooring);
    // width and height ARE the render buffer, in pixels.
    this.scale = scale;
    this.viewWidth = width;
    this.viewHeight = height;
    Object.assign(this, { replayImages, setupSimulation, allowImageReplay });
    this.renderer = new SoftwareRenderer(
      width,
      height,
      this.resources,
      catalog,
      { kernelModule, scale: this.scale },
    );
    this.renderScale = 1;
    this.options = normalizeOptions({ core: true, glow: true });
    this.pending = 0;
    this.revision = 0;
    this.slow = false;
    this.cost = { simulation: 0, raster: 0 };
    this.lastSteps = 0;
  }
  setView({ width, height, centerX = 0, centerY = 0 }: {width: number; height: number; centerX?: number; centerY?: number}) {
    this.viewWidth = width;
    this.viewHeight = height;
    const old = this.renderer;
    const changed = old.width !== width || old.height !== height || (old.centerX ?? 0) !== centerX || (old.centerY ?? 0) !== centerY;
    if (old.width !== width || old.height !== height)
      this.renderer = new SoftwareRenderer(width, height, this.resources, this.catalog, { kernelModule: this.kernelModule, scale: this.scale });
    else if (changed) old.clear();
    Object.assign(this.renderer, { centerX, centerY });
  }
  restart(replay: SimulationOptions = {}, revision = 0, automatic = false) {
    const candidate = makeSimulation(
      { ...replay, retainInvisible: false },
      this.catalog,
      this.resources,
    );
    this.setupSimulation(candidate);
    this.imageReplay = this.replayImages ? imageReplay(candidate) : null;
    this.replayInput = { ...replay };
    this.imageCycles = automatic ? this.imageCycles + 1 : 0;
    this.simulation = candidate;
    this.revision = revision;
    if (!automatic) this.pending = 0;
    this.slow = false;
    // Keep residual glow decaying naturally through the empty gap. Clearing it
    // at an automatic replay would visibly cut off a lingering halo.
    if (!automatic) this.renderer.clear();
  }
  stats() {
    const s = this.simulation,
      visible = s.visibleCount;
    return {
      effect: s.effect,
      frame: s.frame,
      elapsedFrames: s.elapsedFrames,
      particles: s.particles.length,
      visible,
      emitted: s.totalEmitted,
      dropped: s.dropped,
      sprites: s.spriteParticles?.length ?? 0,
      accelerated: !!this.renderer.native,
      simulationMS: this.cost.simulation,
      rasterMS: this.cost.raster,
      slow: this.slow,
      seed: s.worldSeed,
      x: s.x,
      y: s.y,
      startFrame: s.startFrame,
      imageCycles: this.imageCycles,
      ...(s.mathTrailScale === undefined
        ? {}
        : { mathTrailScale: s.mathTrailScale }),
    };
  }
  frame({
    elapsed = 0,
    speed = 1,
    paused = false,
    step = false,
    redraw = false,
    mathTrailScale,
    imageSettings,
    renderScale = this.renderScale,
    options,
    recycle = null,
  }: ViewerFrameRequest = {}) {
    if (
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      !Number.isFinite(speed) ||
      speed < 0 ||
      speed > 4
    )
      throw new RangeError("Invalid playback timing");
    if (!Number.isInteger(renderScale) || renderScale < 1 || renderScale > 4) throw new RangeError("Invalid render detail");
    if (renderScale !== this.renderScale) redraw = true;
    this.renderScale = renderScale;
    if (mathTrailScale !== undefined)
      (this.simulation as TrailScalableSimulation).setTrailScale?.(mathTrailScale);
    if (imageSettings !== undefined) (this.simulation as ImageSettableSimulation).setImageSettings?.(imageSettings);
    if (options) this.options = normalizeOptions(options);
    if (paused) this.pending = 0;
    else this.pending += Math.min(elapsed, 250) * speed;
    // Bounded wall-clock debt prevents a software VM from entering a catch-up spiral.
    // No simulation frames are jumped: a slow machine runs game time slower.
    this.slow = this.pending > FRAME_MS * 3;
    if (this.slow) this.pending = FRAME_MS * 2 + (this.pending % FRAME_MS);
    const steps = step
      ? 1
      : paused
        ? 0
        : Math.min(2, Math.floor((this.pending + 1e-8) / FRAME_MS));
    let pixels: Uint8ClampedArray | null = null,
      simulationMS = 0,
      rasterMS = 0;
    for (let i = 0; i < steps; i++) {
      let t = performance.now();
      if (this.imageReplay?.ready && this.allowImageReplay(this.imageReplay.cycleFrames))
        this.restart(this.replayInput, this.revision, true);
      this.simulation.step();
      this.imageReplay?.afterStep();
      simulationMS += performance.now() - t;
      t = performance.now();
      pixels = this.renderer.render(this.simulation, renderOptions(this.options), true, i === 0 ? recycle : null);
      rasterMS += performance.now() - t;
      if (!step) this.pending -= FRAME_MS;
    }
    if (!steps && redraw) {
      pixels = this.renderer.render(this.simulation, renderOptions(this.options), false, recycle);
    }
    if (steps) this.cost = { simulation: simulationMS / steps, raster: rasterMS / steps };
    this.lastSteps = steps;
    return { revision: this.revision, stats: this.stats(), pixels, steps };
  }
}
