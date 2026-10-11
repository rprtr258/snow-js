import { ViewerRuntime } from "./viewer-runtime";
import { figureGroups, FigureDefinition } from "./grid-layout";
import { figureSegments } from "./math-figures";
import { EmissionRandom, PortalSimulation } from "./portal-physics";
import { COLOR_MODES, grayColor, figureColor, DemoSettings } from "./demo-settings";
import { bufferMemory } from "./demo-stats";
import { validateColor } from "./particle-color";
import { Catalog, RawOptions, Resources, Size } from "./types";

export const DEMO = Object.freeze({ width: 480, height: 320, build: 90, animate: 300, fade: 90, historyLimit: 128 });
const FRAME_MS = 1000 / 60;
export type FigureBounds = {x: number; y: number; width: number; height: number};
export type DemoView_ = {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelated: boolean;
};
export type DemoHistoryItem = {key: string; color: string; gray: string};
export type DemoOptions = {
  random?: () => number;
  selection?: unknown;
  firstKey?: string | null;
  replayImages?: boolean;
};
export type DemoFrameData = {
  stats?: boolean;
  elapsed?: number;
  paused?: boolean;
  navigate?: number;
  selection?: unknown;
  viewport?: Size;
  duration?: number | "loop";
  detail?: number;
  density?: number;
  randomColors?: boolean;
  colorMode?: string;
  background?: unknown;
  smoothGlow?: unknown;
  recycle?: ArrayBufferLike | null;
  renderScale?: number;
  options?: RawOptions;
};

// The vivid HSL palette from the original grid demo.
export function randomColor(random: () => number = Math.random) {
  const h = random(), s = 0.85, l = 0.6, a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 1, 9 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// Fit the figure's world geometry, independent of any renderer's backing tile.
// Sample rotating math contours across the whole display interval so the camera
// stays still while they turn. Drifting sparks may leave these bounds.
export function figureBounds(
  sim: PortalSimulation,
  catalog: Catalog,
  resources: Resources,
  duration: number | "loop" = 5,
): FigureBounds {
  if (duration === "loop") duration = 30;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const point = (x: number, y: number) => {
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  };
  if (sim.guides) {
    const end = sim.loopFrames ?? DEMO.build + duration * 60;
    const stride = sim.loopFrames ? Math.max(1, Math.min(15, Math.floor(sim.loopFrames / 120))) : 15;
    for (let frame = 0; frame <= end; frame += stride)
      for (const segment of figureSegments(sim.effect, frame, sim.loopFrames))
        for (const [x, y] of segment) point(x, y);
  } else if (!sim.definition) {
    const radius = sim.effect === "eye_room" ? 130 : 58;
    point(-radius, -radius); point(radius, radius);
  } else {
    for (const sprite of sim.definition.sprites!) {
      const x = (sprite.entityX ?? 0) - sprite.offsetX, y = (sprite.entityY ?? 0) - sprite.offsetY;
      point(x, y); point(x + sprite.width, y + sprite.height);
    }
    for (const { config: c } of sim.emitters ?? []) {
      const x = (c.entityX ?? 0) + c.offsetX, y = (c.entityY ?? 0) + c.offsetY;
      const image = resources.images[c.image!];
      if (image) for (const p of image.points) point(x + p.x, y + p.y);
      else {
        point(x + c.xMin - c.radiusMax, y + c.yMin - c.radiusMax);
        point(x + c.xMax + c.radiusMax, y + c.yMax + c.radiusMax);
      }
    }
    if (sim.emissionPoints && sim.settings?.motion === "rotate" && sim.settings.degreesPerSecond !== 0) {
      const radius = sim.emissionPoints.reduce((max, p) => Math.max(max, Math.hypot(p.x, p.y)), 0);
      point(-radius, -radius); point(radius, radius);
    } else for (const p of sim.emissionPoints ?? []) point(p.x, p.y);
  }
  if (!Number.isFinite(left)) { left = top = -50; right = bottom = 50; }
  left -= 8; right += 8; top -= 8; bottom += 8;
  return { x: (left + right) / 2, y: (top + bottom) / 2, width: Math.max(32, right - left), height: Math.max(32, bottom - top) };
}

export function fitFigure(bounds: FigureBounds, width: number, height: number) {
  const scale = 0.9 * Math.min(width / bounds.width, height / bounds.height);
  return { scale, x: width / 2 - bounds.x * scale, y: height / 2 - bounds.y * scale };
}

export function demoView(bounds: FigureBounds, viewport: Size, pixelated: boolean): DemoView_ {
  const { width, height } = viewport;
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 16384)) throw new RangeError("Invalid demo viewport");
  // Include the entire visible world in the render, so outward-moving sparks
  // reach the real viewport edges. Bound allocations for extremely thin windows.
  const zoom = Math.max(fitFigure(bounds, width, height).scale, width / 2048, height / 2048);
  return { width: Math.max(2, Math.min(2048, Math.ceil(width / zoom))), height: Math.max(2, Math.min(2048, Math.ceil(height / zoom))),
    centerX: bounds.x, centerY: bounds.y, pixelated };
}

export function demoDuration(value: number | "loop") {
  if (value === "loop") return value;
  if (!Number.isFinite(value) || value < 1 || value > 30) throw new RangeError("Display duration must be between 1 and 30 seconds");
  return Math.round(value * 60) / 60;
}

export function demoMultiplier(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 4) throw new RangeError("Detail and density must be 1–4×");
  return value;
}

// A demo-only experiment. The first birth keeps its original RNG/state; extra
// births use fine jitter or whole image-cell offsets and share the same air physics.
// Attach at the pre-update boundary.
export function addDemoDensity(sim: PortalSimulation, density: () => number, pixelated: () => boolean = () => false) {
  const step = sim.step, random = new EmissionRandom(91);
  sim.step = function(this: PortalSimulation) {
    const emitted = this.totalEmitted, advance = this.advanceParticles;
    this.advanceParticles = function(this: PortalSimulation) {
      const count = this.totalEmitted - emitted, start = this.particles.length - count;
      const copies = density() - 1;
      for (let i = 0; copies > 0 && i < count; i++) {
        const source = this.particles[start + i];
        for (let j = 0; j < copies; j++) {
          if (this.particles.length >= 100000) { this.dropped++; continue; }
          const coarse = pixelated(), spread = coarse ? 1 : 0.45;
          let dx = random.range(-spread, spread), dy = random.range(-spread, spread);
          if (coarse) { dx = Math.round(dx); dy = Math.round(dy); }
          this.particles.push({ ...source, x: Math.fround(source.x + dx), y: Math.fround(source.y + dy), prevX: Math.fround(source.prevX + dx), prevY: Math.fround(source.prevY + dy), onGrid: coarse });
          this.totalEmitted++;
        }
      }
      return advance.call(this);
    };
    try { return step.call(this); }
    finally { this.advanceParticles = advance; }
  };
  return random;
}

export class DemoRuntime {
  declare viewer: ViewerRuntime;
  declare figures: Map<string, FigureDefinition>;
  declare random: () => number;
  declare colorMode: string;
  declare background: string;
  declare smoothGlow: boolean;
  declare bag: string[];
  declare pending: number;
  declare duration: number | "loop";
  declare viewport: Size;
  declare detail: number;
  declare density: number;
  declare history: DemoHistoryItem[];
  declare historyCursor: number;
  declare selection: string[];
  declare initialKey: string | null;
  declare key: string | null;
  declare frameNumber: number;
  declare exitStart: number | null;
  declare fadeFrom: number;
  declare exitDirections: number[];
  declare bounds: FigureBounds;
  declare pixelated: boolean;
  declare color: string;
  declare gray: string;
  declare densityRandom: EmissionRandom | undefined;
  declare statsEnabled: boolean;
  declare cpuMS: number;
  declare memory: {cpuBytes: number} | null;
  declare memoryTime: number;
  constructor(
    catalog: Catalog,
    buffer: ArrayBuffer,
    kernelModule: WebAssembly.Module | null = null,
    { random = Math.random, selection = null, firstKey = null, replayImages = true }: DemoOptions = {},
  ) {
    this.viewer = new ViewerRuntime(catalog, buffer, DEMO.width, DEMO.height, kernelModule, {
      replayImages,
      setupSimulation: sim => this.prepareSimulation(sim),
      // Avoid starting a new image pass that the scheduled transition would
      // immediately interrupt. Infinite display can always play another pass.
      allowImageReplay: cycleFrames => this.exitStart === null && this.endFrame() - this.frameNumber >= cycleFrames,
    });
    this.figures = new Map(figureGroups(catalog).flatMap(group => group.entries));
    this.random = random;
    this.colorMode = "random";
    this.background = "#000000";
    this.smoothGlow = true;
    this.bag = [];
    this.pending = 0;
    this.duration = 5;
    this.viewport = { width: DEMO.width, height: DEMO.height };
    this.detail = 2;
    this.density = 1;
    this.history = [];
    this.historyCursor = -1;
    this.selection = [];
    this.initialKey = firstKey;
    this.selection = this.validateSelection(selection);
    this.next();
  }
  validateSelection(keys: unknown): string[] {
    if (keys === null) return [...this.figures.keys()];
    if (!Array.isArray(keys) || keys.some(key => !this.figures.has(key))) throw new RangeError("Invalid demo selection");
    return [...new Set(keys)];
  }
  setSelection(keys: unknown) {
    const selected = this.validateSelection(keys);
    if (selected.length === this.selection.length && selected.every((key, i) => key === this.selection[i])) return;
    this.selection = selected;
    this.bag = [];
    const current = this.history[this.historyCursor];
    this.history = this.key !== null && selected.includes(this.key) && current ? [current] : [];
    this.historyCursor = this.history.length - 1;
    if (!this.key) this.next();
    else if (!selected.includes(this.key)) this.requestExit(1);
  }
  next(restart = true) {
    if (!this.selection.length) {
      this.key = null;
      this.viewer.simulation = null as unknown as PortalSimulation;
      return;
    }
    if (this.historyCursor + 1 < this.history.length) {
      this.historyCursor++;
      if (restart) this.restart();
      return;
    }
    if (!this.bag.length) {
      this.bag = [...this.selection];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
      const last = this.bag.length - 1;
      if (last > 0 && this.bag[last] === this.key)
        [this.bag[0], this.bag[last]] = [this.bag[last], this.bag[0]];
    }
    if (this.initialKey && this.selection.includes(this.initialKey)) {
      this.bag = this.bag.filter(key => key !== this.initialKey);
      this.bag.push(this.initialKey);
    }
    this.initialKey = null;
    this.history.push({ key: this.bag.pop()!, color: randomColor(this.random), gray: grayColor(this.random) });
    if (this.history.length > DEMO.historyLimit) this.history.shift();
    this.historyCursor = this.history.length - 1;
    if (restart) this.restart();
  }
  previous(restart = true) {
    if (this.historyCursor <= 0) return;
    this.historyCursor--;
    if (restart) this.restart();
  }
  restart() {
    ({ key: this.key, color: this.color, gray: this.gray } = this.history[this.historyCursor]);
    this.frameNumber = 0;
    this.exitStart = null;
    this.fadeFrom = 1;
    this.exitDirections = [];
    this.viewer.restart({ effect: this.key!, imageOnce: true });
    const sim = this.viewer.simulation;
    this.bounds = figureBounds(sim, this.viewer.catalog, this.viewer.resources, this.duration);
    this.pixelated = !!sim.emissionPoints || !!sim.emitters?.some(emitter => emitter.config.image);
  }
  prepareSimulation(sim: PortalSimulation) {
    this.densityRandom = addDemoDensity(sim, () => this.density, () => this.pixelated);
    if (sim.emitters) {
      sim.definition = { ...sim.definition, lifetime: -1 };
      for (const emitter of sim.emitters)
        emitter.config = { ...emitter.config, endFrame: -1, ...(emitter.config.image ? { imageLoop: false } : {}) };
    }
  }
  endFrame() { return this.duration === "loop" ? Infinity : DEMO.build + this.duration * 60; }
  reveal() {
    const end = this.exitStart ?? this.endFrame();
    if (this.frameNumber >= end) return this.fadeFrom * Math.max(0, 1 - (this.frameNumber - end) / DEMO.fade);
    return Math.min(1, this.frameNumber / DEMO.build);
  }
  requestExit(direction = 1) {
    if (!this.key) { this.next(); return; }
    if (direction < 0 && this.historyCursor <= 0 && !this.exitDirections.length) return;
    if (this.exitStart === null) {
      this.fadeFrom = this.reveal();
      this.exitStart = this.frameNumber;
    }
    if (this.exitDirections.length < DEMO.historyLimit) this.exitDirections.push(direction);
  }
  frame(data: DemoFrameData = {}) {
    this.statsEnabled = !!data.stats;
    const started = performance.now();
    const result = this.advanceFrame(data);
    this.cpuMS = performance.now() - started;
    return { ...result, stats: this.getStats() };
  }
  getStats() {
    if (!this.statsEnabled) return null;
    const now = performance.now();
    if (!this.memory || now - this.memoryTime >= 1000) { this.memory = bufferMemory(this.viewer); this.memoryTime = now; }
    const sim = this.viewer.simulation;
    return { cpuMS: this.cpuMS ?? 0,
      ...this.memory!, particles: sim?.particles.length ?? 0, visible: sim?.visibleCount ?? 0, dropped: sim?.dropped ?? 0,
      frame: sim?.frame ?? 0 };
  }
  advanceFrame({ elapsed = 0, paused = false, navigate = 0, selection, viewport = this.viewport, duration = this.duration, detail = this.detail, density = this.density, randomColors, colorMode = randomColors === undefined ? this.colorMode : randomColors ? "random" : "original", background: rawBackground = this.background, smoothGlow = this.smoothGlow, recycle = null }: DemoFrameData = {}): Record<string, unknown> {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("Invalid demo timing");
    if (!Number.isInteger(navigate) || Math.abs(navigate) > DEMO.historyLimit) throw new RangeError("Invalid demo navigation");
    duration = demoDuration(duration);
    detail = demoMultiplier(detail); density = demoMultiplier(density);
    if (!COLOR_MODES.includes(colorMode)) throw new RangeError("Invalid demo color mode");
    const background = validateColor(rawBackground) ?? "#000000";
    if (this.key && duration !== this.duration) {
      if (this.exitStart === null && this.frameNumber >= this.endFrame()) this.exitStart = this.endFrame();
      if (this.duration === "loop" && duration !== "loop") this.requestExit(1);
      else if (duration !== "loop" && this.frameNumber >= DEMO.build + duration * 60 && this.exitStart === null) this.requestExit(1);
    }
    this.duration = duration;
    this.detail = detail;
    this.density = density;
    this.colorMode = colorMode;
    this.background = background;
    this.smoothGlow = !!smoothGlow;
    this.viewport = viewport;
    if (selection !== undefined) this.setSelection(selection);
    for (let i = 0; i < Math.abs(navigate); i++) this.requestExit(Math.sign(navigate));
    if (!this.key) return { empty: true, key: null, label: "", phase: "empty", progress: 0, reveal: 0, canPrevious: false, colorMode,
      width: DEMO.width, height: DEMO.height, detail: 1, density };
    if (navigate || paused) this.pending = 0;
    else this.pending = Math.min(this.pending + Math.min(elapsed, 250), FRAME_MS * 3);
    const steps = paused ? 0 : Math.min(2, Math.floor((this.pending + 1e-8) / FRAME_MS));
    const options: RawOptions = { core: true, glow: true, color: figureColor(this.history[this.historyCursor] ?? { color: this.color, gray: this.gray }, colorMode), background, monochrome: ["white", "grayscale"].includes(colorMode), smoothGlow: this.smoothGlow };
    let view = demoView(this.bounds, this.viewport, this.pixelated);
    this.viewer.setView(view);
    let result: ReturnType<ViewerRuntime["frame"]> | undefined;
    for (let i = 0; i < steps; i++) {
      this.pending -= FRAME_MS;
      this.frameNumber++;
      if (this.frameNumber >= (this.exitStart ?? this.endFrame()) + DEMO.fade) {
        const directions = this.exitDirections.length ? this.exitDirections : [1];
        for (const direction of directions) direction < 0 ? this.previous(false) : this.next(false);
        if (!this.selection.length) return this.advanceFrame({ elapsed: 0, paused: true });
        this.restart();
        view = demoView(this.bounds, this.viewport, this.pixelated);
        this.viewer.setView(view);
        options.color = figureColor(this.history[this.historyCursor], colorMode);
      }
      result = this.viewer.frame({ step: true, renderScale: detail, recycle: i === 0 ? recycle : null, options });
    }
    result ??= this.viewer.frame({ paused: true, redraw: true, renderScale: detail, recycle, options });
    const end = this.exitStart ?? this.endFrame();
    const phase = this.frameNumber >= end ? "fade" : this.frameNumber < DEMO.build ? "build" : "animate";
    return {
      pixels: result.pixels,
      key: this.key, label: this.figures.get(this.key)!.label, color: options.color, bounds: this.bounds,
      phase, progress: phase === "build" ? this.frameNumber / DEMO.build : phase === "fade" ? (this.frameNumber - end) / DEMO.fade : 1,
      reveal: this.reveal(), colorMode, background,
      pixelated: this.pixelated, baseWidth: view.width, baseHeight: view.height,
      canPrevious: this.historyCursor > 0, duration: this.duration,
      detail: 1, density,
      width: view.width, height: view.height,
    };
  }
}
