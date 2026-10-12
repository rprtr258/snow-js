// Decomposes SoftwareRenderer.render() for the meditation page at 1920×1080:
// full render vs clear vs particle loop vs guides vs identity compose.
import { readFileSync } from "node:fs";
import { decodeAssets, makeSimulation } from "../src/effect-simulation";
import { SoftwareRenderer } from "../src/software-renderer";
import { fullscreenView } from "../src/render-resolution";
import type { Catalog, Resources, SimulationOptions } from "../src/types";

const ROOT = new URL("..", import.meta.url).pathname;
const catalog: Catalog = JSON.parse(readFileSync(`${ROOT}dist/assets/effects.json`, "utf8"));
const bin = readFileSync(`${ROOT}dist/assets/effects.bin`);
const resources: Resources = decodeAssets(catalog, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

function replay(width: number, height: number): SimulationOptions {
  const { scale } = fullscreenView(width, height, 1);
  return {
    worldSeed: 0, x: 0, y: 0, startFrame: 0, effect: "meditation",
    mathTrailScale: 3, minTrailLifetime: 3.5, ambientRing: false,
    density: scale * 2, retainInvisible: false, fastParticles: true, cullInvisible: true,
  };
}

const RENDER = { core: true, glow: false, color: null, background: 0, monochrome: false, smoothGlow: false, portalSprite: false } as const;
const f = Math.fround;
function roundCell(v: number) { return Math.fround(Math.trunc(v) + 0.5); }

const W = 1920, H = 1080;
const { scale } = fullscreenView(W, H, 1);
const sim = makeSimulation(replay(W, H), catalog, resources);
const renderer = new SoftwareRenderer(W, H, resources, catalog, { scale });
const kernelModule = new WebAssembly.Module(readFileSync(`${ROOT}dist/assets/raster.wasm`));
// attach wasm like harness buildRenderer does
const withKernel = new SoftwareRenderer(W, H, resources, catalog, { kernelModule, scale });

for (let i = 0; i < 600; i++) sim.step();
for (let i = 0; i < 20; i++) renderer.render(sim, RENDER, true, null);

const reps = 60;

// 1. full render
let t = performance.now();
for (let r = 0; r < reps; r++) renderer.render(sim, RENDER, true, null);
const full = (performance.now() - t) / reps;

// 2. clear only
t = performance.now();
for (let r = 0; r < reps; r++) renderer.scene32!.fill(0xff000000);
const clear = (performance.now() - t) / reps;

// 3. identity compose copy
const out = new Uint8ClampedArray(W * H * 4);
t = performance.now();
for (let r = 0; r < reps; r++) out.set(renderer.scene);
const compose = (performance.now() - t) / reps;

// 4. particle loop (standalone copy of the render loop's particle section)
const scaleS = renderer.scale;
const ox = W / 2 - sim.x * scaleS, oy = H / 2 - sim.y * scaleS;
const margin = 40 * scaleS, sceneWidth = W, sceneHeight = H;
const scene = renderer.scene;
const PURPLE = 0x660099;
const colors = new Map();
const rgb = (packed: number) => {
  let c = colors.get(packed);
  if (!c) {
    const r = (packed >>> 16) & 255, g = (packed >>> 8) & 255, b = packed & 255;
    c = [r, g, b, r / 255, g / 255, b / 255];
    colors.set(packed, c);
  }
  return c;
};
t = performance.now();
for (let r = 0; r < reps; r++) {
  scene32fill(renderer);
  for (let i = 0; i < sim.particles.length; i++) {
    const p = sim.particles[i];
    if (p.alpha <= 0) continue;
    const x = p.x * scaleS + ox, y = p.y * scaleS + oy;
    if (x < -margin || x > sceneWidth + margin || y < -margin || y > sceneHeight + margin) continue;
    if (p.drawLong) continue; // skip quad path for the loop estimate
    const alpha = Math.trunc(f(p.alpha) * 255) & 255;
    if (alpha > 0) {
      const bx = (p.onGrid === false ? p.x : roundCell(f(p.x + 0.5))) * scaleS + ox - 1,
        by = (p.onGrid === false ? p.y : roundCell(f(p.y + 0.5))) * scaleS + oy - 1,
        a = alpha / 255, inv = 1 - a,
        c = rgb(PURPLE),
        rr = c[0] * a, gg = c[1] * a, bb = c[2] * a;
      let x0 = Math.ceil(bx - 0.5), x1 = Math.ceil(bx + 0.5),
        y0 = Math.ceil(by - 0.5), y1 = Math.ceil(by + 0.5);
      if (x0 < 0 || x1 > sceneWidth || y0 < 0 || y1 > sceneHeight) {
        x0 = x0 < 0 ? 0 : x0; x1 = x1 > sceneWidth ? sceneWidth : x1;
        y0 = y0 < 0 ? 0 : y0; y1 = y1 > sceneHeight ? sceneHeight : y1;
      }
      for (let py = y0; py < y1; py++)
        for (let px = x0; px < x1; px++) {
          const i4 = (py * sceneWidth + px) * 4;
          scene[i4] = rr + scene[i4] * inv;
          scene[i4 + 1] = gg + scene[i4 + 1] * inv;
          scene[i4 + 2] = bb + scene[i4 + 1] * inv;
        }
    }
  }
}
const loopApprox = (performance.now() - t) / reps;

// 5. guides (rasterQuad over sim.guides)
t = performance.now();
for (let r = 0; r < reps; r++) {
  const cx = W / 2, cy = H / 2;
  for (const [a, b] of sim.guides ?? []) {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const nx = (-dy / length) * 0.5 * scaleS, ny = (dx / length) * 0.5 * scaleS;
    renderer.rasterQuad(
      [a[0] * scaleS + cx + nx, a[1] * scaleS + cy + ny, b[0] * scaleS + cx + nx, b[1] * scaleS + cy + ny,
        b[0] * scaleS + cx - nx, b[1] * scaleS + cy - ny, a[0] * scaleS + cx - nx, a[1] * scaleS + cy - ny],
      PURPLE, 0.16,
    );
  }
}
const guides = (performance.now() - t) / reps;

// 6. wasm-renderer full render (with raster.wasm attached)
t = performance.now();
for (let r = 0; r < reps; r++) renderer.render(sim, RENDER, true, null);
const fullNative = (performance.now() - t) / reps;

console.log(`@${W}x${H} pool=${sim.particles.length} guides=${(sim.guides ?? []).length}`);
console.log(`  full render()          : ${full.toFixed(2)}ms`);
console.log(`  scene32 clear          : ${clear.toFixed(2)}ms`);
console.log(`  identity compose copy  : ${compose.toFixed(2)}ms`);
console.log(`  particle loop (approx) : ${loopApprox.toFixed(2)}ms`);
console.log(`  guides rasterQuad      : ${guides.toFixed(2)}ms`);
console.log(`  full render (native)   : ${fullNative.toFixed(2)}ms`);

function scene32fill(r: SoftwareRenderer) { r.scene32!.fill(0xff000000); }
