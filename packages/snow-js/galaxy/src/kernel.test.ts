import {readFileSync} from "node:fs";
import {join} from "node:path";
import {expect, test} from "bun:test";
import {LUT_BASE, setGains, type Kernel} from "./kernel.ts";

// The committed binary; built by the package-level scripts/build-render-kernel.ts from
// src/render-kernel.wat (CI runs check:wasm to catch staleness).
const binary = readFileSync(join(import.meta.dir, "..", "static", "assets", "render-kernel.wasm"));
const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(binary)), {});
// WebAssembly types exports as an unindexed interface; render-kernel.wat
// declares exactly these exports.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const kernel = instance.exports as Kernel;
// The tests drive the raw instance, so upload the tables exactly like
// loadKernel does — without this, lookups read zero-filled memory and the
// draw tests pass vacuously.
{
  const cosLut = new Float32Array(8192);
  const sinLut = new Float32Array(8192);
  for (let i = 0; i < 8192; i++) {
    cosLut[i] = Math.cos((i / 8192) * 2.4);
    sinLut[i] = Math.sin((i / 8192) * 1.6);
  }
  new Float32Array(kernel.mem.buffer, LUT_BASE, 8192).set(cosLut);
  new Float32Array(kernel.mem.buffer, LUT_BASE + 8192 * 4, 8192).set(sinLut);
}

// cos + sin LUTs (2 x 8192 f32) and the three 256-byte gain maps.
const TABLE_BYTES = 2 * 8192 * 4 + 3 * 256;

// Replicates the kernel's xorshift32 (i32 wraparound via |0) and its chaotic
// walk, reading the same f32 LUTs the kernel reads, so the expected hits are
// exact rather than statistical.
function referenceWalk(
  w: number,
  h: number,
  particles: number,
  steps: number,
  time: number,
  seed: number,
  hit: (index: number) => void,
): void {
  let rng = seed | 1;
  const rand01 = (): number => {
    // xorshift32, sequential steps (each XOR consumes the previous state)
    rng = (rng ^ (rng << 13)) | 0;
    rng = (rng ^ (rng >>> 17)) | 0;
    rng = (rng ^ (rng << 5)) | 0;
    return (rng >>> 8) * 2 ** -24;
  };
  const cosLut = new Float32Array(kernel.mem.buffer, LUT_BASE, 8192);
  const sinLut = new Float32Array(kernel.mem.buffer, LUT_BASE + 8192 * 4, 8192);
  const frac = (v: number): number => v - Math.floor(v);
  for (let p = 0; p < particles; p++) {
    let x = rand01();
    let y = rand01();
    for (let j = 0; j < steps; j++) {
      x = frac(time + x + cosLut[Math.trunc((y * 2.2 + x * 0.1) * (8192 / 2.4))]);
      y = frac(time * 0.3 + y + sinLut[Math.trunc(x * 1.5 * (8192 / 1.6))]);
      const px = Math.min(Math.trunc(x * w), w - 1);
      const py = Math.min(Math.trunc(y * h), h - 1);
      hit((py * w + px) * 4);
    }
  }
}

test("fade subtracts with saturation at 0 on every channel", () => {
  const source = [0, 1, 19, 20, 21, 100, 255, 3, 0, 255, 10, 200];
  const mem = new Uint8Array(kernel.mem.buffer, 0, source.length);
  const faded = source.map((v) => Math.max(0, v - 20));
  mem.set(source);
  kernel.fade(source.length, 20);
  expect([...mem]).toEqual(faded);
  mem.set(source.map((v) => Math.max(0, v - 19)));
  kernel.fade(source.length, 1);
  expect([...mem]).toEqual(faded);
});

test("fade handles lengths that are not multiples of 16", () => {
  // 28 bytes: one SIMD block plus a 12-byte scalar tail
  const len = 28;
  const mem = new Uint8Array(kernel.mem.buffer, 0, len);
  const source = new Array(len).fill(0).map((_, i) => i * 7 % 256);
  mem.set(source);
  kernel.fade(len, 30);
  expect([...mem]).toEqual(source.map((v) => Math.max(0, v - 30)));
});

test("gain maps reproduce clamped-array float-add rounding", () => {
  const mem = new Uint8Array(kernel.mem.buffer, LUT_BASE + 65536, 256);
  for (const gain of [12.75, 10.2, 39.78, 0, 255]) {
    const expected = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++)
      expected[v] = v + gain;
    setGains(kernel, [gain, 0, 0]);
    expect([...mem]).toEqual([...expected]);
  }
});

test("draw trajectory matches the JS reference implementation", () => {
  const w = 64;
  const h = 64;
  const bytes = w * h * 4;
  const steps = 500;
  const time = 0.37;
  const seed = 12345;
  const frame = new Uint8Array(kernel.mem.buffer, 0, bytes);
  frame.fill(0);
  setGains(kernel, [255, 255, 255]);
  kernel.draw(w, h, 1, steps, time, seed);

  const expectedHits = new Set<number>();
  referenceWalk(w, h, 1, steps, time, seed, (index) => {
    expectedHits.add(index);
  });
  const actualHits = new Set<number>();
  for (let i = 0; i < bytes; i += 4) {
    if (frame[i + 3] === 255)
      actualHits.add(i);
  }
  expect([...actualHits].sort((a, b) => a - b)).toEqual([...expectedHits].sort((a, b) => a - b));
});

// Full-frame reference on a non-square canvas: catches stride mistakes the
// square trajectory test cannot (a w/h swap is invisible when w == h).
test("fade+draw frames match the JS reference on non-square canvases", () => {
  const w = 200;
  const h = 53;
  const bytes = w * h * 4;
  const time = 0.37;
  const seed = 777;
  const initial = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++)
    initial[i] = (i * 37) % 256;
  const mem = new Uint8Array(kernel.mem.buffer, 0, bytes);
  mem.set(initial);
  setGains(kernel, [12.75, 12.75, 12.75]);
  kernel.fade(bytes, 20);
  kernel.draw(w, h, 5, 80, time, seed);
  const afterWasm = mem.slice();

  const ref = new Uint8ClampedArray(initial);
  for (let i = 0; i < bytes; i++)
    ref[i] -= 20;
  referenceWalk(w, h, 5, 80, time, seed, (index) => {
    ref[index] += 12.75;
    ref[index + 1] += 12.75;
    ref[index + 2] += 12.75;
    ref[index + 3] = 255;
  });
  expect([...afterWasm]).toEqual([...ref]);
});

test("draw keeps every hit inside the framebuffer and lights alpha", () => {
  const w = 7;
  const h = 5;
  const bytes = w * h * 4;
  const frame = new Uint8Array(kernel.mem.buffer, 0, bytes);
  setGains(kernel, [255, 255, 255]);
  // Out-of-range writes would corrupt the table region past LUT_BASE, so
  // checksum it after several seeds.
  const tables = new Uint8Array(kernel.mem.buffer, LUT_BASE, TABLE_BYTES).slice();
  for (const seed of [1, 2, 0x9e3779b9, 0x7fffffff]) {
    frame.fill(0);
    kernel.draw(w, h, 10, 50, 0.37, seed);
    for (let i = 0; i < bytes; i += 4) {
      // No fade ran, so untouched pixels stay exactly zero and every hit
      // carries alpha 255.
      const pixel = [...frame.slice(i, i + 4)];
      expect(pixel[3] === 255 || pixel.every((v) => v === 0)).toBe(true);
    }
  }
  expect([...new Uint8Array(kernel.mem.buffer, LUT_BASE, TABLE_BYTES)]).toEqual([...tables]);
});
