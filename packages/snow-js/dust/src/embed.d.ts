// Hand-written public surface of the embed module (src/embed.ts). Consumers
// typecheck against this file only — the ported dust sources keep their own
// strictness profile and are never pulled into a consumer's tsconfig. Keep in
// sync with src/embed.ts.
export type DustCollection = "game" | "math";
export type DustOptions = {
  collection: DustCollection;
  effect: string;
  speed: number;
  zoom: number;
  core: boolean;
  glow: boolean;
  /** Presentation-only particle recolor; null = original colors. */
  color: string | null;
  /** Presentation-only background recolor; null = original. */
  background: string | null;
  mathTrailScale: number;
  seed: number;
  x: number;
  y: number;
};
export declare const dustDefaults: DustOptions;
export type DustEffectEntry = {key: string; label: string};
export type DustEffectGroup = {label: string; effects: DustEffectEntry[]};
export declare function dustEffectGroups(): Promise<{
  game: DustEffectGroup[];
  math: DustEffectGroup[];
}>;
export declare class Dust {
  options: DustOptions;
  constructor(container: Element, options?: Partial<DustOptions>);
  get running(): boolean;
  /** Diff and apply option changes; restarts on replay-affecting changes. */
  update(options: Partial<DustOptions>): void;
  /** Restart the simulation from the current seed/world coordinates. */
  restart(): void;
  start(): void;
  stop(): void;
  unmount(): void;
}
