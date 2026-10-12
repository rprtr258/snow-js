// Fuzz-verify src/render-kernel.wat against a spec-faithful JS reference of
// software-renderer.ts's lean 1-2 px body blend. Byte-compares the whole
// scene after each frame across randomized configs (colors, wide, onGrid,
// drawLong, alpha boundaries, .5 coordinates, edge clamping, odd counts).
// Run: bun scripts/proto-render-kernel.ts
import { RENDER_KERNEL_WASM } from "../src/render-kernel-wasm";

function roundCell(v: number): number {
  return Math.floor(v + (v >= 0 ? 0.5 : -0.5));
}

// Reference: the exact lean blend from render() (identity f, colorOverride
// absent), reading SoA staging with the kernel's meta packing.
function jsReference(
  scene: Uint8ClampedArray,
  sw: number,
  sh: number,
  xs: Float64Array,
  ys: Float64Array,
  as: Float64Array,
  meta: Uint32Array,
  n: number,
  scale: number,
  ox: number,
  oy: number,
  margin: number,
): number {
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    const a = as[i]!;
    if (a <= 0) continue;
    const xp = x * scale + ox;
    const yp = y * scale + oy;
    if (xp < -margin || xp > sw + margin || yp < -margin || yp > sh + margin) continue;
    const m = meta[i]!;
    if ((m & 2) !== 0) {
      skipped++;
      continue;
    }
    const color = m >>> 8;
    const wide = (m & 4) !== 0;
    const width = wide ? 2 : 1;
    const alpha = Math.trunc(a * (wide ? 0.5 : 1) * 255) & 255;
    if (alpha <= 0) continue;
    const srcX = (m & 1) === 0 ? roundCell(x + 0.5) : x;
    const srcY = (m & 1) === 0 ? roundCell(y + 0.5) : y;
    const bx = (srcX - width) * scale + ox;
    const by = (srcY - 1) * scale + oy;
    const x0 = Math.ceil(bx - 0.5);
    const x1 = Math.ceil(bx + width - 0.5);
    const y0 = Math.ceil(by - 0.5);
    const y1 = Math.ceil(by + 1 - 0.5);
    const af = alpha / 255;
    const inv = 1 - af;
    const rr = ((color >>> 16) & 255) * af;
    const gg = ((color >>> 8) & 255) * af;
    const bb = (color & 255) * af;
    let cx0 = x0;
    let cx1 = x1;
    let cy0 = y0;
    let cy1 = y1;
    if (x0 < 0 || x1 > sw || y0 < 0 || y1 > sh) {
      cx0 = Math.min(sw, Math.max(0, x0));
      cx1 = Math.min(sw, Math.max(0, x1));
      cy0 = Math.min(sh, Math.max(0, y0));
      cy1 = Math.min(sh, Math.max(0, y1));
    }
    for (let py = cy0; py < cy1; py++) {
      for (let px = cx0; px < cx1; px++) {
        const i4 = (py * sw + px) * 4;
        scene[i4] = rr + scene[i4] * inv;
        scene[i4 + 1] = gg + scene[i4 + 1] * inv;
        scene[i4 + 2] = bb + scene[i4 + 2] * inv;
      }
    }
  }
  return skipped;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r = (r + Math.imul(r ^ (r >>> 7), r | 61)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const kernelBytes = Uint8Array.from(atob(RENDER_KERNEL_WASM), (c) => c.charCodeAt(0));
const kernelModule = new WebAssembly.Module(kernelBytes);
const memory = new WebAssembly.Memory({ initial: 32 });
const instance = new WebAssembly.Instance(kernelModule, { env: { mem: memory } });
const blend = instance.exports.blend as (
  scene: number,
  xs: number,
  ys: number,
  as: number,
  meta: number,
  n: number,
  scale: number,
  ox: number,
  oy: number,
  margin: number,
  sw: number,
  sh: number,
) => number;

const rand = mulberry32(0x5eed1234);
const rnd = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

const colors = [
  0x44b43c, // PURPLE body color (packed)
  0xffffff,
  0x000000,
  0x010203,
  0xfedcba,
  0x0080ff,
];

let frames = 0;
let diffs = 0;

function runFrame(sw: number, sh: number, n: number, allowDrawLong: boolean): void {
  const scale = rnd(0.5, 8);
  const margin = pick([40 * scale, 0, scale]);
  const ox = rnd(-sw * 0.7, sw * 0.7);
  const oy = rnd(-sh * 0.7, sh * 0.7);

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const as = new Float64Array(n);
  const meta = new Uint32Array(n);
  const alphaChoices = [
    0,
    0.5 / 255,
    1 / 255,
    rnd(0, 0.25),
    rnd(0.25, 0.9),
    68 / 255,
    1,
    1.2,
    -0.1,
  ];
  for (let i = 0; i < n; i++) {
    // Mix of on-grid snapped coordinates (including exact .5 boundaries) and
    // free coordinates; plus far-offscreen particles for the margin cull.
    const kind = rand();
    if (kind < 0.3) {
      xs[i] = Math.round(rnd(-2, sw / scale + 2)) - 0.5; // roundCell boundary
      ys[i] = Math.round(rnd(-2, sh / scale + 2)) - 0.5;
    } else if (kind < 0.85) {
      xs[i] = rnd(-3, sw / scale + 3);
      ys[i] = rnd(-3, sh / scale + 3);
    } else {
      xs[i] = pick([-1e4, -500, 500, 1e4, sw / scale + 0.001, -margin / scale - 1]);
      ys[i] = pick([-1e4, -500, 500, 1e4, sh / scale + 0.001, -margin / scale - 1]);
    }
    as[i] = pick(alphaChoices);
    let m = pick(colors) << 8;
    if (rand() < 0.3) m |= 1; // onGrid === false
    if (rand() < 0.15) m |= 2; // drawLong (only when allowed)
    if (rand() < 0.15) m |= 4; // wide
    meta[i] = m >>> 0;
  }
  if (!allowDrawLong) for (let i = 0; i < n; i++) meta[i]! &= ~2;

  // JS reference scene
  const ref = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < ref.length; i += 4) ref[i + 3] = 255;
  const refSkipped = jsReference(ref, sw, sh, xs, ys, as, meta, n, scale, ox, oy, margin);

  // Kernel scene in wasm memory (staging base kept 8-byte aligned)
  const sceneBytes = sw * sh * 4;
  const staging = (sceneBytes + 7) & ~7;
  const need = staging + n * 28 + 64;
  const pages = Math.ceil(need / 65536);
  if (memory.buffer.byteLength < pages * 65536) memory.grow(pages - (memory.buffer.byteLength / 65536 | 0));
  const buf = memory.buffer;
  new Uint8Array(buf, 0, sceneBytes).fill(0);
  const kAlpha = new Uint8Array(buf, 0, sceneBytes);
  for (let i = 3; i < sceneBytes; i += 4) kAlpha[i] = 255;
  new Float64Array(buf, staging, n).set(xs);
  new Float64Array(buf, staging + n * 8, n).set(ys);
  new Float64Array(buf, staging + n * 16, n + 1).set(as);
  if (n % 2 === 1) new Float64Array(buf, staging + n * 16, n + 1)[n] = 0; // pad
  new Uint32Array(buf, staging + n * 24 + 8, n).set(meta);
  const gotSkipped = blend(
    0,
    staging,
    staging + n * 8,
    staging + n * 16,
    staging + n * 24 + 8,
    n,
    scale,
    ox,
    oy,
    margin,
    sw,
    sh,
  );

  frames++;
  const got = new Uint8Array(buf, 0, sceneBytes);
  let bad = -1;
  for (let i = 0; i < sceneBytes; i++) {
    if (got[i] !== ref[i]) {
      bad = i;
      break;
    }
  }
  if (bad >= 0 || gotSkipped !== refSkipped) {
    console.log(
      `MISMATCH frame ${frames} sw=${sw} sh=${sh} n=${n} scale=${scale.toFixed(6)} ox=${ox.toFixed(4)} oy=${oy.toFixed(4)} margin=${margin.toFixed(4)} byte=${bad} skipped got=${gotSkipped} want=${refSkipped}`,
    );
    // cumulative prefix bisect: first k where rendering 0..k diverges
    let kBad = -1;
    for (let k = 1; k <= n; k++) {
      const one = new Uint8ClampedArray(sceneBytes);
      for (let j = 3; j < sceneBytes; j += 4) one[j] = 255;
      jsReference(one, sw, sh, xs.subarray(0, k) as Float64Array, ys.subarray(0, k) as Float64Array, as.subarray(0, k) as Float64Array, meta.subarray(0, k) as Uint32Array, k, scale, ox, oy, margin);
      new Uint8Array(buf, 0, sceneBytes).fill(0);
      const ka = new Uint8Array(buf, 0, sceneBytes);
      for (let j = 3; j < sceneBytes; j += 4) ka[j] = 255;
      new Float64Array(buf, staging, k).set(xs.subarray(0, k));
      new Float64Array(buf, staging + k * 8, k).set(ys.subarray(0, k));
      new Float64Array(buf, staging + k * 16, k + 1).set(as.subarray(0, k));
      if (k % 2 === 1) new Float64Array(buf, staging + k * 16, k + 1)[k] = 0;
      new Uint32Array(buf, staging + k * 24 + 8, k).set(meta.subarray(0, k));
      blend(0, staging, staging + k * 8, staging + k * 16, staging + k * 24 + 8, k, scale, ox, oy, margin, sw, sh);
      const kb = new Uint8Array(buf, 0, sceneBytes);
      let d = -1;
      for (let j = 0; j < sceneBytes; j++) {
        if (kb[j] !== one[j]) {
          d = j;
          break;
        }
      }
      if (d >= 0) {
        kBad = k;
        break;
      }
    }
    if (kBad > 0) {
      console.log(`  first diverging prefix k=${kBad}; particle k-1: x=${xs[kBad - 1]} y=${ys[kBad - 1]} a=${as[kBad - 1]} meta=0x${(meta[kBad - 1]! >>> 0).toString(16)}`);
      // neighbors
      for (let j = Math.max(0, kBad - 4); j < Math.min(n, kBad + 2); j++) {
        console.log(`    ${j}: x=${xs[j]} y=${ys[j]} a=${as[j]} meta=0x${(meta[j]! >>> 0).toString(16)}`);
      }
    }
    process.exit(1);
  }
}

const sizes: Array<[number, number]> = [
  [480, 320],
  [64, 64],
  [1, 1],
  [17, 9],
  [320, 240],
  [1920, 1080],
];
for (let f = 0; f < 400; f++) {
  const [sw, sh] = pick(sizes);
  const n = pick([0, 1, 2, 3, 5, 17, 64, 200, 511, 512, 513, 1000]);
  runFrame(sw, sh, n, true);
}
// Gate-shaped runs: no drawLong (the meditation config), many particles.
for (let f = 0; f < 60; f++) {
  runFrame(480, 320, 20000, false);
}
console.log(`render-kernel fuzz: ${frames} frames, all byte-identical`);
