// Balatro menu background: pixelated tri-colour liquid swirl. Ported from
// localthunk's Balatro background shader (https://www.shadertoy.com/view/XXtBRr,
// shadertoy port by xxidbr9).
import {defineEffect, bool, color, num} from "../effect.ts";
import {createGlslEffect, GlslEffectParams} from "../glsl-effect.ts";
import {channelsOf} from "../utils.ts";

const fragment = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;

uniform float spinRotation;
uniform float spinSpeed;
uniform float offsetX;
uniform float offsetY;
uniform vec4 colour1;
uniform vec4 colour2;
uniform vec4 colour3;
uniform float contrast;
uniform float lighting;
uniform float spinAmount;
uniform float pixelFilter;
uniform float spinEase;
uniform float isRotate;

vec4 effect(vec2 screenSize, vec2 screenCoords) {
  float pixelSize = length(screenSize) / pixelFilter;
  vec2 uv = (floor(screenCoords * (1.0 / pixelSize)) * pixelSize - 0.5 * screenSize) / length(screenSize) - vec2(offsetX, offsetY);
  float uvLen = length(uv);

  float speed = spinRotation * spinEase * 0.2;
  if (isRotate > 0.5) {
    speed = iTime * speed;
  }
  speed += 302.2;
  float newPixelAngle = atan(uv.y, uv.x) + speed - spinEase * 20.0 * (spinAmount * uvLen + (1.0 - spinAmount));
  vec2 mid = (screenSize / length(screenSize)) / 2.0;
  uv = vec2(uvLen * cos(newPixelAngle) + mid.x, uvLen * sin(newPixelAngle) + mid.y) - mid;

  uv *= 30.0;
  speed = iTime * spinSpeed;
  vec2 uv2 = vec2(uv.x + uv.y);

  for (int i = 0; i < 5; i++) {
    uv2 += sin(max(uv.x, uv.y)) + uv;
    uv += 0.5 * vec2(cos(5.1123314 + 0.353 * uv2.y + speed * 0.131121), sin(uv2.x - 0.113 * speed));
    uv -= cos(uv.x + uv.y) - sin(uv.x * 0.711 - uv.y);
  }

  float contrastMod = 0.25 * contrast + 0.5 * spinAmount + 1.2;
  float paintRes = min(2.0, max(0.0, length(uv) * 0.035 * contrastMod));
  float c1p = max(0.0, 1.0 - contrastMod * abs(1.0 - paintRes));
  float c2p = max(0.0, 1.0 - contrastMod * abs(paintRes));
  float c3p = 1.0 - min(1.0, c1p + c2p);
  float light = (lighting - 0.2) * max(c1p * 5.0 - 4.0, 0.0) + lighting * max(c2p * 5.0 - 4.0, 0.0);
  return 0.3 / contrast * colour1 + (1.0 - 0.3 / contrast) * (colour1 * c1p + colour2 * c2p + vec4(c3p * colour3.rgb, c3p * colour1.a)) + light;
}

void main(void) {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  gl_FragColor = effect(iResolution.xy, uv * iResolution.xy);
}
`;

export const options = {
  speed: num(1, {label: "speed", min: 0, max: 5, step: 0.1}),
  spinRotation: num(-2, {label: "spin rotation", min: -10, max: 10, step: 0.1}),
  spinSpeed: num(7, {label: "spin speed", min: 0, max: 20, step: 0.1}),
  offsetX: num(0, {label: "offset x", min: -1, max: 1, step: 0.01}),
  offsetY: num(0, {label: "offset y", min: -1, max: 1, step: 0.01}),
  color1: color("#de443b", {label: "color 1"}),
  color2: color("#006bb4", {label: "color 2"}),
  color3: color("#162325", {label: "color 3"}),
  contrast: num(3.5, {label: "contrast", min: 1, max: 10, step: 0.1}),
  lighting: num(0.4, {label: "lighting", min: 0, max: 1, step: 0.01}),
  spinAmount: num(0.25, {label: "spin amount", min: 0, max: 1, step: 0.01}),
  pixelFilter: num(745, {label: "pixel filter", min: 100, max: 2000, step: 1, integer: true}),
  spinEase: num(1, {label: "spin ease", min: 0, max: 5, step: 0.1}),
  rotate: bool(false, {label: "rotate"}),
};

export const glsl: GlslEffectParams<typeof options> = {
  fragment,
  toUniforms: v => ({
    spinRotation: v.spinRotation,
    spinSpeed: v.spinSpeed,
    offsetX: v.offsetX,
    offsetY: v.offsetY,
    colour1: channelsOf(v.color1),
    colour2: channelsOf(v.color2),
    colour3: channelsOf(v.color3),
    contrast: v.contrast,
    lighting: v.lighting,
    spinAmount: v.spinAmount,
    pixelFilter: v.pixelFilter,
    spinEase: v.spinEase,
    isRotate: v.rotate ? 1 : 0,
  }),
  // glsl-effect advances iTime by speedOf/1000 per frame; 1000/60 makes one
  // speed unit equal one shader-second at 60 fps.
  speedOf: v => v.speed * 1000 / 60,
};

export default defineEffect({
  label: "Balatro",
  description: "Pixelated swirling liquid from Balatro's menu background.",
  options,
  create: (canvas, values) => createGlslEffect(canvas, values, glsl),
});
