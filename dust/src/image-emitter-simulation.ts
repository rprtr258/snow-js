import { PortalSimulation, DT } from "./portal-physics";
import { emissionPoints, imageSettings, validateMask, IMAGE_COLOR } from "./image-emitter";
import {
  EmissionPoint,
  ImageEmitterOptions,
  ImageSettings,
  Mask,
  SimulationOptions,
  SpriteSpec,
} from "./types";
const f = Math.fround;

// Original image-authoring emission, shared native-style particle updates.
// A rotating mask changes births only; living particles are never transformed.
export class ImageEmitterSimulation extends PortalSimulation {
  declare effect: string;
  declare definition: {sprites: SpriteSpec[]};
  declare mask: Mask;
  declare imageOnce: boolean;
  declare angle: number;
  declare settings: ImageSettings;
  declare emissionPoints: EmissionPoint[];
  constructor(options: SimulationOptions) {
    super({ ...options, effect: "holy_mountain" });
    this.effect = options.effect ?? "custom_image";
    this.definition = { sprites: [] };
    const emitter: ImageEmitterOptions = options.imageEmitter ?? {};
    this.mask = validateMask(emitter.mask);
    this.imageOnce = !!options.imageOnce;
    this.angle = 0;
    this.setImageSettings(emitter.settings);
  }
  setImageSettings(settings: unknown) {
    const next = imageSettings(settings);
    if (!this.settings || this.settings.density !== next.density) this.emissionPoints = emissionPoints(this.mask, next.density);
    this.settings = next;
  }
  step() {
    const s = this.settings, angle = s.motion === "rotate" ? this.angle : 0;
    if ((!this.imageOnce || this.elapsedFrames === 0) && this.elapsedFrames % s.interval === 0) {
      const c = Math.cos(angle), sn = Math.sin(angle), rng = this.emissionRng;
      for (const point of this.emissionPoints) {
        if (rng.unit() * 255 >= point.probability) continue;
        const x = f(this.x + point.x * c - point.y * sn), y = f(this.y + point.x * sn + point.y * c);
        const vx = f(rng.range(-s.drift, s.drift)), vy = f(rng.range(-s.drift, s.drift));
        if (this.particles.length >= 100000) { this.dropped++; continue; }
        const life = f(s.lifetime);
        this.particles.push({ x, y, prevX: x, prevY: y, vx, vy, gx: 0, gy: f(s.gravity), friction: f(0.1),
          life, maxLife: life, age: 0, alpha: 1, fadeRate: f(-1 / life), airflowForce: f(s.turbulence), airflowScale: f(0.05),
          drawLong: false, onGrid: true, singleWidth: true, glow: true, ultrabright: false, back: true,
          color: (0xff000000 | parseInt(IMAGE_COLOR.slice(1), 16)) >>> 0, cellType: "fire", attractor: 0 });
        this.totalEmitted++;
      }
    }
    if (s.motion === "rotate") this.angle = (this.angle + s.degreesPerSecond * Math.PI / 180 * DT) % (Math.PI * 2);
    this.advanceParticles();
  }
}
