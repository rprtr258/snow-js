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

// Winding-agnostic signed distance to a triangle (negative inside).
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0;
  vec2 e1 = p2 - p1;
  vec2 e2 = p0 - p2;
  vec2 v0 = p - p0;
  vec2 v1 = p - p1;
  vec2 v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot2(e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot2(e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot2(e2), 0.0, 1.0);
  float d = sqrt(min(dot2(q0), min(dot2(q1), dot2(q2))));
  float s0 = cross2(e0, v0);
  float s1 = cross2(e1, v1);
  float s2 = cross2(e2, v2);
  bool inside = (s0 >= 0.0 && s1 >= 0.0 && s2 >= 0.0)
    || (s0 <= 0.0 && s1 <= 0.0 && s2 <= 0.0);
  return inside ? -d : d;
}

float blob(vec2 p, vec2 c, float r) {
  float d = length(p - c) / r;
  return pow(max(1.0 - d, 0.0), 2.2);
}

float ridge(vec2 p, vec2 a, vec2 b, float r) {
  float d = sdSeg(p, a, b) / r;
  return pow(max(1.0 - d, 0.0), 2.0);
}

// Fade along a ray: 0 at both ends, 1 in the middle span.
float rayFade(float t, float fin, float fout) {
  return smoothstep(0.0, fin, t) * (1.0 - smoothstep(fout, 1.0, t));
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

// Faint secondary border segments (echo rays behind the main triangles).
vec3 echoRays(vec2 p, vec3 rayColor) {
  vec2 rays[18];
  rays[0] = vec2(1281.0, 449.0);   rays[1] = vec2(966.0, 875.0);
  rays[2] = vec2(1296.0, 478.0);   rays[3] = vec2(998.0, 819.0);
  rays[4] = vec2(1447.0, 480.0);   rays[5] = vec2(968.0, 913.0);
  rays[6] = vec2(1400.0, 470.0);   rays[7] = vec2(1794.0, 876.0);
  rays[8] = vec2(1391.0, 439.0);   rays[9] = vec2(1832.0, 859.0);
  rays[10] = vec2(1385.0, 448.0);  rays[11] = vec2(1766.0, 893.0);
  rays[12] = vec2(1560.0, 477.0);  rays[13] = vec2(1846.0, 879.0);
  rays[14] = vec2(1595.0, 538.0);  rays[15] = vec2(1807.0, 872.0);
  rays[16] = vec2(1612.0, 531.0);  rays[17] = vec2(1658.0, 998.0);
  vec2 params[9];
  params[0] = vec2(0.35, 0.9);
  params[1] = vec2(0.21, 0.85);
  params[2] = vec2(0.32, 0.9);
  params[3] = vec2(0.25, 0.9);
  params[4] = vec2(0.25, 0.45);
  params[5] = vec2(0.21, 0.9);
  params[6] = vec2(0.28, 0.9);
  params[7] = vec2(0.21, 0.9);
  params[8] = vec2(0.25, 0.95);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    vec2 a = rays[i * 2];
    vec2 b = rays[i * 2 + 1];
    float d = sdSeg(p, a, b);
    float mask = 1.0 - smoothstep(13.0, 19.0, d);
    vec2 ab = b - a;
    float tLen = dot(p - a, ab) / dot2(ab);
    float fade = rayFade(tLen, 0.12, params[i].y);
    acc += rayColor * mask * params[i].x * fade;
  }
  return acc;
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

  vec3 rayColor = vec3(0.39, 0.18, 0.75);
  col += echoRays(p, rayColor);

  // Reference-space geometry of the two main triangles.
  vec2 t1a = vec2(1279.0, 475.0);
  vec2 t1b = vec2(992.0, 975.0);
  vec2 t1c = vec2(1590.0, 975.0);
  vec2 t2p = vec2(1505.5, 559.0);
  vec2 t2l = vec2(1347.0, 866.0);
  vec2 t2r = vec2(1693.0, 866.0);

  // T2 interior first: T1 (and its borders) overlap it, matching the way the
  // wallpaper's front triangle clips the back one.
  float d2 = sdTriangle(p, t2p, t2l, t2r);
  if (d2 < 0.0) {
    col = vec3(0.0);
  }

  // T1 fill + border (mitered corners via the SDF).
  float d1 = sdTriangle(p, t1a, t1b, t1c);
  if (d1 < 0.0) {
    col = vec3(0.0);
  }
  float border1 = 1.0 - smoothstep(19.0, 22.0, abs(d1));
  // The left edge reads magenta against the purple plume, the rest violet.
  float nearLeft = 1.0 - smoothstep(0.0, 60.0, sdSeg(p, t1a, t1b));
  vec3 border1Col = mix(uBorder.rgb, vec3(0.353, 0.047, 0.518), nearLeft * 0.85);
  col = mix(col, border1Col, border1);

  // Second left border ray, merged with the first into a thick edge.
  float dL2 = sdSeg(p, vec2(1271.0, 462.0), vec2(1052.0, 899.0));
  float maskL2 = 1.0 - smoothstep(19.0, 24.0, dL2);
  col = mix(col, uBorder.rgb * 0.95, maskL2);

  // Right border band with a bright pink core line.
  float dR2 = sdSeg(p, vec2(1279.0, 478.0), vec2(1594.0, 1028.0));
  float maskR2 = 1.0 - smoothstep(19.0, 23.0, dR2);
  col = mix(col, vec3(0.227, 0.0, 0.329), maskR2 * 0.9);
  float coreR2 = 1.0 - smoothstep(1.5, 3.5, abs(dR2 - 2.0));
  col = mix(col, vec3(0.745, 0.376, 0.929), coreR2);

  // T2 borders: left edge fading out where the front triangle crosses it,
  // right edge running past the apex, and the floating base dash.
  float dL4 = sdSeg(p, vec2(1541.0, 487.0), vec2(1410.0, 745.0));
  vec2 abL4 = vec2(1410.0, 745.0) - vec2(1541.0, 487.0);
  float tL4 = dot(p - vec2(1541.0, 487.0), abL4) / dot2(abL4);
  float brightL4 = mix(0.75, 1.25, smoothstep(0.4, 0.95, tL4));
  float maskL4 = (1.0 - smoothstep(17.0, 21.0, dL4)) * rayFade(tL4, 0.1, 0.98);
  col = mix(col, vec3(0.43, 0.137, 0.725) * brightL4, maskL4);

  float dR3 = sdSeg(p, vec2(1426.0, 430.0), vec2(1693.0, 866.0));
  vec2 abR3 = vec2(1693.0, 866.0) - vec2(1426.0, 430.0);
  float tR3 = dot(p - vec2(1426.0, 430.0), abR3) / dot2(abR3);
  float maskR3 = (1.0 - smoothstep(18.0, 22.0, dR3)) * smoothstep(0.0, 0.22, tR3);
  col = mix(col, vec3(0.392, 0.145, 0.706), maskR3);
  float dR3e = sdSeg(p, vec2(1693.0, 866.0), vec2(1705.0, 940.0));
  float maskR3e = (1.0 - smoothstep(15.0, 20.0, dR3e)) * 0.4;
  col = mix(col, vec3(0.392, 0.145, 0.706), maskR3e);

  float dDash = sdSeg(p, vec2(1521.0, 865.0), vec2(1700.0, 865.0));
  float maskDash = 1.0 - smoothstep(12.0, 15.0, dDash);
  col = mix(col, uBorder.rgb, maskDash);

  // Short echo segment left of T2's left edge.
  float dE10 = sdSeg(p, vec2(1512.0, 480.0), vec2(1591.0, 700.0));
  float maskE10 = (1.0 - smoothstep(15.0, 20.0, dE10)) * 0.5;
  col = mix(col, rayColor, maskE10);

  // Brightness piling up where borders converge: T2's apex reads pale in the
  // source, the left-edge knot bright violet, T1's apex stays dark.
  float glow = blob(p, t2p, 60.0) * 0.5
    + blob(p, vec2(1415.0, 718.0), 40.0) * 0.35;
  col = mix(col, vec3(0.85, 0.75, 1.0), min(glow, 1.0));

  // A handful of dim stars survive inside the black interiors.
  float inner = starLayer(p, 150.0, uStarDensity, t, 1.4);
  float insideAny = step(d1, 0.0) + step(d2, 0.0);
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
    + "violet-bordered triangles masking the glow, from a space-art wallpaper.",
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
