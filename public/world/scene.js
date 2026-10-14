// Furnished world geometry: textured floor/walls/ceiling, gallery signage,
// a dressed donor counter, and gallery-specific furniture layouts (display
// cabinets, portrait frames, rugs, plants, candles, a chandelier — see
// furniture.js). Everything here is built once from the server's
// /api/world payload — the client never invents geometry the server
// doesn't know about, so collision (computed from the same rects
// client-side) always matches what's actually drawn.
import * as THREE from "three";
import {
  buildDisplayCabinet,
  buildPortraitFrame,
  buildRug,
  buildPottedPlant,
  buildCandle,
  buildChandelier,
  buildBookshelf,
  buildSpecimenVitrine,
  buildStandingClock,
  buildDollDisplay,
  buildSideTable,
  buildClutterObject,
  wallpaperMaterial,
  floorMaterial,
} from "./furniture.js";
import { buildLabelTexture } from "./textures.js";
import { buildArtifactMesh } from "./artifacts.js";

// Hangs a short run of portrait frames along one wall of a gallery, well
// inside the walkable rect (see movement.js's RADIUS) so a frame is never
// behind where a visitor can actually stand to read it. `side` is which
// wall ("north"/"south"/"east"/"west"), matched to world.js's own wall
// naming so a gallery's doorway side is simply never passed in here.
function lineWallFrames(group, bounds, side, accent, count = 2) {
  const inset = 0.18;
  const positions = count === 1 ? [0.5] : Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  for (const t of positions) {
    const frame = buildPortraitFrame({ accent });
    if (side === "north" || side === "south") {
      const x = bounds.minX + (bounds.maxX - bounds.minX) * t;
      const z = side === "north" ? bounds.maxZ - inset : bounds.minZ + inset;
      frame.position.set(x, 1.55, z);
      frame.rotation.y = side === "north" ? Math.PI : 0;
    } else {
      const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * t;
      const x = side === "east" ? bounds.maxX - inset : bounds.minX + inset;
      frame.position.set(x, 1.55, z);
      frame.rotation.y = side === "east" ? -Math.PI / 2 : Math.PI / 2;
    }
    group.add(frame);
  }
}

// The server's gallery payload carries `doorway` but not the `doorSide`
// label world.js computes it from — derived here the same way addSigns
// already derives a doorway-facing direction, so furnishing never hangs a
// frame on the wall a visitor actually walks in through.
function doorSideOf(gallery) {
  const { bounds, doorway } = gallery;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  if (Math.abs(doorway.z - cz) >= Math.abs(doorway.x - cx)) {
    return doorway.z > cz ? "north" : "south";
  }
  return doorway.x > cx ? "east" : "west";
}

// A small side table bearing two clutter pieces, placed against a wall —
// cheap floor-level density between the named "hero" furniture pieces so a
// gallery never reads as mostly bare floor between its cabinet/vitrine/
// bookshelf and its walls.
function placeSideTable(group, x, z, accent, variantSeed) {
  const table = buildSideTable();
  table.position.set(x, 0, z);
  group.add(table);
  const topY = table.userData.topHeight;
  for (let i = 0; i < 2; i++) {
    const clutter = buildClutterObject(accent, variantSeed + i);
    clutter.position.set(x + (i === 0 ? -0.07 : 0.08), topY + 0.04, z + (i === 0 ? 0.05 : -0.04));
    group.add(clutter);
  }
}

const WALL_HEIGHT = 3.4;
const WALL_THICKNESS = 0.25;
const EYE_HEIGHT = 1.65;
// Ceiling meshes render only on this layer; the overhead rig stays on
// layer 0 only (so its downward view is never blocked), first-person
// enables this layer too (see cameras.js) so the room reads as enclosed.
const CEILING_LAYER = 1;

function rectGeometry(rect) {
  return new THREE.PlaneGeometry(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
}
function positionRect(mesh, rect) {
  mesh.position.x = (rect.minX + rect.maxX) / 2;
  mesh.position.z = (rect.minZ + rect.maxZ) / 2;
}
function rectSize(rect) {
  return { w: rect.maxX - rect.minX, d: rect.maxZ - rect.minZ };
}

function addFloorAndCeiling(scene, world) {
  const extent = 26;
  const baseFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(extent * 2, extent * 2),
    new THREE.MeshStandardMaterial({ color: "#0d0a08", roughness: 0.95 }),
  );
  baseFloor.rotation.x = -Math.PI / 2;
  scene.add(baseFloor);

  const hallFloorMat = floorMaterial("#2b1f17");
  const { w: hw, d: hd } = rectSize(world.hall.bounds);
  hallFloorMat.map.repeat.set(hw / 2, hd / 2);
  const hallFloor = new THREE.Mesh(rectGeometry(world.hall.bounds), hallFloorMat);
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.y = 0.01;
  positionRect(hallFloor, world.hall.bounds);
  scene.add(hallFloor);

  // Ceiling meshes exist, but live on render layer 1 (CEILING_LAYER) rather
  // than the default layer 0 — the overhead camera rig never enables that
  // layer (see cameras.js), so its straight-down view of the room is
  // unaffected, while first-person (which looks up, not down) enables it and
  // gets a properly enclosed room instead of a view straight into the void.
  // An earlier version had no ceiling mesh at all to avoid blocking the
  // overhead camera; the layer split gets both rigs what they need from the
  // same geometry instead of omitting it.
  const ceilingMat = new THREE.MeshStandardMaterial({ color: "#1a140f", roughness: 0.95, side: THREE.BackSide });
  function addCeiling(rect) {
    const ceiling = new THREE.Mesh(rectGeometry(rect), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT - 0.02;
    positionRect(ceiling, rect);
    ceiling.layers.set(CEILING_LAYER);
    scene.add(ceiling);
  }
  addCeiling(world.hall.bounds);
  for (const gallery of world.galleries) {
    addCeiling(gallery.bounds);
    addCeiling(gallery.corridor);
  }

  for (const gallery of world.galleries) {
    const floorMat = floorMaterial(shadeColor(gallery.accent, -0.55));
    const { w, d } = rectSize(gallery.bounds);
    floorMat.map.repeat.set(w / 2, d / 2);
    const floor = new THREE.Mesh(rectGeometry(gallery.bounds), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.012;
    positionRect(floor, gallery.bounds);
    scene.add(floor);

    const corridorFloor = new THREE.Mesh(
      rectGeometry(gallery.corridor),
      new THREE.MeshStandardMaterial({ color: "#2b1f17", roughness: 0.9 }),
    );
    corridorFloor.rotation.x = -Math.PI / 2;
    corridorFloor.position.y = 0.01;
    positionRect(corridorFloor, gallery.corridor);
    scene.add(corridorFloor);
  }
}

// Lightens/darkens a "#rrggbb" colour by `amount` (-1..1), used to derive a
// gallery's floor shade from its accent without a second hand-authored
// palette entry.
function shadeColor(hex, amount) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.l = Math.max(0.05, Math.min(0.5, hsl.l + amount));
  hsl.s = Math.max(0.1, hsl.s * 0.6);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return `#${c.getHexString()}`;
}

function addWalls(scene, world) {
  const group = new THREE.Group();
  const wallpaperCache = new Map();
  function wallpaperFor(colorKey) {
    if (!wallpaperCache.has(colorKey)) wallpaperCache.set(colorKey, wallpaperMaterial(colorKey));
    return wallpaperCache.get(colorKey);
  }

  for (const seg of world.walls) {
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const length = Math.hypot(dx, dz);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, WALL_HEIGHT, WALL_THICKNESS), wallpaperFor(seg.color));
    mesh.position.set((seg.x1 + seg.x2) / 2, WALL_HEIGHT / 2, (seg.z1 + seg.z2) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);

    // Crown moulding: a thin brass-toned strip along the top edge.
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.08, WALL_THICKNESS + 0.04),
      new THREE.MeshStandardMaterial({ color: "#88653D", roughness: 0.5, metalness: 0.4 }),
    );
    trim.position.set((seg.x1 + seg.x2) / 2, WALL_HEIGHT - 0.04, (seg.z1 + seg.z2) / 2);
    trim.rotation.y = -Math.atan2(dz, dx);

    group.add(mesh, trim);
  }
  scene.add(group);
  return group;
}

// Three.js r155+ expresses PointLight intensity in physically-based candela,
// where realistic room-scale brightness needs intensities roughly two
// orders of magnitude higher than the pre-r155 "just a visible number"
// convention this file was originally written against (see app.js's
// renderer setup comment for the full story — this is what made every
// gallery read as "nearly black, empty" before any furniture was even
// added). PHYSICAL_LIGHT_SCALE converts the original, readable intensity
// values below back to something that actually lights a room under
// ACESFilmicToneMapping, without hand-retuning every call site's number.
const PHYSICAL_LIGHT_SCALE = 40;

function addLighting(scene, world) {
  const breathingLights = [];
  // Ambient/hemisphere fill is the baseline-readability layer: unlike a
  // PointLight it never falls off with distance, so it's what keeps the
  // floor, walls and a distant visitor legible everywhere in an 18x14
  // room — not just within a few metres of a chandelier. A single centred
  // point light per gallery (tried first) left a visitor standing near a
  // far wall in near-total darkness, since physically-based 1/d^2 falloff
  // means a room this size needs either many more point lights or a much
  // stronger uniform fill; fill is the one that can't ever leave a corner
  // unreadably dark by construction. Point lights below now layer warm,
  // moody *accent* pooling on top of that floor, not the only source of
  // visibility.
  scene.add(new THREE.AmbientLight("#5a4a36", 2.6));
  scene.add(new THREE.HemisphereLight("#6a5640", "#1a130b", 1.1));

  const hallChandelier = buildChandelier();
  hallChandelier.position.set(0, WALL_HEIGHT - 0.5, 0);
  hallChandelier.scale.setScalar(1.3);
  scene.add(hallChandelier);
  breathingLights.push({ light: hallChandelier.userData.flickerLight, base: 1.2 * PHYSICAL_LIGHT_SCALE });

  for (const gallery of world.galleries) {
    const cx = (gallery.bounds.minX + gallery.bounds.maxX) / 2;
    const cz = (gallery.bounds.minZ + gallery.bounds.maxZ) / 2;
    const halfW = (gallery.bounds.maxX - gallery.bounds.minX) / 2;
    const halfD = (gallery.bounds.maxZ - gallery.bounds.minZ) / 2;

    const chandelier = buildChandelier();
    chandelier.position.set(cx, WALL_HEIGHT - 0.5, cz);
    scene.add(chandelier);
    breathingLights.push({ light: chandelier.userData.flickerLight, base: 1.2 * PHYSICAL_LIGHT_SCALE });

    // A coloured accent wash keeps each gallery's identity even once warm
    // candle/chandelier light is layered on top.
    const accentLight = new THREE.PointLight(gallery.accent, 0.6 * PHYSICAL_LIGHT_SCALE, 0, 2);
    accentLight.position.set(cx, 1.4, cz);
    scene.add(accentLight);
    breathingLights.push({ light: accentLight, base: 0.6 * PHYSICAL_LIGHT_SCALE });

    // One warm secondary lamp toward the wall opposite the doorway, so a
    // visitor standing near the far wall (the common case: that's exactly
    // where most display slots sit — see world.js's wallSlots) gets a
    // second, closer pool of light rather than relying on the fill alone to
    // carry the whole far end of an 18x14 room from one centred chandelier.
    const towardFarWallX = gallery.doorway.x !== cx ? -Math.sign(gallery.doorway.x - cx) * halfW * 0.6 : 0;
    const towardFarWallZ = gallery.doorway.z !== cz ? -Math.sign(gallery.doorway.z - cz) * halfD * 0.6 : 0;
    const farLamp = new THREE.PointLight("#ffb866", 0.7 * PHYSICAL_LIGHT_SCALE, 0, 2);
    farLamp.position.set(cx + towardFarWallX, 2.2, cz + towardFarWallZ);
    scene.add(farLamp);
    breathingLights.push({ light: farLamp, base: 0.7 * PHYSICAL_LIGHT_SCALE });
  }
  return breathingLights;
}

// A sparse field of slow-drifting motes, the blueprint's "subtle
// supernatural anomalies" read as plain dust catching lamp light rather
// than anything overtly spectral. Skipped entirely under
// prefers-reduced-motion (see CLAUDE.md's reduced-motion rule) by simply
// never advancing it from tickAmbient in that case.
function addDust(scene) {
  const count = 220;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 50;
    positions[i * 3 + 1] = Math.random() * 3.5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#c6a16b", size: 0.025, transparent: true, opacity: 0.35, depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return points;
}

function addSigns(scene, world) {
  for (const gallery of world.galleries) {
    const tex = buildLabelTexture(gallery.name, { fg: gallery.accent });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.75),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    const cx = (gallery.bounds.minX + gallery.bounds.maxX) / 2;
    const cz = (gallery.bounds.minZ + gallery.bounds.maxZ) / 2;
    const dx = gallery.doorway.x - cx;
    const dz = gallery.doorway.z - cz;
    const len = Math.hypot(dx, dz) || 1;
    mesh.position.set(
      gallery.doorway.x - (dx / len) * 1.6,
      2.7,
      gallery.doorway.z - (dz / len) * 1.6,
    );
    mesh.rotation.y = Math.atan2(dx, dz);
    scene.add(mesh);
  }
}

function addDonorCounter(scene, world) {
  const group = new THREE.Group();
  const deskMat = new THREE.MeshStandardMaterial({ color: "#2a1c14", roughness: 0.6 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.0), deskMat);
  desk.position.y = 0.5;
  group.add(desk);

  // Front-facing nameplate reading "DONATIONS", the blueprint's "clearly
  // identifiable reception/donation desk" requirement — not just a prop
  // that happens to be near a proximity hint.
  const plateTex = buildLabelTexture("DONATIONS", { bg: "#1c1109", fg: "#c6a16b", size: [512, 128] });
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.4),
    new THREE.MeshBasicMaterial({ map: plateTex, transparent: true }),
  );
  plate.position.set(0, 0.75, 0.51);
  group.add(plate);

  const topPlate = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.08, 0.6),
    new THREE.MeshStandardMaterial({ color: "#c6a16b", metalness: 0.6, roughness: 0.35 }),
  );
  topPlate.position.set(0, 1.04, 0);
  group.add(topPlate);

  // A small ledger/book prop on the desk for visual interest.
  const ledger = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.05, 0.25),
    new THREE.MeshStandardMaterial({ color: "#5a1f22", roughness: 0.8 }),
  );
  ledger.position.set(-0.3, 1.08, 0.1);
  ledger.rotation.y = 0.2;
  group.add(ledger);

  const candle = buildCandle();
  candle.position.set(0.3, 1.04, 0.1);
  group.add(candle);

  const lamp = new THREE.PointLight("#ffb866", 0.9 * PHYSICAL_LIGHT_SCALE, 5, 2);
  lamp.position.set(0, 1.6, 0);
  group.add(lamp);

  const rug = buildRug({ width: 2.0, depth: 1.4, color: "#3a1f28" });
  rug.position.set(0, 0, -0.6);
  group.add(rug);

  group.position.set(world.hall.donorCounter.x, 0, world.hall.donorCounter.z);
  scene.add(group);
  return { group, flickerLight: candle.userData.flickerLight };
}

// Gallery-specific furniture layouts. Each places furniture against the
// gallery's own wall interior (never blocking the doorway side, same
// awareness world.js's slot placement already has) and well clear of the
// walkable-rect edges so collision and visual geometry never disagree about
// where a visitor can actually stand. Density matches the brief: "ornate
// furniture, portraits, antique clocks, books, glass specimen cabinets,
// sculptures, strange objects, carpets, wall decorations."
const FURNISH_BY_CATEGORY = {
  portrait: furnishPortraitGallery,
  memento: furnishMementoGallery,
  specimen: furnishSpecimenGallery,
  toy: furnishChildhoodGallery,
};

function furnishPortraitGallery(group, gallery, breathingLights) {
  const { bounds, accent } = gallery;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;

  const rug = buildRug({ width: (bounds.maxX - bounds.minX) * 0.55, depth: (bounds.maxZ - bounds.minZ) * 0.55, color: "#5a1f22" });
  rug.position.set(cx, 0, cz);
  group.add(rug);

  // A row of portrait frames along each side wall that isn't the doorway.
  const frameCount = 3;
  const positions = [
    { x: bounds.minX + 0.2, side: "west" },
    { x: bounds.maxX - 0.2, side: "east" },
  ];
  for (const { x, side } of positions) {
    for (let i = 0; i < frameCount; i++) {
      const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * (i + 1)) / (frameCount + 1);
      const frame = buildPortraitFrame({ accent });
      frame.position.set(x, 1.5, z);
      frame.rotation.y = side === "west" ? Math.PI / 2 : -Math.PI / 2;
      group.add(frame);
    }
  }

  const plant = buildPottedPlant({ height: 1.2 });
  plant.position.set(cx + (bounds.maxX - bounds.minX) * 0.3, 0, bounds.minZ + 0.5);
  group.add(plant);

  const candleTable = buildSideTable();
  candleTable.position.set(cx - (bounds.maxX - bounds.minX) * 0.3, 0, bounds.minZ + 0.5);
  group.add(candleTable);
  const candle = buildCandle();
  candle.position.set(cx - (bounds.maxX - bounds.minX) * 0.3, candleTable.userData.topHeight, bounds.minZ + 0.5);
  group.add(candle);
  if (candle.userData.flickerLight) breathingLights.push({ light: candle.userData.flickerLight, base: 0.4 });

  placeSideTable(group, cx + (bounds.maxX - bounds.minX) * 0.3, bounds.maxZ - 0.6, accent, 1);
  placeSideTable(group, cx - (bounds.maxX - bounds.minX) * 0.3, bounds.maxZ - 0.6, accent, 3);
}

function furnishMementoGallery(group, gallery, breathingLights) {
  const { bounds, accent } = gallery;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const doorSide = doorSideOf(gallery);

  const rug = buildRug({ width: (bounds.maxX - bounds.minX) * 0.5, depth: (bounds.maxZ - bounds.minZ) * 0.6, color: "#3a2a1a" });
  rug.position.set(cx, 0, cz);
  group.add(rug);

  const cabinet = buildDisplayCabinet({ accent, width: 1.4, height: 2.3 });
  cabinet.position.set(bounds.maxX - 1.0, 0, cz);
  cabinet.rotation.y = -Math.PI / 2;
  group.add(cabinet);

  // Against the south wall, well clear of the west doorway it would
  // otherwise crowd (see the double-modulo bug fix comment elsewhere in
  // this codebase for the general lesson: check placement against the
  // actual door side, don't assume a hand-picked offset avoids it).
  const clock = buildStandingClock();
  clock.position.set(cx + (bounds.maxX - bounds.minX) * 0.22, 0, bounds.minZ + 0.5);
  clock.rotation.y = 0;
  group.add(clock);

  const plant = buildPottedPlant({ height: 1.0 });
  plant.position.set(cx - (bounds.maxX - bounds.minX) * 0.22, 0, bounds.maxZ - 0.5);
  group.add(plant);

  for (const side of ["north", "south"]) {
    if (side === doorSide) continue;
    lineWallFrames(group, bounds, side, accent, 2);
  }

  placeSideTable(group, bounds.minX + 0.6, cz - (bounds.maxZ - bounds.minZ) * 0.28, accent, 0);
  const candleTable = buildSideTable();
  candleTable.position.set(bounds.minX + 0.6, 0, cz + (bounds.maxZ - bounds.minZ) * 0.28);
  group.add(candleTable);
  const candle = buildCandle();
  candle.position.set(bounds.minX + 0.6, candleTable.userData.topHeight, cz + (bounds.maxZ - bounds.minZ) * 0.28);
  group.add(candle);
  if (candle.userData.flickerLight) breathingLights.push({ light: candle.userData.flickerLight, base: 0.4 });
}

function furnishSpecimenGallery(group, gallery, breathingLights) {
  const { bounds, accent } = gallery;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const doorSide = doorSideOf(gallery);

  const rug = buildRug({ width: (bounds.maxX - bounds.minX) * 0.5, depth: (bounds.maxZ - bounds.minZ) * 0.6, color: "#2e3a24" });
  rug.position.set(cx, 0, cz);
  group.add(rug);

  const cabinet = buildDisplayCabinet({ accent, width: 1.3, height: 2.2 });
  cabinet.position.set(bounds.minX + 1.0, 0, cz);
  cabinet.rotation.y = Math.PI / 2;
  group.add(cabinet);

  for (const dz of [-0.25, 0.25]) {
    const vitrine = buildSpecimenVitrine({ accent });
    vitrine.position.set(cx, 0, cz + (bounds.maxZ - bounds.minZ) * dz);
    group.add(vitrine);
  }

  const plant = buildPottedPlant({ height: 1.3 });
  plant.position.set(bounds.maxX - 1.4, 0, bounds.minZ + 0.5);
  group.add(plant);

  for (const side of ["north", "south"]) {
    if (side === doorSide) continue;
    lineWallFrames(group, bounds, side, accent, 2);
  }

  placeSideTable(group, bounds.maxX - 0.6, cz - (bounds.maxZ - bounds.minZ) * 0.28, accent, 1);
  const candleTable = buildSideTable();
  candleTable.position.set(bounds.maxX - 0.6, 0, cz + (bounds.maxZ - bounds.minZ) * 0.28);
  group.add(candleTable);
  const candle = buildCandle();
  candle.position.set(bounds.maxX - 0.6, candleTable.userData.topHeight, cz + (bounds.maxZ - bounds.minZ) * 0.28);
  group.add(candle);
  if (candle.userData.flickerLight) breathingLights.push({ light: candle.userData.flickerLight, base: 0.4 });
}

function furnishChildhoodGallery(group, gallery, breathingLights) {
  const { bounds, accent } = gallery;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const doorSide = doorSideOf(gallery);

  const rug = buildRug({ width: (bounds.maxX - bounds.minX) * 0.55, depth: (bounds.maxZ - bounds.minZ) * 0.5, color: "#3a1f28" });
  rug.position.set(cx, 0, cz);
  group.add(rug);

  const shelf = buildBookshelf({ width: 1.3, height: 1.7 });
  shelf.position.set(cx, 0, bounds.maxZ - 0.2);
  shelf.rotation.y = Math.PI;
  group.add(shelf);

  for (const dx of [-0.3, 0.3]) {
    const doll = buildDollDisplay({ accent });
    doll.position.set(cx + (bounds.maxX - bounds.minX) * dx, 0, cz);
    group.add(doll);
  }

  for (const side of ["east", "west"]) {
    if (side === doorSide) continue;
    lineWallFrames(group, bounds, side, accent, 2);
  }

  placeSideTable(group, bounds.minX + 0.6, bounds.minZ + 0.6, accent, 0);
  const candleTable = buildSideTable();
  candleTable.position.set(bounds.maxX - 0.6, 0, bounds.minZ + 0.6);
  group.add(candleTable);
  const candle = buildCandle();
  candle.position.set(bounds.maxX - 0.6, candleTable.userData.topHeight, bounds.minZ + 0.6);
  group.add(candle);
  if (candle.userData.flickerLight) breathingLights.push({ light: candle.userData.flickerLight, base: 0.4 });
}

function addGalleryFurniture(scene, world, breathingLights) {
  for (const gallery of world.galleries) {
    const group = new THREE.Group();
    const furnish = FURNISH_BY_CATEGORY[gallery.category];
    if (furnish) furnish(group, gallery, breathingLights);
    scene.add(group);
  }
}

export function buildWorldScene(world) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0a0908");
  scene.fog = new THREE.Fog("#0a0908", 16, 38);

  addFloorAndCeiling(scene, world);
  addWalls(scene, world);
  const breathingLights = addLighting(scene, world);
  addSigns(scene, world);
  addGalleryFurniture(scene, world, breathingLights);
  const { group: donorCounter, flickerLight: donorFlicker } = addDonorCounter(scene, world);
  if (donorFlicker) breathingLights.push({ light: donorFlicker, base: 0.9 });
  const dust = addDust(scene);
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  function tickAmbient(elapsed) {
    if (prefersReducedMotion) return;
    for (let i = 0; i < breathingLights.length; i++) {
      const { light, base } = breathingLights[i];
      if (!light) continue;
      light.intensity = base + Math.sin(elapsed * 0.6 + i) * base * 0.08;
    }
    dust.rotation.y = elapsed * 0.01;
  }

  const exhibitGroup = new THREE.Group();
  scene.add(exhibitGroup);

  const exhibitMeshes = new Map(); // exhibitId -> mesh (for raycasting + highlight)

  function addExhibitMesh(exhibit, slot) {
    const gallery = world.galleries.find((g) => g.id === exhibit.galleryId);
    const { group, interactY } = buildArtifactMesh({
      category: exhibit.category,
      subtype: exhibit.subtype,
      accent: gallery?.accent ?? "#88653d",
      exhibitId: exhibit.id,
      title: exhibit.title,
      donorName: exhibit.donorName,
    });
    group.position.set(slot.x, 0, slot.z);
    group.rotation.y = slot.rotationY;
    group.userData.exhibitId = exhibit.id;
    group.userData.interactPoint = new THREE.Vector3(slot.x, interactY, slot.z);
    group.traverse((child) => {
      if (child.isMesh) child.userData.exhibitId = exhibit.id;
    });
    exhibitGroup.add(group);
    exhibitMeshes.set(exhibit.id, group);
    return group;
  }

  function removeHighlight() {
    for (const mesh of exhibitMeshes.values()) {
      mesh.traverse((c) => {
        if (c.isMesh && c.userData.__origEmissive !== undefined) {
          c.material.emissive?.setHex(c.userData.__origEmissive);
        }
      });
    }
  }

  function highlightExhibit(exhibitId) {
    removeHighlight();
    const mesh = exhibitMeshes.get(exhibitId);
    if (!mesh) return;
    mesh.traverse((c) => {
      if (c.isMesh && c.material?.emissive) {
        c.userData.__origEmissive = c.material.emissive.getHex();
        c.material.emissive.setHex(0x443311);
      }
    });
  }

  return {
    scene,
    exhibitGroup,
    exhibitMeshes,
    addExhibitMesh,
    highlightExhibit,
    removeHighlight,
    donorCounter,
    tickAmbient,
  };
}

// A one-shot (not continuously rendered) preview of a single artifact mesh
// on its own canvas, used by the donation receipt and the dossier header —
// rebuilding the same procedural model the exhibit itself uses rather than
// a screenshot, so the preview is always exactly what the visitor will find
// in the gallery. `canvas` is caller-owned so each UI surface can size its
// own; this function tears its renderer/scene down immediately after the
// single frame is drawn, leaving nothing running in the background.
export function renderArtifactPreview(canvas, { category, subtype, accent, exhibitId, title, donorName }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#120d09");
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
}

export { EYE_HEIGHT, CEILING_LAYER };
