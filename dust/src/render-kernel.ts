// Host for the wasm blend kernel (src/render-kernel.wat, built by
// scripts/build-render-kernel.ts into src/render-kernel-wasm.ts). The kernel
// walks the simulation's staged particle columns as f64x2 pairs and blends
// every visible particle into the scene, byte-identical to the JS blend loop
// in SoftwareRenderer.render (verified by scripts/proto-render-kernel.ts and
// enforced per-run by `bun scripts/render-diff.ts --kernel`).
//
// This module owns the WebAssembly.Memory the kernel draws into: the
// renderer's scene buffer becomes a view onto wasm memory (layout
// `[scene | pad→8 | xs | ys | as | meta]`), so the per-particle blend needs no
// scene copy in either direction. memory.grow preserves existing bytes, so a
// grow to fit larger staging only detaches the JS views, which the renderer
// rewraps; the scene contents survive.
//
// The same binary also exports `noise`: a bit-exact wasm port of
// portal-physics's simplex3, run as one batch call per simulation step
// (advanceParticles's fast path). It executes on a second instance with its
// own memory — the blend instance's memory is the renderer's scene canvas,
// and growing for noise scratch must never detach those views.
import { SIMPLEX_PERMUTATION, SIMPLEX_GRADIENTS } from "./portal-physics";
import { RENDER_KERNEL_WASM } from "./render-kernel-wasm";

// Kernel meta word layout (see render-kernel.wat): bits 0-2 flags
// (bit0 onGrid === false, bit1 drawLong, bit2 wide), bits 8-31 color as
// (r << 24) | (g << 16) | (b << 8), where r/g/b decode from the packed color
// exactly like SoftwareRenderer's rgb() (r = packed >>> 16 & 255).
export type ParticleMeta = {
  xs: Float64Array;
  ys: Float64Array;
  as: Float64Array;
  meta: Uint32Array;
  n: number;
};

type BlendExport = (
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

type NoiseExport = (
  axPtr: number,
  ayPtr: number,
  outPtr: number,
  n: number,
  time: number,
) => void;

// Noise-instance layout (must match render-kernel.wat's $simplexCorner
// loads): doubled permutation (2 × 256 bytes) at 0, 12 gradients × 3 f64 at
// 512, host scratch (ax | ay | out) after the tables.
const NOISE_GRAD_BYTES = 512;
const NOISE_TABLE_BYTES = 800;

// Compiles the embedded kernel binary. Returns null where WebAssembly (or its
// base64 decode) is unavailable; every caller must fall back to the JS blend.
export function compileRenderKernel(): WebAssembly.Module | null {
  try {
    const base64 = atob(RENDER_KERNEL_WASM);
    const bytes = new Uint8Array(base64.length);
    for (let i = 0; i < base64.length; i++) bytes[i] = base64.charCodeAt(i);
    return new WebAssembly.Module(bytes);
  } catch {
    return null;
  }
}

export class RenderKernel {
  declare memory: WebAssembly.Memory;
  declare blend: BlendExport;
  declare capacity: number;
  declare module: WebAssembly.Module;
  declare noise: NoiseExport | null;
  declare noiseMemory: WebAssembly.Memory | null;
  constructor(module: WebAssembly.Module) {
    this.memory = new WebAssembly.Memory({ initial: 4 });
    this.module = module;
    const instance = new WebAssembly.Instance(module, { env: { mem: this.memory } });
    this.blend = instance.exports.blend as BlendExport;
    this.capacity = this.memory.buffer.byteLength;
    this.noise = null;
    this.noiseMemory = null;
  }
  // Grows the memory to fit the scene plus staging columns for n particles.
  // Returns true when the memory grew: existing typed-array views onto its
  // buffer detached and the caller must rewrap them (bytes survive).
  ensure(sceneBytes: number, n: number): boolean {
    // scene at 0, staging 8-aligned after it: xs n*8, ys n*8, as (n+1)*8
    // (odd-n pad lane), meta n*4 → 28n + 12 staging bytes.
    const need = sceneBytes + 8 + n * 28 + 12;
    if (need <= this.capacity) return false;
    const current = this.memory.buffer.byteLength;
    this.memory.grow(Math.ceil((need - current) / 65536));
    this.capacity = this.memory.buffer.byteLength;
    return true;
  }
  sceneView(sceneBytes: number) {
    return new Uint8ClampedArray(this.memory.buffer, 0, sceneBytes);
  }
  scene32View(sceneBytes: number) {
    return new Uint32Array(this.memory.buffer, 0, sceneBytes / 4);
  }
  // Copies the staged columns into the kernel memory and blends all n
  // particles (pool order preserved: the kernel walks pairs sequentially,
  // lane 0 before lane 1). Returns the kernel's skipped-particle count.
  render(
    sceneBytes: number,
    staging: ParticleMeta,
    scale: number,
    ox: number,
    oy: number,
    margin: number,
    sw: number,
    sh: number,
  ): number {
    const n = staging.n;
    const base = (sceneBytes + 7) & ~7;
    const buf = this.memory.buffer;
    new Float64Array(buf, base, n).set(staging.xs.subarray(0, n));
    new Float64Array(buf, base + n * 8, n).set(staging.ys.subarray(0, n));
    // as carries n+1 entries: the caller writes an alpha 0 pad at index n so
    // the kernel's odd-n tail lane dies on the alpha test (no scalar tail).
    const asPtr = base + n * 16;
    new Float64Array(buf, asPtr, n + 1).set(staging.as.subarray(0, n + 1));
    const metaPtr = asPtr + (n + 1) * 8;
    new Uint32Array(buf, metaPtr, n).set(staging.meta.subarray(0, n));
    return this.blend(0, base, base + n * 8, asPtr, metaPtr, n, scale, ox, oy, margin, sw, sh);
  }

  // Batch-evaluates the simulation's airflow noise (portal-physics's
  // simplex3): copies ax/ay into the noise instance's memory, runs the wasm
  // port over all n inputs at one shared z (the sim's frame time), and
  // returns a view of the raw f64 results in input order. Values are
  // bit-identical to the JS simplex3 (src/render-kernel.test.ts fuzzes both
  // this primitive and the full fast-path integration). The view is valid
  // until the next noiseAngles call (the caller walks the pool immediately).
  noiseAngles(ax: Float64Array, ay: Float64Array, n: number, time: number): Float64Array {
    if (!this.noise) {
      // Second instance of the same module with its own memory: the blend
      // instance's memory is the scene canvas, grown and rewrapped by the
      // renderer — noise scratch must not detach those views.
      this.noiseMemory = new WebAssembly.Memory({ initial: 1 });
      this.noise = (
        new WebAssembly.Instance(this.module, { env: { mem: this.noiseMemory } })
          .exports as { noise: NoiseExport }
      ).noise;
      // Tables are copied once; memory.grow preserves bytes, so later grows
      // (for scratch) keep them intact.
      const perm = new Uint8Array(512);
      for (let i = 0; i < 512; i++) perm[i] = SIMPLEX_PERMUTATION[i & 255];
      new Uint8Array(this.noiseMemory.buffer, 0, 512).set(perm);
      new Float64Array(this.noiseMemory.buffer, NOISE_GRAD_BYTES, 36).set(
        SIMPLEX_GRADIENTS.flat(),
      );
    }
    const need = NOISE_TABLE_BYTES + n * 24;
    if (this.noiseMemory!.buffer.byteLength < need)
      this.noiseMemory!.grow(
        Math.ceil((need - this.noiseMemory!.buffer.byteLength) / 65536),
      );
    const buf = this.noiseMemory!.buffer;
    const outPtr = NOISE_TABLE_BYTES + n * 16;
    // The scratch arrays are capacity-sized; copy only the live prefix.
    new Float64Array(buf, NOISE_TABLE_BYTES, n).set(ax.subarray(0, n));
    new Float64Array(buf, NOISE_TABLE_BYTES + n * 8, n).set(ay.subarray(0, n));
    this.noise!(NOISE_TABLE_BYTES, NOISE_TABLE_BYTES + n * 8, outPtr, n, time);
    return new Float64Array(buf, outPtr, n);
  }
}
