import { renderArtifactPreview } from "./world/artifacts.js";
import { createIllustrationController } from "./world/illustration.js";

const NAME_STORAGE_KEY = "cursedMuseumNamed";

const el = (id) => document.getElementById(id);
const viewport = el("viewport");
const hotspotLayer = el("hotspot-layer");
const cameoLayer = el("cameo-layer");
const turnControlsEl = el("turn-controls");
const presenceEl = el("presence");
const whoamiEl = el("whoami");
const galleryTitleEl = el("gallery-title");
const galleryHintEl = el("gallery-hint");
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
  refreshHotspots();
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
        opt.textContent = `Slot ${Number(s.id.split("_").slice(-1)[0]) + 1}`;
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

el("open-donate").addEventListener("click", openDonateGate);
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
  refreshHotspots();
  closeDonateGate();
  form.reset();
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
  pendingAfterArrival = () => openDossier(exhibitId);
  illustrator.goToScene(`${exhibit.galleryId}-main`);
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
        pendingAfterArrival = () => openDossier(exhibit.id);
        illustrator.goToScene(`${exhibit.galleryId}-main`);
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
    // Restrained: a vote only surfaces a toast when it actually moves the
    // exhibit's overall classification, not on every single vote cast.
    toast(`"${exhibit.title}" is now classified ${exhibit.classification}.`);
  }
}

// ---------------------------------------------------------------------------
// Environmental lore popover

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
// Visitor cameos: a small Gothic silhouette/medallion per OTHER visitor in
// this scene (restored visible presence — see docs/adr/0003-scene-
// exploration.md's addendum), positioned at a few fixed scene-relative spots
// rather than anything resembling walkable coordinates. A visitor's own
// cameo never renders alongside everyone else's (CLAUDE.md: distinguish
// "you" from others) — "you" is conveyed by the whoami line and the topbar,
// not a cameo of yourself standing in your own room.

const CAMEO_SPOTS = [
  { x: 22, z: 50 },
  { x: 78, z: 52 },
  { x: 38, z: 42 },
  { x: 64, z: 44 },
  { x: 50, z: 36 },
  { x: 12, z: 60 },
];

// A small seeded PRNG keyed on the visitor's own public key — stable per
// visitor (same spot/colour/idle-delay on every re-render) without needing
// the server to assign or broadcast a position.
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

function renderCameos() {
  cameoLayer.innerHTML = "";
  const visitors = (lastSceneVisitors[currentSceneId] ?? []).filter((v) => v.publicKey !== myPublicKey);
  visitors.forEach((visitor, i) => {
    const spot = CAMEO_SPOTS[i % CAMEO_SPOTS.length];
    const cameo = document.createElement("div");
    cameo.className = "cameo";
    const recentlyActive = Date.now() - (recentActivityByKey.get(visitor.publicKey) ?? 0) < 1500;
    if (recentlyActive) cameo.classList.add("activity");
    cameo.style.left = `${spot.x}%`;
    cameo.style.top = `${spot.z}%`;
    cameo.style.setProperty("--cameo-color", cameoColorFor(visitor.publicKey));
    cameo.style.setProperty("--cameo-delay", `${(hashKey(visitor.publicKey) % 50) / 10}s`);

    const medallion = document.createElement("div");
    medallion.className = "cameo-medallion";
    cameo.appendChild(medallion);

    const name = document.createElement("span");
    name.className = "cameo-name";
    name.textContent = visitor.displayName; // textContent only — never innerHTML
    cameo.appendChild(name);

    cameoLayer.appendChild(cameo);
  });
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

// ---------------------------------------------------------------------------
// Hotspot + exhibit-card overlay: real, focusable <button>s positioned as
// plain percentage anchors over the current illustrated scene (no 3D
// projection any more — see world/illustration.js). This is the entire
// interaction surface: door/closeup/back/lore hotspots, every real
// persisted exhibit as a dimensional Gothic card, and a small number of
// clearly non-interactive decorative frames when a gallery has few
// donations yet.

let hoveredExhibitId = null;

function anyOverlayOpen() {
  return (
    !el("dossier").hidden ||
    !el("donate-gate").hidden ||
    !el("donate-receipt").hidden ||
    !el("archive-gate").hidden ||
    !el("name-gate").hidden
  );
}

function handleHotspotActivate(hotspot) {
  if (anyOverlayOpen() || illustrator.isTransitioning) return;
  if (hotspot.type === "donate") {
    openDonateGate();
    return;
  }
  if (hotspot.type === "lore") {
    openLoreCard(hotspot.label, hotspot.text);
    return;
  }
  // door / closeup / back all resolve to a scene cut.
  if (hotspot.targetSceneId) {
    illustrator.goToScene(hotspot.targetSceneId, { direction: hotspot.type === "back" ? "back" : "forward" });
  }
}

function setHoveredExhibit(exhibitId) {
  hoveredExhibitId = exhibitId;
  for (const card of hotspotLayer.querySelectorAll(".exhibit-card")) {
    card.classList.toggle("quiet", exhibitId !== null && card.dataset.exhibitId !== exhibitId);
  }
}

function buildExhibitCard(exhibit, gallery, x, z, tiltSeed) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "exhibit-card";
  card.dataset.exhibitId = exhibit.id;
  card.style.left = `${x}%`;
  card.style.top = `${z}%`;
  card.style.setProperty("--card-tilt", `${((tiltSeed % 7) - 3)}deg`);
  card.setAttribute("aria-label", `${exhibit.title}, donated by ${exhibit.donorName}. Open dossier.`);

  const preview = document.createElement("canvas");
  preview.className = "card-preview";
  preview.width = 160;
  preview.height = 120;
  card.appendChild(preview);

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = exhibit.title;
  card.appendChild(title);

  const donor = document.createElement("span");
  donor.className = "card-donor";
  donor.textContent = `Donated by ${exhibit.donorName}`;
  card.appendChild(donor);

  const affordance = document.createElement("span");
  affordance.className = "card-affordance";
  affordance.textContent = "Inspect";
  card.appendChild(affordance);

  card.addEventListener("mouseenter", () => setHoveredExhibit(exhibit.id));
  card.addEventListener("mouseleave", () => setHoveredExhibit(null));
  card.addEventListener("focus", () => setHoveredExhibit(exhibit.id));
  card.addEventListener("blur", () => setHoveredExhibit(null));
  card.addEventListener("click", () => {
    if (anyOverlayOpen() || illustrator.isTransitioning) return;
    openDossier(exhibit.id);
  });

  // refreshHotspots() rebuilds the hotspot layer's DOM from scratch on every
  // call, so this canvas is always freshly created — it needs its still
  // frame painted every time regardless of whether this exhibit id has been
  // seen before; the render is deterministic (seeded on exhibit id) so a
  // repeated render always produces the same frame.
  renderArtifactPreview(preview, {
    category: exhibit.category,
    subtype: exhibit.subtype,
    accent: gallery?.accent ?? "#88653d",
    exhibitId: exhibit.id,
    title: exhibit.title,
    donorName: exhibit.donorName,
  });

  return card;
}

// A small, clearly non-interactive decorative frame — establishes density
// in a gallery with few real donations without pretending to be a persisted
// exhibit (never a fake dossier target).
function buildDecorativeFrame(x, z) {
  const div = document.createElement("div");
  div.className = "decorative-frame";
  div.style.left = `${x}%`;
  div.style.top = `${z}%`;
  div.setAttribute("aria-hidden", "true");
  return div;
}

function refreshHotspots() {
  hotspotLayer.innerHTML = "";
  const scene = illustrator.currentScene();

  for (const hotspot of scene.hotspots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hotspot hotspot-${hotspot.type}`;
    button.textContent = hotspot.label;
    button.style.left = `${hotspot.anchor.x}%`;
    button.style.top = `${hotspot.anchor.z}%`;
    button.addEventListener("click", () => handleHotspotActivate(hotspot));
    hotspotLayer.appendChild(button);
  }

  // Every donated exhibit in this gallery's own main scene is a dimensional
  // exhibit card, directly inspectable.
  if (scene.kind === "main" && scene.galleryId) {
    const gallery = world.galleries.find((g) => g.id === scene.galleryId);
    const slotById = new Map(gallery.slots.map((s) => [s.id, s]));
    const exhibits = [...exhibitsById.values()].filter((e) => e.galleryId === scene.galleryId);
    let seed = 0;
    for (const exhibit of exhibits) {
      const slot = slotById.get(exhibit.slotId);
      if (!slot) continue;
      hotspotLayer.appendChild(buildExhibitCard(exhibit, gallery, slot.x, slot.z, seed++));
    }
    // Decorative-only frames fill the remaining free slots so a gallery with
    // few real donations still reads as curated rather than sparse — never
    // more than the slots actually left over, and never clickable.
    const occupiedSlotIds = new Set(exhibits.map((e) => e.slotId));
    for (const slot of gallery.slots) {
      if (occupiedSlotIds.has(slot.id)) continue;
      hotspotLayer.appendChild(buildDecorativeFrame(slot.x, slot.z));
    }
  }

  turnControlsEl.hidden = scene.kind !== "hub";
  el("turn-left").disabled = !scene.turnLeft;
  el("turn-right").disabled = !scene.turnRight;

  galleryTitleEl.textContent = scene.caption;
  galleryHintEl.textContent =
    scene.kind === "hub"
      ? "Click a glowing doorway to enter a gallery, or Donate a Relic above."
      : scene.kind === "closeup"
        ? "A closer look. Click back to return to the gallery."
        : "Click a framed exhibit to inspect it.";
}

function onSceneChange(scene) {
  currentSceneId = scene.id;
  closeLoreCard();
  refreshHotspots();
  postPresence(scene.id);
  updatePresenceLabel();
  renderCameos();
  if (scene.kind === "closeup" && scene.lore) openLoreCard(scene.caption, scene.lore);
  if (pendingAfterArrival) {
    const run = pendingAfterArrival;
    pendingAfterArrival = null;
    run();
  }
}

// ---------------------------------------------------------------------------
// Keyboard: Esc closes the topmost UI or steps back a scene; arrow keys turn
// at the hub. There is no movement to protect focus from any more.

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
    else if (!el("archive-gate").hidden) closeArchive();
    else if (!el("lore-card").hidden) closeLoreCard();
    else illustrator.back();
    return;
  }
  if (isTypingTarget(document.activeElement) || anyOverlayOpen() || illustrator.isTransitioning) return;
  if (e.code === "ArrowLeft") illustrator.turnLeft();
  else if (e.code === "ArrowRight") illustrator.turnRight();
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
  refreshHotspots();
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
