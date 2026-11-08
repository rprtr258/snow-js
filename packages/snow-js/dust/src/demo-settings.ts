export const COLOR_MODES = Object.freeze(["original", "random", "grayscale", "white"]);

export function grayColor(random: () => number = Math.random) {
  const value = Math.min(255, Math.floor(random() * 256)).toString(16).padStart(2, "0");
  return `#${value}${value}${value}`;
}
export function figureColor(entry: {gray: string; color: string}, mode: string) {
  if (mode === "original") return null;
  if (mode === "white") return "#ffffff";
  return mode === "grayscale" ? entry.gray : entry.color;
}
