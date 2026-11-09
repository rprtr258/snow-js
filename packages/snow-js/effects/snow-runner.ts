// Shared lifecycle for fragment-shader effects: canvas setup, cached uniform
// values, time accumulation. Extracted from the former Snow component.
import {GL, VERTEX_GLSL} from "../glsl.ts";
import type {EffectInstance, OptionValues} from "../effect.ts";

export type UniformMap = Record<string, number | [number, number, number, number]>;

export type ShaderEffectParams<V extends OptionValues> = {
  fragment: string,
  values: V,
  toUniforms: (values: V) => UniformMap,
  // Per-frame time delta before the /1000 scaling (the old Snow `speed`).
  speedOf: (values: V) => number,
};

class ShaderEffect<V extends OptionValues> implements EffectInstance {
  declare params: ShaderEffectParams<V>;
  declare canvas: HTMLCanvasElement;
  declare gl: GL;
  declare values: V;
  declare uniforms: UniformMap;
  declare time: number;

  constructor(el: Element, params: ShaderEffectParams<V>) {
    this.params = params;
    this.values = params.values;
    this.uniforms = params.toUniforms(this.values);
    this.time = 0;
    this.canvas = createCanvasNode(el);
    this.gl = new GL(
      this.canvas,
      VERTEX_GLSL,
      params.fragment,
      {renderHook: () => this.render()},
      Object.keys(this.uniforms),
    );
  }

  private render(): void {
    this.time += this.params.speedOf(this.values) / 1000;
    const gl = this.gl;
    gl.ctx.uniform1f(gl.programInfo.uniforms.time, this.time);
    for (const [key, value] of Object.entries(this.uniforms)) {
      const location = gl.programInfo.uniforms[key];
      if (Array.isArray(value))
        gl.ctx.uniform4f(location, value[0], value[1], value[2], value[3]);
      else
        gl.ctx.uniform1f(location, value);
    }
  }

  update(options: Partial<OptionValues>): void {
    this.values = {...this.values, ...options};
    this.uniforms = this.params.toUniforms(this.values);
  }
  start(): void {
    this.gl.running = true;
  }
  stop(): void {
    this.gl.running = false;
  }
  unmount(): void {
    this.gl.running = false;
    this.canvas.parentNode?.removeChild(this.canvas);
  }
}

function createCanvasNode(el: Element): HTMLCanvasElement {
  if (el instanceof HTMLCanvasElement) {
    if (!el.isConnected)
      document.body.append(el);
    return el;
  }
  const canvas = document.createElement("canvas");
  el.append(canvas);
  return canvas;
}

export function createShaderEffect<V extends OptionValues>(el: Element, params: ShaderEffectParams<V>): EffectInstance {
  return new ShaderEffect(el, params);
}
