import { findBodyLoop, movingBody } from "./gif-loop";
import { PortalSimulation } from "./portal-physics";

export type LoopMatch = [number, number, number];
export type LoopCatalog = {
  version: number;
  speeds: number[];
  seconds: number[];
  recipes: Record<string, {origin: number; matches: Record<string, LoopMatch[]>}>;
};
export type LoopPlan = {period: number; offset: number; score: number; source: string};
let catalogPromise: Promise<LoopCatalog | null> | undefined;
async function loopCatalog(): Promise<LoopCatalog | null> {
  if (!catalogPromise) catalogPromise = fetch(new URL("./assets/export-loops.json", import.meta.url))
    .then(r => r.ok ? r.json() : null).catch(() => null);
  return catalogPromise;
}
export function lookupLoopPlan(
  catalog: LoopCatalog | null,
  simulations: PortalSimulation[],
  origin: number,
  minimum: number,
  speed: number,
): LoopPlan | null {
  const moving = simulations.filter(movingBody);
  if (!moving.length) return { period: minimum, offset: 0, score: 0, source: "static" };
  if (catalog?.version !== 1 || moving.length !== 1) return null;
  const sim = moving[0], recipe = catalog.recipes[sim.effect];
  if (!recipe || sim.startFrame !== 0 || origin !== recipe.origin) return null;
  const index = catalog.seconds.findIndex(seconds => Math.floor(Math.round(seconds * 50) * 60 / 50 * speed + 1e-8) === minimum);
  const match = recipe.matches[speed]?.[index];
  return match ? { period: match[0], offset: match[1], score: match[2], source: "catalog" } : null;
}
export async function planExportLoop(
  simulations: PortalSimulation[],
  origin: number,
  minimum: number,
  speed: number,
  report: (completed: number, total: number) => void,
): Promise<LoopPlan | null> {
  const direct = lookupLoopPlan(null, simulations, origin, minimum, speed);
  if (direct) return direct;
  const catalog = await loopCatalog(), saved = lookupLoopPlan(catalog, simulations, origin, minimum, speed);
  if (saved) return saved;
  return { ...await findBodyLoop(simulations, origin, minimum, speed, report), source: "computed" };
}
