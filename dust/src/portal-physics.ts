// Build-specific, isolated cosmetic-particle reconstruction. See docs/portal-research.md.
// No terrain, external forces, camera culling, or other entities' shared RNG calls.
import { loopAngle } from "./loop-motion";
import {
  Catalog,
  EmissionConfig,
  EmitterState,
  EmissionPoint,
  ImageSettings,
  Particle,
  ParticleQuad,
  Resources,
  Segments,
  SimulationOptions,
  SpriteEmitterState,
  SpriteParticle,
  SpriteSpec,
  TrailPoint,
  V2,
} from "./types";

export const DT = Math.fround(1 / 60);
export const RNG_SCALE = 4.656612875e-10;
export const BUILD = "17130612";
export const SPARK = Object.freeze({
  r: Math.fround(180 / 255),
  g: Math.fround(60 / 255),
  b: 1,
  alpha: Math.fround(68 / 255),
  glow: 60,
});
export const EFFECTS = Object.freeze({
  holy_mountain: Object.freeze({
    label: "Holy Mountain portal",
    source: "teleport_liquid_powered.xml",
  }),
  meditation: Object.freeze({
    label: "Meditation cube portal",
    source: "teleport_meditation_cube_return.xml",
  }),
  eye_room: Object.freeze({
    label: "Hiisi Base eye-room portal",
    source: "teleport_hourglass_return.xml",
  }),
});

// 0x00fdf530 (int16[256]); 0x00872560, the game's 3D simplex noise.
export const SIMPLEX_PERMUTATION = Object.freeze([
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140,
  36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234,
  75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237,
  149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48,
  27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105,
  92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73,
  209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86,
  164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38,
  147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189,
  28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101,
  155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232,
  178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12,
  191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31,
  181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254,
  138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215,
  61, 156, 180,
]);
const perm = new Uint8Array([...SIMPLEX_PERMUTATION, ...SIMPLEX_PERMUTATION]);
const gradients = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];
function corner(x: number, y: number, z: number, index: number) {
  const t = 0.6 - x * x - y * y - z * z;
  if (t < 0) return 0;
  const g = gradients[index % 12];
  // Keep the original accumulation order (including the y-before-x dot product).
  return (g[1] * y + g[0] * x + g[2] * z) * t * t * t * t;
}
export function simplex3(x: number, y: number, z: number) {
  const s = (x + y + z) * (1 / 3);
  const i = Math.floor(x + s),
    j = Math.floor(y + s),
    k = Math.floor(z + s);
  const t = (i + j + k) * (1 / 6);
  const x0 = x - (i - t),
    y0 = y - (j - t),
    z0 = z - (k - t);
  let i1 = 0,
    j1 = 0,
    k1 = 0,
    i2 = 0,
    j2 = 0,
    k2 = 0;
  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1;
      i2 = 1;
      j2 = 1;
    } else if (x0 >= z0) {
      i1 = 1;
      i2 = 1;
      k2 = 1;
    } else {
      k1 = 1;
      i2 = 1;
      k2 = 1;
    }
  } else {
    if (y0 < z0) {
      k1 = 1;
      j2 = 1;
      k2 = 1;
    } else if (x0 < z0) {
      j1 = 1;
      j2 = 1;
      k2 = 1;
    } else {
      j1 = 1;
      i2 = 1;
      j2 = 1;
    }
  }
  const ii = i & 255,
    jj = j & 255,
    kk = k & 255;
  const n0 = corner(x0, y0, z0, perm[ii + perm[jj + perm[kk]]]);
  const n1 = corner(
    x0 - i1 + 1 / 6,
    y0 - j1 + 1 / 6,
    z0 - k1 + 1 / 6,
    perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]],
  );
  const n2 = corner(
    x0 - i2 + 1 / 3,
    y0 - j2 + 1 / 3,
    z0 - k2 + 1 / 3,
    perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]],
  );
  const n3 = corner(
    x0 - 1 + 0.5,
    y0 - 1 + 0.5,
    z0 - 1 + 0.5,
    perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]],
  );
  return (n1 + n0 + n2 + n3) * 32;
}

// 0x008720c0. JS bitwise operations deliberately wrap to 32 bits.
export function coordinateHash(a: number, b: number, c: number) {
  a = ((a - b - c) ^ (c >>> 13)) >>> 0;
  b = ((b - a - c) ^ (a << 8)) >>> 0;
  c = ((c - a - b) ^ (b >>> 13)) >>> 0;
  a = ((a - b - c) ^ (c >>> 12)) >>> 0;
  b = ((b - a - c) ^ (a << 16)) >>> 0;
  c = ((c - a - b) ^ (b >>> 5)) >>> 0;
  a = ((a - b - c) ^ (c >>> 3)) >>> 0;
  b = ((b - a - c) ^ (a << 10)) >>> 0;
  return ((c - a - b) ^ (b >>> 15)) >>> 0;
}
export class NoitaRandom {
  declare state: number;
  constructor(state = 1) {
    this.state = state;
  }
  next() {
    this.state = (Math.trunc(this.state) * 16807) % 2147483647;
    if (this.state < 1) this.state += 2147483647;
    return this.state;
  }
  integer(min: number, max: number) {
    return min + Math.trunc((max - min + 1) * this.next() * RNG_SCALE);
  }
  float(min: number, max: number) {
    return Math.fround(Math.fround(Math.fround(this.next() * RNG_SCALE) * Math.fround(Math.fround(max) - Math.fround(min))) + Math.fround(min));
  }
  seed(x: number, y: number, worldSeed: number) {
    worldSeed >>>= 0;
    const salt = (worldSeed ^ 0x93262e6f) >>> 0;
    x += salt & 0xfff;
    y += (salt >>> 12) & 0xfff;
    const a = Math.trunc(x * 134217727) >>> 0;
    const b =
      Math.trunc(
        Math.abs(y) < 102400 && Math.abs(x) > 1
          ? (y * 3483.328 + a) * y
          : y * 134217727,
      ) >>> 0;
    this.state =
      (coordinateHash(a, b, worldSeed) / 4294967295) * 2147483639 + 1;
    if (this.state >= 2147483647) this.state *= 0.5;
    this.next();
    for (let i = worldSeed & 3; i > 0; i--) this.next();
    return this;
  }
}

export function proceduralRandomi(x: number, y: number, min: number, max: number, worldSeed = 0) {
  return new NoitaRandom().seed(x, y, worldSeed).integer(min, max);
}

export class EmissionRandom {
  declare state: number;
  constructor(state = 1) {
    this.state = state >>> 0;
  }
  next() {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 32767;
  }
  unit() {
    return Math.fround(this.next() / 32767);
  }
  range(min: number, max: number) {
    return Math.fround(Math.fround(this.unit() * Math.fround(Math.fround(max) - Math.fround(min))) + Math.fround(min));
  }
}

// Lua doubles, then EntitySetTransform's float conversion.
// The odd fixed-vertex modulo FIVE, one-based random argument, and inverted lerp are intentional.
export function meditationPoints(frame: number, worldSeed = 0, x = 0, y = 0, period = 0): V2[] {
  const verts: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [1, 0, -1],
    [-1, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
  ];
  const ry = loopAngle(frame, 0.00613, period);
  const rx = Math.sin(loopAngle(frame, 0.002, period)) * 0.3;
  const sy = Math.sin(ry),
    cy = Math.cos(ry),
    sx = Math.sin(rx),
    cx = Math.cos(rx);
  for (const v of verts) {
    const [vx, vy, vz] = v;
    v[0] = vx * cy - vz * sy;
    const z1 = vz * cy + vx * sy;
    v[1] = vy * cx - z1 * sx;
  }
  const weight = frame % 2;
  return Array.from({ length: 8 }, (_, i) => {
    const a = verts[i % (verts.length - 1)];
    const b = verts[proceduralRandomi(frame, i + 1, 0, 5, worldSeed)];
    return {
      x: Math.fround((a[0] * weight + b[0] * (1 - weight)) * 50 + x),
      y: Math.fround((a[1] * weight + b[1] * (1 - weight)) * 50 + y),
    };
  });
}

// teleport_hourglass_return.lua: rotation is intentionally applied TWICE.
export function hourglassEmitters(frame: number, x = 0, y = 0, period = 0) {
  const rotation =
    loopAngle(frame, 0.003, period) +
    Math.sin(loopAngle(frame, 0.02, period)) * 0.6 +
    Math.sin(loopAngle(frame, 0.012217, period)) * 0.7;
  const weight = (Math.sin(loopAngle(frame, 0.004, period)) + 1) * 0.5;
  const offset = Math.fround(2 * weight - 120 * (1 - weight));
  return Array.from({ length: 9 }, (_, i) => {
    const angle = Math.fround(rotation * 2 + ((Math.PI * 2) / 9) * (i + 1));
    const c = Math.fround(Math.cos(angle)),
      s = Math.fround(Math.sin(angle));
    return { x: Math.fround(x - Math.fround(s * offset)), y: Math.fround(y + Math.fround(c * offset)), angle };
  });
}

// 0x00713e20, no collision/attractor branch. Velocities are pixels/SECOND.
export function stepParticle(p: Particle, time: number, dt = DT) {
  p.age++;
  const nx = Math.fround(p.x + Math.fround(p.vx * dt)),
    ny = Math.fround(p.y + Math.fround(p.vy * dt));
  p.alpha = Math.min(1, Math.max(0, Math.fround(p.alpha + Math.fround(p.fadeRate * dt))));
  if ((p.attractor ?? 0) > 0) {
    p.vx = Math.fround(p.vx + Math.fround(Math.fround(Math.fround((p.targetX ?? 0) - p.x) * dt) * p.attractor!));
    p.vy = Math.fround(p.vy + Math.fround(Math.fround(Math.fround((p.targetY ?? 0) - p.y) * dt) * p.attractor!));
  }
  p.vx = Math.fround(p.vx + Math.fround(p.gx * dt));
  p.vy = Math.fround(p.vy + Math.fround(p.gy * dt));
  if (p.airflowForce > 0) {
    const angle = Math.fround(
      Math.fround(simplex3(Math.fround(nx * p.airflowScale), Math.fround(ny * p.airflowScale), time)) *
        Math.fround(Math.PI),
    );
    const c = Math.fround(Math.cos(angle)),
      s = Math.fround(Math.sin(angle));
    p.vx = Math.fround(p.vx + Math.fround(Math.fround(c * 0) - Math.fround(s * p.airflowForce)));
    p.vy = Math.fround(Math.fround(Math.fround(c * p.airflowForce) + Math.fround(s * 0)) + p.vy);
  }
  if (p.friction !== 0) {
    p.vx = Math.fround(p.vx - Math.fround(Math.fround(p.vx * p.friction) * dt));
    p.vy = Math.fround(p.vy - Math.fround(Math.fround(p.vy * p.friction) * dt));
  }
  p.life = Math.fround(p.life - dt);
  const speed = Math.fround(Math.sqrt(Math.fround(Math.fround(p.vx * p.vx) + Math.fround(p.vy * p.vy))));
  const dx = Math.fround(p.x - nx),
    dy = Math.fround(p.y - ny);
  const distance = Math.fround(Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy))));
  const tx = distance > 0 ? Math.fround(dx / distance) : 0,
    ty = distance > 0 ? Math.fround(dy / distance) : 0;
  p.x = nx;
  p.y = ny;
  p.prevX = Math.fround(Math.fround(Math.fround(tx * speed) * dt) + nx);
  p.prevY = Math.fround(ny + Math.fround(Math.fround(ty * speed) * dt));
  return p.life >= 0;
}

// XML parameters, not fitted constants. airflow_time exists in XML but this
// executable does not copy it to grid::Particle (0x00bc86e0).
const ring = Object.freeze({
  count: 115,
  interval: 12,
  radiusMin: 15,
  radiusMax: 15,
  speed: 11,
  lifeMin: 3,
  lifeMax: 4,
  fade: false,
  force: Math.fround(0.051),
  scale: Math.fround(0.03),
});
const mote = Object.freeze({
  ...ring,
  count: 1,
  radiusMin: 0,
  speed: 0,
  fade: true,
});
const trail = Object.freeze({
  count: 1,
  interval: 1,
  radiusMin: 0,
  radiusMax: 0,
  speed: 0,
  lifeMin: 0.35,
  lifeMax: 2.55,
  fade: true,
  force: Math.fround(0.251),
  scale: Math.fround(0.03),
});
const eyeRing = Object.freeze({
  ...ring,
  interval: 24,
  lifeMin: 1,
  lifeMax: 7,
  force: Math.fround(0.011),
});
const orbital = Object.freeze({
  ...trail,
  lifeMin: 10,
  lifeMax: 20,
  fade: false,
  force: Math.fround(0.02),
  velocityY: 60,
  drawLong: true,
});
export const PORTAL_EMITTERS = Object.freeze({
  ring,
  mote,
  trail,
  eyeRing,
  orbital,
});
function roundedCell(x: number) {
  return Math.floor(Math.fround(x + (x >= 0 ? 0.5 : -0.5)));
}

// 0x00711750 / 0x007113e0. Native points are quads, not GL_POINTS.
export function particleQuad(p: Particle) {
  const wide =
    !p.drawLong &&
    p.singleWidth === false &&
    (p.cellType === "gas" || p.cellType === "fire");
  const alpha =
    (Math.trunc(
      Math.fround(
        Math.fround(p.alpha * (p.drawLong && p.life < 1 ? p.life : wide ? 0.5 : 1)) * 255,
      ),
    ) &
      255) /
    255;
  if (!p.drawLong) {
    const width = wide ? 2 : 1;
    return {
      x: Math.fround((p.onGrid === false ? p.x : roundedCell(Math.fround(p.x + 0.5))) - width),
      y: Math.fround((p.onGrid === false ? p.y : roundedCell(Math.fround(p.y + 0.5))) - 1),
      cosine: 1,
      sine: 0,
      length: width,
      alpha,
    };
  }
  const dx = Math.fround(p.x - p.prevX),
    dy = Math.fround(p.y - p.prevY);
  const distance = Math.fround(Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy))));
  const length = Math.min(Math.fround(distance + 1), 12);
  const angle =
    distance === 0 ? 0 : Math.fround(Math.atan2(Math.fround(dy / distance), Math.fround(dx / distance)));
  return {
    x: Math.fround((p.onGrid === false ? p.x : Math.trunc(Math.fround(p.x + 0.5))) - 1),
    y: Math.fround((p.onGrid === false ? p.y : Math.trunc(Math.fround(p.y + 0.5))) - 1),
    cosine: Math.fround(Math.cos(angle)),
    sine: Math.fround(Math.sin(angle)),
    length,
    alpha,
  };
}

// 0x00711db0 / 0x00711960. gfx_glow selects the glow particle pool; it is
// NOT a per-particle RGB multiplier here. Vertex alpha is packed to 8 bits.
export function particleGlowQuad(p: Particle) {
  const alpha = Math.fround(p.alpha * (p.life < 1 ? p.life : 1));
  const brightness = p.ultrabright ? (p.drawLong ? 3 : 50) : 1;
  const packedAlpha =
    (Math.trunc(
      Math.fround(Math.fround(Math.fround(alpha * Math.fround(p.drawLong ? 0.2 : 0.03)) * brightness) * 255),
    ) &
      255) /
    255;
  if (!p.drawLong)
    return {
      x: Math.fround((p.onGrid === false ? p.x : Math.trunc(Math.fround(p.x + 0.5))) - 12),
      y: Math.fround((p.onGrid === false ? p.y : Math.trunc(Math.fround(p.y + 0.5))) - 12),
      cosine: 1,
      sine: 0,
      length: 24,
      height: 24,
      alpha: packedAlpha,
    };
  const q = particleQuad(p);
  const low = Math.fround(Math.fround(q.length + 16) * -0.5),
    high = Math.fround(Math.fround(Math.fround(q.length + 16) + q.length) * 0.5);
  return {
    x: Math.fround(q.x + Math.fround(Math.fround(q.cosine * low) - Math.fround(q.sine * -8))),
    y: Math.fround(q.y + Math.fround(Math.fround(q.sine * low) + Math.fround(q.cosine * -8))),
    cosine: q.cosine,
    sine: q.sine,
    length: Math.fround(high - low),
    height: 16,
    alpha: packedAlpha,
    anchorX: q.x,
    anchorY: q.y,
    lowX: low,
    highX: high,
    lowY: -8,
    highY: 8,
  };
}

// Keep each world-space corner's float operation order; rebuilding the high
// corners from a rounded lower corner introduces measurable errors far from 0.
export function writeParticleVertices(p: Particle, glow: boolean, out: Float32Array) {
  const q: ParticleQuad = glow ? particleGlowQuad(p) : particleQuad(p);
  const x = q.anchorX ?? q.x,
    y = q.anchorY ?? q.y,
    l = q.lowX ?? 0,
    r = q.highX ?? q.length,
    t = q.lowY ?? 0,
    b = q.highY ?? q.height ?? 1,
    c = q.cosine,
    s = q.sine;
  out[0] = Math.fround(x + Math.fround(Math.fround(c * l) - Math.fround(s * t)));
  out[1] = Math.fround(y + Math.fround(Math.fround(s * l) + Math.fround(c * t)));
  out[2] = Math.fround(x + Math.fround(Math.fround(c * r) - Math.fround(s * t)));
  out[3] = Math.fround(y + Math.fround(Math.fround(s * r) + Math.fround(c * t)));
  out[4] = Math.fround(x + Math.fround(Math.fround(c * r) - Math.fround(s * b)));
  out[5] = Math.fround(y + Math.fround(Math.fround(s * r) + Math.fround(c * b)));
  out[6] = Math.fround(x + Math.fround(Math.fround(c * l) - Math.fround(s * b)));
  out[7] = Math.fround(y + Math.fround(Math.fround(s * l) + Math.fround(c * b)));
  return q.alpha;
}
export function particleVertices(p: Particle, glow = false) {
  const out = new Float32Array(8),
    alpha = writeParticleVertices(p, glow, out);
  return {
    corners: [
      [out[0], out[1]],
      [out[2], out[3]],
      [out[4], out[5]],
      [out[6], out[7]],
    ],
    alpha,
  };
}

export type SimulationFactory = (
  options: SimulationOptions,
  catalog: Catalog,
  resources: Resources,
) => PortalSimulation;
// Optional capabilities only the math and image simulations implement.
export type TrailScalableSimulation = PortalSimulation & {
  setTrailScale?: (value?: number) => void;
};
export type ImageSettableSimulation = PortalSimulation & {
  setImageSettings?: (settings: unknown) => void;
};
export class PortalSimulation {
  declare effect: string;
  declare retainInvisible: boolean;
  declare emissionRng: EmissionRandom;
  declare lifetimeRng: NoitaRandom;
  declare particles: Particle[];
  declare visibleCount: number;
  declare points: (V2 & {angle?: number})[];
  declare previousPoints: TrailPoint[];
  declare dropped: number;
  declare x: number;
  declare y: number;
  declare totalEmitted: number;
  declare elapsedFrames: number;
  declare frame: number;
  declare startFrame: number;
  declare worldSeed: number;
  declare loopFrames: number;
  declare time: number;
  declare initialTime: number;
  // Optional surface of specialized simulations; the base class leaves them
  // unset so polymorphic callers can probe which kind of body is running.
  declare definition?: {sprites?: SpriteSpec[]; lifetime?: number};
  declare emitters?: EmitterState[];
  declare spriteEmitters?: SpriteEmitterState[];
  declare spriteParticles?: SpriteParticle[];
  declare emissionPoints?: EmissionPoint[];
  declare settings?: ImageSettings;
  declare imageOnce?: boolean;
  declare trailEmission?: EmissionConfig;
  declare guides?: Segments;
  declare mathTrailScale?: number;
  constructor(options: SimulationOptions = {}) {
    this.reset(options);
  }
  reset({
    effect = this.effect ?? "meditation",
    worldSeed = 0,
    x = 0,
    y = 0,
    startFrame = 0,
    emissionSeed = 1,
    lifetimeSeed = 1,
    startTime = Math.fround(startFrame / 60),
    retainInvisible = true,
  }: SimulationOptions = {}) {
    if (!Object.prototype.hasOwnProperty.call(EFFECTS, effect))
      throw new RangeError("Unknown portal effect");
    if (
      ![
        worldSeed,
        x,
        y,
        startFrame,
        emissionSeed,
        lifetimeSeed,
        startTime,
      ].every(Number.isFinite) ||
      !Number.isSafeInteger(startFrame) ||
      startFrame < 0 ||
      startFrame > 100000000 ||
      !Number.isInteger(worldSeed) ||
      worldSeed < 0 ||
      worldSeed > 0xffffffff ||
      Math.abs(x) > 10000000 ||
      Math.abs(y) > 10000000 ||
      !Number.isInteger(emissionSeed) ||
      emissionSeed < 0 ||
      emissionSeed > 0xffffffff ||
      !Number.isInteger(lifetimeSeed) ||
      lifetimeSeed < 1 ||
      lifetimeSeed >= 2147483647
    ) {
      throw new RangeError("Invalid replay state");
    }
    Object.assign(this, {
      effect,
      worldSeed,
      x: Math.fround(x),
      y: Math.fround(y),
      startFrame,
      frame: startFrame,
      time: Math.fround(startTime),
      initialTime: Math.fround(startTime),
      elapsedFrames: 0,
      dropped: 0,
      totalEmitted: 0,
    });
    this.retainInvisible = retainInvisible;
    this.emissionRng = new EmissionRandom(emissionSeed);
    this.lifetimeRng = new NoitaRandom(lifetimeSeed);
    this.particles = [];
    this.visibleCount = 0;
    this.points = [];
    this.previousPoints = Array.from({ length: 8 }, () => ({
      x: this.x,
      y: this.y,
      cell: null,
    }));
  }
  emit(config: EmissionConfig, x: number, y: number, angle = 0, previous: TrailPoint | null = null) {
    if (this.particles.length >= 100000) {
      this.dropped++;
      return;
    }
    // Even zero-width ranges consume rand() in the native emitter.
    this.emissionRng.range(0, 0);
    this.emissionRng.range(0, 0);
    this.emissionRng.next(); // emission_chance (100%)
    if (config.radiusMax > 0) {
      const radius = Math.sqrt(this.emissionRng.unit()) * (config.radiusMax - config.radiusMin) + config.radiusMin;
      const halfSector = 360 * 0.017453292 * 0.5;
      const angle = this.emissionRng.range(-halfSector, halfSector);
      x += Math.cos(angle) * radius;
      y += Math.sin(angle) * radius;
    }
    // Trail pixel de-duplication occurs AFTER offset/chance RNG and BEFORE velocity RNG.
    if (previous) {
      const cell = `${roundedCell(x)},${roundedCell(y)}`;
      if (cell === previous.cell)
        return;
      previous.cell = cell;
    }
    const velocityY = this.emissionRng.range(
      config.velocityY ?? 0,
      config.velocityY ?? 0,
    );
    const velocityX = this.emissionRng.range(0, 0);
    this.emissionRng.range(0, 0); // direction_random_deg
    const dx = Math.fround(x - this.x),
      dy = Math.fround(y - this.y);
    const length = Math.fround(Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy))));
    const c = Math.fround(Math.cos(angle)),
      sn = Math.fround(Math.sin(angle));
    const radialX = length > 0 ? Math.fround(Math.fround(dx / length) * config.speed) : 0;
    const radialY = length > 0 ? Math.fround(Math.fround(dy / length) * config.speed) : 0;
    const vx = Math.fround(radialX + Math.fround(Math.fround(velocityX * c) - Math.fround(velocityY * sn)));
    const vy = Math.fround(radialY + Math.fround(Math.fround(velocityX * sn) + Math.fround(velocityY * c)));
    this.lifetimeRng.next(); // grid::Particle constructor's random call
    const life = this.lifetimeRng.float(config.lifeMin, config.lifeMax);
    this.lifetimeRng.integer(0, 100); // cosmetic-create draw; render_on_grid is subsequently overwritten
    this.particles.push({
      x: Math.fround(x + 0.5),
      y: Math.fround(y + 0.5),
      prevX: Math.fround(x + 0.5),
      prevY: Math.fround(y + 0.5),
      vx,
      vy,
      gx: 0,
      gy: 0,
      friction: 0,
      life,
      maxLife: life,
      age: 0,
      alpha: SPARK.alpha,
      fadeRate: config.fade ? Math.fround(-1 / life) : 0,
      airflowForce: config.force,
      airflowScale: config.scale,
      drawLong: config.drawLong ?? false,
    });
    this.totalEmitted++;
  }
  emitBatch(config: EmissionConfig, x: number, y: number, angle = 0) {
    this.emissionRng.range(0, 0);
    this.emissionRng.range(0, 0); // per-batch offsets
    for (let i = 0; i < config.count; i++)
      this.emit(config, x, y, angle);
  }
  emitTrail(previous: TrailPoint, current: V2, config: EmissionConfig = trail) {
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const count = Math.ceil(Math.sqrt(dx * dx + dy * dy));
    this.emissionRng.range(0, 0);
    this.emissionRng.range(0, 0); // batch setup runs even at count=0
    if (count === 0)
      return;
    const sx = dx / count, sy = dy / count;
    let x = previous.x, y = previous.y;
    for (let i = 0; i < count; i++) {
      this.emit(config, x, y, 0, previous);
      x = x + sx;
      y = y + sy;
    }
    previous.x = current.x;
    previous.y = current.y;
  }
  step() {
    // on-added schedules frame + interval - 1; subsequent intervals are 12.
    const ambientRing = this.effect === "eye_room" ? eyeRing : ring;
    if (this.elapsedFrames % ambientRing.interval === ambientRing.interval - 1)
      this.emitBatch(ambientRing, this.x, this.y);
    if (this.elapsedFrames % mote.interval === mote.interval - 1)
      this.emitBatch(mote, this.x, this.y);
    if (this.effect === "meditation") {
      this.points = meditationPoints(
        this.frame,
        this.worldSeed,
        this.x,
        this.y,
        this.loopFrames,
      );
      for (const [i, point] of this.points.entries()) {
        this.emitTrail(this.previousPoints[i], point);
      }
    }
    if (this.effect === "eye_room") {
      this.points = hourglassEmitters(this.frame, this.x, this.y, this.loopFrames);
      for (const point of this.points)
        this.emitBatch(orbital, point.x, point.y, point.angle ?? 0);
    }
    this.advanceParticles();
  }
  advanceParticles() {
    let write = 0,
      visible = 0;
    for (const p of this.particles) {
      if (!this.retainInvisible && p.alpha === 0 && p.fadeRate <= 0) {
        // In the isolated air model these particles can never become visible or influence another.
        // Keep age/lifetime/capacity and all RNG calls intact; skip only unobservable motion.
        p.age++;
        p.life = Math.fround(p.life - DT);
        if (p.life >= 0)
          this.particles[write++] = p;
      } else if (stepParticle(p, this.time)) {
        this.particles[write++] = p;
        if (p.alpha > 0) visible++;
      }
    }
    this.visibleCount = visible;
    this.particles.length = write;
    this.elapsedFrames++;
    this.frame++;
    this.time = Math.fround(this.time + DT);
  }
}

// No simulation-frame skipping: bounded work per RAF, outstanding frames retained.
export class FixedStepClock {
  declare pending: number;
  constructor() {
    this.pending = 0;
  }
  reset() {
    this.pending = 0;
  }
  advance(milliseconds: number, speed: number, step: () => void, maxSteps = 12) {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      !Number.isFinite(speed) ||
      speed < 0
    ) {
      throw new RangeError("Invalid clock input");
    }
    this.pending += milliseconds * speed;
    let count = 0;
    while (this.pending + 1e-8 >= 1000 / 60 && count < maxSteps) {
      step();
      this.pending -= 1000 / 60;
      count++;
    }
    if (Math.abs(this.pending) < 1e-8) this.pending = 0;
    return count;
  }
}
