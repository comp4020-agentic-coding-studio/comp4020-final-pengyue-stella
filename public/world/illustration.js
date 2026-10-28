// The illustrated-scene controller: owns scene-to-scene transitions (a
// page-turn/cabinet-door cut between rooms — the hall is an ordinary room
// like any other, not a special cross-slide "turn" mode) AND, new in the
// immersive-2.5D pass, a bounded look-around camera
// per scene (public/world/camera.js) — see docs/adr/0005-immersive-2.5d-
// camera.md. There is still exactly one small fixed graph of named scenes
// (server/src/world.js's SCENES); only how a scene is PRESENTED changed
// again: each scene is a full-bleed illustrated image a visitor can drag/
// swipe/wheel to look around within its own bounded range, with glowing
// interactive objects nested in the same transformed "room" plane as the
// art so they always stay pixel-aligned with the painted item they
// represent, never drifting independently of the picture.
//
// Two DOM layers (`layerA`/`layerB`) ping-pong so a transition can animate
// the incoming scene over the outgoing one. Both transitions degrade to a
// near-instant swap under prefers-reduced-motion.

import { createSceneCamera } from "./camera.js";

const PREFERS_REDUCED_MOTION = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const CUT_MS = PREFERS_REDUCED_MOTION ? 1 : 620;

// Maps a scene/gallery `image` key (server/src/world.js) to its file in
// public/assets/gallery-scenes/ — kept as one small table here rather than
// baked into the server payload, since it's purely a client rendering
// concern (which asset file backs which illustrated vantage).
const IMAGE_FILES = {
  hall: "entrance-hall-v2.png",
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

const SVG_NS = "http://www.w3.org/2000/svg";

// Builds (once per layer) the nested "room" structure a camera drives: the
// art plane and the object/cameo plane share one transform (parallax 1.0,
// so a glowing object hit-region can never visually drift off the painted
// item it represents), while dust gets a lighter parallax and the
// vignette/frame stay fixed — "the edge of the window" never pans.
function roomLayers(layer) {
  return {
    room: layer.querySelector(".scene-room"),
    art: layer.querySelector(".scene-art"),
    dust: layer.querySelector(".scene-dust"),
  };
}

export function createIllustrationController({ layerA, layerB, world, onSceneChange, onCameraTransform }) {
  const scenesById = new Map(world.scenes.map((s) => [s.id, s]));
  let current = scenesById.get(world.defaultSceneId);
  let front = layerA;
  let back = layerB;
  let transitioning = false;
  let frontCamera = createSceneCamera({
    container: layerA,
    layers: [
      { el: roomLayers(layerA).room, parallax: 1 },
      { el: roomLayers(layerA).dust, parallax: 0.55 },
    ],
    onTransform: onCameraTransform,
  });
  let backCamera = null;

  // The art and the hotspot layer MUST share one coordinate system, not two
  // independently-maintained ones: previously the art was a CSS `background-
  // image` layer (`background-size: cover` normally, or a hand-derived
  // `180%` + `50% 65%` for a `zoom` close-up) while the hotspot layer was an
  // SVG `viewBox` + `preserveAspectRatio="xMidYMid slice"`. Both describe
  // "fill the container, cropping from the centre of some window of the
  // source image" — the SAME visual law — but CSS `background-size: X%`
  // scales from the container's WIDTH only (then derives height to preserve
  // the image's own aspect ratio), whereas SVG's `slice` fit scales by
  // whichever of width/height needs the LARGER scale to cover the container
  // (so it can crop either axis, not just the one left over from width).
  // Those two scaling rules only produce the same crop at one specific
  // container aspect ratio (here, ~1672:941, the source image's own ratio);
  // at any other aspect ratio — a narrower window, a phone held upright —
  // they diverge, and every close-up `<-closeup>` scene whose `zoom: true`
  // reuses its gallery's own image at a CSS crop drifted further out of
  // alignment the further the viewport got from that one ratio. This was
  // the actual root cause behind every "hotspot is offset" report across
  // multiple galleries, not a per-object tracing error — see
  // docs/adr/0004-illustrated-scenes.md and the PR that added this fix for
  // the full before/after measurement.
  //
  // The fix: render the art itself as an SVG `<image>`, inside an SVG whose
  // own `viewBox`/`preserveAspectRatio` is set to the EXACT SAME values as
  // the object layer's — not just "the same crop law," the same literal
  // attribute values on both elements — so the browser's own single `slice`
  // algorithm does the fitting for both layers identically. There is no
  // longer a second, independently-expressed scaling rule for the art to
  // drift out of sync with.
  function paint(layer, scene) {
    const { art } = roomLayers(layer);
    const { width, height } = scene.sourceImage ?? { width: 1672, height: 941 };
    const viewBox = scene.objectViewBox ?? `0 0 ${width} ${height}`;
    art.setAttribute("viewBox", viewBox);
    let image = art.querySelector("image");
    if (!image) {
      image = document.createElementNS(SVG_NS, "image");
      image.setAttribute("preserveAspectRatio", "xMidYMid slice");
      art.appendChild(image);
    }
    const href = imageUrl(scene.image);
    image.setAttributeNS("http://www.w3.org/1999/xlink", "href", href);
    image.setAttribute("href", href);
    image.setAttribute("x", "0");
    image.setAttribute("y", "0");
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));

    layer.dataset.sceneId = scene.id;
    layer.dataset.kind = scene.kind;
    // The object-shape layer shares the SAME viewBox as the art SVG above —
    // this is what pixel-locks every traced hotspot to the painted item it
    // represents at every viewport size, pan and zoom level.
    const objectLayer = layer.querySelector(".object-layer");
    objectLayer?.setAttribute("viewBox", viewBox);
  }

  paint(front, current);
  frontCamera.configure(current.camera);
  front.hidden = false;
  back.hidden = true;

  function currentScene() {
    return current;
  }

  // The object-layer/cameo-layer elements nested inside whichever physical
  // layer (`scene-layer-a`/`-b`) is currently the FRONT one — app.js renders
  // interactive-object glow regions and visitor cameos into these, so they
  // live inside the same transformed `.scene-room` plane the camera pans,
  // and ping-pong automatically whenever a transition swaps front/back.
  function activeLayers() {
    return {
      objectLayer: front.querySelector(".object-layer"),
      cameoLayer: front.querySelector(".cameo-layer"),
    };
  }

  // Every navigation (entering a gallery, looking closer, going back,
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
    backCamera?.destroy();
    backCamera = createSceneCamera({
      container: back,
      layers: [
        { el: roomLayers(back).room, parallax: 1 },
        { el: roomLayers(back).dust, parallax: 0.55 },
      ],
      onTransform: onCameraTransform,
    });
    backCamera.configure(next.camera);
    back.hidden = false;
    const inClass = direction === "back" ? "scene-layer-page-in-back" : "scene-layer-page-in-forward";
    const outClass = direction === "back" ? "scene-layer-page-out-back" : "scene-layer-page-out-forward";
    back.className = `scene-layer ${inClass}`;
    front.className = `scene-layer ${outClass}`;
    frontCamera.setEnabled(false);
    void back.offsetWidth;
    requestAnimationFrame(() => {
      back.className = "scene-layer scene-layer-settled";
      front.className = `scene-layer ${outClass}-exit`;
    });
    window.setTimeout(() => {
      front.hidden = true;
      front.className = "scene-layer";
      [front, back] = [back, front];
      [frontCamera, backCamera] = [backCamera, frontCamera];
      frontCamera.setEnabled(true);
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
    activeLayers,
    get isTransitioning() {
      return transitioning;
    },
    get camera() {
      return frontCamera;
    },
  };
}
