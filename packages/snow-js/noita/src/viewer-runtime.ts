// Shared by the embed viewer and headless Node tests.
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
function normalizeOptions(options: RawOptions): NormalizedOptions {
  return {
    core: !!options.core,
    glow: !!options.glow,
    color: validateColor(options.color),
    background: validateColor(options.background),
    monochrome: !!options.monochrome,
    smoothGlow: !!options.smoothGlow,
    // Absent means drawn: every consumer relies on the portal sprite.
    portalSprite: options.portalSprite !== false,
  };
}
function renderOptions(options: NormalizedOptions) {
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
  declare options: NormalizedOptions;
  declare pending: number;
  declare revision: number;
  declare slow: boolean;
  declare cost: {simulation: number; raster: number};
  declare setupSimulation: (simulation: PortalSimulation) => void;
  declare imageReplay: ImageReplay | null;
  declare replayImages: boolean;
  declare replayInput: SimulationOptions;
  declare simulation: PortalSimulation;
  declare scale: number;
  declare renderKernelModule: WebAssembly.Module | null;
  constructor(
    catalog: Catalog,
    buffer: ArrayBuffer,
    width = 480,
    height = 320,
    kernelModule: WebAssembly.Module | null = null,
    {
      replayImages = true,
      setupSimulation = () => {},
      scale = 1,
      renderKernelModule = null,
    }: {
      replayImages?: boolean;
      setupSimulation?: (simulation: PortalSimulation) => void;
      scale?: number;
      renderKernelModule?: WebAssembly.Module | null;
    } = {},
  ) {
    this.catalog = catalog;
    this.resources = decodeAssets(catalog, buffer);
    this.kernelModule = kernelModule;
    this.renderKernelModule = renderKernelModule;
    // `scale` is the world→pixel factor only - it must stay exact (no flooring);
    // width and height ARE the render buffer, in pixels.
    this.scale = scale;
    Object.assign(this, { replayImages, setupSimulation });
    this.renderer = new SoftwareRenderer(
      width,
      height,
      this.resources,
      catalog,
      { kernelModule, renderKernelModule, scale: this.scale },
    );
    this.options = normalizeOptions({ core: true, glow: true });
    this.pending = 0;
    this.revision = 0;
    this.slow = false;
    this.cost = { simulation: 0, raster: 0 };
  }
  setView({ width, height, centerX = 0, centerY = 0, scale }: {width: number; height: number; centerX?: number; centerY?: number; scale?: number}) {
    const old = this.renderer;
    const nextScale = scale === undefined ? this.scale : scale;
    const changed = old.width !== width || old.height !== height || (old.centerX ?? 0) !== centerX || (old.centerY ?? 0) !== centerY || old.scale !== nextScale;
    if (old.width !== width || old.height !== height || old.scale !== nextScale) {
      this.scale = nextScale;
      this.renderer = new SoftwareRenderer(width, height, this.resources, this.catalog, { kernelModule: this.kernelModule, renderKernelModule: this.renderKernelModule, scale: nextScale });
    } else if (changed) old.clear();
    Object.assign(this.renderer, { centerX, centerY });
  }
  restart(replay: SimulationOptions = {}, revision = 0, automatic = false) {
    const candidate = makeSimulation(
      { ...replay, retainInvisible: false },
      this.catalog,
      this.resources,
    );
    this.setupSimulation(candidate);
    // Batch the fast path's airflow noise through the wasm kernel when one is
    // loaded: one wasm simplex3 call per step instead
    // of one JS call per particle. Bit-identical to the inline JS noise
    // (src/render-kernel.test.ts); without a kernel the sim keeps its inline
    // noise. Closed over the current kernel instance: a setView() rebuild
    // between restarts would only hand the sim an equivalent, stateless
    // noise host.
    const noiseKernel = this.renderer.renderKernel;
    candidate.airflowBatch = noiseKernel
      ? (ax, ay, n, time) => noiseKernel.noiseAngles(ax, ay, n, time)
      : null;
    this.imageReplay = this.replayImages ? imageReplay(candidate) : null;
    this.replayInput = { ...replay };
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
      frame: s.frame,
      elapsedFrames: s.elapsedFrames,
      particles: s.particles.length,
      visible,
      dropped: s.dropped,
      accelerated: !!this.renderer.native,
      simulationMS: this.cost.simulation,
      rasterMS: this.cost.raster,
      slow: this.slow,
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
    // Renders once per frame() call after the stepping loop, for glow too:
    // intermediate renders were always discarded, and a per-step render
    // doubled the glow pipeline's cost exactly when the machine was already
    // behind — the death spiral the pending-debt cap exists to prevent. Glow
    // history therefore advances per displayed frame (wall-clock decay)
    // instead of per simulation step.
    for (let i = 0; i < steps; i++) {
      const t = performance.now();
      if (this.imageReplay?.ready) this.restart(this.replayInput, this.revision, true);
      this.simulation.step();
      this.imageReplay?.afterStep();
      simulationMS += performance.now() - t;
      if (!step) this.pending -= FRAME_MS;
    }
    if (steps) {
      const t = performance.now();
      pixels = this.renderer.render(this.simulation, renderOptions(this.options), true, recycle);
      rasterMS = performance.now() - t;
    }
    if (!steps && redraw) {
      pixels = this.renderer.render(this.simulation, renderOptions(this.options), false, recycle);
    }
    if (steps)
      this.cost = {
        simulation: simulationMS / steps,
        // One render per frame() call: this is the per-frame raster cost.
        raster: rasterMS,
      };
    return { revision: this.revision, stats: this.stats(), pixels, steps };
  }
}
