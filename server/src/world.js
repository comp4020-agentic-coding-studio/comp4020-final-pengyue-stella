// Static world layout. The museum is one Entrance Hall with four galleries
// off it — `galleries` and `display_slots` rows are seeded from exactly this
// at startup (see db.js) and never created through the public API; only a
// slot's occupied_exhibit_id ever changes. Shared vocabulary with
// constants.js's GALLERY_CATEGORY: each gallery accepts exactly one exhibit
// category, so "which gallery does a donation belong in" is never ambiguous.
//
// What changed in the immersive-2.5D presentation pass (see docs/adr/0005-
// immersive-2.5d-camera.md): a scene is no longer a flat full-bleed image
// with pill-shaped hotspot buttons pasted over it. Each scene now also
// carries a `camera` config (a bounded pan/zoom "look around the room"
// range the client drives with drag/wheel/keyboard — see
// public/world/camera-math.js) and `interactiveObjects` — anchor BOXES
// ({x, y, width, height}, percentages of the illustration) over specific
// painted items (a portrait, a bust, the donor counter), rendered as
// invisible-until-attended glow regions rather than floating buttons.
// Room-to-room navigation (entering a gallery, going back) is a separate
// `nav` field, not an in-room object — the client renders it as quiet
// corner chrome (upper-left "forward," lower-right "back"), never a
// floating button covering the illustration itself. `visitorAnchors` are a
// small set of server-defined positions (with a depth value for subtle
// parallax) where another visitor's cameo may stand in this scene, distinct
// from exhibit display slots so a cameo never overlaps a relic.
//
// What changed in the following foyer-repair pass (see docs/adr/0006-foyer-
// repair-and-archive.md): the Entrance Hall used to be four stitched
// "facings" turned between with left/right arrows, each cropped from one
// small low-resolution reference image — a special interaction mode no
// other room had. The approved replacement foyer (entrance-hall-v2.png,
// 1672x941, the same full-size footing every gallery image already has) is
// one genuine wide-angle view of the whole hall, so the hall is now exactly
// one scene — `hall` — panned/zoomed/dragged the same bounded way as every
// main gallery scene, not a special case. Its own visible doorways (two
// arched doors flanking the base of the staircase) are ordinary `type:
// "portal"` interactive objects pointing at two of the four galleries
// directly; the other two stay reachable the same way they always were for
// a gallery not in frame at the hub — the persistent "Rooms" menu.

import { SUBTYPES_BY_CATEGORY, SUBTYPE_SET } from "./constants.js";

// Object-shaped hotspots and placement surfaces, replacing this file's
// previous `anchor: {x, y, width, height}` box model (see docs/adr/0007-
// object-shaped-interaction.md). A `shape` is authored directly in the
// scene's own source-image pixel coordinate system (`viewBox`), traced by
// hand against the actual painted item — never a percentage box floated
// over whatever happens to be nearby. The client nests the same shape data
// inside an SVG layer that shares the camera-driven `.scene-room` transform
// (public/world/illustration.js), using `preserveAspectRatio="xMidYMid
// slice"` so the SVG's own internal coordinate system tracks the
// background-image's `background-size: cover` crop pixel-for-pixel at any
// viewport size — the same reason a `viewBox` is given in image-native
// pixels (1672x941 for every scene here) rather than 0-100 percentages.
//
// Three shape types: `ellipse` (round/oval objects — a chandelier, a floor
// mosaic), `polygon` (anything else with real straight or angled edges —
// statues, doors, cabinets, an easel-mounted map), and `path` (reserved for
// a future hand-drawn SVG silhouette too organic for a polygon; no object
// in this world currently needs it, but the schema supports it per the
// brief). `hitPadding` grows an invisible, larger touch/click target
// outward from the same silhouette (`expandShape`, server/src/geometry.js)
// without enlarging the *visible* glow, which always renders at the exact
// traced shape.
export const SCENE_VIEWBOX = { width: 1672, height: 941 };

function ellipse(cx, cy, rx, ry, viewBox) {
  return { type: "ellipse", viewBox: viewBox ?? viewBoxStr(), cx, cy, rx, ry };
}
function polygon(points, viewBox) {
  return { type: "polygon", viewBox: viewBox ?? viewBoxStr(), points };
}
function viewBoxStr() {
  return `0 0 ${SCENE_VIEWBOX.width} ${SCENE_VIEWBOX.height}`;
}

// A close-up scene's own object shapes are traced in the pixel space of
// whatever image actually backs that close-up, which is NOT always the main
// gallery's 1672x941 — and for the two galleries whose close-up reuses their
// own main image at a CSS zoom (illustration.js's `paint()`:
// `background-size: 180%; background-position: 50% 65%`), it's a specific
// sub-window of that same 1672x941 image, not the whole thing. A `viewBox`
// whose own aspect ratio matches the image's (so the SVG's
// `preserveAspectRatio="xMidYMid slice"` crops exactly the way
// `background-size: cover` on that sub-window would) is the only way a
// close-up's traced shapes stay pixel-locked to the zoomed/panned art —
// derived once here from the exact CSS values above, not eyeballed:
//   scaled size = 1.8 * 1672 x 1.8 * 941 = 3009.6 x 1693.8
//   visible window (top-left, in scaled px) = (scaledSize - 1672x941) * (50%, 65%)
//   window in ORIGINAL image px = that window / 1.8
// giving the 929x523 box below (same 1672:941 aspect ratio, so the slice
// crop matches regardless of viewport aspect ratio).
const ZOOM_CLOSEUP_VIEWBOX = "372 272 929 523";
// The two galleries with a dedicated close-up reference image (rather than a
// zoomed reuse of their own main image) use that image's own native pixel
// size as their shapes' viewBox — see public/world/illustration.js's
// IMAGE_FILES and the actual file dimensions in public/assets/gallery-scenes/.
const PORTRAIT_REF_VIEWBOX = "0 0 419 398";
const CABINET_REF_VIEWBOX = "0 0 494 398";

// The exact native pixel size of each real image file in
// public/assets/gallery-scenes/ — the single declared source of truth a
// scene's own `sourceImage` field is built from below. This is NOT the same
// thing as a shape's own `viewBox` (which, for the two zoom-reuse close-ups,
// names only a cropped sub-window of a larger image — see
// ZOOM_CLOSEUP_VIEWBOX above): the client's glow `<image>` element and
// dossier "sprite crop" both need the real full image's own pixel
// dimensions to size/scale correctly, regardless of what sub-window a
// particular object's shape happens to be traced against. Measured directly
// from each file; memento/specimen are 940px tall, one pixel short of the
// 941 every shape coordinate in this file is still authored against
// (SCENE_VIEWBOX) — an existing, imperceptible mismatch this table doesn't
// attempt to correct, since fixing it would mean retracing every shape in
// those two galleries, well outside this fix's scope.
const SOURCE_IMAGE_SIZE = {
  hall: { width: 1672, height: 941 },
  portraits: { width: 1672, height: 941 },
  memento: { width: 1672, height: 940 },
  specimen: { width: 1672, height: 940 },
  childhood: { width: 1672, height: 941 },
  "portrait-reference": { width: 419, height: 398 },
  "cabinet-reference": { width: 494, height: 398 },
};

function sourceImageViewBox(imageKey) {
  const size = SOURCE_IMAGE_SIZE[imageKey];
  return `0 0 ${size.width} ${size.height}`;
}

// Surface types a `placementSurfaces` entry can declare — each the kind of
// real furniture/architecture a relic can actually rest against, not a
// generic "slot."
export const SURFACE_TYPES = ["wall", "shelf", "tabletop", "cabinet", "plinth", "floor"];

// Which surface types a relic subtype is allowed onto — the compatibility
// matrix the brief specifies: "A painting must never be offered a carpet or
// floor placement." Checked both client-side (only compatible surfaces are
// ever shown while placing) and server-side (server/src/db.js rejects any
// other combination even if a client tried to send one).
export const SURFACE_TYPES_BY_SUBTYPE = {
  painting: ["wall"],
  sketch: ["wall"],
  spoon: ["shelf", "cabinet", "tabletop"],
  key: ["shelf", "cabinet", "tabletop"],
  clock: ["shelf", "cabinet", "tabletop"],
  mirror: ["shelf", "cabinet", "tabletop"],
  curiosity: ["shelf", "cabinet", "plinth"],
  botanical: ["cabinet", "shelf", "plinth"],
  biological: ["cabinet", "shelf", "plinth"],
  doll: ["shelf", "tabletop", "plinth"],
  toy: ["shelf", "tabletop", "plinth"],
  book: ["shelf", "cabinet", "tabletop"],
};

function surfaceAllows(surface, subtype) {
  return (SURFACE_TYPES_BY_SUBTYPE[subtype] ?? []).includes(surface.surfaceType);
}

// A gallery's real, traced placement surfaces — each corresponds to an
// actual wall panel, shelf, tabletop, cabinet or plinth visible in that
// gallery's own illustration, replacing the old shared SLOT_ANCHORS box
// arc. `allowedRelicTypes` is derived from SURFACE_TYPES_BY_SUBTYPE at
// publish time (publicWorld()), not duplicated by hand here.
const GALLERY_SURFACES = {
  portraits: [
    { id: "portrait-left-wall", surfaceType: "wall", shape: polygon([[60, 160], [330, 160], [330, 420], [60, 420]]), minScale: 0.6, maxScale: 1.1, depth: 0.4 },
    { id: "portrait-right-wall", surfaceType: "wall", shape: polygon([[1000, 160], [1300, 160], [1300, 420], [1000, 420]]), minScale: 0.6, maxScale: 1.1, depth: 0.4 },
    { id: "portrait-upper-wall", surfaceType: "wall", shape: polygon([[550, 20], [950, 20], [950, 150], [550, 150]]), minScale: 0.55, maxScale: 1.0, depth: 0.35 },
  ],
  memento: [
    { id: "memento-shelf-left", surfaceType: "shelf", shape: polygon([[60, 520], [320, 520], [320, 650], [60, 650]]), minScale: 0.7, maxScale: 1.1, depth: 0.42 },
    { id: "memento-shelf-right", surfaceType: "shelf", shape: polygon([[1150, 520], [1450, 520], [1450, 650], [1150, 650]]), minScale: 0.7, maxScale: 1.1, depth: 0.42 },
    { id: "memento-tabletop", surfaceType: "tabletop", shape: polygon([[700, 420], [1000, 420], [1000, 480], [700, 480]]), minScale: 0.65, maxScale: 1.05, depth: 0.3 },
    { id: "memento-cabinet", surfaceType: "cabinet", shape: polygon([[350, 550], [650, 550], [650, 700], [350, 700]]), minScale: 0.7, maxScale: 1.15, depth: 0.45 },
  ],
  specimen: [
    { id: "specimen-shelf-left", surfaceType: "shelf", shape: polygon([[60, 520], [320, 520], [320, 650], [60, 650]]), minScale: 0.7, maxScale: 1.1, depth: 0.42 },
    { id: "specimen-cabinet-right", surfaceType: "cabinet", shape: polygon([[1300, 520], [1600, 520], [1600, 700], [1300, 700]]), minScale: 0.7, maxScale: 1.15, depth: 0.45 },
    { id: "specimen-plinth-center", surfaceType: "plinth", shape: polygon([[850, 600], [1080, 600], [1080, 700], [850, 700]]), minScale: 0.75, maxScale: 1.2, depth: 0.5 },
  ],
  childhood: [
    { id: "childhood-shelf", surfaceType: "shelf", shape: polygon([[700, 150], [950, 150], [950, 350], [700, 350]]), minScale: 0.7, maxScale: 1.1, depth: 0.4 },
    { id: "childhood-table", surfaceType: "tabletop", shape: polygon([[750, 600], [1000, 600], [1000, 750], [750, 750]]), minScale: 0.7, maxScale: 1.1, depth: 0.4 },
    { id: "childhood-plinth", surfaceType: "plinth", shape: polygon([[1250, 600], [1500, 600], [1500, 800], [1250, 800]]), minScale: 0.75, maxScale: 1.2, depth: 0.5 },
  ],
};

// A placement surface's own centroid, in its shape's own viewBox units —
// the default point a legacy slot-based exhibit (see legacySlotPlacement
// below) is anchored at, and a reasonable "drop it here" starting point for
// a fresh placement before the visitor drags it.
function surfaceCentroid(surface) {
  const { shape } = surface;
  if (shape.type === "ellipse") return { x: shape.cx, y: shape.cy };
  const xs = shape.points.map((p) => p[0]);
  const ys = shape.points.map((p) => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

// Normalizes a point inside a (rectangular-ish) surface's own bounding box
// to 0-1 u/v — what's actually persisted (server/src/db.js), never a raw
// screen/viewBox pixel coordinate, so a surface can be retraced later
// without invalidating every exhibit already placed on it.
export function surfaceUvFromPoint(surface, x, y) {
  const { shape } = surface;
  let minX, maxX, minY, maxY;
  if (shape.type === "ellipse") {
    minX = shape.cx - shape.rx;
    maxX = shape.cx + shape.rx;
    minY = shape.cy - shape.ry;
    maxY = shape.cy + shape.ry;
  } else {
    const xs = shape.points.map((p) => p[0]);
    const ys = shape.points.map((p) => p[1]);
    minX = Math.min(...xs);
    maxX = Math.max(...xs);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
  }
  const u = maxX > minX ? (x - minX) / (maxX - minX) : 0.5;
  const v = maxY > minY ? (y - minY) / (maxY - minY) : 0.5;
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
}

export function surfacePointFromUv(surface, u, v) {
  const { shape } = surface;
  let minX, maxX, minY, maxY;
  if (shape.type === "ellipse") {
    minX = shape.cx - shape.rx;
    maxX = shape.cx + shape.rx;
    minY = shape.cy - shape.ry;
    maxY = shape.cy + shape.ry;
  } else {
    const xs = shape.points.map((p) => p[0]);
    const ys = shape.points.map((p) => p[1]);
    minX = Math.min(...xs);
    maxX = Math.max(...xs);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
  }
  return { x: minX + u * (maxX - minX), y: minY + v * (maxY - minY) };
}

// Backward compatibility (CLAUDE.md-aligned brief: "maintain backward
// compatibility with existing slot-based exhibits by mapping old slots to
// default positions"). An exhibit donated under the retired slot-only model
// still has a `slotId`, never a `surfaceId` — this derives a stable,
// deterministic default surface + normalized point for it purely from its
// gallery and slot index, so it renders at a believable spot on a real
// surface instead of needing a data migration or silently disappearing.
export function legacySlotPlacement(gallery, slot, subtype) {
  const surfaces = GALLERY_SURFACES[gallery.id] ?? [];
  const compatible = surfaces.filter((s) => !subtype || surfaceAllows(s, subtype));
  const pool = compatible.length > 0 ? compatible : surfaces;
  if (pool.length === 0) return null;
  const index = gallery.slots.findIndex((s) => s.id === slot.id);
  const surface = pool[Math.max(0, index) % pool.length];
  const centroid = surfaceCentroid(surface);
  // Spread multiple legacy exhibits that land on the same surface a little
  // apart rather than stacking exactly on the centroid every time.
  const offset = Math.max(0, index) % 3;
  const jitter = [-0.12, 0, 0.12][offset];
  const { u, v } = surfaceUvFromPoint(surface, centroid.x, centroid.y);
  return { surfaceId: surface.id, u: Math.min(0.9, Math.max(0.1, u + jitter)), v, scale: 1, rotation: 0 };
}

// An anchor arrangement for a gallery's display slots: an original 8-point
// arrangement — a lower row of five sitting on the room's own floor-level
// furniture (plinths/tables/cabinet tops every reference composition shows
// along the bottom two-thirds) and an upper row of three on wall-height
// shelf/alcove positions, clear of the doorway/arch each composition
// centres near the top and clear of VISITOR_ANCHORS below so a donated
// relic and a visitor cameo never occupy the same illustrated spot — plus
// extra anchors appended below at the same two z-bands, purely to grow this
// id pool's capacity. Each slot is a small BOX (width/height alongside x/z)
// — kept only as the legacy donation path's own addressable id space
// (server/src/db.js's `slot_id` column, still referenced by exhibits
// donated before the surface model shipped); it is never rendered as a
// placement option to a visitor any more (see `placementSurfaces` below,
// the only thing a donor is offered now), so x/z/width/height past the
// original 8 are never drawn anywhere — they only need to be distinct ids.
const SLOT_ANCHORS = [
  { x: 12, z: 70, width: 9, height: 15 },
  { x: 28, z: 78, width: 9, height: 15 },
  { x: 44, z: 72, width: 9, height: 15 },
  { x: 60, z: 78, width: 9, height: 15 },
  { x: 76, z: 72, width: 9, height: 15 },
  { x: 90, z: 66, width: 9, height: 15 },
  { x: 20, z: 40, width: 8, height: 13 },
  { x: 70, z: 40, width: 8, height: 13 },
  // Capacity headroom for Stage 2's larger preset catalog (up to 5 presets
  // now share a single category, e.g. memento) plus the test suite's own
  // concurrent donation volume — this pool was never meant to be a visible
  // display-case count, only a legacy uniqueness constraint (see comment
  // above), so it is grown generously rather than tuned to a guessed-tight
  // minimum.
  { x: 15, z: 55, width: 8, height: 13 },
  { x: 35, z: 60, width: 8, height: 13 },
  { x: 55, z: 55, width: 8, height: 13 },
  { x: 85, z: 60, width: 8, height: 13 },
  { x: 25, z: 30, width: 8, height: 13 },
  { x: 50, z: 30, width: 8, height: 13 },
  { x: 80, z: 30, width: 8, height: 13 },
  { x: 10, z: 85, width: 8, height: 13 },
  { x: 95, z: 85, width: 8, height: 13 },
  { x: 40, z: 90, width: 8, height: 13 },
  { x: 60, z: 90, width: 8, height: 13 },
  { x: 5, z: 50, width: 8, height: 13 },
  { x: 95, z: 50, width: 8, height: 13 },
  { x: 30, z: 15, width: 8, height: 13 },
];

// Where another visitor's silhouette may stand in a main/close-up scene —
// deliberately along the room's edges and foreground, clear of both the
// display-slot arc above and the interactive-object anchors below, so a
// cameo is never mistaken for (or occludes) a real exhibit or a glowing
// painted object. `depth` is a small multiplier the client's parallax
// layer uses (not a hit-test concern) — values a little off 1.0 so
// visitors don't all read as pasted onto one flat plane.
const VISITOR_ANCHORS = [
  { x: 6, y: 64, depth: 0.94 },
  { x: 94, y: 64, depth: 0.94 },
  { x: 16, y: 82, depth: 1.08 },
  { x: 84, y: 82, depth: 1.08 },
  { x: 50, y: 88, depth: 1.16 },
  { x: 34, y: 90, depth: 1.2 },
];

// The hall is wider (one real 1672x941 room, not a cropped facing), so its
// cameos get their own, slightly more spread arrangement rather than
// reusing VISITOR_ANCHORS, clear of every interactive-object anchor below.
const HALL_VISITOR_ANCHORS = [
  { x: 4, y: 68, depth: 1.0 },
  { x: 96, y: 68, depth: 1.0 },
  { x: 50, y: 92, depth: 1.18 },
  { x: 36, y: 88, depth: 1.1 },
];

// A main gallery scene's default "look around the room" range — bounded
// pan (0-100, 50 is centred) and zoom (a multiplier over the camera's own
// baseline framing). Zoomed enough beyond 1x that panning actually reveals
// new parts of the room (the brief: "zoom the artwork enough to create a
// meaningful horizontal pan range") without the source illustration
// degrading — see docs/adr/0005-immersive-2.5d-camera.md's own "remaining
// visual limitations" section for the honest ceiling this places on how
// wide a look-around a single 16:9 illustration can sincerely support.
// minTilt/maxTilt are pan's vertical twin (same 0-100 space, 50 centred):
// bounded enough that looking up/down reveals more ceiling/floor without
// ever panning past the illustration's own top/bottom edge.
const DEFAULT_MAIN_CAMERA = {
  initialPan: 50,
  minPan: 8,
  maxPan: 92,
  initialTilt: 50,
  minTilt: 30,
  maxTilt: 70,
  initialZoom: 1.3,
  minZoom: 1.15,
  maxZoom: 2.1,
};
const DEFAULT_CLOSEUP_CAMERA = {
  initialPan: 50,
  minPan: 20,
  maxPan: 80,
  initialTilt: 50,
  minTilt: 35,
  maxTilt: 65,
  initialZoom: 1.5,
  minZoom: 1.3,
  maxZoom: 2.2,
};
// The hall is now one genuine wide-angle room image (entrance-hall-v2.png,
// the same full-size footing as every gallery illustration), not a small
// low-resolution reference cropped into four narrow facings — so it uses
// the identical camera treatment as any other main scene, never a special,
// narrower "hub-only" range (CLAUDE.md: "do not make Entrance Hall a
// special interaction mode").
const HALL_CAMERA = DEFAULT_MAIN_CAMERA;

const GALLERY_LAYOUT = [
  {
    id: "portraits",
    name: "The Portraits That Watch",
    category: "portrait",
    accent: "#663D43",
    orderIndex: 0,
    image: "portraits",
    closeup: {
      image: "portrait-reference",
      caption: "The Watching Portrait",
      lore: "The mirror fogs from the edges inward, never from breath. Conservation notes say the fog always clears last around whoever has already looked away — the same note, in the same hand, every time it is written.",
    },
    // Eight real painted objects in portraits.webp (1672x941), each
    // hand-traced against the actual illustration rather than a percentage
    // box floated over whatever happens to be nearby: the large gilt-framed
    // central portrait, the twin plinth busts flanking the display table,
    // the raven on the left-hand shelf, a second framed portrait on the
    // right wall, a death's-head bust on the far-left pedestal, an oval wall
    // mirror, and a cabinet of pinned moths on the far right — distributed
    // left/centre/right so panning the room keeps revealing more of them.
    objects: [
      {
        type: "lore",
        label: "Look closer: The Watching Portrait",
        text: "The mirror fogs from the edges inward, never from breath. Conservation notes say the fog always clears last around whoever has already looked away — the same note, in the same hand, every time it is written.",
        closeupSceneId: "portraits-closeup",
        shape: polygon([[670, 235], [820, 235], [820, 610], [670, 610]]),
      },
      {
        type: "lore",
        label: "The left plinth bust",
        text: "The bust carries no accession record, only a small pencilled '1.' on its underside, in the same hand as the first curator's own notebooks. Staff rotate it a quarter turn at every inventory, to see if a visitor notices it now faces a different way. Someone always does.",
        shape: polygon([
          [659, 507.5], [634, 507.5], [633.5, 502], [639.5, 499], [638.5, 489],
          [623.5, 474], [625.5, 466], [636, 461.5], [639.5, 458], [634.5, 443],
          [636.5, 435], [644, 429.5], [652, 430.5], [657.5, 436], [658.5, 447],
          [654.5, 450], [652.5, 460], [663, 465.5], [668.5, 473], [668.5, 475],
          [661.5, 480], [660.5, 485], [655.5, 489], [655.5, 493], [653.5, 494],
          [653.5, 499], [659.5, 503],
        ]),
      },
      {
        type: "lore",
        label: "The right plinth bust",
        text: "Its twin was catalogued in the same acquisition, but no two inventories since have agreed on which bust is the original and which the copy.",
        shape: polygon([
          [875, 506.5], [858, 506.5], [858.5, 488], [852.5, 483], [852, 478.5],
          [846.5, 478], [848.5, 468], [862.5, 461], [861.5, 455], [857.5, 453],
          [856.5, 439], [864, 432.5], [871, 432.5], [877.5, 437], [878.5, 449],
          [877.5, 454], [874.5, 456], [874.5, 460], [888.5, 467], [888.5, 475],
          [881.5, 480], [876.5, 487], [876.5, 491], [873.5, 492], [875, 506.5],
        ]),
      },
      {
        type: "lore",
        label: "A raven that never blinks",
        text: "It has perched in the same spot since the inventory began. No one recalls uncaging it; no one has ever tried.",
        shape: polygon([[212, 478], [208, 477], [207, 474], [200, 478], [181, 478], [180, 474], [175, 472], [164, 476], [158, 472], [158, 468], [168, 463], [167, 460], [164, 460], [164, 456], [175, 458], [180, 453], [180, 448], [176, 446], [176, 442], [205, 416], [225, 408], [234, 400], [240, 398], [247, 398], [248, 402], [260, 404], [260, 408], [252, 410], [247, 418], [240, 418], [234, 422], [240, 428], [240, 434], [231, 432], [226, 440], [220, 440], [218, 442], [218, 445], [212, 448], [212, 452], [208, 458], [199, 452], [189, 456], [184, 462], [185, 466], [189, 466], [221, 460], [222, 465], [218, 467], [218, 470], [212, 472]]),
      },
      {
        type: "lore",
        label: "The second framed portrait",
        text: "Unsigned, undated, and — by every conservator's measurement — painted in exactly the same hand as the gallery's central portrait, though the museum has never catalogued them as a pair. A loan slip once tucked behind the canvas named a borrower; only the surname survives the damp, and it matches no curator the museum has ever listed on staff.",
        shape: polygon([
          [1065, 283], [1075, 290], [1085, 298], [1090, 305], [1097, 310],
          [1100, 320], [1100, 395], [1095, 405], [1085, 408], [1020, 408],
          [1010, 405], [1005, 395], [1005, 320], [1010, 310], [1018, 300],
          [1030, 292], [1045, 286], [1055, 283],
        ]),
      },
      {
        type: "lore",
        label: "A death's-head bust on the far pedestal",
        text: "Donated anonymously, decades before the gallery itself existed. The donation ledger lists only one line in its entry: 'it asked to come inside.'",
        shape: polygon([[97, 655], [97, 600], [93, 565], [99, 535], [113, 512], [140, 498], [168, 498], [190, 514], [201, 545], [204, 580], [204, 655]]),
      },
      {
        type: "lore",
        label: "An oval wall mirror",
        shape: polygon([
          [452, 243], [460, 248], [468, 258], [476, 268], [481, 278],
          [484, 290], [483, 302], [479, 312], [483, 322], [484, 335],
          [483, 350], [480, 365], [478, 380], [476, 395], [474, 410],
          [470, 418], [460, 420], [448, 420], [438, 418], [432, 410],
          [430, 395], [428, 380], [427, 365], [428, 350], [427, 335],
          [428, 322], [424, 312], [428, 302], [427, 290], [430, 278],
          [435, 268], [443, 258], [448, 248],
        ]),
        text: "It reflects the room a half-second late, conservators insist, though no instrument sensitive enough to confirm it has ever been brought in to try.",
      },
      {
        type: "lore",
        label: "A cabinet of pinned moths",
        text: "Each moth is labelled with a date of collection and nothing else — no collector's name, no location, across a span of hand-writing styles that covers at least three centuries. The most recent label is also the smallest, written in a hand matched nowhere else in this gallery, though a conservator insists she has seen it before, in a different room entirely.",
        shape: polygon([
          [1503, 494], [1592, 489], [1600, 500], [1602, 600], [1600, 690],
          [1590, 698], [1505, 698], [1497, 690], [1497, 505],
        ]),
      },
      {
        type: "lore",
        label: "The woman walking away down the corridor",
        text: "Every restoration photograph of this painting shows her a few steps further down the hall than the one before it — always receding, never arriving.",
        shape: polygon([[160, 148], [312, 145], [315, 385], [158, 388]]),
      },
      {
        type: "lore",
        label: "A portrait of an owl mid-turn",
        text: "The framer's invoice describes 'one owl, startled.' No one on staff will say what it was startled by, or whether the answer is still in the room.",
        shape: polygon([[357, 228], [414, 230], [415, 378], [355, 380]]),
      },
      {
        type: "lore",
        label: "An antlered mount cradling a crystal orb",
        text: "The antlers were never attached to the orb by any catalogued process. They are simply found together every morning, however the cleaners leave them the night before.",
        shape: polygon([
          [817, 518], [845, 513], [865, 520], [905, 515], [940, 548],
          [940, 568], [897, 600], [882, 599], [868, 594], [832, 599], [813, 560],
        ]),
      },
      {
        type: "lore",
        label: "A porcelain vase beside a terrestrial globe",
        text: "The globe's continents match no accepted historical map. Cartography consultants disagree only on which century it's wrong for.",
        shape: polygon([
          [1143, 250], [1175, 250], [1197, 272], [1210, 330], [1213, 388],
          [1200, 428], [1192, 468], [1200, 498], [1188, 512], [1140, 512],
          [1130, 498], [1142, 468], [1132, 428], [1103, 378], [1100, 320], [1112, 278],
        ]),
      },
      {
        type: "lore",
        label: "A small portrait beneath the pheasant painting",
        text: "Cleaning reveals a second, fainter face beneath the painted one each time — always the same face, never fully removed by the solvent.",
        shape: polygon([[1009, 414], [1080, 410], [1083, 480], [1011, 484]]),
      },
      {
        type: "lore",
        label: "A round medallion in a velvet mount",
        text: "The engraving on its reverse has been transcribed four different ways by four different conservators, none of whom compared notes with the others.",
        shape: ellipse(1073, 495, 26, 25),
      },
      {
        type: "lore",
        label: "A figurine sealed beneath glass",
        text: "The dome has never been opened in the gallery's recorded history, yet the figurine's pose is not the one described in the earliest acquisition photograph.",
        shape: polygon([
          [1298, 397], [1309, 399], [1319, 406], [1329, 417], [1337, 432],
          [1341, 450], [1343, 470], [1343, 520], [1261, 520], [1261, 470],
          [1263, 450], [1267, 432], [1275, 417], [1285, 406], [1292, 399],
        ]),
      },
      {
        type: "lore",
        label: "A dark urn of long-dried flowers",
        text: "The flowers have not been replaced since the gallery opened. They have also not decayed further in that time, a fact the conservation log simply states without comment.",
        shape: polygon([
          [1205, 468], [1215, 470], [1225, 480], [1235, 495], [1245, 510],
          [1255, 525], [1262, 545], [1265, 565], [1260, 585], [1250, 600],
          [1240, 615], [1235, 625], [1245, 645], [1253, 670], [1253, 700],
          [1248, 715], [1243, 730], [1243, 738], [1205, 738], [1200, 730],
          [1192, 715], [1190, 695], [1190, 670], [1195, 645], [1205, 625],
          [1198, 610], [1190, 595], [1180, 575], [1178, 555], [1183, 535],
          [1190, 515], [1198, 495], [1200, 480],
        ]),
      },
      {
        type: "lore",
        label: "A gentleman in a top hat, in a deep alcove",
        text: "He is never looking at the viewer in any photograph taken of the painting, yet every visitor who stands before him describes the opposite.",
        shape: polygon([
          [550, 392], [562, 388], [575, 392], [582, 402], [584, 425],
          [586, 455], [587, 485], [588, 515], [540, 515], [539, 485],
          [541, 455], [543, 425], [546, 402],
        ]),
      },
      {
        type: "lore",
        label: "A bearded man in a small frame",
        text: "The accession card lists him as 'unidentified sitter,' though three separate donors have each, at different times, insisted he was a relative of theirs.",
        shape: polygon([[303, 436], [362, 436], [362, 528], [303, 528]]),
      },
      {
        type: "lore",
        label: "A brass armillary sphere on its stand",
        text: "Its rings are set to a date in the sky that hasn't occurred yet. The astronomer who calibrates such things for the museum has refused to return a second time — the third such sphere in the collection, and the third left set to the same unarrived date, though no two were acquired within a decade of each other.",
        shape: polygon([
          [1122, 592], [1155, 585], [1185, 600], [1195, 620], [1190, 645],
          [1175, 655], [1178, 670], [1168, 685], [1172, 700], [1160, 715],
          [1130, 715], [1118, 700], [1122, 685], [1112, 670], [1115, 650],
          [1100, 635], [1102, 615], [1112, 600],
        ]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "The gilt frame's crest",
        text: "The carved cartouche at the frame's crown has no family crest the heralds' office can identify. It has been asked to identify it four separate times, by four separate curators, each unaware the others had already asked — the fourth request filed by the first curator, and the last request on record bearing that title at all.",
        shape: polygon([[207, 47], [212, 40], [222, 34], [234, 31], [246, 30], [258, 32], [268, 36], [278, 42], [285, 49], [288, 55], [282, 60], [270, 64], [255, 66], [240, 65], [225, 62], [213, 57]], PORTRAIT_REF_VIEWBOX),
      },
      {
        type: "lore",
        label: "The receding corridor in the painting",
        text: "Measured against the frame, the painted corridor is longer than the wall it hangs on could physically contain. No restorer has ever proposed correcting the perspective.",
        shape: polygon([[152, 88], [352, 88], [352, 355], [152, 355]], PORTRAIT_REF_VIEWBOX),
      },
      {
        type: "lore",
        label: "A wilting rose at the frame's foot",
        text: "Replaced weekly by a hand no roster accounts for. The replacement is always the same species, always already a little wilted.",
        shape: ellipse(32, 200, 23, 68, PORTRAIT_REF_VIEWBOX),
      },
    ],
  },
  {
    id: "memento",
    name: "Objects That Remember",
    category: "memento",
    accent: "#88653D",
    orderIndex: 1,
    image: "memento",
    closeup: {
      image: "cabinet-reference",
      caption: "The Long Cabinet",
      lore: "Every drawer is catalogued; no two catalogues agree on a date. Objects That Remember keeps the disagreements as carefully as the objects — including the one drawer whose card names a curator no later catalogue repeats.",
    },
    objects: [
      {
        type: "lore",
        label: "Look closer: The Long Cabinet",
        text: "Every drawer is catalogued; no two catalogues agree on a date. Objects That Remember keeps the disagreements as carefully as the objects — including the one drawer whose card names a curator no later catalogue repeats.",
        closeupSceneId: "memento-closeup",
        shape: polygon([[685, 438], [1010, 438], [1010, 745], [685, 745]]),
      },
      {
        type: "lore",
        label: "A standing clock",
        text: "The clock keeps the time of a city three hours away. No one here has reset it. No one is certain it is wrong.",
        shape: polygon([
          [1493, 218], [1497, 200], [1499, 187], [1503, 193], [1507, 205], [1513, 196], [1518, 213],
          [1522, 196], [1526, 213], [1533, 213], [1536, 200], [1541, 184], [1546, 191], [1550, 204],
          [1554, 196], [1558, 218], [1562, 235], [1560, 250], [1557, 263], [1550, 272], [1548, 283],
          [1552, 290], [1535, 293], [1500, 294], [1495, 288], [1491, 278], [1489, 265], [1489, 250],
          [1491, 236], [1493, 225],
        ]),
      },
      {
        type: "lore",
        label: "A locked drawer",
        text: "Every other drawer in the cabinet opens freely. This one has never been recorded unlocked, and no key has ever been catalogued for it — only a card taped beside the keyhole, in the first curator's hand, reading simply 'later.'",
        shape: polygon([[712, 582], [897, 580], [897, 609], [712, 611]]),
      },
      {
        type: "lore",
        label: "A watchful owl on the high shelf",
        text: "Taxidermied, the ledger insists, though no preparator's name is attached to the mount, and its head has been found facing a different corner of the room at the start of more than one shift.",
        shape: polygon([
          [1491, 152.5], [1444.5, 152], [1444.5, 147], [1455.5, 141], [1458, 132.5],
          [1471, 131.5], [1474.5, 129], [1477.5, 123], [1477.5, 113], [1452.5, 88],
          [1440, 68.5], [1430.5, 68], [1430.5, 64], [1437.5, 61], [1437.5, 57],
          [1432.5, 50], [1431.5, 29], [1436.5, 21], [1442, 17.5], [1451, 15.5],
          [1467, 17.5], [1474.5, 23], [1485, 39.5], [1511, 52.5], [1515.5, 56],
          [1516, 59.5], [1521, 60.5], [1523.5, 64], [1523, 68.5], [1509, 68.5],
          [1508.5, 74], [1511.5, 77], [1511.5, 83], [1521, 90.5], [1525, 90.5],
          [1535.5, 106], [1535.5, 112], [1542.5, 122], [1542.5, 137], [1495, 149.5],
        ]),
      },
      {
        type: "lore",
        label: "A gilt standing mirror",
        text: "Visitors report it holds their reflection a beat longer than they turned away for. Staff log the complaint, politely, and change nothing.",
        shape: polygon([
          [100, 248], [120, 257], [138, 270], [150, 285], [160, 298], [172, 310], [177, 323],
          [167, 335], [157, 348], [150, 362], [142, 378], [140, 393],
          [152, 408], [158, 430], [155, 455], [148, 478], [140, 500], [133, 525], [130, 550], [133, 573], [128, 595], [118, 610], [103, 620],
          [85, 622], [65, 617],
          [48, 605], [38, 588], [42, 565], [50, 548], [42, 528], [32, 510], [25, 492], [32, 475], [42, 460], [38, 440], [45, 420], [52, 405],
          [60, 390], [50, 375], [45, 358], [52, 342], [45, 325], [48, 308], [55, 292], [68, 275], [85, 258],
        ]),
      },
      {
        type: "lore",
        label: "A brass armillary globe",
        text: "Its rings are set to a sky that matches no hemisphere's stars as drawn — the second such sphere in the collection, set to the same unarrived date as its counterpart across the hall. An astronomer consulted twice has twice declined to say more on the record.",
        shape: ellipse(332, 563, 68, 68),
      },
      {
        type: "lore",
        label: "A mounted bird mid-call",
        text: "Perched exactly as it was catalogued in 1889, mid-song, beak open. No recording of the call it was meant to be making has ever been found in the archive.",
        shape: polygon([
          [1183, 325], [1192, 316], [1200, 312], [1207, 310], [1213, 312],
          [1219, 318], [1225, 330], [1232, 342], [1240, 352], [1248, 363],
          [1250, 375], [1246, 385], [1252, 393], [1257, 402], [1251, 410],
          [1240, 416], [1226, 421], [1212, 423], [1198, 418], [1188, 405],
          [1181, 390], [1179, 372], [1181, 355], [1184, 340], [1188, 330],
        ]),
      },
      {
        type: "lore",
        label: "A grinning skull on the upper shelf",
        text: "Dental records matched it to three different missing persons in three different decades. All three case files were closed as unrelated before anyone compared notes.",
        shape: polygon([
          [245, 205], [268, 198], [290, 202], [305, 218], [310, 240],
          [305, 262], [292, 278], [295, 295], [280, 302], [258, 302],
          [243, 295], [245, 278], [230, 262], [225, 240], [230, 218],
        ]),
      },
      {
        type: "lore",
        label: "A standing bird carved mid-stride",
        text: "No taxonomist on staff will commit to a species. It is carved walking forward on legs too long for any wading bird in the regional record.",
        shape: polygon([
          [78, 250], [95, 235], [108, 225], [112, 245], [120, 270],
          [128, 300], [132, 330], [128, 360], [120, 385], [108, 400],
          [95, 405], [82, 395], [80, 370], [88, 345], [82, 320],
          [75, 295], [72, 270],
        ]),
      },
      {
        type: "lore",
        label: "A pressed herbarium of unlabelled flowers",
        text: "Every specimen is mounted and dated, and not one is named. The first curator left the binomial column blank on every single card, on purpose, according to a note pinned to the back — the same purpose claimed, in the same words, on an unrelated card three rooms away.",
        shape: polygon([
          [20, 480], [95, 472], [102, 495], [100, 560], [95, 600],
          [85, 615], [25, 615], [15, 600], [15, 520],
        ]),
      },
      {
        type: "lore",
        label: "A framed orange butterfly in its mounting case",
        text: "The wings have not faded in a hundred and forty years under direct gallery light, a fact the conservation team has measured four times and reported, without explanation, each time.",
        shape: polygon([[385, 478], [440, 472], [498, 490], [500, 540], [432, 541], [382, 536]]),
      },
      {
        type: "lore",
        label: "A framed moth beside the orange butterfly",
        text: "Catalogued as a companion piece to its neighbour, though the accession ledger records the two arriving at the museum fourteen years apart.",
        shape: polygon([[431, 484], [487, 484], [498, 490], [500, 530], [498, 580], [432, 582], [430, 540]]),
      },
      {
        type: "lore",
        label: "A domed arrangement of dried red flowers",
        text: "The red has not dulled since the dome was sealed. No conservator now on staff was present for the sealing, and none will say what, if anything, keeps the colour from going.",
        shape: polygon([[552, 452], [560, 434], [576, 428], [592, 434], [600, 452], [602, 500], [602, 538], [538, 538], [538, 500]]),
      },
      {
        type: "lore",
        label: "A pair of leather-bound ledgers",
        text: "Both are locked shut by their own warped bindings rather than any clasp. No one has forced them open, and no one has found a key that claims to fit.",
        shape: polygon([[392, 654], [500, 630], [592, 648], [592, 700], [585, 718], [400, 730], [390, 700]]),
      },
      {
        type: "lore",
        label: "A domed branch of red coral",
        text: "Catalogued as a marine specimen, though it was donated by a collector whose papers list no sea voyage of any kind in his lifetime.",
        shape: polygon([[1165, 460], [1172, 440], [1188, 428], [1202, 428], [1215, 438], [1222, 458], [1225, 480], [1225, 520], [1163, 520], [1160, 480]]),
      },
      {
        type: "lore",
        label: "A shelf of brass orrery clocks",
        text: "Both timepieces are wound on the same schedule by the same hand, and both have drifted to show the same wrong hour, independently, every month for as long as anyone has checked — the hour the hall's own mechanical clock was once stopped and restarted, by nobody who signed for it.",
        shape: polygon([
          [1305, 345], [1340, 330], [1375, 345], [1385, 380], [1382, 420],
          [1388, 440], [1370, 460], [1380, 480], [1382, 510], [1370, 540],
          [1375, 565], [1360, 600], [1330, 615], [1300, 605], [1295, 570],
          [1305, 540], [1295, 510], [1292, 470], [1300, 440], [1290, 400], [1293, 370],
        ]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "A small lidded casket on the lower shelf",
        text: "Catalogued as empty. Weighed twice since, at two different conservators' insistence, and found slightly heavier each time.",
        shape: polygon(
          [
            [174, 192], [200, 190], [204, 195], [204, 214], [201, 217],
            [176, 219], [173, 216], [173, 195],
          ],
          CABINET_REF_VIEWBOX,
        ),
      },
      {
        type: "lore",
        label: "A gilt shrine with no name plate",
        text: "The figure inside has been dusted so many times its face has worn soft. No label has ever been affixed, though the fixing-holes for one are there, drilled — a conservator once noted — to fit a plate already engraved with the first curator's own initials, never installed.",
        shape: polygon(
          [
            [260, 149], [266, 156], [263, 161], [270, 163], [279, 171],
            [276, 177], [273, 181], [274, 210], [273, 221], [279, 227],
            [284, 236], [274, 241], [260, 243], [246, 241], [236, 236],
            [241, 227], [247, 221], [247, 181], [244, 177], [241, 171],
            [250, 163], [257, 161], [254, 156],
          ],
          CABINET_REF_VIEWBOX,
        ),
      },
      {
        type: "lore",
        label: "The larger of two glass orbs",
        text: "Wound on the same schedule as its smaller twin for forty years. The two have never, in any inspection on record, shown the same time as each other.",
        shape: ellipse(261.5, 248, 9.5, 10, CABINET_REF_VIEWBOX),
      },
      {
        type: "lore",
        label: "The smaller of two glass orbs",
        text: "Catalogued as a pair with its larger twin across the shelf, though no accession record explains why one was set down so much farther from the other.",
        shape: ellipse(297.5, 275.5, 7.5, 4.5, CABINET_REF_VIEWBOX),
      },
    ],
  },
  {
    id: "specimen",
    name: "The Cabinet of Impossible Life",
    category: "specimen",
    accent: "#4A5A3D",
    orderIndex: 2,
    image: "specimen",
    closeup: {
      image: "specimen",
      zoom: true,
      caption: "Under Glass",
      lore: "Logged as botanical in 1911, biological in 1958, and 'undetermined — do not reclassify again' in 2003, in the same hand as the first entry. The jar has not been opened since.",
      closeupCamera: {
        initialPan: 50,
        minPan: 30,
        maxPan: 70,
        initialTilt: 50,
        minTilt: 40,
        maxTilt: 60,
        initialZoom: 1.7,
        minZoom: 1.5,
        maxZoom: 2.3,
      },
    },
    objects: [
      {
        type: "lore",
        label: "Forest Sprite Cottage",
        text: "A miniature dwelling under its own glass, logged as botanical in 1911, biological in 1958, and 'undetermined — do not reclassify again' in 2003, in the same hand as the first entry. No specimen has ever been catalogued alongside it, only the cottage, and the jar has not been opened since.",
        shape: polygon([
          [823, 426], [879, 421], [1077, 437], [1073, 442], [1074, 581], [880, 584],
          [824, 581], [823, 431],
        ]),
      },
      {
        type: "lore",
        label: "The skeletal figure on the shelf",
        text: "Collection records list only one sculpture for this gallery. Nobody currently on staff remembers the other one arriving, nor can anyone say with confidence what species it was assembled to represent — only that the armature inside carries the same maker's stamp as the skeletal wing across the room, filed a decade apart.",
        shape: polygon([
          [527, 124], [524, 407], [702, 421], [702, 166], [531, 125],
        ]),
      },
      {
        type: "lore",
        label: "The caged glow beyond the arch",
        text: "Logged as 'garden lighting' in every inventory since 1920. No garden has ever been found on the other side of that arch.",
        shape: polygon([
          [1100, 183], [1093, 210], [1083, 225], [1060, 240], [1040, 260], [1030, 285],
          [1028, 310], [1033, 330], [1045, 345], [1060, 353], [1060, 410], [1050, 410],
          [1150, 410], [1140, 410], [1140, 353], [1155, 345], [1167, 330], [1172, 310],
          [1170, 285], [1160, 260], [1140, 240], [1117, 225], [1107, 210],
        ]),
      },
      {
        type: "lore",
        label: "A really cool plant",
        text: "Shelved under its own glass with no accompanying card at all — the one specimen in this gallery the catalogue doesn't even attempt a name for, though the glow it still gives off at night has never dimmed since the dome was sealed, by nobody now on record.",
        shape: polygon([
          [149, 506], [138, 506], [133, 508], [125, 512], [118, 514], [112, 519],
          [108, 524], [104, 530], [101, 535], [99, 540], [98, 545], [97, 551],
          [97, 668], [93, 668], [89, 669], [89, 672], [92, 674], [90, 677],
          [89, 682], [86, 686], [86, 690], [87, 694], [91, 697], [95, 701],
          [103, 703], [116, 704], [128, 704], [140, 705], [155, 705], [167, 704],
          [174, 701], [185, 701], [197, 699], [206, 696], [211, 695], [213, 691],
          [213, 687], [212, 683], [209, 680], [206, 677], [208, 672], [203, 667],
          [201, 666], [201, 547], [201, 543], [200, 540], [198, 536], [196, 534],
          [195, 531], [193, 527], [191, 525], [188, 523], [185, 520], [183, 517],
          [179, 515], [177, 513], [174, 512], [170, 510], [165, 508], [162, 508],
          [158, 507], [153, 506],
        ]),
      },
      {
        type: "lore",
        label: "An African butterfly specimen",
        text: "Pinned facing the glass, wings spread for viewing, same as every other mount on this wall — except its own card carries no collection locality, the one blank field on an otherwise fully completed record.",
        shape: polygon([
          [117, 62], [220, 81], [219, 228], [116, 216], [117, 67],
        ]),
      },
      {
        type: "lore",
        label: "A taxidermied bird of prey",
        text: "Catalogued three separate times under three separate species names, each correction filed by a different ornithologist who never consulted the last.",
        shape: polygon([
          [1497, 89], [1503, 78], [1512, 65], [1520, 56], [1527, 48], [1533, 43],
          [1540, 47], [1547, 43], [1554, 47], [1561, 44], [1568, 48], [1576, 50],
          [1584, 53], [1592, 57], [1600, 62], [1608, 72], [1615, 88], [1612, 103],
          [1618, 114], [1626, 122], [1630, 140], [1633, 158], [1628, 176], [1618, 192],
          [1606, 200], [1592, 205], [1575, 207], [1558, 206], [1540, 204], [1522, 200],
          [1507, 195], [1498, 185], [1495, 170], [1497, 153], [1502, 136], [1508, 118],
          [1514, 100], [1515, 86], [1508, 78],
        ]),
      },
      {
        type: "lore",
        label: "A ram-horned skull on the shelf",
        text: "Field notes describe the animal as 'goat-like, but wrong in the jaw,' signed only with the first curator's initials. No photograph of the living specimen survives, and the collector who shot it never filed a species name.",
        shape: polygon([
          [240, 633], [243, 630], [245, 628], [246, 625], [251, 628], [252, 631],
          [252, 635], [253, 640], [253, 643], [262, 649], [267, 649], [271, 649],
          [274, 649], [277, 650], [281, 650], [287, 651], [292, 653], [299, 656],
          [306, 661], [310, 661], [311, 666], [316, 667], [317, 669], [319, 666],
          [321, 669], [322, 671], [327, 671], [330, 670], [332, 672], [337, 675],
          [342, 677], [345, 678], [350, 681], [354, 683], [357, 684], [361, 686],
          [358, 678], [355, 673], [352, 669], [350, 665], [350, 663], [352, 663],
          [354, 666], [358, 667], [361, 669], [363, 673], [366, 677], [368, 681],
          [370, 685], [372, 689], [373, 694], [375, 697], [377, 692], [376, 686],
          [374, 682], [372, 676], [370, 669], [368, 663], [366, 659], [363, 653],
          [361, 647], [357, 641], [354, 636], [350, 632], [347, 627], [344, 623],
          [340, 617], [337, 613], [334, 609], [331, 608], [328, 606], [325, 603],
          [321, 598], [319, 594], [318, 588], [318, 584], [319, 582], [317, 578],
          [313, 575], [308, 573], [304, 568], [303, 563], [301, 560], [297, 558],
          [295, 554], [291, 550], [289, 546], [288, 549], [289, 554], [289, 556],
          [288, 559], [286, 560], [284, 562], [282, 563], [277, 559], [274, 558],
          [270, 555], [268, 553], [265, 549], [263, 545], [261, 541], [259, 536],
          [258, 531], [256, 533], [257, 537], [257, 541], [256, 545], [256, 548],
          [256, 550], [253, 550], [251, 548], [251, 545], [249, 541], [248, 537],
          [245, 532], [244, 527], [242, 523], [241, 519], [241, 515], [241, 512],
          [240, 508], [237, 507], [238, 510], [238, 514], [238, 517], [239, 520],
          [235, 515], [234, 512], [233, 510], [231, 507], [232, 503], [232, 499],
          [229, 499], [229, 501], [227, 501], [225, 499], [224, 496], [224, 493],
          [223, 489], [221, 493], [218, 491], [216, 489], [213, 486], [209, 483],
          [207, 480], [204, 477], [202, 475], [199, 473], [197, 471], [194, 468],
          [191, 464], [188, 461], [184, 458], [185, 460], [186, 463], [188, 466],
          [191, 469], [192, 472], [193, 475], [196, 478], [196, 482], [196, 485],
          [196, 490], [196, 493], [196, 497], [196, 499], [192, 499], [190, 496],
          [186, 494], [183, 491], [180, 488], [178, 485], [175, 481], [172, 476],
          [171, 472], [168, 469], [165, 465], [160, 461], [158, 460], [155, 457],
          [151, 454], [148, 454], [150, 457], [152, 460], [156, 463], [159, 467],
          [162, 471], [162, 474], [165, 478], [167, 482], [169, 485], [165, 481],
          [161, 479], [157, 477], [153, 476], [150, 474], [146, 472], [142, 469],
          [139, 466], [136, 462], [133, 459], [131, 455], [129, 453], [127, 450],
          [126, 453], [129, 457], [131, 460], [133, 465], [136, 469], [137, 471],
          [136, 473], [132, 472], [127, 472], [122, 470], [118, 471], [113, 471],
          [107, 471], [103, 471], [98, 471], [94, 472], [90, 471], [86, 469],
          [82, 469], [79, 470], [81, 472], [85, 473], [90, 475], [94, 476],
          [98, 477], [105, 479], [108, 479], [112, 479], [117, 481], [121, 483],
          [120, 485], [115, 486], [111, 489], [108, 491], [105, 492], [100, 494],
          [101, 498], [98, 500], [95, 506], [93, 511], [91, 514], [88, 518],
          [86, 521], [83, 526], [82, 531], [81, 536], [81, 540], [82, 546],
          [85, 551], [88, 555], [91, 558], [95, 561], [98, 562], [98, 558],
          [98, 555], [97, 552], [97, 549], [95, 545], [94, 541], [94, 536],
          [96, 531], [97, 526], [100, 521], [102, 519], [104, 515], [108, 510],
          [112, 506], [115, 503], [121, 499], [126, 497], [131, 495], [137, 494],
          [142, 491], [148, 492], [152, 494], [155, 495], [160, 497], [165, 500],
          [171, 504], [174, 508], [177, 511], [180, 515], [183, 518], [186, 520],
          [188, 522], [191, 524], [192, 527], [196, 531], [197, 534], [199, 538],
          [203, 541], [206, 544], [208, 546], [211, 551], [211, 554], [208, 553],
          [205, 552], [201, 553], [202, 567], [202, 577], [208, 579], [213, 582],
          [217, 586], [215, 587], [210, 588], [207, 588], [201, 589], [201, 635],
          [205, 633], [208, 630], [211, 629], [215, 627], [218, 625], [222, 625],
          [223, 627], [223, 630], [226, 630], [230, 630], [229, 634], [232, 635],
          [232, 638], [233, 644], [235, 645], [238, 645], [240, 644], [239, 641],
          [238, 639], [239, 636],
        ]),
      },
      {
        type: "lore",
        label: "An armillary sphere, still turning",
        text: "Unplugged, unwound, and nowhere near a draft, its rings nonetheless complete one slow rotation roughly every nine days — the third of its kind in the collection, and the only one still moving. Maintenance logs it as 'observed, not touched.'",
        shape: polygon([
          [365, 420], [390, 415], [415, 425], [430, 445], [445, 470], [462, 500],
          [465, 530], [460, 560], [448, 590], [430, 615], [405, 635], [378, 642],
          [352, 635], [330, 615], [315, 590], [305, 560], [302, 530], [308, 500],
          [320, 470], [340, 445], [350, 428],
        ]),
      },
      {
        type: "lore",
        label: "A horned skull under its own dome",
        text: "Sealed separately from the rest of the shelf, under its own glass, though the accompanying card gives no reason the others weren't afforded the same treatment.",
        shape: polygon([
          [1408, 315], [1405, 317], [1400, 319], [1404, 321], [1406, 324], [1402, 327],
          [1398, 330], [1391, 334], [1384, 338], [1379, 341], [1376, 346], [1374, 350],
          [1372, 353], [1371, 358], [1369, 364], [1371, 475], [1362, 475], [1362, 485],
          [1441, 482], [1452, 480], [1451, 474], [1447, 469], [1438, 465], [1442, 463],
          [1447, 463], [1451, 457], [1450, 444], [1451, 428], [1452, 422], [1452, 371],
          [1452, 359], [1451, 352], [1445, 344], [1440, 338], [1434, 336], [1427, 331],
          [1423, 330], [1418, 324], [1418, 321], [1421, 318], [1417, 318], [1414, 317],
          [1415, 314], [1414, 311], [1413, 309], [1411, 307], [1409, 309], [1407, 312],
        ]),
      },
      {
        type: "lore",
        label: "Phoenix Fossil",
        text: "The mounting card names the species outright, a confidence nothing else in this cabinet affords its specimens — posed mid-step under glass, as if caught walking rather than mounted, with an invoice itemizing 'armature, feathers, glass dome' and nothing for the bones themselves.",
        shape: polygon([
          [1299, 651], [1299, 637], [1299, 602], [1299, 563], [1299, 537], [1301, 529],
          [1304, 524], [1308, 516], [1313, 510], [1322, 504], [1328, 500], [1334, 499],
          [1348, 497], [1357, 497], [1366, 500], [1375, 504], [1383, 512], [1390, 520],
          [1393, 527], [1395, 534], [1396, 541], [1396, 549], [1396, 556], [1396, 588],
          [1396, 678], [1372, 681], [1362, 682], [1351, 683], [1331, 682], [1317, 681],
          [1307, 679], [1299, 677],
        ]),
      },
      {
        type: "lore",
        label: "Fluorescent Tree",
        text: "A dried, luminous tree under its own glass, listed in the acquisition ledger only as 'light, botanical, source unconfirmed.' It has not needed watering, and whatever keeps it lit has never once been written down as a question anyone intends to answer.",
        shape: polygon([
          [720, 345], [726, 345], [736, 346], [742, 347], [748, 348], [753, 348],
          [760, 348], [766, 348], [774, 347], [780, 346], [787, 346], [788, 343],
          [788, 339], [786, 335], [783, 332], [781, 328], [780, 243], [780, 238],
          [778, 233], [775, 228], [770, 223], [767, 220], [761, 217], [757, 215],
          [753, 213], [751, 212], [747, 213], [743, 213], [739, 215], [735, 216],
          [732, 218], [728, 220], [725, 223], [721, 226], [719, 229], [719, 340],
        ]),
      },
      {
        type: "lore",
        label: "A perched bird among the ferns",
        text: "Painted into the diorama's background foliage so convincingly that two separate inventories logged it as 'decorative only' before a third noticed it was mounted, not painted.",
        shape: polygon([
          [311, 91], [345, 74], [435, 87], [436, 398], [344, 396], [309, 405], [311, 98],
        ]),
      },
      {
        type: "lore",
        label: "A mounted dragon skull",
        text: "No fossil record supports the species. The mounting plaque reads only 'donor requested anonymity' — a line repeated, word for word, on the gallery's own founding specimen, catalogued the same year.",
        shape: polygon([
          [1540, 295], [1565, 292], [1585, 300], [1600, 312], [1612, 325], [1618, 340],
          [1610, 355], [1600, 365], [1595, 380], [1585, 400], [1570, 415], [1555, 418],
          [1540, 405], [1520, 390], [1500, 370], [1485, 358], [1478, 348], [1490, 335],
          [1505, 325], [1515, 310],
        ]),
      },
      {
        type: "lore",
        label: "A small elongated skeleton",
        text: "Shelved beneath the larger skull with no label of its own, as though it were an afterthought — though the vertebrae show the same careful articulation as every other exhibit here.",
        shape: polygon([
          [1476, 527], [1476, 523], [1480, 518], [1484, 515], [1488, 514], [1491, 512],
          [1495, 511], [1497, 509], [1499, 508], [1499, 510], [1502, 509], [1503, 506],
          [1504, 502], [1505, 499], [1509, 497], [1509, 501], [1508, 504], [1506, 507],
          [1508, 507], [1512, 502], [1514, 496], [1516, 501], [1517, 503], [1516, 506],
          [1521, 506], [1522, 500], [1524, 499], [1525, 495], [1528, 494], [1529, 497],
          [1527, 499], [1525, 502], [1524, 504], [1527, 503], [1530, 506], [1532, 504],
          [1533, 501], [1536, 497], [1539, 496], [1541, 496], [1543, 497], [1540, 499],
          [1538, 502], [1536, 504], [1540, 505], [1542, 502], [1544, 501], [1547, 500],
          [1549, 499], [1553, 499], [1557, 499], [1556, 503], [1552, 502], [1547, 504],
          [1546, 506], [1550, 508], [1553, 505], [1558, 501], [1561, 500], [1560, 505],
          [1557, 504], [1554, 506], [1557, 508], [1563, 503], [1566, 501], [1568, 501],
          [1571, 502], [1569, 504], [1567, 506], [1565, 507], [1570, 506], [1573, 506],
          [1574, 508], [1580, 508], [1578, 512], [1577, 513], [1580, 514], [1582, 513],
          [1584, 515], [1586, 518], [1589, 523], [1587, 524], [1584, 525], [1582, 527],
          [1580, 526], [1577, 526], [1574, 525], [1571, 521], [1569, 518], [1567, 520],
          [1569, 522], [1569, 526], [1567, 527], [1566, 528], [1562, 528], [1559, 527],
          [1557, 526], [1554, 523], [1551, 524], [1549, 527], [1545, 525], [1542, 521],
          [1543, 525], [1541, 528], [1539, 527], [1534, 527], [1529, 527], [1525, 526],
          [1520, 526], [1517, 526], [1515, 527], [1513, 528], [1511, 526], [1509, 529],
          [1504, 528], [1499, 527], [1497, 526], [1493, 529], [1488, 528], [1486, 526],
          [1485, 530], [1485, 533], [1482, 533], [1480, 531], [1480, 529], [1479, 527],
        ]),
      },
      {
        type: "lore",
        label: "A skeletal wing, unearthed alone",
        text: "Accessioned with no body to attach it to, and no matching wing ever found despite decades of looking — the only exhibit in this gallery the first curator's own notes admit is incomplete, rather than simply unexplained.",
        shape: polygon([
          [1399, 159], [1395, 162], [1392, 164], [1389, 167], [1386, 168], [1383, 171],
          [1379, 174], [1377, 176], [1374, 179], [1371, 181], [1368, 185], [1365, 187],
          [1363, 190], [1359, 193], [1357, 196], [1355, 199], [1354, 201], [1353, 203],
          [1351, 205], [1349, 207], [1349, 209], [1351, 208], [1353, 207], [1351, 212],
          [1350, 214], [1346, 220], [1344, 224], [1343, 227], [1342, 230], [1340, 233],
          [1339, 236], [1338, 239], [1338, 241], [1337, 244], [1341, 243], [1343, 240],
          [1344, 238], [1346, 238], [1350, 235], [1352, 236], [1351, 239], [1351, 242],
          [1352, 246], [1354, 244], [1357, 242], [1359, 240], [1361, 240], [1362, 243],
          [1361, 247], [1364, 245], [1367, 243], [1370, 241], [1370, 245], [1369, 248],
          [1369, 251], [1371, 249], [1372, 247], [1373, 244], [1373, 241], [1375, 238],
          [1377, 238], [1378, 240], [1381, 239], [1380, 236], [1381, 233], [1384, 231],
          [1385, 228], [1386, 226], [1388, 224], [1389, 222], [1392, 219], [1393, 217],
          [1396, 212], [1396, 209], [1397, 204], [1400, 205], [1404, 204], [1406, 204],
          [1412, 204], [1416, 203], [1418, 203], [1421, 202], [1424, 201], [1426, 197],
          [1427, 194], [1427, 190], [1429, 188], [1430, 192], [1430, 195], [1431, 198],
          [1435, 199], [1438, 198], [1442, 198], [1445, 198], [1448, 197], [1451, 196],
          [1454, 195], [1456, 194], [1459, 193], [1456, 191], [1454, 192], [1451, 192],
          [1447, 191], [1446, 188], [1445, 185], [1444, 182], [1444, 179], [1446, 177],
          [1448, 175], [1448, 171], [1451, 171], [1454, 171], [1458, 171], [1462, 171],
          [1461, 146], [1458, 146], [1455, 144], [1452, 144], [1448, 144], [1443, 144],
          [1439, 145], [1435, 145], [1430, 146], [1427, 147], [1423, 149], [1418, 149],
          [1415, 152], [1411, 154], [1407, 155], [1404, 157],
        ]),
      },
      {
        type: "lore",
        label: "A raw crystal cluster",
        text: "It is faintly warm at the centre of the cluster, year-round, and no geologist asked to explain it has agreed to put a theory in writing — conservation photographs from the gallery's earliest surviving record show it already here, shelved on its own, long before the wing across the room arrived.",
        shape: polygon([
          [1560, 380], [1552, 388], [1544, 397], [1544, 438], [1542, 423], [1539, 414],
          [1527, 401], [1521, 407], [1519, 411], [1518, 416], [1520, 441], [1522, 450],
          [1520, 453], [1520, 459], [1524, 466], [1532, 473], [1533, 477], [1561, 474],
          [1581, 474], [1580, 466], [1584, 466], [1586, 470], [1586, 474], [1589, 474],
          [1592, 469], [1591, 465], [1588, 461], [1591, 458], [1594, 459], [1598, 453],
          [1598, 448], [1596, 445], [1592, 447], [1594, 434], [1588, 434], [1589, 413],
          [1586, 411], [1581, 410], [1581, 397], [1579, 396], [1575, 400], [1576, 394],
          [1569, 388], [1562, 381],
        ]),
      },
      {
        type: "lore",
        label: "A truly rare ostrich egg",
        text: "Blown and mounted the ordinary way, except for the shell itself — thicker than any ostrich egg conservation has been able to source for comparison, and the one specimen in this cabinet whose rarity the catalogue states outright rather than implies.",
        shape: polygon([
          [1365, 97], [1360, 100], [1356, 104], [1354, 106], [1352, 110], [1352, 114],
          [1351, 118], [1351, 123], [1351, 128], [1351, 132], [1352, 134], [1355, 137],
          [1357, 140], [1360, 142], [1364, 144], [1372, 142], [1378, 141], [1382, 138],
          [1386, 134], [1389, 128], [1389, 122], [1390, 118], [1389, 113], [1387, 108],
          [1386, 105], [1384, 101], [1380, 99], [1376, 97], [1373, 96], [1370, 96],
        ]),
      },
      {
        type: "lore",
        label: "An exquisite birdcage",
        text: "Empty, and logged as empty in every inventory since acquisition — yet the door latch shows the same wear pattern as a cage opened daily for years, and the perch inside is worn smooth in exactly the place a bird's feet would grip it.",
        shape: polygon([
          [1116, 200], [1115, 204], [1114, 207], [1115, 210], [1113, 212], [1115, 215],
          [1113, 218], [1110, 220], [1109, 223], [1108, 225], [1111, 228], [1112, 231],
          [1113, 233], [1111, 236], [1109, 237], [1107, 238], [1106, 241], [1105, 245],
          [1103, 246], [1100, 244], [1097, 247], [1095, 249], [1091, 251], [1087, 253],
          [1084, 254], [1081, 255], [1078, 257], [1075, 259], [1072, 262], [1070, 264],
          [1068, 266], [1066, 269], [1064, 271], [1062, 274], [1059, 277], [1057, 280],
          [1055, 285], [1053, 289], [1051, 293], [1050, 299], [1049, 304], [1048, 311],
          [1049, 321], [1049, 337], [1048, 350], [1048, 365], [1048, 388], [1049, 415],
          [1049, 434], [1076, 435], [1079, 437], [1078, 439], [1075, 441], [1073, 442],
          [1074, 520], [1191, 520], [1190, 388], [1190, 324], [1190, 314], [1190, 309],
          [1188, 299], [1186, 294], [1183, 289], [1182, 285], [1179, 280], [1176, 275],
          [1172, 270], [1168, 265], [1164, 261], [1160, 258], [1155, 255], [1150, 252],
          [1147, 250], [1142, 249], [1138, 247], [1134, 247], [1132, 245], [1129, 242],
          [1128, 239], [1124, 236], [1123, 233], [1122, 231], [1123, 227], [1126, 225],
          [1126, 223], [1125, 220], [1123, 218], [1120, 217], [1119, 215], [1122, 213],
          [1120, 211], [1119, 208], [1119, 205], [1118, 202],
        ]),
      },
      {
        type: "lore",
        label: "An ammonite",
        text: "Its spiral runs the wrong direction for its catalogued species — a detail noted once, in pencil, in the margin of the first curator's own logbook, which nobody has been able to relocate since.",
        shape: polygon([
          [727, 485], [724, 490], [722, 493], [721, 496], [719, 500], [719, 503],
          [719, 505], [721, 508], [721, 512], [723, 516], [725, 518], [727, 520],
          [731, 522], [735, 523], [740, 524], [745, 524], [750, 523], [754, 521],
          [757, 519], [758, 516], [760, 514], [763, 512], [763, 509], [765, 506],
          [765, 503], [761, 502], [759, 498], [757, 494], [754, 490], [751, 487],
          [748, 485], [744, 483], [739, 482], [733, 483], [730, 484],
        ]),
      },
      {
        type: "lore",
        label: "A coral specimen",
        text: "Bleached pale rather than its catalogued living colour, same as every coral this gallery holds — except this one's accession card gives a depth of collection no diver on record has certified reaching.",
        shape: polygon([
          [607, 442], [602, 443], [598, 445], [593, 447], [589, 450], [586, 454],
          [582, 458], [581, 464], [581, 533], [586, 536], [589, 540], [591, 542],
          [592, 544], [592, 547], [591, 549], [589, 552], [593, 552], [597, 554],
          [598, 558], [598, 561], [594, 563], [595, 566], [593, 569], [590, 572],
          [585, 574], [586, 579], [599, 580], [607, 580], [613, 580], [619, 580],
          [626, 580], [631, 580], [638, 580], [644, 580], [651, 580], [657, 579],
          [657, 571], [647, 571], [646, 568], [640, 567], [639, 563], [639, 557],
          [638, 555], [637, 553], [635, 551], [635, 465], [634, 460], [632, 456],
          [629, 453], [625, 449], [622, 447], [618, 445], [614, 443], [610, 442],
        ]),
      },
      {
        type: "lore",
        label: "A pine needle specimen",
        text: "Mounted under glass with a date but no location, the one gap in an otherwise meticulous run of botanical cards spanning this whole wall — and the only needle sample in the collection the first curator's own hand never annotated at all.",
        shape: polygon([
          [111, 324], [217, 332], [217, 487], [211, 483], [207, 479], [204, 475],
          [199, 473], [196, 470], [194, 466], [191, 461], [187, 459], [184, 457],
          [184, 462], [187, 466], [189, 470], [192, 474], [194, 477], [196, 484],
          [196, 488], [195, 489], [180, 489], [177, 484], [174, 479], [172, 474],
          [171, 470], [166, 466], [162, 462], [158, 459], [155, 457], [151, 455],
          [151, 459], [156, 462], [159, 465], [161, 470], [164, 475], [165, 481],
          [160, 480], [157, 479], [152, 477], [148, 475], [144, 471], [140, 467],
          [137, 464], [136, 460], [134, 457], [131, 453], [129, 450], [125, 451],
          [128, 456], [130, 459], [134, 466], [136, 471], [138, 474], [132, 470],
          [126, 471], [120, 471], [113, 470], [110, 470], [109, 398], [112, 394],
          [118, 387], [114, 383], [111, 378], [111, 375], [115, 374], [114, 371],
          [113, 367], [109, 366], [108, 361], [107, 355], [107, 348], [105, 343],
          [107, 339], [108, 336], [108, 334], [110, 327],
        ]),
      },
      {
        type: "lore",
        label: "An unclassified fossil",
        text: "Jointed in a pattern conservation's own notes describe as 'segmented, armoured, purpose unclear,' with a binomial column left blank the same way every other card in this room's founding entry leaves it — except here, nobody has ever proposed filling it in at all.",
        shape: polygon([
          [128, 252], [126, 255], [124, 258], [122, 263], [121, 269], [119, 273],
          [119, 277], [119, 282], [120, 286], [123, 290], [126, 292], [126, 294],
          [128, 297], [129, 300], [132, 303], [134, 304], [136, 307], [139, 309],
          [143, 311], [146, 311], [152, 314], [154, 317], [157, 319], [161, 319],
          [165, 319], [170, 318], [172, 318], [178, 317], [184, 317], [189, 317],
          [194, 314], [196, 310], [199, 308], [201, 307], [202, 304], [203, 302],
          [204, 297], [205, 294], [205, 292], [206, 288], [206, 285], [205, 282],
          [203, 279], [201, 276], [200, 273], [198, 275], [195, 276], [193, 276],
          [192, 273], [192, 270], [192, 265], [191, 262], [189, 259], [186, 257],
          [183, 254], [180, 253], [180, 257], [183, 258], [184, 262], [183, 265],
          [183, 268], [182, 270], [180, 267], [179, 264], [177, 262], [176, 261],
          [175, 258], [172, 255], [170, 253], [166, 252], [162, 250], [160, 248],
          [158, 245], [157, 243], [153, 246], [150, 245], [148, 246], [144, 248],
          [142, 248], [141, 251], [139, 253], [139, 256], [137, 257], [136, 260],
          [136, 264], [134, 266], [133, 269], [132, 271], [131, 273], [129, 272],
          [130, 269], [131, 267], [128, 266], [128, 264], [129, 261], [129, 258],
          [129, 256], [130, 254],
        ]),
      },
      {
        type: "lore",
        label: "A peony leaf specimen",
        text: "Pressed and dated the same careful way as its neighbours on this wall, except the leaf itself has not browned, dried, or lost a single vein of colour in the span the accession card claims it has sat here.",
        shape: polygon([
          [228, 86], [306, 100], [307, 237], [228, 229], [229, 89],
        ]),
      },
      {
        type: "lore",
        label: "Asian butterfly specimens",
        text: "Pinned in a neat grid, one species to a row, except the bottom row's labels have all been switched at some point and switched back — conservation's own notes disagree on whether this happened once or several times.",
        shape: polygon([
          [227, 245], [317, 255], [318, 404], [227, 401], [228, 249],
        ]),
      },
      {
        type: "lore",
        label: "A nautilus specimen",
        text: "Sectioned to show the chambers inside, as the type specimen for this display always is, though this particular shell's chamber count doesn't match the species card mounted directly beneath it, by a difference nobody has recounted since.",
        shape: polygon([
          [226, 413], [323, 419], [323, 525], [244, 525], [241, 522], [241, 518],
          [241, 516], [241, 512], [241, 509], [239, 507], [238, 509], [239, 512],
          [238, 515], [239, 517], [238, 520], [235, 515], [233, 512], [231, 509],
          [231, 506], [232, 501], [231, 498], [229, 499], [228, 503], [227, 416],
        ]),
      },
    ],
    // This gallery's close-up scene has no remaining way in — the one
    // object that used to point here (the gallery's "look closer" trigger)
    // was retraced and renamed into an ordinary main-scene object
    // ("Forest Sprite Cottage") instead, and this scene's own content was
    // removed along with it rather than left stranded behind a door nobody
    // can open. The scene itself still exists (every gallery's own `closeup`
    // config generates one unconditionally, independent of whether any
    // object links to it) so the world's scene graph stays uniform; its own
    // zero-object case is the one spec/world.test.ts's object-count floor
    // now explicitly allows, rather than quietly requiring every gallery to
    // keep a working door into one.
    closeupObjects: [],
  },
  {
    id: "childhood",
    name: "The Forgotten Childhood",
    category: "toy",
    accent: "#C6A16B",
    orderIndex: 3,
    image: "childhood",
    closeup: {
      image: "childhood",
      zoom: true,
      caption: "The Shelf That Waits",
      lore: "The shelf is dusted every week, the gap on the third row included, around whatever used to sit there — and whatever it was, the inventory card for that slot still bears the first curator's own initials, never crossed out.",
      closeupCamera: {
        initialPan: 28,
        minPan: 10,
        maxPan: 50,
        initialTilt: 50,
        minTilt: 40,
        maxTilt: 60,
        initialZoom: 1.6,
        minZoom: 1.4,
        maxZoom: 2.2,
      },
    },
    objects: [
      {
        type: "lore",
        label: "Look closer: The Shelf That Waits",
        text: "The shelf is dusted every week, the gap on the third row included, around whatever used to sit there — and whatever it was, the inventory card for that slot still bears the first curator's own initials, never crossed out.",
        closeupSceneId: "childhood-closeup",
        shape: polygon([[478, 112], [700, 108], [702, 243], [480, 248]]),
      },
      {
        type: "lore",
        label: "A doll on the left",
        text: "It blinks on its own schedule, roughly once an hour, always when the gallery is otherwise empty of visitors. Staff have stopped checking.",
        shape: polygon([[58, 256], [76, 257], [84, 266], [85, 278], [80, 285], [86, 294], [91, 306], [91, 316], [86, 320], [84, 335], [85, 345], [70, 349], [55, 348], [48, 335], [46, 320], [44, 308], [47, 292], [50, 280], [52, 266]]),
      },
      {
        type: "lore",
        label: "A jester doll beside the candelabra",
        text: "Its painted grin has been noted as \"unchanged\" in forty consecutive condition reports, the only item in the gallery whose file uses that exact word every time.",
        shape: polygon([[112, 296], [135, 292], [150, 298], [160, 310], [163, 322], [160, 335], [150, 345], [135, 350], [118, 350], [108, 344], [103, 332], [103, 318], [106, 306]]),
      },
      {
        type: "lore",
        label: "Mysterious Tome",
        text: "Shelved spine-out beside its plainer neighbour, as always, though no catalogue entry records a title for either one, and no curator has volunteered to open them and check. Only this one has ever been given a name at all, and nobody now on staff can say who gave it, or why only this book earned one.",
        shape: polygon([
          [283, 443], [298, 443], [355, 445], [358, 448], [354, 450], [354, 454],
          [355, 458], [355, 462], [351, 468], [365, 468], [368, 470], [366, 473],
          [367, 476], [365, 479], [366, 482], [369, 486], [368, 488], [304, 487],
          [290, 487], [290, 482], [293, 482], [294, 476], [292, 471], [290, 469],
          [287, 466], [288, 462], [289, 458], [291, 455], [288, 452], [288, 448],
          [284, 445], [284, 441],
        ]),
      },
      {
        type: "lore",
        label: "Simmons, the waiting cot",
        text: "It is turned down fresh every morning, a duty the handover log attributes to 'standing instruction, see curator's file' without naming which curator or producing the file. The nursery has had no occupant on record for longer than anyone currently on staff can confirm — only a brass plate at its foot, reading 'Simmons,' in a hand nobody has matched to a maker or a child.",
        shape: polygon([
          [1194, 317], [1197, 321], [1197, 330], [1197, 355], [1197, 367], [1196, 373], [1189, 375], [1189, 379],
          [1197, 382], [1198, 389], [1199, 397], [1198, 400], [1200, 402], [1202, 405], [1201, 408], [1201, 414],
          [1201, 448], [1201, 467], [1201, 484], [1201, 494], [1201, 504], [1201, 530], [1201, 560], [1200, 565],
          [1201, 570], [1161, 569], [1158, 579], [1153, 611], [1138, 610], [1116, 609], [1094, 610], [1091, 614],
          [1091, 620], [1090, 625], [1084, 630], [1078, 631], [1073, 631], [1072, 626], [1073, 624], [1076, 622],
          [1079, 620], [1077, 616], [1073, 612], [1069, 605], [1070, 599], [1072, 592], [1065, 595], [1061, 593],
          [1058, 601], [1055, 609], [1051, 606], [1047, 609], [1044, 609], [1046, 606], [1047, 600], [1044, 598],
          [1042, 601], [1040, 604], [1036, 607], [1036, 602], [1037, 598], [1041, 594], [1042, 586], [1044, 579],
          [1045, 574], [1046, 568], [1052, 566], [1060, 564], [1061, 561], [1063, 556], [1064, 553], [1065, 547],
          [1066, 537], [1067, 527], [1068, 519], [1068, 510], [1068, 499], [1068, 494], [1068, 488], [1068, 482],
          [1068, 477], [1065, 475], [1065, 467], [1066, 463], [1066, 457], [1068, 454], [1070, 456], [1071, 462],
          [1076, 461], [1080, 454], [1078, 448], [1081, 444], [1081, 439], [1082, 433], [1084, 439], [1085, 443],
          [1088, 444], [1091, 448], [1089, 451], [1086, 453], [1089, 458], [1090, 461], [1095, 460], [1099, 458],
          [1105, 451], [1108, 442], [1118, 426], [1130, 405], [1133, 392], [1134, 375], [1130, 370], [1133, 364],
          [1135, 358], [1134, 352], [1133, 344], [1138, 341], [1141, 337], [1146, 336], [1151, 334], [1159, 328],
          [1168, 322], [1173, 318], [1178, 312], [1179, 309], [1177, 307], [1175, 304], [1179, 300], [1180, 296],
          [1182, 288], [1185, 292], [1185, 297], [1188, 301], [1191, 303], [1189, 308], [1187, 310], [1190, 315],
        ]),
      },
      {
        type: "lore",
        label: "A castle puppet-theatre diorama",
        text: "Wound once a century, according to the plaque, though no mechanism to wind it has ever been found. It has changed scenes twice in living memory, always overnight.",
        shape: polygon([
          [307, 97], [312, 98], [315, 91], [318, 91], [319, 96], [321, 99],
          [325, 102], [329, 105], [327, 109], [322, 107], [321, 110], [323, 113],
          [328, 112], [333, 113], [337, 115], [343, 118], [348, 120], [351, 123],
          [354, 126], [356, 129], [358, 132], [362, 133], [366, 134], [369, 137],
          [371, 140], [372, 143], [374, 146], [376, 149], [379, 151], [383, 153],
          [387, 154], [390, 155], [394, 156], [398, 157], [397, 160], [394, 162],
          [391, 163], [389, 163], [389, 169], [389, 172], [389, 177], [395, 177],
          [399, 178], [403, 179], [409, 180], [405, 184], [401, 186], [399, 186],
          [399, 189], [399, 193], [397, 194], [397, 198], [397, 203], [397, 216],
          [400, 217], [397, 222], [399, 224], [399, 226], [396, 229], [396, 232],
          [395, 235], [393, 236], [396, 238], [394, 241], [397, 243], [394, 247],
          [393, 354], [396, 359], [394, 361], [391, 360], [387, 358], [221, 344],
          [176, 350], [175, 278], [175, 207], [173, 203], [175, 201], [171, 198],
          [174, 195], [174, 182], [173, 169], [167, 166], [161, 160], [168, 159],
          [175, 157], [179, 153], [177, 148], [174, 144], [175, 138], [178, 137],
          [181, 136], [181, 139], [185, 140], [192, 139], [199, 136], [201, 134],
          [207, 134], [212, 129], [216, 128], [222, 127], [223, 124], [227, 126],
          [231, 127], [235, 128], [239, 128], [243, 127], [246, 125], [249, 123],
          [254, 119], [257, 116], [262, 115], [267, 115], [269, 112], [272, 110],
          [275, 108], [280, 107], [286, 106], [292, 106], [296, 106], [300, 106],
          [299, 103], [300, 100], [303, 100], [305, 98],
        ]),
      },
      {
        type: "lore",
        label: "A rocking horse worn smooth",
        text: "Its paint is worn through at the saddle and nowhere else, in a pattern consistent with decades of riding the collection has no record of ever permitting.",
        shape: polygon([
          [51, 449], [55, 449], [60, 451], [66, 451], [72, 452], [79, 451],
          [82, 450], [81, 445], [83, 441], [87, 438], [91, 436], [94, 431],
          [95, 427], [97, 422], [102, 418], [105, 419], [108, 417], [109, 413],
          [112, 407], [119, 405], [120, 400], [121, 396], [125, 393], [131, 391],
          [133, 390], [135, 387], [135, 383], [137, 380], [141, 380], [146, 377],
          [147, 375], [152, 375], [153, 372], [158, 372], [160, 369], [163, 367],
          [168, 366], [174, 365], [176, 364], [179, 366], [183, 365], [187, 363],
          [189, 363], [191, 365], [193, 362], [196, 361], [200, 363], [203, 364],
          [209, 367], [213, 367], [217, 370], [219, 368], [223, 373], [227, 372],
          [230, 371], [232, 368], [235, 366], [238, 368], [237, 371], [232, 378],
          [235, 378], [238, 380], [241, 381], [244, 377], [245, 379], [244, 381],
          [243, 384], [240, 385], [243, 388], [241, 391], [243, 393], [244, 396],
          [245, 401], [244, 405], [243, 409], [245, 414], [244, 419], [244, 422],
          [242, 413], [240, 410], [238, 407], [236, 403], [236, 407], [236, 410],
          [238, 412], [235, 417], [233, 422], [233, 425], [232, 429], [232, 431],
          [232, 435], [234, 438], [234, 441], [233, 443], [233, 446], [233, 449],
          [233, 452], [232, 456], [231, 458], [227, 462], [224, 464], [218, 465],
          [216, 464], [215, 461], [215, 457], [216, 453], [213, 448], [212, 452],
          [211, 455], [211, 458], [212, 461], [213, 465], [209, 464], [204, 460],
          [204, 455], [206, 451], [207, 447], [204, 447], [203, 449], [202, 446],
          [202, 442], [201, 439], [199, 435], [195, 432], [192, 429], [190, 428],
          [187, 430], [186, 435], [183, 441], [181, 448], [181, 453], [180, 457],
          [178, 464], [177, 467], [175, 470], [175, 474], [177, 477], [180, 480],
          [181, 484], [182, 488], [182, 492], [181, 495], [180, 500], [179, 503],
          [177, 507], [177, 511], [175, 513], [177, 516], [181, 518], [185, 519],
          [188, 519], [191, 520], [192, 522], [196, 527], [197, 533], [197, 538],
          [199, 541], [201, 548], [203, 551], [205, 554], [207, 558], [210, 562],
          [213, 566], [215, 571], [215, 575], [215, 578], [216, 580], [218, 581],
          [221, 585], [222, 587], [224, 591], [224, 595], [223, 599], [223, 602],
          [221, 604], [217, 605], [211, 603], [206, 594], [202, 594], [202, 589],
          [204, 585], [204, 582], [202, 579], [199, 581], [198, 578], [197, 575],
          [196, 572], [195, 566], [192, 558], [189, 552], [186, 548], [184, 545],
          [180, 543], [178, 540], [176, 537], [170, 536], [166, 536], [162, 535],
          [161, 540], [161, 543], [163, 548], [164, 551], [166, 555], [168, 559],
          [168, 561], [169, 564], [171, 567], [173, 570], [179, 569], [184, 569],
          [188, 571], [191, 574], [193, 577], [194, 581], [192, 585], [190, 587],
          [188, 588], [186, 591], [182, 593], [180, 594], [177, 597], [175, 598],
          [171, 599], [172, 603], [172, 606], [176, 606], [181, 606], [185, 607],
          [185, 610], [182, 610], [176, 610], [169, 610], [158, 611], [152, 611],
          [146, 612], [141, 612], [137, 612], [133, 612], [129, 613], [119, 612],
          [111, 611], [101, 609], [92, 605], [89, 603], [84, 601], [81, 605],
          [79, 607], [74, 610], [69, 610], [67, 605], [67, 598], [66, 589],
          [66, 585], [63, 581], [64, 577], [64, 565], [62, 561], [62, 553],
          [61, 548], [60, 542], [60, 536], [59, 523], [58, 515], [57, 506],
          [56, 499], [55, 489], [54, 475], [52, 467], [52, 460], [51, 455],
          [50, 451],
        ]),
      },
      {
        type: "lore",
        label: "A boy doll in the niche",
        text: "Standing in the same recessed arch for every inventory photograph on file, hat and collar square, though nothing in the records says he was ever posed that way on purpose.",
        shape: polygon([
          [699, 157], [701, 162], [701, 166], [704, 167], [708, 173], [708, 178],
          [714, 179], [718, 183], [716, 188], [718, 191], [713, 195], [711, 200],
          [707, 198], [706, 203], [706, 209], [715, 212], [713, 217], [719, 225],
          [721, 230], [727, 234], [731, 239], [732, 244], [731, 249], [735, 254],
          [737, 258], [740, 263], [740, 268], [742, 275], [743, 283], [737, 279],
          [730, 285], [719, 289], [725, 298], [726, 301], [722, 306], [713, 304],
          [702, 303], [691, 302], [679, 301], [677, 297], [681, 293], [682, 287],
          [677, 284], [671, 280], [666, 281], [655, 281], [655, 272], [656, 263],
          [661, 262], [661, 256], [657, 256], [654, 252], [656, 248], [657, 244],
          [657, 236], [658, 231], [656, 227], [661, 222], [666, 221], [669, 218],
          [670, 214], [671, 210], [672, 205], [677, 203], [681, 201], [679, 194],
          [674, 190], [670, 185], [672, 183], [672, 175], [676, 174], [683, 174],
          [686, 170], [690, 168], [696, 167], [696, 161],
        ]),
      },
      {
        type: "lore",
        label: "Small horse figurine",
        text: "Smaller than either rocking horse in the room, and the only one of the three never once logged as moved, cleaned, or repaired.",
        shape: polygon([
          [732, 331], [733, 337], [735, 343], [737, 349], [739, 355], [731, 357], [727, 356], [725, 352],
          [724, 357], [725, 361], [725, 368], [723, 374], [731, 373], [735, 376], [735, 383], [732, 391],
          [731, 398], [735, 398], [738, 399], [738, 407], [737, 413], [701, 411], [671, 410], [667, 407],
          [665, 404], [665, 398], [659, 397], [660, 391], [661, 386], [661, 382], [663, 376], [668, 372],
          [663, 370], [659, 369], [657, 367], [657, 361], [658, 353], [660, 348], [665, 352], [668, 356],
          [674, 354], [673, 349], [668, 341], [669, 338], [674, 337], [676, 336], [678, 339], [681, 342],
          [685, 342], [690, 345], [692, 352], [701, 354], [707, 346], [709, 338], [716, 332], [720, 330],
          [725, 327], [728, 330],
        ]),
      },
      {
        type: "lore",
        label: "A second rocking horse, deeper in the cabinet",
        text: "Identical to the one nearer the door, down to the same worn saddle patch, though the ledger lists only a single horse ever acquired — the first curator's own handwriting, re-entering the same acquisition twice, a year apart, as though the first entry had been forgotten rather than corrected.",
        shape: polygon([
          [1018, 611], [1011, 612], [1010, 609], [1005, 602], [1002, 604], [1003, 610], [999, 610], [998, 606],
          [998, 601], [998, 598], [995, 601], [989, 603], [978, 603], [972, 605], [965, 604], [954, 605],
          [943, 605], [939, 603], [933, 599], [929, 597], [925, 593], [921, 593], [916, 590], [916, 584],
          [915, 579], [916, 576], [917, 572], [922, 569], [919, 567], [920, 563], [917, 560], [911, 559],
          [907, 554], [906, 549], [905, 545], [910, 547], [915, 551], [917, 547], [918, 542], [921, 533],
          [925, 526], [929, 518], [928, 511], [927, 506], [930, 498], [928, 494], [929, 490], [928, 486],
          [929, 482], [928, 476], [925, 479], [922, 481], [920, 484], [916, 488], [915, 482], [913, 486],
          [911, 487], [907, 481], [911, 473], [913, 468], [913, 462], [916, 457], [917, 451], [915, 446],
          [919, 448], [923, 451], [924, 444], [930, 450], [938, 450], [943, 455], [947, 457], [951, 464],
          [955, 469], [957, 475], [958, 479], [964, 482], [965, 487], [970, 489], [973, 488], [976, 489],
          [980, 488], [985, 487], [992, 487], [996, 489], [1003, 491], [1010, 495], [1013, 501], [1015, 505],
          [1015, 515], [1014, 520], [1018, 527], [1018, 533], [1010, 532], [1012, 542], [1013, 548], [1014, 551],
          [1024, 547], [1030, 551], [1028, 557], [1022, 560], [1018, 561], [1014, 563], [1009, 567], [1006, 569],
          [1011, 572], [1010, 578], [1010, 582], [1017, 586], [1019, 598], [1010, 599], [1014, 606],
        ]),
      },
      {
        type: "lore",
        label: "A miniature chapel beneath a glass dome",
        text: "The candle behind its little window has burned at exactly the same height in every photograph on file, going back further than the glass itself has been catalogued.",
        shape: polygon([
          [283, 498], [281, 503], [276, 506], [274, 509], [276, 514], [278, 517],
          [277, 520], [272, 522], [265, 522], [258, 525], [252, 527], [244, 531],
          [236, 538], [232, 544], [228, 550], [225, 558], [224, 564], [223, 570],
          [223, 659], [231, 660], [237, 660], [248, 660], [260, 661], [270, 661],
          [284, 662], [296, 662], [309, 661], [320, 660], [335, 660], [345, 659],
          [344, 568], [344, 561], [342, 555], [339, 549], [335, 542], [329, 535],
          [323, 531], [316, 528], [307, 524], [295, 523], [288, 521], [287, 516],
          [292, 510], [290, 507], [286, 504], [285, 500],
        ]),
      },
      {
        type: "lore",
        label: "An elegant ballerina doll beneath the moon window",
        text: "She completes one full turn for every visitor who pauses here, never more, never fewer, by a count nobody has admitted to keeping — though she stands beside the globed music box in the far corner, not inside it, and no mechanism anyone has found connects the two.",
        shape: polygon([
          [1421, 315], [1424, 313], [1428, 312], [1431, 314], [1433, 317], [1432, 319],
          [1430, 321], [1428, 325], [1428, 327], [1432, 328], [1434, 328], [1435, 330],
          [1436, 332], [1437, 335], [1438, 337], [1439, 340], [1440, 342], [1443, 342],
          [1445, 343], [1449, 345], [1448, 346], [1445, 346], [1442, 345], [1440, 344],
          [1437, 344], [1436, 340], [1435, 337], [1434, 334], [1433, 332], [1432, 336],
          [1432, 338], [1432, 342], [1434, 344], [1445, 347], [1451, 351], [1453, 355],
          [1451, 357], [1449, 359], [1447, 360], [1444, 361], [1441, 362], [1438, 363],
          [1433, 364], [1434, 368], [1434, 371], [1434, 375], [1435, 377], [1435, 381],
          [1435, 384], [1434, 387], [1434, 393], [1434, 396], [1435, 401], [1435, 404],
          [1437, 406], [1440, 406], [1442, 410], [1435, 411], [1426, 411], [1420, 411],
          [1415, 411], [1411, 412], [1411, 409], [1413, 406], [1418, 406], [1420, 403],
          [1422, 401], [1422, 396], [1422, 391], [1420, 384], [1421, 381], [1422, 377],
          [1421, 371], [1421, 366], [1421, 364], [1418, 364], [1412, 363], [1408, 361],
          [1405, 358], [1403, 356], [1401, 354], [1403, 351], [1406, 349], [1408, 348],
          [1407, 343], [1410, 344], [1414, 341], [1415, 338], [1416, 336], [1416, 333],
          [1417, 330], [1418, 328], [1421, 327], [1424, 326], [1425, 323], [1423, 321],
          [1420, 317],
        ]),
      },
      {
        type: "lore",
        label: "Box of Nightfall",
        text: "The case is etched with a crescent moon, not painted, and always a little warmer to the touch than the glass around it, by a margin conservation can measure but not explain. No catalogue entry says what the box was built to hold, only that it has never once been logged open.",
        shape: polygon([[1213, 232], [1267, 221], [1268, 351], [1213, 359], [1213, 236]]),
      },
      {
        type: "lore",
        label: "Mysterious Candlestick",
        text: "Its candles have never been lit, and never collect dust either, in a room where every other surface keeps a thin coat of it faithfully. No maker's mark is stamped anywhere on the base, and no acquisition record explains how it came to stand here at all.",
        shape: polygon([
          [783, 407], [821, 407], [821, 416], [821, 425], [822, 446], [824, 468], [825, 482], [827, 500],
          [826, 515], [821, 515], [814, 518], [798, 518], [787, 516], [783, 513], [783, 500], [783, 488],
          [783, 464], [783, 442], [783, 423], [783, 415],
        ]),
      },
      {
        type: "lore",
        label: "A vase of peacock feathers",
        text: "Replaced each season from a bird nobody on staff has ever been asked to locate. The feathers never fade, and the vase has never once needed water.",
        shape: polygon([[1225, 405], [1245, 395], [1265, 398], [1280, 410], [1290, 440], [1292, 470], [1295, 500], [1290, 520], [1278, 535], [1260, 540], [1240, 538], [1222, 530], [1212, 515], [1208, 490], [1210, 460], [1215, 430]]),
      },
      {
        type: "lore",
        label: "A cloisonné globe on the upper shelf",
        text: "No country on its surface matches a map conservation has been able to find, in any atlas from any year it could plausibly have been made.",
        shape: polygon([[1585, 150], [1600, 145], [1615, 148], [1624, 160], [1626, 175], [1622, 190], [1610, 200], [1595, 200], [1584, 192], [1580, 178], [1580, 163]]),
      },
      {
        type: "lore",
        label: "The Three Musketeers theatre box, upper shelf",
        text: "Three painted figures freeze mid-duel behind its glass, smaller than the castle diorama by the door, kept dark behind their own curtain — no visitor has reported the curtain open, though no photograph shows it being drawn shut either.",
        shape: polygon([
          [1540, 84], [1534, 95], [1526, 105], [1516, 117], [1504, 122], [1499, 113],
          [1498, 122], [1495, 129], [1499, 136], [1499, 146], [1500, 198], [1499, 219],
          [1492, 229], [1540, 222], [1585, 217], [1594, 209], [1601, 205], [1600, 201],
          [1599, 191], [1596, 188], [1592, 181], [1593, 173], [1594, 165], [1598, 157],
          [1597, 147], [1598, 131], [1601, 117], [1584, 103], [1578, 112], [1567, 109],
          [1557, 102], [1543, 90],
        ]),
      },
      {
        type: "lore",
        label: "The Little World theatre box, lower shelf",
        text: "A whole miniature drama is staged inside — a dozen figures, a painted sky — yet its curtain is always drawn exactly halfway, in every condition report since the box was acquired, regardless of who last checked it or when.",
        shape: polygon([
          [1503, 266], [1498, 268], [1494, 270], [1490, 271], [1484, 274], [1478, 277],
          [1475, 278], [1471, 275], [1468, 275], [1466, 277], [1463, 281], [1461, 284],
          [1455, 285], [1462, 291], [1464, 297], [1464, 301], [1463, 304], [1464, 308],
          [1464, 312], [1465, 316], [1465, 356], [1463, 358], [1464, 362], [1463, 365],
          [1465, 369], [1462, 372], [1462, 377], [1449, 379], [1450, 384], [1454, 387],
          [1454, 391], [1454, 395], [1456, 402], [1453, 406], [1453, 408], [1457, 408],
          [1462, 408], [1467, 409], [1472, 408], [1477, 407], [1481, 407], [1485, 404],
          [1490, 404], [1496, 403], [1500, 405], [1505, 405], [1510, 406], [1516, 404],
          [1519, 404], [1524, 403], [1527, 401], [1531, 402], [1534, 402], [1538, 401],
          [1541, 401], [1545, 400], [1548, 401], [1550, 403], [1551, 405], [1559, 404],
          [1570, 403], [1571, 398], [1576, 397], [1576, 382], [1576, 378], [1574, 375],
          [1575, 373], [1579, 371], [1583, 370], [1586, 371], [1590, 370], [1593, 370],
          [1597, 367], [1600, 365], [1601, 347], [1596, 348], [1594, 347], [1592, 345],
          [1593, 337], [1595, 331], [1593, 328], [1594, 323], [1597, 317], [1598, 309],
          [1599, 301], [1600, 295], [1602, 292], [1605, 291], [1606, 289], [1606, 286],
          [1606, 283], [1603, 282], [1602, 280], [1603, 277], [1595, 277], [1592, 274],
          [1588, 271], [1582, 267], [1578, 267], [1581, 264], [1578, 262], [1576, 264],
          [1575, 269], [1571, 269], [1566, 267], [1560, 264], [1555, 263], [1548, 264],
          [1543, 263], [1543, 258], [1541, 256], [1536, 255], [1533, 256], [1532, 254],
          [1527, 254], [1523, 250], [1520, 253], [1517, 254], [1514, 257], [1514, 260],
          [1511, 259], [1509, 259], [1506, 260], [1504, 261],
        ]),
      },
      {
        type: "lore",
        label: "A dark trunk bound in gilt",
        text: "Logged in every inventory as 'empty, pending contents' — the first curator's own phrase, unchanged for as long as the gallery has existed, and the same word, 'pending,' that recurs in the specimen gallery's own founding entry.",
        shape: polygon([[533, 626], [578, 623], [582, 633], [580, 650], [585, 655], [582, 665], [580, 695], [578, 703], [568, 710], [540, 712], [530, 705], [528, 695], [530, 665], [527, 655], [530, 648], [528, 633]]),
      },
      {
        type: "lore",
        label: "A travelling case, never fully unpacked",
        text: "The painted scene on its lid changes very slightly between inventories — a window open that was shut, a figure a few steps further along a path — never enough that two staff members agree it happened at all. Its latches are never found locked, though no visitor has reported finding it open either.",
        shape: polygon([
          [722, 593], [722, 677], [786, 681], [832, 675], [831, 593], [792, 591], [792, 557], [766, 555],
          [740, 556], [740, 592], [724, 592],
        ]),
      },
      {
        type: "lore",
        label: "A jeweled music box, globed in gold",
        text: "It plays a lullaby nobody has been able to name, in a key no two listeners transcribe the same way.",
        shape: ellipse(188, 685, 40, 49),
      },
      {
        type: "lore",
        label: "The worn teddy bear on the shelf",
        text: "Seated in the same spot every morning regardless of who last moved it the evening before — staff have stopped noting it in the handover log.",
        shape: polygon([
          [563, 414], [565, 417], [568, 419], [572, 415], [578, 416], [585, 416],
          [589, 419], [593, 421], [597, 418], [601, 418], [603, 421], [607, 424],
          [610, 427], [610, 431], [609, 435], [605, 438], [600, 440], [599, 446],
          [597, 449], [594, 452], [598, 456], [603, 461], [606, 467], [608, 473],
          [611, 479], [613, 482], [612, 488], [610, 490], [606, 492], [601, 493],
          [603, 498], [606, 502], [606, 507], [602, 511], [599, 512], [597, 513],
          [593, 509], [591, 505], [586, 508], [583, 508], [582, 501], [579, 496],
          [583, 494], [585, 490], [581, 486], [575, 487], [571, 486], [567, 483],
          [559, 479], [551, 479], [543, 477], [542, 473], [540, 469], [543, 466],
          [547, 461], [553, 459], [555, 456], [562, 453], [560, 447], [557, 442],
          [558, 438], [558, 434], [555, 432], [553, 429], [553, 425], [553, 420],
          [555, 417], [558, 416], [560, 415],
        ]),
      },
      {
        type: "lore",
        label: "Little Carousel",
        text: "Its twin sits sealed under glass nearby; this one has no dome at all, and turns exactly as slowly, exactly as unexplainably. A paper tag wired to its base reads only the diminutive by which staff have always called it — no maker's mark, no acquisition date, nothing to explain why the name stuck.",
        shape: polygon([
          [606, 347], [611, 347], [611, 353], [601, 350], [584, 349], [576, 349],
          [557, 349], [550, 349], [541, 349], [531, 350], [527, 344], [526, 339],
          [527, 313], [526, 306], [522, 303], [522, 297], [521, 291], [527, 291],
          [532, 290], [538, 289], [543, 287], [551, 282], [560, 277], [563, 273],
          [565, 268], [566, 265], [568, 261], [570, 265], [571, 268], [573, 272],
          [571, 272], [573, 275], [576, 278], [583, 282], [590, 287], [599, 292],
          [604, 291], [607, 292], [611, 296], [610, 302], [609, 306], [607, 306],
          [606, 317],
        ]),
      },
      {
        type: "lore",
        label: "A carousel music box, domed on the far cabinet",
        text: "It plays nothing — the cylinder inside has no pins left to pluck — yet the horses still turn beneath the dome, on no schedule the other two carousels share, as though the tune were no longer the point of winding it.",
        shape: polygon([
          [1553, 543], [1550, 550], [1550, 555], [1545, 559], [1547, 566], [1548, 570],
          [1544, 574], [1534, 575], [1521, 579], [1512, 585], [1505, 591], [1499, 599],
          [1493, 607], [1488, 619], [1486, 627], [1486, 638], [1486, 716], [1498, 717],
          [1510, 720], [1519, 721], [1528, 724], [1537, 725], [1548, 727], [1558, 729],
          [1567, 731], [1572, 731], [1588, 731], [1596, 731], [1607, 729], [1602, 725],
          [1600, 719], [1606, 716], [1612, 715], [1618, 711], [1618, 698], [1615, 695],
          [1613, 691], [1613, 688], [1615, 686], [1618, 686], [1620, 685], [1621, 641],
          [1619, 627], [1617, 616], [1612, 605], [1606, 597], [1600, 590], [1590, 584],
          [1583, 581], [1574, 578], [1568, 576], [1563, 574], [1558, 572], [1558, 567],
          [1560, 565], [1563, 560], [1557, 556], [1556, 551], [1554, 543],
        ]),
      },
      {
        type: "lore",
        label: "A doll behind the cabinet glass",
        text: "No accession card names a maker or a date — only a note that it was found already in this cabinet during an inventory nobody now on staff was present for, and that nobody has since proposed moving it anywhere else.",
        shape: polygon([
          [1329, 500], [1328, 495], [1328, 488], [1331, 479], [1334, 474], [1341, 470], [1351, 473],
          [1354, 477], [1357, 480], [1358, 492], [1358, 501], [1358, 509], [1358, 518], [1356, 525],
          [1354, 530], [1352, 534], [1350, 542], [1348, 549], [1345, 553], [1343, 559], [1337, 559],
          [1328, 559], [1320, 557], [1314, 553], [1313, 549], [1314, 542], [1315, 535], [1317, 526],
          [1320, 518], [1324, 508], [1321, 507], [1321, 503], [1326, 501],
        ]),
      },
      {
        type: "lore",
        label: "A music box shaped like a nursery",
        text: "Wind the key and nothing plays — conservation has confirmed the mechanism is sound — yet staff on the early shift report hearing it anyway, always the same few bars, never from this box when they come to check.",
        shape: polygon([
          [1392, 718], [1395, 728], [1395, 759], [1392, 760], [1392, 766], [1388, 771],
          [1390, 776], [1396, 778], [1401, 779], [1405, 780], [1407, 773], [1426, 782],
          [1428, 787], [1428, 791], [1430, 793], [1434, 793], [1445, 795], [1446, 785],
          [1517, 788], [1525, 798], [1536, 798], [1536, 792], [1531, 789], [1554, 789],
          [1557, 791], [1562, 792], [1565, 790], [1566, 741], [1566, 731], [1522, 721],
          [1492, 717], [1481, 714], [1470, 714], [1471, 710], [1471, 707], [1472, 704],
          [1476, 704], [1479, 703], [1482, 699], [1484, 696], [1487, 693], [1484, 690],
          [1482, 687], [1480, 685], [1477, 684], [1478, 682], [1481, 679], [1483, 677],
          [1485, 674], [1483, 674], [1479, 673], [1481, 669], [1481, 666], [1471, 665],
          [1463, 658], [1460, 663], [1455, 666], [1454, 674], [1453, 680], [1450, 683],
          [1446, 687], [1445, 691], [1445, 696], [1450, 697], [1455, 697], [1457, 699],
          [1460, 703], [1461, 707], [1460, 712], [1456, 715], [1394, 717],
        ]),
      },
      {
        type: "lore",
        label: "A child's daybed, turned down",
        text: "Linen pressed flat, corners squared the same way every morning — the same standing instruction the handover log cites for the nursery cot across the room, though this daybed appears on no furnishing inventory the museum can produce.",
        shape: polygon([
          [1254, 745], [1248, 745], [1243, 747], [1239, 750], [1232, 751], [1179, 759],
          [1160, 763], [1142, 766], [1123, 772], [1115, 774], [1110, 778], [1110, 784],
          [1111, 793], [1104, 794], [1104, 801], [1101, 806], [1102, 813], [1102, 819],
          [1105, 824], [1105, 846], [1102, 850], [1104, 855], [1110, 856], [1113, 860],
          [1112, 865], [1110, 869], [1108, 873], [1110, 877], [1112, 881], [1122, 882],
          [1126, 879], [1129, 875], [1128, 869], [1126, 866], [1127, 864], [1130, 863],
          [1216, 884], [1217, 890], [1215, 893], [1216, 895], [1220, 897], [1219, 901],
          [1218, 905], [1220, 909], [1225, 911], [1234, 911], [1237, 908], [1242, 905],
          [1243, 903], [1245, 903], [1248, 902], [1248, 899], [1248, 895], [1249, 893],
          [1246, 892], [1244, 891], [1242, 889], [1250, 885], [1251, 876], [1252, 870],
          [1252, 864], [1253, 859], [1254, 854], [1254, 850], [1255, 847], [1255, 844],
          [1255, 841], [1255, 837], [1254, 834], [1250, 832], [1249, 830], [1255, 827],
          [1256, 825], [1256, 822], [1258, 819], [1259, 817], [1259, 812], [1261, 808],
          [1261, 804], [1262, 801], [1262, 798], [1259, 795], [1256, 793], [1254, 790],
          [1252, 785], [1253, 781], [1255, 776], [1258, 774], [1260, 772], [1263, 771],
          [1267, 768], [1270, 766], [1274, 765], [1277, 764], [1278, 762], [1280, 760],
          [1283, 760], [1286, 758], [1290, 757], [1294, 756], [1297, 754], [1300, 753],
          [1293, 751], [1287, 750], [1281, 750], [1278, 748], [1276, 748], [1273, 747],
          [1270, 746], [1267, 746], [1265, 747], [1263, 744], [1260, 745], [1257, 746],
        ]),
      },
      {
        type: "lore",
        label: "A cabinet door, carved in matching patterns",
        text: "The pattern repeats on every door in this cabinet except one, whose carving runs a half-turn out of step with its neighbours — a joiner's mistake, conservation's file suggests, though the same file also notes the mismatch was never corrected in over a century of repair.",
        shape: polygon([
          [1222, 592], [1222, 699], [1300, 703], [1301, 669], [1297, 667], [1297, 659],
          [1301, 656], [1302, 598], [1224, 596],
        ]),
      },
      {
        type: "lore",
        label: "A painting of an otherworldly realm",
        text: "No gallery record names the artist, the sitter, or the place depicted — only a loan date and a return date that is the same day, as if it travelled here and back within a single afternoon that nobody on staff remembers happening.",
        shape: polygon([
          [1450, 579], [1455, 469], [1555, 468], [1553, 535], [1546, 538], [1539, 543],
          [1537, 550], [1535, 557], [1538, 562], [1540, 566], [1538, 571], [1536, 576],
          [1529, 577], [1520, 580], [1516, 583], [1507, 589], [1502, 596], [1498, 600],
          [1495, 605], [1485, 604], [1471, 603], [1467, 603], [1457, 604], [1454, 600],
          [1450, 597], [1451, 592], [1452, 588], [1451, 584],
        ]),
      },
      {
        type: "lore",
        label: "An exotic dagger, sheathed on its stand",
        text: "The sheath carries an inscription in a script the museum's own linguists have never agreed how to read, let alone translate — three separate attempts are on file, none citing the other two, each confident it is the first.",
        shape: polygon([
          [1605, 438], [1600, 439], [1595, 439], [1590, 443], [1587, 449], [1585, 456],
          [1584, 463], [1584, 469], [1585, 474], [1587, 478], [1591, 482], [1594, 484],
          [1598, 485], [1603, 484], [1607, 481], [1606, 478], [1612, 474], [1617, 477],
          [1621, 476], [1623, 480], [1620, 482], [1618, 485], [1616, 489], [1614, 492],
          [1611, 492], [1607, 489], [1605, 491], [1611, 496], [1615, 497], [1622, 498],
          [1622, 509], [1618, 511], [1613, 511], [1609, 511], [1604, 510], [1599, 511],
          [1597, 514], [1592, 514], [1588, 509], [1593, 507], [1590, 505], [1587, 504],
          [1581, 500], [1577, 494], [1572, 488], [1570, 481], [1569, 472], [1571, 463],
          [1572, 456], [1576, 450], [1579, 444], [1585, 440], [1590, 437], [1596, 436],
          [1600, 436],
        ]),
      },
      {
        type: "lore",
        label: "Duke Doll",
        text: "Dressed for a court that never sat for him, in a coat one conservator catalogued as 'ducal, pattern unknown.' The name on his base plate matches no record of nobility the museum has been able to trace, and nobody currently on staff remembers who first called him that.",
        shape: polygon([
          [1341, 315], [1350, 317], [1354, 319], [1355, 322], [1356, 331], [1354, 334], [1353, 340],
          [1358, 342], [1358, 347], [1357, 355], [1358, 395], [1356, 399], [1354, 400], [1349, 403],
          [1343, 406], [1336, 408], [1331, 409], [1327, 409], [1323, 407], [1323, 403], [1326, 402],
          [1326, 398], [1322, 394], [1325, 387], [1326, 385], [1325, 380], [1324, 377], [1319, 380],
          [1319, 387], [1313, 390], [1312, 388], [1307, 385], [1307, 381], [1306, 376], [1306, 373],
          [1308, 369], [1313, 364], [1319, 355], [1322, 351], [1321, 345], [1329, 343], [1337, 340],
          [1334, 338], [1331, 335], [1332, 331], [1331, 326], [1329, 326], [1326, 325], [1330, 319],
          [1334, 316], [1337, 315],
        ]),
      },
      {
        type: "lore",
        label: "Silk Fabric and a Cabinet",
        text: "The cabinet itself is unremarkable; the bolt of silk draped over it is not supposed to be here at all, by every furnishing inventory the gallery has on file. It has never been catalogued, never been dated, and never once been folded the same way twice between a staff member's shifts.",
        shape: polygon([
          [848, 550], [853, 548], [857, 546], [868, 543], [874, 543], [880, 541], [884, 539], [889, 538],
          [894, 541], [896, 544], [900, 545], [904, 546], [905, 555], [913, 560], [919, 561], [918, 568],
          [917, 572], [915, 579], [917, 585], [916, 591], [922, 595], [920, 601], [923, 605], [921, 609],
          [921, 617], [923, 624], [923, 630], [919, 633], [916, 638], [913, 635], [910, 632], [910, 639],
          [910, 643], [913, 645], [915, 652], [916, 664], [906, 666], [903, 659], [890, 661], [889, 669],
          [871, 669], [871, 661], [856, 660], [855, 664], [851, 666], [851, 594], [846, 570], [846, 563],
          [846, 557],
        ]),
      },
      {
        type: "lore",
        label: "Carousel",
        text: "Wound once and never again, according to the plaque, though it still turns a full revolution every hour on the hour, closely enough to a clock that two separate staff members have set their watches by it without admitting why.",
        shape: polygon([
          [700, 419], [702, 423], [704, 425], [702, 428], [707, 430], [704, 433], [704, 437], [711, 442],
          [716, 447], [717, 450], [720, 452], [726, 458], [732, 464], [739, 467], [743, 463], [745, 466],
          [747, 468], [750, 472], [750, 483], [749, 486], [745, 487], [745, 498], [745, 510], [747, 514],
          [747, 518], [746, 521], [746, 526], [746, 533], [749, 534], [750, 538], [750, 542], [728, 542],
          [707, 542], [693, 543], [690, 544], [674, 543], [656, 543], [657, 537], [658, 533], [656, 525],
          [656, 486], [655, 477], [655, 469], [659, 468], [669, 465], [676, 458], [684, 451], [686, 447],
          [685, 443], [690, 443], [696, 436], [697, 432], [693, 431], [698, 428], [699, 423],
        ]),
      },
      {
        type: "lore",
        label: "A mysterious feather, mounted alone",
        text: "No bird on record matches the barb pattern, and the mounting card gives no species — only a date, in the same hand that left the vase of peacock feathers nearby unquestioned for a hundred years.",
        shape: polygon([
          [1257, 503], [1254, 506], [1247, 510], [1243, 515], [1239, 519], [1238, 523],
          [1238, 556], [1239, 561], [1311, 560], [1313, 539], [1311, 522], [1306, 511],
          [1300, 505], [1301, 501], [1295, 500], [1294, 498], [1298, 497], [1302, 496],
          [1306, 499], [1311, 502], [1312, 495], [1315, 495], [1319, 496], [1323, 496],
          [1322, 492], [1320, 487], [1324, 486], [1328, 486], [1329, 483], [1328, 481],
          [1333, 478], [1333, 472], [1336, 470], [1338, 467], [1341, 469], [1345, 469],
          [1342, 464], [1347, 463], [1344, 458], [1351, 461], [1353, 456], [1360, 449],
          [1355, 445], [1349, 441], [1358, 441], [1366, 443], [1372, 435], [1367, 435],
          [1356, 429], [1371, 430], [1373, 427], [1359, 422], [1362, 421], [1374, 421],
          [1377, 417], [1380, 411], [1380, 407], [1383, 407], [1386, 403], [1383, 402],
          [1382, 399], [1388, 397], [1385, 396], [1382, 395], [1378, 394], [1370, 395],
          [1361, 397], [1351, 400], [1348, 402], [1344, 405], [1340, 405], [1336, 407],
          [1330, 409], [1322, 417], [1319, 422], [1318, 418], [1315, 416], [1316, 422],
          [1312, 428], [1309, 426], [1304, 431], [1300, 432], [1298, 436], [1295, 432],
          [1295, 427], [1295, 421], [1297, 414], [1295, 411], [1292, 411], [1286, 414],
          [1283, 418], [1281, 424], [1277, 428], [1275, 431], [1275, 434], [1266, 426],
          [1259, 422], [1253, 420], [1248, 418], [1242, 417], [1238, 418], [1241, 424],
          [1241, 430], [1242, 437], [1248, 436], [1253, 436], [1258, 437], [1251, 439],
          [1248, 440], [1248, 444], [1249, 447], [1253, 450], [1251, 453], [1251, 456],
          [1255, 457], [1255, 462], [1256, 465], [1258, 468], [1252, 465], [1248, 461],
          [1243, 462], [1236, 462], [1236, 464], [1234, 466], [1232, 469], [1234, 472],
          [1231, 475], [1228, 477], [1233, 478], [1237, 478], [1234, 482], [1232, 487],
          [1236, 491], [1240, 490], [1244, 488], [1249, 487], [1252, 487], [1248, 493],
          [1253, 490], [1255, 493], [1256, 496], [1255, 498], [1255, 502],
        ]),
      },
      {
        type: "lore",
        label: "A doll dressed for midnight",
        text: "Gowned in black rather than the pale christening white every other doll in this gallery wears, with a base plate reading only 'for the late hour' — no maker, no date, and no later entry in any inventory explaining what hour that was meant to be, or why a nursery would want one marked out at all.",
        shape: polygon([
          [525, 155], [522, 157], [520, 160], [520, 165], [517, 168], [518, 170],
          [516, 175], [519, 179], [524, 180], [520, 182], [520, 185], [516, 188],
          [515, 192], [512, 194], [511, 197], [509, 199], [507, 202], [508, 205],
          [510, 208], [508, 210], [505, 211], [506, 214], [509, 217], [512, 217],
          [509, 223], [507, 227], [504, 233], [505, 238], [508, 241], [513, 242],
          [517, 241], [521, 243], [527, 243], [533, 244], [538, 244], [541, 244],
          [545, 243], [545, 247], [549, 247], [549, 243], [553, 244], [556, 244],
          [558, 246], [561, 248], [562, 246], [564, 245], [568, 244], [565, 239],
          [565, 236], [563, 233], [562, 228], [559, 221], [558, 217], [561, 219],
          [563, 220], [566, 219], [565, 216], [562, 212], [560, 209], [564, 208],
          [562, 205], [560, 203], [557, 199], [554, 194], [551, 189], [551, 186],
          [549, 185], [552, 183], [552, 180], [554, 177], [556, 175], [552, 171],
          [555, 168], [552, 167], [552, 162], [547, 154], [546, 158], [543, 153],
          [541, 156], [537, 154], [534, 152], [531, 153], [527, 154],
        ]),
      },
      {
        type: "lore",
        label: "A nesting doll, never fully opened",
        text: "Each shell comes apart to reveal a smaller one inside, as the type always does — except the innermost figure here has never been found, by any conservator who has tried the full set apart, and the museum's own records list the piece as 'complete' regardless.",
        shape: polygon([
          [589, 208], [587, 212], [587, 215], [584, 219], [583, 222], [586, 226],
          [589, 221], [590, 225], [583, 228], [579, 229], [578, 230], [574, 234],
          [571, 240], [571, 245], [571, 250], [581, 251], [587, 251], [590, 250],
          [591, 253], [596, 253], [599, 254], [605, 255], [608, 254], [610, 246],
          [612, 241], [611, 237], [609, 234], [605, 230], [601, 228], [600, 227],
          [603, 226], [605, 227], [608, 225], [608, 221], [610, 219], [610, 214],
          [609, 211], [607, 211], [605, 214], [602, 213], [599, 211], [598, 208],
          [595, 208], [593, 211], [591, 210],
        ]),
      },
      {
        type: "lore",
        label: "Pressed flowers, still blooming",
        text: "Dried and mounted the same way every herbarium sheet in this collection is, except these have not faded in the hundred-odd years since the accession card says they were cut — a detail conservation has measured and re-measured, and never once written up for publication.",
        shape: polygon([
          [117, 351], [116, 354], [113, 355], [110, 355], [107, 349], [107, 352],
          [104, 354], [101, 357], [92, 355], [91, 351], [89, 346], [85, 349],
          [80, 349], [79, 344], [81, 342], [77, 341], [76, 336], [79, 336],
          [81, 333], [84, 329], [86, 330], [88, 330], [90, 325], [92, 323],
          [95, 325], [100, 323], [104, 325], [108, 325], [112, 327], [114, 329],
          [115, 331], [115, 334], [119, 334], [118, 338], [120, 342], [122, 348],
          [119, 350],
        ]),
      },
      {
        type: "lore",
        label: "A cabinet that keeps its own counsel",
        text: "Every drawer opens freely except for what conservation's own floor plan calls its 'lower compartment' — a space the plan marks out by outline alone, with no handle, hinge, or seam anyone has found to open it by, and no note explaining what it was built to hold.",
        shape: polygon([
          [344, 499], [431, 496], [432, 614], [347, 616], [345, 503],
        ]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "The worn teddy bear",
        text: "Mended the same way, by the same uneven stitch, every time the seam reopens — though no conservator currently on staff has ever been asked to do the mending.",
        shape: polygon([
          [548, 407], [543, 415], [548, 425], [540, 430], [535, 440], [530, 450], [525, 460],
          [520, 470], [515, 480], [513, 490], [518, 495], [565, 497], [600, 496], [615, 492],
          [619, 480], [617, 468], [620, 458], [617, 448], [620, 438], [615, 428], [608, 418],
          [598, 409], [588, 405], [578, 408], [570, 404], [560, 406], [553, 402],
        ], ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "The second rocking horse, further back",
        text: "Identical to the one nearer the door, down to the same worn saddle patch, though the ledger lists only a single horse ever acquired — the first curator's own handwriting, re-entering the same acquisition twice, a year apart.",
        shape: polygon([
          [897, 455], [902, 448], [908, 452], [916, 446], [928, 450],
          [945, 458], [958, 470], [966, 482], [978, 483], [995, 484],
          [1012, 490], [1022, 500], [1024, 512], [1016, 525], [1010, 540],
          [1006, 552], [998, 562], [985, 565], [960, 562], [940, 558],
          [925, 555], [918, 548], [920, 530], [916, 510], [912, 495],
          [905, 490], [897, 487], [893, 478], [895, 465],
        ], ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "The crib's carved headboard",
        text: "Carved with a lullaby in a script the museum's own linguists have never fully translated, past the first and last lines — the last line naming, as near as anyone can render it, a curator rather than a child.",
        shape: polygon([
          [1063, 448], [1070, 460], [1066, 468], [1075, 470], [1090, 465],
          [1097, 453], [1104, 463], [1112, 468], [1119, 449], [1127, 463],
          [1133, 468], [1140, 451], [1148, 465], [1155, 469], [1163, 457],
          [1170, 466], [1178, 468], [1185, 466], [1193, 464], [1197, 470],
          [1197, 543], [1063, 543],
        ], ZOOM_CLOSEUP_VIEWBOX),
      },
    ],
  },
];

// Free-roam placement region (replacing the old "pick one of a handful of
// glowing surfaces" model for every NEW donation — see docs/adr/0007's
// successor decision, recorded in this comment rather than a new ADR file):
// one inset rectangle covering nearly the whole of a gallery's main-scene
// image, in that scene's own SCENE_VIEWBOX pixel space. The OLD named
// surfaces in GALLERY_SURFACES above are kept completely unchanged and are
// used ONLY to keep rendering exhibits donated before this shipped — a new
// donation is never offered them and never validated against them. This
// region's own `surfaceType` ("freeform") deliberately never appears in
// SURFACE_TYPES_BY_SUBTYPE, so `surfaceAllows()` (and therefore
// `legacySlotPlacement`, which reads GALLERY_SURFACES directly, not this
// region) never picks it for anything — it only ever exists inside
// `placementSurfaces`, reached by `surfaceById()`, for a fresh donation.
const FREE_PLACEMENT_EDGE_MARGIN = 60;
function freePlacementShape() {
  const { width, height } = SCENE_VIEWBOX;
  const m = FREE_PLACEMENT_EDGE_MARGIN;
  return polygon([
    [m, m],
    [width - m, m],
    [width - m, height - m],
    [m, height - m],
  ]);
}

export const GALLERIES = GALLERY_LAYOUT.map((g) => ({
  ...g,
  slots: SLOT_ANCHORS.map((a, i) => ({
    id: `${g.id}_slot_${i}`,
    x: a.x,
    z: a.z,
    rotationY: 0,
    width: a.width,
    height: a.height,
  })),
  // The real, traced placement surfaces this gallery offers for rendering
  // its ALREADY-donated legacy exhibits — never offered as a placement
  // option for a new donation any more (see `placementSurfaces` below,
  // which appends the gallery's one free-placement region after these).
  // Each still carries the compatibility list derived from
  // SURFACE_TYPES_BY_SUBTYPE, used only by legacy rendering/validation
  // paths that still reference a named surface by id.
  placementSurfaces: [
    ...(GALLERY_SURFACES[g.id] ?? []).map((s) => ({
      ...s,
      allowedRelicTypes: (SUBTYPES_BY_CATEGORY[g.category] ?? []).filter((subtype) => surfaceAllows(s, subtype)),
    })),
    // The one free-placement region a NEW donation is placed into — allows
    // EVERY real subtype, not just this gallery's own category's, so a
    // donor can place any curated relic in any of the four galleries (no
    // surface-type compatibility restriction either, since there's no real
    // "wall" vs. "shelf" distinction left to enforce once placement is
    // free-roam across the whole scene). The gallery's own `category`
    // field still describes what the ROOM is themed around for display
    // purposes; it's no longer a gate on what can be placed inside it —
    // see donateExhibit's `validVisual`, which only checks the preset's
    // own subtype/surface compatibility now, never the gallery's category.
    {
      id: `${g.id}-free`,
      surfaceType: "freeform",
      shape: freePlacementShape(),
      allowedRelicTypes: [...SUBTYPE_SET],
      minScale: 0.5,
      maxScale: 1.5,
      depth: 0.4,
    },
  ],
}));

export const GALLERY_IDS = new Set(GALLERIES.map((g) => g.id));

export function galleryById(id) {
  return GALLERIES.find((g) => g.id === id);
}

export function slotById(slotId) {
  for (const gallery of GALLERIES) {
    const slot = gallery.slots.find((s) => s.id === slotId);
    if (slot) return { gallery, slot };
  }
  return null;
}

export function surfaceById(galleryId, surfaceId) {
  const gallery = galleryById(galleryId);
  if (!gallery) return null;
  const surface = gallery.placementSurfaces.find((s) => s.id === surfaceId);
  return surface ? { gallery, surface } : null;
}

// The donor counter: an atmospheric secondary entrance point in the hall —
// a real in-world interactive object kept for flavour, but (per the
// product direction) no longer the only way to discover donation; see the
// persistent "Donate a Relic" action the client always renders. In the new
// foyer image this is the armillary-sphere-and-registry counter on the far
// left, distinct from the chained guestbook on the far right (its own
// `lore` object below).
export const DONOR_COUNTER = { x: 7, z: 62 };
const DONOR_COUNTER_SHAPE = polygon([
  [92, 579], [129, 579], [161, 579], [133, 534], [140, 527], [167, 533], [186, 533], [216, 574],
  [226, 570], [229, 552], [225, 542], [220, 527], [225, 504], [236, 487], [244, 505], [247, 529],
  [241, 541], [235, 556], [234, 569], [242, 575], [245, 583], [301, 583], [313, 574], [304, 558],
  [311, 536], [318, 518], [327, 538], [331, 560], [321, 569], [321, 575], [325, 580], [330, 582],
  [331, 585], [362, 586], [366, 589], [363, 594], [358, 593], [357, 598], [355, 601], [353, 605],
  [355, 609], [359, 611], [356, 615], [355, 621], [352, 624], [352, 632], [351, 637], [347, 663],
  [348, 695], [354, 708], [355, 732], [333, 735], [264, 744], [239, 750], [228, 750], [138, 766],
  [101, 771], [0, 773], [0, 578], [42, 578], [85, 579],
]);

export function hallConfig() {
  return { image: "hall", donorCounter: DONOR_COUNTER };
}

// ---------------------------------------------------------------------------
// Scenes: a small fixed graph of illustrated vantages, each now carrying a
// bounded 2.5D camera range and a list of interactive objects (anchor
// BOXES, not points) the client renders as glow regions over the actual
// painted item they represent. A visitor is always exactly "at" one scene
// id; `POST /api/presence` reports which one (see server.js).

// All four galleries have a real, visibly painted doorway in
// entrance-hall-v2.png, each wired as an ordinary `type: "portal"`
// interactive object — never a special "hub mode" some galleries get and
// others don't. Left to right: the near-left archway beside the donor
// counter (portraits), the two doors flanking the grand staircase (memento,
// specimen), and the far-right archway partly behind the antique map's
// easel (childhood). Order matches `GALLERY_LAYOUT`'s `orderIndex`, and
// every polygon below was traced against actual pixel positions in the
// approved hall image, not a generic placeholder box.
const HALL_PORTALS = [
  {
    galleryId: "portraits",
    doorShape: polygon([
      [312, 369], [302, 377], [294, 384], [287, 392], [280, 402], [277, 413], [271, 427], [270, 439],
      [270, 450], [263, 568], [273, 561], [290, 565], [293, 580], [306, 581], [312, 572], [304, 559],
      [311, 536], [320, 517], [324, 534], [331, 560], [322, 571], [329, 582], [341, 581], [343, 531],
      [346, 451], [345, 443], [343, 430], [341, 420], [338, 410], [335, 402], [329, 394], [324, 384],
      [318, 375],
    ]),
  },
  {
    galleryId: "memento",
    doorShape: polygon([
      [581, 437], [576, 439], [573, 443], [570, 444], [568, 446], [561, 451], [556, 457], [550, 466],
      [546, 475], [543, 481], [542, 484], [540, 493], [540, 511], [539, 617], [618, 615], [619, 511],
      [620, 495], [618, 486], [615, 478], [613, 470], [608, 461], [604, 457], [599, 451], [593, 445],
      [587, 440], [583, 439],
    ]),
  },
  {
    galleryId: "specimen",
    doorShape: polygon([
      [1112, 437], [1107, 441], [1102, 443], [1097, 448], [1092, 452], [1083, 464], [1078, 474],
      [1076, 486], [1075, 496], [1075, 542], [1077, 617], [1154, 617], [1152, 497], [1150, 487],
      [1149, 480], [1146, 473], [1143, 468], [1140, 462], [1137, 457], [1132, 451], [1125, 444],
      [1115, 437],
    ]),
  },
  {
    galleryId: "childhood",
    doorShape: polygon([
      [1369, 368], [1348, 396], [1337, 424], [1335, 452], [1350, 450], [1365, 440], [1375, 427],
      [1383, 432], [1392, 439], [1401, 440], [1405, 428], [1397, 405], [1390, 391], [1372, 371],
    ]),
  },
];

// galleryId -> the hall as "back" target for a gallery whose doorway isn't
// one of the two portals above (reached via the Rooms menu instead) — every
// gallery's main scene still sends "back" to the one hall scene either way.
const HALL_FACING_BY_GALLERY = Object.fromEntries(GALLERY_LAYOUT.map((g) => [g.id, "hall"]));

// Rich, authored content for the hall's own built-in objects — chandelier,
// twin guardian statues, floor compass, antique map, mechanical clock, and
// the chained guestbook/registry — each anchored to something actually
// painted in entrance-hall-v2.png (located via direct pixel-region
// inspection of the approved asset), never an arbitrary box over empty wall
// or floor (CLAUDE.md).
const HALL_LORE_OBJECTS = [
  {
    id: "hall-chandelier",
    type: "lore",
    label: "The tiered chandelier",
    text: "Only the lowest tier is ever lit, and it burns down at the same rate every night regardless of how many visitors pass beneath it. The upper two tiers were wired for candles that were never once supplied — by the first curator's own specification, according to a margin note nobody has been able to date.",
    shape: ellipse(847, 91, 182, 107),
    hitPadding: 8,
  },
  {
    id: "hall-guardian-left",
    type: "lore",
    label: "The left guardian",
    text: "Catalogued as a griffin, though no two inventories describe the same number of wings. It faces the staircase in every photograph taken of this hall since the museum opened — except one, filed under the first curator's own name, which nobody will say where it is now.",
    shape: polygon([
      [513, 388], [511, 380], [505, 379], [502, 375], [507, 366], [510, 359], [510, 353], [508, 346],
      [512, 317], [513, 312], [517, 306], [516, 300], [516, 296], [511, 291], [509, 286], [508, 281],
      [504, 279], [498, 280], [497, 276], [501, 269], [503, 255], [504, 245], [502, 237], [501, 229],
      [498, 222], [495, 216], [494, 211], [495, 206], [500, 211], [505, 209], [506, 204], [505, 201],
      [508, 205], [511, 197], [512, 192], [506, 186], [506, 182], [500, 178], [502, 173], [502, 170],
      [500, 171], [498, 174], [496, 174], [493, 172], [490, 170], [488, 170], [485, 170], [483, 167],
      [480, 165], [478, 162], [476, 163], [477, 167], [474, 165], [465, 161], [464, 165], [468, 172],
      [467, 175], [463, 180], [458, 185], [454, 190], [458, 190], [455, 194], [457, 196], [454, 198],
      [453, 210], [452, 220], [447, 221], [444, 216], [442, 206], [443, 195], [443, 185], [440, 174],
      [436, 161], [430, 141], [422, 130], [416, 127], [410, 134], [409, 138], [409, 141], [406, 144],
      [402, 153], [400, 162], [397, 174], [395, 188], [392, 204], [392, 218], [389, 228], [384, 240],
      [382, 247], [383, 251], [390, 247], [394, 243], [398, 237], [395, 247], [393, 255], [393, 260],
      [389, 270], [390, 273], [394, 271], [400, 267], [403, 261], [404, 265], [402, 276], [400, 281],
      [400, 286], [398, 291], [397, 293], [407, 294], [406, 310], [407, 324], [409, 327], [408, 335],
      [411, 336], [413, 325], [417, 326], [421, 310], [424, 314], [426, 311], [427, 306], [428, 297],
      [432, 306], [433, 302], [433, 296], [436, 297], [436, 291], [438, 286], [442, 289], [443, 296],
      [441, 305], [438, 314], [434, 323], [427, 333], [419, 342], [409, 348], [405, 359], [406, 367],
      [406, 373], [397, 377], [395, 382], [423, 375], [437, 377], [448, 376], [509, 387],
    ]),
    hitPadding: 3,
  },
  {
    id: "hall-guardian-right",
    type: "lore",
    label: "The right guardian",
    text: "Its twin, supposedly. Conservation measured a half-centimetre difference in wingspan between the two in 1964 — the last year the first curator's own measurements appear anywhere in the ledger — and has re-measured every decade since. The difference has never been the same number twice.",
    shape: polygon([
      [1241, 224], [1250, 208], [1249, 188], [1249, 171], [1266, 126], [1281, 136], [1290, 160],
      [1293, 178], [1295, 208], [1310, 240], [1302, 256], [1288, 237], [1294, 269], [1282, 263],
      [1289, 295], [1278, 286], [1282, 326], [1270, 341], [1278, 357], [1280, 369], [1289, 377],
      [1266, 375], [1240, 381], [1203, 386], [1175, 390], [1179, 380], [1190, 374], [1179, 362],
      [1181, 345], [1175, 310], [1175, 291], [1185, 279], [1195, 278], [1187, 261], [1185, 244],
      [1191, 227], [1195, 211], [1190, 213], [1180, 203], [1175, 194], [1184, 188], [1187, 176],
      [1189, 170], [1195, 172], [1199, 171], [1206, 168], [1211, 169], [1223, 161], [1223, 169],
      [1224, 175], [1227, 181], [1235, 189], [1237, 197], [1239, 223],
    ]),
    hitPadding: 3,
  },
  {
    id: "hall-compass",
    type: "lore",
    label: "The floor compass mosaic",
    text: "A star-and-compass mosaic set directly before the stair, its needle fixed to point at none of the four doorways. Cleaning staff report it is always faintly warm to the touch, in every season, regardless of the hall's own temperature.",
    shape: ellipse(846, 831, 520, 120),
  },
  {
    id: "hall-map",
    type: "guide",
    label: "The antique map",
    text: "A folded map of a coastline that matches no surveyed country, in what conservation believes is the first curator's own hand. It has been re-folded along the same creases for as long as anyone has worked here, though no one admits to doing it.",
    shape: polygon([
      [1461, 436], [1461, 616], [1440, 634], [1444, 654], [1291, 641], [1303, 462], [1448, 440],
    ]),
    hitPadding: 6,
  },
  {
    id: "hall-clock",
    type: "lore",
    label: "The mechanical clock",
    text: "A brass-and-wood clock that keeps correct time, checked against the city's own civic clock every month without fail. It was stopped and restarted exactly once, the same year every gallery's own founding piece was logged — the only date the whole collection agrees on.",
    shape: polygon([
      [1592, 235], [1574, 258], [1536, 299], [1545, 405], [1557, 533], [1548, 560], [1555, 576],
      [1572, 575], [1669, 576], [1669, 293], [1660, 275], [1630, 264], [1601, 241],
    ]),
    hitPadding: 2,
  },
  {
    id: "hall-guestbook",
    type: "lore",
    label: "The chained guestbook",
    text: "Chained to its podium, like a book meant never to leave, though several names inside are of visitors who the front desk has no record of ever admitting. The first page is missing, cut rather than torn, and no later page names a curator by title again.",
    shape: polygon([
      [1538, 583], [1569, 572], [1607, 578], [1646, 577], [1673, 580], [1673, 899], [1626, 895],
      [1582, 889], [1536, 880], [1494, 878], [1445, 872], [1451, 829], [1463, 804], [1461, 748],
      [1456, 691], [1442, 630], [1483, 603], [1481, 581], [1480, 515], [1488, 502], [1502, 485],
      [1528, 505], [1534, 539], [1534, 578],
    ]),
    hitPadding: 4,
  },
  {
    id: "hall-angel",
    type: "lore",
    label: "The watching angel",
    text: "Perched above the stair on its own pedestal, wings half-spread as though it only just landed there — installed, the ledger says, the same season the first curator stopped signing the acquisition book. Night staff swear its shadow falls the wrong way for where the moon window sits, and no one has ever caught it mid-turn, only ever already turned.",
    shape: polygon([
      [857, 354], [861, 353], [863, 350], [863, 345], [865, 342], [867, 339], [877, 335], [883, 333],
      [890, 330], [896, 330], [901, 328], [905, 327], [898, 332], [901, 333], [896, 335], [895, 337],
      [897, 338], [893, 339], [892, 342], [895, 341], [890, 344], [889, 348], [886, 348], [885, 350],
      [882, 352], [881, 354], [880, 357], [878, 360], [875, 361], [874, 363], [873, 365], [871, 368],
      [868, 368], [867, 371], [864, 371], [862, 372], [864, 375], [866, 379], [865, 383], [859, 379],
      [862, 386], [865, 389], [861, 394], [861, 399], [864, 402], [859, 405], [862, 410], [858, 412],
      [858, 417], [858, 421], [862, 423], [863, 427], [847, 427], [828, 428], [829, 423], [831, 421],
      [834, 421], [836, 419], [838, 416], [838, 413], [833, 418], [832, 414], [835, 412], [834, 408],
      [830, 404], [829, 401], [832, 395], [831, 392], [833, 389], [834, 385], [832, 383], [828, 388],
      [826, 385], [827, 383], [829, 379], [828, 376], [830, 375], [831, 373], [827, 371], [826, 369],
      [826, 367], [823, 368], [823, 366], [820, 365], [819, 363], [818, 360], [815, 359], [814, 357],
      [811, 354], [809, 352], [805, 349], [804, 346], [800, 344], [801, 341], [796, 339], [797, 337],
      [793, 334], [795, 332], [787, 328], [791, 328], [794, 329], [798, 329], [811, 334], [816, 335],
      [821, 337], [825, 339], [831, 345], [831, 349], [836, 354], [838, 351], [839, 347], [841, 344],
      [840, 342], [843, 340], [844, 335], [839, 333], [835, 332], [831, 330], [829, 327], [826, 324],
      [825, 321], [824, 317], [824, 314], [821, 313], [823, 311], [824, 308], [825, 305], [827, 301],
      [830, 298], [832, 295], [836, 293], [839, 291], [843, 290], [845, 285], [848, 284], [848, 290],
      [852, 290], [855, 292], [859, 294], [862, 297], [864, 300], [866, 304], [868, 309], [870, 311],
      [871, 313], [868, 315], [868, 319], [866, 322], [865, 325], [863, 328], [859, 331], [856, 333],
      [853, 335], [850, 335], [849, 339], [851, 341], [853, 344], [852, 348], [852, 351], [854, 353],
    ]),
    hitPadding: 3,
  },
  {
    id: "hall-banner-left",
    type: "lore",
    label: "A hanging banner, left of the stair",
    text: "The device worked into its border matches no family the heralds' office has on file, and the thread has faded everywhere except the crest itself, which keeps its colour a half-shade brighter than the cloth around it. Its twin hangs opposite, dyed from the same lot — according to the receipt pinned behind it, in the first curator's own hand.",
    shape: polygon([
      [440, 374], [457, 379], [496, 385], [507, 385], [506, 389], [500, 391], [497, 497],
      [473, 526], [471, 535], [470, 526], [446, 496], [450, 381], [442, 381], [438, 381], [438, 375],
    ]),
    hitPadding: 3,
  },
  {
    id: "hall-banner-right",
    type: "lore",
    label: "A hanging banner, right of the stair",
    text: "Identical to its counterpart across the hall, down to the same unplaceable crest and the same brighter patch of thread — except that this one was re-hung eleven centimetres lower at some point, a discrepancy conservation has measured twice and corrected neither time.",
    shape: polygon([
      [1182, 387], [1193, 385], [1238, 377], [1245, 376], [1242, 381], [1237, 382], [1239, 439],
      [1241, 496], [1216, 530], [1192, 499], [1190, 447], [1190, 391], [1184, 392], [1181, 390],
    ]),
    hitPadding: 3,
  },
  {
    id: "hall-carpet",
    type: "lore",
    label: "The stair carpet",
    text: "Re-dyed to the same red on a fixed schedule, with a maintenance card that notes the exact shade by name and nothing else — the same card, in the same hand, that logs the chandelier's unlit upper tiers and the mirror in the portrait gallery, though no single conservator's name appears on all three.",
    shape: polygon([
      [781, 483], [914, 484], [914, 488], [916, 490], [916, 494], [917, 496], [917, 499], [919, 500],
      [919, 506], [921, 507], [921, 511], [922, 513], [921, 518], [924, 519], [924, 525], [926, 526],
      [925, 531], [926, 533], [927, 538], [929, 539], [929, 544], [931, 546], [932, 554], [935, 561],
      [937, 563], [937, 571], [939, 572], [939, 579], [941, 581], [942, 588], [943, 590], [943, 598],
      [946, 600], [946, 609], [950, 610], [950, 619], [952, 620], [952, 629], [955, 631], [956, 641],
      [958, 643], [959, 654], [964, 655], [964, 668], [975, 673], [722, 673], [729, 667], [729, 656],
      [733, 654], [733, 644], [738, 641], [737, 633], [741, 630], [741, 621], [745, 618], [745, 611],
      [748, 608], [747, 601], [750, 597], [750, 590], [753, 589], [753, 581], [756, 578], [756, 571],
      [759, 569], [758, 564], [761, 560], [761, 556], [763, 553], [763, 548], [766, 544], [766, 540],
      [767, 537], [767, 534], [769, 531], [769, 527], [770, 524], [771, 520], [772, 518], [773, 514],
      [774, 512], [774, 508], [776, 505], [776, 503], [778, 500], [777, 497], [780, 494], [780, 491],
      [781, 486],
    ]),
    hitPadding: 3,
  },
];

function buildHallScenes() {
  const donateObject = {
    id: "hall-donate",
    type: "donate",
    label: "Donate a Relic",
    shape: DONOR_COUNTER_SHAPE,
  };
  const portalObjects = HALL_PORTALS.map((portal) => {
    const gallery = galleryById(portal.galleryId);
    return {
      id: `hall-portal-${portal.galleryId}`,
      type: "portal",
      label: `Enter ${gallery.name}`,
      targetSceneId: `${portal.galleryId}-main`,
      shape: portal.doorShape,
    };
  });
  return [
    {
      id: "hall",
      kind: "main",
      galleryId: null,
      parentSceneId: null,
      caption: "Entrance Hall",
      image: "hall",
      sourceImage: SOURCE_IMAGE_SIZE.hall,
      objectViewBox: sourceImageViewBox("hall"),
      camera: HALL_CAMERA,
      interactiveObjects: [donateObject, ...portalObjects, ...HALL_LORE_OBJECTS],
      visitorAnchors: HALL_VISITOR_ANCHORS,
      nav: {},
    },
  ];
}

// A main gallery scene's own fixed object anchors — placed to clear both
// the doorway/arch (usually upper-centre in these reference compositions)
// and the display-slot arc (SLOT_ANCHORS, lower two-thirds). `closeup`-type
// objects stay in-room (clicking the actual painted display); door/back
// navigation is `nav`, rendered as corner chrome by the client, never a
// floating object here.
function buildGalleryScenes(gallery) {
  const closeup = gallery.closeup;
  const objects = gallery.objects.map((obj, i) => ({
    id: `${gallery.id}-object-${i}`,
    targetSceneId: obj.type === "closeup" ? `${gallery.id}-closeup` : undefined,
    ...obj,
  }));
  const closeupObjects = (gallery.closeupObjects ?? []).map((obj, i) => ({
    id: `${gallery.id}-closeup-object-${i}`,
    ...obj,
  }));
  const mainScene = {
    id: `${gallery.id}-main`,
    kind: "main",
    galleryId: gallery.id,
    parentSceneId: HALL_FACING_BY_GALLERY[gallery.id],
    caption: gallery.name,
    image: gallery.image,
    sourceImage: SOURCE_IMAGE_SIZE[gallery.image],
    objectViewBox: sourceImageViewBox(gallery.image),
    camera: DEFAULT_MAIN_CAMERA,
    interactiveObjects: objects,
    visitorAnchors: VISITOR_ANCHORS,
    nav: { back: { targetSceneId: HALL_FACING_BY_GALLERY[gallery.id], label: "Back to the Entrance Hall" } },
  };
  // A close-up scene's `objectViewBox` is the SVG object-layer's own window
  // onto the source image — it must match whatever crop/zoom the art layer's
  // CSS actually shows (illustration.js's `paint()`), not just the source
  // image's full native size. A `zoom` close-up reuses its gallery's main
  // image at a CSS crop (ZOOM_CLOSEUP_VIEWBOX, see that constant's own
  // derivation above); a dedicated-reference close-up shows that reference
  // image's own full frame. `sourceImage`, by contrast, is always the real
  // backing file's true native pixel size regardless of which window is
  // shown — the glow `<image>` element needs that size to scale correctly
  // even though the shapes themselves are authored in the cropped window.
  const closeupScene = {
    id: `${gallery.id}-closeup`,
    kind: "closeup",
    galleryId: gallery.id,
    parentSceneId: `${gallery.id}-main`,
    caption: closeup.caption,
    image: closeup.image,
    sourceImage: SOURCE_IMAGE_SIZE[closeup.image],
    objectViewBox: closeup.zoom ? ZOOM_CLOSEUP_VIEWBOX : sourceImageViewBox(closeup.image),
    zoom: closeup.zoom ?? false,
    lore: closeup.lore,
    camera: closeup.closeupCamera ?? DEFAULT_CLOSEUP_CAMERA,
    interactiveObjects: closeupObjects,
    visitorAnchors: VISITOR_ANCHORS,
    nav: { back: { targetSceneId: `${gallery.id}-main`, label: `Back to ${gallery.name}` } },
  };
  return [mainScene, closeupScene];
}

export const SCENES = [...buildHallScenes(), ...GALLERIES.flatMap(buildGalleryScenes)];
export const SCENE_IDS = new Set(SCENES.map((s) => s.id));
export const DEFAULT_SCENE_ID = "hall";

export function sceneById(id) {
  return SCENES.find((s) => s.id === id);
}

// The "logical room" a scene belongs to — mirrors public/app.js's own
// roomIdForScene exactly (a gallery's `-main` and `-closeup` scenes are the
// same physical room; the hall is its own room), so the server can be the
// actual authority on "are these two visitors in the same room right now"
// for anything that needs it (the Séance interaction endpoint — see
// server.js/sse.js) without trusting a client-supplied room id. Falls back
// to the scene id itself for an unknown scene, same defensive shape as the
// client's own version.
export function roomIdForScene(sceneId) {
  const scene = sceneById(sceneId);
  return scene?.galleryId ?? sceneId;
}

// Every `type: "lore"` interactive object across the whole world (hall +
// every gallery's main/closeup scenes) — the flat list db.js's
// `seedBuiltinLoreExhibits()` iterates to derive one real exhibit row per
// object, so world.js stays the single source of truth for which objects
// exist and db.js never re-derives gallery/scene structure itself. A
// gallery-owned object's `category` is its gallery's own category; a
// hall-owned object (no gallery) gets the synthetic `"hall"` category/
// gallery id db.js seeds purely to satisfy the exhibits table's FK.
export function allBuiltinLoreObjects() {
  const out = [];
  for (const scene of SCENES) {
    const galleryId = scene.galleryId ?? "hall";
    const gallery = scene.galleryId ? galleryById(scene.galleryId) : null;
    const category = gallery?.category ?? "hall";
    for (const object of scene.interactiveObjects) {
      if (object.type !== "lore") continue;
      out.push({
        id: object.id,
        sceneId: scene.id,
        galleryId,
        category,
        label: object.label,
        text: object.text,
        closeupSceneId: object.closeupSceneId ?? null,
      });
    }
  }
  return out;
}

// Looks up a built-in lore object's own owning scene id + hand-traced shape
// by its BARE world-object id (e.g. "hall-chandelier", not the exhibit id
// `exhibit_builtin_hall-chandelier` db.js derives it from) — the one piece
// of world-graph knowledge db.js's `fullExhibit()` needs to attach a
// `cropInfo` field to a builtin exhibit's DTO, so the client can render the
// EXACT real painted object (cropped from that scene's own background
// image via CSS background-position/background-size) as its dossier
// preview, rather than duplicating this scene/shape lookup itself. Returns
// null if objectId doesn't name a real `type: "lore"` object anywhere in
// the world (should never happen for an id shaped like a real builtin
// exhibit's own id, but defensive regardless — see db.js's fullExhibit).
export function builtinObjectCropInfo(objectId) {
  for (const scene of SCENES) {
    const object = scene.interactiveObjects.find((o) => o.id === objectId && o.type === "lore");
    if (object) return { sceneId: scene.id, shape: object.shape };
  }
  return null;
}

// The shape a client needs to build the illustrated scenes and populate the
// interactive-object/cameo overlay — nothing server-only (no DB ids beyond
// what's already public).
export function publicWorld() {
  return {
    hall: hallConfig(),
    defaultSceneId: DEFAULT_SCENE_ID,
    scenes: SCENES,
    galleries: GALLERIES.map((g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      accent: g.accent,
      orderIndex: g.orderIndex,
      image: g.image,
      subtypes: SUBTYPES_BY_CATEGORY[g.category] ?? [],
      slots: g.slots.map((s) => ({ id: s.id, x: s.x, z: s.z, rotationY: s.rotationY, width: s.width, height: s.height })),
      placementSurfaces: g.placementSurfaces,
    })),
  };
}
