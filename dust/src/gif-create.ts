import { animationFormat } from "./animation-formats";
import { createAnimationEncoder, createAnimationMuxer, canvasPNG } from "./animation-encoders";
import { loadRasterModule } from "./wasm-raster";
import { GifScene, gifSurface, GifSurface, GifConfig } from "./gif-renderer";
import { planExportLoop } from "./export-loop-plans";
import { ExportFrameCache } from "./export-frame-cache";
import { ExportSession, captureKey } from "./export-session";
import { exportConcurrency, orderedPipeline } from "./export-pipeline";
import { GIF_LIMIT, GIF_FPS, gifTiming, gifOutputSize, gifOverlap, gifSample, extendBounds, cropBounds, gifPalette, fitGif, blendLoopFrames } from "./gif-tools";
import { Bounds, Catalog } from "./types";

export type AnimationRequest = GifConfig & {
  format?: string;
  speed?: number;
  scale?: number;
  limitSize?: boolean;
  seconds?: number;
  optimize?: boolean;
  catalog?: Catalog;
  crop?: boolean;
  filename?: string;
  label?: string;
  cacheOwner?: string;
  [key: string]: unknown;
};
export type AnimationProgress = {
  stage: string;
  completed: number;
  total: number;
  attempt?: number;
};

export async function createAnimation(
  config: AnimationRequest,
  progress: (progress: AnimationProgress) => void = () => {},
  cancelled: () => boolean = () => false,
  reusableSession: ExportSession | null = null,
) {
  const format = config.format ?? "gif", formatInfo = animationFormat(format);
  const speed = config.speed ?? 1, scale = config.scale ?? 2, session = reusableSession ?? new ExportSession();
  const limit = config.limitSize === true ? GIF_LIMIT : Infinity;
  gifOutputSize({ x: 0, y: 0, width: 1, height: 1 }, { width: 1, height: 1, baseWidth: 1, baseHeight: 1 }, scale);
  let timing = gifTiming(config.seconds!, speed);
  const check = () => { if (cancelled()) throw new Error("Export cancelled."); };
  let lastYield = 0;
  const report = async (stage: string, i: number, attempt = 0, total = timing.count) => {
    check();
    if (performance.now() - lastYield < 80 && i !== total) return;
    progress({ stage, completed: i, total, attempt });
    await new Promise(resolve => setTimeout(resolve, 0));
    lastYield = performance.now(); check();
  };
  progress({ stage: "Loading animation", completed: 0, total: timing.count });
  if (!session.assets) session.assets = Promise.all([fetch(new URL("./assets/effects.bin", import.meta.url)), loadRasterModule()])
    .then(async ([response, kernelModule]) => {
      if (!response.ok) throw new Error("Could not load particle assets for export.");
      return { buffer: await response.arrayBuffer(), kernelModule };
    }).catch(error => { session.assets = null; throw error; });
  const loaded = (await session.assets)!;
  const assets = { ...loaded, catalog: config.catalog! };
  check();
  let scene: GifScene | null = null, head: GifScene | null = null, surface: GifSurface | null = null, headSurface: GifSurface | null = null;
  let frames: ExportFrameCache | null = null, warmOffset = 0, loopPlanSource: string | null = null;
  let width!: number, height!: number, baseWidth!: number, baseHeight!: number, backgrounds!: number[][], pixelated!: boolean, bounds!: Bounds, samples!: Uint8Array;
  let parallelWorkers = 0;
  const disposeScenes = () => { scene?.dispose(); head?.dispose(); scene = head = null; };
  const prepareScenes = async () => {
    scene = new GifScene(config, assets); scene.warmFrames += warmOffset;
    await scene.prepare((i, total) => report("Preparing full trails", i, 0, total));
    if (config.loop) {
      head = new GifScene(config, assets); head.warmFrames += warmOffset;
      await head.prepare((i, total) => report("Preparing loop overlap", i, 0, total));
      if (!headSurface) headSurface = gifSurface(surface!.canvas.width, surface!.canvas.height);
    }
  };
  const key = captureKey(config);
  const previous = session.capture?.key === key && session.capture.frames.available ? session.capture : null;
  const reused = !!previous;
  try {
    if (previous) {
      ({ width, height, baseWidth, baseHeight, backgrounds, pixelated, bounds, samples, timing, warmOffset, loopPlanSource, frames } = previous);
      await report("Reusing captured animation", 1, 0, 1);
    } else {
      await session.clearCapture();
      scene = new GifScene(config, assets);
      ({ width, height, baseWidth, baseHeight } = scene);
      if (config.loop) {
        const match = await planExportLoop(scene.simulations(), scene.warmFrames, timing.period, speed,
          (i, total) => report("Matching custom motion", i, 0, total));
        timing = gifTiming(match!.period / (60 * speed), speed);
        warmOffset = match!.offset; loopPlanSource = match!.source;
        scene.warmFrames += warmOffset;
      }
      await scene.prepare((i, total) => report("Preparing full trails", i, 0, total));
      if (config.loop) {
        head = new GifScene(config, assets); head.warmFrames += warmOffset;
        await head.prepare((i, total) => report("Preparing loop overlap", i, 0, total));
        headSurface = gifSurface(width, height);
      }
      backgrounds = scene.backgrounds; pixelated = !!scene.pixelated;
    }
    const overlap = config.loop ? gifOverlap(timing, speed) : 0;
    const full = { x: 0, y: 0, width, height };
    surface = gifSurface(width, height);
    const drawFrame = (i: number, crop: {x: number; y: number; width: number; height: number}, size: {width: number; height: number}) => {
      const sample = gifSample(timing, i, overlap);
      scene!.advance(scene!.warmFrames + sample.main);
      scene!.draw(surface!.context, crop, size.width, size.height);
      const image = surface!.context.getImageData(0, 0, size.width, size.height);
      if (head && sample.blend > 0) {
        head.advance(head.warmFrames + sample.head);
        head.draw(headSurface!.context, crop, size.width, size.height);
        const next = headSurface!.context.getImageData(0, 0, size.width, size.height).data;
        blendLoopFrames(image.data, next, 1 - sample.head / overlap);
        surface!.context.putImageData(image, 0, 0);
      }
      return image.data;
    };
    if (!previous) {
      const background = scene!.background.context.getImageData(0, 0, width, height).data;
      bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      const samplesPerFrame = Math.max(64, Math.floor(262144 / timing.count));
      // Retain palette samples even for a full-color first export, so selecting
      // GIF later needs no second render pass.
      samples = new Uint8Array(samplesPerFrame * timing.count * 4);
      frames = new ExportFrameCache(session.owner);
      session.pendingFrames = frames;
      if (typeof createImageBitmap !== "function") await frames.dispose();
      // convertToBlob snapshots the canvas before returning its promise. Keep
      // drawing native ticks while the browser compresses earlier snapshots.
      const depth = Math.max(1, exportConcurrency(width, height, session.workerLimit));
      await orderedPipeline(timing.count, depth, i => {
        check();
        const rgba = drawFrame(i, full, full);
        extendBounds(bounds, rgba, background, width, height);
        for (let j = 0; j < samplesPerFrame; j++) {
          const pixel = Math.min(width * height - 1, Math.floor((j + ((i * 0.61803398875) % 1)) * width * height / samplesPerFrame));
          samples.set(rgba.subarray(pixel * 4, pixel * 4 + 4), (i * samplesPerFrame + j) * 4);
        }
        if (!frames!.available) return null;
        try { return canvasPNG(surface!.canvas).catch(() => null); }
        catch { return null; }
      }, async (blob, i) => {
        check();
        if (blob) await frames!.add(blob);
        else if (frames!.available) await frames!.dispose();
        await report("Capturing original-speed animation", i + 1);
      });
      disposeScenes();
      session.capture = { key, frames: frames!, width, height, baseWidth, baseHeight, backgrounds, pixelated, bounds, samples, timing, warmOffset, loopPlanSource };
      session.pendingFrames = null;
    }
    const crop = cropBounds(bounds, width, height, config.crop);
    const requested = gifOutputSize(crop, { width, height, baseWidth, baseHeight }, scale);
    await report(`Preparing ${formatInfo.label}`, timing.count);
    const palette = format === "gif" ? (session.capture!.palette ??= gifPalette(samples, backgrounds)) : null;
    const result = await fitGif(requested, async (size, attempt, budget) => {
      const options = { ...size, count: timing.count, delay: timing.delay, loop: !!config.loop, palette,
        compact: config.limitSize === true || config.optimize === true };
      const workers = exportConcurrency(size.width, size.height, session.workerLimit);
      if (frames!.available && workers && !session.parallelUnavailable && typeof Worker === "function") {
        try {
          const pool = session.encoderPool(workers);
          await pool.configure(format, options, crop, pixelated); check();
          const muxer = createAnimationMuxer(format, options);
          let estimate: number | undefined;
          await orderedPipeline(timing.count, workers, async i => {
            check();
            const blob = await frames!.get(i);
            if (!blob) { await frames!.dispose(); throw new Error("Temporary capture was evicted."); }
            return pool.encode(i, blob);
          }, async (bytes, i) => {
            check(); muxer.add(bytes as Uint8Array);
            await report(attempt === 1 ? `Encoding ${scale}× ${formatInfo.label} · ${workers} worker${workers === 1 ? "" : "s"}` : "Fitting below 10 MB", i + 1, attempt);
            if (muxer.byteLength >= budget) { estimate = muxer.byteLength * timing.count / (i + 1); return false; }
          });
          parallelWorkers = workers;
          if (estimate !== undefined) return { estimatedBytes: estimate };
          const bytes = muxer.finish(); return { bytes, estimatedBytes: bytes.length };
        } catch {
          session.pool?.dispose(); session.pool = null; session.parallelUnavailable = true;
          check(); // Cancellation must not start a replacement export.
          // Unsupported or failed helpers retry this attempt through the same
          // serial encoder, preserving all frames, settings and file limits.
        }
      }
      if (!frames!.available) await prepareScenes();
      surface!.canvas.width = size.width; surface!.canvas.height = size.height;
      if (headSurface) { headSurface.canvas.width = size.width; headSurface.canvas.height = size.height; }
      const encoder = await createAnimationEncoder(format, options);
      try {
        for (let i = 0; i < timing.count; i++) {
          const blob = frames!.available ? await frames!.get(i) : null;
          if (blob) {
            const bitmap = await createImageBitmap(blob);
            try {
              surface!.context.imageSmoothingEnabled = !pixelated && (size.width < crop.width || size.height < crop.height);
              surface!.context.imageSmoothingQuality = "high";
              surface!.context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
            } finally { bitmap.close(); }
          } else if (!scene) {
            // Storage eviction or quota failure must not turn into a failed
            // download. Replay the identical native capture instead.
            await frames!.dispose(); await prepareScenes();
          }
          const rgba = blob ? surface!.context.getImageData(0, 0, size.width, size.height).data : drawFrame(i, crop, size);
          await encoder.add(rgba, surface!.canvas);
          await report(attempt === 1 ? `Encoding ${scale}× ${formatInfo.label}` : "Fitting below 10 MB", i + 1, attempt);
          if (encoder.byteLength >= budget) return { estimatedBytes: encoder.byteLength * timing.count / (i + 1) };
        }
        const bytes = encoder.finish(); return { bytes, estimatedBytes: bytes.length };
      } finally { disposeScenes(); }
    }, limit);
    check();
    return { bytes: result.bytes, width: result.width, height: result.height, fps: GIF_FPS,
      format, mime: formatInfo.mime, extension: formatInfo.extension,
      seconds: timing.count / GIF_FPS, requestedSeconds: config.seconds, speed, scale,
      baseWidth: requested.baseWidth, baseHeight: requested.baseHeight, fitted: result.width !== requested.width || result.height !== requested.height,
      crop, loop: !!config.loop, loopMatch: config.loop ? "native-motion" : null, loopPlanSource, captureReused: reused, parallelWorkers };
  } finally {
    disposeScenes();
    if (session.pendingFrames) { await session.pendingFrames.dispose(); session.pendingFrames = null; }
    if (!reusableSession) await session.dispose();
    if (surface) surface.canvas.width = surface.canvas.height = 1;
    if (headSurface) headSurface.canvas.width = headSurface.canvas.height = 1;
  }
}
export const createGif = createAnimation;
