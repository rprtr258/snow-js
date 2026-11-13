// Builds <effect>/src/render-kernel.wat into the binary committed at
// <effect>/static/assets/render-kernel.wasm for each named effect (currently
// noita and galaxy), which the effects load at runtime (the embeds fetch it;
// bun tests and scripts read the file). Uses the wabt npm package; the built
// binaries are committed so normal builds need no wasm toolchain. Run:
// bun scripts/build-render-kernel.ts <effect>...
// Pass --check to exit 1 when any committed module is out of date.
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import initWabt from "wabt";

const packageRoot = new URL("..", import.meta.url).pathname;
const effects = process.argv.slice(2).filter((arg) => arg !== "--check");
const check = process.argv.includes("--check");
if (effects.length === 0) {
  console.error("usage: bun scripts/build-render-kernel.ts <effect>... [--check]");
  process.exit(1);
}
const wabt = await initWabt();
let stale = false;
for (const effect of effects) {
  const watPath = join(packageRoot, effect, "src", "render-kernel.wat");
  const mod = wabt.parseWat(watPath, readFileSync(watPath, "utf8"));
  mod.resolveNames();
  mod.validate();
  const {buffer} = mod.toBinary({log: false, write_debug_names: false});
  const outPath = join(packageRoot, effect, "static", "assets", "render-kernel.wasm");
  if (check) {
    if (!readFileSync(outPath).equals(Buffer.from(buffer))) {
      console.error(
        `${effect}/static/assets/render-kernel.wasm is out of date with ${effect}/src/render-kernel.wat - run: bun scripts/build-render-kernel.ts ${effect}`,
      );
      stale = true;
    } else {
      console.log(`${effect} render kernel wasm up to date`);
    }
  } else {
    writeFileSync(outPath, Buffer.from(buffer));
    console.log(`${effect} render kernel built: ${buffer.byteLength} bytes`);
  }
}
if (stale) process.exit(1);
