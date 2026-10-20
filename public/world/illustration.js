// The illustrated-scene controller, replacing the retired live-3D camera
// controller (public/world/exploration.js, removed — see docs/adr/0003-
// scene-exploration.md's presentation-pivot addendum). There is still no
// avatar position and still exactly one small fixed graph of named scenes
// (server/src/world.js's SCENES) — only how a scene is PRESENTED changed:
// each scene is now a full-bleed illustrated image with hotspots positioned
// as plain percentage anchors, never a 3D projection, so there is no camera,
// no frustum, no FOV correction to keep hotspots inside any more.
//
// Two DOM layers (`layerA`/`layerB`) ping-pong so a transition can animate
// the incoming scene over the outgoing one — a page-turn / cabinet-door
// effect (CSS 3D transforms, transform-origin at the hinge edge) for a cut
// between scenes, a quick cross-slide for a hub turn (looking toward a
// different doorway without actually leaving the hall). Both degrade to a
// near-instant swap under prefers-reduced-motion, same rule
// exploration.js's own transitions followed.

const PREFERS_REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const CUT_MS = PREFERS_REDUCED_MOTION ? 1 : 620;
const TURN_MS = PREFERS_REDUCED_MOTION ? 1 : 420;

// Maps a scene/gallery `image` key (server/src/world.js) to its file in
// public/assets/gallery-scenes/ — kept as one small table here rather than
// baked into the server payload, since it's purely a client rendering
// concern (which asset file backs which illustrated vantage).
const IMAGE_FILES = {
  entrance: "entrance-reference.webp",
  portraits: "portraits.webp",
  memento: "memento.webp",
  specimen: "specimen.webp",
  childhood: "childhood.webp",
  "portrait-reference": "portrait-reference.webp",
  "cabinet-reference": "cabinet-reference.webp",
};

function imageUrl(key) {
  const file = IMAGE_FILES[key] ?? IMAGE_FILES.entrance;
  return `/assets/gallery-scenes/${file}`;
}

export function createIllustrationController({ layerA, layerB, world, onSceneChange }) {
  const scenesById = new Map(world.scenes.map((s) => [s.id, s]));
  let current = scenesById.get(world.defaultSceneId);
  let front = layerA;
  let back = layerB;
  let transitioning = false;

  function paint(layer, scene) {
    const art = layer.querySelector(".scene-art");
    art.style.backgroundImage = `url("${imageUrl(scene.image)}")`;
    // A close-up scene flagged `zoom` reuses its gallery's own main image
    // (no separate close-up photograph exists for every gallery) but crops
    // in tighter and recentres — "focusing into a display" read from the
    // same illustration rather than a second asset.
    if (scene.zoom) {
      art.style.backgroundSize = "180%";
      art.style.backgroundPosition = "50% 65%";
    } else {
      art.style.backgroundSize = "cover";
      art.style.backgroundPosition = "center";
    }
    layer.dataset.sceneId = scene.id;
    layer.dataset.kind = scene.kind;
  }

  paint(front, current);
  front.hidden = false;
  back.hidden = true;

  function currentScene() {
    return current;
  }

  // A hub turn (left/right between the four doorway facings) is a quick
  // cross-slide, implying "looking a different way in the same room," never
  // a full page-turn cut — the visitor hasn't gone anywhere.
  function turnTo(sceneId) {
    const next = scenesById.get(sceneId);
    if (!next || transitioning) return;
    transitioning = true;
    paint(back, next);
    back.hidden = false;
    back.className = "scene-layer scene-layer-incoming-turn";
    front.className = "scene-layer scene-layer-outgoing-turn";
    // Force reflow so the browser registers the start state before the
    // transition-driving class swap below animates toward the end state.
    void back.offsetWidth;
    requestAnimationFrame(() => {
      back.className = "scene-layer scene-layer-settled";
      front.className = "scene-layer scene-layer-exited-turn";
    });
    window.setTimeout(() => {
      front.hidden = true;
      front.className = "scene-layer";
      [front, back] = [back, front];
      current = next;
      transitioning = false;
      onSceneChange?.(current);
    }, TURN_MS);
  }

  function turnLeft() {
    if (current.turnLeft) turnTo(current.turnLeft);
  }
  function turnRight() {
    if (current.turnRight) turnTo(current.turnRight);
  }

  // Every other navigation (entering a gallery, looking closer, going back,
  // returning to the hub) is a page-turn / cabinet-door cut: the incoming
  // scene rotates in from one hinge edge over the outgoing one, which fades
  // and rotates slightly away — "turning a heavy illustrated page" rather
  // than a generic fade. `back` hinges from the opposite edge of `forward`
  // so retracing a step visually reads as reversing the same motion.
  function goToScene(sceneId, { direction = "forward" } = {}) {
    const next = scenesById.get(sceneId);
    if (!next || transitioning || next.id === current.id) return;
    transitioning = true;
    paint(back, next);
    back.hidden = false;
    const inClass = direction === "back" ? "scene-layer-page-in-back" : "scene-layer-page-in-forward";
    const outClass = direction === "back" ? "scene-layer-page-out-back" : "scene-layer-page-out-forward";
    back.className = `scene-layer ${inClass}`;
    front.className = `scene-layer ${outClass}`;
    void back.offsetWidth;
    requestAnimationFrame(() => {
      back.className = "scene-layer scene-layer-settled";
      front.className = `scene-layer ${outClass}-exit`;
    });
    window.setTimeout(() => {
      front.hidden = true;
      front.className = "scene-layer";
      [front, back] = [back, front];
      current = next;
      transitioning = false;
      onSceneChange?.(current);
    }, CUT_MS);
  }

  function back_() {
    if (current.parentSceneId) goToScene(current.parentSceneId, { direction: "back" });
  }

  return {
    currentScene,
    goToScene,
    back: back_,
    turnLeft,
    turnRight,
    get isTransitioning() {
      return transitioning;
    },
  };
}
