// The visitor avatar: a real rigged humanoid model (Kenney "Mini
// Characters", CC0 1.0 — see public/vendor/README.md and ASSETS.md for full
// provenance) with idle/walk animation blending, dressed in a procedural
// Gothic-Victorian cape/collar/belt tinted to the visitor's own colour. This
// is the one deliberate exception to the project's otherwise-procedural
// visual stack (see ASSETS.md's hybrid-asset decision): a jointed walking
// humanoid is the one asset class genuinely hard to fake convincingly with
// primitive geometry, so it's downloaded and vendored exactly like
// three.module.min.js already was — nothing here touches the server's own
// dependency graph, and the model is fetched by the browser once and cached.
//
// Shared by the local visitor (hidden in first-person, per CLAUDE.md's
// camera-rig rule) and every remote visitor (always shown, position/yaw
// interpolated).
import * as THREE from "three";
import { GLTFLoader } from "../vendor/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "../vendor/addons/utils/SkeletonUtils.js";

const MODEL_URL = "/vendor/assets/avatar/character-male-a.glb";
const TARGET_HEIGHT = 1.7; // world units, feet to top of head
const HEAD_HEIGHT = 1.72; // approximate — used only to park the name label

let templatePromise = null;
// Loaded once, reused as the clone source for every avatar instance — the
// network fetch and glTF parse happen exactly once per page load, not once
// per visitor.
function loadAvatarTemplate() {
  if (!templatePromise) {
    const loader = new GLTFLoader();
    templatePromise = loader.loadAsync(MODEL_URL).then((gltf) => ({
      scene: gltf.scene,
      animations: gltf.animations,
    }));
  }
  return templatePromise;
}

function limbMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
}

// Gothic-Victorian dressing — a short cape, collar and belt — carried over
// from the original hand-built rig and now layered onto the downloaded
// model instead of replacing it. Scaled to `scale` (the same factor the
// model itself is normalised by) so the dressing always sits correctly
// regardless of the base model's own raw proportions.
function buildDressing(color, scale) {
  const group = new THREE.Group();
  const coatColor = color ?? "#3a2a22";
  const trimColor = "#c6a16b";
  const shoulderY = TARGET_HEIGHT * 0.62;
  const hipY = TARGET_HEIGHT * 0.32;

  const capeMat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.85, side: THREE.DoubleSide });
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.42 * scale, 0.75 * scale), capeMat);
  cape.position.set(0, shoulderY - 0.18 * scale, -0.1 * scale);
  cape.rotation.x = 0.15;
  group.add(cape);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.16 * scale, 0.025 * scale, 6, 12), limbMaterial(trimColor));
  collar.position.y = shoulderY + 0.05 * scale;
  collar.rotation.x = Math.PI / 2;
  group.add(collar);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2 * scale, 0.02 * scale, 6, 12), limbMaterial(trimColor));
  belt.position.y = hipY;
  belt.rotation.x = Math.PI / 2;
  group.add(belt);

  return group;
}

// Builds one avatar instance. Returns `{ group, update(dt, speed01) }`
// immediately and synchronously — `group` is usable and addable to the
// scene right away (empty but positioned correctly) while the model loads
// in the background and is spliced in, so callers never need to await
// anything or redesign around a Promise.
export function buildAvatarMesh(color) {
  const group = new THREE.Group();
  let mixer = null;
  let idleAction = null;
  let walkAction = null;

  loadAvatarTemplate().then(({ scene: templateScene, animations }) => {
    const model = cloneSkeleton(templateScene);

    // Normalise scale from the model's own real (post-bind-pose) bounding
    // box, not a hand-measured constant — robust to this specific Kenney
    // character's actual proportions without needing to hard-code them.
    const box = new THREE.Box3().setFromObject(model);
    const height = Math.max(0.01, box.max.y - box.min.y);
    const scale = TARGET_HEIGHT / height;
    model.scale.setScalar(scale);
    // Re-centre on the floor plane: the model's own bind pose may not put
    // its feet at exactly y=0 after scaling.
    model.position.y -= box.min.y * scale;
    group.add(model);
    group.add(buildDressing(color, scale));

    const idleClip = animations.find((a) => a.name === "idle");
    const walkClip = animations.find((a) => a.name === "walk");
    mixer = new THREE.AnimationMixer(model);
    if (idleClip) {
      idleAction = mixer.clipAction(idleClip);
      idleAction.play();
    }
    if (walkClip) {
      walkAction = mixer.clipAction(walkClip);
      walkAction.play();
      walkAction.setEffectiveWeight(0);
    }
  });

  // `speed01` is how fast this avatar is currently moving (0 idle, 1 full
  // stride) — crossfades idle/walk by weight rather than hard-switching, so
  // starting/stopping reads as a blend, not a pop.
  function update(dt, speed01) {
    if (!mixer) return;
    if (idleAction) idleAction.setEffectiveWeight(1 - speed01);
    if (walkAction) walkAction.setEffectiveWeight(speed01);
    mixer.update(dt);
  }

  return { group, update };
}

export function buildNameLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(17,16,15,0.75)";
  ctx.roundRect?.(0, 8, 256, 48, 10) ?? ctx.rect(0, 8, 256, 48);
  ctx.fill();
  ctx.fillStyle = "#e9ddc5";
  ctx.font = "600 28px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 22), 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.4, 0.35, 1);
  sprite.position.y = HEAD_HEIGHT + 0.35;
  return sprite;
}

export class RemoteAvatar {
  constructor(scene, visitorId, { x, z, yaw, name, color }) {
    this.scene = scene;
    this.visitorId = visitorId;
    const { group, update } = buildAvatarMesh(color);
    this.mesh = group;
    this.update = update;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = yaw;
    this.label = buildNameLabel(name ?? "Visitor");
    this.mesh.add(this.label);
    scene.add(this.mesh);
    this.target = { x, z, yaw };
  }

  setTarget(x, z, yaw) {
    this.target = { x, z, yaw };
  }

  tick(dt) {
    // Simple exponential smoothing toward the last reported position — this
    // is purely a render-side interpolation over the server-relayed value,
    // never a second source of truth for where a visitor actually is.
    const k = Math.min(1, dt * 10);
    const prevX = this.mesh.position.x;
    const prevZ = this.mesh.position.z;
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * k;
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * k;
    let dyaw = this.target.yaw - this.mesh.rotation.y;
    dyaw = ((dyaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    this.mesh.rotation.y += dyaw * k;

    const movedDist = Math.hypot(this.mesh.position.x - prevX, this.mesh.position.z - prevZ);
    const speed01 = dt > 0 ? Math.min(1, movedDist / dt / 3) : 0;
    this.update(dt, speed01);
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
