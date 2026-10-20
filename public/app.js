import { renderArtifactPreview } from "./world/artifacts.js";
import { createIllustrationController } from "./world/illustration.js";

const NAME_STORAGE_KEY = "cursedMuseumNamed";

const el = (id) => document.getElementById(id);
const viewport = el("viewport");
const turnControlsEl = el("turn-controls");
const presenceEl = el("presence");
const whoamiEl = el("whoami");
const galleryTitleEl = el("gallery-title");
const toastsEl = el("toasts");

let myIdentity = null;
let myPublicKey = null;
let world = null;
let exhibitsById = new Map(); // exhibitId -> exhibit (with accounts)
let illustrator = null;
let lastSceneCounts = {};
let lastSceneVisitors = {}; // sceneId -> [{publicKey, displayName}]
let currentSceneId = null;
let openDossierExhibitId = null;
let pendingAfterArrival = null; // one-shot callback run once the current scene cut settles

// Navigates to `sceneId` and then runs `then` once the scene is current.
// `illustrator.goToScene` no-ops when the target is already the current
// scene (there is nothing to cut to) — which silently drops `then` for the
// common case of "a relic placed in the gallery the donor is already
// standing in," or "open the archive while already in that exhibit's own
// gallery." Run `then` immediately in that case instead of relying on a
// scene-change event that will never fire.
function goToSceneThen(sceneId, then) {
  if (illustrator.currentScene().id === sceneId) {
    then();
  } else {
    pendingAfterArrival = then;
    illustrator.goToScene(sceneId);
  }
}
let focusedObjectId = null; // the interactive object currently illuminated (hover/focus/open)
let placement = null; // { exhibitForm, galleryId } while choosing/confirming a relic's spot — see "Spatial relic placement"

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

function occupiedSlotIdsForGallery(galleryId) {
  const out = new Set();
  for (const exhibit of exhibitsById.values()) {
    if (exhibit.galleryId === galleryId) out.add(exhibit.slotId);
  }
  return out;
}

async function resyncExhibits() {
  await loadExhibits();
  if (openDossierExhibitId && exhibitsById.has(openDossierExhibitId)) {
    renderDossier(exhibitsById.get(openDossierExhibitId));
  }
  refreshInteractiveObjects();
}

// ---------------------------------------------------------------------------
// Donation: a two-step flow — the form collects gallery/relic type/story/
// donor, then "Place Relic…" enters placement mode in that gallery's own
// main scene where the donor clicks a glowing, currently-free anchor
// (CLAUDE.md's "visual placement step," replacing a "Display slot"
// dropdown). The server still only ever accepts one of its own allow-
// listed slot ids — see db.js's donateExhibit — placement mode just picks
// which one visually instead of by label.

const SUBTYPE_LABEL = {
  painting: "Painting", sketch: "Sketch",
  spoon: "Spoon", key: "Key", clock: "Clock", mirror: "Mirror", curiosity: "Curiosity",
  botanical: "Botanical specimen", biological: "Biological specimen",
  doll: "Doll", toy: "Toy", book: "Book or letter",
};

function populateDonateForm() {
  const gallerySelect = el("donate-gallery");
  const subtypeSelect = el("donate-subtype");
  gallerySelect.innerHTML = "";
  for (const g of world.galleries) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    gallerySelect.appendChild(opt);
  }
  // Default to whichever gallery the visitor is currently looking at, if
  // any — a small convenience, not a restriction: every gallery stays
  // selectable regardless of current scene (CLAUDE.md: donation must be
  // reachable from every main scene, not gated by orientation).
  const scene = illustrator?.currentScene();
  if (scene?.galleryId) gallerySelect.value = scene.galleryId;

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
  gallerySelect.onchange = refreshSubtypes;
  refreshSubtypes();
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

el("open-donate").addEventListener("click", openDonateGate);
el("donate-cancel").addEventListener("click", closeDonateGate);
el("donate-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const galleryId = form.galleryId.value;
  const gallery = world.galleries.find((g) => g.id === galleryId);
  const free = gallery.slots.filter((s) => !occupiedSlotIdsForGallery(galleryId).has(s.id));
  const errEl = el("donate-error");
  if (free.length === 0) {
    errEl.textContent = "No free display spot in this gallery right now — try another gallery.";
    return;
  }
  errEl.textContent = "";
  const exhibitForm = {
    galleryId,
    subtype: form.subtype.value,
    title: form.title.value.trim(),
    originClaim: form.originClaim.value.trim(),
    donorName: form.donorName.value.trim() || myIdentity?.name,
  };
  closeDonateGate();
  startPlacement(exhibitForm);
});

// ---------------------------------------------------------------------------
// Spatial relic placement: steps 3-8 of the donation workflow. Entering
// placement mode navigates to the chosen gallery's main scene; only its
// currently-free, server-defined slot anchors glow (rendered by
// renderPlacementAnchors, called from refreshInteractiveObjects whenever
// `placement` is active) — an occupied slot or arbitrary pixel coordinate
// is never offered, matching CLAUDE.md's "continue using server-defined,
// allow-listed anchors/slot IDs."

function startPlacement(exhibitForm) {
  placement = { exhibitForm, chosenSlotId: null, confirming: false };
  const label = `${exhibitForm.title}`;
  el("placement-title").textContent = label;
  el("placement-banner").hidden = false;
  el("placement-confirm").hidden = true;
  const targetScene = `${exhibitForm.galleryId}-main`;
  if (illustrator.currentScene().id === targetScene) {
    refreshInteractiveObjects();
  } else {
    illustrator.goToScene(targetScene);
  }
}

function cancelPlacement() {
  placement = null;
  el("placement-banner").hidden = true;
  el("placement-confirm").hidden = true;
  refreshInteractiveObjects();
  viewport.focus();
}
el("placement-cancel").addEventListener("click", cancelPlacement);

function choosePlacementAnchor(slotId) {
  if (!placement) return;
  placement.chosenSlotId = slotId;
  placement.confirming = true;
  el("placement-banner").hidden = true;
  el("placement-confirm").hidden = false;
  refreshInteractiveObjects(); // repaint: ghost preview at the chosen anchor, others dim
}

el("placement-move").addEventListener("click", () => {
  if (!placement) return;
  placement.confirming = false;
  placement.chosenSlotId = null;
  el("placement-confirm").hidden = true;
  el("placement-banner").hidden = false;
  refreshInteractiveObjects();
});

el("placement-confirm-btn").addEventListener("click", async () => {
  if (!placement?.chosenSlotId) return;
  const { exhibitForm, chosenSlotId } = placement;
  const res = await fetch("/api/exhibits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...exhibitForm, slotId: chosenSlotId }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.error ?? "Could not place that relic — it may have just been taken.");
    placement.confirming = false;
    placement.chosenSlotId = null;
    el("placement-confirm").hidden = true;
    el("placement-banner").hidden = false;
    refreshInteractiveObjects();
    return;
  }
  exhibitsById.set(data.exhibit.id, data.exhibit);
  placement = null;
  el("placement-banner").hidden = true;
  el("placement-confirm").hidden = true;
  refreshInteractiveObjects();
  openReceipt(data.exhibit);
});

// ---------------------------------------------------------------------------
// Post-donation receipt + "View My Relic" (a scene cut straight to the
// donated exhibit's own gallery, then the dossier).

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
  goToSceneThen(`${exhibit.galleryId}-main`, () => openDossier(exhibitId));
}

// ---------------------------------------------------------------------------
// Archive index: find an existing exhibit without already knowing which
// gallery holds it (CLAUDE.md: a persistent "Collection"/"Archive" action).

function renderArchiveList() {
  const container = el("archive-list");
  container.innerHTML = "";
  for (const gallery of world.galleries) {
    const exhibits = [...exhibitsById.values()]
      .filter((e) => e.galleryId === gallery.id)
      .sort((a, b) => a.number - b.number);
    if (exhibits.length === 0) continue;

    const group = document.createElement("div");
    group.className = "archive-gallery-group";
    const heading = document.createElement("h3");
    heading.textContent = gallery.name;
    group.appendChild(heading);

    for (const exhibit of exhibits) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "archive-exhibit-row";
      const title = document.createElement("span");
      title.className = "row-title";
      title.textContent = exhibit.title;
      const meta = document.createElement("span");
      meta.className = "row-meta";
      meta.textContent = `#${exhibit.number} · ${exhibit.classification}`;
      row.appendChild(title);
      row.appendChild(meta);
      row.addEventListener("click", () => {
        closeArchive();
        goToSceneThen(`${exhibit.galleryId}-main`, () => openDossier(exhibit.id));
      });
      group.appendChild(row);
    }
    container.appendChild(group);
  }
  if (container.children.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No relics archived yet — be the first to donate one.";
    container.appendChild(empty);
  }
}

function openArchive() {
  renderArchiveList();
  el("archive-gate").hidden = false;
}
function closeArchive() {
  el("archive-gate").hidden = true;
  viewport.focus();
}
el("open-archive").addEventListener("click", openArchive);
el("archive-close").addEventListener("click", closeArchive);

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
  // verdict reads differently from a settled one at a glance.
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
  // The clicked exhibit's own glow stays lit while its dossier is open
  // (CLAUDE.md: "the selected object should remain illuminated while its
  // information is open") — setFocusedObject, not a one-shot hover class,
  // so it survives the mouse leaving the object once the drawer has focus.
  setFocusedObject(`exhibit:${exhibitId}`);
}

function closeDossier() {
  openDossierExhibitId = null;
  el("dossier").hidden = true;
  setFocusedObject(null);
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
    // Restrained: a vote only surfaces a toast when it actually moves the
    // exhibit's overall classification, not on every single vote cast.
    toast(`"${exhibit.title}" is now classified ${exhibit.classification}.`);
  }
}

// ---------------------------------------------------------------------------
// Environmental lore drawer — a short caption for an in-room object that
// isn't a full archival exhibit, opened as the same side-drawer pattern the
// dossier uses rather than a modal covering the scene.

function openLoreCard(title, text, objectId) {
  el("lore-title").textContent = title;
  el("lore-text").textContent = text;
  el("lore-drawer").hidden = false;
  if (objectId) setFocusedObject(objectId);
}
function closeLoreCard() {
  el("lore-drawer").hidden = true;
  if (focusedObjectId?.startsWith("object:")) setFocusedObject(null);
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
// Visitor cameos: a restrained Gothic silhouette per OTHER visitor in this
// scene, standing at one of the scene's own server-defined `visitorAnchors`
// (each carrying a small depth value for parallax — see server/src/world.js)
// rather than anything resembling walkable coordinates or a raw cursor
// position. A visitor's own cameo never renders alongside everyone else's
// (CLAUDE.md: distinguish "you" from others) — "you" is conveyed by the
// whoami line and the topbar, not a cameo of yourself standing in your own
// room. A name only appears on hover/focus, never as a permanent label —
// restrained by default, legible on demand.

// A small seeded PRNG keyed on the visitor's own public key — stable per
// visitor (same anchor assignment/colour/idle-delay on every re-render)
// without needing the server to assign or broadcast a position.
function hashKey(key) {
  let h = 1779033703;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
  return (h ^ (h >>> 16)) >>> 0;
}
function cameoColorFor(publicKey) {
  const hue = hashKey(`hue:${publicKey}`) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

let recentActivityByKey = new Map(); // publicKey -> timestamp, for the activity-pulse cue
let recentFocusByKey = new Map(); // publicKey -> objectId, for "their silhouette turns toward what they're looking at"

// Deterministically distributes however many OTHER visitors are in this
// scene across its fixed anchors, one each, by sorting on each visitor's
// own hashed key rather than arrival order — so which anchor a given
// visitor lands on is stable for them across re-renders, and two visitors
// never collide on the same anchor as long as there are enough anchors
// (CLAUDE.md: "prevent overlap").
function assignAnchors(visitors, anchors) {
  const sorted = [...visitors].sort((a, b) => hashKey(a.publicKey) - hashKey(b.publicKey));
  return sorted.map((v, i) => ({ visitor: v, anchor: anchors[i % anchors.length] }));
}

function renderCameos() {
  const { cameoLayer } = illustrator.activeLayers();
  if (!cameoLayer) return;
  cameoLayer.innerHTML = "";
  const scene = illustrator.currentScene();
  const anchors = scene.visitorAnchors ?? [];
  const visitors = (lastSceneVisitors[currentSceneId] ?? []).filter((v) => v.publicKey !== myPublicKey);
  if (anchors.length === 0) return;

  for (const { visitor, anchor } of assignAnchors(visitors, anchors)) {
    const cameo = document.createElement("div");
    cameo.className = "cameo";
    cameo.dataset.publicKey = visitor.publicKey;
    const recentlyActive = Date.now() - (recentActivityByKey.get(visitor.publicKey) ?? 0) < 1500;
    if (recentlyActive) cameo.classList.add("activity");
    const focusedOn = recentFocusByKey.get(visitor.publicKey);
    if (focusedOn) cameo.classList.add("attending");
    cameo.style.left = `${anchor.x}%`;
    cameo.style.top = `${anchor.y}%`;
    cameo.style.setProperty("--cameo-depth", String(anchor.depth ?? 1));
    cameo.style.setProperty("--cameo-color", cameoColorFor(visitor.publicKey));
    cameo.style.setProperty("--cameo-delay", `${(hashKey(visitor.publicKey) % 50) / 10}s`);
    cameo.tabIndex = 0;
    cameo.setAttribute("role", "img");
    cameo.setAttribute("aria-label", `${visitor.displayName}, another visitor in this room`);

    const silhouette = document.createElement("div");
    silhouette.className = "cameo-silhouette";
    cameo.appendChild(silhouette);

    // The name reveals only on hover/focus (CLAUDE.md: "do not show large
    // name bubbles permanently; reveal the name on hover/focus") — always
    // present in the DOM for a11y/focus, visually hidden otherwise via CSS.
    const name = document.createElement("span");
    name.className = "cameo-name";
    name.textContent = visitor.displayName; // textContent only — never innerHTML
    cameo.appendChild(name);

    cameoLayer.appendChild(cameo);
  }
}

// A small "who else is here" list, reachable without hovering every
// silhouette individually — the brief's "or in a small visitor list"
// alternative to hover-reveal.
function renderVisitorList() {
  const list = el("visitor-list");
  if (!list) return;
  const visitors = (lastSceneVisitors[currentSceneId] ?? []).filter((v) => v.publicKey !== myPublicKey);
  list.innerHTML = "";
  if (visitors.length === 0) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  for (const v of visitors) {
    const chip = document.createElement("span");
    chip.className = "visitor-chip";
    chip.style.setProperty("--cameo-color", cameoColorFor(v.publicKey));
    chip.textContent = v.displayName;
    list.appendChild(chip);
  }
}

// ---------------------------------------------------------------------------
// Realtime: scene-scoped presence (now with visible visitor cameos) + the
// living archive

let eventSource = null;

function connectEvents() {
  eventSource = new EventSource(`/api/events?scene=${encodeURIComponent(currentSceneId)}`);

  let firstHello = true;
  eventSource.addEventListener("hello", async (e) => {
    const { sceneCounts, visitors, yourPublicKey } = JSON.parse(e.data);
    lastSceneCounts = sceneCounts ?? {};
    if (yourPublicKey) myPublicKey = yourPublicKey;
    if (visitors) lastSceneVisitors = { ...lastSceneVisitors, [currentSceneId]: visitors };
    updatePresenceLabel();
    renderCameos();
    renderVisitorList();

    // The very first connection already hydrated from loadExhibits() in
    // boot(); every `hello` after that one means the stream reconnected,
    // during which a donation/account/vote broadcast could have been missed
    // entirely — re-fetching the whole archive here is the no-loss-refresh
    // behaviour the brief asks for.
    if (firstHello) {
      firstHello = false;
      return;
    }
    await resyncExhibits();
  });

  eventSource.addEventListener("scene-presence", (e) => {
    const { sceneId, count, visitors } = JSON.parse(e.data);
    const previous = lastSceneCounts[sceneId] ?? 0;
    lastSceneCounts = { ...lastSceneCounts, [sceneId]: count };
    if (visitors) lastSceneVisitors = { ...lastSceneVisitors, [sceneId]: visitors };
    if (sceneId === currentSceneId) {
      // Restrained: only a genuine increase in this room's own headcount
      // gets a toast, not every scene's count everywhere.
      if (count > previous && previous > 0) toast("Another visitor has entered this room.");
      updatePresenceLabel();
      renderCameos();
      renderVisitorList();
    }
  });

  eventSource.addEventListener("presence-left", () => {
    // A departure already lands as a scene-presence recount for the scene
    // they left — nothing further to do here.
  });

  eventSource.addEventListener("exhibit", (e) => {
    const exhibit = JSON.parse(e.data);
    if (exhibitsById.has(exhibit.id)) return;
    exhibitsById.set(exhibit.id, exhibit);
    refreshInteractiveObjects();
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

  // A restrained activity cue tied to the visitor who caused it — "when
  // another visitor donates, adds an account, or changes a meaningful
  // classification, show an activity cue connected to their visible
  // presence" (CLAUDE.md). The cue is purely visual (a brief pulse on that
  // visitor's own cameo, if they're in view) — the toasts above already
  // narrate the event itself.
  eventSource.addEventListener("activity", (e) => {
    const { publicKey } = JSON.parse(e.data);
    if (!publicKey || publicKey === myPublicKey) return;
    recentActivityByKey.set(publicKey, Date.now());
    renderCameos();
    renderVisitorList();
  });

  // Ephemeral focus broadcast: another visitor in this same room opened or
  // closed an object's lore/dossier. Their cameo pulses/turns ("attending")
  // and the corresponding object briefly glows — a lightweight presence cue,
  // never a chat message, never a stored record (CLAUDE.md-adjacent brief:
  // no new personal information, nothing persisted). The server already
  // scopes this to visitors sharing the sender's own scene, so every event
  // that reaches this client is relevant to the room it's currently in.
  eventSource.addEventListener("focus", (e) => {
    const { publicKey, objectId } = JSON.parse(e.data);
    if (!publicKey || publicKey === myPublicKey) return;
    if (objectId) recentFocusByKey.set(publicKey, objectId);
    else recentFocusByKey.delete(publicKey);
    renderCameos();
    if (objectId) {
      const node = illustrator
        .activeLayers()
        .objectLayer?.querySelector(`[data-object-id="${CSS.escape(objectId)}"]`);
      if (node) {
        node.classList.add("peer-glance");
        window.setTimeout(() => node.classList.remove("peer-glance"), 1400);
      }
    }
  });

  eventSource.onerror = () => {
    // EventSource auto-reconnects; on reconnect the server resends `hello`
    // with current scene counts, and a fresh GET /api/exhibits hydrates
    // anything missed meanwhile.
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

// Reports this visitor's own focus change to the server so other visitors
// in the same room see a cue — debounced client-side on top of the
// server's own rate limit, since a fast hover sweep across several objects
// shouldn't fire one request per object.
let focusPostTimer = null;
function postFocus(objectId) {
  if (focusPostTimer) clearTimeout(focusPostTimer);
  focusPostTimer = setTimeout(() => {
    fetch("/api/presence/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectId }),
    }).catch(() => {
      // transient network blip — this is a purely ephemeral cue, nothing to retry
    });
  }, 150);
}

// ---------------------------------------------------------------------------
// Interactive objects: invisible-until-attended glow regions clipped to the
// actual painted item they represent (a portrait, a bust, a display cabinet,
// the donor counter), never a pill-shaped button floating over the scene's
// centre (CLAUDE.md). Rendered inside the camera's own transformed
// `.scene-room` plane (see world/illustration.js's activeLayers) so an
// object's glow always stays pixel-locked to the art as the camera pans/
// zooms. Room-to-room travel is NOT one of these — see renderCornerNav.

function anyOverlayOpen() {
  return (
    !el("dossier").hidden ||
    !el("donate-gate").hidden ||
    !el("donate-receipt").hidden ||
    !el("archive-gate").hidden ||
    !el("name-gate").hidden ||
    !el("rooms-menu").hidden
  );
}

// The one interactive object currently illuminated — a hover/focus/open
// state, not a one-shot hover class, so it can be set from a keyboard focus
// event or held open for the duration of a dossier/lore drawer (CLAUDE.md:
// "the selected object should remain illuminated while its information is
// open"). `objectId` is a stable per-render key ("object:<id>" for a
// server-defined interactive object, "exhibit:<id>" for an exhibit card).
function setFocusedObject(objectId) {
  if (objectId === focusedObjectId) return;
  focusedObjectId = objectId;
  const { objectLayer } = illustrator.activeLayers();
  if (objectLayer) {
    for (const node of objectLayer.querySelectorAll("[data-object-id]")) {
      node.classList.toggle("lit", node.dataset.objectId === objectId);
    }
  }
  postFocus(objectId);
}

function handleObjectActivate(object) {
  if (anyOverlayOpen() || illustrator.isTransitioning || placement) return;
  if (object.type === "donate") {
    openDonateGate();
    return;
  }
  if (object.type === "lore") {
    openLoreCard(object.label, object.text, `object:${object.id}`);
    return;
  }
  if (object.type === "closeup" && object.targetSceneId) {
    // A click never fires a native DOM `focus` event the way Tab navigation
    // does, so without this, looking closer at a portrait — the single most
    // common interaction in the museum — would never report a focus change
    // at all, and other visitors in the room would never see this
    // visitor's cameo "attend" to it. Broadcast it explicitly before the
    // scene cut away from it.
    setFocusedObject(`object:${object.id}`);
    illustrator.goToScene(object.targetSceneId, { direction: "forward" });
  }
}

// A glow region clipped to an interactive object's own anchor BOX
// (percentages of the illustration) — idle-invisible, a soft illuminated
// outline on hover/focus/when `.lit` (open), never a solid button shape.
function buildObjectGlow(object) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `interactive-object interactive-object-${object.type}`;
  node.dataset.objectId = `object:${object.id}`;
  node.style.left = `${object.anchor.x}%`;
  node.style.top = `${object.anchor.y}%`;
  node.style.width = `${object.anchor.width}%`;
  node.style.height = `${object.anchor.height}%`;
  node.setAttribute("aria-label", object.label);
  node.addEventListener("click", () => handleObjectActivate(object));
  node.addEventListener("focus", () => setFocusedObject(`object:${object.id}`));
  node.addEventListener("blur", () => {
    if (focusedObjectId === `object:${object.id}`) setFocusedObject(null);
  });
  node.addEventListener("mouseenter", () => node.classList.add("hovered"));
  node.addEventListener("mouseleave", () => node.classList.remove("hovered"));
  return node;
}

// A real, persisted exhibit — rendered as its own illuminated display
// object at its claimed slot anchor, not a floating card with a thumbnail/
// title/donor/INSPECT strip. A small identifying label only appears once
// lit (hover/focus/open), matching the "discovered through light and
// attention" standard; the exhibit's still-frame preview renders into the
// dossier/receipt, not pasted onto the object in the room.
function buildExhibitObject(exhibit, gallery, slot) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "interactive-object interactive-object-exhibit";
  node.dataset.objectId = `exhibit:${exhibit.id}`;
  node.style.left = `${slot.x}%`;
  node.style.top = `${slot.z}%`;
  node.style.width = `${slot.width ?? 10}%`;
  node.style.height = `${slot.height ?? 16}%`;
  node.setAttribute("aria-label", `${exhibit.title}, donated by ${exhibit.donorName}. Open dossier.`);

  const label = document.createElement("span");
  label.className = "object-label";
  label.textContent = exhibit.title; // textContent only — never innerHTML
  node.appendChild(label);

  node.addEventListener("click", () => {
    if (anyOverlayOpen() || illustrator.isTransitioning || placement) return;
    openDossier(exhibit.id);
  });
  node.addEventListener("focus", () => setFocusedObject(`exhibit:${exhibit.id}`));
  node.addEventListener("blur", () => {
    if (focusedObjectId === `exhibit:${exhibit.id}` && el("dossier").hidden) setFocusedObject(null);
  });
  node.addEventListener("mouseenter", () => node.classList.add("hovered"));
  node.addEventListener("mouseleave", () => node.classList.remove("hovered"));
  return node;
}

// ---------------------------------------------------------------------------
// Placement-mode anchors: step 4 of the donation workflow. Only the
// gallery's currently-free, server-defined slots glow; clicking one shows a
// ghost preview and the confirm banner (steps 5-7). An arbitrary pixel
// coordinate never reaches the server — the chosen anchor's own `slotId` is
// exactly what `POST /api/exhibits` already validates (CLAUDE.md).
function buildPlacementAnchor(slot, exhibitForm, state) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "placement-anchor";
  node.style.left = `${slot.x}%`;
  node.style.top = `${slot.z}%`;
  node.style.width = `${slot.width ?? 10}%`;
  node.style.height = `${slot.height ?? 16}%`;
  node.setAttribute("aria-label", `Place "${exhibitForm.title}" here`);
  if (state.chosenSlotId === slot.id) {
    node.classList.add("chosen");
    const ghost = document.createElement("span");
    ghost.className = "object-label";
    ghost.textContent = exhibitForm.title;
    node.appendChild(ghost);
  }
  node.addEventListener("click", () => choosePlacementAnchor(slot.id));
  return node;
}

function renderPlacementAnchors(objectLayer, scene) {
  if (!placement || scene.id !== `${placement.exhibitForm.galleryId}-main`) return;
  const gallery = world.galleries.find((g) => g.id === placement.exhibitForm.galleryId);
  const occupied = occupiedSlotIdsForGallery(gallery.id);
  for (const slot of gallery.slots) {
    if (occupied.has(slot.id)) continue; // never offer an already-occupied, or arbitrary, spot
    if (placement.confirming && placement.chosenSlotId !== slot.id) continue; // only the chosen one stays visible while confirming
    objectLayer.appendChild(buildPlacementAnchor(slot, placement.exhibitForm, placement));
  }
}

function refreshInteractiveObjects() {
  const { objectLayer } = illustrator.activeLayers();
  if (!objectLayer) return;
  objectLayer.innerHTML = "";
  const scene = illustrator.currentScene();

  if (placement) {
    renderPlacementAnchors(objectLayer, scene);
  } else {
    for (const object of scene.interactiveObjects) {
      objectLayer.appendChild(buildObjectGlow(object));
    }
    if (scene.kind === "main" && scene.galleryId) {
      const gallery = world.galleries.find((g) => g.id === scene.galleryId);
      const slotById = new Map(gallery.slots.map((s) => [s.id, s]));
      const exhibits = [...exhibitsById.values()].filter((e) => e.galleryId === scene.galleryId);
      for (const exhibit of exhibits) {
        const slot = slotById.get(exhibit.slotId);
        if (!slot) continue;
        objectLayer.appendChild(buildExhibitObject(exhibit, gallery, slot));
      }
    }
  }
  if (focusedObjectId) setFocusedObject(focusedObjectId);

  turnControlsEl.hidden = scene.kind !== "hub";
  el("turn-left").disabled = !scene.turnLeft;
  el("turn-right").disabled = !scene.turnRight;

  renderCornerNav(scene);
  galleryTitleEl.textContent = scene.kind === "hub" ? "" : scene.caption;
}

// ---------------------------------------------------------------------------
// Quiet corner navigation: a compact "enter the next room" control upper-
// left and a "back" control lower-right, replacing a large bubble floated
// over the artwork's centre. Labels only reveal on hover/focus via CSS
// (`.corner-nav-label`), so idle the chrome reads as two small glyphs that
// belong to the museum's own frame.
function renderCornerNav(scene) {
  const forwardBtn = el("nav-forward");
  const backBtn = el("nav-back");
  if (scene.nav?.forward) {
    forwardBtn.hidden = false;
    forwardBtn.querySelector(".corner-nav-label").textContent = scene.nav.forward.label;
    forwardBtn.onclick = () => illustrator.goToScene(scene.nav.forward.targetSceneId, { direction: "forward" });
  } else {
    forwardBtn.hidden = true;
    forwardBtn.onclick = null;
  }
  if (scene.nav?.back) {
    backBtn.hidden = false;
    backBtn.querySelector(".corner-nav-label").textContent = scene.nav.back.label;
    backBtn.onclick = () => illustrator.goToScene(scene.nav.back.targetSceneId, { direction: "back" });
  } else {
    backBtn.hidden = true;
    backBtn.onclick = null;
  }
}

// ---------------------------------------------------------------------------
// Rooms menu: an alternative way to reach any gallery directly without
// turning through the hub one facing at a time.
function renderRoomsMenu() {
  const menu = el("rooms-menu");
  menu.innerHTML = "";
  for (const gallery of world.galleries) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "rooms-menu-item";
    item.role = "menuitem";
    item.textContent = gallery.name;
    item.addEventListener("click", () => {
      closeRoomsMenu();
      illustrator.goToScene(`${gallery.id}-main`, { direction: "forward" });
    });
    menu.appendChild(item);
  }
  const hubItem = document.createElement("button");
  hubItem.type = "button";
  hubItem.className = "rooms-menu-item";
  hubItem.role = "menuitem";
  hubItem.textContent = "Entrance Hall";
  hubItem.addEventListener("click", () => {
    closeRoomsMenu();
    illustrator.goToScene("hall-n", { direction: "back" });
  });
  menu.appendChild(hubItem);
}
function openRoomsMenu() {
  renderRoomsMenu();
  el("rooms-menu").hidden = false;
}
function closeRoomsMenu() {
  el("rooms-menu").hidden = true;
  viewport.focus();
}
el("open-rooms").addEventListener("click", () => {
  if (el("rooms-menu").hidden) openRoomsMenu();
  else closeRoomsMenu();
});

function onSceneChange(scene) {
  currentSceneId = scene.id;
  closeLoreCard();
  refreshInteractiveObjects();
  postPresence(scene.id);
  updatePresenceLabel();
  renderCameos();
  renderVisitorList();
  if (scene.kind === "closeup" && scene.lore) openLoreCard(scene.caption, scene.lore, null);
  if (pendingAfterArrival) {
    const run = pendingAfterArrival;
    pendingAfterArrival = null;
    run();
  }
}

// ---------------------------------------------------------------------------
// Keyboard: Esc closes the topmost UI, cancels placement, or steps back a
// scene; Left/Right pan the camera (or turn at the hub); +/- zoom. There is
// no walkable movement to protect form focus from any more, but the camera
// drag/pan must still be ignored while a form field has focus.

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (placement) cancelPlacement();
    else if (!el("dossier").hidden) closeDossier();
    else if (!el("donate-gate").hidden) closeDonateGate();
    else if (!el("donate-receipt").hidden) closeReceipt();
    else if (!el("archive-gate").hidden) closeArchive();
    else if (!el("rooms-menu").hidden) closeRoomsMenu();
    else if (!el("lore-drawer").hidden) closeLoreCard();
    else illustrator.back();
    return;
  }
  if (isTypingTarget(document.activeElement) || anyOverlayOpen() || illustrator.isTransitioning) return;
  const scene = illustrator.currentScene();
  if (e.code === "ArrowLeft") {
    if (scene.kind === "hub") illustrator.turnLeft();
    else illustrator.camera.panLeft();
  } else if (e.code === "ArrowRight") {
    if (scene.kind === "hub") illustrator.turnRight();
    else illustrator.camera.panRight();
  } else if (e.key === "+" || e.key === "=") {
    illustrator.camera.zoomIn();
  } else if (e.key === "-" || e.key === "_") {
    illustrator.camera.zoomOut();
  }
});

el("turn-left").addEventListener("click", () => illustrator.turnLeft());
el("turn-right").addEventListener("click", () => illustrator.turnRight());

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  myIdentity = await fetchMe();
  updateWhoami();

  await loadWorld();
  await loadExhibits();

  illustrator = createIllustrationController({
    layerA: el("scene-layer-a"),
    layerB: el("scene-layer-b"),
    world,
    onSceneChange,
  });
  currentSceneId = illustrator.currentScene().id;

  connectEvents();
  refreshInteractiveObjects();
  updatePresenceLabel();
  postPresence(currentSceneId);

  if (!hasNamedBefore()) {
    el("name-gate").hidden = false;
    el("name-input").focus();
  } else {
    viewport.focus();
  }
}

// Dev-only introspection hook, harmless in production (no state mutation,
// just reads) — handy for manual QA without needing devtools.
window.__museumDebug = () => ({
  sceneId: currentSceneId,
  exhibitCount: exhibitsById.size,
  sceneCounts: lastSceneCounts,
  sceneVisitors: lastSceneVisitors,
  myPublicKey,
});

boot().catch((err) => {
  console.error("failed to start The Cursed Museum", err);
  toast("Something went wrong loading the museum — try reloading.");
});
