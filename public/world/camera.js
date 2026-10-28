// The 2.5D scene camera: drag/swipe to look left-right, wheel/pinch or
// +/- to zoom, bounded by a per-scene {minPan, maxPan, minZoom, maxZoom}
// config (server/src/world.js) so the artwork can never be dragged past its
// own edges. This is an honest "wide 2.5D room view," never a claim of a
// full 360° panorama — see docs/adr/0005-immersive-2.5d-camera.md.
//
// Pan is 0-100 along the scene's own valid look-around range; zoom is a
// multiplier over the scene's baseline "fit" framing. Both are applied as a
// single CSS transform on the `.scene-room` layer (art + object glows +
// cameos all live inside it and move together — see illustration.js); the
// pure math (clamping, drag-to-pan conversion, inertia decay) lives in
// camera-math.js so it can be unit-tested without a DOM.
import {
  clampPan,
  clampZoom,
  dragDeltaToPan,
  decayVelocity,
  INERTIA_STOP_THRESHOLD,
  transformFor,
  exceedsDragThreshold,
} from "./camera-math.js";

const PREFERS_REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function createSceneCamera({ container, layers, onTransform }) {
  // layers: array of { el, parallax } — parallax 1.0 = moves fully with the
  // camera (the main art), smaller values = subtler movement (decor/dust),
  // 0 = fixed (the foreground vignette/frame, which must never shift or it
  // stops reading as "the edge of the viewport").
  let pan = 50;
  let zoom = 1;
  let minPan = 0, maxPan = 100, minZoom = 1, maxZoom = 1;
  let velocity = 0; // pan-units per second, for drag inertia
  let dragging = false; // true only once real drag movement has been confirmed
  let pointerIsDown = false; // true from pointerdown until pointerup/cancel, regardless of drag
  let activePointerId = null;
  let downX = 0;
  let downY = 0;
  let lastDragX = 0;
  let lastDragT = 0;
  let rafHandle = null;
  let enabled = true;

  // `onTransform` fires after every pan/zoom change (not just on scene
  // change or an SSE presence event) — lets app.js re-clamp any visitor
  // cameo into the viewport whenever the camera actually moves, closing the
  // gap where a cameo positioned against one transform state was never
  // revisited after the camera panned/zoomed further (see renderCameos'
  // viewport-clamp safety net).
  function apply() {
    for (const { el, parallax } of layers) {
      el.style.transform = transformFor(pan, zoom, parallax);
    }
    onTransform?.();
  }

  function setPan(next) {
    pan = clampPan(next, minPan, maxPan);
    apply();
  }
  function setZoom(next) {
    zoom = clampZoom(next, minZoom, maxZoom);
    // Re-clamp pan too: a smaller zoom may shrink the valid pan range's
    // practical effect (less overflow to pan across) — clamping again after
    // every zoom change keeps the two bounds mutually consistent.
    pan = clampPan(pan, minPan, maxPan);
    apply();
  }

  function configure(camera) {
    minPan = camera.minPan;
    maxPan = camera.maxPan;
    minZoom = camera.minZoom;
    maxZoom = camera.maxZoom;
    pan = clampPan(camera.initialPan, minPan, maxPan);
    zoom = clampZoom(camera.initialZoom, minZoom, maxZoom);
    velocity = 0;
    apply();
  }

  function stopInertia() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  function stepInertia(timestamp, lastTimestamp) {
    const dt = lastTimestamp ? timestamp - lastTimestamp : 16;
    velocity = decayVelocity(velocity, dt);
    setPan(pan + velocity * (dt / 1000));
    if (Math.abs(velocity) < INERTIA_STOP_THRESHOLD) {
      stopInertia();
      return;
    }
    rafHandle = requestAnimationFrame((t) => stepInertia(t, timestamp));
  }

  // A pointerdown alone must never claim the gesture: whatever is directly
  // under the pointer (an interactive-object button, a placement anchor)
  // needs its own native click to still fire if the pointer never actually
  // moves. Capture is deferred until real drag movement crosses
  // DRAG_THRESHOLD_PX — grabbing the pointer immediately on every press (the
  // previous behaviour here) redirected the matching pointerup, and the
  // synthetic click browsers dispatch after it, to this container instead
  // of the button the visitor actually pressed, which is exactly why every
  // in-room object silently stopped responding to a click once this camera
  // shipped.
  function onPointerDown(e) {
    if (!enabled) return;
    pointerIsDown = true;
    dragging = false;
    activePointerId = e.pointerId;
    downX = e.clientX;
    downY = e.clientY;
    lastDragX = e.clientX;
    lastDragT = performance.now();
    velocity = 0;
    stopInertia();
  }

  function onPointerMove(e) {
    if (!pointerIsDown || !enabled || e.pointerId !== activePointerId) return;
    if (!dragging) {
      if (!exceedsDragThreshold(e.clientX - downX, e.clientY - downY)) return;
      // The threshold just tipped over into a real drag: claim the pointer
      // now (not at pointerdown) so a genuine look-around gesture still
      // gets inertia/out-of-bounds handling, but a plain click never does.
      dragging = true;
      container.setPointerCapture?.(e.pointerId);
    }
    const now = performance.now();
    const dx = e.clientX - lastDragX;
    const dt = Math.max(1, now - lastDragT);
    const deltaPan = dragDeltaToPan(-dx, container.clientWidth || 1, zoom);
    setPan(pan + deltaPan);
    // Instantaneous velocity estimate (pan-units/second) for inertia once
    // released — smoothed lightly against the previous sample so one jittery
    // frame doesn't launch an exaggerated flick.
    const instantVelocity = (deltaPan / dt) * 1000;
    velocity = velocity * 0.6 + instantVelocity * 0.4;
    lastDragX = e.clientX;
    lastDragT = now;
  }

  function onPointerUp(e) {
    if (!pointerIsDown) return;
    const wasDragging = dragging;
    pointerIsDown = false;
    dragging = false;
    activePointerId = null;
    if (wasDragging) {
      container.releasePointerCapture?.(e.pointerId);
      if (!PREFERS_REDUCED_MOTION && Math.abs(velocity) > INERTIA_STOP_THRESHOLD) {
        rafHandle = requestAnimationFrame((t) => stepInertia(t, null));
      }
    }
    // If the pointer never moved past the threshold, capture was never
    // taken — the browser's own click (fired on whatever element the
    // pointerdown/pointerup pair actually occurred on) proceeds normally.
  }

  function onWheel(e) {
    if (!enabled) return;
    e.preventDefault();
    stopInertia();
    // A plain vertical wheel/pinch zooms; a horizontal wheel/trackpad swipe
    // pans directly — both are common real input shapes for "look around a
    // wide image," and neither requires a modifier key to discover.
    if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      const zoomDelta = -e.deltaY * 0.0015;
      setZoom(zoom + zoomDelta * zoom);
    } else {
      setPan(pan + dragDeltaToPan(e.deltaX, container.clientWidth || 1, zoom));
    }
  }

  const PAN_KEY_STEP = 3;
  const ZOOM_KEY_STEP = 0.08;
  function panLeft() {
    stopInertia();
    setPan(pan - PAN_KEY_STEP);
  }
  function panRight() {
    stopInertia();
    setPan(pan + PAN_KEY_STEP);
  }
  function zoomIn() {
    setZoom(zoom + ZOOM_KEY_STEP * zoom);
  }
  function zoomOut() {
    setZoom(zoom - ZOOM_KEY_STEP * zoom);
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });

  function setEnabled(next) {
    enabled = next;
    if (!next) {
      dragging = false;
      pointerIsDown = false;
      activePointerId = null;
      stopInertia();
    }
  }

  function destroy() {
    stopInertia();
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("wheel", onWheel);
  }

  return {
    configure,
    panLeft,
    panRight,
    zoomIn,
    zoomOut,
    setEnabled,
    destroy,
    get pan() {
      return pan;
    },
    get zoom() {
      return zoom;
    },
  };
}
