// Same-process interleaved A/B for the fullscreen meditation pipeline
// (meditation.html): two replay variants are settled and measured in ONE
// process, alternating which variant runs first each round. Machine-load
// drift and JIT/cache environment then cancel out, so the step/render deltas
// are trustworthy in a way back-to-back runs of bench-meditation.ts (or runs
// minutes apart) are not: absolute numbers there swing ±20% with background
// load. Still, run on a quiet machine; rounds average out per-round noise
// only.
//
// Usage:
//   bun scripts/ab-meditation.ts [--width 1920] [--height 1080]
//       [--warmup 700] [--frames 60] [--rounds 5]
//       [--a k=v,...] [--b k=v,...]
// Variant A defaults to the byte-exact reference path (fastParticles false,
// cullInvisible false); variant B defaults to the page's current
// configuration (fastParticles true, cullInvisible true). Overrides are
// comma-separated k=v pairs applied to the meditation replay; k must name a
// field the replay already sets (unknown keys throw — a typo would otherwise
// silently compare identical configs), v is parsed as boolean, number or
// string. Examples:
//   bun scripts/ab-meditation.ts                     # reference vs page config
//   bun scripts/ab-meditation.ts --a cullInvisible=true \
//       --b cullInvisible=false                      # cull on vs off
import {
  buildRenderer,
  buildSimulation,
  loadHarness,
  meditationReplay,
  MEDITATION_RENDER,
} from "./harness-common";
import { fullscreenView } from "../src/render-resolution";
import type { SimulationOptions } from "../src/types";

function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

const width = numArg("width", 1920),
  height = numArg("height", 1080),
  warmup = numArg("warmup", 700),
  frames = numArg("frames", 60),
  rounds = numArg("rounds", 5);

function argSpec(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function variant(spec: string): SimulationOptions {
  // The meditation replay with both opt-in perf flags off: the byte-exact
  // reference configuration everything else is measured against.
  const base = { ...meditationReplay(width, height, false), cullInvisible: false };
  const overrides: Record<string, unknown> = {};
  for (const kv of spec.split(",")) {
    if (!kv) continue;
    const eq = kv.indexOf("=");
    const key = eq < 0 ? kv : kv.slice(0, eq);
    const raw = eq < 0 ? "true" : kv.slice(eq + 1);
    if (!(key in base))
      throw new RangeError(
        `Unknown replay option "${kv}" (known: ${Object.keys(base).join(", ")})`,
      );
    if (raw === "") throw new RangeError(`Missing value in "${kv}"`);
    overrides[key] =
      raw === "true" ? true : raw === "false" ? false : Number(raw);
  }
  return { ...base, ...overrides } as SimulationOptions;
}

type Run = { sim: ReturnType<typeof buildSimulation>; renderer: ReturnType<typeof buildRenderer> };

function make(options: SimulationOptions): Run {
  return {
    sim: buildSimulation(harness, options),
    renderer: buildRenderer(harness, width, height, view.scale),
  };
}

const harness = loadHarness();
const view = fullscreenView(width, height, 1);
const runs: [string, Run][] = [
  ["A", make(variant(argSpec("a", "")))],
  ["B", make(variant(argSpec("b", "fastParticles=true,cullInvisible=true")))],
];
console.log(
  `meditation A/B ${width}x${height} scale=${view.scale.toFixed(3)} ` +
    `density=${(view.scale * 2).toFixed(2)}`,
);

// Settle both pools to steady state before any measurement.
for (let i = 0; i < warmup; i++)
  for (const [, run] of runs) {
    run.sim.step();
    run.renderer.render(run.sim, MEDITATION_RENDER, true, null);
  }

function measure({ sim, renderer }: Run) {
  let step = 0,
    render = 0;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    sim.step();
    const t1 = performance.now();
    renderer.render(sim, MEDITATION_RENDER, true, null);
    const t2 = performance.now();
    step += t1 - t0;
    render += t2 - t1;
  }
  return { step: step / frames, render: render / frames, pool: sim.particles.length };
}

const totals: Record<string, { step: number; render: number }> = {};
for (const [tag] of runs) totals[tag] = { step: 0, render: 0 };
for (let round = 0; round < rounds; round++) {
  // Alternate the within-round order so neither variant systematically pays
  // the colder-cache first spot.
  const order = round % 2 === 0 ? runs : [...runs].reverse();
  for (const [tag, run] of order) {
    const r = measure(run);
    totals[tag].step += r.step;
    totals[tag].render += r.render;
    console.log(
      `round ${round} ${tag}: pool=${r.pool} step=${r.step.toFixed(2)}ms render=${r.render.toFixed(2)}ms`,
    );
  }
}

const pct = (b: number, a: number) => `${((b / a - 1) * 100).toFixed(1)}%`;
console.log("");
for (const [tag] of runs) {
  const t = totals[tag];
  console.log(
    `AVG ${tag}: step=${(t.step / rounds).toFixed(2)}ms render=${(t.render / rounds).toFixed(2)}ms ` +
      `total=${((t.step + t.render) / rounds).toFixed(2)}ms`,
  );
}
const [aTag, bTag] = runs.map(([tag]) => tag);
const aS = totals[aTag].step / rounds,
  aR = totals[aTag].render / rounds,
  bS = totals[bTag].step / rounds,
  bR = totals[bTag].render / rounds;
console.log(
  `B vs A: step ${pct(bS, aS)}, render ${pct(bR, aR)}, total ${pct(bS + bR, aS + aR)}`,
);
