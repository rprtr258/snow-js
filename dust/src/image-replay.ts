import { PortalSimulation } from "./portal-physics";
import { EmitterState } from "./types";

// Live-preview scheduling, separate from native physics and export looping.
// At normal playback speed, 30 empty simulation frames make a half-second gap.
export const IMAGE_REPLAY_GAP = 30;

export class ImageReplay {
  declare simulation: PortalSimulation;
  declare images: EmitterState[];
  declare custom: boolean;
  declare quietFrames: number;
  declare ready: boolean;
  declare cycleFrames: number;
  declare finished: boolean;
  declare next: number[];
  constructor(simulation: PortalSimulation) {
    this.simulation = simulation;
    this.images = simulation.emitters?.filter(e => e.config.image) ?? [];
    this.custom = !!simulation.emissionPoints && !!simulation.imageOnce;
    this.quietFrames = 0; this.ready = false; this.cycleFrames = 0; this.finished = false;
    if (this.images.length) {
      simulation.definition = { ...simulation.definition, lifetime: -1 };
      for (const emitter of this.images)
        emitter.config = { ...emitter.config, imageLoop: false, endFrame: -1 };
      this.next = this.images.map(e => e.next);
    }
  }
  afterStep() {
    const sim = this.simulation;
    if (!this.finished) {
      this.images.forEach((e, i) => {
        // A zero-speed image intentionally samples a fixed bucket. Treat that
        // as one burst here rather than waiting for a cursor that never moves.
        if ((e.config.imageSpeed ?? 0) <= 0 && e.next !== this.next[i]) e.cursor = -1;
        this.next[i] = e.next;
      });
      this.finished = this.custom ? sim.elapsedFrames > 0 : this.images.every(e => e.cursor < 0);
      if (this.finished && this.images.length)
        sim.definition = { ...sim.definition, lifetime: sim.elapsedFrames };
    }
    const clear = this.finished && sim.visibleCount === 0 && !(sim.spriteParticles?.length);
    this.quietFrames = clear ? this.quietFrames + 1 : 0;
    if (!this.ready && this.quietFrames >= IMAGE_REPLAY_GAP) {
      this.ready = true; this.cycleFrames = sim.elapsedFrames;
    }
  }
}

export function imageReplay(simulation: PortalSimulation) {
  // Imported editor/grid masks already emit continuously. Demo's imageOnce
  // masks join the slow replay cycle; continuous authoring previews do not.
  return simulation.emitters?.some(e => e.config.image) || (simulation.emissionPoints && simulation.imageOnce)
    ? new ImageReplay(simulation) : null;
}
