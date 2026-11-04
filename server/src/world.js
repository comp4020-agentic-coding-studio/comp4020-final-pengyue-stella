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

import { SUBTYPES_BY_CATEGORY } from "./constants.js";

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
  return { surfaceId: surface.id, u: Math.min(0.9, Math.max(0.1, u + jitter)), v, scale: 1 };
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
const DEFAULT_MAIN_CAMERA = { initialPan: 50, minPan: 8, maxPan: 92, initialZoom: 1.3, minZoom: 1.15, maxZoom: 2.1 };
const DEFAULT_CLOSEUP_CAMERA = { initialPan: 50, minPan: 20, maxPan: 80, initialZoom: 1.5, minZoom: 1.3, maxZoom: 2.2 };
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
      closeupCamera: { initialPan: 50, minPan: 30, maxPan: 70, initialZoom: 1.7, minZoom: 1.5, maxZoom: 2.3 },
    },
    objects: [
      {
        type: "lore",
        label: "Look closer: Under Glass",
        text: "Logged as botanical in 1911, biological in 1958, and 'undetermined — do not reclassify again' in 2003, in the same hand as the first entry. The jar has not been opened since.",
        closeupSceneId: "specimen-closeup",
        shape: polygon([[828, 398], [1068, 398], [1068, 580], [828, 580]]),
      },
      {
        type: "lore",
        label: "The skeletal figure on the shelf",
        text: "Collection records list only one sculpture for this gallery. Nobody currently on staff remembers the other one arriving, nor can anyone say with confidence what species it was assembled to represent — only that the armature inside carries the same maker's stamp as the skeletal wing across the room, filed a decade apart.",
        shape: polygon([
          [683.0, 422.5], [659.0, 422.5], [658.0, 418.5], [562.5, 410.0], [562.5, 232.0],
          [577.0, 234.5], [578.5, 250.0], [590.0, 248.5], [593.5, 253.0], [595.0, 286.5],
          [619.0, 287.5], [648.0, 299.5], [660.5, 299.0], [660.5, 285.0], [641.5, 258.0],
          [619.0, 249.5], [611.5, 244.0], [606.0, 226.5], [601.0, 226.5], [598.0, 220.5],
          [578.0, 206.5], [568.5, 206.0], [568.5, 199.0], [563.0, 191.5], [581.5, 194.0],
          [578.0, 164.5], [580.0, 172.5], [590.0, 172.5], [592.5, 164.0], [598.0, 159.5],
          [592.5, 168.0], [592.5, 180.0], [603.0, 180.5], [604.0, 187.5], [613.0, 187.5],
          [614.0, 200.5], [629.0, 200.5], [630.0, 195.5], [637.0, 205.5], [655.5, 205.0],
          [654.5, 187.0], [645.5, 172.0], [636.0, 165.5], [627.0, 161.5], [611.5, 162.0],
          [628.0, 159.5], [640.0, 164.5], [654.5, 180.0], [664.5, 211.0], [677.0, 216.5],
          [686.5, 228.0], [687.0, 234.5], [679.0, 225.5], [668.0, 225.5], [667.0, 237.5],
          [652.5, 238.0], [652.5, 250.0], [671.5, 269.0], [682.5, 299.0], [677.5, 324.0],
          [667.0, 339.5], [653.5, 347.0], [653.5, 358.0], [676.5, 371.0], [677.5, 381.0],
          [673.5, 383.0], [671.5, 406.0], [673.0, 411.5], [679.5, 413.0],
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
        label: "A glass dome over a glowing skull",
        text: "The glow has never dimmed since the dome was first sealed, by nobody now on record, over a specimen nobody now on record can name.",
        shape: polygon([
          [153, 497], [140, 500], [125, 508], [112, 520], [102, 535], [96, 555], [93, 580],
          [93, 610], [96, 630], [100, 645], [108, 655], [95, 660], [88, 670], [85, 685],
          [88, 697], [100, 703], [120, 707], [153, 709], [186, 707], [206, 703], [218, 697],
          [221, 685], [218, 670], [211, 660], [198, 655], [206, 645], [210, 630], [213, 610],
          [213, 580], [210, 555], [204, 535], [194, 520], [181, 508], [166, 500],
        ]),
      },
      {
        type: "lore",
        label: "A preserved butterfly wall",
        text: "Some specimens are pinned facing the glass, wings spread for viewing. A few, inexplicably, are pinned facing the wall.",
        shape: polygon([[100, 60], [222, 60], [222, 215], [100, 215]]),
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
          [145, 448], [175, 415], [195, 445], [220, 470], [245, 485], [265, 490],
          [285, 500], [300, 520], [310, 540], [315, 560], [320, 590], [318, 615],
          [305, 635], [280, 650], [250, 655], [215, 645], [190, 620], [170, 590],
          [155, 555], [145, 515], [140, 478],
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
          [1405, 308], [1395, 315], [1385, 328], [1372, 345], [1362, 365], [1355, 385],
          [1352, 405], [1350, 425], [1350, 445], [1355, 460], [1450, 460], [1458, 445],
          [1460, 425], [1460, 405], [1457, 385], [1450, 365], [1440, 345], [1428, 328],
          [1418, 315],
        ]),
      },
      {
        type: "lore",
        label: "A skeletal bird under glass",
        text: "Posed mid-step, as if caught walking rather than mounted. The taxidermist's invoice itemizes 'armature, feathers, glass dome' and nothing for the bones themselves.",
        shape: polygon([
          [1328, 485], [1315, 495], [1300, 510], [1288, 530], [1280, 555], [1275, 580],
          [1272, 605], [1272, 630], [1278, 650], [1395, 650], [1400, 630], [1400, 605],
          [1398, 580], [1392, 555], [1382, 530], [1368, 510], [1352, 495], [1340, 485],
        ]),
      },
      {
        type: "lore",
        label: "A dome of silent sparks",
        text: "What looks like a dried, luminous tree under the glass is listed in the acquisition ledger only as 'light, botanical, source unconfirmed.' It has not needed watering.",
        shape: polygon([
          [728, 195], [720, 202], [710, 215], [700, 235], [694, 255], [690, 275],
          [688, 295], [688, 315], [692, 330], [788, 330], [792, 315], [792, 295],
          [790, 275], [786, 255], [778, 235], [768, 215], [756, 202], [744, 195],
        ]),
      },
      {
        type: "lore",
        label: "A perched bird among the ferns",
        text: "Painted into the diorama's background foliage so convincingly that two separate inventories logged it as 'decorative only' before a third noticed it was mounted, not painted.",
        shape: polygon([
          [383, 95], [395, 90], [410, 98], [418, 110], [430, 118], [438, 128],
          [430, 140], [420, 148], [428, 165], [430, 185], [420, 205], [405, 220],
          [390, 232], [370, 232], [358, 218], [350, 195], [345, 170],
          [355, 150], [350, 135], [345, 115], [355, 100], [368, 92],
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
          [1458, 520], [1470, 505], [1485, 500], [1500, 503], [1520, 508], [1545, 513],
          [1565, 517], [1582, 522], [1588, 530], [1578, 536], [1555, 533], [1530, 528],
          [1505, 524], [1485, 528], [1468, 535], [1450, 538], [1440, 530],
        ]),
      },
      {
        type: "lore",
        label: "A skeletal wing beside a raw crystal",
        text: "The wing's armature and the crystal beside it were accessioned a decade apart, yet conservation photographs show them displayed together since the earliest surviving record.",
        shape: polygon([
          [1310, 165], [1335, 158], [1365, 163], [1395, 170], [1420, 178], [1445, 188],
          [1465, 198], [1478, 210], [1480, 230], [1482, 255], [1478, 275], [1455, 288],
          [1420, 290], [1385, 288], [1355, 285], [1328, 280], [1308, 265], [1298, 240],
          [1296, 210], [1300, 185],
        ]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "An ammonite fossil under glass",
        text: "Its spiral runs the wrong direction for its catalogued species — a detail noted once, in pencil, in the margin of the first curator's own logbook, which nobody has been able to relocate since.",
        shape: ellipse(487, 480, 27, 26, ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "A cluster of raw crystal",
        text: "It is faintly warm at the centre of the cluster, year-round, and no geologist asked to explain it has agreed to put a theory in writing.",
        shape: polygon([
          [674.0, 506.5], [666.0, 506.5], [662.0, 503.5], [657.0, 506.5], [648.5, 505.0],
          [656.5, 498.0], [648.5, 484.0], [650.5, 480.0], [648.5, 470.0], [656.0, 470.5],
          [659.5, 467.0], [658.5, 452.0], [666.5, 446.0], [670.0, 437.5], [675.0, 439.5],
          [679.5, 447.0], [672.0, 447.5], [667.5, 452.0], [668.5, 461.0], [672.0, 464.5],
          [675.0, 462.5], [679.0, 469.5], [686.0, 459.5], [689.0, 459.5], [692.5, 464.0],
          [690.5, 470.0], [692.5, 477.0], [686.5, 497.0], [674.0, 506.5],
        ], ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "The glowing moss within the case",
        text: "It has never been watered, fed, or replaced, and has not visibly grown or withered in any photograph spanning the gallery's recorded history.",
        shape: polygon([
          [858, 495], [875, 490], [895, 493], [905, 500], [920, 498], [935, 503],
          [945, 510], [950, 518], [940, 525], [920, 522], [900, 520], [880, 522],
          [865, 518], [855, 510], [852, 502],
        ], ZOOM_CLOSEUP_VIEWBOX),
      },
    ],
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
      closeupCamera: { initialPan: 28, minPan: 10, maxPan: 50, initialZoom: 1.6, minZoom: 1.4, maxZoom: 2.2 },
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
        label: "Two books on the left cabinet",
        text: "Shelved spine-out, as always, though no catalogue entry records a title for either one, and no curator has volunteered to open them and check.",
        shape: polygon([
          [296, 437], [340, 436], [378, 441], [383, 448],
          [381, 456], [376, 462], [376, 468], [382, 480],
          [378, 489], [296, 489], [293, 462],
        ]),
      },
      {
        type: "lore",
        label: "The waiting cot",
        text: "It is turned down fresh every morning, a duty the handover log attributes to 'standing instruction, see curator's file' without naming which curator or producing the file. The nursery has had no occupant on record for longer than anyone currently on staff can confirm.",
        shape: polygon([[1042, 438], [1078, 430], [1150, 427], [1192, 434], [1202, 458], [1198, 480], [1202, 520], [1198, 555], [1188, 570], [1150, 575], [1085, 573], [1050, 565], [1043, 540], [1038, 490]]),
      },
      {
        type: "lore",
        label: "A castle puppet-theatre diorama",
        text: "Wound once a century, according to the plaque, though no mechanism to wind it has ever been found. It has changed scenes twice in living memory, always overnight.",
        shape: polygon([
          [190, 115], [205, 95], [225, 118], [248, 98], [265, 122],
          [285, 92], [300, 88], [315, 100], [330, 122], [348, 100],
          [362, 125], [372, 150], [378, 170], [372, 190], [365, 220],
          [358, 240], [352, 262], [350, 300], [350, 345], [195, 350],
          [195, 345], [190, 300], [185, 262], [178, 240], [170, 210],
          [165, 190], [170, 150], [178, 120],
        ]),
      },
      {
        type: "lore",
        label: "A rocking horse worn smooth",
        text: "Its paint is worn through at the saddle and nowhere else, in a pattern consistent with decades of riding the collection has no record of ever permitting.",
        shape: polygon([[222, 370], [238, 380], [248, 400], [250, 420], [242, 442], [228, 460], [210, 480], [205, 500], [216, 525], [213, 548], [219, 568], [223, 585], [211, 598], [195, 592], [180, 575], [165, 590], [150, 600], [140, 590], [130, 598], [115, 606], [85, 601], [62, 588], [68, 560], [62, 525], [68, 485], [62, 455], [72, 425], [90, 400], [112, 410], [128, 385], [148, 398], [168, 378], [188, 392], [200, 372]]),
      },
      {
        type: "lore",
        label: "A boy doll in the niche",
        text: "Standing in the same recessed arch for every inventory photograph on file, hat and collar square, though nothing in the records says he was ever posed that way on purpose.",
        shape: polygon([[665, 160], [690, 152], [712, 158], [722, 170], [725, 185], [718, 200], [725, 215], [720, 235], [728, 250], [722, 270], [710, 285], [695, 295], [680, 295], [668, 285], [662, 270], [665, 250], [658, 235], [665, 215], [658, 200], [662, 185]]),
      },
      {
        type: "lore",
        label: "A white horse figurine beneath the boy doll",
        text: "Smaller than either rocking horse in the room, and the only one of the three never once logged as moved, cleaned, or repaired.",
        shape: polygon([[650, 340], [670, 330], [695, 325], [715, 328], [735, 335], [755, 345], [765, 360], [760, 375], [745, 390], [720, 400], [695, 402], [670, 398], [650, 388], [642, 372], [645, 355]]),
      },
      {
        type: "lore",
        label: "A second rocking horse, deeper in the cabinet",
        text: "Identical to the one nearer the door, down to the same worn saddle patch, though the ledger lists only a single horse ever acquired — the first curator's own handwriting, re-entering the same acquisition twice, a year apart, as though the first entry had been forgotten rather than corrected.",
        shape: polygon([[905, 415], [925, 405], [940, 412], [950, 425], [958, 440], [968, 455], [990, 465], [1015, 475], [1030, 490], [1033, 505], [1025, 518], [1040, 528], [1055, 545], [1050, 560], [1025, 565], [1000, 560], [975, 552], [950, 548], [928, 552], [905, 558], [885, 560], [872, 548], [880, 528], [890, 508], [894, 488], [896, 468], [898, 448], [900, 430]]),
      },
      {
        type: "lore",
        label: "A miniature chapel beneath a glass dome",
        text: "The candle behind its little window has burned at exactly the same height in every photograph on file, going back further than the glass itself has been catalogued.",
        shape: polygon([
          [278, 498], [288, 503], [293, 508], [289, 513],
          [296, 516], [310, 525], [322, 538], [333, 552],
          [340, 568], [343, 585], [344, 600], [340, 613],
          [330, 624], [312, 632], [288, 637], [260, 638],
          [232, 636], [208, 630], [192, 619], [183, 605],
          [180, 590], [182, 573], [190, 557], [203, 543],
          [220, 530], [240, 521], [258, 516], [267, 517],
          [264, 510], [271, 503],
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
        label: "The crescent moon set into the cabinet glass",
        text: "Etched, not painted, and always a little warmer to the touch than the glass around it, by a margin conservation can measure but not explain.",
        shape: polygon([[1248, 220], [1260, 224], [1266, 233], [1266, 245], [1261, 255], [1252, 261], [1240, 262], [1228, 258], [1220, 249], [1218, 238], [1222, 228], [1232, 222]]),
      },
      {
        type: "lore",
        label: "A branched silver candelabra",
        text: "Its candles have never been lit, and never collect dust either, in a room where every other surface keeps a thin coat of it faithfully.",
        shape: polygon([[788, 410], [800, 412], [798, 425], [808, 435], [815, 438], [822, 450], [820, 465], [812, 470], [815, 485], [805, 495], [795, 495], [798, 478], [790, 470], [782, 468], [780, 450], [786, 438], [782, 425]]),
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
        label: "A painted chest, angled on its base",
        text: "The painted scene on its front changes very slightly between inventories — a window open that was shut, a figure a few steps further along a path — never enough that two staff members agree it happened at all.",
        shape: polygon([[786, 590], [828, 585], [831, 598], [830, 667], [823, 676], [791, 676], [782, 667], [781, 602]]),
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
        shape: polygon([[548, 415], [535, 428], [540, 438], [530, 450], [535, 468], [528, 478], [538, 490], [560, 494], [590, 493], [612, 488], [618, 472], [608, 456], [618, 440], [612, 428], [598, 413], [585, 418], [565, 413]]),
      },
      {
        type: "lore",
        label: "A second carousel, unglassed",
        text: "Its twin sits sealed under glass nearby; this one has no dome at all, and turns exactly as slowly, exactly as unexplainably.",
        shape: polygon([[578, 262], [613, 297], [602, 312], [608, 330], [599, 345], [597, 353], [507, 353], [503, 345], [500, 328], [503, 310], [502, 296]]),
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
    // The one free-placement region a NEW donation of any subtype valid for
    // this gallery's category is placed into — no surface-type compatibility
    // restriction, since there's no real "wall" vs. "shelf" distinction left
    // to enforce once placement is free-roam across the whole scene.
    {
      id: `${g.id}-free`,
      surfaceType: "freeform",
      shape: freePlacementShape(),
      allowedRelicTypes: SUBTYPES_BY_CATEGORY[g.category] ?? [],
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
