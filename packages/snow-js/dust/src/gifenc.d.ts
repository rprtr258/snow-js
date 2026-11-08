// gifenc ships no type declarations. These cover the API surface dust uses.
declare module "gifenc" {
  export type GifencFrameOptions = {
    first?: boolean;
    palette?: number[][] | null;
    delay?: number;
    repeat?: number;
    dispose?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
  };
  export type GifencEncoder = {
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifencFrameOptions,
    ): void;
    finish(): void;
    reset(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    stream: {writeBytesView(bytes: Uint8Array): void};
  };
  export function GIFEncoder(options?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifencEncoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: {
      format?: "rgb565" | "rgb444" | "rgba4444";
      oneBitAlpha?: boolean;
      clearAlpha?: boolean;
    },
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
