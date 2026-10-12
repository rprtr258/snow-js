import { createFrameEncoder, FrameEncoder } from "./animation-encoders";
import { Rect } from "./types";
let encode: FrameEncoder | null = null,
  canvas: OffscreenCanvas | null = null,
  context: OffscreenCanvasRenderingContext2D | null = null,
  crop: Rect | null = null;
globalThis.onmessage = async ({ data }) => {
  try {
    if (data.type === "configure") {
      const { width, height } = data.options;
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!context || typeof createImageBitmap !== "function") throw new Error("Frame workers are unavailable.");
      crop = data.crop;
      context.imageSmoothingEnabled = !data.pixelated && (width < crop!.width || height < crop!.height);
      context.imageSmoothingQuality = "high";
      encode = await createFrameEncoder(data.format, data.options);
      postMessage({ ready: true });
    } else if (data.type === "frame") {
      const bitmap = await createImageBitmap(data.blob);
      try { context!.drawImage(bitmap, crop!.x, crop!.y, crop!.width, crop!.height, 0, 0, canvas!.width, canvas!.height); }
      finally { bitmap.close(); }
      const rgba = context!.getImageData(0, 0, canvas!.width, canvas!.height).data;
      const bytes = await encode!(rgba, data.index, canvas!);
      postMessage({ bytes }, [bytes.buffer as ArrayBuffer]);
    }
  } catch (error) { postMessage({ error: (error as Error).message }); }
};
