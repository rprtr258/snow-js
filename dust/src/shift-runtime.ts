import { GridRuntime, GridConfigureState, GridRuntimeOptions } from "./grid-runtime";
import { SoftwareRenderer } from "./software-renderer";
import { makeSimulation } from "./effect-simulation";
import { fitGrid, FigureDefinition } from "./grid-layout";
import { validateColor } from "./particle-color";
import { validateMathTrailScale } from "./math-settings";
import {
  shiftFigures,
  shiftMaterials,
  validateShift,
  makeShiftSimulation,
  SHIFT_DEFAULTS,
  ShiftData,
  ShiftFigure,
  ShiftMaterial,
} from "./material-shifts";
import { Catalog, Resources, SimulationOptions } from "./types";

type ShiftConfigureState = GridConfigureState & {
  from?: string;
  to?: string;
  zoom?: number;
  compare?: unknown;
  effects?: unknown;
};

export class ShiftRuntime extends GridRuntime {
  declare from: string;
  declare to: string;
  declare zoom: number;
  declare compare: boolean;
  declare effectSelection: string[];
  declare figures: ShiftFigure[];
  declare materials: Map<string, ShiftMaterial>;
  declare context: {from: string; to: string};
  constructor(
    catalog: Catalog,
    buffer: ArrayBuffer,
    kernelModule: WebAssembly.Module | null,
    shiftData: ShiftData,
    runtimeOptions: GridRuntimeOptions = {},
  ) {
    const combined: Catalog = { ...catalog, effects: { ...catalog.effects, ...shiftData.effects } };
    const figures = shiftFigures(catalog, shiftData), materials = shiftMaterials(shiftData), context: {from: string; to: string} = { from: SHIFT_DEFAULTS.from, to: SHIFT_DEFAULTS.to };
    const definitions: [string, FigureDefinition][] = figures.flatMap(f => [
      [`${f.id}:original`, { ...f, label: `${f.label} · original` }],
      [`${f.id}:shifted`, { ...f, label: `${f.label} · shifted` }],
    ]);
    super(combined, buffer, kernelModule, { ...runtimeOptions, definitions, replayGroup: (key: string) => key.split(":")[0], simulationFactory: (options: SimulationOptions, data: Catalog, resources: Resources) => {
      const [effect, variant] = options.effect!.split(":");
      return variant === "shifted"
        ? makeShiftSimulation({ ...options, effect }, data, resources, context.from, materials.get(context.to)!)
        : makeSimulation({ ...options, effect }, data, resources);
    } });
    Object.assign(this, { figures, materials, context, from: SHIFT_DEFAULTS.from, to: SHIFT_DEFAULTS.to,
      zoom: 1, compare: true, effectSelection: [] });
  }
  configure(state: ShiftConfigureState = {}, revision = this.revision) {
    const { from = this.from, to = this.to, zoom = this.zoom, compare = this.compare,
      effects = this.effectSelection, ...grid } = state;
    validateShift(from, to, this.figures, this.materials);
    const allowed = new Set(this.figures.filter(f => f.materials.includes(from)).map(f => f.id));
    if (!Array.isArray(effects) || new Set(effects).size !== effects.length || effects.some((id: string) => !allowed.has(id)))
      throw new RangeError("Invalid shift effect selection.");
    if (![1, 2, 4].includes(zoom)) throw new RangeError("Invalid view zoom.");
    fitGrid(effects.length * (compare ? 2 : 1), grid.width ?? this.layout.width, grid.height ?? this.layout.height,
      grid.showNames ?? this.showNames, compare ? 2 : (grid.columns ?? 0));
    validateColor(grid.background ?? this.background); validateMathTrailScale(grid.mathTrailScale ?? this.mathTrailScale);
    if (grid.options !== undefined && (!grid.options || typeof grid.options !== "object")) throw new RangeError("Invalid display options.");
    const restart = !!grid.restart || from !== this.from || to !== this.to || zoom !== this.zoom || !!compare !== this.compare;
    if (zoom !== this.zoom) {
      this.renderer = new SoftwareRenderer(480 / zoom, 320 / zoom, this.resources, this.catalog, { kernelModule: this.kernelModule });
    }
    Object.assign(this.context, { from, to });
    Object.assign(this, { from, to, zoom, compare: !!compare, effectSelection: [...effects] });
    const selection = effects.flatMap((id: string) => compare ? [`${id}:original`, `${id}:shifted`] : [`${id}:shifted`]);
    super.configure({ ...grid, selection, columns: compare ? 2 : (grid.columns ?? 0), restart,
      color: null, colors: {}, backgrounds: {} }, revision);
  }
}
