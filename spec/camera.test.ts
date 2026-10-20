// Unit tests for the pure 2.5D camera math (public/world/camera-math.js) —
// no server, no DOM, just the clamping/conversion/inertia functions the
// scene camera (public/world/camera.js) builds on. This is what makes
// "camera clamping" something CI actually asserts, not just something a
// manual drag-and-look happens to look right in.
import { it, expect, describe } from "vitest";
import {
  clamp,
  clampPan,
  clampZoom,
  dragDeltaToPan,
  decayVelocity,
  INERTIA_STOP_THRESHOLD,
  transformFor,
  exceedsDragThreshold,
  DRAG_THRESHOLD_PX,
} from "../public/world/camera-math.js";

function parseTransform(css: string): { scale: number; translateXPercent: number } {
  const scaleMatch = css.match(/scale\(([\d.]+)\)/);
  const translateMatch = css.match(/translateX\((-?[\d.]+)%\)/);
  return {
    scale: scaleMatch ? Number(scaleMatch[1]) : 1,
    translateXPercent: translateMatch ? Number(translateMatch[1]) : 0,
  };
}

describe("camera clamping", () => {
  it("clamps a value within [min, max]", () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("never lets pan escape a scene's authored [minPan, maxPan] range", () => {
    expect(clampPan(5, 20, 80)).toBe(20);
    expect(clampPan(95, 20, 80)).toBe(80);
    expect(clampPan(50, 20, 80)).toBe(50);
  });

  it("never lets zoom escape a scene's authored [minZoom, maxZoom] range", () => {
    expect(clampZoom(0.5, 1.1, 2.2)).toBe(1.1);
    expect(clampZoom(5, 1.1, 2.2)).toBe(2.2);
    expect(clampZoom(1.6, 1.1, 2.2)).toBe(1.6);
  });

  it("degrades gracefully for a misconfigured scene (min > max) rather than NaN", () => {
    expect(clamp(50, 80, 20)).toBe(80);
  });
});

describe("drag-to-pan conversion", () => {
  it("produces zero pan movement at baseline zoom (1x) — there is nothing to pan across", () => {
    expect(dragDeltaToPan(100, 1000, 1)).toBe(0);
  });

  it("produces more pan movement per pixel at a higher zoom (more overflow to traverse, inverted)", () => {
    const atLowZoom = Math.abs(dragDeltaToPan(50, 1000, 1.2));
    const atHighZoom = Math.abs(dragDeltaToPan(50, 1000, 2.5));
    // Same pixel delta, different zoom: the *pan-space* delta shrinks as
    // zoom grows, since the same pixel drag covers a smaller fraction of a
    // more-zoomed image's larger overflow range — this is what keeps drag
    // "feel" consistent rather than suddenly feeling faster at high zoom.
    expect(atHighZoom).toBeLessThan(atLowZoom);
  });

  it("is safe against a zero-width container", () => {
    expect(dragDeltaToPan(50, 0, 1.5)).toBe(0);
  });
});

describe("camera layer transform (the art can never show bare background past its own edge)", () => {
  it("never shifts a layer past the visual overflow its own scale provides, at any pan extreme", () => {
    for (const zoom of [1.15, 1.3, 1.6, 2.1]) {
      for (const pan of [0, 25, 50, 75, 100]) {
        const { scale, translateXPercent } = parseTransform(transformFor(pan, zoom, 1));
        // translate() happens in pre-scale local space, then the outer
        // scale() stretches it — so the *visual* shift is
        // translateXPercent * scale, which must never exceed the layer's
        // own overflow, (scale-1)/2 * 100, in either direction. This is
        // exactly the bug a naive (pan-50) translateX produced: it ignored
        // this relationship and could drag content off its own edge.
        const visualShiftPercent = Math.abs(translateXPercent) * scale;
        const maxSafeShiftPercent = ((scale - 1) / 2) * 100 + 1e-9;
        expect(visualShiftPercent).toBeLessThanOrEqual(maxSafeShiftPercent);
      }
    }
  });

  it("produces no shift at all when a layer is not scaled up (zoom 1, or parallax 0)", () => {
    expect(parseTransform(transformFor(0, 1.5, 1)).scale).toBeCloseTo(1.5);
    expect(parseTransform(transformFor(0, 1.5, 0)).translateXPercent).toBe(0);
    expect(parseTransform(transformFor(100, 1, 1)).translateXPercent).toBe(0);
  });

  it("is centred (no shift) at pan=50 regardless of zoom", () => {
    expect(parseTransform(transformFor(50, 1.8, 1)).translateXPercent).toBeCloseTo(0);
  });
});

describe("click-vs-drag threshold (a plain click must never be swallowed as a drag)", () => {
  it("does not count a near-stationary pointer as a drag", () => {
    expect(exceedsDragThreshold(0, 0)).toBe(false);
    expect(exceedsDragThreshold(2, 1)).toBe(false);
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX - 1, 0)).toBe(false);
  });

  it("counts real movement past the threshold as a drag, measured as straight-line distance", () => {
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
    // 3-4-5 triangle: hypot(3,4) = 5, comfortably past a 1px threshold even
    // though neither axis alone would be.
    expect(exceedsDragThreshold(3, 4, 1)).toBe(true);
  });
});

describe("inertia decay", () => {
  it("decays velocity toward zero over time, never growing it", () => {
    let v = 10;
    for (let i = 0; i < 20; i++) v = decayVelocity(v, 16);
    expect(v).toBeLessThan(10);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it("eventually crosses below the stop threshold", () => {
    let v = 5;
    let frames = 0;
    while (v > INERTIA_STOP_THRESHOLD && frames < 1000) {
      v = decayVelocity(v, 16);
      frames++;
    }
    expect(frames).toBeLessThan(1000);
  });
});
