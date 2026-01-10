export const VERTEX_GLSL = `
attribute vec3 aVertexPosition;

void main() {
  gl_Position = vec4(aVertexPosition, 1.0);
}
`;

// http://www.pouet.net/prod.php?which=57245
const FRAGMENT_GLSL_ = `
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
void FRAGMENT_GLSL_;

// https://www.shadertoy.com/view/ldsGDn
const FRAGMENT_GLSL__ = `
precision highp float;

#define LIGHT_SNOW // Comment this out for a blizzard

#ifdef LIGHT_SNOW
  #define LAYERS 50
  #define DEPTH .5
  #define WIDTH .3
  #define SPEED .6
#else // BLIZZARD
  #define LAYERS 200
  #define DEPTH .1
  #define WIDTH .8
  #define SPEED 1.5
#endif

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iMouse;

vec4 mainImage(in vec2 fragCoord) {
  const mat3 p = mat3(13.323122,23.5112,21.71123,21.1212,28.7312,11.9312,21.8112,14.7212,61.3934);
  vec2 uv = (iMouse + vec2(1.,iResolution.y/iResolution.x)*fragCoord)/iResolution;
  vec3 acc = vec3(0.0);
  float dof = 5.*sin(iTime*.1);
  for (int i=0;i<LAYERS;i++) {
    float fi = float(i);
    vec2 q = uv*(1.+fi*DEPTH);
    q += vec2(q.y*(WIDTH*mod(fi*7.238917,1.)-WIDTH*.5),SPEED*iTime/(1.+fi*DEPTH*.03));
    vec3 n = vec3(floor(q),31.189+fi);
    vec3 m = floor(n)*.00001 + fract(n);
    vec3 mp = (31415.9+m)/fract(p*m);
    vec3 r = fract(mp);
    vec2 s = abs(mod(q,1.)-.5+.9*r.xy-.45);
    s += .01*abs(2.*fract(10.*q.yx)-1.);
    float d = .6*max(s.x-s.y,s.x+s.y)+max(s.x,s.y)-.01;
    float edge = .005+.05*min(.5*abs(fi-5.-dof),1.);
    acc += vec3(smoothstep(edge,-edge,d)*(r.x/(1.+.02*fi*DEPTH)));
  }
  return vec4(vec3(acc),1.0);
}

void main(void) {
  gl_FragColor = mainImage(gl_FragCoord.xy);
}
`;
void FRAGMENT_GLSL__;

export interface Options {
  isDark: number,
  gradientIntensity: number,
  iGradient: [number, number, number, number],
  amount: number,
  size: number,
  opacity: number,
};

export const defaultOptions: Options = {
  isDark: 0,
  gradientIntensity: 0.05,
  iGradient: [0.0, 0.8, 1.0, 1.0],
  amount: 0.08,
  size: 0.8,
  opacity: 1.5,
};

// https://www.shadertoy.com/view/4sX3z2
export const FRAGMENT_GLSL = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iMouse;

uniform float isDark;
uniform float gradientIntensity;
uniform vec4 iGradient;
uniform float amount;
uniform float size;
uniform float opacity;

const int SNOW_LAYERS = 8;

// Construct and return a vec2 with cos(angle) and sin(angle)
vec2 sincos(float angle) {
  return vec2(cos(angle), sin(angle));
}

vec4 blendOver(vec4 src, vec4 dst) {
  float outA = src.a + dst.a * (1.0 - src.a);
  vec3 num = src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a);
  if (outA > 0.0) {
    return vec4(num / outA, outA);
  } else {
    return vec4(0.0); // fully transparent
  }
}

vec4 mainImage(in vec2 fragCoord) {
  vec2 p = fragCoord.xy / iResolution.x;
  float snow = 0.0;

  // p += (vec2(-iMouse.x, +iMouse.y) / iResolution - 0.5) / 10.0;

  vec4 gradient = (1.0 - p.y) * gradientIntensity * iGradient;

  for (int k = 0; k < 6; k++) {
    for (int i = 0; i < SNOW_LAYERS; i++) {
      float cellSize = 5.0 + float(i) * 3.0;
      float downSpeed = 0.3 + (sin(iTime * 0.4 + float(k + i * 20)) + 1.0) * 0.00008;
      vec2 uv = p + vec2(0.01, downSpeed) * vec2(
        sin((iTime + float(k * 6185)) * 0.6 + float(i)),
        iTime + float(k * 1352)
      ) * vec2(5.0, 1.0) / float(i);
      vec2 uvStep = ceil(uv * cellSize - 0.5) / cellSize;
      vec2 tmp = fract(sin(vec2((mat2(
        13.0, 78.0,
        62.0, 94.0
      ) + float(k) * mat2(
        12.0, 315.0,
        23.0, 95.0
      )) * uvStep)) * vec2(43758.0, 62159.0) + float(k) * 12.0) - 0.5;
      vec2 randomMagnitude = sincos(iTime * 2.5) * 0.7 / cellSize;
      float d = 5.0 * distance((uvStep + vec2(tmp.x * sin(tmp.y), tmp.y) * randomMagnitude.x + vec2(tmp.y, tmp.x) * randomMagnitude.y), uv);
      float omiVal = fract(sin(dot(uvStep, vec2(32.0, 94.0))) * 31572.0);
      if (omiVal < amount) {
        float newd = (tmp.x + 1.0) * 0.4 * clamp(1.9 - d * (15.0 + (tmp.x * 6.3)) * (cellSize / size), 0.0, 1.0);
        snow += newd * opacity;
      }
    }
  }

  if (isDark < 0.5) {
    // invertedColor
    return vec4(-vec3(snow).rgb, snow) + gradient;
  }

  return blendOver(vec4(snow), gradient);
}

void main(void) {
  gl_FragColor = mainImage(gl_FragCoord.xy);
}
`;