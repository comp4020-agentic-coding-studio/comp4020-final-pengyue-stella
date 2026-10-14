// The two camera rigs, both reading the same avatar transform (see
// CLAUDE.md). A rig never mutates position/yaw itself — overhead renders the
// avatar from a fixed offset above-and-behind it; first-person puts the
// camera at the avatar's own head and drives look yaw/pitch from the mouse,
// and movement.js's `forwardYaw` reads that same look yaw so WASD is
// relative to where you're looking.
import * as THREE from "three";
import { EYE_HEIGHT } from "./scene.js";

const OVERHEAD_DISTANCE = 7.5;
const OVERHEAD_HEIGHT = 8.5;
const MAX_PITCH = Math.PI / 2 - 0.08;
const MIN_PITCH = -Math.PI / 2 + 0.3; // don't let overhead-style look go below the floor oddly in FP

export function createCameraRig(renderer, domElement) {
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);
  let mode = "overhead"; // "overhead" | "first-person"
  let lookYaw = 0;
  let lookPitch = -0.15;
  let pointerLocked = false;

  function resize() {
    const { clientWidth, clientHeight } = domElement;
    camera.aspect = clientWidth / Math.max(1, clientHeight);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === domElement;
  }
  document.addEventListener("pointerlockchange", onPointerLockChange);

  function onMouseMove(e) {
    if (mode !== "first-person" || !pointerLocked) return;
    lookYaw -= e.movementX * 0.0022;
    lookPitch -= e.movementY * 0.0022;
    lookPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, lookPitch));
  }
  window.addEventListener("mousemove", onMouseMove);

  function requestPointerLock() {
    if (mode === "first-person") domElement.requestPointerLock?.();
  }

  function setMode(next) {
    mode = next;
    if (mode === "first-person") {
      requestPointerLock();
    } else if (document.pointerLockElement === domElement) {
      document.exitPointerLock?.();
    }
  }

  function toggle() {
    setMode(mode === "overhead" ? "first-person" : "overhead");
    return mode;
  }

  // Touch-drag look for first-person on devices without pointer lock.
  let dragging = false;
  let lastTouch = null;
  domElement.addEventListener("pointerdown", (e) => {
    if (mode !== "first-person" || e.pointerType !== "touch") return;
    dragging = true;
    lastTouch = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging || !lastTouch) return;
    const dx = e.clientX - lastTouch.x;
    const dy = e.clientY - lastTouch.y;
    lastTouch = { x: e.clientX, y: e.clientY };
    lookYaw -= dx * 0.004;
    lookPitch -= dy * 0.004;
    lookPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, lookPitch));
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
    lastTouch = null;
  });

  // `avatar` is { x, z, yaw } — the one shared transform. Overhead orbits
  // behind that yaw so turning (via movement) visibly swings the camera;
  // first-person ignores avatar yaw entirely and uses mouse-look yaw.
  function update(avatar) {
    if (mode === "overhead") {
      // A fixed diagonal angle that translates with the avatar but never
      // rotates with its facing — classic isometric-style framing, and it
      // keeps WASD meaning the same screen direction regardless of which
      // way the avatar is currently facing.
      camera.position.set(avatar.x, OVERHEAD_HEIGHT, avatar.z + OVERHEAD_DISTANCE);
      camera.lookAt(avatar.x, 0.5, avatar.z);
    } else {
      camera.position.set(avatar.x, EYE_HEIGHT, avatar.z);
      // Standard three.js "camera looks down -Z at yaw 0" convention — kept
      // consistent with movement.js's forwardYaw math and with the avatar
      // mesh's own facing direction (see avatar.js), so W always means "the
      // way this rig is currently looking" with no hidden offset anywhere.
      const dir = new THREE.Vector3(
        -Math.sin(lookYaw) * Math.cos(lookPitch),
        Math.sin(lookPitch),
        -Math.cos(lookYaw) * Math.cos(lookPitch),
      );
      camera.lookAt(camera.position.clone().add(dir));
    }
  }

  return {
    camera,
    get mode() {
      return mode;
    },
    get lookYaw() {
      return lookYaw;
    },
    get pointerLocked() {
      return pointerLocked;
    },
    toggle,
    setMode,
    update,
    resize,
  };
}
