// Bound both active work and completed frames waiting for their turn. Consume
// in timeline order even if later frames finish first; drain on early exit.
export async function orderedPipeline<T>(
  count: number,
  depth: number,
  produce: (index: number) => T | Promise<T>,
  consume: (value: T, index: number) => unknown,
) {
  type Outcome = {value: T; index: number} | {error: unknown};
  const pending: Promise<Outcome>[] = [];
  let next = 0;
  const enqueue = () => {
    const index = next++;
    pending.push(Promise.resolve().then(() => produce(index)).then(
      (value): Outcome => ({ value, index }),
      (error): Outcome => ({ error }),
    ));
  };
  try {
    while (next < count && pending.length < Math.max(1, depth)) enqueue();
    while (pending.length) {
      const result = await pending.shift();
      if (!result) break;
      if ("error" in result) throw result.error;
      if (await consume(result.value, result.index) === false) break;
      if (next < count) enqueue();
    }
  } finally { await Promise.all(pending); }
}

// Leave one logical CPU free and bound queued pixel copies. Memory hints are
// optional (Firefox omits them); unknown-memory devices use at most two workers.
export function exportConcurrency(
  width: number,
  height: number,
  limit = 4,
  hardware: {hardwareConcurrency?: number; deviceMemory?: number} = globalThis.navigator ?? {},
) {
  const cores = Math.max(1, Math.floor(hardware.hardwareConcurrency || 2));
  const memory = hardware.deviceMemory;
  const memoryWorkers = memory === undefined ? 2 : memory < 2 ? 1 : memory < 4 ? 2 : 4;
  const pixels = Math.max(1, width * height * 4);
  return Math.max(0, Math.min(4, Math.floor(limit), cores - 1, memoryWorkers, Math.floor(64 * 1024 * 1024 / (pixels * 2))));
}
