// Shared by both pages. Fullscreen is presentation only: never restart playback.
export function setupFullscreen(
  button: HTMLButtonElement,
  target: HTMLElement,
  onError: (message: string) => void = () => {},
) {
  const doc = target.ownerDocument;
  const supported = !!target.requestFullscreen && !!doc.exitFullscreen;
  const update = () => {
    const active = doc.fullscreenElement === target;
    button.textContent = active ? "Exit fullscreen" : "Fullscreen";
    button.setAttribute("aria-pressed", String(active));
    button.title = supported ? "Toggle fullscreen (Esc to exit)" : "Fullscreen is unavailable in this browser";
    button.hidden = !supported;
  };
  button.addEventListener("click", async () => {
    try {
      if (doc.fullscreenElement === target) await doc.exitFullscreen();
      else await target.requestFullscreen();
    } catch (error) { onError(`Fullscreen: ${(error as Error).message}`); }
    update();
  });
  doc.addEventListener("fullscreenchange", update);
  update();
}
