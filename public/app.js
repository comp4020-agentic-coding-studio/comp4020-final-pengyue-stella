// Traces of ANU — client. No framework and no build step on purpose: this is
// a handful of DOM operations and one SSE connection, nothing a bundler would
// earn its keep over. See CLAUDE.md for the conventions this file has to
// hold to (textContent only for user text; shared x/y anchoring for pins).
//
// depth-scene.js adds real depth-parallax rendering for scenes whose config
// carries a `depth` field (currently only Kambri Lawn — see
// docs/adr/0002-kambri-depth-parallax.md). This file stays unaware of
// three.js entirely; it only calls the small interface createDepthScene()
// returns, and falls back to exactly today's flat <img> + CSS-transform
// panning for every other scene, or for Kambri itself if depth rendering
// isn't supported (no WebGL, a failed fetch, anything thrown).
import { createDepthScene } from "./depth-scene.js";

const LAST_SCENE_KEY = "tracesOfAnu.lastScene";

const TRACE_TYPES = [
  { id: "tip", emoji: "💡", label: "Tip" },
  { id: "memory", emoji: "🧡", label: "Memory" },
  { id: "story", emoji: "📖", label: "Story" },
  { id: "spark", emoji: "✨", label: "Spark" },
];

const els = {
  viewport: document.getElementById("viewport"),
  panorama: document.getElementById("panorama"),
  image: document.getElementById("scene-image"),
  pins: document.getElementById("pins"),
  depthHost: document.getElementById("depth-host"),
  depthPins: document.getElementById("depth-pins"),
  title: document.getElementById("scene-title"),
  blurb: document.getElementById("scene-blurb"),
  presence: document.getElementById("presence"),
  whoami: document.getElementById("whoami"),
  jump: document.getElementById("jump-buttons"),
  toasts: document.getElementById("toasts"),
  panLeft: document.querySelector(".pan-left"),
  panRight: document.querySelector(".pan-right"),
};

let scenes = [];
let scene = null; // current scene object
let pan = 0; // px, 0 = left edge
let renderedWidth = 0;
let viewportWidth = 0;
let seenTraceIds = new Set();
let openBubble = null;
let depthScene = null; // the active createDepthScene() instance, or null in flat mode
let depthRaf = null; // drives re-placing pins/bubbles every frame while depthScene is active

function byId(id) {
  return scenes.find((s) => s.id === id);
}

// Pins/bubbles render into whichever host matches the current rendering
// mode: #pins (a child of the sliding #panorama, percentage-positioned) in
// flat mode, or #depth-pins (a plain viewport-pixel-positioned sibling,
// since a depth scene's "panning" is a camera moving, not an image
// sliding) when a depth scene is active for the current scene.
function activePins() {
  return depthScene ? els.depthPins : els.pins;
}

function setPan(next, { smooth = true } = {}) {
  const maxPan = Math.max(0, renderedWidth - viewportWidth);
  pan = Math.min(maxPan, Math.max(0, next));
  els.viewport.classList.toggle("dragging", !smooth);
  if (depthScene) {
    // Same ratio either way — only which element the ratio drives differs.
    depthScene.setPanFraction(maxPan > 0 ? pan / maxPan : 0.5);
  } else {
    els.panorama.style.transform = `translateX(${-pan}px)`;
  }
}

// Every scene image is built sharp-centred on a wider canvas (see
// tools/build-scenes.py), so the midpoint of the whole pan range is always
// where the real photo sits — on a narrow viewport the photo can otherwise
// be entirely out of frame at pan=0, showing only its blurred periphery.
function centerPan() {
  const maxPan = Math.max(0, renderedWidth - viewportWidth);
  setPan(maxPan / 2, { smooth: false });
  // setPan(…, {smooth:false}) is also what a real drag uses to kill the
  // transform transition mid-gesture, so it marks the viewport ".dragging".
  // This isn't a drag — clear it, or the cursor and the next transition
  // stay stuck in drag state until the visitor happens to drag once.
  els.viewport.classList.remove("dragging");
}

function measure() {
  viewportWidth = els.viewport.clientWidth;
  renderedWidth = els.image.clientWidth;
  setPan(pan, { smooth: true });
}

function closeBubble() {
  if (openBubble) {
    openBubble.remove();
    openBubble = null;
  }
}

function showToast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  els.toasts.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

// Every pin/bubble keeps its normalised (x, y) on its own dataset, not just
// baked into a CSS percentage — depth mode needs to re-read it every frame
// to reproject against the moving virtual camera (see updatePinPositions).
function placeAt(el, x, y) {
  el.dataset.nx = x;
  el.dataset.ny = y;
  if (depthScene) {
    const p = depthScene.projectPoint(x, y);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.visibility = p.visible ? "visible" : "hidden";
  } else {
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.visibility = "visible";
  }
}

// Called every rendered frame while a depth scene is active (see
// goToScene's depth branch) so pins and open bubbles visually track the
// same spot on the depth-displaced photo as the parallax camera moves —
// without this, a pin would stay wherever it was first drawn while the
// photo underneath it shifts, breaking the "a mark rests on the ground at
// {x,y}" illusion CLAUDE.md's anchoring convention depends on.
function updatePinPositions() {
  if (!depthScene) return;
  for (const el of activePins().children) {
    const { nx, ny } = el.dataset;
    if (nx === undefined || ny === undefined) continue;
    const p = depthScene.projectPoint(Number(nx), Number(ny));
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.visibility = p.visible ? "visible" : "hidden";
  }
}

function renderExitPin(exit) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pin exit";
  btn.title = exit.label;
  btn.innerHTML = `<span class="pin-dot">&#8594;</span>`; // decorative glyph only
  btn.setAttribute("aria-label", exit.label);
  activePins().appendChild(btn);
  placeAt(btn, exit.x, exit.y);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    goToScene(exit.to);
  });
}

function renderTracePin(trace) {
  if (seenTraceIds.has(trace.id)) return;
  seenTraceIds.add(trace.id);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pin trace";
  btn.dataset.id = trace.id;
  const dot = document.createElement("span");
  dot.className = "pin-dot";
  dot.style.background = trace.authorColor;
  dot.textContent = trace.emoji;
  btn.appendChild(dot);
  btn.setAttribute("aria-label", `${trace.authorName} left a ${trace.type}`);
  activePins().appendChild(btn);
  placeAt(btn, trace.x, trace.y);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openReadBubble(trace, btn);
  });
}

function openReadBubble(trace, anchorEl) {
  closeBubble();
  const bubble = document.createElement("div");
  bubble.className = "bubble read";

  const author = document.createElement("div");
  author.className = "bubble-author";
  const dot = document.createElement("span");
  dot.className = "bubble-dot";
  dot.style.background = trace.authorColor;
  author.appendChild(dot);
  author.appendChild(document.createTextNode(`${trace.emoji} ${trace.authorName}`));
  bubble.appendChild(author);

  const body = document.createElement("p");
  body.style.margin = "0";
  body.textContent = trace.body; // never innerHTML — see CLAUDE.md
  bubble.appendChild(body);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.style.marginTop = "0.4rem";
  closeBtn.addEventListener("click", closeBubble);
  bubble.appendChild(closeBtn);

  activePins().appendChild(bubble);
  placeAt(bubble, trace.x, trace.y);
  openBubble = bubble;
  closeBtn.focus();
}

function openComposeBubble(x, y) {
  closeBubble();
  const bubble = document.createElement("form");
  bubble.className = "bubble compose";

  const typeRow = document.createElement("div");
  typeRow.className = "type-row";
  TRACE_TYPES.forEach((t, i) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "type";
    input.value = t.id;
    if (i === 1) input.checked = true; // "memory" default — least friction
    label.appendChild(input);
    label.appendChild(document.createTextNode(t.emoji));
    label.title = t.label;
    typeRow.appendChild(label);
  });
  bubble.appendChild(typeRow);

  const textarea = document.createElement("textarea");
  textarea.maxLength = 240;
  textarea.placeholder = "Leave something here…";
  textarea.required = true;
  bubble.appendChild(textarea);

  const error = document.createElement("p");
  error.className = "error";
  error.hidden = true;
  bubble.appendChild(error);

  const actions = document.createElement("div");
  actions.className = "actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeBubble);
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Leave it here";
  actions.appendChild(cancel);
  actions.appendChild(submit);
  bubble.appendChild(actions);

  bubble.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = textarea.value.trim();
    const type = bubble.querySelector('input[name="type"]:checked')?.value;
    if (!body) return;
    submit.disabled = true;
    try {
      const res = await fetch(`/api/scenes/${scene.id}/traces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y, body, type }),
      });
      const data = await res.json();
      if (!res.ok) {
        error.textContent = data.error ?? "couldn't leave that trace";
        error.hidden = false;
        submit.disabled = false;
        return;
      }
      closeBubble();
      renderTracePin(data.trace);
    } catch {
      error.textContent = "couldn't reach the server — try again";
      error.hidden = false;
      submit.disabled = false;
    }
  });

  activePins().appendChild(bubble);
  placeAt(bubble, x, y);
  openBubble = bubble;
  textarea.focus();
}

// In flat mode, a click's position on the photo is a linear fraction of its
// own bounding box. In depth mode it isn't — the visible surface under the
// pointer has moved with the parallax camera — so this instead raycasts
// against the real mesh (depthScene.pickPoint). Returns null only in depth
// mode when the raycast misses (e.g. a gap left by the edge-coherence
// cull); the flat-mode path always returns a point, as it always has.
function clientPointToNormalized(clientX, clientY) {
  if (depthScene) return depthScene.pickPoint(clientX, clientY);
  const rect = els.image.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

async function goToScene(id, { resetScroll = true } = {}) {
  const next = byId(id);
  if (!next) return;
  // A brief fade through black reads as walking from one place to the next,
  // not as a tab swapping its content. Fades whichever host was visible
  // before this navigation; the host that ends up visible after it (flat
  // or depth) fades back in below, once we know which one that is.
  els.panorama.style.opacity = "0";
  els.depthHost.style.opacity = "0";
  scene = next;
  closeBubble();
  localStorage.setItem?.(LAST_SCENE_KEY, id);

  stopDepthScene();

  els.title.textContent = scene.title;
  els.blurb.textContent = scene.blurb;
  els.pins.innerHTML = "";
  els.depthPins.innerHTML = "";
  // The flat <img> always loads, even for a scene that ends up rendering in
  // depth mode: its natural dimensions are what measure() uses to compute
  // renderedWidth/maxPan, so drag sensitivity, arrow-key increments, and
  // centerPan() all keep working completely unchanged across both modes —
  // only which element is actually shown, and how pan drives it, differs.
  els.image.src = scene.image;
  els.image.alt = `${scene.title}, a real ANU campus photograph`;

  // Presence is cosmetic: if this fails (offline, first load before the SSE
  // stream exists yet), the scene itself still works fine without it.
  fetch("/api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneId: id }),
  }).catch(() => {});

  for (const btn of els.jump.children) {
    btn.setAttribute("aria-current", String(btn.dataset.id === id));
  }

  await new Promise((resolve) => {
    if (els.image.complete) resolve();
    else els.image.onload = resolve;
  });
  measure();

  if (scene.depth) {
    await startDepthScene(scene);
  }
  // renderExitPin/placeAt need depthScene already resolved (or confirmed
  // absent) so exits land in the right host from their very first paint.
  scene.exits.forEach(renderExitPin);

  if (resetScroll) centerPan();
  requestAnimationFrame(() => {
    (depthScene ? els.depthHost : els.panorama).style.opacity = "1";
  });

  try {
    const res = await fetch(`/api/scenes/${id}/traces`);
    const data = await res.json();
    data.traces.forEach(renderTracePin);
  } catch {
    showToast("Couldn't load traces for this scene — check your connection");
  }
}

// Tears down any active depth scene and restores exactly today's flat
// presentation. Always safe to call, including when no depth scene is
// active (goToScene calls it unconditionally on every navigation).
function stopDepthScene() {
  if (depthRaf) {
    cancelAnimationFrame(depthRaf);
    depthRaf = null;
  }
  if (depthScene) {
    depthScene.destroy();
    depthScene = null;
  }
  els.depthHost.hidden = true;
  els.depthPins.hidden = true;
  els.panorama.hidden = false;
}

// Attempts depth-parallax rendering for a scene whose config carries a
// `depth` field. Resolves either way (never throws) — any failure (no
// WebGL, a failed fetch, anything thrown inside createDepthScene) leaves
// depthScene null and the flat <img>/#panorama path fully intact, exactly
// as if `scene.depth` weren't set at all. This is the one fallback path
// CLAUDE.md's "every interaction works" rule requires stay silent: a
// visitor on an unsupported browser must see a normal scene, not an error.
async function startDepthScene(targetScene) {
  try {
    const created = await createDepthScene({
      host: els.depthHost,
      meshUrl: targetScene.depth.mesh,
      textureUrl: targetScene.image,
    });
    // The visitor may have navigated again while this was in flight.
    if (scene !== targetScene || !created.supported) {
      if (created.supported) created.destroy?.();
      return;
    }
    depthScene = created;
    els.panorama.hidden = true;
    els.depthHost.hidden = false;
    els.depthPins.hidden = false;
    depthScene.setPanFraction(pan / Math.max(1, renderedWidth - viewportWidth) || 0.5);

    function tick() {
      if (!depthScene) return;
      updatePinPositions();
      depthRaf = requestAnimationFrame(tick);
    }
    tick();
  } catch {
    stopDepthScene();
  }
}

function buildJumpNav() {
  els.jump.innerHTML = "";
  for (const s of scenes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = s.title;
    btn.dataset.id = s.id;
    btn.addEventListener("click", () => goToScene(s.id));
    els.jump.appendChild(btn);
  }
}

function wireViewport() {
  let dragging = false;
  let startX = 0;
  let startPan = 0;
  let dragDistance = 0;

  els.viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pin, .bubble, .pan-btn")) return;
    dragging = true;
    dragDistance = 0;
    startX = e.clientX;
    startPan = pan;
    els.viewport.setPointerCapture(e.pointerId);
  });

  els.viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    dragDistance = Math.max(dragDistance, Math.abs(dx));
    setPan(startPan - dx, { smooth: false });
  });

  function endDrag() {
    dragging = false;
    els.viewport.classList.remove("dragging");
  }
  els.viewport.addEventListener("pointerup", endDrag);
  els.viewport.addEventListener("pointercancel", endDrag);

  els.viewport.addEventListener("click", (e) => {
    if (dragDistance > 6) return; // a drag, not a click
    if (e.target.closest(".pin, .bubble, .pan-btn")) return;
    const point = clientPointToNormalized(e.clientX, e.clientY);
    // depth mode's raycast can miss (a gap left by the edge-coherence cull,
    // or empty sky past the mesh's edge) — silently do nothing rather than
    // open a bubble anchored nowhere; flat mode's clientPointToNormalized
    // never returns null, so this never skips a click there.
    if (point) openComposeBubble(point.x, point.y);
  });

  els.viewport.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      setPan(pan - 220, { smooth: true });
    } else if (e.key === "ArrowRight") {
      setPan(pan + 220, { smooth: true });
    } else if ((e.key === "Enter" || e.key === " ") && e.target === els.viewport) {
      e.preventDefault();
      if (depthScene) {
        // Same idea as the flat branch below (open a bubble at the centre
        // of the current view) but via a raycast through the viewport's
        // own centre, since depth mode has no single fixed "centre of the
        // photo" fraction — the camera moves, the photo doesn't.
        const rect = els.viewport.getBoundingClientRect();
        const point = depthScene.pickPoint(rect.left + rect.width / 2, rect.top + rect.height * 0.55);
        if (point) openComposeBubble(point.x, point.y);
      } else {
        const centerX = (pan + viewportWidth / 2) / renderedWidth;
        openComposeBubble(Math.min(1, Math.max(0, centerX)), 0.82);
      }
    } else if (e.key === "Escape") {
      closeBubble();
    }
  });

  els.panLeft.addEventListener("click", () => setPan(pan - 320, { smooth: true }));
  els.panRight.addEventListener("click", () => setPan(pan + 320, { smooth: true }));

  window.addEventListener("resize", measure);
}

function connectEvents() {
  const es = new EventSource(`/api/events?scene=${encodeURIComponent(scene.id)}`);
  es.addEventListener("trace", (e) => {
    const trace = JSON.parse(e.data);
    if (scene && trace.sceneId === scene.id) {
      // renderTracePin itself guards against double-rendering the same id.
      renderTracePin(trace);
    } else if (!seenTraceIds.has(trace.id)) {
      // A trace for a scene we're not looking at: announce it, but don't
      // mark the id "seen" — that set gates pins, and this trace still
      // needs to render as a pin the day we do navigate to its scene.
      const place = byId(trace.sceneId)?.title ?? "somewhere on campus";
      showToast(`${trace.emoji} someone left a trace near ${place}`);
    }
  });
  es.addEventListener("presence", (e) => {
    const { sceneId, count } = JSON.parse(e.data);
    // Scoped to one scene at a time (see docs/adr/0001-scene-scoped-presence.md):
    // ignore counts for scenes we're not currently looking at.
    if (!scene || sceneId !== scene.id) return;
    els.presence.textContent = count <= 1 ? "Just you here right now" : `${count} people here right now`;
  });
}

async function init() {
  wireViewport();
  const res = await fetch("/api/scenes");
  const data = await res.json();
  scenes = data.scenes;
  buildJumpNav();

  try {
    const me = await (await fetch("/api/me")).json();
    els.whoami.textContent = `You're wandering as ${me.name}`;
  } catch {
    // identity is cosmetic client-side; traces still work without it showing
  }

  const last = localStorage.getItem?.(LAST_SCENE_KEY);
  await goToScene(byId(last) ? last : scenes[0].id);
  connectEvents();
}

init();
