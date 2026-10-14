import * as THREE from "three";
import { buildWorldScene, renderArtifactPreview } from "./world/scene.js";
import { createMovementController } from "./world/movement.js";
import { createCameraRig } from "./world/cameras.js";
import { RemoteAvatar, buildAvatarMesh, animateWalk } from "./world/avatar.js";

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
const controlHintEl = el("control-hint");
const lockHintEl = el("lock-hint");

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
let localAvatarRig = null;
let localWalkPhase = 0;
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

async function resyncExhibits() {
  const exhibits = await loadExhibits();
  for (const exhibit of exhibits) {
    if (!sceneApi.exhibitMeshes.has(exhibit.id)) instantiateExhibit(exhibit);
  }
  if (openDossierExhibitId && exhibitsById.has(openDossierExhibitId)) {
    renderDossier(exhibitsById.get(openDossierExhibitId));
  }
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

const SUBTYPE_LABEL = {
  painting: "Painting", sketch: "Sketch",
  spoon: "Spoon", key: "Key", clock: "Clock", mirror: "Mirror", curiosity: "Curiosity",
  botanical: "Botanical specimen", biological: "Biological specimen",
  doll: "Doll", toy: "Toy", book: "Book or letter",
};

function populateDonateForm() {
  const gallerySelect = el("donate-gallery");
  const subtypeSelect = el("donate-subtype");
  const slotSelect = el("donate-slot");
  gallerySelect.innerHTML = "";
  for (const g of world.galleries) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    gallerySelect.appendChild(opt);
  }

  function refreshSubtypes() {
    const gallery = world.galleries.find((g) => g.id === gallerySelect.value);
    subtypeSelect.innerHTML = "";
    for (const subtype of gallery?.subtypes ?? []) {
      const opt = document.createElement("option");
      opt.value = subtype;
      opt.textContent = SUBTYPE_LABEL[subtype] ?? subtype;
      subtypeSelect.appendChild(opt);
    }
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
  gallerySelect.onchange = () => {
    refreshSubtypes();
    refreshSlots();
  };
  refreshSubtypes();
  refreshSlots();
}

function openDonateGate() {
  populateDonateForm();
  el("donate-error").textContent = "";
  // Pre-filled from the visitor's current display name, editable — the
  // brief's "keep the author-name field, pre-filled but editable" contract.
  el("donate-donor").value = myIdentity?.name ?? "";
  el("donate-gate").hidden = false;
  cameraRig.releaseLock();
  el("donate-title").focus();
}
function closeDonateGate() {
  el("donate-gate").hidden = true;
  // Closing a form must not automatically recapture the pointer — the
  // visitor stays in cursor mode until they deliberately click empty scene
  // space again (or Esc already released it, so there's nothing to undo).
  viewport.focus();
}

el("donate-cancel").addEventListener("click", closeDonateGate);
el("donate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    galleryId: form.galleryId.value,
    subtype: form.subtype.value,
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
    // A failed donation is reported exactly as what it is — never a success
    // toast papering over a rejected write.
    errEl.textContent = data.error ?? "Could not donate that relic.";
    return;
  }
  exhibitsById.set(data.exhibit.id, data.exhibit);
  slotToExhibitId.set(data.exhibit.slotId, data.exhibit.id);
  instantiateExhibit(data.exhibit);
  closeDonateGate();
  form.reset();
  openReceipt(data.exhibit);
});

// ---------------------------------------------------------------------------
// Post-donation receipt + guided "View My Relic" walk

function openReceipt(exhibit) {
  const gallery = world.galleries.find((g) => g.id === exhibit.galleryId);
  el("receipt-title").textContent = exhibit.title;
  el("receipt-meta").textContent =
    `Exhibit #${exhibit.number} · ${gallery?.name ?? exhibit.galleryId} · donated by ${exhibit.donorName}`;

  const canvas = el("receipt-preview");
  renderArtifactPreview(canvas, {
    category: exhibit.category,
    subtype: exhibit.subtype,
    accent: gallery?.accent ?? "#88653d",
    exhibitId: exhibit.id,
    title: exhibit.title,
    donorName: exhibit.donorName,
  });

  el("donate-receipt").hidden = false;
  cameraRig.releaseLock();

  el("receipt-browse").onclick = closeReceipt;
  el("receipt-view").onclick = () => {
    closeReceipt();
    viewMyRelic(exhibit.id);
  };
}

function closeReceipt() {
  el("donate-receipt").hidden = true;
  viewport.focus();
}

// Builds a short waypoint path from wherever the visitor currently stands to
// the donated exhibit's own slot, via the hall centre and the target
// gallery's doorway — enough for this world's plus-shaped topology (every
// gallery connects only through the hall) without a general navmesh. The
// avatar visibly walks this route at normal speed; arriving opens the
// dossier, same as walking there and pressing E yourself.
function viewMyRelic(exhibitId) {
  const exhibit = exhibitsById.get(exhibitId);
  const { gallery, slot } = findSlot(exhibit?.slotId);
  if (!exhibit || !gallery || !slot) return;

  const waypoints = [];
  const { x, z } = movement.state;
  const inGallery = galleryContaining(x, z)?.id === gallery.id;
  if (!inGallery) {
    waypoints.push({ x: 0, z: 0 }); // hall centre
    waypoints.push({ x: gallery.doorway.x, z: gallery.doorway.z });
  }
  waypoints.push({ x: slot.x, z: slot.z });

  movement.startAutopilot(waypoints, () => openDossier(exhibitId));
}

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
  // Disputed records are visually distinct, not just labelled — a tied
  // verdict (on the account itself, or because this is the exhibit's
  // current leading account and the exhibit-level verdict is tied) reads
  // differently from a settled one at a glance.
  if (account.verdict === "Disputed") block.classList.add("disputed");

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
        // Immediate confirmation that this specific vote landed — the
        // dossier re-render already reflects the new tally/verdict, but a
        // visitor acting fast benefits from an explicit "yes, that worked"
        // right where they clicked, not just the surrounding numbers
        // changing.
        toast(`Vote recorded: ${verdict}.`);
      }
    });
    voteButtons.appendChild(btn);
  }
  votesRow.appendChild(voteButtons);
  block.appendChild(votesRow);

  return block;
}

let dossierPreviewExhibitId = null;

function renderDossier(exhibit) {
  el("dossier-kicker").textContent =
    `Exhibit #${exhibit.number} · ${exhibit.category.toUpperCase()} · ${exhibit.classification}`;
  el("dossier-title").textContent = exhibit.title;
  const gallery = world.galleries.find((g) => g.id === exhibit.galleryId);
  el("dossier-meta").textContent = `${gallery?.name ?? exhibit.galleryId} · donated by ${exhibit.donorName} · ${exhibit.accounts.length} account${exhibit.accounts.length === 1 ? "" : "s"}`;

  // Rendered once per exhibit, not on every re-render (a vote landing while
  // the dossier is open calls this again) — it's the same still model every
  // time, so there's nothing to gain from redrawing it on every update.
  if (dossierPreviewExhibitId !== exhibit.id) {
    dossierPreviewExhibitId = exhibit.id;
    renderArtifactPreview(el("dossier-preview"), {
      category: exhibit.category,
      subtype: exhibit.subtype,
      accent: gallery?.accent ?? "#88653d",
      exhibitId: exhibit.id,
      title: exhibit.title,
      donorName: exhibit.donorName,
    });
  }

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
  // Opening any interactive UI always releases pointer lock, regardless of
  // which camera rig is active — a locked cursor can't click a vote button.
  cameraRig.releaseLock();
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

  const previousClassification = exhibit.classification;
  if (account.exhibitClassification) exhibit.classification = account.exhibitClassification;
  if (openDossierExhibitId === exhibitId) renderDossier(exhibit);

  if (isNew) {
    toast(`New ${KIND_LABEL[account.kind] ?? account.kind} published on "${exhibit.title}".`);
  } else if (exhibit.classification !== previousClassification) {
    // Restrained per the brief ("avoid excessive... notifications"): a vote
    // only surfaces a toast when it actually moves the exhibit's overall
    // classification, not on every single vote cast by anyone.
    toast(`"${exhibit.title}" is now classified ${exhibit.classification}.`);
  }
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

// The name gate is itself UI — shown, it must behave like the others (no
// lock to release yet at boot, but kept consistent for the same reason).
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

  let firstHello = true;
  eventSource.addEventListener("hello", async (e) => {
    const { presence } = JSON.parse(e.data);
    for (const p of presence) upsertRemoteAvatar(p.visitorId, p);
    updatePresenceCount();

    // The very first connection already hydrated from loadExhibits() in
    // boot(); every `hello` after that one means the stream reconnected
    // (a network blip, a backgrounded tab), during which a donation/
    // account/vote broadcast could have been missed entirely — EventSource
    // retrying the connection is not itself a guarantee of no lost events.
    // Re-fetching the whole archive here is the no-loss-refresh behaviour
    // the blueprint asks for.
    if (firstHello) {
      firstHello = false;
      return;
    }
    await resyncExhibits();
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
  if (anyOverlayOpen()) return;

  // With a visible aim reticle (pointer-locked first-person), E targets
  // whatever the crosshair is actually over, same resolution click already
  // uses — not just whichever exhibit happens to be geometrically nearest.
  // A visitor standing equidistant between two exhibits but looking
  // straight at one of them gets that one, not an arbitrary pick.
  if (cameraRig.mode === "first-person" && cameraRig.pointerLocked) {
    const targeted = raycastExhibitFromCenter();
    if (targeted) {
      tryInspect(targeted);
      return;
    }
  }

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
  if (anyOverlayOpen()) return;

  // In first-person, cursor mode (unlocked) is the browsing state: a click
  // first tries to hit an exhibit under the actual cursor position exactly
  // like overhead mode does. Only a click that hits nothing (empty scene
  // space) resumes mouse-look — so clicking an exhibit to inspect it never
  // also re-locks the pointer out from under the dossier that's about to
  // open.
  if (cameraRig.mode === "first-person" && !cameraRig.pointerLocked) {
    const id = raycastExhibitAt(e.clientX, e.clientY);
    if (id) {
      tryInspect(id);
    } else {
      cameraRig.requestLock();
    }
    return;
  }

  const id = cameraRig.pointerLocked ? raycastExhibitFromCenter() : raycastExhibitAt(e.clientX, e.clientY);
  if (id) tryInspect(id);
});

// Proper raycasting resolves which exhibit is actually targeted — it does
// not fall back to "nearest exhibit" when a raycast hit exists, even if a
// closer exhibit happens to sit out of the cursor's/crosshair's path. Range
// is still enforced: a visitor can see an exhibit across the room, but
// can't inspect it from across the room. A valid hit that's merely too far
// away is never silently dropped — it gets an explicit hint instead, same
// as the brief requires.
function tryInspect(exhibitId) {
  const mesh = sceneApi.exhibitMeshes.get(exhibitId);
  if (!mesh) return;
  const p = mesh.userData.interactPoint;
  const d = Math.hypot(p.x - movement.state.x, p.z - movement.state.z);
  if (d <= INTERACT_RANGE) {
    openDossier(exhibitId);
  } else {
    toast("Move closer to inspect.");
  }
}

function anyOverlayOpen() {
  return (
    !el("dossier").hidden ||
    !el("donate-gate").hidden ||
    !el("donate-receipt").hidden ||
    !el("name-gate").hidden
  );
}

// ---------------------------------------------------------------------------
// Keyboard: V toggle, E interact, Esc close

window.addEventListener("keydown", (e) => {
  if (movement?.isTypingTarget(document.activeElement)) return;
  if (e.code === "KeyV") {
    cameraRig.toggle();
    updateCrosshair();
  } else if (e.code === "KeyE") {
    interact();
  } else if (e.code === "Escape") {
    // Esc has two different jobs depending on what's actually open, and
    // only ever does the more specific one: with a dossier/donation form
    // open, Esc closes that UI (pointer lock is already released from when
    // it opened). With nothing open, Esc's job is purely "release the
    // pointer without switching camera" — exploration mode -> cursor mode,
    // first-person rig unchanged. It never both closes UI AND independently
    // releases the lock in the same press; those are the same action when
    // a dossier is open (openDossier already released it).
    if (!el("dossier").hidden) {
      closeDossier();
    } else if (!el("donate-gate").hidden) {
      closeDonateGate();
    } else if (!el("donate-receipt").hidden) {
      closeReceipt();
    } else {
      cameraRig.releaseLock();
    }
  }
});

function updateCrosshair() {
  crosshair.classList.toggle("visible", cameraRig.mode === "first-person" && cameraRig.pointerLocked);
}

let hasShownLockHint = false;
let lastHintKey = "";
function updateControlHint() {
  if (cameraRig.pointerLocked && !hasShownLockHint) {
    hasShownLockHint = true;
    lockHintEl.hidden = false;
    // The CSS animation handles the fade; hide it from the accessibility
    // tree and layout once it's done so it can't linger as an invisible
    // focus trap.
    setTimeout(() => {
      lockHintEl.hidden = true;
    }, 4600);
  }
  const key = `${cameraRig.mode}:${cameraRig.pointerLocked}`;
  if (key === lastHintKey) return;
  lastHintKey = key;

  if (cameraRig.mode !== "first-person") {
    controlHintEl.textContent = "WASD/arrows to move · V to switch view · E or click to inspect";
  } else if (cameraRig.pointerLocked) {
    controlHintEl.textContent = "Mouse look active · Esc to free your cursor · E to inspect";
  } else {
    controlHintEl.textContent = "Cursor free · click an exhibit to inspect, or empty space to look around";
  }
}

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
    updateCrosshair();
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
    const speed01 = result.moved ? 1 : 0;
    localWalkPhase += dt * 8 * Math.max(0.2, speed01);
    if (localAvatarRig) animateWalk(localAvatarRig, localWalkPhase, speed01);
  }

  cameraRig.update(movement.state);
  updateLocationLabel(movement.state.x, movement.state.z);
  updateProximityUI();
  updateCrosshair();
  updateControlHint();

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

  const localBuilt = buildAvatarMesh(myIdentity.color);
  localAvatarMesh = localBuilt.group;
  localAvatarRig = localBuilt.rig;
  localAvatarMesh.position.set(world.spawn.x, 0, world.spawn.z);
  sceneApi.scene.add(localAvatarMesh);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Three.js r155+ uses physically-correct (candela) point-light intensity
  // by default, where the small intensity values that read fine in an
  // older/non-physical renderer (~1) are nearly invisible a few metres
  // away — this is what made every gallery read as "nearly black, empty"
  // before any furniture was even added. ACES tone mapping plus a modest
  // exposure lift keeps the warm-lamp-in-shadow mood (still genuinely dim
  // at the room's edges) while making the lit areas — floor, walls, props,
  // other visitors — actually readable, which the brief requires
  // ("mysterious but readable... must clearly see the floor, walls,
  // navigation routes, objects and other visitors").
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

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
window.__museumInternals = () => ({ scene: sceneApi?.scene, camera: cameraRig?.camera, renderer, THREE });

boot().catch((err) => {
  console.error("failed to start The Cursed Museum", err);
  toast("Something went wrong loading the museum — try reloading.");
});
