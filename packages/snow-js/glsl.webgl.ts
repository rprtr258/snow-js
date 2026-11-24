// Real-WebGL gate: every glsl effect's shader is compiled, linked,
// uniform-driven and drawn once in headless Chromium (SwiftShader). This
// catches what static parsing cannot: expression type errors, link failures,
// uniform shape mismatches (INVALID_OPERATION on uniform1f of a vec4), and
// runtime draw errors. Convention checks that real GL accepts silently.
// Run: bunx playwright install chromium, then bun run test:glsl.
import {expect, test} from "@playwright/test";
import {resolveDefaults, InferOptions, OptionsSchema} from "./effect.ts";
import {GlslShader, UniformMap} from "./glsl-effect.ts";
import {VERTEX_GLSL} from "./glsl.ts";
import balatro, {glsl as balatroGlsl, options as balatroOptions} from "./balatro/index.ts";
import creation, {glsl as creationGlsl, options as creationOptions} from "./creation/index.ts";
import snow, {glsl as snowGlsl, options as snowOptions} from "./snow/index.ts";
import multibox, {glsl as multiboxGlsl, options as multiboxOptions} from "./multibox/index.ts";
import tiles, {glsl as tilesGlsl, options as tilesOptions} from "./tiles/index.ts";
import marbles, {glsl as marblesGlsl, options as marblesOptions} from "./marbles/index.ts";
import heavenly, {glsl as heavenlyGlsl, options as heavenlyOptions} from "./heavenly/index.ts";

type GlPayload = {vertex: string, fragment: string, uniforms: UniformMap};
type GlReport = {fatal?: string, problems: string[], errors: string[]};

function collectGlReport({vertex, fragment, uniforms}: GlPayload): GlReport {
  // page.evaluate serializes only this function: everything it needs must
  // live inside it, including the framework uniform list.
  const frameworkUniforms = new Set(["iTime", "iResolution", "iMouse"]);
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl");
  if (!gl)
    return {fatal: "WebGL context unavailable in this browser", problems: [], errors: []};

  const errorName = (code: number): string =>
    ({
      [gl.INVALID_ENUM]: "INVALID_ENUM",
      [gl.INVALID_VALUE]: "INVALID_VALUE",
      [gl.INVALID_OPERATION]: "INVALID_OPERATION",
      [gl.OUT_OF_MEMORY]: "OUT_OF_MEMORY",
      [gl.INVALID_FRAMEBUFFER_OPERATION]: "INVALID_FRAMEBUFFER_OPERATION",
    })[code] ?? String(code);

  const compile = (type: number, source: string): {ok: true, shader: WebGLShader} | {ok: false, log: string} => {
    const shader = gl.createShader(type);
    if (!shader)
      return {ok: false, log: "createShader returned null"};
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true)
      return {ok: false, log: gl.getShaderInfoLog(shader) ?? ""};
    return {ok: true, shader};
  };

  const vertexResult = compile(gl.VERTEX_SHADER, vertex);
  if (!vertexResult.ok)
    return {fatal: `vertex shader failed to compile: ${vertexResult.log}`, problems: [], errors: []};
  const fragmentResult = compile(gl.FRAGMENT_SHADER, fragment);
  if (!fragmentResult.ok)
    return {fatal: `fragment shader failed to compile: ${fragmentResult.log}`, problems: [], errors: []};

  const program = gl.createProgram();
  if (program === null)
    return {fatal: "createProgram returned null", problems: [], errors: []};
  gl.attachShader(program, vertexResult.shader);
  gl.attachShader(program, fragmentResult.shader);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true)
    return {fatal: `program failed to link: ${gl.getProgramInfoLog(program) ?? ""}`, problems: [], errors: []};
  gl.useProgram(program);

  const problems: string[] = [];
  const errors: string[] = [];

  // Linking strips unused uniforms, so ACTIVE_UNIFORMS lists exactly what the
  // shader needs; anything JS never sets would silently stay 0.
  const activeUniforms = new Set<string>();
  // getProgramParameter is typed any in lib.dom; ACTIVE_UNIFORMS yields the count.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const activeCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  if (typeof activeCount === "number") {
    for (let index = 0; index < activeCount; index++) {
      const info = gl.getActiveUniform(program, index);
      if (info)
        activeUniforms.add(info.name.replace(/\[0\]$/, ""));
    }
  }
  for (const name of activeUniforms) {
    if (!frameworkUniforms.has(name) && !(name in uniforms))
      problems.push(`uniform "${name}" active in shader but not set by toUniforms`);
  }

  for (const [name, value] of Object.entries(uniforms)) {
    const location = gl.getUniformLocation(program, name);
    if (!location) {
      problems.push(`toUniforms sets "${name}" but the shader does not declare it`);
      continue;
    }
    if (typeof value === "number")
      gl.uniform1f(location, value);
    else
      gl.uniform4f(location, value[0], value[1], value[2], value[3]);
    const code = gl.getError();
    if (code !== gl.NO_ERROR)
      errors.push(`setting "${name}" raised ${errorName(code)}`);
  }

  // One real draw: catches runtime-stage errors the link check cannot see.
  const positionBuffer = gl.createBuffer();
  if (positionBuffer !== null) {
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const attrib = gl.getAttribLocation(program, "aVertexPosition");
    if (attrib >= 0) {
      gl.enableVertexAttribArray(attrib);
      gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0);
    }
    gl.viewport(0, 0, 8, 8);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(gl.getUniformLocation(program, "iTime"), 1);
    gl.uniform2f(gl.getUniformLocation(program, "iResolution"), 8, 8);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const drawCode = gl.getError();
    if (drawCode !== gl.NO_ERROR)
      errors.push(`draw raised ${errorName(drawCode)}`);
  }

  return {problems, errors};
}

type GlslCase = {
  name: string,
  fragment: string,
  uniforms: UniformMap,
};

// toUniforms runs in Node against schema defaults; the browser only receives
// plain name→value pairs.
function glslCase<S extends OptionsSchema>(
  name: string,
  options: S,
  {fragment, toUniforms}: GlslShader<InferOptions<S>>,
): GlslCase {
  return {name, fragment, uniforms: toUniforms(resolveDefaults(options))};
}

const cases: GlslCase[] = [
  glslCase(balatro.label, balatroOptions, balatroGlsl),
  glslCase(creation.label, creationOptions, creationGlsl),
  glslCase(`${snow.label} (snow preset)`, snowOptions, snowGlsl.snow),
  glslCase(`${snow.label} (snowfall preset)`, snowOptions, snowGlsl.snowfall),
  glslCase(multibox.label, multiboxOptions, multiboxGlsl),
  glslCase(tiles.label, tilesOptions, tilesGlsl),
  glslCase(marbles.label, marblesOptions, marblesGlsl),
  glslCase(heavenly.label, heavenlyOptions, heavenlyGlsl),
];

test.describe("webgl shaders", () => {
  for (const effect of cases) {
    test(`${effect.name}: compiles, links, wires uniforms, and draws in WebGL 1`, async ({page}) => {
      const report = await page.evaluate(collectGlReport, {
        vertex: VERTEX_GLSL,
        fragment: effect.fragment,
        uniforms: effect.uniforms,
      });

      if (report.fatal !== undefined)
        expect(report.fatal, report.fatal).toBeUndefined();
      expect(report.problems).toEqual([]);
      expect(report.errors).toEqual([]);
    });
  }
});
