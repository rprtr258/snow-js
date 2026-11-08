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
export const SHIFT_DEFAULTS = Object.freeze({ from: "spark_purple", to: "gold", zoom: 2, compare: true, background: "#000000" });
export function shiftFigures(catalog: Catalog, shiftData: ShiftData): ShiftFigure[] {
  return [
    ...Object.entries(EFFECTS).map(([id, data]) => ({ id, ...data, group: "Portals", materials: ["spark_purple"] })),
    ...Object.entries({ ...catalog.effects, ...shiftData.effects }).filter(([, d]) => !d.imageEmitter).map(([id, data]) => ({
      id, ...data, group: data.group === "shields" ? "Shields · idle particles" : data.group === "images" ? "Image effects" : "Objects",
      materials: [...new Set(data.emitters.map(e => e.material))],
    })),
  ];
}
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
    // color/cellType feed the cached kernel meta word (Particle.kernelMeta);
    // they changed, so the cache must recompute on the next staging.
    p.kernelMeta = undefined;
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
