export type V2 = {x: number, y: number};
export type Point2 = [number, number];
export type Edge = [number, number];
// Pixel geometry shared by the GIF/export pipeline.
export type Rect = {x: number; y: number; width: number; height: number};
export type Size = {width: number; height: number};
export type Bounds = {left: number; right: number; top: number; bottom: number};
export type RasterSize = {
  width: number;
  height: number;
  baseWidth: number;
  baseHeight: number;
};
export type Segment = Point2[];
export type Segments = Segment[];

// Shapes of the game-shipped inputs under static/assets/ (effects.json,
// export-loops.json) plus the decoded resources built from effects.bin.
export type AssetInfo = {
  offset: number;
  length: number;
  width: number;
  height: number;
  sha256: string;
};
export type Asset = AssetInfo & {rgba: Uint8Array};
export type ImagePoint = {
  x: number;
  y: number;
  probability: number;
  time: number;
};
export type ImageAnimationInfo = {
  offset: number;
  count: number;
  stride: number;
  width: number;
  height: number;
  maxTime: number;
};
export type ImageAnimation = ImageAnimationInfo & {points: ImagePoint[]};
export type SpriteSpec = {
  asset: string;
  width: number;
  height: number;
  frames: number;
  wait: number;
  perRow: number;
  posX: number;
  posY: number;
  loop: boolean;
  offsetX: number;
  offsetY: number;
  additive: boolean;
  emissive: boolean;
  alpha: number;
  zIndex: number;
  entityX: number;
  entityY: number;
};
export type MaterialInfo = {color: number; glow: number; cellType: string};
export type EmitterConfig = {
  entityX: number;
  entityY: number;
  material: string;
  countMin: number;
  countMax: number;
  intervalMin: number;
  intervalMax: number;
  lifeMin: number;
  lifeMax: number;
  radiusMin: number;
  radiusMax: number;
  sector: number;
  vxMin: number;
  vxMax: number;
  vyMin: number;
  vyMax: number;
  speed: number;
  gx: number;
  gy: number;
  force: number;
  scale: number;
  friction: number;
  attractor: number;
  direction: number;
  offsetX: number;
  offsetY: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  fade: boolean;
  drawLong: boolean;
  onGrid: boolean;
  back: boolean;
  alpha: number;
  singleWidth: boolean;
  ultrabright: boolean;
  chance: number;
  delay: number;
  endFrame: number;
  image?: string;
  imageSpeed?: number;
  imageLoop?: boolean;
  imagePhase?: number;
  imageProbability?: number;
};
// XML emitter attributes arrive as strings; sprite emitters keep the raw keys.
export type SpriteEmitterConfig = {
  sprites: SpriteSpec[];
  [key: string]: string | number | boolean | SpriteSpec[] | undefined;
};
export type EffectDefinition = {
  label: string;
  source: string;
  group: string;
  emitters: EmitterConfig[];
  sprites: SpriteSpec[];
  spriteEmitters: SpriteEmitterConfig[];
  lifetime: number;
  notes: string;
  imageEmitter?: ImageEmitterOptions;
};
export type Catalog = {
  version: number;
  effects: Record<string, EffectDefinition>;
  assets: Record<string, AssetInfo>;
  imageAnimations: Record<string, ImageAnimationInfo>;
  materials: Record<string, MaterialInfo>;
  portalSprite: SpriteSpec;
  warnings: {source: string; warning: string}[];
};
export type Resources = {
  assets: Record<string, Asset>;
  images: Record<string, ImageAnimation>;
};

// A live cosmetic particle. Fields set only by the catalog emitter (color,
// cellType, attractor, ...) stay optional so portal emissions can omit them.
export type Particle = {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  gx: number;
  gy: number;
  friction: number;
  life: number;
  maxLife: number;
  age: number;
  alpha: number;
  fadeRate: number;
  airflowForce: number;
  airflowScale: number;
  drawLong: boolean;
  color?: number;
  glow?: boolean;
  onGrid?: boolean;
  singleWidth?: boolean;
  ultrabright?: boolean;
  back?: boolean;
  cellType?: string;
  attractor?: number;
  targetX?: number;
  targetY?: number;
  mathEdge?: number;
  mathEmitter?: number;
};
export type SpriteParticle = {
  sprite: SpriteSpec;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gx: number;
  gy: number;
  slowdown: number;
  age: number;
  delay: number;
  life: number;
  rotation: number;
  elapsed: number;
  angularVelocity: number;
  scaleX: number;
  scaleY: number;
  scaleVelocityX: number;
  scaleVelocityY: number;
  color: number[];
  colorChange: number[];
  centered: boolean;
  velocityRotation: boolean;
  additive: boolean;
  cosine: number;
  sine: number;
};
// The particle quads produced by particleQuad/particleGlowQuad.
export type ParticleQuad = {
  x: number;
  y: number;
  cosine: number;
  sine: number;
  length: number;
  alpha: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  lowX?: number;
  highX?: number;
  lowY?: number;
  highY?: number;
};
// The emitter subset shared by PORTAL_EMITTERS, MATH_EMISSION and the catalog.
export type EmissionConfig = {
  count: number;
  interval: number;
  radiusMin: number;
  radiusMax: number;
  speed: number;
  lifeMin: number;
  lifeMax: number;
  fade: boolean;
  force: number;
  scale: number;
  velocityY?: number;
  drawLong?: boolean;
};
// Runtime emitter state: a catalog config plus its next/next-cursor clock.
export type EmitterState = {
  config: EmitterConfig;
  next: number;
  cursor: number;
};
export type SpriteEmitterState = {config: SpriteEmitterConfig; next: number};
// A point on a trail, carrying its last emission de-duplication cell.
export type TrailPoint = {x: number; y: number; cell?: string | null};
// Presentation-only option bags: raw values in, validated values out.
export type RawOptions = {
  core?: unknown;
  glow?: unknown;
  color?: unknown;
  background?: unknown;
  monochrome?: unknown;
  smoothGlow?: unknown;
  // Presentation-only opt-out for the catalog portal ring sprite
  // (teleport_center.png); the meditation page draws particles only.
  portalSprite?: unknown;
};
export type NormalizedOptions = {
  core: boolean;
  glow: boolean;
  color: string | null;
  background: string | null;
  monochrome: boolean;
  smoothGlow: boolean;
  portalSprite: boolean;
};
export type RuntimeOptionsState = {core?: unknown; glow?: unknown};
export type FrameRequest = {
  elapsed?: number;
  speed?: number;
  paused?: boolean;
  step?: boolean;
  redraw?: boolean;
  recycle?: ArrayBufferLike | null;
};
export type ViewerFrameRequest = FrameRequest & {
  mathTrailScale?: number;
  imageSettings?: unknown;
  renderScale?: number;
  options?: RawOptions;
};

// Image-authoring types (src/image-emitter.ts), shared with the simulations
// and the UI that inspects a loaded image emitter.
export type SourceImage = {width: number; height: number; rgba: Uint8Array};
export type Mask = {width: number; height: number; values: Uint8Array};
export type EmissionPoint = {x: number; y: number; probability: number};
export type MaskSettings = {
  resolution: number;
  channel: string;
  threshold: number;
  invert: boolean;
  trim: boolean;
  shape: string;
  shaded: boolean;
};
export type ImageSettings = {
  motion: string;
  degreesPerSecond: number;
  density: number;
  interval: number;
  lifetime: number;
  drift: number;
  gravity: number;
  turbulence: number;
};
export type MaskSettingsInput = Partial<MaskSettings>;
export type ImageSettingsInput = Partial<ImageSettings>;
export type ImageEmitterOptions = {
  mask?: unknown;
  settings?: unknown;
  source?: unknown;
};
// Options accepted by PortalSimulation and its subclasses.
export type SimulationOptions = {
  effect?: string;
  worldSeed?: number;
  x?: number;
  y?: number;
  startFrame?: number;
  emissionSeed?: number;
  lifetimeSeed?: number;
  startTime?: number;
  retainInvisible?: boolean;
  loopFrames?: number;
  mathTrailScale?: number;
  // Presentation-only floor for the meditation trail lifetime, in seconds.
  // At or below the ported lifeMin (0.35s) it is a no-op.
  minTrailLifetime?: number;
  // Emission density multiplier: 1 = the ported game behavior (default).
  // Scaled views pass the world→pixel scale so particle counts and trail
  // sampling stay as dense on screen as they are at one cell = one pixel.
  density?: number;
  // Presentation-only opt-out for the ambient ring halo around the body
  // (the meditation page renders the cube and motes alone). Default true:
  // emitted, as in the game.
  ambientRing?: boolean;
  // Opt-in float64 particle integration without Math.fround, with a
  // specialized branch for the common portal profile. Defaults off: every
  // consumer except the meditation page keeps the byte-exact fround
  // reference. Numeric drift only, bounded by scripts/render-diff.ts gates;
  // the RNG stream, emission counts and lifetimes are identical.
  fastParticles?: boolean;
  // Presentation-only cull for the same air model: drop particles that can
  // never render again (alpha exactly 0 with a non-positive fade rate)
  // instead of retaining them to lifetime expiry on the cheap advance path.
  // Output-invariant — such particles render nothing, interact with nothing
  // and consume no RNG — but pool size and age/lifetime bookkeeping then
  // differ from the native retention. Opt-in (meditation page); has no
  // effect unless retainInvisible is false. Defaults off.
  cullInvisible?: boolean;
  imageEmitter?: ImageEmitterOptions;
  imageOnce?: boolean;
  custom_image?: boolean;
};