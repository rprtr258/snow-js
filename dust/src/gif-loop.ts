import { PORTAL_EMITTERS, hourglassEmitters, PortalSimulation } from "./portal-physics";
import { figureSegments } from "./math-figures";
import { Point2 } from "./types";

export function loopLifetime(sim: PortalSimulation) {
  if (sim.settings) return sim.settings.lifetime;
  if (sim.trailEmission) return sim.trailEmission.lifeMax;
  if (sim.emitters) return Math.max(0, ...sim.emitters.map(e => e.config.lifeMax),
    ...(sim.spriteEmitters ?? []).map(e => Number(e.config.lifetime ?? 1) + Number(e.config["randomize_lifetime.max"] ?? 0) + Math.max(0, Number(e.config.delay ?? 0))));
  return sim.effect === "eye_room" ? PORTAL_EMITTERS.orbital.lifeMax : PORTAL_EMITTERS.ring.lifeMax;
}

// Looping one-shot artwork needs continuing emission. Its authored emission
// rate, rotation, physics clock, noise, RNG and living particles stay untouched.
export function prepareContinuous(sim: PortalSimulation) {
  if (sim.settings) sim.imageOnce = false;
  if (sim.emitters) {
    sim.definition = { ...sim.definition, lifetime: -1 };
    for (const emitter of sim.emitters)
      emitter.config = { ...emitter.config, endFrame: -1, ...(emitter.config.image ? { imageLoop: true } : {}) };
  }
  return Math.ceil(loopLifetime(sim) * 60) + 244;
}

export function movingBody(sim: PortalSimulation) {
  return !!sim.guides || ["meditation", "eye_room"].includes(sim.effect) ||
    !!(sim.emissionPoints && sim.settings?.motion === "rotate" && sim.settings.degreesPerSecond);
}

// Soft occupancy of authored body geometry, excluding random particle trails.
// Matching an image of the body also recognizes rotational symmetries without
// insisting that a particular vertex or spark returns to its old index.
export function bodySignature(sim: PortalSimulation, tick: number) {
  const size = 32, field = new Float32Array(size * size), frame = sim.startFrame + tick - 1;
  const point = (x: number, y: number) => {
    x = (x + 192) / 384 * (size - 1); y = (y + 192) / 384 * (size - 1);
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const px = ix + dx, py = iy + dy;
      if (px >= 0 && py >= 0 && px < size && py < size)
        field[py * size + px] += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    }
  };
  const segment = (a: Point2, b: Point2) => {
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
    for (let i = 0; i <= count; i++) point(a[0] + (b[0] - a[0]) * i / count, a[1] + (b[1] - a[1]) * i / count);
  };
  if (sim.guides) {
    for (const [a, b] of figureSegments(sim.effect, frame)) segment(a, b);
  } else if (sim.effect === "meditation") {
    const yaw = frame * 0.00613, pitch = Math.sin(frame * 0.002) * 0.3;
    const vertices: Point2[] = [[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,0],[0,-1,0]].map(([x,y,z]) => {
      const depth = z * Math.cos(yaw) + x * Math.sin(yaw);
      return [(x * Math.cos(yaw) - z * Math.sin(yaw)) * 50, (y * Math.cos(pitch) - depth * Math.sin(pitch)) * 50];
    });
    for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) segment(vertices[i], vertices[j]);
  } else if (sim.effect === "eye_room") {
    for (const p of hourglassEmitters(frame)) point(p.x, p.y);
  } else if (sim.emissionPoints) {
    const angle = frame * (sim.settings?.degreesPerSecond ?? 0) * Math.PI / (180 * 60), c = Math.cos(angle), s = Math.sin(angle);
    const stride = Math.max(1, Math.ceil(sim.emissionPoints.length / 2048));
    for (let i = 0; i < sim.emissionPoints.length; i += stride) {
      const p = sim.emissionPoints[i]; point(p.x * c - p.y * s, p.x * s + p.y * c);
    }
  }
  const total = field.reduce((sum, value) => sum + value, 0) || 1;
  for (let i = 0; i < field.length; i++) field[i] /= total;
  return field;
}
export function bodyDifference(a: Float32Array, b: Float32Array) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / 2;
}

// Look for a natural return of the body instead of speeding up its rotations.
// Search at most 60 playback seconds; a short overlap handles residual detail.
// The requested length is a minimum when matching a moving shape.
export async function findBodyLoop(
  simulations: PortalSimulation[],
  origin: number,
  minimum: number,
  speed: number,
  report: (completed: number, total: number) => void = async () => {},
  signature: (sim: PortalSimulation, tick: number) => Float32Array = bodySignature,
) {
  const moving = simulations.filter(movingBody);
  if (!moving.length) return { period: minimum, offset: 0, score: 0 };
  const end = Math.max(minimum, Math.round(60 * 60 * speed));
  const overlap = Math.max(1, Math.round(Math.min(minimum / 4, 30 * speed)));
  const stride = Math.max(1, Math.round(6 * speed));
  const scoreFor = (offset: number) => {
    const start = origin + offset;
    const starts = moving.map(sim =>
      [signature(sim, start), signature(sim, start + overlap)] as [Float32Array, Float32Array],
    );
    return (period: number) => moving.reduce((sum, sim, i) => sum +
      bodyDifference(starts[i][0], signature(sim, start + period)) +
      bodyDifference(starts[i][1], signature(sim, start + period + overlap)), 0) / (2 * moving.length);
  };
  let best = { period: minimum, offset: 0, score: Infinity };
  const span = end - minimum + 1;
  for (let offset = 0; offset <= 600; offset += 60) {
    const score = scoreFor(offset);
    for (let period = minimum; period <= end; period += stride) {
      const difference = score(period);
      if (difference < best.score) best = { period, offset, score: difference };
      if (difference < 0.06) break;
      if ((period - minimum) % (stride * 16) === 0) await report(offset / 60 * span + period - minimum, span * 11);
    }
    if (best.score < 0.06) break;
  }
  const center = best.period, score = scoreFor(best.offset);
  for (let period = Math.max(minimum, center - stride); period <= Math.min(end, center + stride); period++) {
    const difference = score(period);
    if (difference < best.score) best = { period, offset: best.offset, score: difference };
  }
  await report(1, 1);
  return best;
}
