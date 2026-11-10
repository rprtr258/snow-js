// Psychedelic tunnel (http://www.pouet.net/prod.php?which=57245).
import {defineEffect, num} from "../../effect.ts";
import {createGlslEffect} from "../glsl-effect.ts";

const FRAGMENT_GLSL = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iMouse;

#define t iTime
#define r iResolution.xy

vec4 mainImage(in vec2 fragCoord) {
  vec3 c;
  float l, z = t;
  for (int i = 0; i < 3; i++) {
    vec2 uv, p = fragCoord.xy / r;
    uv = p;
    p -= .5;
    p.x *= r.x / r.y;
    z += .07;
    l = length(p);
    uv += p / l * (sin(z) + 1.) * abs(sin(l * 9. - z - z));
    c[i] = .01 / length(mod(uv, 1.) - .5);
  }
  return vec4(c / l, t);
}

void main(void) {
  gl_FragColor = mainImage(gl_FragCoord.xy);
}
`;

const options = {
  speed: num(10, {label: "speed", min: 0, max: 20}),
};

export default defineEffect({
  label: "Creation",
  options,
  create: (el, values) => createGlslEffect(el, {
    fragment: FRAGMENT_GLSL,
    values,
    toUniforms: () => ({}),
    speedOf: (v) => v.speed,
  }),
});
