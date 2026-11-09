// Headless render tests. The software renderer is DOM-free, so the shared
// ViewerRuntime pipeline (worker, main-thread fallback and these tests) runs
// in bun and its RGBA output can be pinned byte-exactly with snapshots: any
// change to simulation or rasterization that alters a single rendered pixel
// fails here. Review the .snap diff, then run `bun test -u` to accept the
// new image. The JS rasterizer is the reference (AGENTS.md); the wasm kernel
// must stay byte-identical to it, which the last test enforces.
import {expect, test} from "bun:test";
import {ViewerRuntime} from "./viewer-runtime";
import type {Catalog, RawOptions} from "./types";

// Game-shipped inputs (see AGENTS.md): the effect catalog (effects.json), the
// pixel data decoded from effects.bin, and the optional wasm raster kernel.
const ASSETS = new URL("../static/assets/", import.meta.url);

// Half of the 480×320 preview on each axis at the same world→pixel scale
// (RESOLUTION_SCALE = 1): every figure still fits, and each base64 snapshot
// stays ~200 KB instead of ~820 KB. Rendering must stay deterministic, so no
// size or seed here may depend on Math.random or wall time.
const WIDTH = 240;
const HEIGHT = 160;
// Explicit replay state: pinned pixels must not depend on option defaults.
const SEEDS = {worldSeed: 1, emissionSeed: 1, lifetimeSeed: 1};

const catalog: Catalog = await Bun.file(new URL("effects.json", ASSETS)).json();
const assetsBuffer = await Bun.file(new URL("effects.bin", ASSETS)).arrayBuffer();
const kernelModule = await WebAssembly.compile(
  await Bun.file(new URL("raster.wasm", ASSETS)).arrayBuffer(),
);

function runtime(kernel: WebAssembly.Module | null = null) {
  // slice(0): a runtime may take ownership of the asset buffer.
  return new ViewerRuntime(catalog, assetsBuffer.slice(0), WIDTH, HEIGHT, kernel);
}

// Advance `frames` simulation steps — each one renders, as in live playback —
// and return the RGBA bytes of the last frame plus the runtime. frames = 0
// renders a fresh simulation without stepping, pinning the advance=false
// redraw path.
function render(
  effect: string,
  frames: number,
  kernel: WebAssembly.Module | null = null,
  options?: RawOptions,
) {
  const rt = runtime(kernel);
  rt.restart({effect, ...SEEDS});
  if (frames === 0)
    return {rt, pixels: rt.frame({paused: true, redraw: true, options}).pixels!};
  let pixels: Uint8ClampedArray | null = null;
  for (let i = 0; i < frames; i++) pixels = rt.frame({step: true, options}).pixels;
  return {rt, pixels: pixels!};
}

const base64 = (pixels: Uint8ClampedArray) =>
  Buffer.from(pixels).toString("base64");

// One simulation family per test: math-figure trails, the built-in portal
// physics, a game-XML effect with its animated sprite, and an image emitter.
// Frame 0 pins the fresh state; the later frame the settled glow history.
// The image emitters only start emitting a few frames in, so img_heart pins
// frame 30 instead of the blank frame 0.
test("meditation renders math-figure trails at frame 0", () => {
  expect(base64(render("meditation", 0).pixels)).toMatchSnapshot();
});
test("meditation renders math-figure trails at frame 120", () => {
  expect(base64(render("meditation", 120).pixels)).toMatchSnapshot();
});
test("holy_mountain renders portal emitters at frame 0", () => {
  expect(base64(render("holy_mountain", 0).pixels)).toMatchSnapshot();
});
test("holy_mountain renders portal emitters at frame 120", () => {
  expect(base64(render("holy_mountain", 120).pixels)).toMatchSnapshot();
});
test("orb_of_power renders game-XML emitters and sprite at frame 0", () => {
  expect(base64(render("orb_of_power", 0).pixels)).toMatchSnapshot();
});
test("orb_of_power renders game-XML emitters and sprite at frame 120", () => {
  expect(base64(render("orb_of_power", 120).pixels)).toMatchSnapshot();
});
test("img_heart renders the image emitter at frame 30", () => {
  expect(base64(render("img_heart", 30).pixels)).toMatchSnapshot();
});
test("img_heart renders the image emitter at frame 120", () => {
  expect(base64(render("img_heart", 120).pixels)).toMatchSnapshot();
});

// Presentation options route through distinct composers; pin both branches.
test("glow off takes the identity composer", () => {
  expect(
    base64(render("holy_mountain", 60, null, {core: true, glow: false}).pixels),
  ).toMatchSnapshot();
});
test("monochrome takes the JS compositor with grayscale textures", () => {
  expect(
    base64(
      render("holy_mountain", 60, null, {core: true, glow: true, monochrome: true})
        .pixels,
    ),
  ).toMatchSnapshot();
});

// AGENTS.md: the software renderer's image is the reference — the wasm
// accelerator must rasterize the identical frame. accelerated proves the
// wasm kernel actually ran. 240 rasterizations exceed bun's 5 s default,
// hence the explicit timeout.
test(
  "wasm kernel output matches the JS reference byte for byte",
  () => {
    for (const effect of ["meditation", "holy_mountain", "orb_of_power", "img_heart"]) {
      const js = render(effect, 30);
      const wasm = render(effect, 30, kernelModule);
      expect(wasm.rt.stats().accelerated).toBe(true);
      expect(Buffer.from(wasm.pixels).equals(Buffer.from(js.pixels))).toBe(true);
    }
  },
  30000,
);
