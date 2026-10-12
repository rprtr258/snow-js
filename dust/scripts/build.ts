// Bundles every browser entry point into dist/ and copies the static shell next to it.
import { cp, rm } from "node:fs/promises";

const OUT = new URL("../dist/", import.meta.url).pathname;

// Worker URLs inside the sources point at ./render-worker.js, ./gif-worker.js and
// ./export-frame-worker.js, so those must be emitted as their own entry points.
const ENTRIES = [
  "src/portal-viewer.ts",
  "src/meditation.ts",
  "src/ui-shell.ts",
  "src/render-worker.ts",
  "src/gif-worker.ts",
  "src/export-frame-worker.ts",
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
