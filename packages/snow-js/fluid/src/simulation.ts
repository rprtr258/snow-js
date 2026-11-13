// WebGL fluid simulation, ported from the standalone fluid page (Pavel
// Dobryakov's WebGL-Fluid-Simulation): Navier-Stokes advection on ping-pong
// half-float framebuffers with optional vorticity confinement, bloom and
// sunrays. Adapted to the effect lifecycle: values come from the option
// schema, pointer listeners attach on start / detach on stop, and the
// transparent-background path is dropped: the sim renders dye with alpha =
// max channel over a cleared transparent canvas, so the host's page
// background shows through wherever there is no dye.
import * as shaders from "./shaders.ts";
import type {EffectInstance, OptionValues} from "../../effect.ts";

export type FluidValues = {
  simRes: number,
  dyeRes: number,
  densityFade: number,
  velocityFade: number,
  pressure: number,
  curl: number,
  radius: number,
  force: number,
  shading: boolean,
  colorful: boolean,
  bloom: boolean,
  sunrays: boolean,
};

type Ctx = WebGL2RenderingContext | WebGLRenderingContext;

type Color = {r: number, g: number, b: number};

type Format = {internalFormat: number, format: number};

type Ext = {
  texType: number,
  supportLinearFiltering: boolean,
  rgba: Format,
  rg: Format,
  r: Format,
};

type Fbo = {
  texture: WebGLTexture,
  fbo: WebGLFramebuffer,
  width: number,
  height: number,
  texelSizeX: number,
  texelSizeY: number,
  attach(id: number): number,
};

type Pointer = {
  id: number,
  texcoordX: number,
  texcoordY: number,
  prevTexcoordX: number,
  prevTexcoordY: number,
  deltaX: number,
  deltaY: number,
  down: boolean,
  moved: boolean,
  color: Color,
};

// Sub-parameters not worth exposing as options; taken from the source page's
// config (which exposed only the toggle).
const PRESSURE_ITERATIONS = 20;
const BLOOM_RESOLUTION = 256;
const BLOOM_ITERATIONS = 8;
const BLOOM_INTENSITY = 0.8;
const BLOOM_THRESHOLD = 0.7;
const BLOOM_SOFT_KNEE = 0.7;
const SUNRAYS_RESOLUTION = 196;
const SUNRAYS_WEIGHT = 0.5;
const COLOR_UPDATE_SPEED = 10;

function hashCode(s: string): number {
  if (s.length === 0)
    return 0;

  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function getUniforms(gl: Ctx, program: WebGLProgram): Record<string, WebGLUniformLocation | null> {
  // Iterating until getActiveUniform returns null, since getProgramParameter
  // with ACTIVE_UNIFORMS is typed `any`.
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (let i = 0; ; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info === null)
      break;
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return uniforms;
}

class Program {
  readonly program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;

  constructor(private gl: Ctx, vertexShader: WebGLShader, fragmentShader: WebGLShader) {
    const program = gl.createProgram();
    if (program === null)
      throw new Error("fluid: failed to create program");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true)
      throw new Error(`fluid: program link failed: ${gl.getProgramInfoLog(program) ?? "unknown"}`);
    this.program = program;
    this.uniforms = getUniforms(gl, program);
  }

  bind(): void {
    this.gl.useProgram(this.program);
  }
}

// Display program with a per-keyword variant cache (SHADING/BLOOM/SUNRAYS
// combinations compile to distinct programs, hashed like the original).
class Material {
  uniforms: Record<string, WebGLUniformLocation | null> = {};
  private programs = new Map<number, WebGLProgram>();
  private activeProgram: WebGLProgram | null = null;

  constructor(private gl: Ctx, private vertexShader: WebGLShader, private fragmentShaderSource: string) {
  }

  setKeywords(keywords: string[]): void {
    let hash = 0;
    for (const keyword of keywords)
      hash += hashCode(keyword);

    let program = this.programs.get(hash);
    if (program === undefined) {
      const fragmentShader = this.compileFragment(this.fragmentShaderSource, keywords);
      program = new Program(this.gl, this.vertexShader, fragmentShader).program;
      this.programs.set(hash, program);
    }

    if (program === this.activeProgram)
      return;

    this.uniforms = getUniforms(this.gl, program);
    this.activeProgram = program;
  }

  bind(): void {
    const program = this.activeProgram;
    if (program !== null)
      this.gl.useProgram(program);
  }

  private compileFragment(source: string, keywords: string[]): WebGLShader {
    let sourceWithKeywords = source;
    if (keywords.length > 0)
      sourceWithKeywords = keywords.map((keyword) => `#define ${keyword}\n`).join("") + source;

    const gl = this.gl;
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    if (shader === null)
      throw new Error("fluid: failed to create shader");
    gl.shaderSource(shader, sourceWithKeywords);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true)
      throw new Error(`fluid: shader compile failed: ${gl.getShaderInfoLog(shader) ?? "unknown"}`);
    return shader;
  }
}

function supportRenderTextureFormat(gl: Ctx, internalFormat: number, format: number, type: number): boolean {
  const texture = gl.createTexture();
  if (texture === null)
    return false;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

  const fbo = gl.createFramebuffer();
  if (fbo === null)
    return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
}

function getSupportedFormat(gl: Ctx, internalFormat: number, format: number, type: number): Format | null {
  if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
    if (gl instanceof WebGL2RenderingContext) {
      if (internalFormat === gl.R16F)
        return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
      if (internalFormat === gl.RG16F)
        return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
    }
    return null;
  }
  return {internalFormat, format};
}

function resolveExt(gl: Ctx): Ext {
  if (gl instanceof WebGL2RenderingContext) {
    gl.getExtension("EXT_color_buffer_float");
    const texType = gl.HALF_FLOAT;
    const supportLinearFiltering = gl.getExtension("OES_texture_float_linear") !== null;
    const rgba = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, texType);
    const rg = getSupportedFormat(gl, gl.RG16F, gl.RG, texType);
    const r = getSupportedFormat(gl, gl.R16F, gl.RED, texType);
    if (rgba === null || rg === null || r === null)
      throw new Error("fluid: float render targets are not supported");
    return {texType, supportLinearFiltering, rgba, rg, r};
  }

  const halfFloat = gl.getExtension("OES_texture_half_float");
  if (halfFloat === null)
    throw new Error("fluid: half float textures are not supported");
  const texType = halfFloat.HALF_FLOAT_OES;
  const supportLinearFiltering = gl.getExtension("OES_texture_half_float_linear") !== null;
  const rgba = getSupportedFormat(gl, gl.RGBA, gl.RGBA, texType);
  if (rgba === null)
    throw new Error("fluid: half float render targets are not supported");
  return {texType, supportLinearFiltering, rgba, rg: rgba, r: rgba};
}

function hsvToRgb(h: number, s: number, v: number): Color {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: return {r: v, g: t, b: p};
    case 1: return {r: q, g: v, b: p};
    case 2: return {r: p, g: v, b: t};
    case 3: return {r: p, g: q, b: v};
    case 4: return {r: t, g: p, b: v};
    default: return {r: v, g: p, b: q};
  }
}

function generateColor(): Color {
  const {r, g, b} = hsvToRgb(Math.random(), 1.0, 1.0);
  return {r: r * 0.15, g: g * 0.15, b: b * 0.15};
}

function scaleByPixelRatio(input: number): number {
  const dpr = window.devicePixelRatio;
  const pixelRatio = dpr > 0 ? dpr : 1;
  return Math.floor(input * pixelRatio);
}

function newPointer(): Pointer {
  return {
    id: -1,
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    down: false,
    moved: false,
    color: generateColor(),
  };
}

export class FluidSim implements EffectInstance {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: Ctx;
  private readonly ext: Ext;
  private values: FluidValues;

  private readonly blurProgram: Program;
  private readonly copyProgram: Program;
  private readonly clearProgram: Program;
  private readonly bloomPrefilterProgram: Program;
  private readonly bloomBlurProgram: Program;
  private readonly bloomFinalProgram: Program;
  private readonly sunraysMaskProgram: Program;
  private readonly sunraysProgram: Program;
  private readonly splatProgram: Program;
  private readonly advectionProgram: Program;
  private readonly divergenceProgram: Program;
  private readonly curlProgram: Program;
  private readonly vorticityProgram: Program;
  private readonly pressureProgram: Program;
  private readonly gradientSubtractProgram: Program;
  private readonly displayMaterial: Material;

  // The deployed source page never loads its dither PNG, so it always runs
  // bloom with this 1x1 white texture; kept identical (see also DISPLAY_SHADER).
  private readonly ditheringTexture: {
    texture: WebGLTexture,
    width: number,
    height: number,
    attach(id: number): number,
  };

  // Assigned once by the initFramebuffers() call at the end of the constructor;
  // every read happens after that call.
  private dye!: DoubleFbo;
  private velocity!: DoubleFbo;
  private divergence!: Fbo;
  private curl!: Fbo;
  private pressure!: DoubleFbo;
  private bloom!: Fbo;
  private bloomFramebuffers: Fbo[] = [];
  private sunrays!: Fbo;
  private sunraysTemp!: Fbo;
  private framebuffersInitialized = false;

  private pointers: Pointer[] = [];
  private splatStack: number[] = [];

  private running = false;
  private lastUpdateTime = Date.now();
  private colorUpdateTimer = 0;

  constructor(canvas: HTMLCanvasElement, values: FluidValues) {
    this.canvas = canvas;
    // The host CSS only positions the canvas; without an explicit CSS size it
    // keeps its intrinsic 300x150 and the sim fills just that box.
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";

    const params = {alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false};
    const webgl2 = canvas.getContext("webgl2", params);
    const webgl = canvas.getContext("webgl", params);
    const ctx: Ctx | null = webgl2 instanceof WebGL2RenderingContext
      ? webgl2
      : webgl instanceof WebGLRenderingContext ? webgl : null;
    if (ctx === null)
      throw new Error("fluid: WebGL is not supported");
    this.gl = ctx;
    this.gl.clearColor(0.0, 0.0, 0.0, 1.0);

    this.ext = resolveExt(this.gl);

    // Same demotion as the source page: weaker GPUs get cheaper buffers and
    // lose the features that need linear filtering.
    const effective = {...values};
    if (/Mobi|Android/i.test(navigator.userAgent))
      effective.dyeRes = Math.min(effective.dyeRes, 512);
    if (!this.ext.supportLinearFiltering) {
      effective.dyeRes = Math.min(effective.dyeRes, 512);
      effective.shading = false;
      effective.bloom = false;
      effective.sunrays = false;
    }
    this.values = effective;

    const gl = this.gl;
    const baseVertex = this.compileShader(gl.VERTEX_SHADER, shaders.BASE_VERTEX_SHADER);
    const blurVertex = this.compileShader(gl.VERTEX_SHADER, shaders.BLUR_VERTEX_SHADER);    this.blurProgram = new Program(gl, blurVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.BLUR_SHADER));
    this.copyProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.COPY_SHADER));
    this.clearProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.CLEAR_SHADER));
    this.bloomPrefilterProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.BLOOM_PREFILTER_SHADER));
    this.bloomBlurProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.BLOOM_BLUR_SHADER));
    this.bloomFinalProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.BLOOM_FINAL_SHADER));
    this.sunraysMaskProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.SUNRAYS_MASK_SHADER));
    this.sunraysProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.SUNRAYS_SHADER));
    this.splatProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.SPLAT_SHADER));
    this.advectionProgram = new Program(
      gl,
      baseVertex,
      this.compileShader(gl.FRAGMENT_SHADER, shaders.ADVECTION_SHADER, this.ext.supportLinearFiltering ? [] : ["MANUAL_FILTERING"]),
    );
    this.divergenceProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.DIVERGENCE_SHADER));
    this.curlProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.CURL_SHADER));
    this.vorticityProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.VORTICITY_SHADER));
    this.pressureProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.PRESSURE_SHADER));
    this.gradientSubtractProgram = new Program(gl, baseVertex, this.compileShader(gl.FRAGMENT_SHADER, shaders.GRADIENT_SUBTRACT_SHADER));
    this.displayMaterial = new Material(gl, baseVertex, shaders.DISPLAY_SHADER);
    this.displayMaterial.setKeywords(this.displayKeywords());

    this.ditheringTexture = this.createDitheringTexture();

    this.setupBlitBuffers();
    this.pointers.push(newPointer());

    this.initFramebuffers();
  }

  start(): void {
    if (this.running)
      return;
    this.running = true;
    this.lastUpdateTime = Date.now();
    this.canvas.addEventListener("mouseover", this.onMouseOver);
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("touchstart", this.onTouchStart);
    this.canvas.addEventListener("touchmove", this.onTouchMove);
    window.addEventListener("touchend", this.onTouchEnd);
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running)
      return;
    this.running = false;
    this.canvas.removeEventListener("mouseover", this.onMouseOver);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("touchstart", this.onTouchStart);
    this.canvas.removeEventListener("touchmove", this.onTouchMove);
    window.removeEventListener("touchend", this.onTouchEnd);
  }

  update(options: Partial<OptionValues>): void {
    const prev = this.values;
    const next = {...prev};
    const {
      simRes,
      dyeRes,
      densityFade,
      velocityFade,
      pressure,
      curl,
      radius,
      force,
      shading,
      colorful,
      bloom,
      sunrays,
    } = options;
    if (typeof simRes === "number")
      next.simRes = simRes;
    if (typeof dyeRes === "number")
      next.dyeRes = dyeRes;
    if (typeof densityFade === "number")
      next.densityFade = densityFade;
    if (typeof velocityFade === "number")
      next.velocityFade = velocityFade;
    if (typeof pressure === "number")
      next.pressure = pressure;
    if (typeof curl === "number")
      next.curl = curl;
    if (typeof radius === "number")
      next.radius = radius;
    if (typeof force === "number")
      next.force = force;
    if (typeof shading === "boolean")
      next.shading = shading;
    if (typeof colorful === "boolean")
      next.colorful = colorful;
    if (typeof bloom === "boolean")
      next.bloom = bloom;
    if (typeof sunrays === "boolean")
      next.sunrays = sunrays;
    this.values = next;

    if (next.shading !== prev.shading || next.bloom !== prev.bloom || next.sunrays !== prev.sunrays)
      this.displayMaterial.setKeywords(this.displayKeywords());
    if (next.simRes !== prev.simRes || next.dyeRes !== prev.dyeRes)
      this.initFramebuffers();
  }

  // The schema's action button lands here; same as the source page's space key.
  randomSplats(amount: number): void {
    this.splatStack.push(amount);
  }

  private readonly frame = (): void => {
    if (!this.running)
      return;
    requestAnimationFrame(this.frame);

    const now = Date.now();
    const dt = Math.min((now - this.lastUpdateTime) / 1000, 0.016666);
    this.lastUpdateTime = now;

    if (this.resizeCanvas())
      this.initFramebuffers();
    this.updateColors(dt);
    this.applyInputs();
    this.step(dt);
    this.render();
  };

  private readonly onMouseOver = (e: MouseEvent): void => {
    const posX = scaleByPixelRatio(e.offsetX);
    const posY = scaleByPixelRatio(e.offsetY);
    const pointer = this.pointers.find((p) => p.id === -1) ?? newPointer();
    this.updatePointerDownData(pointer, -1, posX, posY);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const pointer = this.pointers[0];
    if (!pointer.down)
      return;
    const posX = scaleByPixelRatio(e.offsetX);
    const posY = scaleByPixelRatio(e.offsetY);
    this.updatePointerMoveData(pointer, posX, posY);
  };

  private readonly onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    const touches = e.targetTouches;
    while (touches.length >= this.pointers.length)
      this.pointers.push(newPointer());
    for (let i = 0; i < touches.length; i++) {
      const posX = scaleByPixelRatio(touches[i].pageX);
      const posY = scaleByPixelRatio(touches[i].pageY);
      this.updatePointerDownData(this.pointers[i + 1], touches[i].identifier, posX, posY);
    }
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    const touches = e.targetTouches;
    for (let i = 0; i < touches.length; i++) {
      const pointer = this.pointers[i + 1];
      if (!pointer.down)
        continue;
      const posX = scaleByPixelRatio(touches[i].pageX);
      const posY = scaleByPixelRatio(touches[i].pageY);
      this.updatePointerMoveData(pointer, posX, posY);
    }
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    const touches = e.changedTouches;
    for (let i = 0; i < touches.length; i++) {
      const pointer = this.pointers.find((p) => p.id === touches[i].identifier);
      if (pointer === undefined)
        continue;
      pointer.down = false;
    }
  };

  private compileShader(type: number, source: string, keywords: string[] = []): WebGLShader {
    const gl = this.gl;
    let sourceWithKeywords = source;
    if (keywords.length > 0)
      sourceWithKeywords = keywords.map((keyword) => `#define ${keyword}\n`).join("") + source;

    const shader = gl.createShader(type);
    if (shader === null)
      throw new Error("fluid: failed to create shader");
    gl.shaderSource(shader, sourceWithKeywords);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true)
      throw new Error(`fluid: shader compile failed: ${gl.getShaderInfoLog(shader) ?? "unknown"}`);
    return shader;
  }

  private displayKeywords(): string[] {
    const keywords: string[] = [];
    if (this.values.shading)
      keywords.push("SHADING");
    if (this.values.bloom)
      keywords.push("BLOOM");
    if (this.values.sunrays)
      keywords.push("SUNRAYS");
    return keywords;
  }

  private createDitheringTexture(): FluidSim["ditheringTexture"] {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (texture === null)
      throw new Error("fluid: failed to create dithering texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));

    return {
      texture,
      width: 1,
      height: 1,
      attach: (id: number): number => {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  // Fullscreen-triangle-strip quad + index buffer, shared by every pass.
  private setupBlitBuffers(): void {
    const gl = this.gl;
    const positionBuffer = gl.createBuffer();
    if (positionBuffer === null)
      throw new Error("fluid: failed to create blit buffers");
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const indexBuffer = gl.createBuffer();
    if (indexBuffer === null)
      throw new Error("fluid: failed to create blit buffers");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
  }

  private blit(target: Fbo | null, clear = false): void {
    const gl = this.gl;
    if (target === null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    if (clear) {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  private getResolution(resolution: number): {width: number, height: number} {
    const gl = this.gl;
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (gl.drawingBufferWidth < gl.drawingBufferHeight)
      aspectRatio = 1.0 / aspectRatio;

    const min = Math.round(resolution);
    const max = Math.round(resolution * aspectRatio);

    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? {width: max, height: min}
      : {width: min, height: max};
  }

  private createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): Fbo {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    if (texture === null)
      throw new Error("fluid: failed to create fbo texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    if (fbo === null)
      throw new Error("fluid: failed to create framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1.0 / w,
      texelSizeY: 1.0 / h,
      attach: (id: number): number => {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  private createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number): DoubleFbo {
    return new DoubleFbo(
      this.createFBO(w, h, internalFormat, format, type, param),
      this.createFBO(w, h, internalFormat, format, type, param),
    );
  }

  private resizeFbo(target: Fbo, w: number, h: number, internalFormat: number, format: number, type: number, param: number): Fbo {
    const newFbo = this.createFBO(w, h, internalFormat, format, type, param);
    this.copyProgram.bind();
    this.gl.uniform1i(this.copyProgram.uniforms["uTexture"], target.attach(0));
    this.blit(newFbo);
    return newFbo;
  }

  private resizeDoubleFbo(target: DoubleFbo, w: number, h: number, internalFormat: number, format: number, type: number, param: number): DoubleFbo {
    if (target.width === w && target.height === h)
      return target;
    target.read = this.resizeFbo(target.read, w, h, internalFormat, format, type, param);
    target.write = this.createFBO(w, h, internalFormat, format, type, param);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1.0 / w;
    target.texelSizeY = 1.0 / h;
    return target;
  }

  private initFramebuffers(): void {
    const gl = this.gl;
    const simRes = this.getResolution(this.values.simRes);
    const dyeRes = this.getResolution(this.values.dyeRes);

    const {texType, rgba, rg, r} = this.ext;
    const filtering = this.ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    this.dye = !this.framebuffersInitialized
      ? this.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
      : this.resizeDoubleFbo(this.dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    this.velocity = !this.framebuffersInitialized
      ? this.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
      : this.resizeDoubleFbo(this.velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    this.framebuffersInitialized = true;

    this.divergence = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    this.curl = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    this.pressure = this.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

    this.initBloomFramebuffers();
    this.initSunraysFramebuffers();
  }

  private initBloomFramebuffers(): void {
    const res = this.getResolution(BLOOM_RESOLUTION);
    const {texType, rgba} = this.ext;
    const filtering = this.ext.supportLinearFiltering ? this.gl.LINEAR : this.gl.NEAREST;

    this.bloom = this.createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

    this.bloomFramebuffers = [];
    for (let i = 0; i < BLOOM_ITERATIONS; i++) {
      const width = res.width >> (i + 1);
      const height = res.height >> (i + 1);
      if (width < 2 || height < 2)
        break;
      this.bloomFramebuffers.push(this.createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering));
    }
  }

  private initSunraysFramebuffers(): void {
    const res = this.getResolution(SUNRAYS_RESOLUTION);
    const {texType, r} = this.ext;
    const filtering = this.ext.supportLinearFiltering ? this.gl.LINEAR : this.gl.NEAREST;

    this.sunrays = this.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
    this.sunraysTemp = this.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
  }

  private resizeCanvas(): boolean {
    const width = scaleByPixelRatio(this.canvas.clientWidth);
    const height = scaleByPixelRatio(this.canvas.clientHeight);
    if (this.canvas.width === width && this.canvas.height === height)
      return false;

    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  private updateColors(dt: number): void {
    if (!this.values.colorful)
      return;

    this.colorUpdateTimer += dt * COLOR_UPDATE_SPEED;
    if (this.colorUpdateTimer >= 1) {
      this.colorUpdateTimer = wrap(this.colorUpdateTimer, 0, 1);
      for (const pointer of this.pointers)
        pointer.color = generateColor();
    }
  }

  private applyInputs(): void {
    if (this.splatStack.length > 0) {
      const amount = this.splatStack.pop();
      if (amount !== undefined)
        this.multipleSplats(amount);
    }

    for (const pointer of this.pointers) {
      if (!pointer.moved)
        continue;
      pointer.moved = false;
      this.splatPointer(pointer);
    }
  }

  private step(dt: number): void {
    const gl = this.gl;

    gl.disable(gl.BLEND);

    this.curlProgram.bind();
    gl.uniform2f(this.curlProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.curlProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    this.blit(this.curl);

    this.vorticityProgram.bind();
    gl.uniform2f(this.vorticityProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.vorticityProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    gl.uniform1i(this.vorticityProgram.uniforms["uCurl"], this.curl.attach(1));
    gl.uniform1f(this.vorticityProgram.uniforms["curl"], this.values.curl);
    gl.uniform1f(this.vorticityProgram.uniforms["dt"], dt);
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.divergenceProgram.bind();
    gl.uniform2f(this.divergenceProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.divergenceProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    this.blit(this.divergence);

    this.clearProgram.bind();
    gl.uniform1i(this.clearProgram.uniforms["uTexture"], this.pressure.read.attach(0));
    gl.uniform1f(this.clearProgram.uniforms["value"], this.values.pressure);
    this.blit(this.pressure.write);
    this.pressure.swap();

    this.pressureProgram.bind();
    gl.uniform2f(this.pressureProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.pressureProgram.uniforms["uDivergence"], this.divergence.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this.pressureProgram.uniforms["uPressure"], this.pressure.read.attach(1));
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    this.gradientSubtractProgram.bind();
    gl.uniform2f(this.gradientSubtractProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    gl.uniform1i(this.gradientSubtractProgram.uniforms["uPressure"], this.pressure.read.attach(0));
    gl.uniform1i(this.gradientSubtractProgram.uniforms["uVelocity"], this.velocity.read.attach(1));
    this.blit(this.velocity.write);
    this.velocity.swap();

    this.advectionProgram.bind();
    gl.uniform2f(this.advectionProgram.uniforms["texelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    if (!this.ext.supportLinearFiltering)
      gl.uniform2f(this.advectionProgram.uniforms["dyeTexelSize"], this.velocity.texelSizeX, this.velocity.texelSizeY);
    const velocityId = this.velocity.read.attach(0);
    gl.uniform1i(this.advectionProgram.uniforms["uVelocity"], velocityId);
    gl.uniform1i(this.advectionProgram.uniforms["uSource"], velocityId);
    gl.uniform1f(this.advectionProgram.uniforms["dt"], dt);
    gl.uniform1f(this.advectionProgram.uniforms["dissipation"], this.values.velocityFade);
    this.blit(this.velocity.write);
    this.velocity.swap();

    if (!this.ext.supportLinearFiltering)
      gl.uniform2f(this.advectionProgram.uniforms["dyeTexelSize"], this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1i(this.advectionProgram.uniforms["uVelocity"], this.velocity.read.attach(0));
    gl.uniform1i(this.advectionProgram.uniforms["uSource"], this.dye.read.attach(1));
    gl.uniform1f(this.advectionProgram.uniforms["dissipation"], this.values.densityFade);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  private render(): void {
    const gl = this.gl;
    if (this.values.bloom)
      this.applyBloom(this.dye.read, this.bloom);
    if (this.values.sunrays) {
      this.applySunrays(this.dye.read, this.dye.write, this.sunrays);
      this.blur(this.sunrays, this.sunraysTemp, 1);
    }

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    this.drawDisplay();
  }

  private drawDisplay(): void {
    const gl = this.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    this.displayMaterial.bind();
    if (this.values.shading)
      gl.uniform2f(this.displayMaterial.uniforms["texelSize"], 1.0 / width, 1.0 / height);
    gl.uniform1i(this.displayMaterial.uniforms["uTexture"], this.dye.read.attach(0));
    if (this.values.bloom) {
      gl.uniform1i(this.displayMaterial.uniforms["uBloom"], this.bloom.attach(1));
      gl.uniform1i(this.displayMaterial.uniforms["uDithering"], this.ditheringTexture.attach(2));
      const scale = {
        x: width / this.ditheringTexture.width,
        y: height / this.ditheringTexture.height,
      };
      gl.uniform2f(this.displayMaterial.uniforms["ditherScale"], scale.x, scale.y);
    }
    if (this.values.sunrays)
      gl.uniform1i(this.displayMaterial.uniforms["uSunrays"], this.sunrays.attach(3));
    this.blit(null);
  }

  private applyBloom(source: Fbo, destination: Fbo): void {
    if (this.bloomFramebuffers.length < 2)
      return;

    const gl = this.gl;
    let last = destination;

    gl.disable(gl.BLEND);
    this.bloomPrefilterProgram.bind();
    const knee = BLOOM_THRESHOLD * BLOOM_SOFT_KNEE + 0.0001;
    const curve0 = BLOOM_THRESHOLD - knee;
    const curve1 = knee * 2;
    const curve2 = 0.25 / knee;
    gl.uniform3f(this.bloomPrefilterProgram.uniforms["curve"], curve0, curve1, curve2);
    gl.uniform1f(this.bloomPrefilterProgram.uniforms["threshold"], BLOOM_THRESHOLD);
    gl.uniform1i(this.bloomPrefilterProgram.uniforms["uTexture"], source.attach(0));
    this.blit(last);

    this.bloomBlurProgram.bind();
    for (const dest of this.bloomFramebuffers) {
      gl.uniform2f(this.bloomBlurProgram.uniforms["texelSize"], last.texelSizeX, last.texelSizeY);
      gl.uniform1i(this.bloomBlurProgram.uniforms["uTexture"], last.attach(0));
      this.blit(dest);
      last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);

    for (let i = this.bloomFramebuffers.length - 2; i >= 0; i--) {
      const baseTex = this.bloomFramebuffers[i];
      gl.uniform2f(this.bloomBlurProgram.uniforms["texelSize"], last.texelSizeX, last.texelSizeY);
      gl.uniform1i(this.bloomBlurProgram.uniforms["uTexture"], last.attach(0));
      gl.viewport(0, 0, baseTex.width, baseTex.height);
      this.blit(baseTex);
      last = baseTex;
    }

    gl.disable(gl.BLEND);
    this.bloomFinalProgram.bind();
    gl.uniform2f(this.bloomFinalProgram.uniforms["texelSize"], last.texelSizeX, last.texelSizeY);
    gl.uniform1i(this.bloomFinalProgram.uniforms["uTexture"], last.attach(0));
    gl.uniform1f(this.bloomFinalProgram.uniforms["intensity"], BLOOM_INTENSITY);
    this.blit(destination);
  }

  private applySunrays(source: Fbo, mask: Fbo, destination: Fbo): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    this.sunraysMaskProgram.bind();
    gl.uniform1i(this.sunraysMaskProgram.uniforms["uTexture"], source.attach(0));
    this.blit(mask);

    this.sunraysProgram.bind();
    gl.uniform1f(this.sunraysProgram.uniforms["weight"], SUNRAYS_WEIGHT);
    gl.uniform1i(this.sunraysProgram.uniforms["uTexture"], mask.attach(0));
    this.blit(destination);
  }

  private blur(target: Fbo, temp: Fbo, iterations: number): void {
    this.blurProgram.bind();
    for (let i = 0; i < iterations; i++) {
      this.gl.uniform2f(this.blurProgram.uniforms["texelSize"], target.texelSizeX, 0.0);
      this.gl.uniform1i(this.blurProgram.uniforms["uTexture"], target.attach(0));
      this.blit(temp);

      this.gl.uniform2f(this.blurProgram.uniforms["texelSize"], 0.0, target.texelSizeY);
      this.gl.uniform1i(this.blurProgram.uniforms["uTexture"], temp.attach(0));
      this.blit(target);
    }
  }

  private splatPointer(pointer: Pointer): void {
    const dx = pointer.deltaX * this.values.force;
    const dy = pointer.deltaY * this.values.force;
    this.splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
  }

  private multipleSplats(amount: number): void {
    for (let i = 0; i < amount; i++) {
      const {r, g, b} = generateColor();
      const x = Math.random();
      const y = Math.random();
      const dx = 1000 * (Math.random() - 0.5);
      const dy = 1000 * (Math.random() - 0.5);
      this.splat(x, y, dx, dy, {r: r * 10, g: g * 10, b: b * 10});
    }
  }

  private splat(x: number, y: number, dx: number, dy: number, color: Color): void {
    const gl = this.gl;
    this.splatProgram.bind();
    gl.uniform1i(this.splatProgram.uniforms["uTarget"], this.velocity.read.attach(0));
    gl.uniform1f(this.splatProgram.uniforms["aspectRatio"], this.canvas.width / this.canvas.height);
    gl.uniform2f(this.splatProgram.uniforms["point"], x, y);
    gl.uniform3f(this.splatProgram.uniforms["color"], dx, dy, 0.0);
    gl.uniform1f(this.splatProgram.uniforms["radius"], correctRadius(this.values.radius / 100.0, this.canvas));
    this.blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(this.splatProgram.uniforms["uTarget"], this.dye.read.attach(0));
    gl.uniform3f(this.splatProgram.uniforms["color"], color.r, color.g, color.b);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  private updatePointerDownData(pointer: Pointer, id: number, posX: number, posY: number): void {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / this.canvas.width;
    pointer.texcoordY = 1.0 - posY / this.canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = generateColor();
  }

  private updatePointerMoveData(pointer: Pointer, posX: number, posY: number): void {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / this.canvas.width;
    pointer.texcoordY = 1.0 - posY / this.canvas.height;
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX, this.canvas);
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY, this.canvas);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
  }
}

class DoubleFbo {
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  private fbo1: Fbo;
  private fbo2: Fbo;

  constructor(fbo1: Fbo, fbo2: Fbo) {
    this.fbo1 = fbo1;
    this.fbo2 = fbo2;
    this.width = fbo1.width;
    this.height = fbo1.height;
    this.texelSizeX = fbo1.texelSizeX;
    this.texelSizeY = fbo1.texelSizeY;
  }

  get read(): Fbo {
    return this.fbo1;
  }

  set read(value: Fbo) {
    this.fbo1 = value;
  }

  get write(): Fbo {
    return this.fbo2;
  }

  set write(value: Fbo) {
    this.fbo2 = value;
  }

  swap(): void {
    const temp = this.fbo1;
    this.fbo1 = this.fbo2;
    this.fbo2 = temp;
  }
}

function correctRadius(radius: number, canvas: HTMLCanvasElement): number {
  const aspectRatio = canvas.width / canvas.height;
  if (aspectRatio > 1)
    radius *= aspectRatio;
  return radius;
}

function correctDeltaX(delta: number, canvas: HTMLCanvasElement): number {
  const aspectRatio = canvas.width / canvas.height;
  if (aspectRatio < 1)
    delta *= aspectRatio;
  return delta;
}

function correctDeltaY(delta: number, canvas: HTMLCanvasElement): number {
  const aspectRatio = canvas.width / canvas.height;
  if (aspectRatio > 1)
    delta /= aspectRatio;
  return delta;
}

function wrap(value: number, min: number, max: number): number {
  if (max === min)
    return min;
  return (value - min) % (max - min) + min;
}
