// The scene graph: a small loop of connected, real campus places. Static
// config, not stored data — a visitor can leave a trace in a scene but can't
// add a scene or move an exit.
//
// Each scene's background is a real ANU photograph, built into a pseudo-
// panorama by tools/build-scenes.py (sharp photo centred, softly blurred
// extension either side for pan room — see CLAUDE.md and PROCESS.md for why,
// and README.md for photo credits). `width`/`height` are the built image's
// own pixel dimensions; exits and traces both anchor at `{x, y}` normalised
// 0..1 against that box, which is what keeps a pin in the same spot on the
// ground regardless of viewport size or current pan offset.
export const SCENES = [
  {
    id: "kambri",
    title: "Kambri Lawn",
    blurb: "Sullivans Creek, where it runs past the Kambri amphitheatre steps.",
    image: "/scenes/kambri.jpg",
    width: 5320,
    height: 1400,
    exits: [
      { to: "chifley", x: 0.93, y: 0.86, label: "Walk to Chifley Library" },
      { to: "uniave", x: 0.05, y: 0.86, label: "Walk to University Avenue" },
    ],
  },
  {
    id: "chifley",
    title: "Chifley Library",
    blurb: "The footbridge up to Chifley's angled bay windows.",
    image: "/scenes/chifley.jpg",
    width: 5320,
    height: 1400,
    exits: [
      { to: "kambri", x: 0.05, y: 0.9, label: "Walk to Kambri Lawn" },
      { to: "union", x: 0.94, y: 0.9, label: "Walk to Union Court" },
    ],
  },
  {
    id: "union",
    title: "Union Court",
    blurb: "Umbrellas out the front of Union Court on a bright day.",
    image: "/scenes/union.jpg",
    width: 5320,
    height: 1400,
    exits: [
      { to: "chifley", x: 0.05, y: 0.92, label: "Walk to Chifley Library" },
      { to: "uniave", x: 0.94, y: 0.92, label: "Walk to University Avenue" },
    ],
  },
  {
    id: "uniave",
    title: "University Avenue",
    blurb: "The sign at the front gate, where campus actually starts.",
    image: "/scenes/uniave.jpg",
    width: 5320,
    height: 1400,
    exits: [
      { to: "union", x: 0.05, y: 0.88, label: "Walk to Union Court" },
      { to: "kambri", x: 0.94, y: 0.88, label: "Walk to Kambri Lawn" },
    ],
  },
];

export const SCENE_IDS = new Set(SCENES.map((s) => s.id));

export function getScene(id) {
  return SCENES.find((s) => s.id === id);
}
