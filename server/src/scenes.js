// The scene graph: a small loop of connected campus places. Static config,
// not stored data — a visitor can leave a trace in a scene but can't add a
// scene or move an exit.
//
// Each scene's background is a wide SVG (see tools/generate-scenes.mjs) much
// wider than any viewport, so looking around means panning it — a stand-in
// for a real 360/equirectangular photo. `width`/`height` are the SVG's own
// viewBox units; exits and traces both anchor at `{x, y}` normalised 0..1
// against that box, which is what keeps a pin in the same spot on the ground
// regardless of viewport size or current pan offset.
export const SCENES = [
  {
    id: "kambri",
    title: "Kambri Lawn",
    blurb: "Midday, open grass, the amphitheatre steps down to the lawn.",
    image: "/scenes/kambri.svg",
    width: 3600,
    height: 900,
    exits: [
      { to: "chifley", x: 0.93, y: 0.74, label: "Walk to Chifley Steps" },
      { to: "science", x: 0.05, y: 0.76, label: "Walk to Science Walk" },
    ],
  },
  {
    id: "chifley",
    title: "Chifley Steps",
    blurb: "Golden afternoon light on the library steps.",
    image: "/scenes/chifley.svg",
    width: 3600,
    height: 900,
    exits: [
      { to: "kambri", x: 0.05, y: 0.8, label: "Walk to Kambri Lawn" },
      { to: "union", x: 0.94, y: 0.78, label: "Walk to Union Court" },
    ],
  },
  {
    id: "union",
    title: "Union Court",
    blurb: "Dusk, umbrellas folding up, the plaza lamps just lit.",
    image: "/scenes/union.svg",
    width: 3600,
    height: 900,
    exits: [
      { to: "chifley", x: 0.05, y: 0.8, label: "Walk to Chifley Steps" },
      { to: "science", x: 0.94, y: 0.78, label: "Walk to Science Walk" },
    ],
  },
  {
    id: "science",
    title: "Science Walk",
    blurb: "Overcast, glass and a still pond along the walk.",
    image: "/scenes/science.svg",
    width: 3600,
    height: 900,
    exits: [
      { to: "union", x: 0.05, y: 0.82, label: "Walk to Union Court" },
      { to: "kambri", x: 0.94, y: 0.8, label: "Walk to Kambri Lawn" },
    ],
  },
];

export const SCENE_IDS = new Set(SCENES.map((s) => s.id));

export function getScene(id) {
  return SCENES.find((s) => s.id === id);
}
