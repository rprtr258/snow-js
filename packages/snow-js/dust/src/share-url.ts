// Short, stable query keys; colors travel as bare hex. Null/undefined omit a
// default, while an empty string is significant (f= shares an empty grid).
export function readParams() {
  return new URLSearchParams(globalThis.location?.search ?? "");
}
export function hexParam(value: unknown): string | null {
  return /^[0-9a-f]{6}$/i.test(typeof value === "string" ? value : "") ? `#${(value as string).toLowerCase()}` : null;
}
export function hexOut(hex: string | null): string | null {
  return hex ? hex.slice(1) : null;
}
export function numberParam(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max &&
    (!integer || Number.isInteger(value)) ? value : fallback;
}
export function syncUrl(entries: Iterable<[string, string | null | undefined]>) {
  if (!globalThis.history?.replaceState) return;
  const params = new URLSearchParams();
  for (const [key, value] of entries)
    if (value !== null && value !== undefined) params.set(key, value);
  const query = params.toString().replace(/%3A/gi, ":").replace(/%2C/gi, ",");
  const url = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`)
    history.replaceState(history.state, "", url);
}
export function setupCopyLink(
  button: HTMLButtonElement,
  update: () => void,
  onError: (message: string) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.addEventListener("click", async () => {
    try {
      update();
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable; copy the address bar instead.");
      await navigator.clipboard.writeText(location.href);
      button.textContent = "Copied";
      clearTimeout(timer);
      timer = setTimeout(() => (button.textContent = "Copy link"), 1200);
    } catch (error) {
      onError(`Copy link: ${(error as Error).message}`);
    }
  });
}
