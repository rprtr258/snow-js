// The wasm noise batch (render-kernel.wat's noise export) must be a bit-exact
// replica of portal-physics's simplex3: the simulation's fast integration path
// replaces per-particle JS noise calls with one batched wasm call per step,
// and any value difference would drift positions. Two gates:
//
// 1. A fuzz of the primitive itself: batched wasm noise vs JS simplex3,
//    compared bitwise (sign of zero included) over random, grid and lattice-
//    edge inputs.
// 2. The full integration: two identical fast-path simulations stepped in
//    lockstep, one with the wasm batch wired (as ViewerRuntime.restart does),
//    one without — pools must stay bit-identical, proving the pre-pass reads
//    the same pre-step state and aligns lanes with the compaction loop.
import { expect, test } from "bun:test";
import { RenderKernel } from "./render-kernel";
import { RENDER_KERNEL_WASM } from "./render-kernel-wasm";
import { NoitaRandom, PortalSimulation, simplex3, SIMPLEX_GRADIENTS } from "./portal-physics";
import type { Particle } from "./types";
const kernel = new RenderKernel(
  new WebAssembly.Module(Buffer.from(RENDER_KERNEL_WASM, "base64")),
);

// Deterministic fuzz inputs (a failure must reproduce).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("wasm noise batch is bit-identical to JS simplex3", () => {
  // Sanity on the shared tables first: the host copies these into wasm
  // memory, so a mismatch here would shift every gradient.
  expect(SIMPLEX_GRADIENTS.length).toBe(12);
  for (const g of SIMPLEX_GRADIENTS) expect(g.length).toBe(3);

  const random = mulberry32(0xc0ffee);
  const inputs: number[][] = [];
  // Random coverage across the noise's meaningful range.
  for (let i = 0; i < 60000; i++)
    inputs.push([
      (random() * 2 - 1) * 1000,
      (random() * 2 - 1) * 1000,
      random() * 100,
    ]);
  // Grid + lattice-edge probes: integers, halves, ±ulp offsets, ±0.
  for (let ix = -8; ix <= 8; ix++)
    for (const frac of [0, 0.25, 0.5, 0.75, 5e-17, -5e-17, 1e-9, -1e-9]) {
      const x = ix + frac;
      inputs.push([x, ix + 0.5, ix / 3]);
      inputs.push([ix / 3, x, -ix - frac]);
      inputs.push([x, x, x]);
      inputs.push([-0, x, ix]);
      inputs.push([x, -0, 0]);
    }

  const n = inputs.length;
  const ax = new Float64Array(n),
    ay = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ax[i] = inputs[i]![0];
    ay[i] = inputs[i]![1];
  }
  const time = 123.456;
  const out = kernel.noiseAngles(ax, ay, n, time);
  expect(out.length).toBe(n);
  expect(bits(out)).toBe(bitsOf(ax.map((x, i) => simplex3(x, ay[i]!, time))));
  // A second z value reuses the instance across a scratch re-layout.
  const time2 = 0.0166 * 97;
  const out2 = kernel.noiseAngles(ax, ay, n, time2);
  expect(bits(out2)).toBe(bitsOf(ax.map((x, i) => simplex3(x, ay[i]!, time2))));
  // Odd n exercises the scalar tail of the f64x2 pair walk; tiny n covers
  // zero-pair edge cases (1, 3). Even n is covered by the full run above.
  for (const m of [1, 3, n - 1]) {
    const sub = kernel.noiseAngles(ax, ay, m, time);
    expect(bits(sub)).toBe(bitsOf(ax.slice(0, m).map((x, i) => simplex3(x, ay[i]!, time))));
  }
});

const bitScratch = new Float64Array(1);
const bitView = new BigUint64Array(bitScratch.buffer);

function bits(values: Float64Array): string {
  const view = new BigUint64Array(values.buffer, values.byteOffset, values.length);
  let key = "";
  for (let i = 0; i < view.length; i++) key += view[i]!.toString(16) + ",";
  return key;
}

function bitsOf(values: ArrayLike<number>): string {
  let key = "";
  for (let i = 0; i < values.length; i++) {
    bitScratch[0] = values[i]!;
    key += bitView[0]!.toString(16) + ",";
  }
  return key;
}

// The meditation page's replay (src/meditation.ts) at density 1: same
// emitters, lifetimes and fast branches as the page, with a pool small enough
// for a few hundred lockstep steps.
function meditationReplay() {
  return {
    worldSeed: 1,
    x: 0,
    y: 0,
    startFrame: 0,
    effect: "meditation",
    mathTrailScale: 3,
    minTrailLifetime: 3.5,
    ambientRing: false,
    density: 1,
    retainInvisible: false,
    fastParticles: true,
    cullInvisible: true,
    particleMirror: true,
  };
}

// Every field the integration touches, keyed bit-exactly (Object.is keeps -0
// distinct from 0; flags and meta round-trip through their string form).
function particleKey(p: Particle): string {
  let key = "";
  for (const field of [
    "x", "y", "prevX", "prevY", "vx", "vy", "gx", "gy", "friction",
    "life", "maxLife", "age", "alpha", "fadeRate", "airflowForce",
    "airflowScale", "targetX", "targetY", "attractor", "onGrid",
    "drawLong", "kernelMeta",
  ] as const) {
    const value = p[field];
    key +=
      typeof value === "number"
        ? ((bitScratch[0] = value), bitView[0]!.toString(16))
        : String(value);
    key += ",";
  }
  return key;
}

function poolKey(sim: PortalSimulation): string {
  let key = `${sim.particles.length}:${sim.totalEmitted}:${sim.dropped}:${sim.visibleCount}|`;
  for (const p of sim.particles) key += particleKey(p);
  return key;
}

test(
  "fast-path sims stay bit-identical with the wasm batch wired",
  () => {
    const replay = meditationReplay();
    const reference = new PortalSimulation({ ...replay });
    const batched = new PortalSimulation({ ...replay });
    batched.airflowBatch = (ax, ay, n, time) => kernel.noiseAngles(ax, ay, n, time);

    for (let step = 1; step <= 200; step++) {
      reference.step();
      batched.step();
      if (step % 100 === 0) {
        const refKey = poolKey(reference);
        expect(refKey).toBe(poolKey(batched));
        expect(reference.particles.length).toBeGreaterThan(0);
      }
    }
    // The reference replay must be reproducible across runs (the comparison
    // above is only meaningful if the baseline itself is stable).
    const again = new PortalSimulation({ ...replay });
    for (let step = 0; step < 200; step++) again.step();
    expect(poolKey(again)).toBe(poolKey(reference));

    // The batch view is transient: a later call with a different size must not
    // be poisoned by the previous one's memory layout.
    const rng = new NoitaRandom(7);
    const probe = new Float64Array(4096);
    for (let i = 0; i < probe.length; i++) probe[i] = rng.float(-500, 500);
    const out = kernel.noiseAngles(probe, probe, probe.length, 1);
    for (let i = 0; i < probe.length; i++)
      expect(out[i]).toBe(simplex3(probe[i]!, probe[i]!, 1));
  },
  30000,
);
