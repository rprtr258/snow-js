import {describe, expect, test} from "bun:test";
import {initialValues} from "../effect.ts";
import appleLogo from "./index.ts";

describe("appleLogo", () => {
  test("exposes the 22 documented options with source defaults", () => {
    expect(Object.keys(initialValues(appleLogo))).toEqual([
      "speed",
      "orbitSpeed",
      "orbitRadius",
      "colorPhase",
      "colorSaturation",
      "warmColor",
      "coolColor",
      "neutralColor",
      "backgroundColor",
      "glowColor",
      "glowIntensity",
      "beamIntensity",
      "bloomIntensity",
      "vignette",
      "exposure",
      "logoScale",
      "offsetX",
      "offsetY",
      "glassThickness",
      "specularStrength",
      "refractionStrength",
      "surfaceTexture",
    ]);
  });

  test("motion and light defaults match the source shader constants", () => {
    const values = initialValues(appleLogo);
    expect(values).toMatchObject({
      speed: 1,
      orbitSpeed: 1,
      orbitRadius: 0.68,
      colorPhase: 0.8,
      colorSaturation: 0.34,
      logoScale: 0.2175,
      offsetY: -0.045,
      glassThickness: 0.33,
    });
  });
});
