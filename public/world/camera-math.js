// Pure math for the 2.5D scene camera — no DOM, no window, so it can be
// unit-tested directly (see spec/camera.test.ts) and imported unchanged by
// the DOM-wiring controller (camera.js). Keeping this pure is what makes
// "camera clamping" something a focused automated test can actually assert,
// rather than something only a manual drag-and-look can verify.

export function clamp(value, min, max) {
  if (min > max) return min; // a misconfigured scene never produces NaN-ish bounds
  return Math.min(max, Math.max(min, value));
}

// Pan is a 0-100 position along the scene's valid look-around range (not a
// raw pixel or CSS percentage) — 50 is centred, authored per-scene minPan/
// maxPan bound how far a visitor may look before the artwork would have to
// show empty space beyond its own edges.
export function clampPan(pan, minPan, maxPan) {
  return clamp(pan, minPan, maxPan);
}

// Zoom is a multiplier (1 = the scene's baseline "fit" framing, >1 is
// zoomed in). Bounded per-scene so a visitor can get close enough to create
// a meaningful pan range (per the brief: "zoom the artwork enough to create
// a meaningful horizontal pan range") without zooming so far the artwork
// degrades or the frame feels broken.
export function clampZoom(zoom, minZoom, maxZoom) {
  return clamp(zoom, minZoom, maxZoom);
}

// Converts a desired pixel drag delta into a pan-space delta: dragging the
// same number of pixels should feel like a smaller pan step at a higher
// zoom (the image is physically larger, so the same finger travel covers
// less of its own 0-100 pan range) — this is what keeps drag "feel"
// consistent across zoom levels instead of suddenly feeling faster/slower.
export function dragDeltaToPan(pixelDeltaX, containerWidth, zoom) {
  if (containerWidth <= 0) return 0;
  // At zoom Z, the content is Z times the container's width; panning across
  // its full 0-100 range corresponds to traversing (Z-1)*containerWidth
  // pixels of overflow (zoom=1 has no overflow at all, so no pan is
  // possible — dragDeltaToPan correctly returns 0 for a locked frame).
  const overflowPx = Math.max(0, (zoom - 1) * containerWidth);
  if (overflowPx === 0) return 0;
  return -(pixelDeltaX / overflowPx) * 100;
}

// Inertia: simple exponential decay per animation frame. Returns the next
// velocity; the caller applies `velocity * dt` to pan and stops animating
// once velocity is negligible. Pure and frame-rate-aware (takes dt in ms)
// so it is deterministically testable without faking requestAnimationFrame.
const INERTIA_DECAY_PER_SECOND = 0.055; // fraction of velocity retained after 1s continues to decay; see test
export function decayVelocity(velocity, dtMs) {
  const dtSeconds = dtMs / 1000;
  const factor = Math.pow(INERTIA_DECAY_PER_SECOND, dtSeconds);
  return velocity * factor;
}

export const INERTIA_STOP_THRESHOLD = 0.02; // pan-units/second below which inertia is considered settled

// Converts a pan/zoom pair into the CSS transform for one camera layer.
// `parallaxFactor` lets background/decor/dust layers move less than the
// foreground artwork for a subtle depth cue (1.0 = moves fully with pan,
// 0 = fixed, for the vignette/frame that must never shift).
//
// `pan` is an abstract 0-100 position (50 = centred); it must be converted
// into a *safe* translateX percentage, bounded by how much overflow this
// layer's own scale actually provides — a layer scaled by S only has
// (S-1)/2 * 100% of overflow on each side to pan across. Naively using
// (pan-50) as the percentage directly (an earlier bug here) ignores zoom
// entirely and can drag the art past its own edge, exposing bare background
// — exactly the "artwork can never be dragged outside valid viewing area"
// invariant this camera exists to guarantee. Because `scale()` and
// `translateX()` compose (translate happens in local space, then gets
// scaled by the outer scale()), a pre-scale translateX of X% ends up as a
// *visual* offset of X% * scale — so the safe pre-scale bound is
// (scale-1) / (2*scale) * 100, not (scale-1)/2*100.
// A pointerdown followed by a pointerup with little or no movement must
// activate whatever is underneath (a button's native click), never be
// swallowed by the camera's own drag handling — this is the distinction
// between "look around the room" and "click the glowing object" the brief
// requires. Movement is measured in real screen pixels (not pan-space) so
// the threshold feels the same regardless of zoom.
export const DRAG_THRESHOLD_PX = 6;
export function exceedsDragThreshold(dx, dy, thresholdPx = DRAG_THRESHOLD_PX) {
  return Math.hypot(dx, dy) > thresholdPx;
}

export function transformFor(pan, zoom, parallaxFactor) {
  const scale = 1 + (zoom - 1) * parallaxFactor;
  const maxOffsetPercent = scale > 1 ? ((scale - 1) / (2 * scale)) * 100 : 0;
  // pan is always clamped to [0,100] upstream (clampPan), so this is always
  // within [-1, 1] — no extra clamping needed.
  const normalizedPan = (pan - 50) / 50;
  const panOffsetPercent = -normalizedPan * maxOffsetPercent;
  return `scale(${scale}) translateX(${panOffsetPercent}%)`;
}
