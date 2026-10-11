// Shell interaction only. Layout observation is limited to toolbar resizing.
const transport = document.querySelector<HTMLElement>(".demo-transport");
if (transport) {
  const stage = document.getElementById("stage")!;
  const measure = () => stage.style.setProperty("--transport-height", `${transport.offsetHeight}px`);
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(transport);
  window.addEventListener("pagehide", event => { if (!event.persisted) observer.disconnect(); });
}
const settings = document.getElementById("demo-settings");
const toggle = document.getElementById("toggle-settings");
if (settings && toggle) {
  const show = (open: boolean) => {
    settings.hidden = !open; toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      const figures = document.getElementById("figure-panel");
      if (figures) figures.hidden = true;
      document.getElementById("figures")?.setAttribute("aria-expanded", "false");
    }
  };
  toggle.addEventListener("click", () => show(settings.hidden));
  document.getElementById("close-settings")?.addEventListener("click", () => { show(false); toggle.focus(); });
  settings.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); show(false); toggle.focus(); }
  });
}
