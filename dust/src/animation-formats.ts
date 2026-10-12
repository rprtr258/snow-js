export const ANIMATION_FORMATS = Object.freeze({
  gif: { label: "GIF", mime: "image/gif", extension: "gif", note: "Animated GIF · up to 256 colors." },
  webp: { label: "WebP", mime: "image/webp", extension: "webp", note: "Animated WebP · lossless, full color." },
  apng: { label: "PNG (APNG)", mime: "image/png", extension: "png", note: "Animated PNG · lossless, full color." },
  avif: { label: "AVIF", mime: "image/avif", extension: "avif", note: "Animated AVIF · lossless, full color. Encoding takes longer." },
});
export type AnimationFormatName = keyof typeof ANIMATION_FORMATS;
export type AnimationFormat = (typeof ANIMATION_FORMATS)[AnimationFormatName];
export function animationFormat(value: string = "gif"): AnimationFormat {
  if (!Object.prototype.hasOwnProperty.call(ANIMATION_FORMATS, value)) throw new Error("Unknown animation format.");
  return ANIMATION_FORMATS[value as AnimationFormatName];
}
