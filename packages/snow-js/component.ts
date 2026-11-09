import {GL} from "./glsl.ts";
import {PRESETS, VERTEX_GLSL, type Options, type PresetKey, type SnowOptions} from "./presets.ts";
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
  options: SnowOptions;
  _speed: number;
  _time: number;
  preset: PresetKey;
  canvas: HTMLCanvasElement;
  render: GL;

  constructor(
    el: Element,
    speed: number,
    options: Partial<Options>,
    externalTimeUse: boolean,
    preset: PresetKey = "default",
  ) {
    const {fragment, defaultOptions: presetDefaults} = PRESETS[preset];
    this.options = {...presetDefaults, ...options};
    this._time = 0;
    this._speed = speed;
    this.preset = preset;
    this.canvas = createCanvasNode(el);
    const keys = Object.keys(presetDefaults);
    const startTime = Date.now();
    this.render = new GL(
      this.canvas,
      VERTEX_GLSL,
      fragment,
      {
        renderHook: () => {
          const gl = this.render;

          this._time = externalTimeUse ?
            (Date.now() - startTime) / 1000 :
            this._time + this._speed / 1000;
          gl.ctx.uniform1f(gl.programInfo.uniforms.time, this._time);

          for (const key of keys) {
            const value = this.options[key];
            if (Array.isArray(value)) {
              gl.ctx.uniform4f(gl.programInfo.uniforms[key], value[0], value[1], value[2], value[3]);
            } else {
              gl.ctx.uniform1f(gl.programInfo.uniforms[key], value);
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
  update(options: SnowOptions) {
    this.options = {...PRESETS[this.preset].defaultOptions, ...options};
  }
  mount() {
  }
  unmount() {
    this.render.running = false;
    this.canvas.parentNode?.removeChild(this.canvas);
  }
}
