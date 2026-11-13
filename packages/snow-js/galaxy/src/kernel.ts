// Host for the galaxy wasm kernel (src/render-kernel.wat, built by the
// package-level scripts/build-render-kernel.ts into the binary committed at
// static/assets/render-kernel.wasm). The kernel owns the framebuffer memory:
// the effect wraps offset 0 in an ImageData for putImageData, so the fade
// and the particle walk never cross the JS/wasm boundary. Fails soft (null)
// when fetch or WebAssembly is unavailable; the effect falls back to its JS
// loop.
export type Kernel = {
  mem: WebAssembly.Memory,
  fade: (len: number, fade: number) => void,
  draw: (w: number, h: number, particles: number, steps: number, time: number, seed: number) => void,
};

export const LUT_BASE = 67108864;
const GAIN_OFFSETS = [65536, 65792, 66048];

// cos over [0, 2.4), sin over [0, 1.6): the chaotic map's trig arguments
// stay strictly inside these ranges (cos arg < 2.3, sin arg < 1.5).
const COS_N = 8192;
const COS_MAX = 2.4;
const SIN_MAX = 1.6;

const cosLut = new Float32Array(COS_N);
const sinLut = new Float32Array(COS_N);
for (let i = 0; i < COS_N; i++) {
  cosLut[i] = Math.cos((i / COS_N) * COS_MAX);
  sinLut[i] = Math.sin((i / COS_N) * SIN_MAX);
}

// 256-entry per-channel map: clamp(round-half-even(v + gain)) — exactly what
// a single `clampedArray[i] += gain` hit computes. Must be a clamped array:
// a plain Uint8Array would wrap values above 255 instead of clamping.
function gainMap(gain: number): Uint8ClampedArray {
  const map = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++)
    map[v] = v + gain;
  return map;
}

// Uploads the per-channel gains for a color option value; call again
// whenever the option changes.
export function setGains(kernel: Kernel, rgb: readonly [number, number, number]): void {
  const [r, g, b] = rgb;
  const gains = [gainMap(r), gainMap(g), gainMap(b)];
  for (let i = 0; i < 3; i++)
    new Uint8Array(kernel.mem.buffer, LUT_BASE + GAIN_OFFSETS[i], 256).set(gains[i]);
}

export async function loadKernel(): Promise<Kernel | null> {
  try {
    const response = await fetch(new URL("../static/assets/render-kernel.wasm", import.meta.url));
    if (!response.ok)
      return null;
    const instance = new WebAssembly.Instance(
      await WebAssembly.compile(await response.arrayBuffer()),
      {},
    );
    // WebAssembly types exports as an unindexed interface; render-kernel.wat
    // declares exactly these exports.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const kernel = instance.exports as Kernel;
    new Float32Array(kernel.mem.buffer, LUT_BASE, COS_N).set(cosLut);
    new Float32Array(kernel.mem.buffer, LUT_BASE + COS_N * 4, COS_N).set(sinLut);
    return kernel;
  } catch {
    return null;
  }
}
