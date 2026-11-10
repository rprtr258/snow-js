// Two presets in one effect: flat snow
// (https://www.shadertoy.com/view/4sX3z2) and layered snowfall, whose shader
// and options live in ./snowfall.ts. The preset option picks which
// shader runs; option visibility follows it.
import {bool, defineEffect, num, select, type EffectInstance, type InferOptions, type OptionValues} from "../effect.ts";
import snowfall, {options as snowfallOptions} from "./snowfall.ts";
import {createGlslEffect, type UniformMap} from "../glsl-effect.ts";

const FRAGMENT_GLSL = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iMouse;

uniform float isDark;
uniform float amount;
uniform float size;
uniform float opacity;

const int SNOW_LAYERS = 8;

vec2 sincos(float angle) {
  return vec2(cos(angle), sin(angle));
}

vec4 mainImage(in vec2 fragCoord) {
  vec2 p = fragCoord.xy / iResolution.x;
  float snow = 0.0;

  // p += (vec2(-iMouse.x, +iMouse.y) / iResolution - 0.5) / 10.0;

  for (int k = 0; k < 6; k++) {
    for (int i = 0; i < SNOW_LAYERS; i++) {
      float cellSize = 5.0 + float(i) * 3.0;
      float downSpeed = 0.3 + (sin(iTime * 0.4 + float(k + i * 20)) + 1.0) * 0.00008;
      vec2 uv = p + vec2(0.01, downSpeed) * vec2(
        sin((iTime + float(k * 6185)) * 0.6 + float(i)),
        iTime + float(k * 1352)
      // max guards i=0: dividing by float(0) yields inf/NaN, which turned the
      // largest-flake layer (cellSize 5) into a dead/NaN layer.
      ) * vec2(5.0, 1.0) / max(float(i), 1.0);
      vec2 uvStep = ceil(uv * cellSize - 0.5) / cellSize;
      vec2 tmp = fract(sin(vec2((mat2(
        13.0, 78.0,
        62.0, 94.0
      ) + float(k) * mat2(
        12.0, 315.0,
        23.0, 95.0
      )) * uvStep)) * vec2(43758.0, 62159.0) + float(k) * 12.0) - 0.5;
      vec2 randomMagnitude = sincos(iTime * 2.5) * 0.7 / cellSize;
      // Without a per-cell offset every particle sits on the lattice line
      // x = m/cellSize and the shared-phase wiggle leaves vertical mid-cell
      // voids (striping). tmp/cellSize spreads anchors across the cell, faded
      // per axis by gamma so the flake's whole disc always stays strictly
      // inside its own cell: a flake is only ever rendered through its own
      // cell's pixels, so crossing the cell edge would clip the dot and
      // leaving the cell would make it blink out of existence. wmax bounds the
      // per-axis wiggle amplitude (|A*cos + B*sin| <= length(A, B)); blob is
      // the dot's radius in cell units (size-dependent).
      vec2 wmax = 0.7 * vec2(length(vec2(tmp.x * sin(tmp.y), tmp.y)), length(tmp));
      float blob = 1.9 * size / (5.0 * (15.0 + tmp.x * 6.3));
      vec2 gamma = clamp((0.5 - blob - wmax) / (abs(tmp) + 1e-4), 0.0, 1.0);
      float d = 5.0 * distance((uvStep + tmp * gamma / cellSize + vec2(tmp.x * sin(tmp.y), tmp.y) * randomMagnitude.x + vec2(tmp.y, tmp.x) * randomMagnitude.y), uv);
      float omiVal = fract(sin(dot(uvStep, vec2(32.0, 94.0))) * 31572.0);
      if (omiVal < amount) {
        float newd = (tmp.x + 1.0) * 0.4 * clamp(1.9 - d * (15.0 + (tmp.x * 6.3)) * (cellSize / size), 0.0, 1.0);
        snow += newd * opacity;
      }
    }
  }

  if (isDark < 0.5) {
    // invertedColor
    return vec4(-vec3(snow).rgb, snow);
  }

  return vec4(snow);
}

void main(void) {
  gl_FragColor = mainImage(gl_FragCoord.xy);
}
`;

type SnowPreset = "snow" | "snowfall";

const options = {
  preset: select<SnowPreset>("snow", {label: "preset", entries: [
    {value: "snow", label: "snow"},
    {value: "snowfall", label: "snowfall"},
  ]}),
  speed: num(10, {label: "speed", min: 0, max: 20}),
  // snow preset
  isDark: bool(true, {label: "isDark", visible: (v) => v["preset"] !== "snowfall"}),
  amount: num(0.5, {label: "amount", min: 0.01, max: 0.5, visible: (v) => v["preset"] !== "snowfall"}),
  size: num(1, {label: "size", min: 0.4, max: 2, visible: (v) => v["preset"] !== "snowfall"}),
  opacity: num(1, {label: "opacity", min: 0.3, max: 3, visible: (v) => v["preset"] !== "snowfall"}),
  // snowfall preset (option specs owned by the snowfall shader module)
  layers: {...snowfallOptions.layers, visible: (v: OptionValues) => v["preset"] === "snowfall"},
  depth: {...snowfallOptions.depth, visible: (v: OptionValues) => v["preset"] === "snowfall"},
  width: {...snowfallOptions.width, visible: (v: OptionValues) => v["preset"] === "snowfall"},
  drift: {...snowfallOptions.drift, visible: (v: OptionValues) => v["preset"] === "snowfall"},
};
type SnowValues = InferOptions<typeof options>;

function toUniforms(values: SnowValues): UniformMap {
  return {
    isDark: values.isDark ? 1 : 0,
    amount: values.amount,
    size: values.size,
    opacity: values.opacity,
  };
}

function createSnowShader(el: Element, values: SnowValues): EffectInstance {
  return createGlslEffect(el, {
    fragment: FRAGMENT_GLSL,
    values,
    toUniforms,
    speedOf: v => v.speed,
  });
}

// Each preset runs its own shader: this wrapper swaps the underlying shader
// effect when the preset option changes, keeping all edited values.
function create(el: Element, values: SnowValues): EffectInstance {
  const instantiate = (v: SnowValues): EffectInstance =>
    v.preset === "snowfall" ? snowfall.create(el, v) : createSnowShader(el, v);

  let current = values;
  let inner = instantiate(current);
  let started = false;

  return {
    start(): void {
      started = true;
      inner.start();
    },
    stop(): void {
      started = false;
      inner.stop();
    },
    update(options: Partial<OptionValues>): void {
      const previousPreset = current.preset;
      current = {...current, ...options};
      if (current.preset === previousPreset) {
        inner.update(options);
        return;
      }
      inner.unmount();
      inner = instantiate(current);
      if (started)
        inner.start();
    },
    unmount(): void {
      inner.unmount();
    },
  };
}

export default defineEffect({
  label: "Snow",
  options,
  create,
});
