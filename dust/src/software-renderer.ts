// Full-resolution, deterministic rasterizer. No WebGL, canvas calls, random draws,
// particle thinning, frame interpolation, or reduced-resolution glow here.
import { writeParticleVertices, particleQuad, PortalSimulation } from "./portal-physics";
import { GlowTap, RasterTexture, WasmRaster } from "./wasm-raster";
import { glowDitherField, GLOW_DITHER_TILE } from "./glow-dither";
import {
  Catalog,
  Particle,
  Rect,
  Resources,
  SpriteParticle,
  SpriteSpec,
} from "./types";
const f = (x: number) => x;
const PURPLE = 0x44b43cff;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const roundCell = (x: number) => Math.floor(x + (x >= 0 ? 0.5 : -0.5));
// The u32 scene clear (render, background fast path) packs RGBA bytes in
// little-endian order; true on every wasm32/JS platform in practice.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
// Native 0x00dd8450 allocates GL_RGBA / GL_UNSIGNED_BYTE render targets.
// Keep these quantization boundaries: source blends, horizontal pass, history.
export function byteRound(value: number) {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  const low = Math.floor(value),
    part = value - low;
  return low + (part > 0.5 || (part === 0.5 && low & 1) ? 1 : 0);
}
export function unorm8(value: number) {
  return f(byteRound(value * 255) / 255);
}
const colors = new Map<number, number[]>();
function rgb(packed: number) {
  let c = colors.get(packed);
  if (!c) {
    const r = (packed >>> 16) & 255,
      g = (packed >>> 8) & 255,
      b = packed & 255;
    c = [r, g, b, r / 255, g / 255, b / 255];
    colors.set(packed, c);
  }
  return c;
}
export function sampleTexture(
  image: RasterTexture,
  u: number,
  v: number,
  channel: number,
) {
  const x = u * image.width - 0.5,
    y = v * image.height - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const x0 = clamp(ix, 0, image.width - 1),
    x1 = clamp(ix + 1, 0, image.width - 1);
  const y0 = clamp(iy, 0, image.height - 1),
    y1 = clamp(iy + 1, 0, image.height - 1);
  const data = image.rgba,
    w = image.width;
  const a = data[(y0 * w + x0) * 4 + channel],
    b = data[(y0 * w + x1) * 4 + channel];
  const c = data[(y1 * w + x0) * 4 + channel],
    d = data[(y1 * w + x1) * 4 + channel];
  return (
    ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 255
  );
}
// 11 bilinear taps at -7.5,-6,-4.5,...,7.5 equal half a contiguous
// 17-tap sum plus half a 5-tap stride-three sum. Sliding sums make this O(pixels).
// Tests compare against the literal shader sampling formula, including clamped edges.
type BlurPlan = {
  initial: Int32Array;
  add: Int32Array;
  remove: Int32Array;
  subRemove: Int32Array;
};
const blurPlans = new Map<string, BlurPlan>();
export function blurAxis(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  vertical: boolean,
  coefficient = 1,
) {
  const length = vertical ? height : width,
    lines = vertical ? width : height;
  const stride = vertical ? width * 3 : 3,
    lineStride = vertical ? 3 : width * 3;
  const key = `${length}:${stride}`;
  let plan = blurPlans.get(key);
  if (!plan) {
    plan = {
      initial: new Int32Array(25),
      add: new Int32Array(length),
      remove: new Int32Array(length),
      subRemove: new Int32Array(length),
    };
    for (let k = -8; k <= 16; k++)
      plan.initial[k + 8] = clamp(k, 0, length - 1) * stride;
    for (let x = 0; x < length; x++) {
      plan.add[x] = clamp(x + 9, 0, length - 1) * stride;
      plan.remove[x] = clamp(x - 8, 0, length - 1) * stride;
      plan.subRemove[x] = clamp(x - 6, 0, length - 1) * stride;
    }
    blurPlans.set(key, plan);
  }
  const initial = plan.initial,
    add = plan.add,
    remove = plan.remove,
    subRemove = plan.subRemove,
    weight = coefficient * 0.5;
  for (let line = 0; line < lines; line++)
    for (let channel = 0; channel < 3; channel++) {
      const base = line * lineStride + channel;
      let total = 0;
      for (let k = 0; k < 17; k++) total += source[base + initial[k]];
      let s0 = 0,
        s1 = 0,
        s2 = 0;
      for (let k = 2; k <= 14; k += 3) {
        s0 += source[base + initial[k]];
        s1 += source[base + initial[k + 1]];
        s2 += source[base + initial[k + 2]];
      }
      let phase = 0,
        index = base;
      for (let x = 0; x < length; x++, index += stride) {
        const entering = source[base + add[x]],
          delta = entering - source[base + subRemove[x]];
        let subset;
        if (phase === 0) {
          subset = s0;
          s0 += delta;
          phase = 1;
        } else if (phase === 1) {
          subset = s1;
          s1 += delta;
          phase = 2;
        } else {
          subset = s2;
          s2 += delta;
          phase = 0;
        }
        target[index] = (total + subset) * weight;
        total += entering - source[base + remove[x]];
      }
    }
}

type GlowLayer = {color: number; alpha: number; weights: Uint32Array; indices: number[]};
export type RenderOptions = {
  core?: boolean;
  glow?: boolean;
  color?: number | null;
  background?: number;
  monochrome?: boolean;
  smoothGlow?: boolean;
  // Presentation-only opt-out for the catalog portal ring sprite; default true.
  portalSprite?: boolean;
};
export class SoftwareRenderer {
  declare width: number;
  declare height: number;
  declare resources: Resources;
  declare catalog: Catalog;
  declare aggregateGlow: boolean;
  declare glowTexture: RasterTexture;
  declare monochrome: boolean;
  declare monochromeTextures: Map<RasterTexture, RasterTexture>;
  declare ditherTile: Float32Array;
  declare scene: Uint8ClampedArray;
  declare scene32: Uint32Array | undefined;
  declare source: Float32Array;
  declare history: Float32Array;
  declare horizontal: Float32Array;
  declare vertical: Float32Array;
  declare output: Uint8ClampedArray;
  declare layers: Map<number, GlowLayer>;
  declare colorKernels: Map<number, GlowTap[]>;
  declare activeKernel: GlowTap[] | null;
  declare pad: number;
  declare paddedWidth: number;
  declare paddedHeight: number;
  declare corners: Float32Array;
  declare phaseX: number;
  declare phaseY: number;
  declare kernel: GlowTap[] | null;
  declare edgeWeights: Float32Array;
  declare native: WasmRaster | null;
  declare afterGlow: boolean;
  declare colorOverride: number | null;
  declare centerX: number | null;
  declare centerY: number | null;
  declare scale: number;
  declare ditherNoise: Float32Array | undefined;
  constructor(
    width: number,
    height: number,
    resources: Resources,
    catalog: Catalog,
    { aggregateGlow = true, kernelModule = null, scale = 1 }: {
      aggregateGlow?: boolean;
      kernelModule?: WebAssembly.Module | null;
      scale?: number;
    } = {},
  ) {
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.resources = resources;
    this.catalog = catalog;
    this.aggregateGlow = aggregateGlow;
    this.glowTexture = resources.assets["data/particles/particle_glow.png"];
    this.monochrome = false;
    this.monochromeTextures = new Map();
    this.ditherTile = GLOW_DITHER_TILE;
    this.scene = new Uint8ClampedArray(width * height * 4);
    this.source = new Float32Array(width * height * 3);
    this.history = new Float32Array(width * height * 3);
    this.horizontal = new Float32Array(width * height * 3);
    this.vertical = new Float32Array(width * height * 3);
    this.output = new Uint8ClampedArray(width * height * 4);
    this.layers = new Map();
    this.colorKernels = new Map();
    this.activeKernel = null;
    // Glow margin must be a whole pixel count: it sizes typed arrays, indexes
    // the aggregation map and reserves the wasm kernel buffer, all of which
    // silently misbehave on fractions. The exact fractional scale survives
    // everywhere else.
    this.pad = Math.ceil(24 * scale);
    this.paddedWidth = width + this.pad * 2;
    this.paddedHeight = height + this.pad * 2;
    this.corners = new Float32Array(8);
    this.phaseX = NaN;
    this.phaseY = NaN;
    this.kernel = null;
    this.edgeWeights = new Float32Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        // Source FBO coordinates are bottom-up in the GL path.
        const u = (x + 0.5) / width,
          v = 1 - (y + 0.5) / height;
        let weight = 1;
        if (u > 0.95) weight = 1 - (u - 0.95) * 2;
        else if (u < 0.05) weight = 1 - (0.05 - u) * 2;
        if (v > 0.95) weight = 1 - (v - 0.95) * 2;
        else if (v < 0.05) weight = 1 - (0.05 - v) * 2;
        this.edgeWeights[y * width + x] = weight;
      }
    this.native = null;
    if (kernelModule) {
      try {
        this.native = new WasmRaster(
          kernelModule,
          width,
          height,
          this.glowTexture,
          resources.assets,
          this.pad,
        );
        this.scene = this.native.scene;
        this.source = this.native.source;
        this.history = this.native.history;
        this.horizontal = this.native.horizontal;
        this.vertical = this.native.vertical;
        this.native.edges.set(this.edgeWeights);
      } catch {
        this.native = null;
      }
    }
    this.clear();
  }
  clear() {
    this.scene.fill(0);
    this.source.fill(0);
    this.history.fill(0);
    this.horizontal.fill(0);
    this.vertical.fill(0);
    for (let i = 3; i < this.scene.length; i += 4) this.scene[i] = 255;
    if (this.output?.byteLength) {
      this.output.fill(0);
      for (let i = 3; i < this.output.length; i += 4) this.output[i] = 255;
    }
    this.layers.clear();
    this.colorKernels.clear();
    this.activeKernel = null;
  }
  // Reference rect blend. render()'s particle loop inlines this for the
  // 1-2 px × 1 px particle bodies it draws at scale 1 (same ceil/clamp pixel
  // selection and blend math, clamps skipped when provably interior); keep
  // both pixel-exact if either changes.
  bodyRect(
    left: number,
    top: number,
    width: number,
    height: number,
    color: number,
    alpha: number,
  ) {
    const x0 = clamp(Math.ceil(left - 0.5), 0, this.width),
      x1 = clamp(Math.ceil(left + width - 0.5), 0, this.width);
    const y0 = clamp(Math.ceil(top - 0.5), 0, this.height),
      y1 = clamp(Math.ceil(top + height - 0.5), 0, this.height);
    const a = alpha / 255,
      inv = 1 - a,
      c = rgb(color),
      r = c[0] * a,
      g = c[1] * a,
      b = c[2] * a;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * this.width + x) * 4;
        this.scene[i] = r + this.scene[i] * inv;
        this.scene[i + 1] = g + this.scene[i + 1] * inv;
        this.scene[i + 2] = b + this.scene[i + 2] * inv;
      }
  }
  grayTexture(image: RasterTexture): RasterTexture {
    let gray = this.monochromeTextures.get(image);
    if (!gray) {
      const rgba = image.rgba.slice();
      for (let i = 0; i < rgba.length; i += 4) {
        const light = Math.round(rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722);
        rgba[i] = rgba[i + 1] = rgba[i + 2] = light;
      }
      gray = { ...image, rgba };
      this.monochromeTextures.set(image, gray);
    }
    return gray;
  }
  setMonochrome(enabled: boolean) {
    if (this.monochrome === enabled) return;
    this.monochrome = enabled;
    if (this.native) for (const image of Object.values(this.resources.assets))
      this.native.setTexture(image, (enabled ? this.grayTexture(image) : image).rgba);
    const glow = this.resources.assets["data/particles/particle_glow.png"];
    this.glowTexture = enabled ? this.grayTexture(glow) : glow;
    this.phaseX = this.phaseY = NaN;
    this.colorKernels.clear(); this.activeKernel = null;
  }
  kernelFor(offsetX: number, offsetY: number) {
    const phaseX = Math.ceil(offsetX - 0.5) + 0.5 - offsetX,
      phaseY = Math.ceil(offsetY - 0.5) + 0.5 - offsetY;
    if (phaseX === this.phaseX && phaseY === this.phaseY) return;
    this.phaseX = phaseX;
    this.phaseY = phaseY;
    this.kernel = [];
    const size = 24 * this.scale;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = (x + phaseX) / size,
          v = (y + phaseY) / size;
        const a = sampleTexture(this.glowTexture, u, v, 3);
        const r = sampleTexture(this.glowTexture, u, v, 0) * a,
          g = sampleTexture(this.glowTexture, u, v, 1) * a,
          b = sampleTexture(this.glowTexture, u, v, 2) * a;
        if (r !== 0 || g !== 0 || b !== 0) this.kernel.push({ x, y, r, g, b });
      }
    this.colorKernels.clear();
    this.activeKernel = null;
  }
  glowStamp(x: number, y: number, color: number, alpha: number, count = 1) {
    // Whole-pixel origin: the JS fallback indexes `source` with these values
    // and the wasm path must agree with it.
    x = Math.floor(x);
    y = Math.floor(y);
    const key = (color & 0xffffff) + alpha * 0x1000000;
    let taps = this.colorKernels.get(key);
    if (!taps) {
      taps = [];
      const c = rgb(color),
        r = (c[0] * alpha) / (255 * 255),
        g = (c[1] * alpha) / (255 * 255),
        b = (c[2] * alpha) / (255 * 255);
      for (const k of this.kernel!) {
        const qr = byteRound(r * k.r * 255),
          qg = byteRound(g * k.g * 255),
          qb = byteRound(b * k.b * 255);
        // Exactly-zero byte contributions can be omitted; do not threshold real light.
        if (qr || qg || qb) taps.push({ x: k.x, y: k.y, r: qr, g: qg, b: qb });
      }
      this.colorKernels.set(key, taps);
    }
    if (this.native) {
      if (this.activeKernel !== taps) {
        this.native.setKernel(taps);
        this.activeKernel = taps;
      }
      this.native.stamp(x, y, count);
      return;
    }
    for (let j = 0; j < taps.length; j++) {
      const k = taps[j],
        xx = x + k.x,
        yy = y + k.y;
      if (xx < 0 || yy < 0 || xx >= this.width || yy >= this.height) continue;
      const i = (yy * this.width + xx) * 3;
      this.source[i] = f(
        Math.min(255, Math.round(this.source[i] * 255) + k.r * count) / 255,
      );
      this.source[i + 1] = f(
        Math.min(255, Math.round(this.source[i + 1] * 255) + k.g * count) / 255,
      );
      this.source[i + 2] = f(
        Math.min(255, Math.round(this.source[i + 2] * 255) + k.b * count) / 255,
      );
    }
  }
  addGlow(x: number, y: number, color: number, alpha: number) {
    // Whole-pixel origin: the aggregation map is indexed by pixel.
    x = Math.floor(x);
    y = Math.floor(y);
    const extent = 24 * this.scale;
    if (x >= this.width || y >= this.height || x + extent <= 0 || y + extent <= 0)
      return;
    if (!this.aggregateGlow) {
      this.glowStamp(x, y, color, alpha);
      return;
    }
    // RGBA8 blending is nonlinear: never combine different alpha values first.
    const layerKey = (color & 0xffffff) + alpha * 0x1000000;
    let layer = this.layers.get(layerKey);
    if (!layer) {
      layer = {
        color,
        alpha,
        weights: new Uint32Array(this.paddedWidth * this.paddedHeight),
        indices: [],
      };
      this.layers.set(layerKey, layer);
    }
    const key = (y + this.pad) * this.paddedWidth + x + this.pad;
    if (layer.weights[key] === 0) layer.indices.push(key);
    layer.weights[key]++;
  }
  flushGlow() {
    for (const layer of this.layers.values()) {
      for (let j = 0; j < layer.indices.length; j++) {
        const key = layer.indices[j],
          weight = layer.weights[key];
        this.glowStamp(
          (key % this.paddedWidth) - this.pad,
          Math.floor(key / this.paddedWidth) - this.pad,
          layer.color,
          layer.alpha,
          weight,
        );
        layer.weights[key] = 0;
      }
      layer.indices.length = 0;
    }
  }
  rasterQuad(
    corners: ArrayLike<number>,
    color: number,
    alpha: number,
    texture: RasterTexture | null = null,
    region: Rect | null = null,
    additive = false,
    glow = false,
    tint: number[] | null = null,
  ) {
    if (alpha <= 0) return;
    if (this.native) {
      const c = rgb(color);
      if (glow) this.native.glow(corners, c[3], c[4], c[5], alpha);
      else
        this.native.color(
          corners,
          tint?.[0] ?? c[3],
          tint?.[1] ?? c[4],
          tint?.[2] ?? c[5],
          alpha,
          texture,
          region,
          additive,
          this.afterGlow,
        );
      return;
    }
    const target = this.afterGlow ? this.output : this.scene;
    const ax = corners[0],
      ay = corners[1],
      ux = corners[2] - ax,
      uy = corners[3] - ay,
      vx = corners[6] - ax,
      vy = corners[7] - ay;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-12) return;
    const x0 = clamp(
        Math.floor(Math.min(corners[0], corners[2], corners[4], corners[6])),
        0,
        this.width,
      ),
      x1 = clamp(
        Math.ceil(Math.max(corners[0], corners[2], corners[4], corners[6])),
        0,
        this.width,
      );
    const y0 = clamp(
        Math.floor(Math.min(corners[1], corners[3], corners[5], corners[7])),
        0,
        this.height,
      ),
      y1 = clamp(
        Math.ceil(Math.max(corners[1], corners[3], corners[5], corners[7])),
        0,
        this.height,
      );
    const c = rgb(color),
      cr = tint ? tint[0] : c[3],
      cg = tint ? tint[1] : c[4],
      cb = tint ? tint[2] : c[5];
    const tw = texture?.width ?? 0,
      th = texture?.height ?? 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - ax,
          dy = y + 0.5 - ay,
          u = (dx * vy - dy * vx) / det,
          v = (dy * ux - dx * uy) / det;
        if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
        let r = cr,
          g = cg,
          bb = cb,
          aa = alpha;
        if (texture) {
          const data = texture.rgba;
          if (glow) {
            const tx = u * tw - 0.5,
              ty = v * th - 0.5,
              ix = Math.floor(tx),
              iy = Math.floor(ty),
              fx = tx - ix,
              fy = ty - iy;
            const xx0 = clamp(ix, 0, tw - 1),
              xx1 = clamp(ix + 1, 0, tw - 1),
              yy0 = clamp(iy, 0, th - 1),
              yy1 = clamp(iy + 1, 0, th - 1);
            const i00 = (yy0 * tw + xx0) * 4,
              i10 = (yy0 * tw + xx1) * 4,
              i01 = (yy1 * tw + xx0) * 4,
              i11 = (yy1 * tw + xx1) * 4;
            const w00 = ((1 - fx) * (1 - fy)) / 255,
              w10 = (fx * (1 - fy)) / 255,
              w01 = ((1 - fx) * fy) / 255,
              w11 = (fx * fy) / 255;
            r *=
              data[i00] * w00 +
              data[i10] * w10 +
              data[i01] * w01 +
              data[i11] * w11;
            g *=
              data[i00 + 1] * w00 +
              data[i10 + 1] * w10 +
              data[i01 + 1] * w01 +
              data[i11 + 1] * w11;
            bb *=
              data[i00 + 2] * w00 +
              data[i10 + 2] * w10 +
              data[i01 + 2] * w01 +
              data[i11 + 2] * w11;
            aa *=
              data[i00 + 3] * w00 +
              data[i10 + 3] * w10 +
              data[i01 + 3] * w01 +
              data[i11 + 3] * w11;
          } else {
            const tx = clamp(
                Math.floor(region!.x + u * region!.width),
                0,
                tw - 1,
              ),
              ty = clamp(Math.floor(region!.y + v * region!.height), 0, th - 1),
              i = (ty * tw + tx) * 4;
            r *= data[i] / 255;
            g *= data[i + 1] / 255;
            bb *= data[i + 2] / 255;
            aa *= data[i + 3] / 255;
          }
        }
        if (glow) {
          const i = (y * this.width + x) * 3;
          this.source[i] = unorm8(this.source[i] + r * aa);
          this.source[i + 1] = unorm8(this.source[i + 1] + g * aa);
          this.source[i + 2] = unorm8(this.source[i + 2] + bb * aa);
        } else {
          const i = (y * this.width + x) * 4,
            inv = additive ? 1 : 1 - aa;
          target[i] = r * aa * 255 + target[i] * inv;
          target[i + 1] = g * aa * 255 + target[i + 1] * inv;
          target[i + 2] = bb * aa * 255 + target[i + 2] * inv;
        }
      }
  }

  // drawLong particles: the spec's stroke quad (particleQuad, portal-physics.ts)
  // with only its position and length scaled by this.scale; thickness stays a
  // 1px screen-space edge (device-px stroke at any S). The world-space corners
  // keep the spec's fround pattern (writeParticleVertices), so at S = 1 the
  // raster is bit-identical to the all-scaled path.
  private longStrokeVertices(p: Particle, ox: number, oy: number, out: Float32Array) {
    const q = particleQuad(p);
    const s = this.scale,
      c = q.cosine,
      sn = q.sine,
      r = q.length,
      b = 1;
    // Spec corner arithmetic (writeParticleVertices with l = 0, t = 0) in
    // world space; the anchor and length edge are then scaled, the thickness
    // edge is not, so the stroke stays 1 device px at any S.
    const bx = Math.fround(q.x + Math.fround(c * r)),
      by = Math.fround(q.y + Math.fround(sn * r));
    const cx = Math.fround(q.x + Math.fround(Math.fround(c * r) - Math.fround(sn * b))),
      cy = Math.fround(q.y + Math.fround(Math.fround(sn * r) + Math.fround(c * b)));
    const dx = Math.fround(q.x - Math.fround(sn * b)),
      dy = Math.fround(q.y + Math.fround(c * b));
    if (s === 1) {
      // Game-native scale: mirror the spec path's arithmetic exactly, so the
      // raster is bit-identical to the all-scaled writeParticleVertices path.
      out[0] = q.x + ox;
      out[1] = q.y + oy;
      out[2] = bx + ox;
      out[3] = by + oy;
      out[4] = cx + ox;
      out[5] = cy + oy;
      out[6] = dx + ox;
      out[7] = dy + oy;
    } else {
      const ax = q.x * s + ox,
        ay = q.y * s + oy;
      out[0] = ax;
      out[1] = ay;
      out[2] = bx * s + ox;
      out[3] = by * s + oy;
      out[4] = out[2] + (cx - bx); // thickness edge: 1 screen px, never scaled
      out[5] = out[3] + (cy - by);
      out[6] = ax + (dx - q.x);
      out[7] = ay + (dy - q.y);
    }
    return q.alpha;
  }

  // Long-stroke (drawLong) particles only — 1-2 px × 1 px bodies are blended
  // inline in render()'s particle loop (see bodyRect for the exact reference
  // arithmetic those inlined paths must match).
  drawParticle(p: Particle, ox: number, oy: number, buildGlow: boolean) {
    const color = this.colorOverride ?? p.color ?? PURPLE;
    const vertices = this.corners,
      s = this.scale;
    let alpha = this.longStrokeVertices(p, ox, oy, vertices);
    this.rasterQuad(vertices, color, alpha);
    if (buildGlow && p.glow !== false) {
      alpha = writeParticleVertices(p, true, vertices);
      for (let i = 0; i < 8; i += 2) {
        vertices[i] = vertices[i] * s + ox;
        vertices[i + 1] = vertices[i + 1] * s + oy;
      }
      this.rasterQuad(
        vertices,
        color,
        alpha,
        this.glowTexture,
        null,
        true,
        true,
      );
    }
  }
  // Glow stamp for 1-2 px particle bodies (drawLong === false), shared by the
  // inlined body path in render()'s particle loop.
  particleGlow(p: Particle, color: number, ox: number, oy: number) {
    const a = f(p.alpha * (p.life < 1 ? p.life : 1));
    const packed =
      Math.trunc(f(f(f(a * f(0.03)) * (p.ultrabright ? 50 : 1)) * 255)) &
      255;
    if (packed > 0) {
      if (p.onGrid === false) {
        const s = this.scale,
          extent = 24 * s,
          x = p.x * s - extent / 2 + ox,
          y = p.y * s - extent / 2 + oy;
        this.rasterQuad(
          [x, y, x + extent, y, x + extent, y + extent, x, y + extent],
          color,
          packed / 255,
          this.glowTexture,
          null,
          true,
          true,
        );
      } else {
        const s = this.scale;
        this.addGlow(
          (Math.trunc(f(p.x + 0.5)) - 12) * s + Math.ceil(ox - 0.5),
          (Math.trunc(f(p.y + 0.5)) - 12) * s + Math.ceil(oy - 0.5),
          color,
          packed,
        );
      }
    }
  }
  drawSprite(sprite: SpriteSpec, sim: PortalSimulation, transform: SpriteParticle | null = null) {
    const image = this.resources.assets[sprite.asset];
    const tex = image && this.monochrome && !this.native ? this.grayTexture(image) : image;
    if (!tex) return;
    let elapsed = transform ? Math.max(0, transform.elapsed) : sim.frame / 60;
    if (!transform && sim.loopFrames && sprite.frames > 1) {
      const cycles = Math.max(1, Math.round(sim.loopFrames / (60 * sprite.wait * sprite.frames)));
      elapsed = sprite.loop ? ((sim.frame - sim.startFrame) % sim.loopFrames) / sim.loopFrames * sprite.wait * sprite.frames * cycles : sprite.wait * sprite.frames;
    }
    let frame = sprite.frames > 1 ? Math.floor(elapsed / sprite.wait) : 0;
    frame = sprite.loop
      ? frame % sprite.frames
      : Math.min(frame, sprite.frames - 1);
    const region = {
      x: sprite.posX + (frame % sprite.perRow) * sprite.width,
      y: sprite.posY + Math.floor(frame / sprite.perRow) * sprite.height,
      width: sprite.width,
      height: sprite.height,
    };
    const scale = this.scale,
      x =
        ((transform?.x ?? sim.x + (sprite.entityX ?? 0)) -
          sim.x -
          (this.centerX ?? 0)) *
          scale +
        this.width / 2,
      y =
        ((transform?.y ?? sim.y + (sprite.entityY ?? 0)) -
          sim.y -
          (this.centerY ?? 0)) *
          scale +
        this.height / 2;
    const sx = transform?.scaleX ?? 1,
      sy = transform?.scaleY ?? 1,
      c = transform?.cosine ?? 1,
      s = transform?.sine ?? 0;
    const offX = transform?.centered ? sprite.width / 2 : sprite.offsetX,
      offY = transform?.centered ? sprite.height / 2 : sprite.offsetY;
    const corners = [
      [-offX, -offY],
      [sprite.width - offX, -offY],
      [sprite.width - offX, sprite.height - offY],
      [-offX, sprite.height - offY],
    ].flatMap(([px, py]) => [
      x + (c * px * sx - s * py * sy) * scale,
      y + (s * px * sx + c * py * sy) * scale,
    ]);
    let tint = transform?.color ?? null;
    if (this.monochrome && tint) {
      const light = tint[0] * 0.2126 + tint[1] * 0.7152 + tint[2] * 0.0722;
      tint = [light, light, light];
    }
    this.rasterQuad(
      corners,
      0xffffff,
      (transform?.color[3] ?? 1) * sprite.alpha,
      tex,
      region,
      transform?.additive ?? sprite.additive,
      false,
      tint,
    );
  }
  render(
    sim: PortalSimulation,
    { core = true, glow = true, color = null, background = 0, monochrome = false, smoothGlow = false, portalSprite = true }: RenderOptions = {},
    advance = true,
    outputBuffer: ArrayBufferLike | null = null,
  ) {
    if (outputBuffer) this.output = new Uint8ClampedArray(outputBuffer);
    if (!this.output || this.output.byteLength !== this.width * this.height * 4)
      this.output = new Uint8ClampedArray(this.width * this.height * 4);
    // Presentation-only recolor: particle state, RNG and sprites are untouched.
    this.colorOverride = color;
    this.setMonochrome(monochrome);
    const bg = rgb(background);
    if (LITTLE_ENDIAN && bg[0] === 0 && bg[1] === 0 && bg[2] === 0) {
      // Single memset as 0xff000000 u32s: black RGB with alpha 255. Scene
      // alpha must stay 255 every frame — the glow=false identity path copies
      // scene bytes straight into the output buffer, and putImageData
      // surfaces the alpha plane even on alpha:false canvases (an output
      // alpha of 0 composites as transparent, and browsers that unpremultiply
      // on read turn it into white). Neither bodyRect nor quad rasterization
      // writes the alpha byte, so it survives the frame untouched.
      if (this.scene32 && this.scene32.buffer === this.scene.buffer)
        this.scene32.fill(0xff000000);
      else
        this.scene32 = new Uint32Array(
          this.scene.buffer,
          this.scene.byteOffset,
          this.scene.length / 4,
        ).fill(0xff000000);
    } else {
      for (let i = 0; i < this.scene.length; i += 4) {
        this.scene[i] = bg[0];
        this.scene[i + 1] = bg[1];
        this.scene[i + 2] = bg[2];
        this.scene[i + 3] = 255;
      }
    }
    // The history buffer feeds only the glow composition (wasm composite's
    // glow flag, or the JS branches below, which read `history` only when
    // `glow` is set). With glow off the whole temporal-glow pipeline is dead
    // work, so skip it — output is byte-identical.
    if (advance && glow) this.source.fill(0);
    const scale = this.scale,
      ox = this.width / 2 - (sim.x + (this.centerX ?? 0)) * scale,
      oy = this.height / 2 - (sim.y + (this.centerY ?? 0)) * scale;
    this.kernelFor(ox, oy);
    const margin = 40 * scale,
      buildGlow = advance && glow,
      sceneWidth = this.width,
      sceneHeight = this.height,
      scene = this.scene;
    for (let i = 0; i < sim.particles.length; i++) {
      const p = sim.particles[i];
      if (p.alpha <= 0) continue;
      const x = p.x * scale + ox,
        y = p.y * scale + oy;
      if (x < -margin || x > sceneWidth + margin || y < -margin || y > sceneHeight + margin)
        continue;
      if (p.drawLong) {
        this.drawParticle(p, ox, oy, buildGlow);
        continue;
      }
      // Lean 1-2 px × 1 px body blend, inlined from drawParticle → bodyRect
      // (call overhead, the clamp dance and the per-call color decode
      // dominated at ~33 ns/particle). Identical ceil/clamp pixel selection
      // and blend arithmetic; clamps are skipped only for rects provably
      // inside the scene, where they are the identity.
      const color = this.colorOverride ?? p.color ?? PURPLE,
        wide = p.singleWidth === false && (p.cellType === "gas" || p.cellType === "fire"),
        width = wide ? 2 : 1,
        alpha = Math.trunc(f(f(p.alpha * (wide ? 0.5 : 1)) * 255)) & 255;
      if (alpha > 0) {
        const bx = ((p.onGrid === false ? p.x : roundCell(f(p.x + 0.5))) - width) * scale + ox,
          by = ((p.onGrid === false ? p.y : roundCell(f(p.y + 0.5))) - 1) * scale + oy,
          a = alpha / 255,
          inv = 1 - a,
          c = rgb(color),
          r = c[0] * a,
          g = c[1] * a,
          b = c[2] * a;
        let x0 = Math.ceil(bx - 0.5),
          x1 = Math.ceil(bx + width - 0.5),
          y0 = Math.ceil(by - 0.5),
          y1 = Math.ceil(by + 1 - 0.5);
        if (x0 < 0 || x1 > sceneWidth || y0 < 0 || y1 > sceneHeight) {
          x0 = clamp(x0, 0, sceneWidth);
          x1 = clamp(x1, 0, sceneWidth);
          y0 = clamp(y0, 0, sceneHeight);
          y1 = clamp(y1, 0, sceneHeight);
        }
        for (let py = y0; py < y1; py++)
          for (let px = x0; px < x1; px++) {
            const i4 = (py * sceneWidth + px) * 4;
            scene[i4] = r + scene[i4] * inv;
            scene[i4 + 1] = g + scene[i4 + 1] * inv;
            scene[i4 + 2] = b + scene[i4 + 2] * inv;
          }
      }
      if (buildGlow && p.glow !== false) this.particleGlow(p, color, ox, oy);
    }
    if (core) {
      // Original figures have a steady, faint contour even while paused. This
      // is not part of a Noita effect and never changes particle/RNG state.
      for (const [a, b] of sim.guides ?? []) {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          length = Math.hypot(dx, dy);
        if (length === 0) continue;
        const nx = (-dy / length) * 0.5 * scale,
          ny = (dx / length) * 0.5 * scale,
          cx = this.width / 2 - (this.centerX ?? 0) * scale,
          cy = this.height / 2 - (this.centerY ?? 0) * scale;
        this.rasterQuad(
          [
            a[0] * scale + cx + nx,
            a[1] * scale + cy + ny,
            b[0] * scale + cx + nx,
            b[1] * scale + cy + ny,
            b[0] * scale + cx - nx,
            b[1] * scale + cy - ny,
            a[0] * scale + cx - nx,
            a[1] * scale + cy - ny,
          ],
          this.colorOverride ?? PURPLE,
          0.16,
        );
      }
      const sprites =
        sim.definition?.sprites ??
        (sim.effect.startsWith("math_") || !portalSprite ? [] : [this.catalog.portalSprite]);
      for (const sprite of sprites) if (!sprite.emissive) this.drawSprite(sprite, sim);
    }
    for (const p of sim.spriteParticles ?? [])
      if (p.delay <= 0 && p.elapsed >= 0 && !p.sprite.emissive) this.drawSprite(p.sprite, sim, p);
    if (advance && glow) {
      this.flushGlow();
      if (this.native) this.native.blur();
      else {
        blurAxis(
          this.history,
          this.horizontal,
          this.width,
          this.height,
          false,
          0.1,
        );
        for (let i = 0; i < this.horizontal.length; i++)
          this.horizontal[i] = unorm8(this.horizontal[i]);
        blurAxis(
          this.horizontal,
          this.vertical,
          this.width,
          this.height,
          true,
          1 / 12.2,
        );
      }
      if (this.native) this.native.accumulate();
      else
        for (let i = 0, j = 0; i < this.history.length; i += 3, j++)
          for (let c = 0; c < 3; c++) {
            const tap = this.source[i + c] * 2.5,
              old = this.vertical[i + c] * this.edgeWeights[j];
            this.history[i + c] = unorm8(
              tap * 0.125 + (old * 0.95 + tap * 0.05),
            );
          }
    }
    // With glow, monochrome and dithering all off, the shipped compose kernel
    // reduces to an RGB copy of the scene with alpha forced to 255 (verified
    // byte-identical against raster.wasm). Skip it and copy the scene
    // directly; the output alpha plane is ignored by the alpha:false display
    // canvases. Emissive sprites below still draw into `output` afterwards,
    // exactly as they did over the composed image.
    const identityCompose = !glow && !monochrome && !smoothGlow;
    if (identityCompose) {
      this.output.set(this.scene);
    }
    else if (this.native && !monochrome && !smoothGlow) {
      this.native.compose(glow);
    }
    else {
      const output = this.native?.output ?? this.output;
      if (smoothGlow && glow) this.ditherNoise ??= glowDitherField(this.width, this.height);
      for (let p = 0, i = 0; p < this.width * this.height; p++, i += 4) {
        const grayGlow = monochrome && glow ? Math.max(0, this.history[p * 3] - 0.008) * 0.2126 +
          Math.max(0, this.history[p * 3 + 1] - 0.008) * 0.7152 + Math.max(0, this.history[p * 3 + 2] - 0.008) * 0.0722 : 0;
        let noise = 0;
        // Dither only the halo over untouched background. Foreground geometry,
        // flat backgrounds and late emissive sprites retain their exact pixels.
        if (smoothGlow && glow && background !== 0xffffff &&
            this.scene[i] === bg[0] && this.scene[i + 1] === bg[1] && this.scene[i + 2] === bg[2]) {
          const amount = monochrome ? grayGlow : Math.max(0, this.history[p * 3] - 0.008, this.history[p * 3 + 1] - 0.008, this.history[p * 3 + 2] - 0.008);
          if (amount > 0) noise = this.ditherNoise![p] * Math.min(1, amount * 255);
        }
        for (let c = 0; c < 3; c++) {
          const color = this.scene[i + c] / 255,
            g = monochrome ? grayGlow : glow ? Math.max(0, this.history[p * 3 + c] - 0.008) : 0;
          output[i + c] =
            Math.max(
              color + g * 0.6,
              Math.min(1, Math.max(0, color + g - color * g)),
            ) * 255 + noise;
        }
        output[i + 3] = 255;
      }
    }
    // Native SpriteSystem emissive layer is drawn after post_final (0x88ca30).
    // An opaque black sprite must occlude glow as well as the particle bodies.
    this.afterGlow = true;
    if (core) {
      const sprites = sim.definition?.sprites ??
        (sim.effect.startsWith("math_") || !portalSprite ? [] : [this.catalog.portalSprite]);
      for (const sprite of sprites) if (sprite.emissive) this.drawSprite(sprite, sim);
    }
    for (const p of sim.spriteParticles ?? [])
      if (p.delay <= 0 && p.elapsed >= 0 && p.sprite.emissive) this.drawSprite(p.sprite, sim, p);
    this.afterGlow = false;
    // Only the compose path leaves the result in wasm memory; the identity
    // and JS fallback paths already wrote `this.output`.
    if (this.native && !identityCompose) this.output.set(this.native.output);
    return this.output;
  }
}
