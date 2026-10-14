// One avatar mesh factory shared by the local visitor (hidden in
// first-person, per CLAUDE.md's camera-rig rule) and every remote visitor
// (always shown, interpolated toward their last reported position).
import * as THREE from "three";

export function buildAvatarMesh(color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: color ?? "#c6a16b", roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), bodyMat);
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), bodyMat);
  head.position.y = 1.55;
  // A facing wedge so a remote avatar's yaw is readable at a glance, not
  // just a column standing in place.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: "#e9ddc5" }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.55, 0.26);
  group.add(body, head, nose);
  return group;
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
  sprite.position.y = 2.05;
  return sprite;
}

export class RemoteAvatar {
  constructor(scene, visitorId, { x, z, yaw, name, color }) {
    this.scene = scene;
    this.visitorId = visitorId;
    this.mesh = buildAvatarMesh(color);
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
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * k;
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * k;
    let dyaw = this.target.yaw - this.mesh.rotation.y;
    dyaw = ((dyaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    this.mesh.rotation.y += dyaw * k;
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}
