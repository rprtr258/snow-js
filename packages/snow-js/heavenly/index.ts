// "Heavenly" wallpaper from xxidbr9/mac-os-shader-wallpaper (Metal port of a
// Shadertoy nebula-wisp raymarch), converted to WebGL 1 GLSL.
import {defineEffect, num} from "../effect.ts";
import {createGlslEffect, GlslEffectParams} from "../glsl-effect.ts";

const fragment = `
precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform float steps;
uniform float brightness;

// GLSL ES 1.00 has no tanh; the sign-symmetric form stays finite for large |x|.
vec4 tanh(vec4 x) {
  vec4 s = sign(x);
  vec4 e = exp(-2.0 * clamp(abs(x), 0.0, 20.0));
  return s * (1.0 - e) / (1.0 + e);
}

void main(void) {
  // Metal's texCoord is top-down, gl_FragCoord is bottom-up.
  vec2 uv = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y) / iResolution.xy;
  vec2 frag = uv * iResolution;

  vec4 fragColor = vec4(0.0);

  float z = 0.0;
  float d = 0.0;

  for (int i = 0; i < 64; i++) {
    if (float(i) >= steps)
      break;

    vec3 dir = normalize(vec3(frag * 2.0 - iResolution, iResolution.y));
    vec3 p = z * dir;

    p.z -= iTime;

    d = 1.0;

    for (int j = 0; j < 6; j++) {
      p += cos(p.yzx * d + z * 0.2) / d;
      d /= 0.7;
    }

    d = 0.02 + 0.1 * abs(3.0 - length(p.xy));
    z += d;

    fragColor += (cos(z + iTime + vec4(6.0, 1.0, 2.0, 3.0)) + 1.0) / d;

    if (z > 50.0)
      break;
  }

  fragColor = tanh(fragColor * brightness / 3000.0);

  gl_FragColor = vec4(fragColor.rgb, 1.0);
}
`;

export const options = {
  speed: num(1, {label: "speed", min: 0, max: 5, step: 0.1}),
  steps: num(64, {label: "raymarch steps", min: 8, max: 64, step: 1, integer: true}),
  brightness: num(1, {label: "brightness", min: 0.2, max: 5, step: 0.01}),
};

// Render bundle: the glsl tests parse `fragment` and cross-check shader
// uniforms against `toUniforms` output.
export const glsl: GlslEffectParams<typeof options> = {
  fragment,
  toUniforms: v => ({
    steps: v.steps,
    brightness: v.brightness,
  }),
  // glsl-effect advances iTime by speedOf/1000 per frame; 1000/60 makes one
  // speed unit equal one shader-second at 60 fps.
  speedOf: v => v.speed * 1000 / 60,
};

export default defineEffect({
  label: "Heavenly",
  description: "Billowing nebula wisps in soft rainbow light.",
  options,
  create: (el, values) => createGlslEffect(el, values, glsl),
});
