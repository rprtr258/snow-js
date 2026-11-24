// "Multi Box" wallpaper from xxidbr9/mac-os-shader-wallpaper (Metal port of a
// Shadertoy-style box-corridor raymarch), converted to WebGL 1 GLSL.
import {defineEffect, color, num} from "../effect.ts";
import {createGlslEffect, GlslEffectParams} from "../glsl-effect.ts";
import {channelsOf} from "../utils.ts";

const fragment = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float steps;
uniform vec4 tint;
uniform float glow;

vec2 rot(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main(void) {
  // Metal's texCoord is top-down, gl_FragCoord is bottom-up.
  vec2 uv = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y) / iResolution.xy;
  vec2 frag = uv * iResolution;

  vec3 dir = normalize(vec3(frag - 0.5 * iResolution, iResolution.y));

  float z = 0.0;
  float d = 0.0;
  vec4 O = vec4(0.0);

  for (int i = 0; i < 64; i++) {
    if (float(i) >= steps)
      break;

    vec3 p = z * 0.5 * dir;

    float angle = p.z * 0.1 - 11.0;
    vec2 r = rot(p.xy, cos(angle));
    p = vec3(r, p.z + iTime);

    vec3 q = abs(fract(p) - 0.5) - 0.5;

    float boxDist = length(max(q, vec3(0.4))) + max(q.x, max(q.y, q.z)) - 0.4;

    float wave = abs(sin(length(p.xy) + p.z - iTime * 0.5) * 0.4) * 0.01;

    d = abs(boxDist) + wave + 0.0001;
    z += d;

    O += 4.0 / d;

    if (z > 50.0)
      break;
  }

  // Defaults tint=#5555ff and glow=3 reproduce the original vec4(1, 1, 3) gain.
  O *= vec4(tint.rgb * glow, 0.0) / 400000.0;

  gl_FragColor = vec4(O.rgb, 1.0);
}
`;

export const options = {
  speed: num(1, {label: "speed", min: 0, max: 5, step: 0.1}),
  steps: num(64, {label: "raymarch steps", min: 8, max: 64, step: 1, integer: true}),
  tint: color("#5555ff", {label: "tint"}),
  glow: num(3, {label: "glow", min: 0, max: 10, step: 0.1}),
};

// Render bundle: the glsl tests parse `fragment` and cross-check shader
// uniforms against `toUniforms` output.
export const glsl: GlslEffectParams<typeof options> = {
  fragment,
  toUniforms: v => ({
    steps: v.steps,
    tint: channelsOf(v.tint),
    glow: v.glow,
  }),
  // glsl-effect advances iTime by speedOf/1000 per frame; 1000/60 makes one
  // speed unit equal one shader-second at 60 fps.
  speedOf: v => v.speed * 1000 / 60,
};

export default defineEffect({
  label: "Multi Box",
  description: "Endless corridor of glowing mirrored boxes, raymarched.",
  options,
  create: (el, values) => createGlslEffect(el, values, glsl),
});
