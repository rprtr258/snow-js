// Original image-authoring format. Source RGB is used only for luminance masks,
// never as particle color. Native emitter PNGs contain probability/time data.
import { validateColor } from "./particle-color";
import {
  EmissionPoint,
  ImageSettings,
  ImageSettingsInput,
  Mask,
  MaskSettings,
  MaskSettingsInput,
  SourceImage,
} from "./types";

type ByteLike = number[] | Uint8Array | Uint8ClampedArray;
type ProjectInput = {
  format?: unknown;
  version?: unknown;
  name?: unknown;
  source?: unknown;
  mask?: unknown;
  settings?: unknown;
  color?: unknown;
  background?: unknown;
  glow?: unknown;
};
export type ImageProject = {
  format: string;
  version: number;
  name: string;
  source: SourceImage;
  mask: MaskSettings;
  settings: ImageSettings;
  color: string | null;
  background: string | null;
  glow: boolean;
};

export const IMAGE_PROJECT_VERSION = 1;
export const IMAGE_COLOR = "#b43cff";
export const MAX_SOURCE_SIZE = 512;
export const MASK_DEFAULTS = Object.freeze({ resolution: 96, channel: "auto", threshold: 96, invert: false, trim: true, shape: "outline", shaded: false });
export const IMAGE_DEFAULTS = Object.freeze({ motion: "rotate", degreesPerSecond: 30, density: 0.7, interval: 4, lifetime: 0.4, drift: 2, gravity: 0, turbulence: 0.03 });

function number(value: unknown, name: string, low: number, high: number, integer = false) {
  if (!Number.isFinite(value) || (value as number) < low || (value as number) > high || (integer && !Number.isInteger(value)))
    throw new RangeError(`Invalid ${name}; expected ${low}–${high}`);
  return value as number;
}
function choice(value: unknown, choices: string[], name: string) {
  if (!choices.includes(value as string)) throw new RangeError(`Invalid ${name}`);
  return value as string;
}
function bool(value: unknown, name: string) {
  if (typeof value !== "boolean") throw new RangeError(`Invalid ${name}`);
  return value;
}
export function maskSettings(input: unknown = {}): MaskSettings {
  const p = { ...MASK_DEFAULTS, ...((input ?? {}) as MaskSettingsInput) };
  return {
    resolution: number(p.resolution, "resolution", 8, 192, true),
    channel: choice(p.channel, ["auto", "alpha", "luminance"], "mask channel"),
    threshold: number(p.threshold, "threshold", 1, 255, true),
    invert: bool(p.invert, "invert"), trim: bool(p.trim, "trim"),
    shape: choice(p.shape, ["outline", "fill"], "shape"), shaded: bool(p.shaded, "shaded density"),
  };
}
export function imageSettings(input: unknown = {}): ImageSettings {
  const p = { ...IMAGE_DEFAULTS, ...((input ?? {}) as ImageSettingsInput) };
  return {
    motion: choice(p.motion, ["static", "rotate"], "motion"),
    degreesPerSecond: number(p.degreesPerSecond, "rotation speed", -180, 180),
    density: number(p.density, "density", 0.01, 1),
    interval: number(p.interval, "emission interval", 1, 12, true),
    lifetime: number(p.lifetime, "lifetime", 0.1, 3),
    drift: number(p.drift, "drift", 0, 40),
    gravity: number(p.gravity, "gravity", -100, 100),
    turbulence: number(p.turbulence, "turbulence", 0, 0.5),
  };
}
function bytes(value: unknown, length: number, name: string): Uint8Array {
  const data = value as ByteLike;
  if ((!Array.isArray(data) && !(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) || data.length !== length)
    throw new RangeError(`Invalid ${name} data`);
  for (const n of data) number(n, name, 0, 255, true);
  return Uint8Array.from(data);
}
export function validateSource(source: unknown): SourceImage {
  if (!source || typeof source !== "object") throw new RangeError("Missing source image");
  const record = source as {width?: unknown; height?: unknown; rgba?: unknown};
  const width = number(record.width, "source width", 1, MAX_SOURCE_SIZE, true);
  const height = number(record.height, "source height", 1, MAX_SOURCE_SIZE, true);
  return { width, height, rgba: bytes(record.rgba, width * height * 4, "source pixels") };
}
export function validateMask(mask: unknown): Mask {
  if (!mask || typeof mask !== "object") throw new RangeError("Missing emission mask");
  const record = mask as {width?: unknown; height?: unknown; values?: unknown};
  const width = number(record.width, "mask width", 1, 192, true);
  const height = number(record.height, "mask height", 1, 192, true);
  return { width, height, values: bytes(record.values, width * height, "mask pixels") };
}
export function validateProject(input: unknown): ImageProject {
  const p = (input ?? {}) as ProjectInput;
  if (p.format !== "noita-image-emitter" || p.version !== IMAGE_PROJECT_VERSION)
    throw new RangeError("Unsupported image-emitter project format/version");
  if (typeof p.name !== "string" || p.name.length > 120) throw new RangeError("Invalid project name");
  return {
    format: "noita-image-emitter", version: IMAGE_PROJECT_VERSION, name: p.name,
    source: validateSource(p.source), mask: maskSettings(p.mask), settings: imageSettings(p.settings),
    color: validateColor(p.color), background: validateColor(p.background),
    glow: p.glow === undefined ? true : bool(p.glow, "glow"),
  };
}
export function serializeProject(project: unknown) {
  const p = validateProject(project);
  return JSON.stringify({ ...p, source: { ...p.source, rgba: Array.from(p.source.rgba) } });
}

export function convertMask(source: unknown, settings: unknown = {}) {
  const { width: sw, height: sh, rgba } = validateSource(source), p = maskSettings(settings);
  let hasTransparency = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) { hasTransparency = true; break; }
  const channel = p.channel === "auto" ? (hasTransparency ? "alpha" : "luminance") : p.channel;
  const coverage = new Uint8Array(sw * sh);
  let left = sw, top = sh, right = -1, bottom = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (y * sw + x) * 4;
    // Transparency always gates inclusion, even for an inverted brightness mask.
    const luma = (54 * rgba[i] + 183 * rgba[i + 1] + 19 * rgba[i + 2]) / 256;
    const value = channel === "alpha" ? rgba[i + 3] : Math.round(rgba[i + 3] * (p.invert ? 255 - luma : luma) / 255);
    coverage[y * sw + x] = value;
    if (value >= p.threshold) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  if (right < left) return { width: 1, height: 1, values: new Uint8Array(1), channel };
  if (!p.trim) { left = top = 0; right = sw - 1; bottom = sh - 1; }
  const cw = right - left + 1, ch = bottom - top + 1;
  const scale = p.resolution / Math.max(cw, ch);
  const width = Math.max(1, Math.round(cw * scale)), height = Math.max(1, Math.round(ch * scale));
  const fill = new Uint8Array(width * height);
  // Nearest-neighbour sampling keeps authored pixel edges sharp and predictable.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = left + Math.min(cw - 1, Math.floor((x + 0.5) * cw / width));
    const sy = top + Math.min(ch - 1, Math.floor((y + 0.5) * ch / height));
    const value = coverage[sy * sw + sx];
    fill[y * width + x] = value >= p.threshold ? (p.shaded ? value : 255) : 0;
  }
  const values = fill.slice();
  if (p.shape === "outline") for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (fill[i - 1] && fill[i + 1] && fill[i - width] && fill[i + width]) values[i] = 0;
  }
  return { width, height, values, channel };
}
export function emissionPoints(mask: unknown, density = 1): EmissionPoint[] {
  const m = validateMask(mask);
  number(density, "density", 0.01, 1);
  const points: EmissionPoint[] = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const probability = Math.round(m.values[y * m.width + x] * density);
    if (probability) points.push({ x: x - m.width / 2 + 0.5, y: y - m.height / 2 + 0.5, probability });
  }
  return points;
}
export function emissionEstimate(mask: unknown, settings?: unknown) {
  const p = imageSettings(settings), points = emissionPoints(mask, p.density);
  const perSecond = points.reduce((sum, point) => sum + point.probability / 255, 0) * 60 / p.interval;
  return { points: points.length, perSecond, live: perSecond * p.lifetime };
}
export function emitterPixels(mask: unknown, density = 1) {
  const m = validateMask(mask);
  number(density, "density", 0.01, 1);
  const rgba = new Uint8ClampedArray(m.width * m.height * 4);
  for (let i = 0; i < m.values.length; i++) {
    rgba[i * 4] = Math.round(m.values[i] * density);
    // G=0 is a continuously selected bucket with image_animation_speed=0.
    // A=255 is deliberate: transparent RGB can be destroyed by image editors.
    rgba[i * 4 + 3] = 255;
  }
  return { width: m.width, height: m.height, rgba };
}
