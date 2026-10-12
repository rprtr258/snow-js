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
  constructor(module: WebAssembly.Module) {
    this.memory = new WebAssembly.Memory({ initial: 4 });
    const instance = new WebAssembly.Instance(module, { env: { mem: this.memory } });
    this.blend = instance.exports.blend as BlendExport;
    this.capacity = this.memory.buffer.byteLength;
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
}
