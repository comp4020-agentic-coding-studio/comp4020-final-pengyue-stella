import * as THREE from "three";
import { buildWorldScene, renderArtifactPreview } from "./world/scene.js";
import { createExplorationController } from "./world/exploration.js";

const NAME_STORAGE_KEY = "cursedMuseumNamed";

const el = (id) => document.getElementById(id);
const viewport = el("viewport");
const canvas = el("scene-canvas");
const sceneFadeEl = el("scene-fade");
const hotspotLayer = el("hotspot-layer");
const turnControlsEl = el("turn-controls");
const presenceEl = el("presence");
const whoamiEl = el("whoami");
const galleryTitleEl = el("gallery-title");
const galleryHintEl = el("gallery-hint");
const toastsEl = el("toasts");
const controlHintEl = el("control-hint");

let myIdentity = null;
let world = null;
let exhibitsById = new Map(); // exhibitId -> exhibit (with accounts)
let sceneApi = null;
let explorer = null;
let renderer = null;
let lastSceneCounts = {};
let currentSceneId = null;
let openDossierExhibitId = null;
let pendingAfterArrival = null; // one-shot callback run once the current scene cut settles

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
// World + exhibits

async function loadWorld() {
  const res = await fetch("/api/world");
  world = await res.json();
}

async function loadExhibits() {
  const res = await fetch("/api/exhibits");
  const { exhibits } = await res.json();
  exhibitsById = new Map(exhibits.map((e) => [e.id, e]));
  return exhibits;
}

function findSlot(slotId) {
  for (const gallery of world.galleries) {
    const slot = gallery.slots.find((s) => s.id === slotId);
    if (slot) return { gallery, slot };
  }
  return {};
}

function instantiateExhibit(exhibit) {
  const { gallery, slot } = findSlot(exhibit.slotId);
  if (!gallery || !slot) return;
  sceneApi.addExhibitMesh(exhibit, slot);
}

async function resyncExhibits() {
  const exhibits = await loadExhibits();
  for (const exhibit of exhibits) {
    if (!sceneApi.exhibitMeshes.has(exhibit.id)) instantiateExhibit(exhibit);
  }
  if (openDossierExhibitId && exhibitsById.has(openDossierExhibitId)) {
    renderDossier(exhibitsById.get(openDossierExhibitId));
  }
  refreshHotspots();
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
  instantiateExhibit(data.exhibit);
  closeDonateGate();
  form.reset();
  openReceipt(data.exhibit);
});

// ---------------------------------------------------------------------------
// Post-donation receipt + "View My Relic" (a scene cut straight to the
// donated exhibit's own gallery, then the dossier — never a teleporting
// avatar, because there is no avatar any more; see
// docs/adr/0003-scene-exploration.md)

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

function viewMyRelic(exhibitId) {
  const exhibit = exhibitsById.get(exhibitId);
  if (!exhibit) return;
  pendingAfterArrival = () => openDossier(exhibitId);
  explorer.goToScene(`${exhibit.galleryId}-main`);
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
  closeLoreCard();
  openDossierExhibitId = exhibitId;
  renderDossier(exhibit);
  el("account-error").textContent = "";
  el("dossier").hidden = false;
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
// Environmental lore popover — a hotspot that isn't a full archival exhibit,
// just a line or two of in-world storytelling (the blueprint's "important
// environmental objects can have short lore text even if they are not full
// archival exhibits"). Also auto-shown once on arriving at a close-up scene,
// since the close-up's own lore IS its main content.

function openLoreCard(title, text) {
  el("lore-title").textContent = title;
  el("lore-text").textContent = text;
  el("lore-card").hidden = false;
}
function closeLoreCard() {
  el("lore-card").hidden = true;
}
el("lore-close").addEventListener("click", closeLoreCard);

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
// Realtime: scene-scoped presence + the living archive

let eventSource = null;

function connectEvents() {
  eventSource = new EventSource(`/api/events?scene=${encodeURIComponent(currentSceneId)}`);

  let firstHello = true;
  eventSource.addEventListener("hello", async (e) => {
    const { sceneCounts } = JSON.parse(e.data);
    lastSceneCounts = sceneCounts ?? {};
    updatePresenceLabel();

    // The very first connection already hydrated from loadExhibits() in
    // boot(); every `hello` after that one means the stream reconnected (a
    // network blip, a backgrounded tab), during which a donation/account/
    // vote broadcast could have been missed entirely — EventSource retrying
    // the connection is not itself a guarantee of no lost events.
    // Re-fetching the whole archive here is the no-loss-refresh behaviour
    // the blueprint asks for.
    if (firstHello) {
      firstHello = false;
      return;
    }
    await resyncExhibits();
  });

  eventSource.addEventListener("scene-presence", (e) => {
    const { sceneId, count } = JSON.parse(e.data);
    const previous = lastSceneCounts[sceneId] ?? 0;
    lastSceneCounts = { ...lastSceneCounts, [sceneId]: count };
    if (sceneId === currentSceneId) {
      // Restrained: only a genuine increase in this room's own headcount
      // (not every scene's count everywhere, and not a decrease) gets a
      // toast — "showing that another visitor just donated/voted ... showing
      // subtle 'someone is here' signals," never a running tracking feed.
      if (count > previous && previous > 0) toast("Another visitor has entered this room.");
      updatePresenceLabel();
    }
  });

  eventSource.addEventListener("presence-left", () => {
    // A departure already lands as a scene-presence recount for the scene
    // they left (see server/src/sse.js's broadcastDeparture) — nothing
    // further to do here.
  });

  eventSource.addEventListener("exhibit", (e) => {
    const exhibit = JSON.parse(e.data);
    if (exhibitsById.has(exhibit.id)) return;
    exhibitsById.set(exhibit.id, exhibit);
    instantiateExhibit(exhibit);
    refreshHotspots();
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
    // with current scene counts, and a fresh GET /api/exhibits (above)
    // hydrates anything missed meanwhile — no-loss refresh per the
    // blueprint.
  };
}

function updatePresenceLabel() {
  const n = lastSceneCounts[currentSceneId] ?? 1;
  presenceEl.textContent = n <= 1 ? "You are alone in this room" : `${n} visitors in this room`;
}

async function postPresence(sceneId) {
  try {
    await fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId }),
    });
  } catch {
    // transient network blip — the next navigation retries with a fresh value
  }
}

// ---------------------------------------------------------------------------
// Hotspot overlay: real, focusable <button>s positioned over their matching
// 3D point every frame (see exploration.js's projectToScreen). This is the
// entire interaction surface — door/closeup/back/donate/lore hotspots and
// every exhibit currently in view — so mouse, touch and Tab/Enter all reach
// the same thing the same way (CLAUDE.md's "every interaction works with a
// mouse, a touchscreen and a keyboard" rule).

let hotspotEntries = []; // { el, worldPos }

function anyOverlayOpen() {
  return (
    !el("dossier").hidden ||
    !el("donate-gate").hidden ||
    !el("donate-receipt").hidden ||
    !el("name-gate").hidden
  );
}

function handleHotspotActivate(hotspot) {
  if (anyOverlayOpen() || explorer.isTransitioning) return;
  if (hotspot.type === "exhibit") {
    openDossier(hotspot.exhibitId);
    return;
  }
  if (hotspot.type === "donate") {
    openDonateGate();
    return;
  }
  if (hotspot.type === "lore") {
    openLoreCard(hotspot.label, hotspot.text);
    return;
  }
  // door / closeup / back all resolve to a scene cut.
  if (hotspot.targetSceneId) explorer.goToScene(hotspot.targetSceneId);
}

function refreshHotspots() {
  hotspotLayer.innerHTML = "";
  hotspotEntries = [];
  const scene = explorer.currentScene();

  for (const hotspot of scene.hotspots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hotspot hotspot-${hotspot.type}`;
    button.textContent = hotspot.label;
    button.addEventListener("click", () => handleHotspotActivate(hotspot));
    hotspotLayer.appendChild(button);
    hotspotEntries.push({ el: button, worldPos: hotspot.pos });
  }

  // Every donated exhibit in this gallery's own main scene is directly
  // inspectable — there is no more proximity/raycasting model (see
  // docs/adr/0003-scene-exploration.md).
  if (scene.kind === "main" && scene.galleryId) {
    const exhibitIds = [];
    for (const exhibit of exhibitsById.values()) {
      if (exhibit.galleryId !== scene.galleryId) continue;
      const mesh = sceneApi.exhibitMeshes.get(exhibit.id);
      if (!mesh) continue;
      exhibitIds.push(exhibit.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hotspot hotspot-exhibit";
      button.textContent = exhibit.title;
      button.addEventListener("click", () =>
        handleHotspotActivate({ type: "exhibit", exhibitId: exhibit.id }),
      );
      hotspotLayer.appendChild(button);
      hotspotEntries.push({ el: button, worldPos: mesh.userData.interactPoint.toArray() });
    }
    sceneApi.setInteractableExhibits(exhibitIds);
  } else {
    sceneApi.setInteractableExhibits([]);
  }

  turnControlsEl.hidden = scene.kind !== "hub";
  el("turn-left").disabled = !scene.turnLeft;
  el("turn-right").disabled = !scene.turnRight;

  galleryTitleEl.textContent = scene.caption;
  galleryHintEl.textContent =
    scene.kind === "hub"
      ? "Click a glowing doorway to enter a gallery, or the donor counter to donate."
      : scene.kind === "closeup"
        ? "A closer look. Click back to return to the gallery."
        : "Approach a glinting exhibit's label to inspect it.";
}

// Nudges visually-overlapping hotspots apart rather than letting them stack
// on top of each other unclickable — several hotspot anchors can project
// close together in screen space (most visibly on a narrow/portrait
// viewport, where a whole room's width collapses toward the vanishing
// point, but nothing stops it happening on any viewport if enough
// furniture/exhibits cluster near one vantage's centreline). Greedy and
// monotonic: each candidate is pushed straight down past whatever it still
// overlaps, in insertion order (door/back/closeup/lore hotspots first, each
// gallery's exhibits after), so this always terminates and never needs to
// move something that's already been placed.
const HOTSPOT_GAP_PX = 6;
const HOTSPOT_EDGE_MARGIN_PX = 8;
function declutterHotspots(positioned, viewportWidth, viewportHeight) {
  const placed = [];
  for (const item of positioned) {
    const w = item.button.offsetWidth || 120;
    const h = item.button.offsetHeight || 30;
    // Clamp horizontally first — a label anchored near a vantage's own
    // left/right edge (where the room's walls converge toward the
    // vanishing point) otherwise renders with its text running off the
    // viewport, independent of the vertical-overlap case below.
    const x = Math.min(
      Math.max(item.x, w / 2 + HOTSPOT_EDGE_MARGIN_PX),
      viewportWidth - w / 2 - HOTSPOT_EDGE_MARGIN_PX,
    );
    let y = item.y;
    let movedAgain = true;
    while (movedAgain) {
      movedAgain = false;
      for (const p of placed) {
        const overlapsX = Math.abs(x - p.x) < (w + p.w) / 2;
        const overlapsY = Math.abs(y - p.y) < (h + p.h) / 2 + HOTSPOT_GAP_PX;
        if (overlapsX && overlapsY) {
          y = p.y + (h + p.h) / 2 + HOTSPOT_GAP_PX;
          movedAgain = true;
        }
      }
    }
    y = Math.min(y, viewportHeight - h / 2 - HOTSPOT_EDGE_MARGIN_PX);
    item.button.style.left = `${x}px`;
    item.button.style.top = `${y}px`;
    placed.push({ x, y, w, h });
  }
}

function repositionHotspots() {
  const rect = viewport.getBoundingClientRect();
  const positioned = [];
  for (const { el: button, worldPos } of hotspotEntries) {
    const projected = explorer.projectToScreen(worldPos, rect.width, rect.height);
    if (!projected || explorer.isTransitioning) {
      button.style.display = "none";
      continue;
    }
    button.style.display = "";
    positioned.push({ button, x: projected.x, y: projected.y });
  }
  declutterHotspots(positioned, rect.width, rect.height);
}

function onSceneChange(scene) {
  currentSceneId = scene.id;
  closeLoreCard();
  refreshHotspots();
  postPresence(scene.id);
  updatePresenceLabel();
  if (scene.kind === "closeup" && scene.lore) openLoreCard(scene.caption, scene.lore);
  if (pendingAfterArrival) {
    const run = pendingAfterArrival;
    pendingAfterArrival = null;
    run();
  }
}

// ---------------------------------------------------------------------------
// Keyboard: Esc closes the topmost UI or steps back a scene; arrow keys turn
// at the hub. There is no movement to protect focus from any more (no WASD),
// so these are the only two global bindings left.

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (!el("dossier").hidden) closeDossier();
    else if (!el("donate-gate").hidden) closeDonateGate();
    else if (!el("donate-receipt").hidden) closeReceipt();
    else if (!el("lore-card").hidden) closeLoreCard();
    else explorer.back();
    return;
  }
  if (isTypingTarget(document.activeElement) || anyOverlayOpen() || explorer.isTransitioning) return;
  if (e.code === "ArrowLeft") explorer.turnLeft();
  else if (e.code === "ArrowRight") explorer.turnRight();
});

el("turn-left").addEventListener("click", () => explorer.turnLeft());
el("turn-right").addEventListener("click", () => explorer.turnRight());

// ---------------------------------------------------------------------------
// Render loop

let lastFrame = performance.now();
const bootTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  explorer.update(dt);

  const camPos = explorer.camera.position;
  sceneApi.tickAmbient((now - bootTime) / 1000);
  sceneApi.tickWatchingEyes(camPos.x, camPos.z, dt);
  repositionHotspots();

  renderer.render(sceneApi.scene, explorer.camera);
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
  // exhibits — actually readable, which the brief requires ("mysterious
  // but readable").
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const camera = new THREE.PerspectiveCamera(78, 1, 0.1, 120);
  function resizeRenderer() {
    const { clientWidth, clientHeight } = viewport;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(1, clientHeight);
    camera.updateProjectionMatrix();
    // Re-derives the active scene's vertical FOV for the new aspect (see
    // exploration.js's verticalFovFor) — a narrower viewport than the
    // reference aspect must never shrink the horizontal FOV a scene's
    // hotspots/display slots were placed against, so this has to re-run on
    // every resize/orientation-change, not just once at boot.
    explorer?.handleResize();
  }
  resizeRenderer();
  window.addEventListener("resize", resizeRenderer);

  explorer = createExplorationController({ camera, world, fadeEl: sceneFadeEl, onSceneChange });
  currentSceneId = explorer.currentScene().id;
  resizeRenderer();

  connectEvents();
  refreshHotspots();
  updatePresenceLabel();
  postPresence(currentSceneId);

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
  sceneId: currentSceneId,
  exhibitCount: exhibitsById.size,
  meshCount: sceneApi?.exhibitMeshes?.size,
  sceneCounts: lastSceneCounts,
});
window.__museumInternals = () => ({ scene: sceneApi?.scene, camera: explorer?.camera, renderer, THREE });

boot().catch((err) => {
  console.error("failed to start The Cursed Museum", err);
  toast("Something went wrong loading the museum — try reloading.");
});
