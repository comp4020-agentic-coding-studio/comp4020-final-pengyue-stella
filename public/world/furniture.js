// The staging furniture family artifacts.js uses to present a donated
// relic's small 3D preview (a display cabinet, a specimen vitrine, a
// portrait frame) — built from original procedural geometry and the canvas
// textures in textures.js. Each factory function returns a fresh THREE.Group
// so multiple placements never share transforms, but geometries and
// materials ARE shared/cached across calls (see the `cache` object). The
// room-scale furnishing catalogue this file used to carry (rugs, candles, a
// chandelier, a bookshelf, and the rest of a live walkable gallery's
// dressing) was retired along with the Three.js room itself in the
// illustrated-scene presentation pass — see docs/adr/0003-scene-
// exploration.md and ASSETS.md for the full account of what each piece of
// procedural geometry was and why only the exhibit-preview subset remains.
import * as THREE from "three";
import { buildWoodTexture, buildPortraitTexture } from "./textures.js";

const cache = {};
function cached(key, build) {
  if (!cache[key]) cache[key] = build();
  return cache[key];
}

// See scene.js's own PHYSICAL_LIGHT_SCALE comment: Three.js r155+ expresses
// PointLight intensity in physically-based candela, needing roughly two
// orders of magnitude more than the pre-r155 convention these intensity
// values were first written against.
const PHYSICAL_LIGHT_SCALE = 40;

// Exported so artifacts.js's donated-relic model library can stage pieces
// in the same wood/brass/glass/velvet finish as the room's own furniture,
// instead of inventing a second material palette.
export function woodMaterial() {
  return cached("wood-mat", () => {
    const tex = buildWoodTexture();
    tex.repeat.set(2, 2);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05 });
  });
}

export function brassMaterial() {
  return cached("brass-mat", () => new THREE.MeshStandardMaterial({ color: "#9c7a44", roughness: 0.35, metalness: 0.75 }));
}

export function glassMaterial() {
  return cached(
    "glass-mat",
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#dff0f2", roughness: 0.05, metalness: 0, transmission: 0.82, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide,
      }),
  );
}

export function fabricMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
}

// A tall glass-fronted display cabinet — the dominant silhouette in
// reference A (01_gallery_reference). Carcass + two side posts + shelves
// visible through a glass front + a few small clutter shapes on each shelf.
export function buildDisplayCabinet({ width = 1.3, height = 2.4, depth = 0.5, accent = "#88653D" } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const brass = brassMaterial();
  const glass = glassMaterial();

  const carcass = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wood);
  carcass.position.y = height / 2;
  group.add(carcass);

  // Hollow out the read with an inset glass front plane instead of actual
  // CSG — cheaper, and reads correctly from the angles a visitor walks at.
  const front = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.82, height * 0.78), glass);
  front.position.set(0, height * 0.52, depth / 2 + 0.01);
  group.add(front);

  // A carved crest on top.
  const crest = new THREE.Mesh(new THREE.ConeGeometry(width * 0.28, 0.3, 4), wood);
  crest.position.y = height + 0.12;
  crest.rotation.y = Math.PI / 4;
  group.add(crest);

  // Shelves with small clutter — reuse one small-object geometry set.
  const shelfCount = 3;
  for (let i = 0; i < shelfCount; i++) {
    const shelfY = height * (0.22 + i * 0.26);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, 0.03, depth * 0.7), wood);
    shelf.position.set(0, shelfY, 0);
    group.add(shelf);

    for (let j = 0; j < 3; j++) {
      const clutter = buildClutterObject(accent, (i * 3 + j) % 4);
      clutter.position.set((j - 1) * width * 0.22, shelfY + 0.08, (Math.random() - 0.5) * depth * 0.2);
      group.add(clutter);
    }
  }

  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.012, 4, 8), brass);
  trim.position.set(0, height * 0.9, depth / 2 + 0.01);
  group.add(trim);

  return group;
}

// Small shelf clutter: a rotating cast of simple shapes (skull-ish sphere,
// bottle, box, small urn) in an accent-tinted material — never the same
// object twice in a row thanks to the `variant` argument. Exported so
// scene.js can scatter the same small objects on side tables between the
// larger named furniture pieces, for floor-level density.
export function buildClutterObject(accent, variant) {
  const mat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, metalness: 0.15 });
  const boneMat = new THREE.MeshStandardMaterial({ color: "#d8cdb0", roughness: 0.6 });
  switch (variant % 4) {
    case 0: {
      const g = new THREE.Group();
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), boneMat);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.05), boneMat);
      jaw.position.y = -0.045;
      g.add(skull, jaw);
      return g;
    }
    case 1:
      return new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.11, 8), mat);
    case 2:
      return new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.05), mat);
    default:
      return new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat);
  }
}

// An ornate gilt-framed portrait — used by artifacts.js's stagePortrait to
// present a donated painting/sketch inside a real frame, the same frame
// family a live walkable gallery wall used to hang (see ASSETS.md for the
// retired room-scale usage).
export function buildPortraitFrame({ width = 0.9, height = 1.2, accent = "#663D43" } = {}) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: "#1c1109", roughness: 0.5, metalness: 0.3 });
  const trimMat = brassMaterial();

  const frame = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.06), frameMat);
  group.add(frame);

  const insetWidth = width * 0.82;
  const insetHeight = height * 0.82;
  const inset = new THREE.Mesh(
    new THREE.PlaneGeometry(insetWidth, insetHeight),
    new THREE.MeshStandardMaterial({ map: buildPortraitTexture(accent), roughness: 0.9 }),
  );
  inset.position.z = 0.031;
  group.add(inset);

  // Corner trim accents.
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const corner = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), trimMat);
    corner.position.set((sx * width) / 2, (sy * height) / 2, 0.03);
    group.add(corner);
  }

  return group;
}

// A glass specimen vitrine for the Cabinet of Impossible Life — low
// table-height case with a visible specimen inside.
export function buildSpecimenVitrine({ accent = "#4A5A3D" } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const glass = glassMaterial();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 0.5), wood);
  base.position.y = 0.375;
  group.add(base);

  const caseGlass = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.42), glass);
  caseGlass.position.y = 0.75 + 0.275;
  group.add(caseGlass);

  const boneMat = new THREE.MeshStandardMaterial({ color: "#d8cdb0", roughness: 0.6 });
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), boneMat);
  skull.position.y = 0.75 + 0.18;
  group.add(skull);
  const ribs = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 12, Math.PI), boneMat);
  ribs.rotation.x = Math.PI / 2;
  ribs.position.y = 0.75 + 0.05;
  group.add(ribs);

  const accentGlow = new THREE.PointLight(accent, 0.3 * PHYSICAL_LIGHT_SCALE, 1.5, 1.3);
  accentGlow.position.y = 0.75 + 0.4;
  group.add(accentGlow);

  return group;
}

