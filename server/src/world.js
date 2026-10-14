// Static world layout: one Entrance Hall with four galleries off it, laid
// out on a plus-shape around the origin. This is config, not stored data —
// `galleries` and `display_slots` rows are seeded from exactly this at
// startup (see db.js) and never created through the public API; only a
// slot's occupied_exhibit_id ever changes. Shared vocabulary with
// constants.js's GALLERY_CATEGORY: each gallery accepts exactly one
// exhibit category, so "which gallery does a donation belong in" is never
// ambiguous.
//
// Coordinates are world units on the floor plane (x right, z forward,
// Three.js convention) shared by both camera rigs and by collision — see
// CLAUDE.md's "one coordinate system, two camera rigs" rule. Walkable
// regions are axis-aligned rectangles; collision is "stay inside the union
// of these rectangles," resolved identically on every client regardless of
// which camera is active.

import { SUBTYPES_BY_CATEGORY } from "./constants.js";

const HALL_BOUNDS = { minX: -7, maxX: 7, minZ: -5, maxZ: 5 };

// Corridors deliberately OVERLAP the hall and gallery bounds they connect
// (rather than exactly abutting them) by more than 2x the avatar's collision
// radius (movement.js's RADIUS). Collision shrinks each rect's walkable
// interior inward by that radius before testing/clamping a point into it;
// two rects that only touch at a shared edge then have no radius-shrunk
// interior in common, so a visitor walking toward the seam gets clamped
// back into whichever rect they're currently in and can never cross it —
// caught by actually walking through the app, not by reading the collision
// code (the clamp logic alone looks correct in isolation).
const OVERLAP = 1.2;

// id, direction off the hall, and which of the room's four walls faces back
// toward the hall (so slot placement below can avoid blocking that wall).
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

  const slots = [];
  let n = 0;
  for (const [side, wall] of Object.entries(walls)) {
    const span = wall.axis === "x" ? [minX, maxX] : [minZ, maxZ];
    const a = span[0] + (span[1] - span[0]) * 0.3;
    const b = span[0] + (span[1] - span[0]) * 0.7;
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

// Every rectangle an avatar may stand in: the hall, each connecting
// corridor, each gallery. Collision (both client render and the server's
// coarse sanity check) is "is this point inside at least one of these."
export const WALKABLE_RECTS = [
  HALL_BOUNDS,
  ...GALLERIES.flatMap((g) => [g.bounds, g.corridor]),
];

export function isWalkable(x, z) {
  return WALKABLE_RECTS.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}

// Wall geometry, computed once here so the client never has to re-derive
// "where's the gap" itself and risk disagreeing with the collision rects
// above — both come from the same corridor/doorSide data.
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
// door axis), full length, no gap — purely visual, collision is already the
// corridor rect itself.
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

export const SPAWN = { x: 0, z: 0, yaw: 0 };

// The donor counter: an interactive hotspot in the hall, not tied to any one
// gallery.
export const DONOR_COUNTER = { x: 0, z: -3.5 };

export function hallConfig() {
  return { bounds: HALL_BOUNDS, donorCounter: DONOR_COUNTER };
}

// The shape a client needs to build the scene and resolve collision —
// nothing server-only (no DB ids beyond what's already public).
export function publicWorld() {
  return {
    hall: hallConfig(),
    spawn: SPAWN,
    walls: wallSegments(),
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
