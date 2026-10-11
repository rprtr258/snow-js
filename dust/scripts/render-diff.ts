// Render-diff harness for the meditation fast-particle plan. The exact path
// (fastParticles off) is the byte-exact reference; the fast path may drift
// within the gates below but must never change RNG, emission counts or
// lifetimes. Modes:
//
//   bun scripts/render-diff.ts [--drift]
//       Renders the meditation config at the preview resolution twice in one
//       build (exact as reference, fast opt-in) and enforces the drift gates:
//       mean |ΔRGB| ≤ 2, p99.9 ≤ 16, differing/lit-pixel counts within 1 %,
//       identical per-frame emission counts for the first 1000 frames.
//   bun scripts/render-diff.ts --exact-regression <baseline.json>
//       (--against is an alias.) Renders the exact path and requires every
//       frame hash to match the baseline snapshot byte-for-byte.
//   bun scripts/render-diff.ts --update-baseline <baseline>
//       (Re)records the baseline snapshot.
//
// Every run also asserts the output alpha plane stays 255 (meditation and a
// math_penrose glow-on scenario) and hashes one export-loops.json
// GIF-consumer frame — GIF export must stay byte-exact.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  buildRenderer,
  buildSimulation,
  hashPixels,
  loadHarness,
  meditationReplay,
  MEDITATION_RENDER,
  type Harness,
} from "./harness-common";
import {
  fullscreenView,
  PREVIEW_RENDER_HEIGHT,
  PREVIEW_RENDER_WIDTH,
} from "../src/render-resolution";
import { ViewerRuntime } from "../src/viewer-runtime";
import type { LoopCatalog } from "../src/export-loop-plans";

const DRIFT_FRAMES = 600; // rendered frames compared for drift
const EMISSION_FRAMES = 1000; // emission-count identity window
const MATH_FRAMES = 60; // math_penrose glow-on spot check
const DEFAULT_BASELINE = "scripts/fixtures/meditation-baseline.json";
const ROOT = new URL("..", import.meta.url).pathname;

type Baseline = {
  meta: {
    width: number;
    height: number;
    frames: number;
    exportSteps: number;
    mathEffect: string;
    mathFrames: number;
    generator: string;
  };
  frameHashes: string[];
  exportLoopHash: string;
  mathHashes: string[];
};

function fileArg(fallback: string): string {
  const i = process.argv.indexOf("--update-baseline");
  const j = process.argv.indexOf("--exact-regression");
  const k = process.argv.indexOf("--against");
  const index = Math.max(i, j, k);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

// Baseline paths are repo-root-relative (scripts run from the repo root).
function fixtureUrl(path: string): URL {
  return new URL(`../${path}`, import.meta.url);
}

// export-loops.json meditation recipe, speed 1, first recorded match
// ([period, offset, score]); the GIF consumer loops from `offset` for
// `period` frames, so the spot-check frame is offset + period.
function exportLoopSteps(): number {
  const loops: LoopCatalog = JSON.parse(
    readFileSync(new URL("../dist/assets/export-loops.json", import.meta.url), "utf8"),
  );
  const match = loops.recipes.meditation.matches["1"]?.[0];
  if (!match) throw new Error("export-loops.json: no meditation match for speed 1");
  return match[1] + match[0];
}

// One GIF-consumer frame through the real preview runtime (ViewerRuntime:
// the path gif-renderer.ts drives), default preview options (core+glow on).
function consumerFrameHashes(
  harness: Harness,
  effect: string,
  steps: number,
): { hashes: string[]; alphaBad: number } {
  const runtime = new ViewerRuntime(
    harness.catalog,
    harness.buffer,
    PREVIEW_RENDER_WIDTH,
    PREVIEW_RENDER_HEIGHT,
    harness.kernelModule,
    { scale: 1 },
  );
  runtime.restart({ effect });
  const hashes: string[] = [];
  let alphaBad = 0;
  for (let i = 0; i < steps; i++) {
    const pixels = runtime.frame({ step: true }).pixels;
    if (!pixels) throw new Error(`${effect}: frame ${i + 1}/${steps} produced no pixels`);
    const result = hashPixels(pixels);
    hashes.push(result.hash);
    alphaBad += result.alphaBad;
  }
  return { hashes, alphaBad };
}

// The exact-path run everything is compared against: DRIFT_FRAMES meditation
// frames, the export-loop GIF-consumer frame, and MATH_FRAMES math_penrose
// frames (glow on, exercising the compose/sprite paths the page skips).
function recordExactRun(harness: Harness): {
  frameHashes: string[];
  exportLoopHash: string;
  mathHashes: string[];
  alphaBad: number;
} {
  const width = PREVIEW_RENDER_WIDTH,
    height = PREVIEW_RENDER_HEIGHT;
  const { scale } = fullscreenView(width, height, 1);
  const sim = buildSimulation(harness, meditationReplay(width, height, false));
  const renderer = buildRenderer(harness, width, height, scale);
  const frameHashes: string[] = [];
  let alphaBad = 0;
  for (let frame = 0; frame < DRIFT_FRAMES; frame++) {
    sim.step();
    const pixels = renderer.render(sim, MEDITATION_RENDER, true, null);
    const result = hashPixels(pixels);
    alphaBad += result.alphaBad;
    frameHashes.push(result.hash);
  }
  const exportLoop = consumerFrameHashes(harness, "meditation", exportLoopSteps());
  const math = consumerFrameHashes(harness, "math_penrose", MATH_FRAMES);
  return {
    frameHashes,
    exportLoopHash: exportLoop.hashes[exportLoop.hashes.length - 1],
    mathHashes: math.hashes,
    alphaBad: alphaBad + exportLoop.alphaBad + math.alphaBad,
  };
}

// ---- drift mode -----------------------------------------------------------

type FrameDrift = {
  mean: number; // mean |ΔRGB| over channel samples
  p999: number; // 99.9th percentile of per-pixel max-channel |Δ|
  diffPixels: number; // pixels with any channel delta > 0
  litDelta: number; // |lit(exact) - lit(fast)| / lit(exact)
};

function compareFrames(a: Uint8ClampedArray, b: Uint8ClampedArray): FrameDrift {
  const histogram = new Int32Array(256);
  let sum = 0,
    diffPixels = 0,
    litA = 0,
    litB = 0;
  const pixelCount = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== 255 || b[i + 3] !== 255) throw new Error("output alpha plane is not 255");
    const da = Math.abs(a[i] - b[i]),
      db = Math.abs(a[i + 1] - b[i + 1]),
      dc = Math.abs(a[i + 2] - b[i + 2]);
    const worst = da > db ? (da > dc ? da : dc) : db > dc ? db : dc;
    histogram[worst]++;
    sum += da + db + dc;
    if (worst > 0) diffPixels++;
    if (a[i] | a[i + 1] | a[i + 2]) litA++;
    if (b[i] | b[i + 1] | b[i + 2]) litB++;
  }
  // Smallest v with P(max-channel |Δ| ≤ v) ≥ 0.999.
  const target = pixelCount * 0.999;
  let cumulative = 0,
    p999 = 255;
  for (let v = 0; v <= 255; v++) {
    cumulative += histogram[v];
    if (cumulative >= target) {
      p999 = v;
      break;
    }
  }
  return {
    mean: sum / (pixelCount * 3),
    p999,
    diffPixels,
    litDelta: Math.abs(litA - litB) / Math.max(1, litA),
  };
}

function runDrift(harness: Harness): boolean {
  const width = PREVIEW_RENDER_WIDTH,
    height = PREVIEW_RENDER_HEIGHT;
  const { scale } = fullscreenView(width, height, 1);
  const exact = buildSimulation(harness, meditationReplay(width, height, false));
  const fast = buildSimulation(harness, meditationReplay(width, height, true));
  const exactRenderer = buildRenderer(harness, width, height, scale);
  const fastRenderer = buildRenderer(harness, width, height, scale);
  let maxMean = 0,
    maxP999 = 0,
    maxDiffFraction = 0,
    maxLitDelta = 0,
    worstMeanFrame = 0,
    worstP999Frame = 0;
  for (let frame = 1; frame <= EMISSION_FRAMES; frame++) {
    exact.step();
    fast.step();
    if (exact.totalEmitted !== fast.totalEmitted)
      throw new Error(
        `emission count diverged at frame ${frame}: ${exact.totalEmitted} vs ${fast.totalEmitted}`,
      );
    if (exact.dropped !== fast.dropped)
      throw new Error(`dropped count diverged at frame ${frame}`);
    if (frame > DRIFT_FRAMES) continue;
    const a = exactRenderer.render(exact, MEDITATION_RENDER, true, null);
    const b = fastRenderer.render(fast, MEDITATION_RENDER, true, null);
    const drift = compareFrames(a, b);
    if (drift.mean > maxMean) {
      maxMean = drift.mean;
      worstMeanFrame = frame;
    }
    if (drift.p999 > maxP999) {
      maxP999 = drift.p999;
      worstP999Frame = frame;
    }
    maxDiffFraction = Math.max(maxDiffFraction, drift.diffPixels / (width * height));
    maxLitDelta = Math.max(maxLitDelta, drift.litDelta);
  }
  const gates: Array<[string, number, number, boolean]> = [
    [`mean |ΔRGB| (worst frame ${worstMeanFrame})`, maxMean, 2, maxMean <= 2],
    [`p99.9 |ΔRGB| (worst frame ${worstP999Frame})`, maxP999, 16, maxP999 <= 16],
    ["differing-pixel fraction", maxDiffFraction, 0.01, maxDiffFraction <= 0.01],
    ["lit-pixel-count delta", maxLitDelta, 0.01, maxLitDelta <= 0.01],
  ];
  let pass = true;
  for (const [label, value, bound, ok] of gates) {
    if (!ok) pass = false;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${label}: ${value.toPrecision(3)} (bound ${bound})`,
    );
  }
  return pass;
}

// ---- baseline modes -------------------------------------------------------

function updateBaseline(harness: Harness, path: string): boolean {
  const run = recordExactRun(harness);
  if (run.alphaBad > 0) throw new Error(`${run.alphaBad} output alpha bytes are not 255`);
  const baseline: Baseline = {
    meta: {
      width: PREVIEW_RENDER_WIDTH,
      height: PREVIEW_RENDER_HEIGHT,
      frames: DRIFT_FRAMES,
      exportSteps: exportLoopSteps(),
      mathEffect: "math_penrose",
      mathFrames: MATH_FRAMES,
      generator: "bun scripts/render-diff.ts --update-baseline",
    },
    frameHashes: run.frameHashes,
    exportLoopHash: run.exportLoopHash,
    mathHashes: run.mathHashes,
  };
  mkdirSync(new URL(".", fixtureUrl(path)).pathname, { recursive: true });
  writeFileSync(fixtureUrl(path), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`baseline written: ${path} (${run.frameHashes.length} frame hashes)`);
  return true;
}

function exactRegression(harness: Harness, path: string): boolean {
  const baseline: Baseline = JSON.parse(readFileSync(fixtureUrl(path), "utf8"));
  const meta = baseline.meta;
  if (
    meta.width !== PREVIEW_RENDER_WIDTH ||
    meta.height !== PREVIEW_RENDER_HEIGHT ||
    meta.frames !== DRIFT_FRAMES
  )
    throw new Error(
      `baseline shape mismatch: ${meta.width}x${meta.height} × ${meta.frames} frames`,
    );
  const run = recordExactRun(harness);
  if (run.alphaBad > 0) throw new Error(`${run.alphaBad} output alpha bytes are not 255`);
  let mismatches = 0;
  for (let frame = 0; frame < DRIFT_FRAMES; frame++) {
    if (run.frameHashes[frame] !== baseline.frameHashes[frame]) {
      if (mismatches < 5)
        console.log(`frame ${frame + 1}: ${run.frameHashes[frame]} ≠ ${baseline.frameHashes[frame]}`);
      mismatches++;
    }
  }
  for (const [label, actual, expected] of [
    ["export-loop frame", run.exportLoopHash, baseline.exportLoopHash],
    ...baseline.mathHashes.map((hash, i) => [`math frame ${i + 1}`, run.mathHashes[i], hash] as const),
  ]) {
    if (actual !== expected) {
      if (mismatches < 5) console.log(`${label}: ${actual} ≠ ${expected}`);
      mismatches++;
    }
  }
  console.log(
    mismatches === 0
      ? `PASS exact regression: ${DRIFT_FRAMES} meditation frames + export-loop frame + ${MATH_FRAMES} math frames byte-identical`
      : `FAIL exact regression: ${mismatches} differing frames`,
  );
  return mismatches === 0;
}

// ---- entry ----------------------------------------------------------------

const harness = loadHarness();
const baselineMode =
  process.argv.includes("--exact-regression") ||
  process.argv.includes("--against") ||
  process.argv.includes("--update-baseline");
// The unflagged default is the drift report (--drift is an explicit alias).
const ok = baselineMode
  ? process.argv.includes("--update-baseline")
    ? updateBaseline(harness, fileArg(DEFAULT_BASELINE))
    : exactRegression(harness, fileArg(DEFAULT_BASELINE))
  : runDrift(harness);
if (!ok) process.exit(1);
