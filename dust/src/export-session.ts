import { ExportFrameCache, exportCacheId } from "./export-frame-cache";
import { ExportEncoderPool } from "./export-encoder-pool";
import { GifTiming } from "./gif-tools";
import { Bounds } from "./types";

type ExportAssets = {buffer: ArrayBuffer; kernelModule: WebAssembly.Module | null};
// A captured animation, reused when only format/scale change.
export type ExportCapture = {
  key: string;
  frames: ExportFrameCache;
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
  backgrounds: number[][];
  pixelated: boolean;
  bounds: Bounds;
  samples: Uint8Array;
  timing: GifTiming;
  warmOffset: number;
  loopPlanSource: string | null;
  palette?: number[][] | null;
};

// Format, output size and file budget do not change the captured animation.
// Include the complete scene/settings/catalog so custom images and physics
// edits cannot accidentally reuse another figure's frames.
export function captureKey(config: Record<string, unknown>) {
  const { format, scale, limitSize, optimize, filename, label, crop, cacheOwner, ...scene } = config;
  return JSON.stringify(scene);
}
export class ExportSession {
  declare owner: string;
  declare workerLimit: number;
  declare capture: ExportCapture | null;
  declare pendingFrames: ExportFrameCache | null;
  declare assets: Promise<ExportAssets> | null;
  declare pool: ExportEncoderPool | null;
  declare parallelUnavailable: boolean;
  constructor(owner = exportCacheId(), { workers = 4 }: {workers?: number} = {}) {
    this.owner = owner; this.workerLimit = workers; this.capture = null; this.pendingFrames = null; this.assets = null; this.pool = null; this.parallelUnavailable = false;
  }
  encoderPool(size: number): ExportEncoderPool {
    if (this.pool?.size !== size || this.pool?.closed) { this.pool?.dispose(); this.pool = new ExportEncoderPool(size); }
    return this.pool!;
  }
  async clearCapture() {
    const frames = new Set<ExportFrameCache | null | undefined>([this.capture?.frames, this.pendingFrames]);
    this.capture = null; this.pendingFrames = null;
    for (const cache of frames) await cache?.dispose();
  }
  async dispose() { this.pool?.dispose(); this.pool = null; await this.clearCapture(); this.assets = null; }
}
