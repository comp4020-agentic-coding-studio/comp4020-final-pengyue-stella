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

import { SUBTYPES_BY_CATEGORY } from "./constants.js";

// A generic 6-point anchor arrangement for a gallery's display slots: a
// loose two-row arc sitting in the lower two-thirds of the frame, clear of
// the doorway/arch each reference composition centres near the top, and
// clear of VISITOR_ANCHORS below so a donated relic and a visitor cameo
// never occupy the same illustrated spot. Each slot is now a small BOX
// (width/height added alongside the existing x/z point), used as the
// placement-mode highlight region and the ghost-preview footprint — shared
// across galleries rather than hand-tuned per image, since the exhibit
// display itself is a dimensional object placed ON the illustration, not
// something that needs to align with a specific painted shelf pixel-for-
// pixel.
const SLOT_ANCHORS = [
  { x: 14, z: 68, width: 10, height: 16 },
  { x: 32, z: 76, width: 10, height: 16 },
  { x: 50, z: 70, width: 10, height: 16 },
  { x: 68, z: 76, width: 10, height: 16 },
  { x: 86, z: 68, width: 10, height: 16 },
  { x: 50, z: 58, width: 10, height: 16 },
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

const HALL_VISITOR_ANCHORS = [
  { x: 10, y: 70, depth: 1.0 },
  { x: 90, y: 70, depth: 1.0 },
  { x: 50, y: 90, depth: 1.15 },
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
const DEFAULT_HUB_CAMERA = { initialPan: 50, minPan: 32, maxPan: 68, initialZoom: 1.12, minZoom: 1.05, maxZoom: 1.45 };

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
      closeupAnchor: { x: 30, y: 10, width: 42, height: 70 },
    },
    // Several intentional built-in objects, each anchored to something
    // actually visible in portraits.webp (the large gilt-framed central
    // portrait, the twin plinth busts flanking the display table, the
    // raven on the left-hand shelf) rather than arbitrary text floated
    // over the picture.
    objects: [
      { type: "closeup", label: "Look closer: The Watching Portrait", anchor: { x: 40, y: 14, width: 18, height: 36 } },
      {
        type: "lore",
        label: "A nameless bust",
        text: "The bust carries no accession record. Staff rotate it a quarter turn at every inventory, to see if a visitor notices it now faces a different way. Someone always does.",
        anchor: { x: 34, y: 46, width: 8, height: 15 },
      },
      {
        type: "lore",
        label: "A raven that never blinks",
        text: "It has perched in the same spot since the inventory began. No one recalls uncaging it; no one has ever tried.",
        anchor: { x: 10, y: 27, width: 7, height: 10 },
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
      closeupAnchor: { x: 15, y: 15, width: 70, height: 65 },
    },
    objects: [
      { type: "closeup", label: "Look closer: The Long Cabinet", anchor: { x: 36, y: 42, width: 26, height: 36 } },
      {
        type: "lore",
        label: "A standing clock",
        text: "The clock keeps the time of a city three hours away. No one here has reset it. No one is certain it is wrong.",
        anchor: { x: 82, y: 12, width: 9, height: 15 },
      },
      {
        type: "lore",
        label: "A locked drawer",
        text: "Every other drawer in the cabinet opens freely. This one has never been recorded unlocked, and no key has ever been catalogued for it.",
        anchor: { x: 46, y: 64, width: 11, height: 10 },
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
      closeupAnchor: { x: 28, y: 40, width: 44, height: 40 },
      closeupCamera: { initialPan: 50, minPan: 30, maxPan: 70, initialZoom: 1.7, minZoom: 1.5, maxZoom: 2.3 },
    },
    objects: [
      { type: "closeup", label: "Look closer: Under Glass", anchor: { x: 38, y: 54, width: 24, height: 26 } },
      {
        type: "lore",
        label: "A second bust",
        text: "Collection records list only one sculpture for this gallery. Nobody currently on staff remembers the other one arriving.",
        anchor: { x: 28, y: 24, width: 11, height: 26 },
      },
      {
        type: "lore",
        label: "The caged glow beyond the arch",
        text: "Logged as 'garden lighting' in every inventory since 1920. No garden has ever been found on the other side of that arch.",
        anchor: { x: 44, y: 14, width: 12, height: 24 },
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
      closeupAnchor: { x: 2, y: 2, width: 48, height: 60 },
      closeupCamera: { initialPan: 28, minPan: 10, maxPan: 50, initialZoom: 1.6, minZoom: 1.4, maxZoom: 2.2 },
    },
    objects: [
      { type: "closeup", label: "Look closer: The Shelf That Waits", anchor: { x: 6, y: 8, width: 24, height: 40 } },
      {
        type: "lore",
        label: "A doll on the left",
        text: "It blinks on its own schedule, roughly once an hour, always when the gallery is otherwise empty of visitors. Staff have stopped checking.",
        anchor: { x: 9, y: 14, width: 10, height: 20 },
      },
      {
        type: "lore",
        label: "The waiting cot",
        text: "It is turned down fresh every morning. The nursery has had no occupant on record for longer than any living curator can confirm.",
        anchor: { x: 66, y: 34, width: 14, height: 30 },
      },
    ],
  },
];

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
// a real in-world interactive object kept for flavour, but (per the
// product direction) no longer the only way to discover donation; see the
// persistent "Donate a Relic" action the client always renders.
export const DONOR_COUNTER = { x: 50, z: 80 };
const DONOR_COUNTER_ANCHOR = { x: 40, y: 58, width: 20, height: 26 };

export function hallConfig() {
  return { image: "entrance", donorCounter: DONOR_COUNTER };
}

// ---------------------------------------------------------------------------
// Scenes: a small fixed graph of illustrated vantages, each now carrying a
// bounded 2.5D camera range and a list of interactive objects (anchor
// BOXES, not points) the client renders as glow regions over the actual
// painted item they represent. A visitor is always exactly "at" one scene
// id; `POST /api/presence` reports which one (see server.js).

// The hub: four "facings," one per doorway, turned between — same single
// entrance illustration, a different doorway highlighted/panned-to each
// time, in the spirit of turning your head inside one real room rather than
// four different photographs. `hall-s` (facing the donor counter and the
// childhood doorway) is the default spawn facing.
const HALL_FACINGS = [
  { dir: "n", galleryId: "portraits", doorAnchor: { x: 42, y: 8, width: 16, height: 40 } },
  { dir: "e", galleryId: "memento", doorAnchor: { x: 78, y: 20, width: 16, height: 40 } },
  { dir: "s", galleryId: "childhood", doorAnchor: { x: 42, y: 60, width: 16, height: 36 } },
  { dir: "w", galleryId: "specimen", doorAnchor: { x: 6, y: 20, width: 16, height: 40 } },
];

// galleryId -> the hub facing that looks at its doorway, so a gallery's main
// scene can send "back" to the exact facing a visitor would have entered
// from, not an arbitrary default hub facing.
const HALL_FACING_BY_GALLERY = Object.fromEntries(HALL_FACINGS.map((f) => [f.galleryId, `hall-${f.dir}`]));

// Room-to-room navigation is deliberately NOT an in-room glowing object any
// more (see docs/adr/0005-immersive-2.5d-camera.md): a scene's `nav.forward`
// and `nav.back` describe the quiet corner controls the client renders
// instead — "enter the next room" upper-left, "back" lower-right — so a
// doorway or archway in the illustration is simply left to be itself,
// never covered by a floating button in the middle of the composition.
// Looking closer at a gallery's hero display IS still an in-room object
// (clicking the actual painted item), since that's "discovered through
// light and attention," not room-to-room travel.
function buildHallScenes() {
  const order = HALL_FACINGS.map((f) => `hall-${f.dir}`);
  return HALL_FACINGS.map((facing, i) => {
    const gallery = galleryById(facing.galleryId);
    const objects = [
      {
        id: "hall-donate",
        type: "donate",
        label: "Donate a Relic",
        anchor: DONOR_COUNTER_ANCHOR,
      },
    ];
    return {
      id: `hall-${facing.dir}`,
      kind: "hub",
      galleryId: null,
      parentSceneId: null,
      caption: "Entrance Hall",
      image: "entrance",
      panTo: facing.doorAnchor,
      camera: DEFAULT_HUB_CAMERA,
      // Only the hall's south facing actually shows the donor counter in
      // frame in this composition; the other three facings have nothing to
      // glow there.
      interactiveObjects: facing.dir === "s" ? objects : [],
      visitorAnchors: HALL_VISITOR_ANCHORS,
      nav: { forward: { targetSceneId: `${facing.galleryId}-main`, label: `Enter ${gallery.name}` } },
      turnLeft: order[(i + order.length - 1) % order.length],
      turnRight: order[(i + 1) % order.length],
    };
  });
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
  const mainScene = {
    id: `${gallery.id}-main`,
    kind: "main",
    galleryId: gallery.id,
    parentSceneId: HALL_FACING_BY_GALLERY[gallery.id],
    caption: gallery.name,
    image: gallery.image,
    camera: DEFAULT_MAIN_CAMERA,
    interactiveObjects: objects,
    visitorAnchors: VISITOR_ANCHORS,
    nav: { back: { targetSceneId: HALL_FACING_BY_GALLERY[gallery.id], label: "Back to the Entrance Hall" } },
  };
  const closeupScene = {
    id: `${gallery.id}-closeup`,
    kind: "closeup",
    galleryId: gallery.id,
    parentSceneId: `${gallery.id}-main`,
    caption: closeup.caption,
    image: closeup.image,
    zoom: closeup.zoom ?? false,
    closeupAnchor: closeup.closeupAnchor,
    lore: closeup.lore,
    camera: closeup.closeupCamera ?? DEFAULT_CLOSEUP_CAMERA,
    interactiveObjects: [],
    visitorAnchors: VISITOR_ANCHORS,
    nav: { back: { targetSceneId: `${gallery.id}-main`, label: `Back to ${gallery.name}` } },
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
    })),
  };
}
