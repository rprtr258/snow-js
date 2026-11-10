export const VERTEX_GLSL = `
attribute vec3 aVertexPosition;

void main() {
  gl_Position = vec4(aVertexPosition, 1.0);
}
`;

type WindowListenerCallback = {
  event: string,
  listener: (event: MouseEvent) => void,
  options?: boolean | AddEventListenerOptions,
};

type GlOption = {
  renderHook: () => void,
  windowListener?: WindowListenerCallback[],
};

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

type GL = {
  ctx: WebGLRenderingContext,
  programInfo: {
    attribs: {
      vertexPosition: number,
    },
    uniforms: {
      resolution: WebGLUniformLocation | null,
      time: WebGLUniformLocation | null,
      mouse: WebGLUniformLocation | null,
    } & Record<string, WebGLUniformLocation | null>,
  },
  running: boolean,
};

export function createGL(
  el: HTMLCanvasElement,
  vertexShaderSource: string,
  fragmentShaderSource: string,
  options: GlOption,
  keys: string[],
): GL {
  const ctx = el.getContext("webgl");
  if (!ctx)
    throw new Error("Unable to initialize WebGL. Your browser or machine may not support it.");

  const vertexShader = createShader(ctx, ctx.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(ctx, ctx.FRAGMENT_SHADER, fragmentShaderSource);

  const program = ctx.createProgram();
  if (program === null)
    throw new Error(`Failed to compile WebGL program: ${ctx.getProgramInfoLog(program)}`);

  ctx.attachShader(program, vertexShader);
  ctx.attachShader(program, fragmentShader);
  ctx.linkProgram(program);
  ctx.useProgram(program);
  if (ctx.getProgramParameter(program, ctx.LINK_STATUS) !== true)
    throw new Error("Unable to initialize the shader program: " + ctx.getProgramInfoLog(program));

  const programInfo: GL["programInfo"] = {
    attribs: {
      vertexPosition: ctx.getAttribLocation(program, "aVertexPosition"),
    },
    uniforms: {
      resolution: ctx.getUniformLocation(program, "iResolution"),
      time: ctx.getUniformLocation(program, "iTime"),
      mouse: ctx.getUniformLocation(program, "iMouse"),
      ...Object.fromEntries(keys.map((k) => [k, ctx.getUniformLocation(program, k)])),
    },
  };

  const initBuffers = (): void => {
    const positionBuffer = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, positionBuffer);
    ctx.bufferData(
      ctx.ARRAY_BUFFER,
      new Float32Array(positions),
      ctx.STATIC_DRAW,
    );

    const vertexPositionLocation = programInfo.attribs.vertexPosition;
    ctx.enableVertexAttribArray(vertexPositionLocation);
    ctx.vertexAttribPointer(vertexPositionLocation, 2, ctx.FLOAT, false, 0, 0);
  };

  const pxratio = 0.8;
  const resize = (): void => {
    const {innerWidth: width, innerHeight: height} = window;

    el.width = width * pxratio;
    el.height = height * pxratio;
    ctx.viewport(0, 0, width * pxratio, height * pxratio);

    el.style.width = width + "px";
    el.style.height = height + "px";
    ctx.uniform2fv(programInfo.uniforms.resolution, [width * pxratio, height * pxratio]);

    initBuffers();
  };

  let innerRunning = false;
  const render = (): void => {
    if (innerRunning)
      requestAnimationFrame(render);

    options.renderHook();
    ctx.drawArrays(ctx.TRIANGLES, 0, 6);
  };

  const listeners: WindowListenerCallback[] = [
    {
      event: "mousemove",
      listener: event => {
        const {x, y} = event;
        ctx.uniform2f(programInfo.uniforms.mouse, x, y);
      },
    },
    {event: "resize", listener: () => resize()},
  ];
  const addListeners = (): void => {
    for (const {event, listener, options} of listeners)
      window.addEventListener(event, e => listener(e as MouseEvent), options); // eslint-disable-line
  };
  const removeListeners = (): void => {
    for (const {event, listener, options} of listeners)
      window.removeEventListener(event, e => listener(e as MouseEvent), options);// eslint-disable-line
  };

  addListeners();
  resize();

  return {
    ctx,
    programInfo,
    get running(): boolean {
      return innerRunning;
    },
    set running(value: boolean) {
      if (!innerRunning && value)
        requestAnimationFrame(render);
      else if (innerRunning && !value)
        removeListeners();
      innerRunning = value;
    },
  };
}
