// Per-frame CPU cost of the fullscreen meditation page (meditation.html):
// its worker runs sim.step() + renderer.render(sim, {core, glow:false, ...},
// advance=true) per 60 Hz frame. Prints stage timings and pool size at the
// requested device resolution (default 1920×1080, the plan's baseline point).
//
// Usage:
//   bun scripts/bench-meditation.ts [--width 1920] [--height 1080]
//       [--warmup 400] [--measure 60] [--exact | --fast] [--kernel]
// The default measures the page's current configuration (fastParticles: true
// since the fast path was enabled there); --exact forces the fround reference
// for A/B comparison; --kernel also hands the renderer the wasm blend kernel
// (particleMirror staging is always on in the replay), isolating the
// kernel path's render gain at this page's exact configuration.
import {
  buildRenderer,
  buildSimulation,
  loadHarness,
  meditationReplay,
  MEDITATION_RENDER,
} from "./harness-common";
import { fullscreenView } from "../src/render-resolution";

function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

const width = numArg("width", 1920),
  height = numArg("height", 1080),
  warmup = numArg("warmup", 400),
  measure = numArg("measure", 60),
  fast = process.argv.includes("--exact") ? false : true,
  kernel = process.argv.includes("--kernel");

const harness = loadHarness();
const view = fullscreenView(width, height, 1);
const sim = buildSimulation(harness, meditationReplay(width, height, fast));
const renderer = buildRenderer(harness, width, height, view.scale, kernel ? harness.renderKernelModule : null);

for (let i = 0; i < warmup; i++) {
  sim.step();
  renderer.render(sim, MEDITATION_RENDER, true, null);
}

let stepMs = 0,
  renderMs = 0;
for (let i = 0; i < measure; i++) {
  const t0 = performance.now();
  sim.step();
  const t1 = performance.now();
  renderer.render(sim, MEDITATION_RENDER, true, null);
  const t2 = performance.now();
  stepMs += t1 - t0;
  renderMs += t2 - t1;
}

const stepAvg = stepMs / measure,
  renderAvg = renderMs / measure;
console.log(
  `meditation ${width}x${height} scale=${view.scale.toFixed(3)} ` +
    `density=${(view.scale * 2).toFixed(2)} fast=${fast} kernel=${kernel} ` +
    `particles=${sim.particles.length}`,
);
console.log(
  `step=${stepAvg.toFixed(2)}ms render=${renderAvg.toFixed(2)}ms ` +
    `total=${(stepAvg + renderAvg).toFixed(2)}ms ` +
    `(~${(1000 / (stepAvg + renderAvg)).toFixed(0)} fps CPU)`,
);
