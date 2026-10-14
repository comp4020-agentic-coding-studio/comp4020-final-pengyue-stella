// A proportionate, jointed humanoid visitor model — head, torso, two arms
// and two legs on hip/shoulder pivots, with a walk-cycle animation driven by
// how fast the avatar is actually moving. Built as original procedural
// geometry rather than an imported rigged model: no verified, properly-
// licensed humanoid glTF was available to source and check provenance for
// inside this build, and the zero-runtime-dependency stack (see CLAUDE.md)
// has no asset pipeline to vet one through — a hand-built rig keeps the
// same "every asset's provenance is known" guarantee the rest of the scene
// already holds itself to. Gothic-Victorian styling (long coat silhouette,
// dark palette, a short cape) keyed to the blueprint's visual identity.
//
// Shared by the local visitor (hidden in first-person, per CLAUDE.md's
// camera-rig rule) and every remote visitor (always shown, position/yaw
// interpolated, walk-cycle driven by its own interpolated speed).
import * as THREE from "three";

const HIP_HEIGHT = 0.9;
const SHOULDER_HEIGHT = 1.45;
const HEAD_HEIGHT = 1.72;

function limbMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
}

// A pivot Group at the joint origin containing the visible limb mesh offset
// downward from it, so rotating the pivot swings the limb like a real joint
// rather than rotating around the limb's own centre.
function buildLimb({ length, radius, color, topRadius = radius }) {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 4, 8),
    limbMaterial(color),
  );
  mesh.position.y = -length / 2;
  pivot.add(mesh);
  return { pivot, mesh };
}

export function buildAvatarMesh(color) {
  const skinColor = "#caa37c";
  const coatColor = color ?? "#3a2a22";
  const trimColor = "#c6a16b";

  const group = new THREE.Group();

  // Torso: a long Gothic coat silhouette — wider at the shoulders, flaring
  // slightly at the hem — rather than a plain cylinder.
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.26, SHOULDER_HEIGHT - HIP_HEIGHT + 0.35, 10),
    limbMaterial(coatColor),
  );
  torso.position.y = HIP_HEIGHT + (SHOULDER_HEIGHT - HIP_HEIGHT) / 2;
  group.add(torso);

  // A short cape, two back-facing planes, for Gothic-Victorian silhouette
  // read from any angle.
  const capeMat = new THREE.MeshStandardMaterial({
    color: coatColor, roughness: 0.85, side: THREE.DoubleSide,
  });
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.75), capeMat);
  cape.position.set(0, SHOULDER_HEIGHT - 0.3, -0.16);
  cape.rotation.x = 0.15;
  group.add(cape);

  // Trim collar/belt accents for silhouette readability at a distance.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 12), limbMaterial(trimColor));
  collar.position.y = SHOULDER_HEIGHT + 0.02;
  collar.rotation.x = Math.PI / 2;
  group.add(collar);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 6, 12), limbMaterial(trimColor));
  belt.position.y = HIP_HEIGHT + 0.05;
  belt.rotation.x = Math.PI / 2;
  group.add(belt);

  // Head + a simple brow line so facing direction reads even from overhead.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), limbMaterial(skinColor));
  head.position.y = HEAD_HEIGHT;
  group.add(head);
  const brow = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.03, 0.05),
    new THREE.MeshStandardMaterial({ color: "#1a1410" }),
  );
  brow.position.set(0, HEAD_HEIGHT + 0.03, 0.145);
  group.add(brow);

  // Arms: shoulder pivots at shoulder height, limb hanging down from there.
  const armLength = 0.62;
  const leftArm = buildLimb({ length: armLength, radius: 0.055, color: coatColor });
  leftArm.pivot.position.set(0.24, SHOULDER_HEIGHT - 0.05, 0);
  const rightArm = buildLimb({ length: armLength, radius: 0.055, color: coatColor });
  rightArm.pivot.position.set(-0.24, SHOULDER_HEIGHT - 0.05, 0);
  group.add(leftArm.pivot, rightArm.pivot);

  // Legs: hip pivots at hip height.
  const legLength = HIP_HEIGHT;
  const leftLeg = buildLimb({ length: legLength, radius: 0.08, color: "#241a15" });
  leftLeg.pivot.position.set(0.1, HIP_HEIGHT, 0);
  const rightLeg = buildLimb({ length: legLength, radius: 0.08, color: "#241a15" });
  rightLeg.pivot.position.set(-0.1, HIP_HEIGHT, 0);
  group.add(leftLeg.pivot, rightLeg.pivot);

  return {
    group,
    rig: { leftArm: leftArm.pivot, rightArm: rightArm.pivot, leftLeg: leftLeg.pivot, rightLeg: rightLeg.pivot },
  };
}

// Oscillates the limb pivots in a simple walk cycle. `speed01` is how fast
// the avatar is currently moving, 0 (idle — limbs settle to rest) to 1 (full
// stride); `phase` is an ever-increasing accumulator the caller owns so gait
// timing stays stable in both app.js's local-avatar loop and RemoteAvatar's
// own tick.
export function animateWalk(rig, phase, speed01) {
  const amplitude = 0.55 * Math.min(1, speed01);
  const swing = Math.sin(phase) * amplitude;
  rig.leftLeg.rotation.x = swing;
  rig.rightLeg.rotation.x = -swing;
  rig.leftArm.rotation.x = -swing * 0.7;
  rig.rightArm.rotation.x = swing * 0.7;
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
    const { group, rig } = buildAvatarMesh(color);
    this.mesh = group;
    this.rig = rig;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = yaw;
    this.label = buildNameLabel(name ?? "Visitor");
    this.mesh.add(this.label);
    scene.add(this.mesh);
    this.target = { x, z, yaw };
    this.walkPhase = 0;
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
    const speed01 = dt > 0 ? Math.min(1, (movedDist / dt) / 3) : 0;
    this.walkPhase += dt * 8 * Math.max(0.2, speed01);
    animateWalk(this.rig, this.walkPhase, speed01);
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
