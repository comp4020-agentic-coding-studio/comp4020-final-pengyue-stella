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

// An 8-point anchor arrangement for a gallery's display slots: two rows —
// a lower row of five sitting on the room's own floor-level furniture
// (plinths/tables/cabinet tops every reference composition shows along the
// bottom two-thirds) and an upper row of three on wall-height shelf/alcove
// positions, clear of the doorway/arch each composition centres near the
// top and clear of VISITOR_ANCHORS below so a donated relic and a visitor
// cameo never occupy the same illustrated spot. Each slot is a small BOX
// (width/height alongside x/z) — kept only as the legacy donation path's
// own addressable id space (server/src/db.js's `slot_id` column, still
// referenced by exhibits donated before the surface model shipped); it is
// never rendered as a placement option to a visitor any more (see
// `placementSurfaces` below, the only thing a donor is offered now).
const SLOT_ANCHORS = [
  { x: 12, z: 70, width: 9, height: 15 },
  { x: 28, z: 78, width: 9, height: 15 },
  { x: 44, z: 72, width: 9, height: 15 },
  { x: 60, z: 78, width: 9, height: 15 },
  { x: 76, z: 72, width: 9, height: 15 },
  { x: 90, z: 66, width: 9, height: 15 },
  { x: 20, z: 40, width: 8, height: 13 },
  { x: 70, z: 40, width: 8, height: 13 },
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
      lore: "The mirror fogs from the edges inward, never from breath. Conservation notes say the fog always clears last around whoever has already looked away.",
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
        text: "The mirror fogs from the edges inward, never from breath. Conservation notes say the fog always clears last around whoever has already looked away.",
        closeupSceneId: "portraits-closeup",
        shape: polygon([[670, 235], [820, 235], [820, 610], [670, 610]]),
      },
      {
        type: "lore",
        label: "The left plinth bust",
        text: "The bust carries no accession record. Staff rotate it a quarter turn at every inventory, to see if a visitor notices it now faces a different way. Someone always does.",
        shape: polygon([[610, 400], [680, 400], [680, 490], [610, 490]]),
      },
      {
        type: "lore",
        label: "The right plinth bust",
        text: "Its twin was catalogued in the same acquisition, but no two inventories since have agreed on which bust is the original and which the copy.",
        shape: polygon([[850, 400], [920, 400], [920, 490], [850, 490]]),
      },
      {
        type: "lore",
        label: "A raven that never blinks",
        text: "It has perched in the same spot since the inventory began. No one recalls uncaging it; no one has ever tried.",
        shape: polygon([[155, 395], [230, 395], [230, 460], [155, 460]]),
      },
      {
        type: "lore",
        label: "The second framed portrait",
        text: "Unsigned, undated, and — by every conservator's measurement — painted in exactly the same hand as the gallery's central portrait, though the museum has never catalogued them as a pair.",
        shape: polygon([[1000, 180], [1150, 180], [1150, 400], [1000, 400]]),
      },
      {
        type: "lore",
        label: "A death's-head bust on the far pedestal",
        text: "Donated anonymously, decades before the gallery itself existed. The donation ledger lists only one line in its entry: 'it asked to come inside.'",
        shape: polygon([[60, 495], [210, 495], [210, 650], [60, 650]]),
      },
      {
        type: "lore",
        label: "An oval wall mirror",
        text: "It reflects the room a half-second late, conservators insist, though no instrument sensitive enough to confirm it has ever been brought in to try.",
        shape: ellipse(462, 285, 42, 58),
      },
      {
        type: "lore",
        label: "A cabinet of pinned moths",
        text: "Each moth is labelled with a date of collection and nothing else — no collector's name, no location, across a span of hand-writing styles that covers at least three centuries.",
        shape: polygon([[1430, 555], [1610, 555], [1610, 710], [1430, 710]]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "The gilt frame's crest",
        text: "The carved cartouche at the frame's crown has no family crest the heralds' office can identify. It has been asked to identify it four separate times, by four separate curators, each unaware the others had already asked.",
        shape: polygon([[145, 0], [285, 0], [285, 45], [145, 45]], PORTRAIT_REF_VIEWBOX),
      },
      {
        type: "lore",
        label: "The receding corridor in the painting",
        text: "Measured against the frame, the painted corridor is longer than the wall it hangs on could physically contain. No restorer has ever proposed correcting the perspective.",
        shape: polygon([[150, 45], [330, 45], [330, 370], [150, 370]], PORTRAIT_REF_VIEWBOX),
      },
      {
        type: "lore",
        label: "A wilting rose at the frame's foot",
        text: "Replaced weekly by a hand no roster accounts for. The replacement is always the same species, always already a little wilted.",
        shape: ellipse(22, 175, 24, 48, PORTRAIT_REF_VIEWBOX),
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
      lore: "Every drawer is catalogued; no two catalogues agree on a date. Objects That Remember keeps the disagreements as carefully as the objects.",
    },
    objects: [
      {
        type: "lore",
        label: "Look closer: The Long Cabinet",
        text: "Every drawer is catalogued; no two catalogues agree on a date. Objects That Remember keeps the disagreements as carefully as the objects.",
        closeupSceneId: "memento-closeup",
        shape: polygon([[700, 480], [1000, 480], [1000, 650], [700, 650]]),
      },
      {
        type: "lore",
        label: "A standing clock",
        text: "The clock keeps the time of a city three hours away. No one here has reset it. No one is certain it is wrong.",
        shape: polygon([[1480, 215], [1560, 215], [1560, 300], [1480, 300]]),
      },
      {
        type: "lore",
        label: "A locked drawer",
        text: "Every other drawer in the cabinet opens freely. This one has never been recorded unlocked, and no key has ever been catalogued for it.",
        shape: polygon([[770, 560], [930, 560], [930, 630], [770, 630]]),
      },
      {
        type: "lore",
        label: "A watchful owl on the high shelf",
        text: "Taxidermied, the ledger insists, though no preparator's name is attached to the mount, and its head has been found facing a different corner of the room at the start of more than one shift.",
        shape: polygon([[1430, 10], [1600, 10], [1600, 150], [1430, 150]]),
      },
      {
        type: "lore",
        label: "A gilt standing mirror",
        text: "Visitors report it holds their reflection a beat longer than they turned away for. Staff log the complaint, politely, and change nothing.",
        shape: ellipse(88, 365, 38, 78),
      },
      {
        type: "lore",
        label: "A brass armillary globe",
        text: "Its rings are set to a sky that matches no hemisphere's stars as drawn. An astronomer consulted twice has twice declined to say more on the record.",
        shape: ellipse(320, 565, 90, 90),
      },
      {
        type: "lore",
        label: "A mounted bird mid-call",
        text: "Perched exactly as it was catalogued in 1889, mid-song, beak open. No recording of the call it was meant to be making has ever been found in the archive.",
        shape: polygon([[1175, 280], [1265, 280], [1265, 420], [1175, 420]]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "A small locked chest in the lowest drawer",
        text: "Catalogued as empty. Weighed twice since, at two different conservators' insistence, and found slightly heavier each time.",
        shape: polygon([[55, 230], [200, 230], [200, 330], [55, 330]], CABINET_REF_VIEWBOX),
      },
      {
        type: "lore",
        label: "A cracked hourglass",
        text: "The sand no longer falls, but the top chamber is never quite as full as the bottom should allow for.",
        shape: polygon([[225, 95], [280, 95], [280, 220], [225, 220]], CABINET_REF_VIEWBOX),
      },
      {
        type: "lore",
        label: "A twinned pair of pocket-watches",
        text: "Wound on the same schedule for forty years. They have never, in any inspection on record, shown the same time as each other.",
        shape: polygon([[295, 110], [360, 110], [360, 185], [295, 185]], CABINET_REF_VIEWBOX),
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
      lore: "Logged as botanical in 1911, biological in 1958, and 'undetermined — do not reclassify again' in 2003. The jar has not been opened since.",
      closeupCamera: { initialPan: 50, minPan: 30, maxPan: 70, initialZoom: 1.7, minZoom: 1.5, maxZoom: 2.3 },
    },
    objects: [
      {
        type: "lore",
        label: "Look closer: Under Glass",
        text: "Logged as botanical in 1911, biological in 1958, and 'undetermined — do not reclassify again' in 2003. The jar has not been opened since.",
        closeupSceneId: "specimen-closeup",
        shape: polygon([[850, 400], [1080, 400], [1080, 560], [850, 560]]),
      },
      {
        type: "lore",
        label: "The skeletal figure on the shelf",
        text: "Collection records list only one sculpture for this gallery. Nobody currently on staff remembers the other one arriving, nor can anyone say with confidence what species it was assembled to represent.",
        shape: polygon([[560, 130], [700, 130], [700, 400], [560, 400]]),
      },
      {
        type: "lore",
        label: "The caged glow beyond the arch",
        text: "Logged as 'garden lighting' in every inventory since 1920. No garden has ever been found on the other side of that arch.",
        shape: polygon([[1000, 150], [1250, 150], [1250, 500], [1000, 500]]),
      },
      {
        type: "lore",
        label: "A glass dome over a glowing skull",
        text: "The glow has never dimmed since the dome was first sealed, by nobody now on record, over a specimen nobody now on record can name.",
        shape: ellipse(145, 600, 85, 100),
      },
      {
        type: "lore",
        label: "A mounted skeletal fawn",
        text: "Reassembled, according to the tag, 'in the order it was found' — a phrasing conservation has never been comfortable repeating aloud.",
        shape: polygon([[565, 170], [700, 170], [700, 400], [565, 400]]),
      },
      {
        type: "lore",
        label: "A preserved butterfly wall",
        text: "Some specimens are pinned facing the glass, wings spread for viewing. A few, inexplicably, are pinned facing the wall.",
        shape: polygon([[90, 60], [305, 60], [305, 300], [90, 300]]),
      },
      {
        type: "lore",
        label: "A taxidermied bird of prey",
        text: "Catalogued three separate times under three separate species names, each correction filed by a different ornithologist who never consulted the last.",
        shape: polygon([[1490, 20], [1640, 20], [1640, 220], [1490, 220]]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "An ammonite fossil under glass",
        text: "Its spiral runs the wrong direction for its catalogued species — a detail noted once, in pencil, in the margin of a logbook nobody has been able to relocate since.",
        shape: polygon([[390, 430], [480, 430], [480, 520], [390, 520]], ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "A cluster of raw crystal",
        text: "It is faintly warm at the centre of the cluster, year-round, and no geologist asked to explain it has agreed to put a theory in writing.",
        shape: polygon([[680, 440], [770, 440], [770, 530], [680, 530]], ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "The glowing moss within the case",
        text: "It has never been watered, fed, or replaced, and has not visibly grown or withered in any photograph spanning the gallery's recorded history.",
        shape: polygon([[900, 460], [975, 460], [975, 540], [900, 540]], ZOOM_CLOSEUP_VIEWBOX),
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
      lore: "The shelf is dusted every week, the gap on the third row included, around whatever used to sit there.",
      closeupCamera: { initialPan: 28, minPan: 10, maxPan: 50, initialZoom: 1.6, minZoom: 1.4, maxZoom: 2.2 },
    },
    objects: [
      {
        type: "lore",
        label: "Look closer: The Shelf That Waits",
        text: "The shelf is dusted every week, the gap on the third row included, around whatever used to sit there.",
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
        label: "The waiting cot",
        text: "It is turned down fresh every morning. The nursery has had no occupant on record for longer than any living curator can confirm.",
        shape: polygon([[1042, 438], [1078, 430], [1150, 427], [1192, 434], [1202, 458], [1198, 480], [1202, 520], [1198, 555], [1188, 570], [1150, 575], [1085, 573], [1050, 565], [1043, 540], [1038, 490]]),
      },
      {
        type: "lore",
        label: "A castle puppet-theatre diorama",
        text: "Wound once a century, according to the plaque, though no mechanism to wind it has ever been found. It has changed scenes twice in living memory, always overnight.",
        shape: polygon([[180, 150], [360, 145], [365, 345], [175, 350]]),
      },
      {
        type: "lore",
        label: "A rocking horse worn smooth",
        text: "Its paint is worn through at the saddle and nowhere else, in a pattern consistent with decades of riding the collection has no record of ever permitting.",
        shape: polygon([[90, 400], [150, 392], [195, 398], [225, 392], [245, 420], [238, 450], [225, 460], [228, 480], [235, 520], [225, 555], [205, 580], [195, 610], [165, 612], [170, 580], [150, 560], [120, 562], [100, 590], [80, 610], [60, 600], [70, 560], [85, 520], [78, 480], [88, 450], [75, 430]]),
      },
      {
        type: "lore",
        label: "A carousel beneath a glass dome",
        text: "It turns, very slowly, without a key, a motor, or a draft to explain it. Conservation has measured the rotation and confirmed only that it is consistent.",
        shape: ellipse(296, 592, 62, 66),
      },
      {
        type: "lore",
        label: "A ballerina music box beneath the moon window",
        text: "The figure completes one full turn for every visitor who pauses here, never more, never fewer, by a count nobody has admitted to keeping.",
        shape: polygon([[1416, 307], [1423, 307], [1427, 315], [1425, 323], [1430, 330], [1446, 348], [1440, 356], [1423, 360], [1420, 382], [1420, 398], [1412, 400], [1408, 398], [1407, 382], [1403, 360], [1392, 356], [1390, 348], [1402, 330], [1407, 323], [1405, 315]]),
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
        label: "A dark trunk bound in gilt",
        text: "Logged in every inventory as 'empty, pending contents.' It has been logged that way since the gallery opened, and no curator has thought to correct it.",
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
        shape: ellipse(183, 687, 33, 32),
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
        label: "A doll behind the cabinet glass",
        text: "Catalogued separately from the doll on the opposite shelf, though conservation's own notes describe them in identical handwriting, word for word, down to the punctuation.",
        shape: polygon([[1600, 265], [1610, 268], [1615, 280], [1613, 292], [1618, 305], [1616, 320], [1618, 335], [1613, 350], [1618, 358], [1600, 362], [1588, 358], [1592, 345], [1588, 330], [1590, 310], [1586, 295], [1590, 280], [1593, 270]]),
      },
    ],
    closeupObjects: [
      {
        type: "lore",
        label: "The worn teddy bear",
        text: "Mended the same way, by the same uneven stitch, every time the seam reopens — though no conservator currently on staff has ever been asked to do the mending.",
        shape: polygon([[533, 409], [622, 409], [622, 495], [533, 495]], ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "The second rocking horse, further back",
        text: "Identical to the one nearer the door, down to the same worn saddle patch, though the ledger lists only a single horse ever acquired.",
        shape: polygon([[868, 432], [1010, 432], [1010, 583], [868, 583]], ZOOM_CLOSEUP_VIEWBOX),
      },
      {
        type: "lore",
        label: "The crib's carved headboard",
        text: "Carved with a lullaby in a script the museum's own linguists have never fully translated, past the first and last lines.",
        shape: polygon([[1066, 440], [1206, 440], [1206, 585], [1066, 585]], ZOOM_CLOSEUP_VIEWBOX),
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
const DONOR_COUNTER_SHAPE = polygon([[10, 455], [290, 440], [300, 600], [300, 700], [15, 700], [5, 600]]);

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
      [320, 335], [350, 345], [370, 400], [375, 430], [375, 600], [270, 600], [270, 430], [275, 400], [295, 345],
    ]),
  },
  { galleryId: "memento", doorShape: polygon([[503, 385], [650, 385], [650, 655], [503, 655]]) },
  { galleryId: "specimen", doorShape: polygon([[1030, 390], [1180, 390], [1180, 655], [1030, 655]]) },
  {
    galleryId: "childhood",
    doorShape: polygon([[1350, 195], [1300, 245], [1298, 440], [1415, 440], [1413, 245]]),
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
    text: "Every candle on the lowest tier burns down at the same rate, night after night, regardless of how many visitors pass beneath it. The upper two tiers have never been lit in any record staff can find.",
    shape: ellipse(805, 100, 215, 105),
    hitPadding: 8,
  },
  {
    id: "hall-guardian-left",
    type: "lore",
    label: "The left guardian",
    text: "Catalogued as a griffin, though no two inventories describe the same number of wings. It faces the staircase in every photograph taken of this hall since the museum opened — except one, filed separately, which nobody will say where it is now.",
    shape: polygon([
      [452, 118], [470, 120], [495, 145], [500, 168], [518, 192], [508, 212], [515, 250], [524, 288],
      [503, 328], [492, 356], [428, 358], [398, 340], [383, 303], [383, 248], [388, 188], [408, 148], [428, 122],
    ]),
    hitPadding: 3,
  },
  {
    id: "hall-guardian-right",
    type: "lore",
    label: "The right guardian",
    text: "Its twin, supposedly. Conservation measured a half-centimetre difference in wingspan between the two in 1964 and has re-measured every decade since. The difference has never been the same number twice.",
    shape: polygon([
      [1205, 188], [1242, 200], [1235, 228], [1270, 138], [1332, 160], [1322, 280], [1290, 332],
      [1278, 340], [1272, 405], [1172, 408], [1148, 370], [1150, 298], [1160, 250], [1175, 205],
    ]),
    hitPadding: 3,
  },
  {
    id: "hall-compass",
    type: "lore",
    label: "The floor compass mosaic",
    text: "A star-and-compass mosaic set directly before the stair. Cleaning staff report it is always faintly warm to the touch, in every season, regardless of the hall's own temperature.",
    shape: ellipse(845, 785, 345, 135),
  },
  {
    id: "hall-map",
    type: "guide",
    label: "The antique map",
    text: "A folded map of a coastline that matches no surveyed country. It has been re-folded along the same creases for as long as anyone has worked here, though no one admits to doing it.",
    shape: polygon([[1352, 463], [1452, 470], [1458, 635], [1300, 643], [1295, 477]]),
    hitPadding: 6,
  },
  {
    id: "hall-clock",
    type: "lore",
    label: "The mechanical clock",
    text: "A brass-and-wood clock that keeps correct time, checked against the city's own civic clock every month without fail. Staff still avoid being alone with it at the top of the hour.",
    shape: polygon([
      [1582, 243], [1592, 255], [1588, 278], [1620, 288], [1648, 300], [1655, 330], [1652, 420], [1650, 480],
      [1652, 560], [1640, 600], [1495, 600], [1490, 560], [1488, 480], [1486, 420], [1492, 330], [1500, 300],
      [1528, 288], [1562, 278], [1558, 255],
    ]),
    hitPadding: 2,
  },
  {
    id: "hall-guestbook",
    type: "lore",
    label: "The chained guestbook",
    text: "Chained to its podium, like a book meant never to leave, though several names inside are of visitors who the front desk has no record of ever admitting.",
    shape: polygon([
      [1495, 600], [1640, 600], [1648, 615], [1648, 640], [1660, 660], [1660, 840],
      [1440, 840], [1440, 660], [1450, 640], [1450, 615],
    ]),
    hitPadding: 4,
  },
  {
    id: "hall-angel",
    type: "lore",
    label: "The watching angel",
    text: "Perched above the stair on its own pedestal, wings half-spread as though it only just landed there. Night staff swear its shadow falls the wrong way for where the moon window sits, and no one has ever caught it mid-turn, only ever already turned.",
    shape: polygon([
      [838, 328], [845, 328], [858, 336], [876, 345], [888, 344], [880, 358], [866, 378], [870, 392],
      [872, 428], [808, 428], [810, 392], [814, 378], [800, 358], [792, 344], [804, 345], [822, 336],
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
