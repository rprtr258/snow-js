// Shared setup for the meditation perf/drift harness (bench-meditation.ts and
// render-diff.ts): loads the built assets from dist/ and reproduces the
// fullscreen meditation page's exact simulation and render configuration.
import { readFileSync } from "node:fs";
import { decodeAssets, makeSimulation } from "../src/effect-simulation";
import { SoftwareRenderer } from "../src/software-renderer";
import { fullscreenView } from "../src/render-resolution";
import type { PortalSimulation } from "../src/portal-physics";
import type { Catalog, Resources, SimulationOptions } from "../src/types";

const ROOT = new URL("..", import.meta.url).pathname;

export type Harness = {
  catalog: Catalog;
  resources: Resources;
  buffer: ArrayBuffer;
  kernelModule: WebAssembly.Module;
};

export function loadHarness(): Harness {
  const catalog: Catalog = JSON.parse(
    readFileSync(`${ROOT}dist/assets/effects.json`, "utf8"),
  );
  const bin = readFileSync(`${ROOT}dist/assets/effects.bin`);
  const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const resources = decodeAssets(catalog, buffer);
  const kernelModule = new WebAssembly.Module(
    readFileSync(`${ROOT}dist/assets/raster.wasm`),
  );
  return { catalog, resources, buffer, kernelModule };
}

// The meditation page's render options (src/meditation.ts), after the worker's
// normalizeOptions/renderOptions round-trip: color null, background 0.
export const MEDITATION_RENDER = {
  core: true,
  glow: false,
  color: null,
  background: 0,
  monochrome: false,
  smoothGlow: false,
  portalSprite: false,
} as const;

// The meditation page's replay (src/meditation.ts). The worker's
// ViewerRuntime.restart additionally forces retainInvisible: false on every
// replay. density tracks the world→pixel scale (replay.density = scale*2).
// cullInvisible is always on to match the page; it is output-invariant (the
// dropped particles render nothing, interact with nothing, consume no RNG),
// so the exact-regression baseline recorded without the flag must still
// hash-match — that gate doubles as the invariance proof. fastParticles is
// always explicit here so harness modes never depend on the page's current
// default.
export function meditationReplay(
  width: number,
  height: number,
  fastParticles: boolean,
): SimulationOptions {
  const { scale } = fullscreenView(width, height, 1);
  return {
    worldSeed: 0,
    x: 0,
    y: 0,
    startFrame: 0,
    effect: "meditation",
    mathTrailScale: 3,
    minTrailLifetime: 3.5,
    ambientRing: false,
    density: scale * 2,
    retainInvisible: false,
    fastParticles,
    cullInvisible: true,
  };
}

export function buildSimulation(
  harness: Harness,
  replay: SimulationOptions,
): PortalSimulation {
  return makeSimulation(replay, harness.catalog, harness.resources);
}

export function buildRenderer(
  harness: Harness,
  width: number,
  height: number,
  scale: number,
): SoftwareRenderer {
  return new SoftwareRenderer(width, height, harness.resources, harness.catalog, {
    kernelModule: harness.kernelModule,
    scale,
  });
}

// FNV-1a over the full RGBA output in two independent 32-bit lanes (no BigInt
// cost, negligible collision odds across frames), plus an alpha-plane audit:
// the display path surfaces the alpha byte even on alpha:false canvases, so
// every frame's alpha must stay 255 (plan risk 5).
export function hashPixels(pixels: Uint8ClampedArray): {
  hash: string;
  alphaBad: number;
} {
  let h1 = 0x811c9dc5 | 0,
    h2 = 0x1b873593 | 0,
    alphaBad = 0;
  for (let i = 0; i < pixels.length; i++) {
    const b = pixels[i];
    h1 = Math.imul(h1 ^ b, 16777619);
    h2 = Math.imul(h2 ^ b, 2654435761);
    if ((i & 3) === 3 && b !== 255) alphaBad++;
  }
  const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
  return { hash: `${hex(h1)}${hex(h2)}`, alphaBad };
}
