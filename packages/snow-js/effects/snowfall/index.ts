// Layered snowfall ("light snow" / "blizzard" shadertoy adaptation,
// https://www.shadertoy.com/view/ldsGDn). Own shader module, consumed by the
// snow effect's "snowfall" preset; not a standalone registry entry.
import {defineEffect, num, type InferOptions} from "../../effect.ts";
import {createShaderEffect, type UniformMap} from "../snow-runner.ts";

const FRAGMENT_GLSL = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;

// LAYERS/DEPTH/WIDTH/SPEED of the original #defines, as runtime uniforms
// ("light snow" defaults: 50/.5/.3/.6, "blizzard": 200/.1/.8/1.5).
uniform float layers;
uniform float depth;
uniform float width;
uniform float speed;

vec4 mainImage(in vec2 fragCoord) {
  const mat3 p = mat3(13.323122,23.5112,21.71123,21.1212,28.7312,11.9312,21.8112,14.7212,61.3934);
  vec2 uv = vec2(1.,iResolution.y/iResolution.x)*fragCoord/iResolution;
  vec3 acc = vec3(0.0);
  float dof = 5.*sin(iTime*.1);
  // WebGL1 requires a constant loop bound; layers selects how many run.
  for (int i=0;i<200;i++) {
    float fi = float(i);
    if (fi >= layers) break;
    vec2 q = uv*(1.+fi*depth);
    q += vec2(q.y*(width*mod(fi*7.238917,1.)-width*.5),speed*iTime/(1.+fi*depth*.03));
    vec3 n = vec3(floor(q),31.189+fi);
    vec3 m = floor(n)*.00001 + fract(n);
    vec3 mp = (31415.9+m)/fract(p*m);
    vec3 r = fract(mp);
    vec2 s = abs(mod(q,1.)-.5+.9*r.xy-.45);
    s += .01*abs(2.*fract(10.*q.yx)-1.);
    float d = .6*max(s.x-s.y,s.x+s.y)+max(s.x,s.y)-.01;
    float edge = .005+.05*min(.5*abs(fi-5.-dof),1.);
    acc += vec3(smoothstep(edge,-edge,d)*(r.x/(1.+.02*fi*depth)));
  }
  return vec4(vec3(acc),1.0);
}

void main(void) {
  gl_FragColor = mainImage(gl_FragCoord.xy);
}
`;

export const options = {
  layers: num(50, {label: "layers", min: 50, max: 200}),
  depth: num(0.5, {label: "depth", min: 0.1, max: 0.5}),
  width: num(0.3, {label: "width", min: 0.3, max: 0.8}),
  drift: num(0.6, {label: "drift speed", min: 0.6, max: 1.5}),
  speed: num(10, {label: "speed", min: 0, max: 20}),
};
type SnowfallValues = InferOptions<typeof options>;

function toUniforms(values: SnowfallValues): UniformMap {
  return {
    layers: values.layers,
    depth: values.depth,
    width: values.width,
    speed: values.drift,
  };
}

export default defineEffect({
  label: "Snowfall",
  options,
  create: (el, values) => createShaderEffect(el, {
    fragment: FRAGMENT_GLSL,
    values,
    toUniforms,
    speedOf: (v) => v.speed,
  }),
});
