// Presentation-only recolor settings shared by both pages and the headless
// tests. Colors travel as "#rrggbb" strings or null (original).
export function validateColor(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    throw new RangeError("Invalid color; expected #rrggbb or null");
  return value.toLowerCase();
}

export function packColor(value: unknown) {
  const hex = validateColor(value);
  return hex === null ? null : parseInt(hex.slice(1), 16);
}
