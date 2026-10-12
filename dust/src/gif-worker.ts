import { createAnimation } from "./gif-create";
import { ExportSession } from "./export-session";
let session: ExportSession | undefined, busy = false;
globalThis.onmessage = async ({ data }) => {
  if (busy) return;
  busy = true;
  try {
    let offscreen2D = false;
    try { offscreen2D = typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d"); } catch { /* DOM fallback. */ }
    if (!offscreen2D) { postMessage({ type: "fallback" }); return; }
    session ??= new ExportSession(data.cacheOwner);
    const result = await createAnimation(data, progress => postMessage({ type: "progress", ...progress }), () => false, session);
    postMessage({ type: "done", ...result, bytes: result.bytes.buffer }, [result.bytes.buffer]);
  } catch (error) { postMessage({ type: "error", message: (error as Error).message }); }
  finally { busy = false; }
};
