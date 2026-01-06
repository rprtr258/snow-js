export type FieldType = "float" | "int" | "vec2" | "ivec2" | "vec3" | "ivec3" | "vec4" | "ivec4";

interface WindowListenerCallback {
  event: string,
  listener: (event: MouseEvent) => void,
  options?: boolean | AddEventListenerOptions,
}

interface GlOption {
  renderHook: () => void,
  windowListener?: WindowListenerCallback[],
}

function createShader(ctx: WebGLRenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = ctx.createShader(type);
  if (!shader)
    throw new Error(`Invalid shader type: ${type}`);

  ctx.shaderSource(shader, source);
  ctx.compileShader(shader);

  if (ctx.getShaderParameter(shader, ctx.COMPILE_STATUS) !== true)
    throw new Error(`An error occurred compiling the shaders: ${ctx.getShaderInfoLog(shader)}`);

  return shader;
}

const positions = [
  -1.0, -1.0, 1.0,
  -1.0, -1.0, 1.0,
  -1.0,  1.0, 1.0,
  -1.0,  1.0, 1.0,
];

export class GL {
  ctx: WebGLRenderingContext;
  el: HTMLCanvasElement;

  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
  programInfo: {
    attribs: {
      vertexPosition: number,
    },
    uniforms: {
      resolution: WebGLUniformLocation | null,
      time: WebGLUniformLocation | null,
      mouse: WebGLUniformLocation | null,
    } & Record<string, WebGLUniformLocation | null>,
  };

  innerRunning = false;

  positionBuffer!: WebGLBuffer | null;

  listeners: WindowListenerCallback[] = [];
  innerPxratio = 0.8;

  renderHook: () => void;

  constructor(
    el: HTMLCanvasElement,
    vertexShaderSource: string,
    fragmentShaderSource: string,
    options: GlOption,
    keys: string[],
  ) {
    this.el = el;

    const ctx = this.el.getContext("webgl");
    if (!ctx) {
      throw new Error("Unable to initialize WebGL. Your browser or machine may not support it.");
    }

    this.ctx = ctx;

    // Create the shaders
    this.vertexShader = createShader(this.ctx, this.ctx.VERTEX_SHADER, vertexShaderSource);
    this.fragmentShader = createShader(this.ctx, this.ctx.FRAGMENT_SHADER, fragmentShaderSource);

    this.program = this.ctx.createProgram();
    if (this.program === null) {
      throw new Error(`Failed to compile WebGL program: ${this.ctx.getProgramInfoLog(this.program)}`);
    }

    this.ctx.attachShader(this.program, this.vertexShader);
    this.ctx.attachShader(this.program, this.fragmentShader);
    this.ctx.linkProgram(this.program);
    this.ctx.useProgram(this.program);
    if (this.ctx.getProgramParameter(this.program, this.ctx.LINK_STATUS) !== true)
      throw new Error("Unable to initialize the shader program: " + this.ctx.getProgramInfoLog(this.program));

    this.programInfo = {
      attribs: {
        vertexPosition: this.ctx.getAttribLocation(this.program, "aVertexPosition"),
      },
      uniforms: {
        resolution: this.ctx.getUniformLocation(this.program, "iResolution"),
        time: this.ctx.getUniformLocation(this.program, "iTime"),
        mouse: this.ctx.getUniformLocation(this.program, "iMouse"),
        ...Object.fromEntries(keys.map((k) => [k, this.ctx.getUniformLocation(this.program, k)])),
      },
    };

    this.initBuffers();

    this.renderHook = options.renderHook;

    this.listeners.push({
      event: "mousemove",
      listener: event => {
        const {x, y} = event;
        this.ctx.uniform2f(this.programInfo.uniforms.mouse, x, y);
      },
    });
    this.listeners.push({
      event: "resize",
      listener: () => this.resize(),
    });
    this.addListeners();
    this.resize();
  }

  get pxratio() {
    return this.innerPxratio;
  }
  set pxratio(value: number) {
    if (value !== this.pxratio) {
      this.innerPxratio = value;
      this.resize();
    }
  }

  set running(value) {
    if (!this.innerRunning && value) {
      requestAnimationFrame(() => this.render());
    } else if (this.innerRunning && !value) {
      this.removeListeners();
    }
    this.innerRunning = value;
  }
  get running() {
    return this.innerRunning;
  }

  render() {
    if (this.running)
      requestAnimationFrame(() => this.render());

    this.renderHook();
    this.ctx.drawArrays(this.ctx.TRIANGLES, 0, 6);
  }

  initBuffers() {
    this.positionBuffer = this.ctx.createBuffer();
    this.ctx.bindBuffer(this.ctx.ARRAY_BUFFER, this.positionBuffer);
    this.ctx.bufferData(
      this.ctx.ARRAY_BUFFER,
      new Float32Array(positions),
      this.ctx.STATIC_DRAW,
    );

    const vertexPositionLocation = this.programInfo.attribs.vertexPosition;
    this.ctx.enableVertexAttribArray(vertexPositionLocation);
    this.ctx.vertexAttribPointer(vertexPositionLocation, 2, this.ctx.FLOAT, false, 0, 0);
  }

  addListeners() {
    for (const {event, listener, options} of this.listeners)
      window.addEventListener(event, e => listener(e as MouseEvent), options); // eslint-disable-line
  }
  removeListeners() {
    for (const {event, listener, options} of this.listeners)
      window.removeEventListener(event, e => listener(e as MouseEvent), options);// eslint-disable-line
  }

  resize() {
    const {innerWidth: width, innerHeight: height} = window;

    this.el.width = width * this.pxratio;
    this.el.height = height * this.pxratio;
    this.ctx.viewport(0, 0, width * this.pxratio, height * this.pxratio);

    this.el.style.width = width + "px";
    this.el.style.height = height + "px";
    this.ctx.uniform2fv(this.programInfo.uniforms.resolution, [width * this.pxratio, height * this.pxratio]);

    this.initBuffers();
  }
}
