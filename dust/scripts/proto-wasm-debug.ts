// Isolates the wasm-vs-JS blend mismatch: blends single particles in isolation.
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

// assemble wasm
const tmp = mkdtempSync(join(tmpdir(), "wat-"));
writeFileSync(join(tmp, "blend.wat"), readFileSync(new URL("./proto-wat-blend.wat", import.meta.url), "utf8"));
spawnSync("wat2wasm", [join(tmp, "blend.wat"), "-o", join(tmp, "blend.wasm")], { stdio: "inherit" });
const { instance } = await WebAssembly.instantiate(readFileSync(join(tmp, "blend.wasm")));
const memory = instance.exports.mem as WebAssembly.Memory;
const blendFn = instance.exports.blend as (...a: number[]) => void;
const STAGE = 8_400_000;
const stageView = new Float64Array(memory.buffer, STAGE);
const wasmScene = new Uint8ClampedArray(memory.buffer, 0, W * H * 4);

const ox = W / 2 - sim.x * scale, oy = H / 2 - sim.y * scale;
const margin = 40 * scale;
const roundCell = (x: number) => Math.floor(x + (x >= 0 ? 0.5 : -0.5));
const c = [68, 180, 60];

function jsBlendOne(p: typeof particles[0], scene: Uint8ClampedArray) {
  const alpha = Math.trunc(p.alpha * 255) & 255;
  if (alpha === 0) return;
  const bx = ((p.onGrid === false ? p.x : roundCell(p.x + 0.5)) - 1) * scale + ox,
    by = ((p.onGrid === false ? p.y : roundCell(p.y + 0.5)) - 1) * scale + oy,
    a = alpha / 255, inv = 1 - a,
    r = c[0] * a, g = c[1] * a, b = c[2] * a;
  let x0 = Math.ceil(bx - 0.5), x1 = Math.ceil(bx + 0.5),
    y0 = Math.ceil(by - 0.5), y1 = Math.ceil(by + 0.5);
  if (x0 < 0 || x1 > W || y0 < 0 || y1 > H) {
    x0 = Math.max(0, x0); x1 = Math.min(W, x1); y0 = Math.max(0, y0); y1 = Math.min(H, y1);
  }
  for (let py = y0; py < y1; py++)
    for (let px = x0; px < x1; px++) {
      const i4 = (py * W + px) * 4;
      scene[i4] = r + scene[i4] * inv;
      scene[i4 + 1] = g + scene[i4 + 1] * inv;
      scene[i4 + 2] = b + scene[i4 + 1] * inv;
    }
}

// find mismatching particles one at a time
let checked = 0, mismatches = 0, shown = 0;
const jsScene = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < particles.length; i++) {
  const p = particles[i];
  if (p.drawLong) continue;
  const x = p.x * scale + ox, y = p.y * scale + oy;
  if (x < -margin || x > W + margin || y < -margin || y > H + margin) continue;

  jsScene.fill(0);
  jsBlendOne(p, jsScene);

  wasmScene.fill(0, 0, W * H * 4);
  stageView[0] = p.x;
  stageView[1] = p.y;
  stageView[2] = p.alpha;
  stageView[3] = p.onGrid === false ? 0 : 1;
  blendFn(STAGE, 1, scale, ox, oy, margin, W, H, 0);
  if (i === 0) {
    const dbgFn = instance.exports.dbg as (...a: number[]) => number[];
    const [bx, by, af, r, g, b, inv] = dbgFn(STAGE, scale, ox, oy);
    const rcx = roundCell(p.x + 0.5), rcy = roundCell(p.y + 0.5);
    const jbx = ((p.onGrid === false ? p.x : rcx) - 1) * scale + ox;
    const jby = ((p.onGrid === false ? p.y : rcy) - 1) * scale + oy;
    const ja = 1 / 255;
    console.log(`dbg  bx=${bx} by=${by} af=${af} r=${r} g=${g} b=${b} inv=${inv}`);
    console.log(`js   bx=${jbx} by=${jby} af=${ja} r=${68*ja} g=${180*ja} b=${60*ja} inv=${1-ja}`);
  }

  let bad = -1;
  for (let k = 0; k < jsScene.length; k++) {
    if (jsScene[k] !== wasmScene[k]) { bad = k; break; }
  }
  // dump every non-zero wasm byte for this single-particle frame
  if (i === 0) {
    const hits: number[] = [];
    for (let k = 0; k < jsScene.length; k++) if (wasmScene[k] !== 0) hits.push(k);
    console.log("wasm non-zero bytes:", hits.slice(0, 12).map((k) => `${k}(ch${k % 4},px${(k / 4) % W | 0},py${((k / 4 / W) | 0)})=${wasmScene[k]}`).join(" "));
    const hits2: number[] = [];
    for (let k = 0; k < jsScene.length; k++) if (jsScene[k] !== 0) hits2.push(k);
    console.log("js   non-zero bytes:", hits2.slice(0, 12).map((k) => `${k}(ch${k % 4},px${(k / 4) % W | 0},py${((k / 4 / W) | 0)}): ${jsScene[k]}`).join(" "));
  }
  checked++;
  if (bad >= 0) {
    mismatches++;
    if (shown < 4) {
      shown++;
      const px = (bad / 4) % W, py = (bad / 4 / W) | 0;
      const alpha = Math.trunc(p.alpha * 255) & 255;
      console.log(
        `particle #${i} onGrid=${p.onGrid} x=${p.x} y=${p.y} alpha=${p.alpha} α8=${alpha}`,
      );
      console.log(`  first bad byte ${bad} (px=${px},py=${py},ch=${bad % 4}): js=${jsScene[bad]} wasm=${wasmScene[bad]}`);
    }
    if (mismatches >= 20) break;
  }
}
console.log(`checked=${checked} mismatches=${mismatches}`);
