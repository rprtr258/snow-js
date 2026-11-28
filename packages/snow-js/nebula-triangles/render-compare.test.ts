// Renders nebulaTriangles in headless chromium and compares the result
// against the source wallpaper committed next to this test (reference.png,
// copied byte-for-byte from the original download, which is a PNG despite its
// .jpg name). speed = 0 and twinkle = 0 make the render a pure function of
// pixel position (all noise is position-hashed), so a statistical pixel
// comparison is stable; byte-exact snapshots are not, since WebGL rounding
// differs between GPUs and SwiftShader versions. Skipped when no matching
// chromium is installed; CI installs it explicitly before running tests.
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "bun:test";
import {chromium} from "playwright";

const REFERENCE = new URL("./reference.png", import.meta.url);
// The glsl host sizes the canvas backing store to 0.8 * window size, so a
// 1600x900 viewport yields the 1280x720 backing the effect was calibrated at.
const VIEWPORT = {width: 1600, height: 900};
// Empirical gates: the SwiftShader render sits at mean 9.1 / p99 72 vs the
// reference (residual is the unreproducible organic noise pattern and the
// random star placement; most background pixels match within a few levels).
// Headroom absorbs GPU/SwiftShader rounding drift.
const MAX_MEAN_DIFF = 12;
const MAX_P99_DIFF = 90;

const chromiumPath = chromium.executablePath();
const hasChromium = chromiumPath !== "" && existsSync(chromiumPath);

// Per-channel means are returned as [r, g, b].
type CompareMetrics = {
  mean: number,
  perChannel: number[],
  p95: number,
  p99: number,
  // Base64 PNG of a reference | render | diff strip.
  comboBase64: string,
};

// The effect ships uncompiled TypeScript, so the browser bundle is built from
// a tiny generated entry; Bun.build needs a real file on disk.
const ENTRY_SOURCE = (effectEntry: string) => `
import {createEffect} from ${JSON.stringify(effectEntry)};

try {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const effect = createEffect(canvas, "nebulaTriangles", {speed: 0, twinkle: 0});
  effect.start();
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__done = true; }));
} catch (error) {
  window.__err = String(error);
}
`;

// Decode both PNGs, resample the reference to the render's size, and compare
// per channel. Also composes a reference|render|diff strip used as the
// failure artifact. Serialized and run inside the page; must stay
// self-contained (no closure references).
async function compareInPage([renderB64, referenceB64]: [string, string]): Promise<CompareMetrics> {
  const load = (b64: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = "data:image/png;base64," + b64;
  });
  const [renderImg, referenceImg] = await Promise.all([load(renderB64), load(referenceB64)]);
  const w = renderImg.width;
  const h = renderImg.height;
  const grab = (img: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx === null)
      throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const rendered = grab(renderImg);
  const reference = grab(referenceImg);

  const histogram: number[] = new Array<number>(256).fill(0);
  const sums = [0, 0, 0];
  for (let i = 0; i < rendered.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = Math.abs(rendered[i + c] - reference[i + c]);
      sums[c] += diff;
      histogram[diff]++;
    }
  }
  const pixels = rendered.length / 4;
  // The histogram is per channel value, so percentiles index into 3*pixels.
  const values = pixels * 3;
  const percentile = (p: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += histogram[v];
      if (seen >= p * values) return v;
    }
    return 255;
  };

  const strip = document.createElement("canvas");
  strip.width = w;
  strip.height = h * 3;
  const sctx = strip.getContext("2d");
  if (sctx === null)
    throw new Error("no 2d context");
  sctx.drawImage(referenceImg, 0, 0, w, h);
  sctx.drawImage(renderImg, 0, h, w, h);
  const heat = sctx.getImageData(0, h * 2, w, h);
  for (let i = 0; i < heat.data.length; i += 4) {
    heat.data[i] = Math.abs(rendered[i] - reference[i]);
    heat.data[i + 1] = Math.abs(rendered[i + 1] - reference[i + 1]);
    heat.data[i + 2] = Math.abs(rendered[i + 2] - reference[i + 2]);
    heat.data[i + 3] = 255;
  }
  sctx.putImageData(heat, 0, h * 2);

  return {
    mean: (sums[0] + sums[1] + sums[2]) / (3 * pixels),
    perChannel: sums.map((sum) => sum / pixels),
    p95: percentile(0.95),
    p99: percentile(0.99),
    comboBase64: strip.toDataURL("image/png").split(",")[1] ?? "",
  };
}


test.skipIf(!hasChromium)(
  "nebulaTriangles render matches the source wallpaper",
  async () => {
    const entryUrl = new URL("../index.ts", import.meta.url);
    const scratch = await mkdtemp(join(tmpdir(), "nebula-compare-"));
    try {
      const entry = join(scratch, "entry.ts");
      await writeFile(entry, ENTRY_SOURCE(entryUrl.pathname));
      const bundle = await Bun.build({entrypoints: [entry], target: "browser", format: "esm"});
      if (!bundle.success)
        throw new Error(`effect bundle failed: ${bundle.logs.map(String).join("\n")}`);
      const output = bundle.outputs.at(0);
      if (output === undefined)
        throw new Error("effect bundle produced no output");
      const script = await output.text();

      const browser = await chromium.launch({args: ["--enable-unsafe-swiftshader"]});
      try {
        const page = await browser.newPage({viewport: VIEWPORT});
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        await page.setContent("<!doctype html><style>body{margin:0}</style><body></body>");
        // Inline module script: the bundle is self-contained, and an inline
        // module is the only script kind allowed to use import.meta.
        await page.addScriptTag({type: "module", content: script});
        await page.waitForFunction("window.__done === true || window.__err", undefined, {timeout: 20000});
        const setupError = await page.evaluate<string | null>("window.__err ?? null");
        if (setupError !== null || pageErrors.length > 0)
          throw new Error(`render failed: ${setupError ?? ""} ${pageErrors.join("; ")}`);

        const screenshot = await page.locator("canvas").screenshot();
        const reference = Buffer.from(await Bun.file(REFERENCE).arrayBuffer());
        const args: [string, string] = [screenshot.toString("base64"), reference.toString("base64")];
        const metrics = await page.evaluate<CompareMetrics, [string, string]>(compareInPage, args);
        console.info(
          `nebulaTriangles vs reference: mean ${metrics.mean.toFixed(2)} ` +
          `(r ${metrics.perChannel[0].toFixed(2)} g ${metrics.perChannel[1].toFixed(2)} ` +
          `b ${metrics.perChannel[2].toFixed(2)}), p95 ${metrics.p95}, p99 ${metrics.p99}`,
        );

        if (metrics.mean > MAX_MEAN_DIFF || metrics.p99 > MAX_P99_DIFF) {
          // Outside the deleted scratch dir so the artifacts outlive it.
          const artifactDir = join(tmpdir(), "nebula-triangles-compare");
          await mkdir(artifactDir, {recursive: true});
          await writeFile(join(artifactDir, "compare.png"), Buffer.from(metrics.comboBase64, "base64"));
          await writeFile(join(artifactDir, "render.png"), screenshot);
          const reason = metrics.mean > MAX_MEAN_DIFF
            ? `mean ${metrics.mean.toFixed(2)} > ${MAX_MEAN_DIFF}`
            : `p99 ${metrics.p99} > ${MAX_P99_DIFF}`;
          throw new Error(
            `render diverged from the wallpaper: ${reason}; artifacts in ${artifactDir} ` +
            "(reference | render | diff top to bottom)",
          );
        }
      } finally {
        await browser.close();
      }
    } finally {
      await rm(scratch, {recursive: true, force: true});
    }
  },
  60000,
);
