export const SETTINGS_KEY = "noita-demo-settings-v1";
export type DemoSettings = {
  duration: number | "loop";
  detail: number;
  density: number;
  names: boolean;
  stats: boolean;
  smoothGlow: boolean;
  colorMode: string;
  background: string;
  selection: string[] | null;
};
type SettingsInput = {[K in keyof DemoSettings]?: unknown};
export const DEMO_DEFAULTS: DemoSettings = Object.freeze({
  duration: 5, detail: 2, density: 1,
  names: false, stats: false, smoothGlow: true, colorMode: "random", background: "#000000", selection: null,
});
export const COLOR_MODES = Object.freeze(["original", "random", "grayscale", "white"]);

export function normalizeSettings(value: unknown, defaults: DemoSettings = DEMO_DEFAULTS): DemoSettings {
  const settings: DemoSettings = { ...defaults, selection: defaults.selection === null ? null : [...defaults.selection] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return settings;
  const input = value as SettingsInput;
  if (typeof input.duration === "number" && Number.isFinite(input.duration) && input.duration >= 1 && input.duration <= 30)
    settings.duration = Math.round(input.duration * 2) / 2;
  if (input.duration === "loop") settings.duration = "loop";
  for (const key of ["detail", "density"] as const) {
    const n = input[key];
    if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 4) settings[key] = n;
  }
  for (const key of ["names", "stats", "smoothGlow"] as const) {
    const b = input[key];
    if (typeof b === "boolean") settings[key] = b;
  }
  if (typeof input.colorMode === "string" && COLOR_MODES.includes(input.colorMode)) settings.colorMode = input.colorMode;
  if (typeof input.background === "string" && /^#[0-9a-f]{6}$/i.test(input.background)) settings.background = input.background.toLowerCase();
  if (input.selection === null) settings.selection = null;
  else if (Array.isArray(input.selection)) settings.selection = [...new Set(input.selection.filter((key: unknown) =>
    typeof key === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(key)))].slice(0, 2048);
  return settings;
}

export function loadSettings(storage: Storage, defaults: DemoSettings = DEMO_DEFAULTS): DemoSettings {
  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null");
    return saved?.version === 1 ? normalizeSettings(saved.settings, defaults) : normalizeSettings({}, defaults);
  } catch { return normalizeSettings({}, defaults); }
}
export function saveSettings(storage: Storage, settings: unknown) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, settings: normalizeSettings(settings) }));
    return true;
  } catch { return false; }
}

export function grayColor(random: () => number = Math.random) {
  const value = Math.min(255, Math.floor(random() * 256)).toString(16).padStart(2, "0");
  return `#${value}${value}${value}`;
}
export function figureColor(entry: {gray: string; color: string}, mode: string) {
  if (mode === "original") return null;
  if (mode === "white") return "#ffffff";
  return mode === "grayscale" ? entry.gray : entry.color;
}
