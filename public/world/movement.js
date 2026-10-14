// Movement + collision, shared by both camera rigs. The avatar has exactly
// one position/yaw; a rig only decides how the camera looks at it. See
// CLAUDE.md's "one coordinate system, two camera rigs" rule — nothing in
// this module knows which rig is active.
const MOVE_SPEED = 4.2; // world units / second
const RADIUS = 0.32; // avatar collision radius

function clampToRects(x, z, rects) {
  // Already inside some rect: nothing to do.
  for (const r of rects) {
    if (x >= r.minX + RADIUS && x <= r.maxX - RADIUS && z >= r.minZ + RADIUS && z <= r.maxZ - RADIUS) {
      return { x, z };
    }
  }
  // Otherwise, find the rect whose clamped point is nearest the attempted
  // position — this lets a visitor slide along a wall rather than stopping
  // dead the instant any axis would exit the walkable area.
  let best = null;
  let bestDist = Infinity;
  for (const r of rects) {
    const cx = Math.min(Math.max(x, r.minX + RADIUS), r.maxX - RADIUS);
    const cz = Math.min(Math.max(z, r.minZ + RADIUS), r.maxZ - RADIUS);
    const d = (cx - x) ** 2 + (cz - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = { x: cx, z: cz };
    }
  }
  return best ?? { x, z };
}

export function createMovementController(world) {
  const rects = [world.hall.bounds, ...world.galleries.flatMap((g) => [g.bounds, g.corridor])];
  const state = { x: world.spawn.x, z: world.spawn.z, yaw: world.spawn.yaw };
  const keys = new Set();

  function onKeyDown(e) {
    keys.add(e.code);
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  // Movement keys are ignored while focus sits inside a form field — see
  // CLAUDE.md: typing a dispute must never walk the avatar into a wall.
  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(document.activeElement)) return;
    onKeyDown(e);
  });
  window.addEventListener("keyup", (e) => {
    if (isTypingTarget(document.activeElement)) return;
    onKeyUp(e);
  });
  // A field losing focus mid-press shouldn't leave a stuck key held down.
  window.addEventListener("blur", () => keys.clear());

  function axis() {
    let x = 0;
    let z = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) z -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) z += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    const len = Math.hypot(x, z);
    return len > 0 ? { x: x / len, z: z / len } : { x: 0, z: 0 };
  }

  // `forwardYaw` is the direction "W" means: 0 (world +Z-negative/"north")
  // for the overhead rig, or the mouse-look yaw for first-person — in both
  // cases the same clamp/slide collision logic applies identically.
  // `snapYawToMovement`: overhead has no independent look direction, so the
  // avatar visibly turns to face where it's walking; first-person's yaw is
  // owned by the mouse, so movement must never overwrite it (strafing would
  // otherwise spin the camera).
  function tick(dt, { forwardYaw = 0, snapYawToMovement = true } = {}) {
    const dir = axis();
    if (dir.x === 0 && dir.z === 0) return { ...state, moved: false };

    const cos = Math.cos(forwardYaw);
    const sin = Math.sin(forwardYaw);
    const worldX = dir.x * cos + dir.z * sin;
    const worldZ = -dir.x * sin + dir.z * cos;

    const nextX = state.x + worldX * MOVE_SPEED * dt;
    const nextZ = state.z + worldZ * MOVE_SPEED * dt;
    const clamped = clampToRects(nextX, nextZ, rects);
    state.x = clamped.x;
    state.z = clamped.z;
    if (snapYawToMovement && (worldX !== 0 || worldZ !== 0)) {
      state.yaw = Math.atan2(worldX, worldZ);
    }
    return { ...state, moved: true };
  }

  function setYaw(yaw) {
    state.yaw = yaw;
  }

  return { state, tick, setYaw, isTypingTarget };
}
