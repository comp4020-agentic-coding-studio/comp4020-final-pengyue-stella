// Static world layout. The museum is still one Entrance Hall with four
// galleries off it, laid out on a plus-shape around the origin — `galleries`
// and `display_slots` rows are seeded from exactly this at startup (see
// db.js) and never created through the public API; only a slot's
// occupied_exhibit_id ever changes. Shared vocabulary with constants.js's
// GALLERY_CATEGORY: each gallery accepts exactly one exhibit category, so
// "which gallery does a donation belong in" is never ambiguous.
//
// What changed in the pivot to 2.5D scene exploration (see
// docs/adr/0003-scene-exploration.md): there is no more walkable floor plan
// or collision — a visitor is never "at" an (x, z) position between rooms.
// Instead this file also defines SCENES: a small fixed graph of named
// camera vantage points (a hub facing each gallery doorway, one main view
// per gallery, one close-up per gallery's hero display) connected by
// hotspots. Coordinates below are still world units on the floor plane (x
// right, z forward, Three.js convention) because the client builds one
// continuous Three.js scene graph from this same geometry (walls, slots,
// furniture) exactly as before — only the camera now jumps between fixed
// vantages instead of walking continuously through it.

import { SUBTYPES_BY_CATEGORY } from "./constants.js";

const HALL_BOUNDS = { minX: -7, maxX: 7, minZ: -5, maxZ: 5 };

// Corridors deliberately OVERLAP the hall and gallery bounds they connect
// (rather than exactly abutting them), a carry-over from when this overlap
// mattered for collision shrink-to-fit; kept now purely so the wall-gap
// math below (crossSpan/wallsForRect) still describes the same doorway
// openings the client's wall geometry has always used.
const OVERLAP = 1.2;

// id, direction off the hall, and which of the room's four walls faces back
// toward the hall (so slot placement and the gallery's own fixed camera
// vantage both avoid the doorway wall).
const GALLERY_LAYOUT = [
  {
    id: "portraits",
    name: "The Portraits That Watch",
    category: "portrait",
    accent: "#663D43",
    orderIndex: 0,
    bounds: { minX: -9, maxX: 9, minZ: 9, maxZ: 23 },
    corridor: { minX: -2, maxX: 2, minZ: HALL_BOUNDS.maxZ - OVERLAP, maxZ: 9 + OVERLAP },
    doorSide: "south", // the wall nearest the hall
    doorway: { x: 0, z: 9 },
  },
  {
    id: "memento",
    name: "Objects That Remember",
    category: "memento",
    accent: "#88653D",
    orderIndex: 1,
    bounds: { minX: 9, maxX: 23, minZ: -9, maxZ: 9 },
    corridor: { minX: HALL_BOUNDS.maxX - OVERLAP, maxX: 9 + OVERLAP, minZ: -2, maxZ: 2 },
    doorSide: "west",
    doorway: { x: 9, z: 0 },
  },
  {
    id: "specimen",
    name: "The Cabinet of Impossible Life",
    category: "specimen",
    accent: "#4A5A3D",
    orderIndex: 2,
    bounds: { minX: -23, maxX: -9, minZ: -9, maxZ: 9 },
    corridor: { minX: -9 - OVERLAP, maxX: HALL_BOUNDS.minX + OVERLAP, minZ: -2, maxZ: 2 },
    doorSide: "east",
    doorway: { x: -9, z: 0 },
  },
  {
    id: "childhood",
    name: "The Forgotten Childhood",
    category: "toy",
    accent: "#C6A16B",
    orderIndex: 3,
    bounds: { minX: -9, maxX: 9, minZ: -23, maxZ: -9 },
    corridor: { minX: -2, maxX: 2, minZ: -9 - OVERLAP, maxZ: HALL_BOUNDS.minZ + OVERLAP },
    doorSide: "north",
    doorway: { x: 0, z: -9 },
  },
];

// Six slots per gallery: two along the far wall (away from the hall), two
// along each side wall. Generic over which wall is the "door wall" so the
// four galleries don't need four hand-written slot lists.
//
// The two side walls (the walls adjacent to the doorway, running along the
// same axis the room's own depth runs along — e.g. east/west for a
// south-facing door) are biased close to the far end of the room (0.92-0.98
// of the depth span, not 0.3-0.7): roomVantage's camera stands only
// ROOM_INSET inside the doorway, so a side-wall slot placed near the door
// end sits almost level with the camera rather than out in front of it —
// an angle no amount of FOV tuning fixes, only placement does. This bias is
// deliberately aggressive (not just "far enough for a wide desktop
// screen"): checked directly against every gallery's actual vantage down to
// a typical phone-portrait aspect ratio (~0.46, an iPhone's CSS viewport),
// not just the wide reference aspect `exploration.js`'s FOV correction is
// authored against — CLAUDE.md requires every interaction to work on a
// touchscreen, and a phone held upright is the ordinary case, not an edge
// case, for that requirement.
const DOOR_NEAR_FAR = {
  south: { depthAxis: "z", near: "minZ", far: "maxZ" },
  north: { depthAxis: "z", near: "maxZ", far: "minZ" },
  west: { depthAxis: "x", near: "minX", far: "maxX" },
  east: { depthAxis: "x", near: "maxX", far: "minX" },
};

function wallSlots(bounds, doorSide) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const inset = 1.4;
  const walls = {
    north: { at: maxZ - inset, axis: "x", rotationY: Math.PI },
    south: { at: minZ + inset, axis: "x", rotationY: 0 },
    east: { at: maxX - inset, axis: "z", rotationY: -Math.PI / 2 },
    west: { at: minX + inset, axis: "z", rotationY: Math.PI / 2 },
  };
  delete walls[doorSide];

  const { depthAxis, near, far } = DOOR_NEAR_FAR[doorSide];
  const rectValues = { minX, maxX, minZ, maxZ };

  const slots = [];
  let n = 0;
  for (const [side, wall] of Object.entries(walls)) {
    const span = wall.axis === "x" ? [minX, maxX] : [minZ, maxZ];
    const isSideWall = wall.axis === depthAxis;
    const [ta, tb] = isSideWall ? [0.97, 0.99] : [0.3, 0.7];
    const a = isSideWall
      ? rectValues[near] + (rectValues[far] - rectValues[near]) * ta
      : span[0] + (span[1] - span[0]) * ta;
    const b = isSideWall
      ? rectValues[near] + (rectValues[far] - rectValues[near]) * tb
      : span[0] + (span[1] - span[0]) * tb;
    for (const pos of [a, b]) {
      const x = wall.axis === "x" ? pos : wall.at;
      const z = wall.axis === "x" ? wall.at : pos;
      slots.push({ id: `slot_${side}_${n++}`, x, z, rotationY: wall.rotationY });
    }
  }
  return slots;
}

export const GALLERIES = GALLERY_LAYOUT.map((g) => ({
  ...g,
  slots: wallSlots(g.bounds, g.doorSide).map((s) => ({ ...s, id: `${g.id}_${s.id}` })),
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

// Wall geometry, computed once here so the client never has to re-derive
// "where's the gap" itself and risk disagreeing about where a doorway
// actually is — both the slot layout above and the scene vantages/hotspots
// below come from this same corridor/doorSide data.
function sideSpan(rect, side) {
  return side === "north" || side === "south" ? [rect.minX, rect.maxX] : [rect.minZ, rect.maxZ];
}
function sideFixed(rect, side) {
  if (side === "north") return rect.maxZ;
  if (side === "south") return rect.minZ;
  if (side === "east") return rect.maxX;
  return rect.minX; // west
}
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };

function wallsForRect(rect, gapsBySide, color) {
  const segs = [];
  for (const side of ["north", "south", "east", "west"]) {
    const [spanMin, spanMax] = sideSpan(rect, side);
    const fixed = sideFixed(rect, side);
    const gap = gapsBySide[side];
    const axis = side === "north" || side === "south" ? "x" : "z";
    const pieces = gap ? [[spanMin, gap[0]], [gap[1], spanMax]] : [[spanMin, spanMax]];
    for (const [a, b] of pieces) {
      if (b - a <= 0.05) continue;
      segs.push(
        axis === "x"
          ? { x1: a, z1: fixed, x2: b, z2: fixed, color }
          : { x1: fixed, z1: a, x2: fixed, z2: b, color },
      );
    }
  }
  return segs;
}

function crossSpan(corridor, doorSide) {
  return doorSide === "north" || doorSide === "south"
    ? [corridor.minX, corridor.maxX]
    : [corridor.minZ, corridor.maxZ];
}

// Two framing walls along a corridor's long sides (perpendicular to the
// door axis), full length, no gap — purely visual.
function corridorWalls(corridor, doorSide, color) {
  if (doorSide === "north" || doorSide === "south") {
    return [
      { x1: corridor.minX, z1: corridor.minZ, x2: corridor.minX, z2: corridor.maxZ, color },
      { x1: corridor.maxX, z1: corridor.minZ, x2: corridor.maxX, z2: corridor.maxZ, color },
    ];
  }
  return [
    { x1: corridor.minX, z1: corridor.minZ, x2: corridor.maxX, z2: corridor.minZ, color },
    { x1: corridor.minX, z1: corridor.maxZ, x2: corridor.maxX, z2: corridor.maxZ, color },
  ];
}

const HALL_COLOR = "#35251C";
const hallGaps = {};
for (const g of GALLERY_LAYOUT) {
  hallGaps[OPPOSITE[g.doorSide]] = crossSpan(g.corridor, g.doorSide);
}

export function wallSegments() {
  const walls = [...wallsForRect(HALL_BOUNDS, hallGaps, HALL_COLOR)];
  for (const g of GALLERIES) {
    walls.push(...wallsForRect(g.bounds, { [g.doorSide]: crossSpan(g.corridor, g.doorSide) }, g.accent));
    walls.push(...corridorWalls(g.corridor, g.doorSide, HALL_COLOR));
  }
  return walls;
}

// The donor counter: an interactive hotspot in the hall, not tied to any one
// gallery.
export const DONOR_COUNTER = { x: 0, z: -3.5 };

export function hallConfig() {
  return { bounds: HALL_BOUNDS, donorCounter: DONOR_COUNTER };
}

// ---------------------------------------------------------------------------
// Scenes: fixed camera vantages + the hotspots reachable from each one. This
// is the entire "exploration model" now — there is no walkable rect, no
// collision, no avatar position. A visitor is always exactly "at" one scene
// id; `POST /api/presence` reports which one (see server.js), and the
// client's camera is a pure function of the active scene's vantage (see
// public/world/exploration.js).

// An "establishing shot" vantage, generic over which wall is the door
// wall — camera stands just inside the doorway, centred on the room's
// cross-axis, looking straight down its depth toward the far wall. Centred
// (rather than a corner-biased diagonal, tried first) because a camera
// standing close to one side wall cannot see much of that same wall at a
// usable angle — half of every gallery's own display slots fell outside
// this vantage's view under that framing, caught by actually computing
// (and then eyeballing in the running app) the view angle to every slot,
// not by how the shot reads in a single screenshot. A centred shot keeps
// both side walls symmetrically in view, which is what the display slots
// actually need.
const ROOM_INSET = 2.3;
function roomVantage(bounds, doorSide) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const w = maxX - minX;
  const d = maxZ - minZ;
  switch (doorSide) {
    case "south":
      return { pos: [minX + w / 2, 1.7, minZ + ROOM_INSET], lookAt: [minX + w / 2, 1.45, maxZ] };
    case "north":
      return { pos: [minX + w / 2, 1.7, maxZ - ROOM_INSET], lookAt: [minX + w / 2, 1.45, minZ] };
    case "west":
      return { pos: [minX + ROOM_INSET, 1.7, minZ + d / 2], lookAt: [maxX, 1.45, minZ + d / 2] };
    default: // east
      return { pos: [maxX - ROOM_INSET, 1.7, minZ + d / 2], lookAt: [minX, 1.45, minZ + d / 2] };
  }
}

// One close-up vantage per gallery, hand-aimed at that gallery's own hero
// display piece (the same furniture `public/world/scene.js`'s furnish*
// functions already place there — see each one's own position comment).
// Original short environmental lore, never attached to a real exhibit
// record: the blueprint's "important environmental objects can have short
// lore text even if they are not full archival exhibits." The main scene's
// own hotspot that leads here is built from `hotspotNear` (a position
// relative to the MAIN vantage, not this one), so this close-up vantage is
// free to point at whichever prop is the gallery's real thematic
// centrepiece without also needing to satisfy some other scene's framing.
const CLOSEUPS = {
  // The free-standing floor mirror (furnishPortraitGallery's
  // `mirror.position.set(cx, 0, bounds.minZ + (bounds.maxZ-bounds.minZ)*0.14)`)
  // — the gallery's own namesake "watching" object.
  portraits: {
    pos: [0, 1.15, 9.5],
    lookAt: [0, 0.85, 10.96],
    fov: 50,
    caption: "The Watching Glass",
    lore: "The mirror fogs from the edges inward, never from breath. Conservation notes say the fog always clears last around whoever has already looked away.",
  },
  memento: {
    pos: [20.0, 1.55, 0],
    lookAt: [22.0, 1.3, 0],
    fov: 50,
    caption: "The Long Cabinet",
    lore: "Every drawer is catalogued; no two catalogues agree on a date. Objects That Remember keeps the disagreements as carefully as the objects.",
  },
  specimen: {
    pos: [-16, 1.25, -5.6],
    lookAt: [-16, 0.95, -3.5],
    fov: 50,
    caption: "Under Glass",
    lore: "Logged as botanical in 1911, biological in 1958, and 'undetermined — do not reclassify again' in 2003. The jar has not been opened since.",
  },
  childhood: {
    pos: [0, 1.15, -20.6],
    lookAt: [0, 1.0, -22.8],
    fov: 50,
    caption: "The Shelf That Waits",
    lore: "The shelf is dusted every week, the gap on the third row included, around whatever used to sit there.",
  },
};

// One additional environmental lore hotspot per gallery main scene — a
// different nearby prop than the close-up's own hero piece, in the spirit
// of whichever thematic object sits at the gallery's `hotspotNear` anchor
// (see buildGalleryScenes). The hotspot's actual clickable position is
// derived from the main vantage itself (`hotspotNear`), not from any
// furniture coordinate here — see that function's own comment for why a
// position borrowed from a different piece of geometry routinely lands
// outside a given vantage's field of view. This table is purely the
// label/lore text content.
const MAIN_LORE = {
  portraits: {
    label: "A nameless bust",
    text: "The bust carries no accession record. Staff rotate it a quarter turn at every inventory, to see if a visitor notices it now faces a different way. Someone always does.",
  },
  memento: {
    label: "A standing clock",
    text: "The clock keeps the time of a city three hours away. No one here has reset it. No one is certain it is wrong.",
  },
  specimen: {
    label: "A second bust",
    text: "Collection records list only one sculpture for this gallery. Nobody currently on staff remembers the other one arriving.",
  },
  childhood: {
    label: "A doll on the left",
    text: "It blinks on its own schedule, roughly once an hour, always when the gallery is otherwise empty of visitors. Staff have stopped checking.",
  },
};

// The hub: not one static shot but four "facings," one per doorway, turned
// between like standing in a room and looking left/right — the blueprint's
// own "arrows, cards, thresholds" scene-to-scene model, applied to the one
// room with more than one exit. `hall-s` (facing the donor counter and the
// childhood doorway) is the default spawn facing.
const HALL_FACINGS = [
  { dir: "n", galleryId: "portraits", lookAt: [0, 1.4, 5], doorAt: [0, 1.6, 4.3] },
  { dir: "e", galleryId: "memento", lookAt: [5, 1.4, 0], doorAt: [6.3, 1.6, 0] },
  { dir: "s", galleryId: "childhood", lookAt: [0, 1.4, -5], doorAt: [0, 1.6, -4.3] },
  { dir: "w", galleryId: "specimen", lookAt: [-5, 1.4, 0], doorAt: [-6.3, 1.6, 0] },
];
const HALL_POS = [0, 1.7, 1.0];

// galleryId -> the hub facing that looks at its doorway, so a gallery's main
// scene can send "back" to the exact facing a visitor would have entered
// from, not an arbitrary default hub facing.
const HALL_FACING_BY_GALLERY = Object.fromEntries(HALL_FACINGS.map((f) => [f.galleryId, `hall-${f.dir}`]));

function buildHallScenes() {
  const order = HALL_FACINGS.map((f) => `hall-${f.dir}`);
  return HALL_FACINGS.map((facing, i) => {
    const gallery = galleryById(facing.galleryId);
    const hotspots = [
      {
        id: `hall-${facing.dir}-door`,
        type: "door",
        targetSceneId: `${facing.galleryId}-main`,
        pos: facing.doorAt,
        label: `Enter ${gallery.name}`,
      },
    ];
    if (facing.dir === "s") {
      hotspots.push({
        id: "hall-donate",
        type: "donate",
        pos: [DONOR_COUNTER.x, 1.5, DONOR_COUNTER.z],
        label: "Donate a Relic",
      });
    }
    return {
      id: `hall-${facing.dir}`,
      kind: "hub",
      galleryId: null,
      parentSceneId: null,
      caption: "Entrance Hall",
      vantage: { pos: HALL_POS, lookAt: facing.lookAt, fov: 80 },
      hotspots,
      turnLeft: order[(i + order.length - 1) % order.length],
      turnRight: order[(i + 1) % order.length],
    };
  });
}

// Every hotspot needs a real world position to project to screen (see
// public/world/exploration.js's projectToScreen) — a "back" hotspot has no
// natural 3D anchor of its own the way a door or an exhibit does, so this
// places it a short distance in front of the close-up camera, toward what
// it's looking at and nudged down, which reliably lands near the bottom of
// the close-up framing regardless of that gallery's specific angle.
function nearCameraAnchor(pos, lookAt) {
  const t = 0.4;
  return [
    pos[0] + (lookAt[0] - pos[0]) * t,
    pos[1] + (lookAt[1] - pos[1]) * t - 0.15,
    pos[2] + (lookAt[2] - pos[2]) * t,
  ];
}

// Builds a hotspot position directly from a vantage's own forward/right/up
// basis, `forwardDist` out and `lateral`/`vertical` off that centreline —
// rather than reusing some other object's literal world coordinates (a
// furniture placement, a different scene's own vantage target), which
// routinely land at a wide, viewport-dependent angle from THIS vantage's
// specific framing. Every hotspot built this way is, by construction,
// within a bounded, checkable angle of the vantage's own forward
// direction, regardless of the room's actual geometry — this is what the
// earlier literal-coordinate approach needed a separate angle-checking
// script to verify after the fact; this one makes the class of bug
// impossible instead of merely catching it.
function hotspotNear(vantage, { forwardDist, lateral = 0, vertical = 0 }) {
  const [px, py, pz] = vantage.pos;
  const [lx, ly, lz] = vantage.lookAt;
  const fwd = [lx - px, ly - py, lz - pz];
  const fwdLen = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
  const f = [fwd[0] / fwdLen, fwd[1] / fwdLen, fwd[2] / fwdLen];
  // World-up cross forward gives "right" for any horizontal-ish forward
  // vector these vantages use (none look straight up/down).
  const r = [f[2], 0, -f[0]];
  const rLen = Math.hypot(r[0], r[1], r[2]) || 1;
  const right = [r[0] / rLen, r[1] / rLen, r[2] / rLen];
  return [
    px + f[0] * forwardDist + right[0] * lateral,
    py + f[1] * forwardDist + vertical,
    pz + f[2] * forwardDist + right[2] * lateral,
  ];
}

function buildGalleryScenes(gallery) {
  const vantage = { ...roomVantage(gallery.bounds, gallery.doorSide), fov: 78 };
  const closeup = CLOSEUPS[gallery.id];
  const lore = MAIN_LORE[gallery.id];
  const mainScene = {
    id: `${gallery.id}-main`,
    kind: "main",
    galleryId: gallery.id,
    parentSceneId: HALL_FACING_BY_GALLERY[gallery.id],
    caption: gallery.name,
    vantage,
    hotspots: [
      {
        // Anchored near the camera itself (like the close-up's own "back"
        // hotspot below), not at the doorway's real world position: this
        // room's vantage deliberately stands just inside the doorway
        // looking AWAY from it, toward the room's far corner (see
        // roomVantage), so a hotspot placed at the literal doorway
        // coordinates would sit behind the camera and never actually be
        // visible/clickable from this framing — caught by actually
        // clicking through the app, not by reading the vantage math.
        id: `${gallery.id}-exit-door`,
        type: "door",
        targetSceneId: HALL_FACING_BY_GALLERY[gallery.id],
        pos: nearCameraAnchor(vantage.pos, vantage.lookAt),
        label: "Back to the Entrance Hall",
      },
      {
        id: `${gallery.id}-closeup-door`,
        type: "closeup",
        targetSceneId: `${gallery.id}-closeup`,
        pos: hotspotNear(vantage, { forwardDist: 7, lateral: -2.5 }),
        label: `Look closer: ${closeup.caption}`,
      },
      {
        id: `${gallery.id}-lore`,
        type: "lore",
        pos: hotspotNear(vantage, { forwardDist: 7, lateral: 2.5 }),
        label: lore.label,
        text: lore.text,
      },
    ],
  };
  const closeupScene = {
    id: `${gallery.id}-closeup`,
    kind: "closeup",
    galleryId: gallery.id,
    parentSceneId: `${gallery.id}-main`,
    caption: closeup.caption,
    vantage: { pos: closeup.pos, lookAt: closeup.lookAt, fov: closeup.fov },
    lore: closeup.lore,
    hotspots: [
      {
        id: `${gallery.id}-closeup-back`,
        type: "back",
        targetSceneId: `${gallery.id}-main`,
        pos: nearCameraAnchor(closeup.pos, closeup.lookAt),
        label: `Back to ${gallery.name}`,
      },
    ],
  };
  return [mainScene, closeupScene];
}

export const SCENES = [...buildHallScenes(), ...GALLERIES.flatMap(buildGalleryScenes)];
export const SCENE_IDS = new Set(SCENES.map((s) => s.id));
export const DEFAULT_SCENE_ID = "hall-n";

export function sceneById(id) {
  return SCENES.find((s) => s.id === id);
}

// The shape a client needs to build the scene and populate the hotspot
// overlay — nothing server-only (no DB ids beyond what's already public).
export function publicWorld() {
  return {
    hall: hallConfig(),
    defaultSceneId: DEFAULT_SCENE_ID,
    walls: wallSegments(),
    scenes: SCENES,
    galleries: GALLERIES.map((g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      accent: g.accent,
      orderIndex: g.orderIndex,
      bounds: g.bounds,
      corridor: g.corridor,
      doorway: g.doorway,
      subtypes: SUBTYPES_BY_CATEGORY[g.category] ?? [],
      slots: g.slots.map((s) => ({ id: s.id, x: s.x, z: s.z, rotationY: s.rotationY })),
    })),
  };
}
