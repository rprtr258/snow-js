// "Marbles" wallpaper from xxidbr9/mac-os-shader-wallpaper (Metal port of a
// Shadertoy layered sine-flow plasma), converted to WebGL 1 GLSL.
import {defineEffect, num} from "../effect.ts";
import {createGlslEffect, GlslEffectParams} from "../glsl-effect.ts";

const fragment = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float zoom;
uniform float swirl;

// One flow layer; the Metal helper was F(inout I, inout fragColor, a, time).
void marbleLayer(inout vec2 I, inout vec4 fragColor, float a, float time) {
  // The Metal loop counter was float n from -0.3; int plus offset restores the
  // same 9 iterations under GLSL ES 1.00's constant loop bounds.
  for (int i = 0; i < 9; i++) {
    float n = float(i) - 0.3;
    vec2 v = sin(I.yx * n + time * n) / n;
    I += swirl * max(v, vec2(0.0));
  }

  fragColor += 1.0 + sin(I.y + vec4(a, 0.0, 1.0, 0.0));
}

void main(void) {
  // Metal's texCoord is top-down, gl_FragCoord is bottom-up.
  vec2 uv = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y) / iResolution.xy;

  vec2 I = zoom * (2.0 * uv * iResolution - iResolution) / iResolution.y;

  vec4 fragColor = vec4(0.0);

  marbleLayer(I, fragColor, 0.0, iTime);
  marbleLayer(I, fragColor, 0.0, iTime);
  marbleLayer(I, fragColor, 2.0, iTime);

  fragColor /= 6.0;

  gl_FragColor = vec4(fragColor.rgb, 1.0);
}
`;

export const options = {
  speed: num(1, {label: "speed", min: 0, max: 5, step: 0.1}),
  zoom: num(4, {label: "zoom", min: 1, max: 12, step: 0.1}),
  swirl: num(1.2, {label: "swirl", min: 0, max: 3, step: 0.01}),
};

// Render bundle: the glsl tests parse `fragment` and cross-check shader
// uniforms against `toUniforms` output.
export const glsl: GlslEffectParams<typeof options> = {
  fragment,
  toUniforms: v => ({
    zoom: v.zoom,
    swirl: v.swirl,
  }),
  // glsl-effect advances iTime by speedOf/1000 per frame; 1000/60 makes one
  // speed unit equal one shader-second at 60 fps.
  speedOf: v => v.speed * 1000 / 60,
};

export default defineEffect({
  label: "Marbles",
  description: "Liquid marble streaks from layered sine flow fields.",
  options,
  create: (el, values) => createGlslEffect(el, values, glsl),
});
