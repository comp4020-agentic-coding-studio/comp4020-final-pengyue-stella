import * as THREE from "three";
import { buildWorldScene } from "./world/scene.js";
import { createMovementController } from "./world/movement.js";
import { createCameraRig } from "./world/cameras.js";
import { RemoteAvatar, buildAvatarMesh } from "./world/avatar.js";

const INTERACT_RANGE = 2.2;
const DONATE_RANGE = 2.0;
const MOVE_POST_INTERVAL_MS = 120;
const NAME_STORAGE_KEY = "cursedMuseumNamed";

const el = (id) => document.getElementById(id);
const viewport = el("viewport");
const canvas = el("scene-canvas");
const crosshair = el("crosshair");
const presenceEl = el("presence");
const whoamiEl = el("whoami");
const galleryTitleEl = el("gallery-title");
const galleryHintEl = el("gallery-hint");
const donateHintBtn = el("donate-hint");
const toastsEl = el("toasts");

let myIdentity = null;
let world = null;
let exhibitsById = new Map(); // exhibitId -> exhibit (with accounts)
let slotToExhibitId = new Map();
let sceneApi = null;
let movement = null;
let cameraRig = null;
let renderer = null;
let remoteAvatars = new Map(); // visitorId -> RemoteAvatar
let localAvatarMesh = null;
let lastMovePosted = 0;
let currentGalleryId = null;
let openDossierExhibitId = null;

function toast(message) {
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = message;
  toastsEl.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// ---------------------------------------------------------------------------
// Identity

async function fetchMe() {
  const res = await fetch("/api/me");
  return res.json();
}

async function setDisplayName(name) {
  const res = await fetch("/api/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "could not set name");
  return res.json();
}

function updateWhoami() {
  if (!myIdentity) return;
  whoamiEl.textContent = `You are ${myIdentity.name}`;
  whoamiEl.style.color = myIdentity.color ?? "";
}

// ---------------------------------------------------------------------------
// Gallery location text

function galleryContaining(x, z) {
  if (!world) return null;
  for (const g of world.galleries) {
    if (x >= g.bounds.minX && x <= g.bounds.maxX && z >= g.bounds.minZ && z <= g.bounds.maxZ) return g;
  }
  return null;
}

function updateLocationLabel(x, z) {
  const gallery = galleryContaining(x, z);
  const id = gallery?.id ?? null;
  if (id === currentGalleryId) return;
  currentGalleryId = id;
  galleryTitleEl.textContent = gallery ? gallery.name : "Entrance Hall";
  galleryHintEl.textContent = gallery
    ? "Approach a glinting exhibit and press E or click to inspect."
    : "The donor counter is ahead — press E to donate a relic.";
}

// ---------------------------------------------------------------------------
// World + exhibits

async function loadWorld() {
  const res = await fetch("/api/world");
  world = await res.json();
}

async function loadExhibits() {
  const res = await fetch("/api/exhibits");
  const { exhibits } = await res.json();
  exhibitsById = new Map(exhibits.map((e) => [e.id, e]));
  slotToExhibitId = new Map(exhibits.map((e) => [e.slotId, e.id]));
  return exhibits;
}

function instantiateExhibit(exhibit) {
  const { gallery, slot } = findSlot(exhibit.slotId);
  if (!gallery || !slot) return;
  sceneApi.addExhibitMesh(exhibit, slot);
}

function findSlot(slotId) {
  for (const gallery of world.galleries) {
    const slot = gallery.slots.find((s) => s.id === slotId);
    if (slot) return { gallery, slot };
  }
  return {};
}

function occupiedSlotIdsForGallery(galleryId) {
  const out = new Set();
  for (const exhibit of exhibitsById.values()) {
    if (exhibit.galleryId === galleryId) out.add(exhibit.slotId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Donation form

function populateDonateForm() {
  const gallerySelect = el("donate-gallery");
  const slotSelect = el("donate-slot");
  gallerySelect.innerHTML = "";
  for (const g of world.galleries) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    gallerySelect.appendChild(opt);
  }

  function refreshSlots() {
    const galleryId = gallerySelect.value;
    const gallery = world.galleries.find((g) => g.id === galleryId);
    const occupied = occupiedSlotIdsForGallery(galleryId);
    slotSelect.innerHTML = "";
    const free = gallery.slots.filter((s) => !occupied.has(s.id));
    if (free.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No free slots in this gallery right now";
      slotSelect.appendChild(opt);
      slotSelect.disabled = true;
    } else {
      slotSelect.disabled = false;
      for (const s of free) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = `Slot ${s.id.split("_").slice(-2).join(" ")}`;
        slotSelect.appendChild(opt);
      }
    }
  }
  gallerySelect.onchange = refreshSlots;
  refreshSlots();
}

function openDonateGate() {
  populateDonateForm();
  el("donate-error").textContent = "";
  el("donate-gate").hidden = false;
  el("donate-title").focus();
}
function closeDonateGate() {
  el("donate-gate").hidden = true;
  viewport.focus();
}

el("donate-cancel").addEventListener("click", closeDonateGate);
el("donate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    galleryId: form.galleryId.value,
    slotId: form.slotId.value,
    title: form.title.value.trim(),
    originClaim: form.originClaim.value.trim(),
    donorName: form.donorName.value.trim() || myIdentity?.name,
  };
  const errEl = el("donate-error");
  if (!payload.slotId) {
    errEl.textContent = "No free slot selected.";
    return;
  }
  const res = await fetch("/api/exhibits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error ?? "Could not donate that relic.";
    return;
  }
  exhibitsById.set(data.exhibit.id, data.exhibit);
  slotToExhibitId.set(data.exhibit.slotId, data.exhibit.id);
  instantiateExhibit(data.exhibit);
  closeDonateGate();
  toast(`You donated "${data.exhibit.title}".`);
  form.reset();
});

// ---------------------------------------------------------------------------
// Dossier

const VERDICT_CLASS = {
  Believable: "believable",
  Suspicious: "suspicious",
  "Definitely Cursed": "definitely-cursed",
  Disputed: "disputed",
  Unclassified: "unclassified",
};
const KIND_LABEL = {
  original: "Original Account",
  testimony: "New Testimony",
  contradiction: "Contradiction",
  revision: "Proposed Revision",
  "counter-evidence": "Counter-Evidence",
};

function renderAccountBlock(account, exhibit) {
  const block = document.createElement("div");
  block.className = "account-block";

  const kindBadge = document.createElement("span");
  kindBadge.className = `account-kind ${account.kind}`;
  kindBadge.textContent = KIND_LABEL[account.kind] ?? account.kind;
  block.appendChild(kindBadge);

  const body = document.createElement("p");
  body.className = "account-body";
  body.textContent = account.body; // textContent only — never innerHTML
  block.appendChild(body);

  const byline = document.createElement("p");
  byline.className = "account-byline";
  byline.textContent = `${account.authorName} · ${new Date(account.createdAt).toLocaleString()}`;
  block.appendChild(byline);

  const votesRow = document.createElement("div");
  votesRow.className = "account-votes";
  const badge = document.createElement("span");
  badge.className = `verdict-badge ${VERDICT_CLASS[account.verdict] ?? ""}`;
  badge.textContent = account.verdict;
  votesRow.appendChild(badge);

  const tally = document.createElement("span");
  tally.textContent = Object.entries(account.votes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  votesRow.appendChild(tally);

  const voteButtons = document.createElement("div");
  voteButtons.className = "vote-buttons";
  for (const verdict of ["Believable", "Suspicious", "Definitely Cursed"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = verdict;
    btn.setAttribute("aria-pressed", String(account.myVote === verdict));
    btn.addEventListener("click", async () => {
      const res = await fetch(`/api/accounts/${account.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      if (res.ok) {
        const { account: updated } = await res.json();
        applyAccountUpdate(exhibit.id, updated);
      }
    });
    voteButtons.appendChild(btn);
  }
  votesRow.appendChild(voteButtons);
  block.appendChild(votesRow);

  return block;
}

function renderDossier(exhibit) {
  el("dossier-kicker").textContent = `${exhibit.category.toUpperCase()} · exhibit · ${exhibit.classification}`;
  el("dossier-title").textContent = exhibit.title;
  const gallery = world.galleries.find((g) => g.id === exhibit.galleryId);
  el("dossier-meta").textContent = `${gallery?.name ?? exhibit.galleryId} · donated by ${exhibit.donorName} · ${exhibit.accounts.length} account${exhibit.accounts.length === 1 ? "" : "s"}`;

  const container = el("dossier-accounts");
  container.innerHTML = "";
  for (const account of exhibit.accounts) {
    container.appendChild(renderAccountBlock(account, exhibit));
  }
  el("account-challenged").value = exhibit.accounts[exhibit.accounts.length - 1]?.id ?? "";
}

function openDossier(exhibitId) {
  const exhibit = exhibitsById.get(exhibitId);
  if (!exhibit) return;
  openDossierExhibitId = exhibitId;
  renderDossier(exhibit);
  el("account-error").textContent = "";
  el("dossier").hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeDossier() {
  openDossierExhibitId = null;
  el("dossier").hidden = true;
  viewport.focus();
}

el("dossier-close").addEventListener("click", closeDossier);
el("account-cancel").addEventListener("click", closeDossier);

el("account-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!openDossierExhibitId) return;
  const form = e.target;
  const payload = {
    kind: form.kind.value,
    body: form.body.value.trim(),
    authorName: form.authorName.value.trim() || myIdentity?.name,
    challengedAccountId: el("account-challenged").value || null,
  };
  const errEl = el("account-error");
  const res = await fetch(`/api/exhibits/${openDossierExhibitId}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error ?? "Could not publish that account.";
    return;
  }
  applyAccountUpdate(openDossierExhibitId, data.account, { isNew: true });
  form.reset();
  errEl.textContent = "";
});

function applyAccountUpdate(exhibitId, account, { isNew = false } = {}) {
  const exhibit = exhibitsById.get(exhibitId);
  if (!exhibit) return;
  const idx = exhibit.accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) exhibit.accounts[idx] = account;
  else exhibit.accounts.push(account);
  if (account.exhibitClassification) exhibit.classification = account.exhibitClassification;
  if (openDossierExhibitId === exhibitId) renderDossier(exhibit);
  if (isNew) toast(`New ${KIND_LABEL[account.kind] ?? account.kind} published on "${exhibit.title}".`);
}

// ---------------------------------------------------------------------------
// Name gate

function markNamed() {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, "1");
  } catch {
    // Private browsing / blocked storage: fine, the gate just reappears
    // next load — a per-viewer convenience only, never load-bearing.
  }
}
function hasNamedBefore() {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

el("name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el("name-input").value.trim();
  if (!name) return;
  try {
    myIdentity = await setDisplayName(name);
    markNamed();
    el("name-gate").hidden = true;
    updateWhoami();
    viewport.focus();
  } catch (err) {
    console.error(err);
  }
});

// ---------------------------------------------------------------------------
// Realtime

let eventSource = null;

function connectEvents() {
  eventSource = new EventSource("/api/events");

  eventSource.addEventListener("hello", (e) => {
    const { presence } = JSON.parse(e.data);
    for (const p of presence) upsertRemoteAvatar(p.visitorId, p);
    updatePresenceCount();
  });

  eventSource.addEventListener("presence", (e) => {
    const p = JSON.parse(e.data);
    upsertRemoteAvatar(p.visitorId, p);
    updatePresenceCount();
  });

  eventSource.addEventListener("presence-left", (e) => {
    const { visitorId } = JSON.parse(e.data);
    const avatar = remoteAvatars.get(visitorId);
    if (avatar) {
      avatar.dispose();
      remoteAvatars.delete(visitorId);
    }
    updatePresenceCount();
  });

  eventSource.addEventListener("exhibit", (e) => {
    const exhibit = JSON.parse(e.data);
    if (exhibitsById.has(exhibit.id)) return;
    exhibitsById.set(exhibit.id, exhibit);
    slotToExhibitId.set(exhibit.slotId, exhibit.id);
    instantiateExhibit(exhibit);
    const gallery = world.galleries.find((g) => g.id === exhibit.galleryId);
    toast(`${exhibit.donorName} donated "${exhibit.title}" to ${gallery?.name ?? exhibit.galleryId}.`);
  });

  eventSource.addEventListener("account", (e) => {
    const account = JSON.parse(e.data);
    applyAccountUpdate(account.exhibitId, account, { isNew: true });
  });

  eventSource.addEventListener("vote", (e) => {
    const account = JSON.parse(e.data);
    applyAccountUpdate(account.exhibitId, account);
  });

  eventSource.onerror = () => {
    // EventSource auto-reconnects; on reconnect the server resends `hello`
    // with current presence, and a fresh GET /api/exhibits (below) hydrates
    // anything missed meanwhile — no-loss refresh per the blueprint.
  };
}

function upsertRemoteAvatar(visitorId, p) {
  if (visitorId === myIdentity?.id) return;
  let avatar = remoteAvatars.get(visitorId);
  if (!avatar) {
    avatar = new RemoteAvatar(sceneApi.scene, visitorId, p);
    remoteAvatars.set(visitorId, avatar);
  } else {
    avatar.setTarget(p.x, p.z, p.yaw);
    if (p.name) avatar.label.material.map.needsUpdate = true;
  }
}

function updatePresenceCount() {
  const n = remoteAvatars.size + 1;
  presenceEl.textContent = n === 1 ? "You are alone in the museum" : `${n} visitors in the museum`;
}

// ---------------------------------------------------------------------------
// Interaction: proximity, raycasting, E / click

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let lastPointerEvent = null;

function nearestExhibitWithin(range) {
  let best = null;
  let bestDist = Infinity;
  for (const [id, mesh] of sceneApi.exhibitMeshes.entries()) {
    const p = mesh.userData.interactPoint;
    const d = Math.hypot(p.x - movement.state.x, p.z - movement.state.z);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return bestDist <= range ? best : null;
}

function distanceToDonorCounter() {
  return Math.hypot(world.hall.donorCounter.x - movement.state.x, world.hall.donorCounter.z - movement.state.z);
}

function updateProximityUI() {
  const nearExhibit = nearestExhibitWithin(INTERACT_RANGE);
  sceneApi.highlightExhibit(nearExhibit);
  const nearCounter = distanceToDonorCounter() <= DONATE_RANGE;
  donateHintBtn.hidden = !nearCounter || nearExhibit !== null;
}

function interact() {
  if (!el("dossier").hidden || !el("donate-gate").hidden || !el("name-gate").hidden) return;
  const nearExhibit = nearestExhibitWithin(INTERACT_RANGE);
  if (nearExhibit) {
    openDossier(nearExhibit);
    return;
  }
  if (distanceToDonorCounter() <= DONATE_RANGE) {
    openDonateGate();
  }
}

donateHintBtn.addEventListener("click", () => openDonateGate());

function raycastExhibitAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, cameraRig.camera);
  const hits = raycaster.intersectObjects([...sceneApi.exhibitGroup.children], true);
  for (const hit of hits) {
    const id = hit.object.userData.exhibitId;
    if (id) return id;
  }
  return null;
}

function raycastExhibitFromCenter() {
  pointerNdc.set(0, 0);
  raycaster.setFromCamera(pointerNdc, cameraRig.camera);
  const hits = raycaster.intersectObjects([...sceneApi.exhibitGroup.children], true);
  for (const hit of hits) {
    const id = hit.object.userData.exhibitId;
    if (id) return id;
  }
  return null;
}

canvas.addEventListener("click", (e) => {
  if (!el("dossier").hidden || !el("donate-gate").hidden || !el("name-gate").hidden) return;

  if (cameraRig.mode === "first-person" && !cameraRig.pointerLocked) {
    canvas.requestPointerLock?.();
    return;
  }

  const id = cameraRig.pointerLocked ? raycastExhibitFromCenter() : raycastExhibitAt(e.clientX, e.clientY);
  if (!id) return;
  const mesh = sceneApi.exhibitMeshes.get(id);
  const p = mesh.userData.interactPoint;
  const d = Math.hypot(p.x - movement.state.x, p.z - movement.state.z);
  if (d <= INTERACT_RANGE) openDossier(id);
});

// ---------------------------------------------------------------------------
// Keyboard: V toggle, E interact, Esc close

window.addEventListener("keydown", (e) => {
  if (movement?.isTypingTarget(document.activeElement)) return;
  if (e.code === "KeyV") {
    cameraRig.toggle();
    crosshair.classList.toggle("visible", cameraRig.mode === "first-person");
  } else if (e.code === "KeyE") {
    interact();
  } else if (e.code === "Escape") {
    if (!el("dossier").hidden) closeDossier();
    else if (!el("donate-gate").hidden) closeDonateGate();
    if (document.pointerLockElement) document.exitPointerLock();
  }
});

// ---------------------------------------------------------------------------
// Touch fallback

function isTouchCapable() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

function setupTouchControls() {
  if (!isTouchCapable()) return;
  const controls = el("touch-controls");
  controls.hidden = false;

  const keyFor = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" };
  const pressed = new Set();

  function fakeKeyEvent(type, code) {
    window.dispatchEvent(new KeyboardEvent(type, { code }));
  }

  for (const btn of controls.querySelectorAll(".dpad button")) {
    const code = keyFor[btn.dataset.dir];
    const press = (ev) => {
      ev.preventDefault();
      if (pressed.has(code)) return;
      pressed.add(code);
      fakeKeyEvent("keydown", code);
    };
    const release = (ev) => {
      ev.preventDefault();
      pressed.delete(code);
      fakeKeyEvent("keyup", code);
    };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
  }

  el("touch-interact").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    interact();
  });
  el("touch-view").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    cameraRig.toggle();
    crosshair.classList.toggle("visible", cameraRig.mode === "first-person");
  });
}

// ---------------------------------------------------------------------------
// Render loop + movement posting

async function postMove(x, z, yaw) {
  try {
    await fetch("/api/presence/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, z, yaw }),
    });
  } catch {
    // transient network blip — the next tick retries with a fresher value
  }
}

let lastFrame = performance.now();
const bootTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  sceneApi.tickAmbient((now - bootTime) / 1000);

  const forwardYaw = cameraRig.mode === "first-person" ? cameraRig.lookYaw : 0;
  const result = movement.tick(dt, {
    forwardYaw,
    snapYawToMovement: cameraRig.mode === "overhead",
  });
  if (cameraRig.mode === "first-person") movement.setYaw(cameraRig.lookYaw);

  if (localAvatarMesh) {
    localAvatarMesh.position.set(movement.state.x, 0, movement.state.z);
    localAvatarMesh.rotation.y = movement.state.yaw;
    localAvatarMesh.visible = cameraRig.mode !== "first-person";
  }

  cameraRig.update(movement.state);
  updateLocationLabel(movement.state.x, movement.state.z);
  updateProximityUI();

  for (const avatar of remoteAvatars.values()) avatar.tick(dt);

  if (result.moved && now - lastMovePosted > MOVE_POST_INTERVAL_MS) {
    lastMovePosted = now;
    postMove(movement.state.x, movement.state.z, movement.state.yaw);
  }

  renderer.render(sceneApi.scene, cameraRig.camera);
}

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  myIdentity = await fetchMe();
  updateWhoami();

  await loadWorld();
  const exhibits = await loadExhibits();

  sceneApi = buildWorldScene(world);
  for (const exhibit of exhibits) instantiateExhibit(exhibit);

  localAvatarMesh = buildAvatarMesh(myIdentity.color);
  localAvatarMesh.position.set(world.spawn.x, 0, world.spawn.z);
  sceneApi.scene.add(localAvatarMesh);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  function resizeRenderer() {
    const { clientWidth, clientHeight } = viewport;
    renderer.setSize(clientWidth, clientHeight, false);
  }
  resizeRenderer();
  window.addEventListener("resize", resizeRenderer);

  cameraRig = createCameraRig(renderer, canvas);
  movement = createMovementController(world);
  movement.state.x = world.spawn.x;
  movement.state.z = world.spawn.z;
  movement.state.yaw = world.spawn.yaw;

  setupTouchControls();
  connectEvents();
  updatePresenceCount();
  // Announce spawn position immediately, not only once the visitor first
  // moves — otherwise a visitor who arrives and stands still is invisible
  // to everyone else until they take a step (caught by watching a second,
  // genuinely separate session rather than assuming the move-on-tick path
  // covered this).
  postMove(movement.state.x, movement.state.z, movement.state.yaw);

  if (!hasNamedBefore()) {
    el("name-gate").hidden = false;
    el("name-input").focus();
  } else {
    viewport.focus();
  }

  requestAnimationFrame(frame);
}

// Dev-only introspection hook, harmless in production (no state mutation,
// just reads) — handy for manual QA without needing devtools.
window.__museumDebug = () => ({
  position: movement?.state,
  cameraMode: cameraRig?.mode,
  exhibitCount: exhibitsById.size,
  remoteCount: remoteAvatars.size,
  meshCount: sceneApi?.exhibitMeshes?.size,
  nearest: nearestExhibitWithin(INTERACT_RANGE),
  donorDist: distanceToDonorCounter(),
});

boot().catch((err) => {
  console.error("failed to start The Cursed Museum", err);
  toast("Something went wrong loading the museum — try reloading.");
});
