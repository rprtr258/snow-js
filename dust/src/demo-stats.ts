import { Asset } from "./types";
import { FRAME_MS } from "./timing";

export const FRAME_BUDGET = FRAME_MS;
export const STATS_INTERVAL = 250;

type MemoryViewer = {
  renderer: {
    native?: object | null;
    monochromeTextures?: {values(): IterableIterator<{rgba: ArrayBufferView}>};
  };
  resources: {assets: Record<string, Asset>};
};
type FrameSample = {
  now: number;
  interval: number | null;
  cpuMS: number;
  drawMS: number;
  latencyMS: number;
};

// These are known allocations, not total process RAM.
export function bufferMemory(viewer: MemoryViewer) {
  const buffers = new Set<ArrayBufferLike>();
  const add = (value: unknown) => {
    if (ArrayBuffer.isView(value) && value.buffer.byteLength) buffers.add(value.buffer);
  };
  for (const value of Object.values(viewer.renderer)) add(value);
  for (const value of Object.values(viewer.renderer.native ?? {})) add(value);
  for (const image of viewer.renderer.monochromeTextures?.values() ?? []) add(image.rgba);
  for (const asset of Object.values(viewer.resources.assets)) add(asset.rgba);
  return { cpuBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) };
}

export class FrameSamples {
  declare rows: FrameSample[];
  declare lastFrame: number | null;
  constructor() { this.clear(); }
  clear() { this.rows = []; this.lastFrame = null; }
  add(now: number, cpuMS: number, drawMS: number, latencyMS: number) {
    const interval = this.lastFrame === null ? null : now - this.lastFrame;
    this.lastFrame = now;
    this.rows.push({ now, interval, cpuMS, drawMS, latencyMS });
    while (this.rows.length > 120 || (this.rows.length > 1 && now - this.rows[0].now > 2000)) this.rows.shift();
  }
  summary() {
    const average = (key: keyof FrameSample) => {
      const values = this.rows.map(row => row[key]).filter((value): value is number => Number.isFinite(value));
      return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
    };
    const frameMS = average("interval"), cpuMS = average("cpuMS"), drawMS = average("drawMS");
    return { frameMS, fps: frameMS !== null && frameMS > 0 ? 1000 / frameMS : null, cpuMS, drawMS,
      cpuBudget: cpuMS === null || drawMS === null ? null : (cpuMS + drawMS) / FRAME_BUDGET * 100,
      latencyMS: average("latencyMS") };
  }
}

export const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`;
export const ms = (value: number) => Number.isFinite(value) ? `${value.toFixed(1)} ms` : "Sampling…";
export function pressureLabel(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return "Unavailable";
  const percent = milliseconds / FRAME_BUDGET * 100;
  return `${percent.toFixed(0)}% budget · ${ms(milliseconds)} · ${percent > 100 ? "over budget" : percent > 75 ? "busy" : "headroom"}`;
}
