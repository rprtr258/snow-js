// Fluid effect definition: Pavel Dobryakov's WebGL-Fluid-Simulation exposed
// through the abstract effect registry. Tunables mirror the standalone page's
// config; the splat action replaces its space-key shortcut.
import {action, bool, defineEffect, num, type InferOptions} from "../effect.ts";
import {FluidSim} from "./src/simulation.ts";

// The action fires outside create(), so the latest instance is tracked here.
let active: FluidSim | undefined;

const options = {
  simRes: num(128, {label: "sim res", min: 32, max: 512, step: 32, integer: true}),
  dyeRes: num(1024, {label: "dye res", min: 256, max: 2048, step: 256, integer: true}),
  densityFade: num(3, {label: "density fade", min: 0, max: 10, step: 0.1}),
  velocityFade: num(3, {label: "velocity fade", min: 0, max: 10, step: 0.1}),
  pressure: num(0.8, {label: "pressure", min: 0, max: 1, step: 0.01}),
  curl: num(0, {label: "curl", min: 0, max: 50, step: 1}),
  radius: num(0.25, {label: "radius", min: 0.01, max: 1, step: 0.01}),
  force: num(6000, {label: "force", min: 1000, max: 20000, step: 100}),
  shading: bool(true, {label: "shading"}),
  colorful: bool(false, {label: "colorful"}),
  bloom: bool(true, {label: "bloom"}),
  sunrays: bool(true, {label: "sunrays"}),
  splat: action("random splats", () => {
    active?.randomSplats(5 + Math.floor(Math.random() * 15));
  }),
};

type FluidOptions = InferOptions<typeof options>;

export default defineEffect({
  label: "Fluid",
  description: "Real-time GPU fluid simulation: move the pointer (or finger) across the canvas to stir the dye.",
  options,
  create: (canvas, values: FluidOptions) => {
    const sim = new FluidSim(canvas, values);
    active = sim;
    return sim;
  },
});
