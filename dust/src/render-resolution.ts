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

// Fullscreen meditation page (`meditation.html`): the render buffer IS the
// screen - the buffer is the viewport's own device resolution, so one render
// cell is one buffer pixel is one physical screen pixel - and the world→pixel
// scale is an exact float chosen so the portal's ~146-cell extent spans exactly
// half of the lower screen dimension. Rounding the scale would both size the
// portal off-target and shrink the buffer below the screen (black edges), so
// there is none: the fractional scale is carried exactly into the rasterizer,
// which snaps positions to the pixel grid only where it indexes pixels.
// MEDITATION_PORTAL_SPAN is the portal's real extent in world cells - it must
// stay truthful for "half the screen" to be exact; do not inflate it to shrink
// the portal, change the fraction instead.
export const MEDITATION_PORTAL_SPAN = 146;

export function fullscreenView(viewportWidth: number, viewportHeight: number, pixelRatio = 1) {
  const deviceWidth = Math.max(1, Math.round(viewportWidth * pixelRatio));
  const deviceHeight = Math.max(1, Math.round(viewportHeight * pixelRatio));
  const scale = Math.min(deviceWidth, deviceHeight) / 2 / MEDITATION_PORTAL_SPAN;
  return { width: deviceWidth, height: deviceHeight, scale };
}
