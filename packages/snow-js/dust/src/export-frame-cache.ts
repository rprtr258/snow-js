// Lossless, temporary capture storage. Keep small clips in RAM, spill larger
// clips to IndexedDB, and remove them when the export dialog closes.
const DATABASE = "dust-export-frames-v1", STORE = "frames";
const MEMORY_LIMIT = 64 * 1024 * 1024, DISK_LIMIT = 512 * 1024 * 1024;
export function exportCacheId() {
  const bytes = new Uint32Array(2);
  if (typeof globalThis.crypto?.getRandomValues === "function") crypto.getRandomValues(bytes);
  else { bytes[0] = Math.random() * 0xffffffff; bytes[1] = Math.random() * 0xffffffff; }
  return `${Date.now()}-${bytes[0].toString(16)}-${bytes[1].toString(16)}`;
}
async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error("Temporary frame storage is unavailable");
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { const store = request.result.createObjectStore(STORE, { keyPath: ["owner", "index"] }); store.createIndex("created", "created"); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Temporary frame storage is blocked")); };
  });
}
function transaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = database.transaction(STORE, mode, { durability: "relaxed" }); }
    catch { tx = database.transaction(STORE, mode); }
    let request: IDBRequest<T> | undefined;
    try { request = action(tx.objectStore(STORE)) ?? undefined; } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Temporary frame storage failed"));
  });
}
const ownerRange = (owner: string) => IDBKeyRange.bound([owner, 0], [owner, 0xffffffff]);
export async function clearExportFrames(owner: string) {
  if (!owner || !globalThis.indexedDB) return;
  let database: IDBDatabase | undefined;
  try { database = await openDatabase(); await transaction(database, "readwrite", store => store.delete(ownerRange(owner))); }
  catch { /* Cleanup must not interrupt playback. */ }
  finally { database?.close(); }
}
export class ExportFrameCache {
  declare frames: Blob[];
  declare count: number;
  declare bytes: number;
  declare available: boolean;
  declare closed: boolean;
  declare created: number;
  declare diskLimit: number;
  declare database: IDBDatabase | null;
  declare memoryLimit: number;
  declare owner: string;
  constructor(owner = exportCacheId(), { memoryLimit = MEMORY_LIMIT, diskLimit = DISK_LIMIT }: {memoryLimit?: number; diskLimit?: number} = {}) {
    Object.assign(this, { owner, memoryLimit, diskLimit });
    this.frames = []; this.count = 0; this.bytes = 0; this.available = true; this.closed = false; this.created = Date.now();
  }
  async add(blob: Blob) {
    if (!this.available || this.closed) return false;
    if (this.bytes + blob.size > this.diskLimit) { await this.dispose(); return false; }
    try {
      if (!this.database && this.bytes + blob.size <= this.memoryLimit) this.frames.push(blob);
      else {
        if (!this.database) {
          const db = await openDatabase();
          if (this.closed) { db.close(); return false; }
          this.database = db;
          await transaction(db, "readwrite", store => {
            // Clean orphaned captures left by a killed tab or browser crash.
            const stale = store.index("created").openCursor(IDBKeyRange.upperBound(Date.now() - 86400000));
            stale.onsuccess = () => { if (stale.result) { stale.result.delete(); stale.result.continue(); } };
            this.frames.forEach((data, index) => store.put({ owner: this.owner, index, created: this.created, data }));
          });
          this.frames = [];
        }
        if (this.closed) return false;
        await transaction(this.database, "readwrite", store => store.put({ owner: this.owner, index: this.count, created: this.created, data: blob }));
      }
      if (this.closed) return false;
      this.bytes += blob.size; this.count++; return true;
    } catch { await this.dispose(); return false; }
  }
  async get(index: number) {
    if (!this.available || this.closed) return null;
    if (!this.database) return this.frames[index] ?? null;
    try { return (await transaction(this.database, "readonly", store => store.get([this.owner, index])))?.data ?? null; }
    catch { return null; }
  }
  async dispose() {
    this.closed = true; this.available = false; this.frames = []; this.bytes = 0;
    const database = this.database; this.database = null;
    if (database) {
      try { await transaction(database, "readwrite", store => store.delete(ownerRange(this.owner))); }
      catch { /* Stale cleanup will retry after an interrupted transaction. */ }
      finally { database.close(); }
    }
  }
}
