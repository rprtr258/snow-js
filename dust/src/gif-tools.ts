import { quantize } from "gifenc";
import { blueNoiseRanks } from "./blue-noise-ranks";
import { Rect, RasterSize, Size } from "./types";

export const GIF_LIMIT = 10_000_000; // Decimal MB, strictly below the upload limit.
export const GIF_FPS = 50; // Exact 20 ms GIF delays, supported by browser players.
const ranks = blueNoiseRanks();
export type GifTiming = {
  count: number;
  period: number;
  delay: number;
  tick: (index: number) => number;
};
export type GifEncodeAttempt = {bytes?: Uint8Array; estimatedBytes?: number};
export type GifEncode = (
  size: Size,
  attempt: number,
  limit: number,
) => Promise<GifEncodeAttempt>;
export type FittedGif = {
  bytes: Uint8Array;
  estimatedBytes?: number;
  width: number;
  height: number;
};

export function gifTiming(seconds: number, speed = 1): GifTiming {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new RangeError("Choose a length from 1 to 60 seconds.");
  const count = Math.round(seconds * GIF_FPS);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 4) throw new RangeError("Invalid animation speed.");
  // Sample the actual 60 Hz clock. Deriving rate from a rounded loop length
  // would subtly retime fractional-duration clips, especially at slow speeds.
  const tick = (i: number) => Math.floor(i * 60 / GIF_FPS * speed + 1e-8);
  return { count, period: tick(count), delay: 1000 / GIF_FPS, tick };
}

export function gifOutputSize(crop: Rect, raster: RasterSize, scale = 2) {
  if (!Number.isInteger(scale) || scale < 1 || scale > 4) throw new RangeError("Choose a GIF scale from 1× to 4×.");
  const width = Math.max(1, Math.round(crop.width * raster.baseWidth / raster.width));
  const height = Math.max(1, Math.round(crop.height * raster.baseHeight / raster.height));
  return { width: width * scale, height: height * scale, baseWidth: width, baseHeight: height };
}

export function gifOverlap(timing: GifTiming, speed = 1) {
  return Math.max(1, Math.round(Math.min(timing.period / 4, 30 * speed)));
}

// The clip starts after its head overlap. At the tail, blend back into that
// same head at native speed; the endpoint is the next start frame, not a hold.
export function gifSample(timing: GifTiming, index: number, overlap = 0) {
  const tick = timing.tick(index), head = tick - (timing.period - overlap);
  return { main: overlap + tick, head: Math.max(0, head),
    blend: overlap && head >= 0 ? (1 - Math.cos(Math.PI * Math.min(1, head / overlap))) / 2 : 0 };
}

// Accumulate the union across the entire clip. Ignore only nearly invisible
// differences (including the one-level glow dither); never move the crop per frame.
export function extendBounds(
  bounds: {left: number; right: number; top: number; bottom: number},
  pixels: Uint8ClampedArray,
  background: Uint8ClampedArray,
  width: number,
  height: number,
) {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    if (Math.max(Math.abs(pixels[p] - background[p]), Math.abs(pixels[p + 1] - background[p + 1]), Math.abs(pixels[p + 2] - background[p + 2])) <= 2) continue;
    bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
  }
}
export function cropBounds(
  bounds: {left: number; right: number; top: number; bottom: number},
  width: number,
  height: number,
  crop = true,
): Rect {
  if (!crop || !Number.isFinite(bounds.left)) return { x: 0, y: 0, width, height };
  const margin = Math.max(4, Math.ceil(Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.02));
  const x = Math.max(0, bounds.left - margin), y = Math.max(0, bounds.top - margin);
  return { x, y, width: Math.min(width, bounds.right + margin + 1) - x,
    height: Math.min(height, bounds.bottom + margin + 1) - y };
}
export function gifSize(crop: Size, scale: number): Size {
  return { width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)) };
}

// Smoothly mix matched views at the join. The caller chooses the direction;
// zero endpoint slopes avoid a change in blending speed. Identical body and
// background pixels remain byte-identical throughout the overlap.
export function loopBlendWeight(phase: number) {
  return (1 + Math.cos(Math.PI * Math.max(0, Math.min(1, phase)))) / 2;
}

export function blendLoopFrames(
  first: Uint8ClampedArray,
  next: Uint8ClampedArray,
  phase: number,
) {
  const weight = loopBlendWeight(phase);
  for (let i = 0; i < first.length; i++)
    if (first[i] !== next[i]) first[i] = Math.round(first[i] + (next[i] - first[i]) * weight);
  return first;
}

export function gifPalette(samples: Uint8Array, backgrounds: number[][]) {
  const grays = samples.every((v, i) => i % 4 > 0 || (v === samples[i + 1] && v === samples[i + 2])) && backgrounds.every(c => c[0] === c[1] && c[1] === c[2]);
  // Preserve all 256 luminance levels for white particles on black. RGB565
  // palette mapping would collapse this to far fewer levels and reintroduce bands.
  if (grays) return Array.from({ length: 256 }, (_, i) => [i, i, i]);
  const fixed = [...new Map([...backgrounds, [0, 0, 0], [255, 255, 255]].map(c => [c.join(","), c])).values()].slice(0, 254);
  const palette = quantize(samples, Math.max(2, 256 - fixed.length), { format: "rgb565" });
  for (const c of fixed) if (!palette.some(p => p.every((v, i) => v === c[i]))) palette.push(c);
  return palette.slice(0, 256);
}

// Exact RGB lookup with a bounded cache, plus spatially fixed blue-noise palette
// dithering. The same color never changes its mapping with animation time.
export function paletteMapper(palette: number[][]) {
  const grayscale = palette.length === 256 && palette.every((p, i) => p.every(v => v === i));
  const cache = new Map<number, number>();
  return (rgba: Uint8ClampedArray, width: number, height: number) => {
    const indexed = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < indexed.length; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      if (grayscale) { indexed[i] = r; continue; }
      const key = (r << 16) | (g << 8) | b;
      let entry = cache.get(key);
      if (entry === undefined) {
        let a = 0, c = 0, d1 = Infinity, d2 = Infinity;
        for (let j = 0; j < palette.length; j++) {
          const color = palette[j], d = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
          if (d < d1) { d2 = d1; c = a; d1 = d; a = j; }
          else if (d < d2) { d2 = d; c = j; }
        }
        const first = palette[a], second = palette[c], dr = second[0] - first[0], dg = second[1] - first[1], db = second[2] - first[2];
        const dot = (r - first[0]) * dr + (g - first[1]) * dg + (b - first[2]) * db;
        const weight = d1 === 0 ? 0 : Math.max(0, Math.min(0.5, dot / (dr * dr + dg * dg + db * db || 1)));
        entry = a | (c << 8) | (Math.round(weight * 65535) << 16);
        if (cache.size >= 65536) cache.clear();
        cache.set(key, entry);
      }
      const noise = ranks[((Math.floor(i / width) & 127) << 7) | ((i % width) & 127)] * 4 + 2;
      indexed[i] = noise < (entry >>> 16) ? (entry >>> 8) & 255 : entry & 255;
    }
    return indexed;
  };
}

// Search measured encodes, preserving duration, frame rate and the full palette.
// Never return an oversized attempt; retain the highest-resolution successful one.
export async function fitGif(crop: Size, encode: GifEncode, limit = GIF_LIMIT): Promise<FittedGif> {
  let scale = 1, lower = 0, upper = 1, best: FittedGif | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const size = gifSize(crop, scale), result = await encode(size, attempt + 1, limit);
    if (result.bytes && result.bytes.byteLength < limit) {
      best = { ...result, ...size, bytes: result.bytes }; lower = scale;
      if (scale === 1 || upper - lower < 0.025) break;
      scale = (lower + upper) / 2;
    } else {
      upper = scale;
      if (best) scale = (lower + upper) / 2;
      else scale *= Math.min(0.85, Math.max(0.2, Math.sqrt(limit / (result.estimatedBytes ?? limit)) * 0.92));
    }
  }
  if (!best) throw new Error("Could not fit this clip below 10 MB. Try a shorter length.");
  return best;
}
