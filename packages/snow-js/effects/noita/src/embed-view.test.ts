// Unit coverage for the embed's two view geometry modes.
import {describe, expect, test} from "bun:test";
import {computeView} from "./embed.ts";

describe("computeView", () => {
  test("preview keeps the fixed 320px buffer and one-cell-one-pixel scale", () => {
    // 16:9 host: the width follows the aspect ratio, the height stays 320.
    expect(computeView(1920, 1080, 2, false, 1)).toEqual({width: 569, height: 320, scale: 1});
  });

  test("preview zoom scales the world, not the buffer", () => {
    expect(computeView(1920, 1080, 2, false, 2)).toEqual({width: 569, height: 320, scale: 2});
  });

  test("fullscreen sizes the buffer to host device pixels", () => {
    // fullscreenView: min(3840, 2160)/2/146 = 2160/292
    expect(computeView(1920, 1080, 2, true, 1)).toEqual({
      width: 3840,
      height: 2160,
      scale: 2160 / 292,
    });
  });

  test("fullscreen zoom multiplies the scale, not the buffer", () => {
    expect(computeView(1920, 1080, 2, true, 2)).toEqual({
      width: 3840,
      height: 2160,
      scale: (2160 / 292) * 2,
    });
  });

  test("fullscreen clamps a collapsed host to 1×1", () => {
    expect(computeView(0, 0, 2, true, 1)).toEqual({width: 1, height: 1, scale: 1 / 292});
  });
});

