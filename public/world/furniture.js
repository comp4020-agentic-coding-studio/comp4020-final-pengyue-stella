// A small catalogue of reusable Victorian furniture pieces — cabinets,
// vitrines, portrait frames, rugs, plants, candles, a chandelier — built
// from original procedural geometry and the canvas textures in
// textures.js. Each factory function returns a fresh THREE.Group so
// multiple placements never share transforms, but geometries and materials
// ARE shared/cached across calls (see the `cache` object) to keep draw
// count and memory reasonable across four furnished galleries — see
// ASSETS.md for the full "what's original, what's a technique" account.
import * as THREE from "three";
import {
  buildCarpetTexture,
  buildWoodTexture,
  buildWallpaperTexture,
  buildPortraitTexture,
} from "./textures.js";

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

// An ornate gilt-framed portrait, hung flush on a wall. `rotationY` should
// match the wall it's mounted against (0 facing +Z, etc. — same convention
// as display slots). `watching`, used only in The Portraits That Watch
// gallery (see scene.js's furnishPortraitGallery), adds two small dark
// pupils over the canvas texture's own painted eye-sockets — their position
// is nudged each frame by scene.js's updateWatchingEyes to lean toward
// wherever the visitor currently stands, the gallery's one literal
// realisation of its own name and of the "ambiguous presence, almost
// believable haunting" reference board. The motion is a few millimetres of
// lateral shift, never a full eye swivel — restrained per the blueprint's
// "subtle unease," not a jump-scare.
export function buildPortraitFrame({ width = 0.9, height = 1.2, accent = "#663D43", watching = false } = {}) {
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

  if (watching) {
    // Eye-socket positions in local space, matching buildPortraitTexture's
    // own canvas coordinates (two faint sockets at roughly (119,86) and
    // (137,86) on a 256x256 canvas) mapped onto this frame's actual inset
    // size, so the literal pupil mesh sits exactly over its painted socket
    // regardless of this particular frame's width/height.
    const pupilMat = new THREE.MeshBasicMaterial({ color: "#14100c" });
    const eyes = [-1, 1].map((side) => {
      const restX = side * ((137 - 128) / 256) * insetWidth;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), pupilMat);
      pupil.scale.set(1, 0.72, 0.4);
      pupil.position.set(restX, (0.5 - 86 / 256) * insetHeight, 0.033);
      pupil.userData.restX = restX;
      group.add(pupil);
      return pupil;
    });
    group.userData.eyes = eyes;
  }

  return group;
}

// A patterned area rug lying flat on the floor.
export function buildRug({ width = 2.4, depth = 1.6, color = "#5a1f22" } = {}) {
  const tex = buildCarpetTexture(color);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  return mesh;
}

// A simple potted fern/palm — a pot plus several bent "frond" planes —
// enough plant silhouette to read as dense indoor greenery without a real
// leaf texture.
export function buildPottedPlant({ height = 1.1 } = {}) {
  const group = new THREE.Group();
  const potMat = woodMaterial();
  const leafMat = new THREE.MeshStandardMaterial({ color: "#2e4a2a", roughness: 0.8, side: THREE.DoubleSide });

  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.22, 10), potMat);
  pot.position.y = 0.11;
  group.add(pot);

  const frondCount = 7;
  for (let i = 0; i < frondCount; i++) {
    const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.12, height * 0.7), leafMat);
    frond.position.y = 0.22 + (height * 0.35);
    const angle = (i / frondCount) * Math.PI * 2;
    frond.rotation.y = angle;
    frond.rotation.z = 0.5 + Math.random() * 0.3;
    frond.position.x = Math.cos(angle) * 0.05;
    frond.position.z = Math.sin(angle) * 0.05;
    group.add(frond);
  }
  return group;
}

// A candle with a small flame-coloured point light — a warm, flickering
// accent light rather than a decorative-only prop.
export function buildCandle({ withLight = true } = {}) {
  const group = new THREE.Group();
  const waxMat = new THREE.MeshStandardMaterial({ color: "#e9ddc5", roughness: 0.6 });
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.18, 8), waxMat);
  stick.position.y = 0.09;
  group.add(stick);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.015, 0.04, 6),
    new THREE.MeshBasicMaterial({ color: "#ffb866" }),
  );
  flame.position.y = 0.2;
  group.add(flame);
  if (withLight) {
    const light = new THREE.PointLight("#ffb866", 0.4 * PHYSICAL_LIGHT_SCALE, 2.5, 2);
    light.position.y = 0.22;
    group.add(light);
    group.userData.flickerLight = light;
  }
  return group;
}

// A hanging chandelier — a ring of candle-coloured lights around a central
// brass fixture, for a hall or gallery centre ceiling.
export function buildChandelier() {
  const group = new THREE.Group();
  const brass = brassMaterial();
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6), brass);
  chain.position.y = 0.2;
  group.add(chain);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 16), brass);
  group.add(ring);
  const bulbMat = new THREE.MeshBasicMaterial({ color: "#ffd9a0" });
  const armCount = 6;
  for (let i = 0; i < armCount; i++) {
    const angle = (i / armCount) * Math.PI * 2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), bulbMat);
    bulb.position.set(Math.cos(angle) * 0.35, -0.02, Math.sin(angle) * 0.35);
    group.add(bulb);
  }
  const light = new THREE.PointLight("#ffcf8a", 1.2 * PHYSICAL_LIGHT_SCALE, 10, 2);
  group.add(light);
  group.userData.flickerLight = light;
  return group;
}

// A bookshelf stocked with simple coloured-spine "books" — reads well for
// The Forgotten Childhood and as general room dressing elsewhere.
export function buildBookshelf({ width = 1.1, height = 1.8 } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const carcass = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.32), wood);
  carcass.position.y = height / 2;
  group.add(carcass);

  const spineColors = ["#663D43", "#88653D", "#4A5A3D", "#35251C", "#C6A16B"];
  const shelves = 4;
  for (let s = 0; s < shelves; s++) {
    const shelfY = 0.15 + s * (height / shelves);
    let x = -width / 2 + 0.08;
    while (x < width / 2 - 0.08) {
      const bw = 0.03 + Math.random() * 0.03;
      const bh = 0.16 + Math.random() * 0.08;
      // JS's `%` can return negative results for a negative dividend (x
      // starts negative, at the shelf's left edge) — without the extra
      // `+ spineColors.length`, that indexed spineColors with a negative
      // number and silently got `undefined`, which is exactly what surfaced
      // as "THREE.Material: parameter 'color' has value of undefined" in
      // the console once this was actually loaded in a browser.
      const colorIndex = ((s + Math.floor(x * 10)) % spineColors.length + spineColors.length) % spineColors.length;
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, 0.22),
        new THREE.MeshStandardMaterial({ color: spineColors[colorIndex], roughness: 0.8 }),
      );
      book.position.set(x + bw / 2, shelfY + bh / 2, 0.02);
      group.add(book);
      x += bw + 0.01;
    }
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

  const accentGlow = new THREE.PointLight(accent, 0.3 * PHYSICAL_LIGHT_SCALE, 1.5, 2);
  accentGlow.position.y = 0.75 + 0.4;
  group.add(accentGlow);

  return group;
}

// An antique standing clock, for Objects That Remember.
export function buildStandingClock() {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const brass = brassMaterial();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.9, 0.35), wood);
  body.position.y = 0.95;
  group.add(body);
  const faceRing = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 8, 16), brass);
  faceRing.position.set(0, 1.5, 0.18);
  group.add(faceRing);
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 20),
    new THREE.MeshStandardMaterial({ color: "#e9ddc5" }),
  );
  face.position.set(0, 1.5, 0.175);
  group.add(face);
  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.08, 0.01), new THREE.MeshStandardMaterial({ color: "#1a1410" }));
  hourHand.position.set(0, 1.52, 0.18);
  hourHand.rotation.z = 0.6;
  group.add(hourHand);
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.25, 4), wood);
  crest.position.y = 1.9 + 0.1;
  crest.rotation.y = Math.PI / 4;
  group.add(crest);
  return group;
}

// A velvet-topped display plinth with a doll-like figure, for the
// Forgotten Childhood gallery.
export function buildDollDisplay({ accent = "#C6A16B" } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const velvet = fabricMaterial("#3a1f28");
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.55, 10), wood);
  plinth.position.y = 0.275;
  group.add(plinth);
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 10), velvet);
  cushion.position.y = 0.55 + 0.02;
  group.add(cushion);

  const dollMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
  const porcelainMat = new THREE.MeshStandardMaterial({ color: "#e9ddc5", roughness: 0.4 });
  const dollBody = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 8), dollMat);
  dollBody.position.y = 0.55 + 0.18;
  group.add(dollBody);
  const dollHead = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), porcelainMat);
  dollHead.position.y = 0.55 + 0.38;
  group.add(dollHead);

  return group;
}

// A small occasional table — just tall enough to hold a candle or a
// clutter piece off the floor, so those props read as "resting on
// something" instead of floating mid-air.
export function buildSideTable({ height = 0.5, radius = 0.22 } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, 0.04, 10), wood);
  top.position.y = height;
  group.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, height - 0.02, 8), wood);
  leg.position.y = height / 2;
  group.add(leg);
  group.userData.topHeight = height + 0.02;
  return group;
}

// A free-standing ornate floor mirror in a gilt oval frame — denser, more
// "crowded curiosity cabinet" furnishing per the brief, distinct from the
// wall-hung buildPortraitFrame family.
export function buildFloorMirror({ height = 1.7 } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const brass = brassMaterial();

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 16), wood);
  base.position.y = 0.04;
  group.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 10), wood);
  post.position.y = 0.23;
  group.add(post);

  const frameHeight = height - 0.38;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(frameHeight * 0.42, 0.045, 10, 28), brass);
  frame.scale.set(0.72, 1, 1);
  frame.position.y = 0.38 + frameHeight * 0.5;
  group.add(frame);

  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(frameHeight * 0.4, 28),
    new THREE.MeshPhysicalMaterial({ color: "#dfe8ea", roughness: 0.08, metalness: 0.85 }),
  );
  glass.scale.set(0.72, 1, 1);
  glass.position.set(0, 0.38 + frameHeight * 0.5, 0.02);
  group.add(glass);

  return group;
}

// A small sculpted bust on its own plinth — the "sculptures" the brief
// names explicitly, built as abstracted original geometry (never a
// recognisable likeness of any real person).
export function buildSculptureBust({ accent = "#9c7a44" } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const stoneMat = new THREE.MeshStandardMaterial({ color: "#c9c2ab", roughness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.7 });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.75, 10), wood);
  plinth.position.y = 0.375;
  group.add(plinth);

  const shoulders = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 16), stoneMat);
  shoulders.position.y = 0.86;
  group.add(shoulders);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 14), stoneMat);
  head.scale.set(1, 1.15, 0.95);
  head.position.y = 1.04;
  group.add(head);

  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 6, 16), trimMat);
  trim.position.y = 0.76;
  group.add(trim);

  return group;
}

// A low leather-strapped steamer trunk — the "strange objects" / dense
// floor-level clutter the brief names, doubling as a surface for clutter
// pieces the way buildSideTable already does.
export function buildTrunk({ width = 0.6, depth = 0.38, height = 0.32 } = {}) {
  const group = new THREE.Group();
  const wood = woodMaterial();
  const strapMat = new THREE.MeshStandardMaterial({ color: "#2a1c14", roughness: 0.8 });
  const brass = brassMaterial();

  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wood);
  body.position.y = height / 2;
  group.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(depth / 2, depth / 2, width, 12, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.position.y = height;
  group.add(lid);

  for (const dz of [-depth * 0.32, depth * 0.32]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, 0.05, 0.05), strapMat);
    strap.position.set(0, height * 0.6, dz);
    group.add(strap);
  }
  const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.02), brass);
  clasp.position.set(0, height * 0.75, depth / 2 + 0.01);
  group.add(clasp);

  group.userData.topHeight = height + 0.16; // lid's rounded top apex
  return group;
}

// Applies textured wallpaper + crown trim to a wall mesh in place (used by
// scene.js when building gallery walls, so every wall picks up the same
// furnishing pass without scene.js needing its own texture logic).
export function wallpaperMaterial(baseColor) {
  const tex = buildWallpaperTexture(baseColor);
  tex.repeat.set(3, 2);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
}

export function floorMaterial(baseColor) {
  const tex = buildWoodTexture(baseColor, "#120c08");
  tex.repeat.set(4, 4);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
}
