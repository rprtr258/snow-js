// Nebula-triangles: recreation of a space-art wallpaper (purple/blue nebula,
// star field, intersecting triangles with thick violet borders and black
// interiors that mask the nebula). All geometry lives in a 2560x1440
// reference space fitted to the viewport height and centered horizontally,
// so proportions survive any screen resolution.
import {color, defineEffect, num} from "../effect.ts";
import {createGlslEffect} from "../glsl-effect.ts";

const FRAGMENT_GLSL = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float uStarDensity;
uniform float uTwinkle;
uniform float uHueShift;
uniform vec4 uBorder;

const float REF_W = 2560.0;
const float REF_H = 1440.0;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.02 + vec2(37.2, -17.9);
    a *= 0.5;
  }
  return v;
}

float dot2(vec2 v) {
  return dot(v, v);
}

float cross2(vec2 a, vec2 b) {
  return a.x * b.y - a.y * b.x;
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot2(ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Signed distance to a triangle's boundary as the max over its three edge
// LINES (vertices ordered apex, base-left, base-right: negative inside).
// Unlike a point-to-segment SDF this has no corner rounding, so thresholding
// it yields straight, miter-joined border bands.
float triLine(vec2 p, vec2 a, vec2 b, vec2 c) {
  float s0 = cross2(b - a, p - a) / length(b - a);
  float s1 = cross2(c - b, p - b) / length(c - b);
  float s2 = cross2(a - c, p - c) / length(a - c);
  return max(s0, max(s1, s2));
}

float blob(vec2 p, vec2 c, float r) {
  float d = length(p - c) / r;
  return pow(max(1.0 - d, 0.0), 2.2);
}

float ridge(vec2 p, vec2 a, vec2 b, float r) {
  float d = sdSeg(p, a, b) / r;
  return pow(max(1.0 - d, 0.0), 2.0);
}

vec3 hueRotate(vec3 c, float sh) {
  const mat3 toYiq = mat3(
    0.299, 0.587, 0.114,
    0.596, -0.274, -0.322,
    0.211, -0.523, 0.312
  );
  const mat3 toRgb = mat3(
    1.0, 0.956, 0.621,
    1.0, -0.272, -0.647,
    1.0, -1.106, 1.703
  );
  vec3 yiq = toYiq * c;
  float a = sh * 6.2831853;
  float cs = cos(a);
  float sn = sin(a);
  vec3 rot = vec3(
    yiq.x,
    yiq.y * cs - yiq.z * sn,
    yiq.y * sn + yiq.z * cs
  );
  return max(toRgb * rot, 0.0);
}

vec3 nebula(vec2 p, float t) {
  vec2 drift = vec2(t * 5.0, -t * 3.0);
  vec2 warp = vec2(
    fbm(p * 0.0016 + drift * 0.05),
    fbm(p * 0.0016 - drift * 0.04 + 7.3)
  ) - 0.5;
  vec2 q = p + warp * 170.0;
  float n = fbm(q * 0.0011 + drift * 0.008) * 0.55
    + fbm(q * 0.0028 - drift * 0.006 + 3.7) * 0.3
    + vnoise(q * 0.0065 + drift * 0.012) * 0.15;
  float cloud = 0.45 + 1.15 * n;

  // Blob layout fitted against the source wallpaper's color field.
  vec3 col = vec3(0.016, 0.01, 0.028);
  col += ridge(q, vec2(1371.0, 25.0), vec2(519.0, 319.0), 303.0) * 0.62 * vec3(0.147, 0.036, 0.184) * cloud;
  col += blob(q, vec2(764.0, 740.0), 683.0) * 0.95 * vec3(0.21, 0.043, 0.287) * cloud;
  col += blob(q, vec2(766.0, 1182.0), 404.0) * 0.78 * vec3(0.315, 0.02, 0.272) * cloud;
  col += blob(q, vec2(457.0, 777.0), 699.0) * 1.15 * vec3(0.17, 0.069, 0.16) * cloud;
  col += blob(q, vec2(1777.0, 447.0), 605.0) * 0.98 * vec3(0.076, 0.206, 0.346) * cloud;
  col += blob(q, vec2(2079.0, 909.0), 549.0) * 1.06 * vec3(0.138, 0.143, 0.272) * cloud;
  col += blob(q, vec2(2192.0, 539.0), 521.0) * 0.51 * vec3(0.17, 0.237, 0.37) * cloud;
  col += ridge(q, vec2(1281.0, 1006.0), vec2(1313.0, 1196.0), 759.0) * 1.55 * vec3(0.088, 0.174, 0.346) * cloud;
  col += blob(q, vec2(1804.0, 1231.0), 424.0) * 0.67 * vec3(0.059, 0.329, 0.389) * cloud;
  col += blob(q, vec2(1547.0, 680.0), 745.0) * 0.4 * vec3(0.128, 0.023, 0.436) * cloud;
  col += blob(q, vec2(1291.0, 175.0), 893.0) * 0.2 * vec3(0.279, 0.0, 0.105) * cloud;

  // Bright cores, modulated more gently than the surrounding clouds.
  col += blob(q, vec2(1668.0, 663.0), 122.0) * 0.7 * vec3(0.565, 0.657, 0.927) * (0.5 + 0.7 * n);
  col += blob(q, vec2(1957.0, 621.0), 168.0) * 0.69 * vec3(0.401, 0.341, 0.561) * (0.5 + 0.6 * n);
  col += blob(q, vec2(2062.0, 387.0), 297.0) * 0.56 * vec3(0.203, 0.369, 0.432) * (0.5 + 0.6 * n);
  col += blob(q, vec2(1938.0, 1073.0), 173.0) * 0.51 * vec3(0.147, 0.266, 0.413) * (0.5 + 0.6 * n);
  col += blob(q, vec2(895.0, 1232.0), 141.0) * 0.55 * vec3(0.492, 0.126, 0.463) * (0.5 + 0.6 * n);
  col += blob(q, vec2(1530.0, 202.0), 201.0) * 0.69 * vec3(0.111, 0.191, 0.319) * (0.5 + 0.6 * n);
  col += blob(q, vec2(1518.0, 554.0), 150.0) * 0.8 * vec3(0.108, 0.232, 0.321) * (0.5 + 0.6 * n);
  col += blob(q, vec2(1705.0, 879.0), 300.0) * 1.1 * vec3(0.122, 0.124, 0.305) * (0.5 + 0.6 * n);
  col += blob(q, vec2(1610.0, 1045.0), 162.0) * 1.25 * vec3(0.079, 0.151, 0.327) * (0.5 + 0.6 * n);

  return max(col, 0.0);
}

// One star layer over a cell grid; density scales how many cells are lit.
float starLayer(vec2 p, float cell, float density, float t, float minSigma) {
  vec2 gid = floor(p / cell);
  float acc = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 cellId = gid + vec2(float(dx), float(dy));
      float h = hash21(cellId);
      if (h > 0.85 * density) {
        continue;
      }
      float h2 = hash21(cellId + 17.17);
      float h3 = hash21(cellId + 43.7);
      vec2 pos = (cellId + 0.15 + 0.7 * vec2(h2, h3)) * cell;
      float sigma = max(1.0 + 2.2 * h2 * h2, minSigma);
      float bright = 0.22 + 0.5 * h3 * h3 * h3;
      bright *= 1.0 - uTwinkle * 0.6 * (0.5 + 0.5 * sin(t * (0.6 + 2.2 * h2) + h3 * 6.2831853));
      float d = length(p - pos);
      acc += bright * exp(-d * d / (2.0 * sigma * sigma));
    }
  }
  return acc;
}

vec3 stars(vec2 p, float t, float minSigma) {
  float s = starLayer(p, 42.0, uStarDensity, t, minSigma);
  float big = starLayer(p, 260.0, uStarDensity, t, minSigma);
  vec3 col = vec3(s) * vec3(0.92, 0.94, 1.0);
  col += vec3(0.9, 0.93, 1.0) * big * 0.6;
  return col;
}

void main(void) {
  float scale = iResolution.y / REF_H;
  vec2 p = vec2(
    (gl_FragCoord.x - iResolution.x * 0.5) / scale + REF_W * 0.5,
    (iResolution.y - gl_FragCoord.y) / scale
  );
  float t = iTime;

  vec3 col = nebula(p, t);
  col += stars(p, t, 0.85 * REF_H / iResolution.y);

  // Exactly three triangles: center (largest), right (smaller, slightly
  // right), left (smallest, slightly left and a bit lower than the right
  // one). All geometry is in the 2560x1440 reference space: apexes fixed at
  // the source's positions, bases fitted to the wallpaper by minimizing the
  // render-compare difference; written as base midpoint ± half-width.
  vec2 tCenterA = vec2(1279.0, 475.0);
  vec2 tCenterB = vec2(1280.3 - 284.4, 975.0);
  vec2 tCenterC = vec2(1280.3 + 284.4, 975.0);
  vec2 tRightA = vec2(1505.5, 559.0);
  vec2 tRightB = vec2(1519.0 - 174.0, 865.6);
  vec2 tRightC = vec2(1519.0 + 174.0, 865.6);
  vec2 tLeftA = vec2(1030.0, 773.0);
  vec2 tLeftB = vec2(1026.2 - 73.6, 908.0);
  vec2 tLeftC = vec2(1026.2 + 73.6, 908.0);

  float dCenter = triLine(p, tCenterA, tCenterB, tCenterC);
  float dRight = triLine(p, tRightA, tRightB, tRightC);
  float dLeft = triLine(p, tLeftA, tLeftB, tLeftC);
  // The center triangle cuts the other two: their fill is removed inside it
  // before drawing (smoothstep = AA edge).
  float outsideCenter = smoothstep(-2.0, 2.0, dCenter);

  // Border half-widths and strip opacities, fitted to the wallpaper
  // together with the bases (render-compare diff). Each width insets the
  // black fill from the edge lines and sets the half-width of a translucent
  // violet strip straddling the same lines; 1.0 would be fully opaque.
  float wCenter = 19.6;
  float wRight = 11.7;
  float wLeft = 5.1;

  // Left: smallest.
  col = mix(col, vec3(0.0), (1.0 - smoothstep(-wLeft - 1.5, -wLeft + 1.5, dLeft)) * outsideCenter);

  // Right: its left edge and base disappear under the center triangle (the
  // base re-emerges on the far side as a short dash).
  col = mix(col, vec3(0.0), (1.0 - smoothstep(-wRight - 1.5, -wRight + 1.5, dRight)) * outsideCenter);

  // Center: drawn last, in front.
  col = mix(col, vec3(0.0), 1.0 - smoothstep(-wCenter - 1.5, -wCenter + 1.5, dCenter));

  // Translucent violet strips over the same edge lines, painted after all
  // fills so the center's strip stays in front (the glow below piles on top
  // of them, as in the source).
  col = mix(col, uBorder.rgb, 0.904 * (1.0 - smoothstep(wLeft - 1.5, wLeft + 1.5, abs(dLeft))) * outsideCenter);
  col = mix(col, uBorder.rgb, 0.909 * (1.0 - smoothstep(wRight - 1.5, wRight + 1.5, abs(dRight))) * outsideCenter);
  col = mix(col, uBorder.rgb, 0.840 * (1.0 - smoothstep(wCenter - 1.5, wCenter + 1.5, abs(dCenter))));

  // Brightness piling up where borders converge: the right triangle's apex
  // reads pale in the source, the cut knot bright violet.
  float glow = blob(p, tRightA, 60.0) * 0.5
    + blob(p, vec2(1416.0, 713.0), 40.0) * 0.35;
  col = mix(col, vec3(0.85, 0.75, 1.0), min(glow, 1.0));

  // A handful of dim stars survive inside the black interiors; the mask
  // follows the inset black region, not the edge lines.
  float inner = starLayer(p, 150.0, uStarDensity, t, 1.4);
  float insideAny = step(dCenter, -wCenter) + step(dRight, -wRight) + step(dLeft, -wLeft);
  col += vec3(0.85, 0.87, 0.95) * inner * 0.5 * min(insideAny, 1.0);

  col = hueRotate(col, uHueShift * 0.5 + 0.06 * sin(t * 0.1));
  col += (hash21(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

const options = {
  speed: num(1, {label: "speed", min: 0, max: 5, step: 0.1}),
  starDensity: num(1, {label: "star density", min: 0, max: 3, step: 0.05}),
  twinkle: num(0.5, {label: "twinkle", min: 0, max: 1, step: 0.05}),
  hueShift: num(0, {label: "hue shift", min: -1, max: 1, step: 0.01}),
  borderColor: color("#6330c0", {label: "border color"}),
};

function hexToRgb(hex: string | null): [number, number, number, number] {
  const fallback = "6330c0";
  const raw = (hex ?? `#${fallback}`).replace("#", "");
  const full = raw.length === 6 ? raw : fallback;
  const int = parseInt(full, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  return [r, g, b, 1];
}

export default defineEffect({
  label: "Nebula triangles",
  description: "Purple-blue nebula with a star field and intersecting "
    + "triangles with translucent violet borders masking the glow, from a "
    + "space-art wallpaper.",
  options,
  create: (el, values) => createGlslEffect(el, values, {
    fragment: FRAGMENT_GLSL,
    toUniforms: v => ({
      uStarDensity: v.starDensity,
      uTwinkle: v.twinkle,
      uHueShift: v.hueShift,
      uBorder: hexToRgb(v.borderColor),
    }),
    speedOf: v => v.speed,
  }),
});
