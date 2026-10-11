import { decodeAssets, makeSimulation } from "./effect-simulation";
import { SoftwareRenderer } from "./software-renderer";
import { MATH_TRAIL_SCALE, validateMathTrailScale } from "./math-settings";
import { packColor, validateColor } from "./particle-color";
import { imageReplay, ImageReplay } from "./image-replay";
import { SimulationFactory, PortalSimulation, TrailScalableSimulation } from "./portal-physics";
import {
  Catalog,
  FrameRequest,
  Resources,
  RuntimeOptionsState,
} from "./types";
import {
  figureGroups,
  fitGrid,
  blitTile,
  FigureEntry,
  FigureDefinition,
  GridLayout,
  TILE_WIDTH,
  TILE_HEIGHT,
} from "./grid-layout";

const FRAME_MS = 1000 / 60;
export type GridEntry = {
  simulation: PortalSimulation;
  imageReplay: ImageReplay | null;
  imageCycles: number;
  history: Float32Array;
};
export type GridRuntimeOptions = {
  simulationFactory?: SimulationFactory;
  definitions?: FigureEntry[];
  replayImages?: boolean;
  replayGroup?: (key: string) => string;
};
export type GridConfigureState = {
  selection?: string[];
  width?: number;
  height?: number;
  mathTrailScale?: number;
  options?: RuntimeOptionsState;
  showNames?: boolean;
  columns?: number;
  color?: unknown;
  colors?: Record<string, unknown> | null;
  background?: unknown;
  backgrounds?: Record<string, unknown> | null;
  restart?: boolean;
};
export class GridRuntime {
  declare catalog: Catalog;
  declare kernelModule: WebAssembly.Module | null;
  declare simulationFactory: SimulationFactory;
  declare resources: Resources;
  declare definitions: Map<string, FigureDefinition>;
  declare renderer: SoftwareRenderer;
  declare entries: Map<string, GridEntry>;
  declare imageReplayGroups: string[][];
  declare replayImages: boolean;
  declare selection: string[];
  declare mathTrailScale: number;
  declare options: {core: boolean; glow: boolean};
  declare color: string | null;
  declare colors: Record<string, string | null>;
  declare background: string | null;
  declare backgrounds: Record<string, string | null>;
  declare layout: GridLayout;
  declare showNames: boolean;
  declare columns: number;
  declare pending: number;
  declare dirty: boolean;
  declare revision: number;
  declare replayGroup: (key: string) => string;
  constructor(
    catalog: Catalog,
    buffer: ArrayBuffer,
    kernelModule: WebAssembly.Module | null = null,
    {
      simulationFactory = makeSimulation,
      definitions = figureGroups(catalog).flatMap(group => group.entries),
      replayImages = true,
      replayGroup = (key: string) => key,
    }: GridRuntimeOptions = {},
  ) {
    this.catalog = catalog;
    this.kernelModule = kernelModule;
    this.simulationFactory = simulationFactory;
    Object.assign(this, { replayImages, replayGroup });
    this.resources = decodeAssets(catalog, buffer);
    this.definitions = new Map(definitions);
    // Share assets, WASM instance and scratch buffers. Only history and simulation
    // belong to a tile; adding a checkbox does not allocate another renderer.
    this.renderer = new SoftwareRenderer(
      TILE_WIDTH,
      TILE_HEIGHT,
      this.resources,
      catalog,
      { kernelModule },
    );
    this.entries = new Map();
    this.imageReplayGroups = [];
    this.selection = [];
    this.mathTrailScale = MATH_TRAIL_SCALE.default;
    this.options = { core: true, glow: true };
    // Presentation-only recolors: a global choice and per-figure overrides,
    // kept for unselected figures so re-adding one restores its color.
    this.color = null;
    this.colors = {};
    this.background = null;
    this.backgrounds = {};
    this.layout = fitGrid(0, 960, 640);
    this.showNames = true;
    this.columns = 0;
    this.pending = 0;
    this.dirty = true;
    this.revision = 0;
  }
  configure(
    {
      selection = this.selection,
      width = this.layout.width,
      height = this.layout.height,
      mathTrailScale = this.mathTrailScale,
      options = this.options,
      showNames = this.showNames,
      columns = this.columns,
      color = this.color,
      colors = this.colors,
      background = this.background,
      backgrounds = this.backgrounds,
      restart = false,
    }: GridConfigureState = {},
    revision = this.revision,
  ) {
    if (
      !Array.isArray(selection) ||
      new Set(selection).size !== selection.length ||
      selection.some((key) => !this.definitions.has(key))
    )
      throw new RangeError("Invalid grid selection");
    const layout = fitGrid(selection.length, width, height, showNames, columns);
    validateMathTrailScale(mathTrailScale);
    const overrides = [colors, backgrounds].map((map) => {
      if (!map || typeof map !== "object" || Array.isArray(map))
        throw new RangeError("Invalid per-figure colors");
      const valid: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(map)) {
        if (!this.definitions.has(key)) throw new RangeError("Invalid per-figure colors");
        valid[key] = validateColor(value);
      }
      return valid;
    });
    const globalColor = validateColor(color),
      globalBackground = validateColor(background);
    const entries = new Map();
    for (const key of selection) {
      let entry = !restart && this.entries.get(key);
      if (!entry) entry = this.createEntry(key, mathTrailScale);
      entries.set(key, entry);
    }
    for (const entry of entries.values())
      (entry.simulation as TrailScalableSimulation).setTrailScale?.(mathTrailScale);
    // Removed tiles release their particle pools and history. Retained tiles keep
    // their frame, RNG and glow even when the grid is rearranged or resized.
    this.entries = entries;
    const groups = new Map();
    for (const [key, entry] of entries) if (entry.imageReplay) {
      const group = this.replayGroup(key);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(key);
    }
    this.imageReplayGroups = [...groups.values()];
    this.selection = [...selection];
    this.layout = layout;
    this.showNames = !!showNames;
    this.columns = columns;
    this.mathTrailScale = mathTrailScale;
    this.options = { core: !!options.core, glow: !!options.glow };
    this.color = globalColor;
    this.background = globalBackground;
    [this.colors, this.backgrounds] = overrides;
    this.revision = revision;
    this.pending = 0;
    this.dirty = true;
  }
  createEntry(key: string, mathTrailScale: number, previous: GridEntry | null = null) {
    const simulation = this.simulationFactory({ effect: key, mathTrailScale, retainInvisible: false }, this.catalog, this.resources);
    return { simulation, imageReplay: this.replayImages ? imageReplay(simulation) : null,
      imageCycles: previous ? previous.imageCycles + 1 : 0,
      history: previous?.history ?? new Float32Array(this.renderer.history.length) };
  }
  replayFinishedImages() {
    const restart = this.imageReplayGroups.filter(group => group.every(key => this.entries.get(key)!.imageReplay!.ready)).flat();
    if (!restart.length) return;
    for (const key of restart) this.entries.set(key, this.createEntry(key, this.mathTrailScale, this.entries.get(key)));
  }
  tileOptions(key: string) {
    return {
      ...this.options,
      color: packColor(this.colors[key] ?? this.color),
      background: packColor(this.backgrounds[key] ?? this.background) ?? 0,
    };
  }
  frame({
    elapsed = 0,
    speed = 1,
    paused = false,
    step = false,
    redraw = false,
    recycle,
  }: FrameRequest = {}) {
    if (
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      !Number.isFinite(speed) ||
      speed < 0 ||
      speed > 4
    )
      throw new RangeError("Invalid playback timing");
    if (paused || !this.selection.length) this.pending = 0;
    else this.pending += Math.min(elapsed, 250) * speed;
    const slow = this.pending > FRAME_MS * 3;
    // Many selected effects slow wall-clock playback, never skip physics steps.
    if (slow) this.pending = FRAME_MS * 2 + (this.pending % FRAME_MS);
    const steps = !this.selection.length
      ? 0
      : step
        ? 1
        : paused
          ? 0
          : Math.min(2, Math.floor((this.pending + 1e-8) / FRAME_MS));
    if (steps && !step) this.pending -= FRAME_MS * steps;
    if (steps) this.replayFinishedImages();
    let pixels: Uint8ClampedArray | null = null, simulationMS = 0;
    const start = performance.now();
    if (steps || redraw || this.dirty) {
      const { width, height, tiles } = this.layout;
      pixels = recycle?.byteLength === width * height * 4
        ? new Uint8ClampedArray(recycle) : new Uint8ClampedArray(width * height * 4);
      pixels.fill(0);
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
      for (let i = 0; i < this.selection.length; i++) {
        const key = this.selection[i], entry = this.entries.get(key)!;
        const options = this.tileOptions(key);
        this.renderer.history.set(entry.history);
        let image: Uint8ClampedArray | undefined;
        for (let j = 0; j < steps; j++) {
          const started = performance.now();
          entry.simulation.step();
          entry.imageReplay?.afterStep();
          simulationMS += performance.now() - started;
          image = this.renderer.render(entry.simulation, options, true);
        }
        if (!steps) image = this.renderer.render(entry.simulation, options, false);
        if (steps) entry.history.set(this.renderer.history);
        blitTile(image!, pixels, width, tiles[i], this.renderer.width, this.renderer.height);
      }
      this.dirty = false;
    }
    return {
      revision: this.revision,
      pixels,
      steps,
      layout: this.layout,
      stats: {
        simulationMS,
        renderMS: performance.now() - start - simulationMS,
        accelerated: !!this.renderer.native,
        slow,
        frameMS: performance.now() - start,
        figures: this.selection.map((key) => {
          const s = this.entries.get(key)!.simulation;
          return {
            key,
            label: this.definitions.get(key)!.label,
            frame: s.frame,
            imageCycles: this.entries.get(key)!.imageCycles,
            particles: s.particles.length,
            emitted: s.totalEmitted,
            dropped: s.dropped,
          };
        }),
      },
    };
  }
}
