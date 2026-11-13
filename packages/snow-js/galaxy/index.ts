// Galaxy: chaotic particle streams accumulating on a fading 2d canvas,
// ported from the PocketGalaxyJs demo (newtabs/galaxy).
import {color, defineEffect, num, type EffectInstance, type InferOptions, type OptionValues} from "../effect.ts";
import {loadKernel, LUT_BASE, setGains, type Kernel} from "./src/kernel.ts";

const options = {
  speed: num(0.0003, {label: "speed", min: 0, max: 0.002, step: 0.0001}),
  fade: num(20, {label: "fade", min: 0, max: 100, integer: true}),
  particles: num(625, {label: "particles", min: 1, max: 2500, integer: true}),
  steps: num(100, {label: "steps", min: 1, max: 1000, integer: true}),
  // Defaults to the original's constant "random" color. The canvas itself
  // stays transparent so the host's global background shows through.
  color: color("#0d0a28", {label: "color"}),
};

type GalaxyValues = InferOptions<typeof options>;

function frac(value: number): number {
  return value - Math.floor(value);
}

// "#rrggbb" (what Tweakpane's picker emits) → per-channel values.
function channels(value: string): [number, number, number] {
  const packed = parseInt(value.slice(1), 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
}

function create(el: Element, values: GalaxyValues): EffectInstance {
  const canvas = el instanceof HTMLCanvasElement ? el : el.appendChild(document.createElement("canvas"));
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const context = canvas.getContext("2d", {willReadFrequently: true});
  if (context === null)
    throw new Error("Unable to initialize 2d context.");

  let current = values;
  let time = Math.atan(Math.random() * Math.PI - Math.PI / 2);
  let running = false;

  // Persistent fallback framebuffer: fading and drawing mutate it in place,
  // so only putImageData copies to the canvas per frame (no getImageData
  // read-back). Used until the wasm kernel loads and whenever it fails to.
  let data = new Uint8ClampedArray(4);
  let imageData = new ImageData(data, 1, 1);
  let bufferWidth = 0;
  let bufferHeight = 0;

  // Wasm-path state: the kernel owns the framebuffer memory; kernelBuffer is
  // an ImageData view over it.
  let kernel: Kernel | null = null;
  let kernelBuffer: ImageData | null = null;
  let kernelWidth = 0;
  let kernelHeight = 0;

  void loadKernel().then((loaded) => {
    kernel = loaded;
    if (loaded === null)
      return;
    setGains(loaded, channels(current.color));
    // Hand off whatever the JS path already rendered so the switch to wasm
    // does not clear the accumulated canvas.
    if (bufferWidth > 0 && bufferHeight > 0) {
      const bytes = bufferWidth * bufferHeight * 4;
      new Uint8Array(loaded.mem.buffer, 0, bytes).set(data);
      kernelBuffer = new ImageData(new Uint8ClampedArray(loaded.mem.buffer, 0, bytes), bufferWidth, bufferHeight);
      kernelWidth = bufferWidth;
      kernelHeight = bufferHeight;
    }
  });

  const drawJs = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0)
      return;
    if (width !== bufferWidth || height !== bufferHeight) {
      bufferWidth = width;
      bufferHeight = height;
      canvas.width = width;
      canvas.height = height;
      // Zero-filled, matching the cleared canvas the original re-read every
      // frame: empty pixels have alpha 0 so the host background shows through.
      data = new Uint8ClampedArray(width * height * 4);
      imageData = new ImageData(data, width, height);
    }

    const gains = channels(current.color);

    // Fade RGB and alpha together; empty areas stay transparent so the
    // host's background settings show through.
    for (let i = 0; i < data.length; i += 4) {
      data[i] -= current.fade;
      data[i + 1] -= current.fade;
      data[i + 2] -= current.fade;
      data[i + 3] -= current.fade;
    }

    for (let i = 0; i < current.particles; i++) {
      let x = Math.random();
      let y = Math.random();
      for (let j = 0; j < current.steps; j++) {
        x = frac(time + x + Math.cos(y * 2.2 + x * 0.1));
        y = frac(time * 0.3 + y + Math.sin(x * 1.5));
        const index = (width * Math.trunc(y * height) + Math.trunc(x * width)) * 4;
        data[index] += gains[0];
        data[index + 1] += gains[1];
        data[index + 2] += gains[2];
        // A hit must re-light the pixel: RGB alone is invisible where alpha
        // has already faded to 0.
        data[index + 3] = 255;
      }
    }

    context.putImageData(imageData, 0, 0);
    time += current.speed;
  };

  // Wasm path: fade and the particle walk run inside kernel memory; only
  // putImageData touches the canvas. Canvases larger than the kernel's
  // framebuffer region (no realistic window size) stay on the JS path.
  const drawKernel = (k: Kernel): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0)
      return;
    const bytes = width * height * 4;
    if (bytes >= LUT_BASE) {
      drawJs();
      return;
    }
    if (width !== kernelWidth || height !== kernelHeight || kernelBuffer === null) {
      kernelWidth = width;
      kernelHeight = height;
      canvas.width = width;
      canvas.height = height;
      // Zero-filled, matching the JS path's fresh buffer: empty pixels have
      // alpha 0 so the host background shows through.
      new Uint8Array(k.mem.buffer, 0, bytes).fill(0);
      kernelBuffer = new ImageData(new Uint8ClampedArray(k.mem.buffer, 0, bytes), width, height);
    }
    k.fade(bytes, current.fade);
    // A zero seed would deadlock the xorshift; Math.random() < 1 keeps the
    // product below 2^32, and 0 rounds to 1.
    const seed = (Math.random() * 0x100000000) >>> 0;
    k.draw(width, height, current.particles, current.steps, time, seed === 0 ? 1 : seed);
    context.putImageData(kernelBuffer, 0, 0);
    time += current.speed;
  };

  const draw = (): void => {
    if (kernel === null)
      drawJs();
    else
      drawKernel(kernel);
  };

  const tick = (): void => {
    if (!running)
      return;
    requestAnimationFrame(tick);
    draw();
  };

  return {
    start(): void {
      if (running)
        return;
      running = true;
      requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
    },
    update(options: Partial<OptionValues>): void {
      const {color} = options;
      current = {...current, ...options};
      if (kernel !== null && typeof color === "string")
        setGains(kernel, channels(color));
    },
    unmount(): void {
      running = false;
      kernel = null;
      canvas.parentNode?.removeChild(canvas);
    },
  };
}

export default defineEffect({
  label: "Galaxy",
  options,
  create,
});
