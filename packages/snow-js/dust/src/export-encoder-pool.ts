// Each helper decodes/resizes/compresses one independent frame. No simulation
// state crosses workers, and the caller assembles results in timeline order.
type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
};
type WorkerSlot = {worker: Worker; pending: Pending | null};
export class ExportEncoderPool {
  declare size: number;
  declare workers: WorkerSlot[];
  declare closed: boolean;
  constructor(size: number, WorkerClass: typeof Worker = globalThis.Worker) {
    this.size = size; this.workers = []; this.closed = false;
    try {
      for (let i = 0; i < size; i++) {
        const worker = new WorkerClass(new URL("./export-frame-worker.js", import.meta.url), { type: "module" });
        const slot: WorkerSlot = { worker, pending: null };
        worker.onmessage = ({ data }) => {
          const pending = slot.pending; if (!pending) return;
          slot.pending = null; if (pending.timer != null) clearTimeout(pending.timer);
          if (data.error) pending.reject(new Error(data.error));
          else pending.resolve(data.bytes);
        };
        worker.onerror = event => { event.preventDefault?.(); this.dispose(new Error(event.message || "Export helper unavailable.")); };
        worker.onmessageerror = () => this.dispose(new Error("Export helper response unavailable."));
        this.workers.push(slot);
      }
    } catch (error) { this.dispose(error); throw error; }
  }
  request(slot: WorkerSlot, data: unknown, initializing = false): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Export helpers stopped."));
    if (slot.pending) return Promise.reject(new Error("Export helper already busy."));
    return new Promise<unknown>((resolve, reject) => {
      const timer = initializing ? setTimeout(() => this.dispose(new Error("Export helper did not initialize.")), 15000) : null;
      slot.pending = { resolve, reject, timer };
      try { slot.worker.postMessage(data); }
      catch (error) { this.dispose(error); }
    });
  }
  async configure(format: string, options: unknown, crop: unknown, pixelated: boolean) {
    await Promise.all(this.workers.map(slot => this.request(slot, { type: "configure", format, options, crop, pixelated }, true)));
  }
  encode(index: number, blob: Blob) { return this.request(this.workers[index % this.size], { type: "frame", index, blob }); }
  dispose(error: unknown = new Error("Export cancelled.")) {
    this.closed = true;
    for (const slot of this.workers) {
      slot.worker.terminate();
      if (slot.pending) { if (slot.pending.timer != null) clearTimeout(slot.pending.timer); slot.pending.reject(error); slot.pending = null; }
    }
    this.workers = [];
  }
}
