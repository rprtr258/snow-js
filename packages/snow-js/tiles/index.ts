// "Tiles" wallpaper from xxidbr9/mac-os-shader-wallpaper (Metal port of a
// Shadertoy tan-field plasma), converted to WebGL 1 GLSL.
import {defineEffect, num} from "../effect.ts";
import {createGlslEffect, GlslEffectParams} from "../glsl-effect.ts";

const fragment = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float zoom;

void main(void) {
  // Metal's texCoord is top-down, gl_FragCoord is bottom-up.
  vec2 uv = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y) / iResolution.xy;
  vec2 C = uv * iResolution;

  vec2 p = (2.0 * C - iResolution) / iResolution.y * zoom;

  float v = length(tan(p) + p);

  vec3 col = cos(v - iTime + vec3(1.0, 0.7, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

export const options = {
  speed: num(1, {label: "speed", min: 0, max: 5, step: 0.1}),
  zoom: num(5, {label: "zoom", min: 1, max: 20, step: 0.1}),
};

// Render bundle: the glsl tests parse `fragment` and cross-check shader
// uniforms against `toUniforms` output.
export const glsl: GlslEffectParams<typeof options> = {
  fragment,
  toUniforms: v => ({
    zoom: v.zoom,
  }),
  // glsl-effect advances iTime by speedOf/1000 per frame; 1000/60 makes one
  // speed unit equal one shader-second at 60 fps.
  speedOf: v => v.speed * 1000 / 60,
};

export default defineEffect({
  label: "Tiles",
  description: "Soft rainbow plasma swirling over a tangent-field lattice.",
  options,
  create: (el, values) => createGlslEffect(el, values, glsl),
});
