// Headless Chromium runs the real-WebGL shader gate (glsl.webgl.ts) on
// SwiftShader, so no GPU is needed. `--enable-unsafe-swiftshader` is required
// on newer Chromium builds where software WebGL became opt-in.
import {defineConfig} from "@playwright/test";

export default defineConfig({
  testMatch: "*.webgl.ts",
  use: {
    launchOptions: {
      args: ["--enable-unsafe-swiftshader"],
    },
  },
});
