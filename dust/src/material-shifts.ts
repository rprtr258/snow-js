import { EFFECTS, PortalSimulation } from "./portal-physics";
import { makeSimulation } from "./effect-simulation";
import {
  Catalog,
  EffectDefinition,
  EmissionConfig,
  MaterialInfo,
  Resources,
  SimulationOptions,
  TrailPoint,
} from "./types";
import { FigureDefinition } from "./grid-layout";

export type ShiftMaterial = MaterialInfo & {id: string; name: string; shiftable?: boolean};
export type ShiftData = {
  version: number;
  materials: ShiftMaterial[];
  effects: Record<string, EffectDefinition>;
};
export type ShiftFigure = FigureDefinition & {
  id: string;
  group: string;
  materials: string[];
};
type RawShiftSettings = {
  from?: string;
  to?: string;
  selection?: unknown;
  zoom?: number;
  compare?: unknown;
  glow?: unknown;
  core?: unknown;
  speed?: number;
  background?: string;
};
export const SHIFT_DEFAULTS = Object.freeze({ from: "spark_purple", to: "gold", zoom: 2, compare: true, background: "#000000" });
export const SHIFT_STORAGE = "dust-material-shifts-v1";
export const materialHex = (material: MaterialInfo) => `#${(material.color & 0xffffff).toString(16).padStart(6, "0")}`;
export const materialLabel = (material: {name: string; id: string}) => `${material.name} · ${material.id}`;
export function shiftFigures(catalog: Catalog, shiftData: ShiftData): ShiftFigure[] {
  return [
    ...Object.entries(EFFECTS).map(([id, data]) => ({ id, ...data, group: "Portals", materials: ["spark_purple"] })),
    ...Object.entries({ ...catalog.effects, ...shiftData.effects }).filter(([, d]) => !d.imageEmitter).map(([id, data]) => ({
      id, ...data, group: data.group === "shields" ? "Shields · idle particles" : data.group === "images" ? "Image effects" : "Objects",
      materials: [...new Set(data.emitters.map(e => e.material))],
    })),
  ];
}
export function matchingFigures(figures: ShiftFigure[], source: string) { return figures.filter(f => f.materials.includes(source)); }
export function shiftMaterials(data: ShiftData) {
  if (data?.version !== 1 || !Array.isArray(data.materials)) throw new Error("Material data could not be read.");
  return new Map(data.materials.map(m => [m.id, m]));
}
export function validateShift(from: string, to: string, figures: ShiftFigure[], materials: Map<string, ShiftMaterial>) {
  if (!materials.has(from) || !figures.some(f => f.materials.includes(from))) throw new RangeError("Unknown source material.");
  if (!materials.get(to)?.shiftable) throw new RangeError("Choose an available destination material.");
}

// These three verified portals emit spark_purple through the native-style
// implementation. Resolve its material at birth, preserving the emitter's
// RNG, velocity, lifetime and fade rate. Other effects already resolve material
// properties through SourceSimulation's catalog lookup.
class ShiftPortalSimulation extends PortalSimulation {
  declare shiftMaterial: ShiftMaterial;
  constructor(options: SimulationOptions, material: ShiftMaterial) { super(options); this.shiftMaterial = material; }
  emit(config: EmissionConfig, x: number, y: number, angle = 0, previous: TrailPoint | null = null) {
    const count = this.particles.length;
    super.emit(config, x, y, angle, previous);
    if (this.particles.length === count) return;
    const material = this.shiftMaterial, p = this.particles[this.particles.length - 1];
    p.color = material.color; p.alpha = Math.fround((material.color >>> 24) / 255);
    p.glow = material.glow > 0; p.cellType = material.cellType;
  }
}
export function makeShiftSimulation(
  options: SimulationOptions,
  catalog: Catalog,
  resources: Resources,
  from: string,
  target: ShiftMaterial,
): PortalSimulation {
  if (from === target.id) return makeSimulation(options, catalog, resources);
  if (Object.prototype.hasOwnProperty.call(EFFECTS, options.effect ?? ""))
    return from === "spark_purple" ? new ShiftPortalSimulation(options, target) : makeSimulation(options, catalog, resources);
  const shifted: Catalog = { ...catalog, materials: { ...catalog.materials, [from]: target } };
  return makeSimulation(options, shifted, resources);
}

export function readShiftSettings(raw: unknown, figures: ShiftFigure[], materials: Map<string, ShiftMaterial>) {
  const state = (raw ?? {}) as RawShiftSettings;
  const sourceIds = new Set(figures.flatMap(f => f.materials));
  const from = sourceIds.has(state.from ?? "") ? state.from! : SHIFT_DEFAULTS.from;
  const to = materials.get(state.to ?? "")?.shiftable ? state.to! : SHIFT_DEFAULTS.to;
  const ids = matchingFigures(figures, from).map(f => f.id);
  const selected = state.selection;
  const selection = Array.isArray(selected) ? ids.filter(id => selected.includes(id)) : ids;
  return { from, to, selection, zoom: [1, 2, 4].includes(state.zoom ?? 0) ? state.zoom! : 2,
    compare: state.compare !== false, glow: state.glow !== false, core: state.core !== false,
    speed: [0.25, 0.5, 1, 2].includes(state.speed ?? 0) ? state.speed! : 1,
    background: /^#[0-9a-f]{6}$/i.test(state.background ?? "") ? state.background!.toLowerCase() : "#000000" };
}
