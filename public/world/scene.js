// Static world geometry: floor, walls, gallery signage, the donor counter,
// and a factory for exhibit meshes. Everything here is built once from the
// server's /api/world payload — the client never invents geometry the
// server doesn't know about, so collision (computed from the same rects
// client-side) always matches what's actually drawn.
import * as THREE from "three";

const WALL_HEIGHT = 3.4;
const WALL_THICKNESS = 0.25;
const EYE_HEIGHT = 1.65;

function canvasTexture(text, { bg = "#11100f", fg = "#c6a16b", size = [512, 128] } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = size[0];
  canvas.height = size[1];
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = fg;
  ctx.font = `600 ${Math.floor(size[1] * 0.3)}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addFloor(scene, world) {
  const extent = 26;
  const baseFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(extent * 2, extent * 2),
    new THREE.MeshStandardMaterial({ color: "#1a1410", roughness: 0.95 }),
  );
  baseFloor.rotation.x = -Math.PI / 2;
  scene.add(baseFloor);

  const hallFloor = new THREE.Mesh(
    rectGeometry(world.hall.bounds),
    new THREE.MeshStandardMaterial({ color: "#2b1f17", roughness: 0.9 }),
  );
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.y = 0.01;
  positionRect(hallFloor, world.hall.bounds);
  scene.add(hallFloor);

  for (const gallery of world.galleries) {
    const floor = new THREE.Mesh(
      rectGeometry(gallery.bounds),
      new THREE.MeshStandardMaterial({ color: gallery.accent, roughness: 0.9, opacity: 0.35, transparent: true }),
    );
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

function rectGeometry(rect) {
  return new THREE.PlaneGeometry(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
}
function positionRect(mesh, rect) {
  mesh.position.x = (rect.minX + rect.maxX) / 2;
  mesh.position.z = (rect.minZ + rect.maxZ) / 2;
}

function addWalls(scene, world) {
  const group = new THREE.Group();
  for (const seg of world.walls) {
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const length = Math.hypot(dx, dz);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, WALL_HEIGHT, WALL_THICKNESS),
      new THREE.MeshStandardMaterial({ color: seg.color, roughness: 0.8 }),
    );
    mesh.position.set((seg.x1 + seg.x2) / 2, WALL_HEIGHT / 2, (seg.z1 + seg.z2) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    group.add(mesh);
  }
  scene.add(group);
  return group;
}

function addLighting(scene, world) {
  const breathingLights = [];
  scene.add(new THREE.AmbientLight("#2a2218", 0.9));
  const hallLight = new THREE.PointLight("#e8b873", 1.1, 14, 2);
  hallLight.position.set(0, 3, 0);
  scene.add(hallLight);
  breathingLights.push({ light: hallLight, base: 1.1 });

  for (const gallery of world.galleries) {
    const cx = (gallery.bounds.minX + gallery.bounds.maxX) / 2;
    const cz = (gallery.bounds.minZ + gallery.bounds.maxZ) / 2;
    const light = new THREE.PointLight(gallery.accent, 1.4, 16, 2);
    light.position.set(cx, 3.1, cz);
    scene.add(light);
    breathingLights.push({ light, base: 1.4 });

    // A second, dimmer warm lamp off-centre so the room doesn't read as one
    // flat wash of its accent colour.
    const lamp = new THREE.PointLight("#e8b873", 0.7, 10, 2);
    lamp.position.set(cx + (gallery.bounds.maxX - gallery.bounds.minX) * 0.2, 2.4, cz - (gallery.bounds.maxZ - gallery.bounds.minZ) * 0.2);
    scene.add(lamp);
    breathingLights.push({ light: lamp, base: 0.7 });
  }
  return breathingLights;
}

// A sparse field of slow-drifting motes, the blueprint's "subtle
// supernatural anomalies" read as plain dust catching lamp light rather
// than anything overtly spectral. Skipped entirely under
// prefers-reduced-motion (see CLAUDE.md's reduced-motion rule) by simply
// never calling tickDust from the render loop in that case.
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
    const tex = canvasTexture(gallery.name, { fg: gallery.accent });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.75),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    const cx = (gallery.bounds.minX + gallery.bounds.maxX) / 2;
    const cz = (gallery.bounds.minZ + gallery.bounds.maxZ) / 2;
    const dx = gallery.doorway.x - cx;
    const dz = gallery.doorway.z - cz;
    const len = Math.hypot(dx, dz) || 1;
    // Mount just inside the doorway, above head height, facing the hall.
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
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.0, 0.9),
    new THREE.MeshStandardMaterial({ color: "#2a1c14", roughness: 0.6 }),
  );
  desk.position.y = 0.5;
  group.add(desk);

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: "#c6a16b", metalness: 0.6, roughness: 0.35 }),
  );
  plate.position.set(0, 1.04, 0);
  group.add(plate);

  const lamp = new THREE.PointLight("#ffb866", 0.9, 5, 2);
  lamp.position.set(0, 1.5, 0);
  group.add(lamp);

  group.position.set(world.hall.donorCounter.x, 0, world.hall.donorCounter.z);
  scene.add(group);
  return group;
}

// One procedurally-styled object per category — original geometry, not
// photography or generated art, keyed to the gallery's category so every
// donation in a gallery reads as a family of similar objects.
function buildCategoryMesh(category, accent) {
  const group = new THREE.Group();
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.3 });
  const woodMat = new THREE.MeshStandardMaterial({ color: "#2a1c14", roughness: 0.7 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: "#cfe8ec", roughness: 0.05, metalness: 0, transmission: 0.85, transparent: true, opacity: 0.35,
  });

  if (category === "portrait") {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.08), woodMat);
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.15), new THREE.MeshStandardMaterial({ color: "#3a2f28" }));
    canvas.position.z = 0.045;
    group.add(frame, canvas);
    return { group, footprintY: 0, interactY: 0.7 };
  }

  if (category === "memento") {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.9, 10), woodMat);
    pedestal.position.y = 0.45;
    const relic = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), accentMat);
    relic.position.y = 0.98;
    group.add(pedestal, relic);
    return { group, footprintY: 0, interactY: 0.98 };
  }

  if (category === "specimen") {
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.6, 10), woodMat);
    pedestal.position.y = 0.3;
    const vitrine = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.62), glassMat);
    vitrine.position.y = 1.0;
    const specimen = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), accentMat);
    specimen.position.y = 1.0;
    group.add(pedestal, vitrine, specimen);
    return { group, footprintY: 0, interactY: 1.0 };
  }

  // toy
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.55, 8), woodMat);
  plinth.position.y = 0.275;
  const toy = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.28), accentMat);
  toy.position.y = 0.72;
  group.add(plinth, toy);
  return { group, footprintY: 0, interactY: 0.72 };
}

export function buildWorldScene(world) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0a0908");
  scene.fog = new THREE.Fog("#0a0908", 14, 34);

  addFloor(scene, world);
  addWalls(scene, world);
  const breathingLights = addLighting(scene, world);
  addSigns(scene, world);
  const donorCounter = addDonorCounter(scene, world);
  const dust = addDust(scene);
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  function tickAmbient(elapsed) {
    if (prefersReducedMotion) return;
    for (let i = 0; i < breathingLights.length; i++) {
      const { light, base } = breathingLights[i];
      light.intensity = base + Math.sin(elapsed * 0.6 + i) * base * 0.08;
    }
    dust.rotation.y = elapsed * 0.01;
  }

  const exhibitGroup = new THREE.Group();
  scene.add(exhibitGroup);

  const exhibitMeshes = new Map(); // exhibitId -> mesh (for raycasting + highlight)

  function addExhibitMesh(exhibit, slot) {
    const gallery = world.galleries.find((g) => g.id === exhibit.galleryId);
    const { group, interactY } = buildCategoryMesh(exhibit.category, gallery?.accent ?? "#88653d");
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

export { EYE_HEIGHT };
