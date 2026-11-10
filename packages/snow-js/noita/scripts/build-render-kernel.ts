// Builds src/render-kernel.wat into the binary committed at
// static/assets/render-kernel.wasm, which every runtime loads directly (the
// embed fetches it; bun tests and scripts read the file). Uses the wabt npm
// package; the built binary is committed so normal builds need no wasm
// toolchain. Run:
// bun scripts/build-render-kernel.ts
// Pass --check to exit 1 when the committed module is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import initWabt from "wabt";

const root = new URL("..", import.meta.url).pathname;
const watPath = join(root, "src", "render-kernel.wat");
const wabt = await initWabt();
const mod = wabt.parseWat(watPath, readFileSync(watPath, "utf8"));
mod.resolveNames();
mod.validate();
const { buffer } = mod.toBinary({ log: false, write_debug_names: false });
const outPath = join(root, "static", "assets", "render-kernel.wasm");
if (process.argv.includes("--check")) {
  const fresh = Buffer.from(buffer);
  if (!readFileSync(outPath).equals(fresh)) {
    console.error(
      "static/assets/render-kernel.wasm is out of date with src/render-kernel.wat - run: bun scripts/build-render-kernel.ts",
    );
    process.exit(1);
  }
  console.log("render kernel wasm up to date");
} else {
  writeFileSync(outPath, Buffer.from(buffer));
  console.log(`render kernel built: ${buffer.byteLength} bytes`);
}
