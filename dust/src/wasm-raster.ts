export type RasterTexture = {rgba: Uint8Array; width: number; height: number};
export type RasterRegion = {x: number; y: number; width: number; height: number};
export type GlowTap = {x: number; y: number; r: number; g: number; b: number};
type RasterExports = {
  __heap_base: WebAssembly.Global;
  memory: WebAssembly.Memory;
  glow_quad: (...args: number[]) => void;
  color_quad: (...args: number[]) => void;
  stamp_kernel: (...args: number[]) => void;
  history_step: (...args: number[]) => void;
  composite: (...args: number[]) => void;
  blur_axis: (...args: number[]) => void;
};

// Optional accelerator. JS and WASM run the same full-resolution raster formulas.
// WebAssembly disabled/CSP-blocked? The viewer retains the pure-JS fallback.
export async function loadRasterModule(): Promise<WebAssembly.Module | null> {
  try {
    if (typeof WebAssembly === "undefined") return null;
    const response = await fetch(
      new URL("./assets/raster.wasm", import.meta.url),
    );
    return response.ok
      ? await WebAssembly.compile(await response.arrayBuffer())
      : null;
  } catch {
    return null;
  }
}
export class WasmRaster {
  declare api: RasterExports;
  declare width: number;
  declare height: number;
  declare tw: number;
  declare th: number;
  declare sourcePtr: number;
  declare historyPtr: number;
  declare horizontalPtr: number;
  declare verticalPtr: number;
  declare texturePtr: number;
  declare verticesPtr: number;
  declare scenePtr: number;
  declare outputPtr: number;
  declare kernelPtr: number;
  declare edgesPtr: number;
  declare textures: Map<RasterTexture, number>;
  declare source: Float32Array;
  declare history: Float32Array;
  declare horizontal: Float32Array;
  declare vertical: Float32Array;
  declare vertices: Float64Array;
  declare scene: Uint8ClampedArray;
  declare output: Uint8ClampedArray;
  declare edges: Float32Array;
  declare kernel: Float64Array;
  declare kernelCount: number;
  constructor(
    module: WebAssembly.Module,
    width: number,
    height: number,
    texture: RasterTexture,
    assets: Record<string, RasterTexture> = {},
    kernelExtent = 24,
  ) {
    this.api = new WebAssembly.Instance(module).exports as unknown as RasterExports;
    this.width = width;
    this.height = height;
    this.tw = texture.width;
    this.th = texture.height;
    let next = Number(this.api.__heap_base.value);
    const alloc = (n: number) => {
      const p = (next + 15) & ~15;
      next = p + n;
      return p;
    };
    const size = width * height * 3 * 4;
    this.sourcePtr = alloc(size);
    this.historyPtr = alloc(size);
    this.horizontalPtr = alloc(size);
    this.verticalPtr = alloc(size);
    this.texturePtr = alloc(texture.rgba.byteLength);
    this.verticesPtr = alloc(64);
    this.scenePtr = alloc(width * height * 4);
    this.outputPtr = alloc(width * height * 4);
    // The renderer stamps a kernel of (24 × scale)² taps; 24 × 24 was only
    // enough up to scale 3, and larger scales overflowed this buffer.
    const kernelTaps = kernelExtent * kernelExtent;
    this.kernelPtr = alloc(kernelTaps * 5 * 8);
    this.edgesPtr = alloc(width * height * 4);
    this.textures = new Map([[texture, this.texturePtr]]);
    for (const image of Object.values(assets))
      if (!this.textures.has(image))
        this.textures.set(image, alloc(image.rgba.byteLength));
    const memory = this.api.memory;
    if (next > memory.buffer.byteLength)
      memory.grow(Math.ceil((next - memory.buffer.byteLength) / 65536));
    this.source = new Float32Array(memory.buffer, this.sourcePtr, size / 4);
    this.history = new Float32Array(memory.buffer, this.historyPtr, size / 4);
    this.horizontal = new Float32Array(
      memory.buffer,
      this.horizontalPtr,
      size / 4,
    );
    this.vertical = new Float32Array(memory.buffer, this.verticalPtr, size / 4);
    this.vertices = new Float64Array(memory.buffer, this.verticesPtr, 8);
    this.scene = new Uint8ClampedArray(
      memory.buffer,
      this.scenePtr,
      width * height * 4,
    );
    // The JS monochrome compositor also writes here. Match the JS renderer's
    // byte clamping/rounding so bright glow cannot wrap modulo 256 into black.
    this.output = new Uint8ClampedArray(
      memory.buffer,
      this.outputPtr,
      width * height * 4,
    );
    this.edges = new Float32Array(memory.buffer, this.edgesPtr, width * height);
    this.kernel = new Float64Array(memory.buffer, this.kernelPtr, kernelTaps * 5);
    for (const [image, pointer] of this.textures)
      new Uint8Array(memory.buffer, pointer, image.rgba.byteLength).set(
        image.rgba,
      );
  }
  setTexture(image: RasterTexture, rgba: Uint8Array) {
    new Uint8Array(this.api.memory.buffer, this.textures.get(image)!, rgba.byteLength).set(rgba);
  }
  glow(corners: ArrayLike<number>, r: number, g: number, b: number, alpha: number) {
    this.vertices.set(corners);
    this.api.glow_quad(
      this.verticesPtr,
      r,
      g,
      b,
      alpha,
      this.texturePtr,
      this.tw,
      this.th,
      this.sourcePtr,
      this.width,
      this.height,
    );
  }
  color(
    corners: ArrayLike<number>,
    r: number,
    g: number,
    b: number,
    alpha: number,
    texture: RasterTexture | null,
    region: RasterRegion | null,
    additive: boolean,
    afterGlow = false,
  ) {
    this.vertices.set(corners);
    this.api.color_quad(
      this.verticesPtr,
      r,
      g,
      b,
      alpha,
      (texture ? this.textures.get(texture) : 0) ?? 0,
      texture?.width ?? 0,
      texture?.height ?? 0,
      region?.x ?? 0,
      region?.y ?? 0,
      region?.width ?? 0,
      region?.height ?? 0,
      afterGlow ? this.outputPtr : this.scenePtr,
      this.width,
      this.height,
      Number(additive),
    );
  }
  setKernel(taps: GlowTap[]) {
    if (taps.length > this.kernel.length / 5)
      throw new RangeError(`Glow kernel of ${taps.length} taps exceeds the reserved ${this.kernel.length / 5}`);
    this.kernelCount = taps.length;
    for (let i = 0; i < taps.length; i++) {
      const t = taps[i];
      this.kernel.set([t.x, t.y, t.r, t.g, t.b], i * 5);
    }
  }
  stamp(x: number, y: number, repeats = 1) {
    this.api.stamp_kernel(
      this.sourcePtr,
      this.kernelPtr,
      this.kernelCount,
      x,
      y,
      this.width,
      this.height,
      repeats,
    );
  }
  accumulate() {
    this.api.history_step(
      this.sourcePtr,
      this.verticalPtr,
      this.edgesPtr,
      this.historyPtr,
      this.width * this.height,
    );
  }
  compose(glow: boolean) {
    this.api.composite(
      this.scenePtr,
      this.historyPtr,
      this.outputPtr,
      this.width * this.height,
      Number(glow),
    );
    return this.output;
  }
  blur() {
    this.api.blur_axis(
      this.historyPtr,
      this.horizontalPtr,
      this.width,
      this.height,
      0,
      0.1,
      1,
    );
    this.api.blur_axis(
      this.horizontalPtr,
      this.verticalPtr,
      this.width,
      this.height,
      1,
      1 / 12.2,
      0,
    );
  }
}
