// Shared lifecycle for glsl effects: canvas setup, cached uniform
// values, time accumulation. Extracted from the former Snow component.
import {createGL, VERTEX_GLSL} from "./glsl.ts";
import type {EffectInstance, OptionValues} from "./effect.ts";

export type UniformMap = Record<string, number | [number, number, number, number]>;

export type GlslEffectParams<V extends OptionValues> = {
  fragment: string,
  values: V,
  toUniforms: (values: V) => UniformMap,
  // Per-frame time delta before the /1000 scaling (the old Snow `speed`).
  speedOf: (values: V) => number,
};

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

export function createGlslEffect<V extends OptionValues>(el: Element, params: GlslEffectParams<V>): EffectInstance {
  let values = params.values;
  let uniforms = params.toUniforms(values);
  let time = 0;
  const canvas = createCanvasNode(el);
  const gl = createGL(
    canvas,
    VERTEX_GLSL,
    params.fragment,
    {renderHook: () => {
      time += params.speedOf(values) / 1000;
      gl.ctx.uniform1f(gl.programInfo.uniforms.time, time);
      for (const [key, value] of Object.entries(uniforms)) {
        const location = gl.programInfo.uniforms[key];
        if (Array.isArray(value))
          gl.ctx.uniform4f(location, value[0], value[1], value[2], value[3]);
        else
          gl.ctx.uniform1f(location, value);
      }
    }},
    Object.keys(uniforms),
  );

  return {
    start(): void {
      gl.running = true;
    },
    stop(): void {
      gl.running = false;
    },
    update(options: Partial<OptionValues>): void {
      values = {...values, ...options};
      uniforms = params.toUniforms(values);
    },
    unmount(): void {
      gl.running = false;
      canvas.parentNode?.removeChild(canvas);
    },
  };
}
