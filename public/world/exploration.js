// The entire exploration model, replacing the old continuous-movement +
// dual-camera-rig system (see docs/adr/0003-scene-exploration.md). There is
// no avatar position any more: a visitor is always exactly "at" one of the
// server's fixed SCENES (server/src/world.js), and the camera is a pure
// function of that scene's own vantage ({ pos, lookAt, fov }). Moving
// between scenes is a cut (a brief fade, "stepping through a doorway" or
// "focusing into a display"); turning between a hub's four facings (the one
// scene kind with more than one exit) is a smooth look-turn, not a cut — the
// visitor hasn't gone anywhere, only turned to face a different doorway.
import * as THREE from "three";

// A visitor turning or stepping between scenes under
// prefers-reduced-motion gets a near-instant swap instead of an animated
// tween/fade — same reasoning as scene.js's own ambient-animation skip
// (CLAUDE.md's reduced-motion rule), applied here to camera motion rather
// than particle/light animation.
const PREFERS_REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const TURN_MS = PREFERS_REDUCED_MOTION ? 1 : 480;
const FADE_OUT_MS = PREFERS_REDUCED_MOTION ? 1 : 170;
const FADE_IN_MS = PREFERS_REDUCED_MOTION ? 1 : 260;

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpVec(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
// Smoothstep easing — gentle start/stop reads as deliberate camera motion
// rather than a linear, slightly mechanical pan.
function ease(t) {
  return t * t * (3 - 2 * t);
}

// Every scene's `vantage.fov` from the server (server/src/world.js) is
// authored and checked against this reference aspect ratio — every
// hotspot and display slot's world position was verified to sit within
// that vertical FOV's corresponding HORIZONTAL field of view at this
// width:height. Three.js's PerspectiveCamera.fov is the VERTICAL field of
// view, with horizontal FOV following from aspect — so on a narrower
// viewport (a phone in portrait, a tall split window) than this reference,
// the horizontal FOV shrinks and a side-wall display slot or hotspot that
// was comfortably in frame at the reference aspect can silently fall
// outside the actual rendered view. See `verticalFovFor` below for the fix.
const REFERENCE_ASPECT = 16 / 10;

// Derives the vertical FOV to actually apply so the HORIZONTAL field of
// view never shrinks below what it was at REFERENCE_ASPECT, however narrow
// the real viewport is — the standard "Hor+"-style correction, applied in
// the direction this app needs it (most such techniques widen the
// horizontal FOV on wide screens and leave narrow screens alone; this app's
// hotspots need the opposite guarantee — narrow screens must not lose
// horizontal FOV — so this only ever grows the vertical FOV, never shrinks
// it, and is a no-op at or above the reference aspect).
// Capped well short of 180°: beyond roughly 110-115° a perspective camera's
// edges distort enough to feel like a fisheye lens rather than a wider
// room, so on a very narrow viewport (a phone in portrait) this trades a
// little of the horizontal-FOV guarantee back for a believable, non-warped
// image — a deliberate, bounded trade-off, not an attempt to solve every
// aspect ratio perfectly.
const MAX_VFOV_DEG = 112;

function verticalFovFor(baseFovDeg, aspect) {
  if (aspect >= REFERENCE_ASPECT) return baseFovDeg;
  const baseVFovRad = (baseFovDeg * Math.PI) / 180;
  const targetHFovRad = 2 * Math.atan(Math.tan(baseVFovRad / 2) * REFERENCE_ASPECT);
  const neededVFovRad = 2 * Math.atan(Math.tan(targetHFovRad / 2) / aspect);
  return Math.min(MAX_VFOV_DEG, (neededVFovRad * 180) / Math.PI);
}

export function createExplorationController({ camera, world, fadeEl, onSceneChange }) {
  const scenesById = new Map(world.scenes.map((s) => [s.id, s]));
  let current = scenesById.get(world.defaultSceneId);
  let turn = null; // { from: lookAt, to: lookAt, elapsed }
  let fade = null; // { phase: "out" | "in", elapsed, pendingSceneId }

  function applyVantage(vantage) {
    camera.position.set(...vantage.pos);
    camera.fov = verticalFovFor(vantage.fov, camera.aspect);
    camera.updateProjectionMatrix();
    camera.lookAt(...vantage.lookAt);
  }

  applyVantage(current.vantage);

  function currentScene() {
    return current;
  }

  // Re-derives the active scene's FOV for the camera's current aspect —
  // called after a resize, since verticalFovFor's correction depends on
  // aspect and a visitor can resize (or rotate a phone) without navigating
  // to a different scene at all.
  function handleResize() {
    if (!turn && !fade) {
      camera.fov = verticalFovFor(current.vantage.fov, camera.aspect);
      camera.updateProjectionMatrix();
      camera.lookAt(...current.vantage.lookAt);
    }
  }

  // A hub "turn" (left/right between the four doorway facings) is a smooth
  // look-only tween at a fixed position — the visitor hasn't moved, only
  // turned. Any scene-to-scene move is a cut (see goToScene).
  function turnTo(sceneId) {
    const next = scenesById.get(sceneId);
    if (!next || turn || fade) return;
    turn = { fromLookAt: current.vantage.lookAt, toLookAt: next.vantage.lookAt, elapsed: 0, next };
  }

  function turnLeft() {
    if (current.turnLeft) turnTo(current.turnLeft);
  }
  function turnRight() {
    if (current.turnRight) turnTo(current.turnRight);
  }

  // A cut to a different scene: fade to opaque, swap the vantage instantly
  // while the screen is covered (so an FOV/position jump is never visible
  // mid-motion), fade back in. This is the "stepping through a doorway /
  // focusing into a display" transition the brief asks for.
  function goToScene(sceneId) {
    const next = scenesById.get(sceneId);
    if (!next || fade || next.id === current.id) return;
    turn = null;
    fade = { phase: "out", elapsed: 0, pendingSceneId: sceneId };
  }

  function back() {
    if (current.parentSceneId) goToScene(current.parentSceneId);
  }

  function update(dt) {
    if (turn) {
      turn.elapsed += dt * 1000;
      const t = Math.min(1, turn.elapsed / TURN_MS);
      const lookAt = lerpVec(turn.fromLookAt, turn.toLookAt, ease(t));
      camera.lookAt(...lookAt);
      if (t >= 1) {
        current = turn.next;
        turn = null;
        onSceneChange?.(current);
      }
      return { transitioning: true };
    }

    if (fade) {
      fade.elapsed += dt * 1000;
      if (fade.phase === "out") {
        const t = Math.min(1, fade.elapsed / FADE_OUT_MS);
        if (fadeEl) fadeEl.style.opacity = String(t);
        if (t >= 1) {
          current = scenesById.get(fade.pendingSceneId);
          applyVantage(current.vantage);
          onSceneChange?.(current);
          fade = { phase: "in", elapsed: 0 };
        }
      } else {
        const t = Math.min(1, fade.elapsed / FADE_IN_MS);
        if (fadeEl) fadeEl.style.opacity = String(1 - t);
        if (t >= 1) fade = null;
      }
      return { transitioning: true };
    }

    return { transitioning: false };
  }

  const ndcTmp = new THREE.Vector3();
  // Projects a world position to CSS pixel coordinates over the current
  // canvas, or null if it's behind the camera — used to position every
  // interactive overlay (hotspot buttons, exhibit buttons) so they always
  // sit exactly over the 3D thing they activate, however the camera is
  // currently framed.
  function projectToScreen(pos, viewportWidth, viewportHeight) {
    ndcTmp.set(pos[0], pos[1], pos[2]).project(camera);
    if (ndcTmp.z > 1 || ndcTmp.z < -1) return null;
    const x = (ndcTmp.x * 0.5 + 0.5) * viewportWidth;
    const y = (-ndcTmp.y * 0.5 + 0.5) * viewportHeight;
    // Off-screen (behind the camera projects onto the same NDC square as
    // in-frame, so z alone doesn't catch it; outside the viewport's actual
    // pixel bounds does) — never leave a hotspot positioned but invisible
    // and still clickable/focusable at a point the visitor can't see.
    if (x < 0 || x > viewportWidth || y < 0 || y > viewportHeight) return null;
    return { x, y };
  }

  return {
    camera,
    currentScene,
    goToScene,
    back,
    turnLeft,
    turnRight,
    update,
    projectToScreen,
    handleResize,
    get isTransitioning() {
      return turn !== null || fade !== null;
    },
  };
}
