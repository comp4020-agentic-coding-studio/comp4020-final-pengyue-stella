// Shared shape math for object-shaped hotspots and placement surfaces: both
// the server (validating a donation's normalized point actually lands
// inside its claimed surface) and the client (snapping a dragged preview,
// hit-testing a hover) need the same point-in-shape test, so it lives here
// rather than being duplicated/diverging between the two.

// Ray-casting point-in-polygon (standard even-odd rule). `points` is
// [[x,y], ...] in the shape's own viewBox units.
export function pointInPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInEllipse(shape, x, y) {
  const dx = (x - shape.cx) / shape.rx;
  const dy = (y - shape.cy) / shape.ry;
  return dx * dx + dy * dy <= 1;
}

// A `path` shape has no generic point-containment test without a full SVG
// path parser — none of this world's authored shapes currently use `path`,
// but the type stays part of the schema (and renders fine via <path d>) for
// a future hand-traced silhouette that genuinely needs it. Containment for
// one falls back to its declared bounding box.
export function pointInShape(shape, x, y) {
  if (shape.type === "polygon") return pointInPolygon(shape.points, x, y);
  if (shape.type === "ellipse") return pointInEllipse(shape, x, y);
  if (shape.type === "path" && shape.bbox) {
    const [bx, by, bw, bh] = shape.bbox;
    return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
  }
  return false;
}

export function shapeBounds(shape) {
  if (shape.type === "ellipse") {
    return { minX: shape.cx - shape.rx, maxX: shape.cx + shape.rx, minY: shape.cy - shape.ry, maxY: shape.cy + shape.ry };
  }
  if (shape.type === "polygon") {
    const xs = shape.points.map((p) => p[0]);
    const ys = shape.points.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  if (shape.type === "path" && shape.bbox) {
    const [bx, by, bw, bh] = shape.bbox;
    return { minX: bx, maxX: bx + bw, minY: by, maxY: by + bh };
  }
  return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

// A larger invisible hit region, grown outward from the same silhouette by
// `pad` viewBox units — used so a touch target can be comfortably bigger
// than the visible glow without the glow itself growing (CLAUDE.md-aligned
// brief: "larger invisible touch hit areas without enlarging the visible
// glow"). Polygons grow from their own centroid; ellipses grow their radii
// directly.
export function expandShape(shape, pad) {
  if (!pad) return shape;
  if (shape.type === "ellipse") {
    return { ...shape, rx: shape.rx + pad, ry: shape.ry + pad };
  }
  if (shape.type === "polygon") {
    const cx = shape.points.reduce((s, p) => s + p[0], 0) / shape.points.length;
    const cy = shape.points.reduce((s, p) => s + p[1], 0) / shape.points.length;
    const points = shape.points.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const grow = pad; // approx uniform outward growth, not a true offset-polygon
      return [x + (dx / len) * grow, y + (dy / len) * grow];
    });
    return { ...shape, points };
  }
  return shape;
}

// Finds the nearest point to (x, y) that still lies inside `shape`, used for
// "snap gently to a valid location while preserving the feeling of free
// placement" — if (x, y) is already inside, it's returned unchanged; if
// not, it's pulled back toward the shape's own centroid/center until it
// lands inside (a cheap, dependency-free approximation of a true nearest-
// point-on-polygon projection, adequate for a gentle visual snap).
export function snapIntoShape(shape, x, y) {
  if (pointInShape(shape, x, y)) return { x, y };
  let cx, cy;
  if (shape.type === "ellipse") {
    cx = shape.cx;
    cy = shape.cy;
  } else if (shape.type === "polygon") {
    cx = shape.points.reduce((s, p) => s + p[0], 0) / shape.points.length;
    cy = shape.points.reduce((s, p) => s + p[1], 0) / shape.points.length;
  } else {
    const b = shapeBounds(shape);
    cx = (b.minX + b.maxX) / 2;
    cy = (b.minY + b.maxY) / 2;
  }
  let lo = 0;
  let hi = 1;
  // Binary search along the segment from the centroid to (x,y) for the
  // furthest-out point still inside the shape.
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const px = cx + (x - cx) * mid;
    const py = cy + (y - cy) * mid;
    if (pointInShape(shape, px, py)) lo = mid;
    else hi = mid;
  }
  return { x: cx + (x - cx) * lo, y: cy + (y - cy) * lo };
}
