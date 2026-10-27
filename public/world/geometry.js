// Client-side mirror of server/src/geometry.js's pure shape math (point-in-
// shape, nearest-point snapping) plus the surface u/v conversions from
// server/src/world.js. Duplicated rather than imported because server/src
// is never served to the browser (it's server-only source, see
// server/src/static.js) — this is the same small, dependency-free math on
// both sides so a client-side snap/hover-test and the server's own
// authoritative validation of a submitted placement never disagree about
// what "inside the surface" means.

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

export function pointInShape(shape, x, y) {
  if (shape.type === "polygon") return pointInPolygon(shape.points, x, y);
  if (shape.type === "ellipse") return pointInEllipse(shape, x, y);
  return false;
}

function shapeCentroid(shape) {
  if (shape.type === "ellipse") return { x: shape.cx, y: shape.cy };
  const xs = shape.points.map((p) => p[0]);
  const ys = shape.points.map((p) => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

export function shapeBounds(shape) {
  if (shape.type === "ellipse") {
    return { minX: shape.cx - shape.rx, maxX: shape.cx + shape.rx, minY: shape.cy - shape.ry, maxY: shape.cy + shape.ry };
  }
  const xs = shape.points.map((p) => p[0]);
  const ys = shape.points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// Pulls (x, y) back toward the shape's own centre until it lands inside —
// "snap gently to a valid location while preserving the feeling of free
// placement" (CLAUDE.md-aligned brief), not a hard clamp to a fixed grid.
export function snapIntoShape(shape, x, y) {
  if (pointInShape(shape, x, y)) return { x, y };
  const { x: cx, y: cy } = shapeCentroid(shape);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const px = cx + (x - cx) * mid;
    const py = cy + (y - cy) * mid;
    if (pointInShape(shape, px, py)) lo = mid;
    else hi = mid;
  }
  return { x: cx + (x - cx) * lo, y: cy + (y - cy) * lo };
}

export function surfaceUvFromPoint(surface, x, y) {
  const b = shapeBounds(surface.shape);
  const u = b.maxX > b.minX ? (x - b.minX) / (b.maxX - b.minX) : 0.5;
  const v = b.maxY > b.minY ? (y - b.minY) / (b.maxY - b.minY) : 0.5;
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
}

export function surfacePointFromUv(surface, u, v) {
  const b = shapeBounds(surface.shape);
  return { x: b.minX + u * (b.maxX - b.minX), y: b.minY + v * (b.maxY - b.minY) };
}

export function surfaceCentroidUv(surface) {
  const c = shapeCentroid(surface.shape);
  return surfaceUvFromPoint(surface, c.x, c.y);
}

// Shared relic-layout helper for the free-placement region (see
// server/src/world.js's `${galleryId}-free` surface): the ONE place both the
// placement-drag preview and the final persisted exhibit compute width,
// height, x and y for a given point/aspect/scale, so the two paths can never
// disagree and a confirmed placement never visibly jumps from where its
// preview sat. A stable base size (not the old surface-size*0.55 formula,
// which would make an item enormous against this much larger region), the
// preset's own real aspect ratio (never stretched), and a fixed centred
// anchor (`x = point.x - width/2, y = point.y - height/2`) — never the old
// surfaces' bottom "resting" anchor, so a free placement's visual centre is
// exactly what gets persisted as its normalized u/v point.
const FREE_RELIC_BASE_SIZE = 110;
export function relicLayoutFree(point, aspect, scale = 1) {
  const baseSize = FREE_RELIC_BASE_SIZE * (Number.isFinite(scale) ? scale : 1);
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const width = ratio >= 1 ? baseSize : baseSize * ratio;
  const height = ratio >= 1 ? baseSize / ratio : baseSize;
  return { x: point.x - width / 2, y: point.y - height / 2, width, height };
}

// Grows a shape outward from its own centroid by `pad` viewBox units — used
// for a larger invisible touch/click hit region distinct from the exact
// silhouette the visible glow renders at ("larger invisible touch hit areas
// without enlarging the visible glow").
export function expandShape(shape, pad) {
  if (!pad) return shape;
  if (shape.type === "ellipse") return { ...shape, rx: shape.rx + pad, ry: shape.ry + pad };
  if (shape.type === "polygon") {
    const { x: cx, y: cy } = shapeCentroid(shape);
    const points = shape.points.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return [x + (dx / len) * pad, y + (dy / len) * pad];
    });
    return { ...shape, points };
  }
  return shape;
}
