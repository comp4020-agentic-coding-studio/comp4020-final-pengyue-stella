// The donated-relic model library: one bespoke procedural object family per
// subtype (spoon, key, clock, mirror, portrait, doll, book, specimen,
// curiosity — see server/src/constants.js's SUBTYPES_BY_CATEGORY, the only
// place that decides which subtypes a gallery's category accepts), each
// staged in real display furniture (a glass vitrine, a velvet pedestal, a
// gilt frame — reusing furniture.js's own builders) with a brass nameplate
// and its own small exhibition light. Original procedural geometry
// throughout, same "no downloaded art" footing furniture.js already stands
// on (see ASSETS.md) — only the avatar model is a downloaded asset in this
// project, per the deliberate hybrid decision recorded there.
//
// Every donation gets the same subtype's base shape, but never looks
// identical to another: `mulberry32` below is a tiny seeded PRNG keyed on
// the exhibit's own id, driving small, stable (same exhibit -> same look on
// every reload) variations in scale, rotation and material tone. This is
// what the blueprint means by "apply visual variations... without needing
// per-donation art" — the variation is real and visible, but there is still
// nothing here to license-check per donation.
import * as THREE from "three";
import {
  buildDisplayCabinet,
  buildSpecimenVitrine,
  buildPortraitFrame,
  brassMaterial,
  glassMaterial,
  fabricMaterial,
  woodMaterial,
} from "./furniture.js";
import { buildPortraitTexture, buildNameplateTexture } from "./textures.js";

// See scene.js's own PHYSICAL_LIGHT_SCALE comment: Three.js r155+ candela
// units need roughly two orders of magnitude more than the old "just a
// visible number" convention these intensities were first written against.
const PHYSICAL_LIGHT_SCALE = 40;

// A small, dependency-free seeded PRNG (mulberry32) — deterministic per
// exhibit id so a donation's look is stable across reloads/reconnects for
// every visitor, not randomly different each time its mesh is (re)built.
function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let seed = h >>> 0;
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Nudges a "#rrggbb" colour's lightness by a seeded amount, so a run of
// donations in the same subtype don't all share one exact material tone.
function tintColor(hex, rand, range = 0.12) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.h = (hsl.h + (rand() - 0.5) * 0.06 + 1) % 1;
  hsl.l = Math.max(0.12, Math.min(0.85, hsl.l + (rand() - 0.5) * range));
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

// A brass-framed nameplate, the one shared label every artifact family
// mounts — "a readable brass nameplate with its title and donor" per the
// brief. `y` is the plate's centre height above the artifact's own origin.
function buildNameplate(title, donorName, y) {
  const tex = buildNameplateTexture(title, donorName);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.16),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
  );
  plate.position.y = y;
  plate.position.z = 0.01;
  return plate;
}

// A small warm exhibition light, local to one artifact rather than relying
// solely on the room's own lamps — "illuminate it with subtle exhibition
// lighting," distinct from the ambient/chandelier lighting scene.js already
// provides per room.
function buildSpotlight(y) {
  const light = new THREE.PointLight("#ffcf8a", 0.35 * PHYSICAL_LIGHT_SCALE, 2.2, 1.3);
  light.position.y = y;
  return light;
}

// --- subtype builders -------------------------------------------------
// Each returns { group, interactY, labelY } in local artifact space (before
// the shared staging wrapper below adds a plinth/vitrine/frame and the
// nameplate). `rand` is this exhibit's own seeded PRNG.

function buildSpoon(accent, rand) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: tintColor("#c9c2ab", rand, 0.08), roughness: 0.3, metalness: 0.85 });
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.16, 4, 8), metal);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-0.02, 0, 0);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), metal);
  bowl.scale.set(1, 0.55, 0.75);
  bowl.position.set(0.1, 0, 0);
  group.add(handle, bowl);
  group.rotation.z = (rand() - 0.5) * 0.3;
  group.position.y = 0.02;
  return { group, interactY: 0.06 };
}

function buildKey(accent, rand) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: tintColor("#9c7a44", rand), roughness: 0.4, metalness: 0.7 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 8), metal);
  shaft.rotation.z = Math.PI / 2;
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 16), metal);
  bow.position.x = -0.09;
  const bit = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.012), metal);
  bit.position.x = 0.09;
  group.add(shaft, bow, bit);
  group.rotation.z = (rand() - 0.5) * 0.5;
  group.position.y = 0.025;
  return { group, interactY: 0.07 };
}

function buildClock(accent, rand) {
  const group = new THREE.Group();
  const brass = brassMaterial();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 20), brass);
  body.rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.085, 20),
    new THREE.MeshStandardMaterial({ color: "#e9ddc5" }),
  );
  face.position.z = 0.016;
  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.004), new THREE.MeshStandardMaterial({ color: "#1a1410" }));
  hourHand.position.z = 0.018;
  hourHand.rotation.z = rand() * Math.PI * 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 8, 20), brass);
  group.add(body, face, hourHand, ring);
  group.rotation.x = Math.PI / 2;
  group.position.y = 0.11;
  return { group, interactY: 0.11 };
}

function buildMirror(accent, rand) {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 10, 24), brassMaterial());
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 24),
    new THREE.MeshPhysicalMaterial({ color: "#dfe8ea", roughness: 0.05, metalness: 0.9, envMapIntensity: 1.2 }),
  );
  glass.position.z = 0.01;
  group.add(frame, glass);
  group.rotation.y = (rand() - 0.5) * 0.6;
  group.position.y = 0.3;
  return { group, interactY: 0.3 };
}

// Unlike the other builders (which rest their own group at floor level —
// see each one's `group.position.y` above), a painting's canvas is centred
// on local (0,0,0): stagePortrait nests this inside a portrait frame and
// repositions the *frame* to the floor, so the canvas only needs to sit at
// the frame's own centre, not know about floor height itself.
function buildPainting(accent, rand) {
  const group = new THREE.Group();
  const texture = buildPortraitTexture(tintColor(accent, rand, 0.2).getStyle());
  const canvas = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 1.15),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }),
  );
  group.add(canvas);
  return { group, interactY: 0 };
}

function buildSketch(accent, rand) {
  const { group, interactY } = buildPainting(accent, rand);
  group.scale.set(0.72, 0.72, 1);
  return { group, interactY };
}

function buildDoll(accent, rand) {
  const group = new THREE.Group();
  const dollMat = new THREE.MeshStandardMaterial({ color: tintColor(accent, rand), roughness: 0.6 });
  const porcelainMat = new THREE.MeshStandardMaterial({ color: "#e9ddc5", roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 8), dollMat);
  body.position.y = 0.18;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), porcelainMat);
  head.position.y = 0.38;
  group.add(body, head);
  group.rotation.y = rand() * Math.PI * 2;
  group.position.y = 0.02;
  return { group, interactY: 0.2 };
}

function buildToy(accent, rand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: tintColor(accent, rand), roughness: 0.5, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), mat);
  body.position.y = 0.15;
  const wheelMat = new THREE.MeshStandardMaterial({ color: "#2a1c14", roughness: 0.6 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(sx * 0.08, 0.035, sz * 0.08);
    group.add(wheel);
  }
  group.add(body);
  group.rotation.y = rand() * Math.PI * 2;
  return { group, interactY: 0.18 };
}

function buildBook(accent, rand) {
  const group = new THREE.Group();
  const coverMat = new THREE.MeshStandardMaterial({ color: tintColor(accent, rand), roughness: 0.75 });
  const pageMat = new THREE.MeshStandardMaterial({ color: "#e9ddc5", roughness: 0.9 });
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.3), coverMat);
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.022, 0.27), pageMat);
  pages.position.y = 0.002;
  group.add(cover, pages);
  group.rotation.y = rand() * 0.6 - 0.3;
  group.position.y = 0.02;
  return { group, interactY: 0.05 };
}

function buildBotanical(accent, rand) {
  const group = new THREE.Group();
  const jarMat = glassMaterial();
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 14), jarMat);
  jar.position.y = 0.11;
  const stemMat = new THREE.MeshStandardMaterial({ color: tintColor("#4a5a3d", rand), roughness: 0.7 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), stemMat);
  stem.position.y = 0.1;
  const budMat = new THREE.MeshStandardMaterial({ color: tintColor(accent, rand), roughness: 0.6 });
  const bud = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), budMat);
  bud.position.y = 0.17;
  group.add(jar, stem, bud);
  return { group, interactY: 0.2 };
}

function buildBiological(accent, rand) {
  const group = new THREE.Group();
  const boneMat = new THREE.MeshStandardMaterial({ color: "#d8cdb0", roughness: 0.6 });
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), boneMat);
  skull.scale.set(1, 0.9, 1.1);
  skull.position.y = 0.09;
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.06), boneMat);
  jaw.position.y = 0.04;
  const glowMat = new THREE.MeshStandardMaterial({ color: tintColor(accent, rand), emissive: tintColor(accent, rand, 0.3), emissiveIntensity: 0.4, roughness: 0.5 });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), glowMat);
  eye.position.set(0.04, 0.09, 0.05);
  group.add(skull, jaw, eye);
  group.rotation.y = rand() * Math.PI * 2;
  return { group, interactY: 0.1 };
}

function buildCuriosity(accent, rand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: tintColor(accent, rand), roughness: 0.4, metalness: 0.35 });
  const geomPick = Math.floor(rand() * 3);
  const shape =
    geomPick === 0
      ? new THREE.IcosahedronGeometry(0.11, 0)
      : geomPick === 1
        ? new THREE.OctahedronGeometry(0.12, 0)
        : new THREE.TorusKnotGeometry(0.07, 0.025, 48, 8);
  const mesh = new THREE.Mesh(shape, mat);
  mesh.position.y = 0.14;
  group.add(mesh);
  group.rotation.y = rand() * Math.PI * 2;
  return { group, interactY: 0.14 };
}

const BUILDERS = {
  spoon: buildSpoon,
  key: buildKey,
  clock: buildClock,
  mirror: buildMirror,
  painting: buildPainting,
  sketch: buildSketch,
  doll: buildDoll,
  toy: buildToy,
  book: buildBook,
  botanical: buildBotanical,
  biological: buildBiological,
  curiosity: buildCuriosity,
};

// --- staging: furniture + nameplate + light ----------------------------
// How a subtype's raw model gets presented depends on its category, not its
// individual subtype: portraits hang framed, specimens sit in vitrines,
// everything else (mementoes, toys) sits on a velvet-topped pedestal in an
// open display cabinet — matching the furniture families furniture.js
// already builds for the room itself.

function stagePortrait(built, accent) {
  const frameHeight = 1.4;
  const frame = buildPortraitFrame({ width: 1.1, height: frameHeight, accent });
  // Replace the frame's own placeholder inset with the actual painted
  // canvas this donation built, so a hung portrait reads as this relic's
  // specific art, not the generic gallery-wall frame art.
  const inset = frame.children.find((c) => c.geometry?.type === "PlaneGeometry");
  if (inset) frame.remove(inset);
  built.group.position.z = 0.045;
  frame.add(built.group);
  // buildPortraitFrame centres its box at local y=0 (meant for wall-mounted
  // decorative frames, positioned externally); a free-standing donated
  // portrait instead needs its own bottom edge at floor level, like a
  // gallery piece on an easel, so it isn't half-buried in the floor.
  frame.position.y = frameHeight / 2;
  return { group: frame, interactY: frameHeight / 2, labelY: -frameHeight / 2 + 0.12 };
}

function stageSpecimen(built, accent) {
  const vitrine = buildSpecimenVitrine({ accent });
  // Vitrine already carries its own stock bone dressing; keep that as base
  // clutter and add this donation's actual specimen model on top, raised to
  // the same shelf height the vitrine's glass case sits at.
  built.group.position.y += 0.75;
  vitrine.add(built.group);
  return { group: vitrine, interactY: 0.75 + built.interactY, labelY: 0.42 };
}

function stagePedestal(built, accent, rand) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const plinthHeight = 0.5 + rand() * 0.08;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, plinthHeight, 10), wood);
  plinth.position.y = plinthHeight / 2;
  const cushion = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.19, 0.035, 10),
    fabricMaterial(tintColor(accent, rand, 0.25).getStyle()),
  );
  cushion.position.y = plinthHeight + 0.018;
  group.add(plinth, cushion);

  // A glass dome protects small relics (spoons, keys, clocks, mirrors,
  // curiosities) the way a specimen vitrine protects a vitrine subtype —
  // "present it inside a glass cabinet, on velvet, on a display pedestal."
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glassMaterial());
  dome.position.y = plinthHeight + 0.04;
  group.add(dome);

  built.group.position.y += plinthHeight + 0.04;
  group.add(built.group);
  return { group, interactY: plinthHeight + 0.04 + built.interactY, labelY: plinthHeight - 0.08 };
}

function stageCabinetDisplay(built, accent, rand) {
  const cabinet = buildDisplayCabinet({ accent, width: 0.9, height: 1.6, depth: 0.42 });
  built.group.position.y += 0.6;
  built.group.position.z += 0.05;
  cabinet.add(built.group);
  return { group: cabinet, interactY: 0.6 + built.interactY, labelY: 0.3 };
}

const STAGE_BY_CATEGORY = {
  portrait: stagePortrait,
  specimen: stageSpecimen,
  memento: stagePedestal,
  toy: stageCabinetDisplay,
};

// Builds a complete, staged exhibit mesh for a donated relic — a nameplate
// is added unless `skipNameplate` (used for the in-room/placement-preview
// rendering path below, where the title/donor text belongs in the dossier,
// never baked permanently over the artwork itself). Returns { group,
// interactY } — the same shape scene.js's addExhibitMesh already expects,
// so nothing else about exhibit placement/raycasting needs to change for
// this richer library to drop in.
export function buildArtifactMesh({ category, subtype, accent, exhibitId, title, donorName, skipNameplate = false }) {
  const rand = seededRandom(exhibitId ?? `${category}:${subtype}`);
  const builder = BUILDERS[subtype] ?? BUILDERS.curiosity;
  const built = builder(accent, rand);

  const stage = STAGE_BY_CATEGORY[category] ?? stagePedestal;
  const { group, interactY, labelY } = stage(built, accent, rand);

  // A small per-donation scale variation ("visual variations... scale") —
  // kept modest so an artifact never clips through its own staging
  // furniture, which was sized for the builder's base dimensions.
  const scale = 0.92 + rand() * 0.16;
  group.scale.multiplyScalar(scale);

  if (!skipNameplate) group.add(buildNameplate(title, donorName, labelY));
  group.add(buildSpotlight(interactY + 0.4));

  return { group, interactY: interactY * scale };
}

// A one-shot (not continuously rendered) preview of a single artifact mesh
// on its own canvas — the small subtype/category image every exhibit card
// and dossier header shows, rebuilding the same procedural model the
// exhibit itself is keyed to rather than a static icon, so the preview is
// always specific to that donation's own category/subtype/seed. `canvas` is
// caller-owned so each UI surface can size its own; this function tears its
// renderer/scene down immediately after the single frame is drawn, leaving
// nothing running in the background — there is no live 3D viewport in this
// presentation any more (see docs/adr/0003-scene-exploration.md), only this
// still-frame thumbnail generator.
export function renderArtifactPreview(canvas, { category, subtype, accent, exhibitId, title, donorName }) {
  // A WebGL context can fail to create (headless/software-rendering
  // environments, a browser with WebGL disabled, a context-lost GPU
  // process) — this is a decorative still-frame thumbnail, not a load-
  // bearing interaction, so a failure here must never throw past this
  // function and break whatever called it (refreshHotspots rebuilding the
  // entire hotspot layer, mid-loop, is exactly the kind of caller a thrown
  // error here would otherwise leave half-finished).
  try {
    const scene = new THREE.Scene();
    scene.background = null;
    scene.add(new THREE.AmbientLight("#5a4a36", 3));
    const key = new THREE.PointLight("#ffcf8a", 60, 0, 2);
    key.position.set(0.6, 1.2, 1.0);
    scene.add(key);

    const { group, interactY } = buildArtifactMesh({ category, subtype, accent, exhibitId, title, donorName });
    group.position.set(0, 0, 0);
    scene.add(group);

    const camera = new THREE.PerspectiveCamera(42, canvas.width / canvas.height, 0.05, 20);
    const focusHeight = Math.max(0.3, interactY);
    camera.position.set(0.55, focusHeight + 0.35, 0.85);
    camera.lookAt(0, focusHeight * 0.6, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.render(scene, camera);

    // Nothing here is kept running: dispose the renderer immediately since
    // this is a single still frame, not a live viewport.
    renderer.dispose();
  } catch (err) {
    console.error("artifact preview render failed, leaving a plain placeholder:", err);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = accent ?? "#88653d";
      ctx.globalAlpha = 0.25;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }
}

// The in-room/placement-mode object representation (CLAUDE.md-aligned
// brief: "replace the oversized donation card... render only the relic and
// its frame/object body on a transparent canvas," never a title/donor/
// INSPECT label or an opaque card background). Reuses the exact same
// procedural model library and seeded-per-exhibit look as
// renderArtifactPreview, just without the nameplate mesh and with no
// backdrop drawn behind a failed-render fallback — a transparent canvas
// stays transparent even if WebGL fails, rather than painting a tinted
// rectangle that would itself read as "a card."
export function renderArtifactObject(canvas, { category, subtype, accent, exhibitId }) {
  try {
    const scene = new THREE.Scene();
    scene.background = null;
    scene.add(new THREE.AmbientLight("#5a4a36", 3));
    const key = new THREE.PointLight("#ffcf8a", 60, 0, 2);
    key.position.set(0.6, 1.2, 1.0);
    scene.add(key);

    const { group, interactY } = buildArtifactMesh({ category, subtype, accent, exhibitId, skipNameplate: true });
    group.position.set(0, 0, 0);
    scene.add(group);

    const camera = new THREE.PerspectiveCamera(42, canvas.width / canvas.height, 0.05, 20);
    const focusHeight = Math.max(0.3, interactY);
    camera.position.set(0.55, focusHeight + 0.35, 0.85);
    camera.lookAt(0, focusHeight * 0.6, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setSize(canvas.width, canvas.height, false);
    renderer.render(scene, camera);
    renderer.dispose();
  } catch (err) {
    console.error("artifact object render failed, leaving the canvas transparent:", err);
  }
}
