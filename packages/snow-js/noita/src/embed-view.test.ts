// Unit coverage for the embed's two view geometry modes.
import {describe, expect, test} from "bun:test";
import {computeView} from "./embed.ts";

describe("computeView", () => {
  test.each([
    // 16:9 host: the width follows the aspect ratio, the height stays 320.
    {
      name: "preview keeps the fixed 320px buffer and one-cell-one-pixel scale",
      width: 1920,
      height: 1080,
      pixelRatio: 2,
      fullscreen: false,
      zoom: 1,
      expected: {width: 569, height: 320, scale: 1},
    },
    {
      name: "preview zoom scales the world, not the buffer",
      width: 1920,
      height: 1080,
      pixelRatio: 2,
      fullscreen: false,
      zoom: 2,
      expected: {width: 569, height: 320, scale: 2},
    },
    // fullscreenView: min(3840, 2160)/2/146 = 2160/292
    {
      name: "fullscreen sizes the buffer to host device pixels",
      width: 1920,
      height: 1080,
      pixelRatio: 2,
      fullscreen: true,
      zoom: 1,
      expected: {width: 3840, height: 2160, scale: 2160 / 292},
    },
    {
      name: "fullscreen zoom multiplies the scale, not the buffer",
      width: 1920,
      height: 1080,
      pixelRatio: 2,
      fullscreen: true,
      zoom: 2,
      expected: {width: 3840, height: 2160, scale: (2160 / 292) * 2},
    },
    {
      name: "fullscreen clamps a collapsed host to 1×1",
      width: 0,
      height: 0,
      pixelRatio: 2,
      fullscreen: true,
      zoom: 1,
      expected: {width: 1, height: 1, scale: 1 / 292},
    },
  ])("$name", ({width, height, pixelRatio, fullscreen, zoom, expected}) => {
    expect(computeView(width, height, pixelRatio, fullscreen, zoom)).toEqual(expected);
  });
});

