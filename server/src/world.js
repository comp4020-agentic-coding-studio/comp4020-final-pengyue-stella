// Static world layout. The museum is one Entrance Hall with four galleries
// off it — `galleries` and `display_slots` rows are seeded from exactly this
// at startup (see db.js) and never created through the public API; only a
// slot's occupied_exhibit_id ever changes. Shared vocabulary with
// constants.js's GALLERY_CATEGORY: each gallery accepts exactly one exhibit
// category, so "which gallery does a donation belong in" is never ambiguous.
//
// What changed in the illustrated-scene presentation pass: the museum is no
// longer a live Three.js room the camera walks through. Each scene is a
// full-bleed illustrated image (public/assets/gallery-scenes/) with hotspots
// and display slots positioned as percentage anchors ({x, z} in 0-100,
// reused from the old 3D coordinate fields rather than renamed, so the
// display_slots schema and this module's existing consumers — db.js's
// GALLERIES, server.js's galleryById/publicWorld, the scene-graph spec —
// never had to change shape, only meaning: "where on the floor" became
// "where on the picture." `rotationY` is vestigial (every card renders
// upright) and kept at 0 only because the column already exists and
// CLAUDE.md asks for no gratuitous schema churn.

import { SUBTYPES_BY_CATEGORY } from "./constants.js";

// A generic 6-point anchor arrangement for a gallery's display slots: a
// loose two-row arc sitting in the lower two-thirds of the frame, clear of
// the doorway/arch each reference photo centres near the top. Shared across
// galleries rather than hand-tuned per image — the exhibit cards are
// deliberately dimensional overlays (CLAUDE.md's "slightly dimensional
// Gothic display cards"), not objects that need to align with a specific
// painted shelf pixel-for-pixel.
const SLOT_ANCHORS = [
  { x: 14, z: 68 },
  { x: 32, z: 76 },
  { x: 50, z: 70 },
  { x: 68, z: 76 },
  { x: 86, z: 68 },
  { x: 50, z: 58 },
];

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
    mainLore: {
      label: "A nameless bust",
      text: "The bust carries no accession record. Staff rotate it a quarter turn at every inventory, to see if a visitor notices it now faces a different way. Someone always does.",
    },
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
    mainLore: {
      label: "A standing clock",
      text: "The clock keeps the time of a city three hours away. No one here has reset it. No one is certain it is wrong.",
    },
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
    },
    mainLore: {
      label: "A second bust",
      text: "Collection records list only one sculpture for this gallery. Nobody currently on staff remembers the other one arriving.",
    },
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
    },
    mainLore: {
      label: "A doll on the left",
      text: "It blinks on its own schedule, roughly once an hour, always when the gallery is otherwise empty of visitors. Staff have stopped checking.",
    },
  },
];

export const GALLERIES = GALLERY_LAYOUT.map((g) => ({
  ...g,
  slots: SLOT_ANCHORS.map((a, i) => ({ id: `${g.id}_slot_${i}`, x: a.x, z: a.z, rotationY: 0 })),
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

// The donor counter: an atmospheric secondary entrance point in the hall —
// a real in-world hotspot kept for flavour, but (per the product direction)
// no longer the only way to discover donation; see the persistent "Donate a
// Relic" action the client always renders.
export const DONOR_COUNTER = { x: 50, z: 80 };

export function hallConfig() {
  return { image: "entrance", donorCounter: DONOR_COUNTER };
}

// ---------------------------------------------------------------------------
// Scenes: a small fixed graph of illustrated vantages + the hotspots
// reachable from each one. A visitor is always exactly "at" one scene id;
// `POST /api/presence` reports which one (see server.js). Every hotspot
// carries a percentage `anchor` ({x, z} in 0-100) the client positions as a
// plain CSS `left`/`top` over the current scene's background image — there
// is no camera, no projection math, no frustum to stay inside, which is the
// entire point of trading a live 3D room for an illustrated one.

// The hub: four "facings," one per doorway, turned between — same single
// entrance illustration, a different doorway highlighted/panned-to each
// time, in the spirit of turning your head inside one real room rather than
// four different photographs. `hall-s` (facing the donor counter and the
// childhood doorway) is the default spawn facing.
const HALL_FACINGS = [
  { dir: "n", galleryId: "portraits", doorAnchor: { x: 50, z: 20 } },
  { dir: "e", galleryId: "memento", doorAnchor: { x: 84, z: 46 } },
  { dir: "s", galleryId: "childhood", doorAnchor: { x: 50, z: 86 } },
  { dir: "w", galleryId: "specimen", doorAnchor: { x: 15, z: 46 } },
];

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
        anchor: facing.doorAnchor,
        label: `Enter ${gallery.name}`,
      },
    ];
    if (facing.dir === "s") {
      hotspots.push({
        id: "hall-donate",
        type: "donate",
        anchor: DONOR_COUNTER,
        label: "Donate a Relic",
      });
    }
    return {
      id: `hall-${facing.dir}`,
      kind: "hub",
      galleryId: null,
      parentSceneId: null,
      caption: "Entrance Hall",
      image: "entrance",
      panTo: facing.doorAnchor,
      hotspots,
      turnLeft: order[(i + order.length - 1) % order.length],
      turnRight: order[(i + 1) % order.length],
    };
  });
}

// A main gallery scene's own fixed hotspot anchors — placed to clear both
// the doorway/arch (usually upper-centre in these reference compositions)
// and the display-slot arc (SLOT_ANCHORS, lower two-thirds), the same
// separation-of-concerns `hotspotNear` used to enforce via camera math in
// the old 3D version, done here by simple layout instead.
function buildGalleryScenes(gallery) {
  const closeup = gallery.closeup;
  const lore = gallery.mainLore;
  const mainScene = {
    id: `${gallery.id}-main`,
    kind: "main",
    galleryId: gallery.id,
    parentSceneId: HALL_FACING_BY_GALLERY[gallery.id],
    caption: gallery.name,
    image: gallery.image,
    hotspots: [
      {
        id: `${gallery.id}-exit-door`,
        type: "door",
        targetSceneId: HALL_FACING_BY_GALLERY[gallery.id],
        anchor: { x: 8, z: 14 },
        label: "Back to the Entrance Hall",
      },
      {
        id: `${gallery.id}-closeup-door`,
        type: "closeup",
        targetSceneId: `${gallery.id}-closeup`,
        anchor: { x: 50, z: 20 },
        label: `Look closer: ${closeup.caption}`,
      },
      {
        id: `${gallery.id}-lore`,
        type: "lore",
        anchor: { x: 92, z: 16 },
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
    image: closeup.image,
    zoom: closeup.zoom ?? false,
    lore: closeup.lore,
    hotspots: [
      {
        id: `${gallery.id}-closeup-back`,
        type: "back",
        targetSceneId: `${gallery.id}-main`,
        anchor: { x: 50, z: 90 },
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

// The shape a client needs to build the illustrated scenes and populate the
// hotspot/exhibit-card overlay — nothing server-only (no DB ids beyond
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
      slots: g.slots.map((s) => ({ id: s.id, x: s.x, z: s.z, rotationY: s.rotationY })),
    })),
  };
}
