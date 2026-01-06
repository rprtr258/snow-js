import {GL} from "./glsl.ts";
import {defaultOptions, FRAGMENT_GLSL, VERTEX_GLSL, type Options} from "./presets.ts";
// export type Options;

function createCanvasNode(el: Element): HTMLCanvasElement {
  if (el instanceof HTMLCanvasElement) {
    if (!el.isConnected) {
      document.body.append(el);
    }

    return el;
  } else {
    const canvas = document.createElement('canvas');
    // const body = document.getElementsByTagName("body")[0]!;
    // body.appendChild(canvas);
    el.append(canvas);
    return canvas;
  }
}

export class Snow {
  options: Record<string, number | [number, number, number, number]>;
  _speed: number;
  _time: number;
  canvas: HTMLCanvasElement;
  render: GL;

  constructor(
    el: Element,
    speed: number,
    options: Partial<Options>,
    externalTimeUse: boolean,
  ) {
    this.options = {...defaultOptions, ...options};
    this._time = 0;
    this._speed = speed;
    this.canvas = createCanvasNode(el);
    const keys = Object.keys(defaultOptions);
    const startTime = Date.now();
    this.render = new GL(
      this.canvas,
      VERTEX_GLSL,
      FRAGMENT_GLSL,
      {
        renderHook: () => {
          const gl = this.render;

          this._time = externalTimeUse ?
            (Date.now() - startTime) / 1000 :
            this._time + this._speed / 1000;
          gl.ctx.uniform1f(gl.programInfo.uniforms.time, this._time);

          for (const key of keys) {
            const value = this.options[key]!;
            if (Array.isArray(value)) {
              gl.ctx.uniform4f(gl.programInfo.uniforms[key]!, value[0], value[1], value[2], value[3]);
            } else {
              gl.ctx.uniform1f(gl.programInfo.uniforms[key]!, value);
            }
          }
        },
      },
      keys,
    );
  }
  get running(): boolean {return this.render.running;}
  get time(): number {return this._time;}
  set speed(value: number) {this._speed = value;}
  start() {
    this.render.running = true;
  }
  stop() {
    this.render.running = false;
  }
  update(options: Partial<Options>) {
    this.options = {...defaultOptions, ...options};
  }
  mount() {
  }
  unmount() {
    this.render.running = false;
    this.canvas.parentNode?.removeChild(this.canvas);
  }
}
