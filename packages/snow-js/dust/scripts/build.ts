// Bundles the meditation browser entry into dist/ and copies the static shell
// next to it.
import { cp, rm } from "node:fs/promises";

const OUT = new URL("../dist/", import.meta.url).pathname;

// meditation.ts spawns a Worker at ./render-worker.js, so that must be
// emitted as its own entry point.
const ENTRIES = [
  "src/meditation.ts",
  "src/render-worker.ts",
];

await rm(OUT, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ENTRIES,
  outdir: OUT,
  target: "browser",
  format: "esm",
});

for (const log of result.logs)
  console.error(`[build] ${log.level}: ${log.message}`);

if (!result.success)
  process.exit(1);

await cp(new URL("../static/", import.meta.url).pathname, OUT, { recursive: true });

console.log(`Built ${result.outputs.length} bundles into ${OUT}`);
