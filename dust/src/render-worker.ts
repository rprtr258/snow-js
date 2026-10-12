import { ViewerRuntime } from "./viewer-runtime";
let runtime: ViewerRuntime | undefined;
globalThis.onmessage = ({ data }) => {
  try {
    let result: ReturnType<ViewerRuntime["frame"]>;
    if (data.type === "init") {
      runtime = new ViewerRuntime(
        data.catalog,
        data.buffer,
        data.width,
        data.height,
        data.kernelModule,
        { scale: data.scale, renderKernelModule: data.renderKernelModule },
      );
      runtime.restart(data.replay, data.revision);
      result = runtime.frame({
        paused: true,
        redraw: true,
        options: data.options,
      });
    } else if (data.type === "restart") {
      runtime!.restart(data.replay, data.revision);
      result = runtime!.frame({
        paused: true,
        redraw: true,
        options: data.options,
        recycle: data.recycle,
      });
    } else if (data.type === "frame") {
      if (data.revision !== runtime!.revision) {
        postMessage({ type: "frame", revision: runtime!.revision, stale: true });
        return;
      }
      result = runtime!.frame(data);
    } else throw new Error("Unknown worker request");
    const buffer = result.pixels?.buffer;
    postMessage({ ...result, type: data.type, pixels: buffer }, buffer ? [buffer as ArrayBuffer] : []);
  } catch (error) {
    postMessage({
      type: "error",
      request: data.type,
      revision: data.revision,
      message: (error as Error).message,
    });
  }
};
