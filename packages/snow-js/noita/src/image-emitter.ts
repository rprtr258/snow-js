// Original image-authoring format. Source RGB is used only for luminance masks,
// never as particle color. Native emitter PNGs contain probability/time data.
import {
  EmissionPoint,
  ImageSettings,
  ImageSettingsInput,
  Mask,
} from "./types";

type ByteLike = number[] | Uint8Array | Uint8ClampedArray;

export const IMAGE_COLOR = "#b43cff";
const IMAGE_DEFAULTS = Object.freeze({ motion: "rotate", degreesPerSecond: 30, density: 0.7, interval: 4, lifetime: 0.4, drift: 2, gravity: 0, turbulence: 0.03 });

function number(value: unknown, name: string, low: number, high: number, integer = false) {
  if (!Number.isFinite(value) || (value as number) < low || (value as number) > high || (integer && !Number.isInteger(value)))
    throw new RangeError(`Invalid ${name}; expected ${low}–${high}`);
  return value as number;
}
function choice(value: unknown, choices: string[], name: string) {
  if (!choices.includes(value as string)) throw new RangeError(`Invalid ${name}`);
  return value as string;
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
export function validateMask(mask: unknown): Mask {
  if (!mask || typeof mask !== "object") throw new RangeError("Missing emission mask");
  const record = mask as {width?: unknown; height?: unknown; values?: unknown};
  const width = number(record.width, "mask width", 1, 192, true);
  const height = number(record.height, "mask height", 1, 192, true);
  return { width, height, values: bytes(record.values, width * height, "mask pixels") };
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
