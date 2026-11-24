// Shared lifecycle for glsl effects: canvas setup, cached uniform
// values, time accumulation. Extracted from the former Snow component.
import {createGL, VERTEX_GLSL} from "./glsl.ts";
import {EffectInstance, InferOptions, OptionValues, OptionsSchema} from "./effect.ts";

export type UniformMap = Record<string, number | [number, number, number, number]>;

// One shader variant: source plus value→uniform mapping (snow's presets). The
// glsl tests parse `fragment` and cross-check shader uniforms against
// `toUniforms` output.
export type GlslShader<V extends OptionValues> = {
  fragment: string,
  toUniforms: (values: V) => UniformMap,
};

// EffectInstance plus a teardown for hosts that keep the canvas and need to
// release the GL resources before building a new effect on it (the snow
// wrapper's preset swap).
export type GlslEffectInstance = EffectInstance & {
  teardown(): void,
};

// Effect-side params for a single-shader effect: one GlslShader plus a
// speed mapping, keyed by the values struct.
type GlslEffectParamsFor<V extends OptionValues> = {
  fragment: string,
  toUniforms: (values: V) => UniformMap,
  // Per-frame time delta before the /1000 scaling in createGlslEffect.
  speedOf: (values: V) => number,
};

// GlslEffectParamsOf keyed by the option schema instead of the values struct.
export type GlslEffectParams<S extends OptionsSchema> = GlslEffectParamsFor<InferOptions<S>>;

export function createGlslEffect<V extends OptionValues>(
  canvas: HTMLCanvasElement,
  values: V,
  params: GlslEffectParamsFor<V>,
): GlslEffectInstance {
  let uniforms = params.toUniforms(values);
  let time = 0;
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
    teardown(): void {
      gl.running = false;
      gl.dispose();
    },
  };
}
