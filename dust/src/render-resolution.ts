// Single-effect preview resolution, shared by the worker and the main-thread
// fallback. The software rasterizer draws at RESOLUTION_SCALE × the logical
// effect size: the render buffer is the display resolution (derived, never a
// fixed 480×320 literal) and the world→pixel transform is scaled to match, so
// figures keep their on-screen size while gaining detail.
export const PREVIEW_WIDTH = 480;
export const PREVIEW_HEIGHT = 320;
export const RESOLUTION_SCALE = 1;
export const PREVIEW_RENDER_WIDTH = PREVIEW_WIDTH * RESOLUTION_SCALE;
export const PREVIEW_RENDER_HEIGHT = PREVIEW_HEIGHT * RESOLUTION_SCALE;

// Fullscreen meditation page (`meditation.html`). The render buffer IS the
// screen (device pixels) and the world→pixel scale sizes the portal's
// MEDITATION_PORTAL_SPAN-cell extent to half of the lower device dimension,
// so positions and textures scale with the viewport while dynamic primitives
// stay pixel-fine: sparks are 1×1 device px (2×1 for wide gas/fire), trail
// strokes 1px thick, never scaled blocks. The sprite and glow kernels are
// textures and resample fractionally at S ≠ 1.
// MEDITATION_PORTAL_SPAN is the portal's real extent in world cells - it must
// stay truthful for "half the screen" to be exact; do not inflate it to shrink
// the portal.
export const MEDITATION_PORTAL_SPAN = 146;

export function fullscreenView(viewportWidth: number, viewportHeight: number, pixelRatio = 1) {
  const deviceWidth = Math.max(1, Math.round(viewportWidth * pixelRatio));
  const deviceHeight = Math.max(1, Math.round(viewportHeight * pixelRatio));
  const scale = Math.min(deviceWidth, deviceHeight) / 2 / MEDITATION_PORTAL_SPAN;
  return { width: deviceWidth, height: deviceHeight, scale };
}
