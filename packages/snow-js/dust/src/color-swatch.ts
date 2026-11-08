// Shared Noitamap-style swatches: round custom picker, 24px samples, and a
// leading reset control. The reset icon retains a tooltip and accessible label.
import { COLOR_PALETTE, validateColor } from "./particle-color";

const NAMES = ["White", "Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Violet"];

export function createSwatch(
  container: HTMLElement,
  { resetLabel = "Original", onChange = () => {} }: { resetLabel?: string; onChange?: (hex: string | null) => void } = {},
) {
  const doc = container.ownerDocument;
  const row = doc.createElement("div");
  row.className = "swatch-row";
  row.setAttribute("role", "group");
  const reset = doc.createElement("button");
  reset.type = "button";
  reset.className = "swatch swatch-reset btn btn-sm btn-outline-light";
  reset.textContent = resetLabel;
  reset.title = resetLabel;
  reset.setAttribute("aria-label", resetLabel);
  const custom = doc.createElement("input");
  custom.type = "color";
  custom.className = "swatch swatch-custom";
  custom.value = "#ffffff";
  custom.title = "Custom color";
  custom.setAttribute("aria-label", "Custom color");
  const presets = COLOR_PALETTE.map((hex, i) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "swatch btn btn-sm btn-outline-light";
    button.setAttribute("data-color", hex);
    button.setAttribute("aria-label", NAMES[i]);
    button.title = NAMES[i];
    button.style.backgroundColor = hex;
    return button;
  });
  row.append(reset, custom, ...presets);
  container.append(row);

  let current: string | null = null;
  function show(hex: string | null) {
    current = hex;
    const mark = (el: HTMLElement, active: boolean) => {
      el.classList.toggle("active", active);
      el.setAttribute("aria-pressed", String(active));
    };
    mark(reset, hex === null);
    let matched = false;
    presets.forEach((button, i) => {
      const active = hex === COLOR_PALETTE[i];
      matched ||= active;
      mark(button, active);
    });
    mark(custom, hex !== null && !matched);
    if (hex !== null) custom.value = hex;
  }
  function pick(hex: string | null) {
    show(hex);
    onChange(hex);
  }
  reset.addEventListener("click", () => pick(null));
  presets.forEach((button, i) =>
    button.addEventListener("click", () => pick(COLOR_PALETTE[i])),
  );
  custom.addEventListener("input", () => pick(validateColor(custom.value)));
  show(null);
  return {
    get: () => current,
    set: (hex: string | null) => show(validateColor(hex)),
    setResetLabel: (text: string) => {
      reset.textContent = text;
      reset.title = text;
      reset.setAttribute("aria-label", text);
    },
  };
}
