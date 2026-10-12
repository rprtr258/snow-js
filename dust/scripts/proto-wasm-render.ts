// Benchmarks a hand-written WAT blend kernel against the JS lean-particle
// loop at 1920×1080 and verifies byte-exactness of the wasm render.
// Usage: bun scripts/proto-wasm-render.ts  (assembles .wat via wat2wasm)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { decodeAssets, makeSimulation } from "../src/effect-simulation";
import { fullscreenView } from "../src/render-resolution";
import type { Catalog, Resources, SimulationOptions } from "../src/types";

const ROOT = new URL("..", import.meta.url).pathname;
const catalog: Catalog = JSON.parse(readFileSync(`${ROOT}dist/assets/effects.json`, "utf8"));
const bin = readFileSync(`${ROOT}dist/assets/effects.bin`);
const resources: Resources = decodeAssets(catalog, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

function replay(width: number, height: number): SimulationOptions {
  const { scale } = fullscreenView(width, height, 1);
  return {
    worldSeed: 0, x: 0, y: 0, startFrame: 0, effect: "meditation",
    mathTrailScale: 3, minTrailLifetime: 3.5, ambientRing: false,
    density: scale * 2, retainInvisible: false, fastParticles: true, cullInvisible: true,
  };
}

const W = 1920, H = 1080;
const { scale } = fullscreenView(W, H, 1);
const sim = makeSimulation(replay(W, H), catalog, resources);
for (let i = 0; i < 600; i++) sim.step();
const particles = sim.particles;
console.log(`pool=${particles.length}`);

// ---- assemble the wat
const tmp = mkdtempSync(join(tmpdir(), "wat-"));
const watPath = join(tmp, "blend.wat"), wasmPath = join(tmp, "blend.wasm");
writeFileSync(watPath, readFileSync(new URL("./proto-wat-blend.wat", import.meta.url), "utf8"));
spawnSync("wat2wasm", [watPath, "-o", wasmPath], { stdio: "inherit" });
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath));
const memory = instance.exports.mem as WebAssembly.Memory;
const blendFn = instance.exports.blend as (s: number, n: number, sc: number, ox: number, oy: number, m: number, sw: number, sh: number, ns: number) => void;

const STAGE = 8_400_000;
const stageView = new Float64Array(memory.buffer, STAGE);
const wasmScene = new Uint8ClampedArray(memory.buffer, 0, W * H * 4);

// pack: objects → wasm-memory staging [x, y, alpha, onGridFalse?0:1] per particle
function pack2() {
  let j = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.drawLong) continue;
    stageView[j] = p.x;
    stageView[j + 1] = p.y;
    stageView[j + 2] = p.alpha;
    stageView[j + 3] = p.onGrid === false ? 0 : 1;
    j += 4;
  }
  return j / 4;
}

// ---- JS reference loop (exact lean-path arithmetic from software-renderer.ts)
const ox = W / 2 - sim.x * scale, oy = H / 2 - sim.y * scale;
const margin = 40 * scale;
const jsScene = new Uint8ClampedArray(W * H * 4);
const f = (x: number) => x; // renderer's f is the identity
const roundCell = (x: number) => Math.floor(x + (x >= 0 ? 0.5 : -0.5));
const c = [68, 180, 60];

function jsRender(scene: Uint8ClampedArray) {
  const sceneWidth = W, sceneHeight = H;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.alpha <= 0) continue;
    const x = p.x * scale + ox, y = p.y * scale + oy;
    if (x < -margin || x > sceneWidth + margin || y < -margin || y > sceneHeight + margin) continue;
    if (p.drawLong) continue;
    const alpha = Math.trunc(p.alpha * 255) & 255;
    if (alpha > 0) {
      const bx = ((p.onGrid === false ? p.x : roundCell(p.x + 0.5)) - 1) * scale + ox,
        by = ((p.onGrid === false ? p.y : roundCell(p.y + 0.5)) - 1) * scale + oy,
        a = alpha / 255,
        inv = 1 - a,
        r = c[0] * a, g = c[1] * a, b = c[2] * a;
      let x0 = Math.ceil(bx - 0.5), x1 = Math.ceil(bx + 0.5),
        y0 = Math.ceil(by - 0.5), y1 = Math.ceil(by + 0.5);
      if (x0 < 0 || x1 > sceneWidth || y0 < 0 || y1 > sceneHeight) {
        x0 = x0 < 0 ? 0 : x0; x1 = x1 > sceneWidth ? sceneWidth : x1;
        y0 = y0 < 0 ? 0 : y0; y1 = y1 > sceneHeight ? sceneHeight : y1;
      }
      for (let py = y0; py < y1; py++)
        for (let px = x0; px < x1; px++) {
          const i4 = (py * sceneWidth + px) * 4;
          scene[i4] = r + scene[i4] * inv;
          scene[i4 + 1] = g + scene[i4 + 1] * inv;
          scene[i4 + 2] = b + scene[i4 + 1] * inv;
        }
    }
  }
}

// ---- clear + warm
const clear32 = new Uint32Array(jsScene.buffer);
const clear32w = new Uint32Array(memory.buffer, 0, W * H);
const reps = 60;

// correctness: one frame, byte-compare
clear32.fill(0xff000000); jsRender(jsScene);
clear32w.fill(0xff000000);
const n = pack2();
blendFn(STAGE, n, scale, ox, oy, margin, W, H, 0);
let diff = 0;
for (let i = 0; i < jsScene.length; i++) if (jsScene[i] !== wasmScene[i]) diff++;
console.log(diff === 0 ? "byte-exact: wasm blend matches JS lean loop" : `MISMATCH: ${diff} bytes differ`);

// timings
const n0 = n;
let t = performance.now();
for (let r = 0; r < reps; r++) { clear32.fill(0xff000000); jsRender(jsScene); }
const jsLoop = (performance.now() - t) / reps;

t = performance.now();
for (let r = 0; r < reps; r++) pack2();
const packMs = (performance.now() - t) / reps;

t = performance.now();
for (let r = 0; r < reps; r++) { clear32w.fill(0xff000000); blendFn(STAGE, n0, scale, ox, oy, margin, W, H, 0); }
const wasmLoop = (performance.now() - t) / reps;

// math+cull only (nostore=1): upper bound of what SIMD could attack
let t2 = performance.now();
for (let r = 0; r < reps; r++) blendFn(STAGE, n0, scale, ox, oy, margin, W, H, 1);
const wasmMath = (performance.now() - t2) / reps;

// SoA pack bound: sim already in Float64Arrays → memcpy into wasm memory
const srcX = new Float64Array(n0), srcY = new Float64Array(n0), srcA = new Float64Array(n0), srcG = new Uint8Array(n0);
for (let i = 0; i < n0; i++) { srcX[i] = Math.random() * 1920; srcY[i] = Math.random() * 1080; srcA[i] = Math.random(); }
const memX = new Float64Array(memory.buffer, STAGE, n0);
const memY = new Float64Array(memory.buffer, STAGE + n0 * 8, n0);
const memA = new Float64Array(memory.buffer, STAGE + n0 * 16, n0);
t2 = performance.now();
for (let r = 0; r < reps; r++) { memX.set(srcX); memY.set(srcY); memA.set(srcA); }
const soaPack = (performance.now() - t2) / reps;

console.log(`JS lean loop (objects→scene)     : ${jsLoop.toFixed(2)}ms`);
console.log(`JS pack objects→wasm staging     : ${packMs.toFixed(2)}ms`);
console.log(`SoA pack (3× typed-array set)    : ${soaPack.toFixed(2)}ms`);
console.log(`wasm kernel (clear inside loop)  : ${wasmLoop.toFixed(2)}ms`);
console.log(`wasm math+cull only, no stores   : ${wasmMath.toFixed(2)}ms  (stores+culls = ${(wasmLoop - wasmMath).toFixed(2)}ms)`);
console.log(`wasm path total (pack+kernel)    : ${(packMs + wasmLoop).toFixed(2)}ms vs JS ${(jsLoop + 0.33).toFixed(2)}ms (loop+clear)`);
