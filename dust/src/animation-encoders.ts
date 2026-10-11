import { APNGMuxer, WebPMuxer, AVIFMuxer } from "./animation-containers";
import { GIFEncoder } from "gifenc";
import { paletteMapper } from "./gif-tools";
import { animationFormat } from "./animation-formats";

const modules = new Map<
  string,
  Promise<{module: CodecModule; defaultOptions: Record<string, unknown>}>
>();
export type CodecModule = {
  encode(
    input: Uint8Array,
    width: number,
    height: number,
    options: unknown,
  ): Uint8Array | null | undefined;
};
export type EncodeCanvas = {
  width: number;
  height: number;
  convertToBlob?(options?: {type?: string}): Promise<Blob>;
  toBlob?(callback: (blob: Blob | null) => void, type?: string): void;
};
export type AnimationOptions = {
  count: number;
  width: number;
  height: number;
  delay: number;
  loop: boolean;
  palette?: number[][] | null;
  compact?: boolean;
};
export type AnimationMuxer = {
  add(bytes: Uint8Array): void;
  readonly byteLength: number;
  finish(): Uint8Array;
};
export type FrameEncoder = (
  rgba: Uint8ClampedArray,
  index: number,
  canvas?: EncodeCanvas,
) => Promise<Uint8Array>;
async function codecModule(format: string): Promise<{module: CodecModule; defaultOptions: Record<string, unknown>}> {
  if (!modules.has(format)) modules.set(format, (async () => {
    const [{ default: factory }, { defaultOptions }] = await Promise.all([
      import(`./vendor/jsquash/${format}-enc.mjs`), import(`./vendor/jsquash/${format}-options.mjs`),
    ]);
    // Explicit single-thread builds work on static hosts without
    // SharedArrayBuffer or isolation headers. WebP uses its scalar build.
    const module = await factory({ noInitialRun: true, locateFile: (file: string) => new URL(`./vendor/jsquash/${file}`, import.meta.url).href });
    return { module, defaultOptions };
  })().catch(error => { modules.delete(format); throw error; }));
  return modules.get(format)!;
}
export async function prepareEncoder(format: string) {
  animationFormat(format);
  if (format === "webp" || format === "avif") await codecModule(format);
}
export function canvasPNG(canvas: EncodeCanvas): Promise<Blob> {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => canvas.toBlob!(blob => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png"));
}
// In lossless WebP, "quality" controls compression effort, not pixel fidelity.
// Use a faster search for ordinary exports. A requested file cap retains the
// compact settings, helping preserve dimensions before the fitting pass.
// https://developers.google.com/speed/webp/docs/api#advanced_encoding_api
export function webpLosslessOptions(compact = false) {
  return { lossless: 1, quality: compact ? 100 : 25, method: compact ? 4 : 1,
    exact: 1, near_lossless: 100, alpha_quality: 100 };
}
// Frame compression is independent; headers and timing are assembled in order.
// GIF fragments omit the signature/trailer and carry the global palette only
// on frame zero, exactly as the original sequential encoder did.
export function createAnimationMuxer(format: string, options: AnimationOptions): AnimationMuxer {
  animationFormat(format);
  if (format === "gif") {
    const encoder = GIFEncoder({ auto: false }); let frames = 0;
    encoder.writeHeader();
    return {
      add(bytes: Uint8Array) { encoder.stream.writeBytesView(bytes); frames++; },
      get byteLength() { return encoder.bytesView().byteLength + 1; },
      finish() { if (frames !== options.count) throw new Error("Incomplete GIF animation."); encoder.finish(); return encoder.bytes(); },
    };
  }
  return format === "apng" ? new APNGMuxer(options) : format === "webp" ? new WebPMuxer(options) : new AVIFMuxer(options);
}
export async function createFrameEncoder(format: string, options: AnimationOptions): Promise<FrameEncoder> {
  animationFormat(format);
  const { width, height, delay, loop, palette } = options;
  if (format === "gif") {
    const encoder = GIFEncoder({ auto: false }), map = paletteMapper(palette!);
    return async (rgba: Uint8ClampedArray, index: number) => {
      encoder.reset();
      encoder.writeFrame(map(rgba, width, height), width, height, { first: index === 0, palette: index === 0 ? palette : null, delay, repeat: loop ? 0 : -1, dispose: 1 });
      return encoder.bytes();
    };
  }
  if (format === "apng") {
    return async (rgba: Uint8ClampedArray, index: number, canvas?: EncodeCanvas) => new Uint8Array(await (await canvasPNG(canvas!)).arrayBuffer());
  }
  const { module, defaultOptions } = await codecModule(format);
  const encoderOptions = format === "webp"
    ? { ...defaultOptions, ...webpLosslessOptions(options.compact) }
    : { ...defaultOptions, lossless: true, quality: 100, qualityAlpha: -1, subsample: 3, speed: 8 };
  return async (rgba: Uint8ClampedArray) => {
    const input = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const bytes = module.encode(input, width, height, encoderOptions);
    if (!bytes) throw new Error(`${animationFormat(format).label} encoding failed.`);
    return bytes.slice();
  };
}
export async function createAnimationEncoder(format: string, options: AnimationOptions) {
  const muxer = createAnimationMuxer(format, options), encode = await createFrameEncoder(format, options);
  let index = 0;
  return {
    async add(rgba: Uint8ClampedArray, canvas?: EncodeCanvas) { muxer.add(await encode(rgba, index++, canvas)); },
    get byteLength() { return muxer.byteLength; }, finish: () => muxer.finish(),
  };
}
