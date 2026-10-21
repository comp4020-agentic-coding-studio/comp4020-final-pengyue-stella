import { renderArtifactObject } from "./world/artifacts.js";
import { createIllustrationController } from "./world/illustration.js";
import { createAmbientSoundscape } from "./world/ambient.js";
import { pointInShape, shapeBounds, snapIntoShape, surfaceUvFromPoint, surfacePointFromUv, surfaceCentroidUv, expandShape } from "./world/geometry.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const NAME_STORAGE_KEY = "cursedMuseumNamed";

const el = (id) => document.getElementById(id);
const viewport = el("viewport");
const presenceEl = el("presence");
const whoamiEl = el("whoami");
const galleryTitleEl = el("gallery-title");
const toastsEl = el("toasts");

let myIdentity = null;
let myPublicKey = null;
let world = null;
let relicPresets = []; // the curated donated-relic visual catalog — see server/src/relic-presets.js
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
const ambient = createAmbientSoundscape(); // see world/ambient.js — never started before a real click

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

async function loadRelicPresets() {
  const res = await fetch("/api/relic-presets");
  const { presets } = await res.json();
  relicPresets = presets;
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

// The donor's chosen curated visual id, or null for "Classic" (the legacy
// procedural look) — kept outside the form's own native fields since a
// radio-grid of image tiles isn't a native form control the submit handler
// can read via `form.someField.value` the way the plain <select>s are.
let selectedVisualId = null;

const CLASSIC_VISUAL_ID = null;

function populateDonateForm() {
  const gallerySelect = el("donate-gallery");
  const subtypeSelect = el("donate-subtype");
  const subtypeLabel = el("donate-subtype-label");
  const visualGrid = el("donate-visual-grid");
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

  function selectVisual(visualId, subtype) {
    selectedVisualId = visualId;
    subtypeSelect.value = subtype;
    for (const tile of visualGrid.querySelectorAll(".visual-preset-tile")) {
      tile.setAttribute("aria-checked", tile.dataset.visualId === String(visualId) ? "true" : "false");
    }
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

    // The visual picker: every curated preset for this gallery's category,
    // plus a trailing "Classic" tile that falls back to the old procedural
    // model and lets the donor freely pick any subtype via the select below.
    visualGrid.innerHTML = "";
    const presetsForGallery = relicPresets.filter((p) => p.category === gallery?.category);
    for (const preset of presetsForGallery) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "visual-preset-tile";
      tile.setAttribute("role", "radio");
      tile.dataset.visualId = preset.id;
      const img = document.createElement("img");
      img.src = preset.assetPath;
      img.alt = preset.name;
      tile.appendChild(img);
      const name = document.createElement("span");
      name.className = "visual-preset-name";
      name.textContent = preset.name;
      tile.appendChild(name);
      tile.addEventListener("click", () => {
        selectVisual(preset.id, preset.subtype);
        subtypeSelect.hidden = true;
        subtypeLabel.hidden = true;
      });
      visualGrid.appendChild(tile);
    }
    const classicTile = document.createElement("button");
    classicTile.type = "button";
    classicTile.className = "visual-preset-tile";
    classicTile.setAttribute("role", "radio");
    classicTile.dataset.visualId = "null";
    const swatch = document.createElement("span");
    swatch.className = "visual-preset-swatch";
    swatch.textContent = "Classic";
    classicTile.appendChild(swatch);
    const classicName = document.createElement("span");
    classicName.className = "visual-preset-name";
    classicName.textContent = "Choose a type below";
    classicTile.appendChild(classicName);
    classicTile.addEventListener("click", () => {
      selectVisual(CLASSIC_VISUAL_ID, subtypeSelect.value);
      subtypeSelect.hidden = false;
      subtypeLabel.hidden = false;
    });
    visualGrid.appendChild(classicTile);

    // Default to the gallery's first curated preset if it has one, so a
    // donor sees an integrated illustrated relic by default rather than
    // having to discover the picker; "Classic" otherwise.
    if (presetsForGallery.length > 0) {
      selectVisual(presetsForGallery[0].id, presetsForGallery[0].subtype);
      subtypeSelect.hidden = true;
      subtypeLabel.hidden = true;
    } else {
      selectVisual(CLASSIC_VISUAL_ID, subtypeSelect.value);
      subtypeSelect.hidden = false;
      subtypeLabel.hidden = false;
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
    visualId: selectedVisualId,
  };
  closeDonateGate();
  startPlacement(exhibitForm);
});

// ---------------------------------------------------------------------------
// Surface-aware free relic placement (steps 3-13 of the donation workflow,
// replacing the old fixed-box "click a dashed rectangle" model). Entering
// placement mode navigates to the chosen gallery's main scene; only the
// real, server-defined surfaces compatible with the chosen relic's subtype
// glow (renderPlacementSurfaces, via refreshInteractiveObjects while
// `placement` is active) — a painting is never offered a floor/carpet
// surface, and no incompatible or arbitrary spot is ever shown. Dragging the
// relic's own translucent preview within a surface snaps it gently to a
// valid point (snapIntoShape); the server still independently re-validates
// every field of the final placement (gallery/surface/compatibility/point-
// in-polygon/scale/collision) before persisting it — the client-side
// filtering here is a visitor-facing convenience, never the actual
// authority CLAUDE.md requires.
//
// `placement.slotId` is chosen automatically (the gallery's own first free
// display slot) rather than shown to the visitor: it still backs the
// display-slot capacity bookkeeping server-side (so "no free display spot"
// stays a real, finite constraint), but the *visual* position a visitor
// actually controls is entirely the surfaceId/u/v the drag interaction
// below produces.

function startPlacement(exhibitForm) {
  const gallery = world.galleries.find((g) => g.id === exhibitForm.galleryId);
  const occupied = occupiedSlotIdsForGallery(gallery.id);
  const slot = gallery.slots.find((s) => !occupied.has(s.id));
  if (!slot) {
    toast("No free display spot in this gallery right now — try another gallery.");
    return;
  }
  placement = {
    exhibitForm,
    slotId: slot.id,
    surfaceId: null,
    point: null, // { x, y } in the scene's own viewBox pixel units, once a surface is chosen
  };
  el("placement-title").textContent = exhibitForm.title;
  el("placement-banner").hidden = false;
  el("placement-confirm-btn").disabled = true;
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
  refreshInteractiveObjects();
  viewport.focus();
}
el("placement-cancel").addEventListener("click", cancelPlacement);

el("placement-confirm-btn").addEventListener("click", async () => {
  if (!placement?.surfaceId || !placement.point) return;
  const { exhibitForm, slotId, surfaceId, point } = placement;
  const gallery = world.galleries.find((g) => g.id === exhibitForm.galleryId);
  const surface = gallery.placementSurfaces.find((s) => s.id === surfaceId);
  const { u, v } = surfaceUvFromPoint(surface, point.x, point.y);
  const res = await fetch("/api/exhibits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...exhibitForm, slotId, surfaceId, u, v }),
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.error ?? "Could not place that relic — it may have just been taken.");
    refreshInteractiveObjects();
    return;
  }
  exhibitsById.set(data.exhibit.id, data.exhibit);
  // Step 12: remove every placement guide immediately on confirmation —
  // clearing `placement` and re-rendering drops the surface glows and the
  // drag preview in the same stroke, leaving only the real, persisted relic
  // (rendered by the normal exhibit path) integrated into the scene.
  placement = null;
  el("placement-banner").hidden = true;
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

  renderRelicVisual(el("receipt-preview"), {
    visualId: exhibit.visualId,
    category: exhibit.category,
    subtype: exhibit.subtype,
    accent: gallery?.accent ?? "#88653d",
    exhibitId: exhibit.id,
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

// A stable CSS hook per classification value, so each status gets its own
// restrained accent colour without a string-matched style anywhere else.
function statusSlug(classification) {
  return classification.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

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

      // Every row shares exactly the same three-column structure (number /
      // title / status) regardless of title length, so the catalogue reads
      // as one stable table rather than rows that stretch/shrink with their
      // own content. The gallery name is NOT repeated here — it's already
      // the group heading directly above every row in this group, and a
      // fourth "gallery" column was exactly what squeezed the title column
      // down to collapsed/invisible at the panel's own width.
      const number = document.createElement("span");
      number.className = "row-number";
      number.textContent = `#${String(exhibit.number).padStart(3, "0")}`;

      const title = document.createElement("span");
      title.className = "row-title";
      title.textContent = exhibit.title; // textContent only — never innerHTML
      title.title = exhibit.title; // native tooltip carries the full title when the visible text truncates

      const status = document.createElement("span");
      status.className = `row-status row-status-${statusSlug(exhibit.classification)}`;
      status.textContent = exhibit.classification;

      row.append(number, title, status);
      row.setAttribute("aria-label", `${exhibit.title}, ${exhibit.classification}. Open dossier.`);
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
// Ambient sound: a small procedural soundscape (world/ambient.js), gated
// strictly behind this click so the AudioContext is never constructed
// before a real user gesture — a visitor who had it on in a previous visit
// is not resumed automatically on load (that would mean starting audio
// without a fresh gesture); the toggle's visual state always matches
// whether audio is actually playing right now, never a stale preference,
// so a screen reader never announces "on" for silence. The preference is
// still remembered (ambient.wasPreferredOn) purely so a future on/off
// default could use it without ever auto-playing.
function updateSoundToggleUi(on) {
  const btn = el("sound-toggle");
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "Ambient sound is on. Click to turn off." : "Ambient sound is off. Click to turn on.");
  btn.querySelector("span").textContent = on ? "\u{1F50A}" : "\u{1F507}";
}
el("sound-toggle").addEventListener("click", () => {
  const on = ambient.toggle();
  updateSoundToggleUi(on);
  if (on) ambient.setGallery(illustrator?.currentScene()?.galleryId ?? null);
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
    renderRelicVisual(el("dossier-preview"), {
      visualId: exhibit.visualId,
      category: exhibit.category,
      subtype: exhibit.subtype,
      accent: gallery?.accent ?? "#88653d",
      exhibitId: exhibit.id,
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
  if ((object.type === "closeup" || object.type === "portal") && object.targetSceneId) {
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

// ---------------------------------------------------------------------------
// Object-shaped hotspots: every interactive object/exhibit renders as a real
// SVG shape (path/polygon/ellipse) traced to the actual painted item, inside
// the SVG object layer that shares the camera-driven `.scene-room`
// transform — never an {x,y,width,height} rectangle. `visualShape` is what
// actually draws (the exact traced silhouette, clipped from a brightened
// copy of the scene art so the highlight reads as "this object is lit," not
// a glowing outline floating over it); `hitShape` (optionally padded larger
// via `hitPadding`) is what the invisible, slightly bigger `<rect>`-free hit
// region uses for the actual pointer/focus target, so a comfortable touch
// target never visually enlarges the glow.

function svgShapeNode(shape) {
  if (shape.type === "ellipse") {
    const node = document.createElementNS(SVG_NS, "ellipse");
    node.setAttribute("cx", shape.cx);
    node.setAttribute("cy", shape.cy);
    node.setAttribute("rx", shape.rx);
    node.setAttribute("ry", shape.ry);
    return node;
  }
  // polygon and path-with-bbox both render as a <polygon> here (no object in
  // this world currently authors a raw `d` path — see server/src/world.js's
  // own comment on why `path` stays in the schema regardless).
  const node = document.createElementNS(SVG_NS, "polygon");
  node.setAttribute("points", shape.points.map(([x, y]) => `${x},${y}`).join(" "));
  return node;
}

// A unique <clipPath> id per object/exhibit, scoped to this document — used
// to clip a brightened duplicate of the scene art to exactly this object's
// traced silhouette for the "the actual object lights up" treatment (see
// `.object-clip-art` in styles.css), rather than a glow that floats over a
// bounding box.
let clipIdCounter = 0;
function nextClipId() {
  clipIdCounter += 1;
  return `object-clip-${clipIdCounter}`;
}

// Builds one focusable, semantic hotspot: a <g role="button"> containing an
// invisible hit-shape (the actual click/tap/focus target, grown by
// `hitPadding`) and a clip-art brightening treatment that only shows through
// the exact visual silhouette on hover/focus/`.lit`. `onActivate` fires on
// click, Enter and Space; camera-drag gestures never reach here because the
// camera only claims pointer capture once real drag movement is confirmed
// (see world/camera.js), so a stationary click/tap always resolves here.
function viewBoxSize(viewBoxStr) {
  const parts = (viewBoxStr ?? "0 0 1672 941").split(/\s+/).map(Number);
  return { width: parts[2] ?? 1672, height: parts[3] ?? 941 };
}

function buildShapeHotspot({ id, label, shape, hitPadding = 0, className, sceneImageKey }) {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", `interactive-object ${className ?? ""}`.trim());
  g.setAttribute("tabindex", "0");
  g.setAttribute("role", "button");
  g.setAttribute("aria-label", label);
  g.dataset.objectId = id;

  const hitShape = hitPadding ? expandShape(shape, hitPadding) : shape;
  const hit = svgShapeNode(hitShape);
  hit.setAttribute("class", "object-hit");
  g.appendChild(hit);

  // The lit/hover/focus treatment: a brightened duplicate of this scene's
  // own art, clipped to the object's exact traced silhouette — the object
  // itself appears to brighten, never a glow floating over a box. Falls
  // back to a plain silhouette fill if the scene's image key isn't known
  // (never the case in practice, but keeps this resilient).
  const clipId = nextClipId();
  const defs = document.createElementNS(SVG_NS, "defs");
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", clipId);
  clipPath.appendChild(svgShapeNode(shape));
  defs.appendChild(clipPath);
  g.appendChild(defs);

  const glowArt = document.createElementNS(SVG_NS, "image");
  glowArt.setAttribute("class", "object-clip-art");
  glowArt.setAttributeNS("http://www.w3.org/1999/xlink", "href", sceneImageKey);
  glowArt.setAttribute("href", sceneImageKey);
  // The <image> must cover the whole scene at its own native viewBox size
  // (the same `shape.viewBox` every object in this scene shares) so the
  // clip reveals the correct region of it — positioned at the scene's own
  // origin regardless of this object's own bounds, which only matter for
  // the clip shape itself. `preserveAspectRatio="xMidYMid slice"` matches
  // the art layer's own `background-size: cover` crop, so the clipped
  // region lines up with the painted item exactly as the base art does.
  const { width, height } = viewBoxSize(shape.viewBox);
  glowArt.setAttribute("x", "0");
  glowArt.setAttribute("y", "0");
  glowArt.setAttribute("width", String(width));
  glowArt.setAttribute("height", String(height));
  glowArt.setAttribute("clip-path", `url(#${clipId})`);
  glowArt.setAttribute("preserveAspectRatio", "xMidYMid slice");
  g.appendChild(glowArt);

  return { node: g, bounds: shapeBounds(shape) };
}

function attachHotspotBehaviour(node, { onActivate, objectId }) {
  const activate = () => onActivate();
  node.addEventListener("click", activate);
  node.addEventListener("keydown", (e) => {
    if (e.code === "Enter" || e.code === "Space") {
      e.preventDefault();
      activate();
    }
  });
  node.addEventListener("focus", () => setFocusedObject(objectId));
  node.addEventListener("blur", () => {
    if (focusedObjectId === objectId) setFocusedObject(null);
  });
  node.addEventListener("mouseenter", () => node.classList.add("hovered"));
  node.addEventListener("mouseleave", () => node.classList.remove("hovered"));
}

// ---------------------------------------------------------------------------
// Curated relic visuals: a real illustrated image asset (see
// server/src/relic-presets.js) replaces the low-detail procedural Three.js
// model as a donated exhibit's rendered appearance whenever one was chosen
// at donation time. An exhibit with no visualId (every exhibit donated
// before this catalog existed) still falls back to the exact same
// procedural `renderArtifactObject` path as before — this is the ONLY
// thing that path is still used for in-room; it's untouched otherwise.

function presetById(visualId) {
  return relicPresets.find((p) => p.id === visualId);
}

// Fills `container` (a plain DOM node, not necessarily an SVG one — used
// inside a <foreignObject> both here and in the placement preview) with
// either the curated image (object-fit: contain, so the asset's own aspect
// ratio is always preserved and it is never stretched to fill a square
// footprint) or, lacking a visualId, the legacy procedural canvas.
function renderRelicVisual(container, { visualId, category, subtype, accent, exhibitId }) {
  container.innerHTML = "";
  const preset = visualId ? presetById(visualId) : null;
  if (preset) {
    const img = document.createElement("img");
    img.src = preset.assetPath;
    img.alt = "";
    img.className = `relic-visual-img relic-visual-${preset.anchor}`;
    container.appendChild(img);
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.appendChild(canvas);
  renderArtifactObject(canvas, { category, subtype, accent, exhibitId });
}

function sceneImageUrl(scene) {
  const IMAGE_FILES = {
    hall: "entrance-hall-v2.png",
    portraits: "portraits.webp",
    memento: "memento.webp",
    specimen: "specimen.webp",
    childhood: "childhood.webp",
    "portrait-reference": "portrait-reference.webp",
    "cabinet-reference": "cabinet-reference.webp",
  };
  return `/assets/gallery-scenes/${IMAGE_FILES[scene.image] ?? IMAGE_FILES.hall}`;
}

// A built-in scene object (chandelier, guardian statue, portal door, etc.) —
// traced to the real painted item, never a rectangle.
function buildObjectGlow(object, scene) {
  const objectId = `object:${object.id}`;
  const { node } = buildShapeHotspot({
    id: objectId,
    label: object.label,
    shape: object.shape,
    hitPadding: object.hitPadding ?? 0,
    className: `interactive-object-${object.type}`,
    sceneImageKey: sceneImageUrl(scene),
  });
  attachHotspotBehaviour(node, { objectId, onActivate: () => handleObjectActivate(object) });

  // A short label only ever appears near the object on hover/focus — never
  // a permanent floating caption (CLAUDE.md-aligned brief).
  const labelNode = svgLabelFor(object.shape, object.label);
  node.appendChild(labelNode);

  return node;
}

// A real, persisted exhibit — rendered as its own illuminated silhouette at
// its actual placed position (CLAUDE.md-aligned brief: an object
// representation integrated into the scene, not an oversized floating
// card). The relic's own procedural model renders via a transparent
// <foreignObject><canvas> positioned at the exhibit's placement point,
// scaled by its own `scale`; title/donor text lives only in the dossier, a
// short label appearing near it on hover/focus like any other object.
function buildExhibitObject(exhibit, gallery, scene) {
  const surface = gallery.placementSurfaces.find((s) => s.id === exhibit.placement?.surfaceId);
  if (!surface || !exhibit.placement) return null;
  const point = surfacePointFromUv(surface, exhibit.placement.u, exhibit.placement.v);
  const scale = exhibit.placement.scale ?? 1;

  const objectId = `exhibit:${exhibit.id}`;
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "interactive-object interactive-object-exhibit");
  g.setAttribute("tabindex", "0");
  g.setAttribute("role", "button");
  g.setAttribute("aria-label", `${exhibit.title}, donated by ${exhibit.donorName}. Open dossier.`);
  g.dataset.objectId = objectId;

  // A footprint sized relative to its surface's own extent, scaled by the
  // placement's own `scale` — large enough to be a comfortable click
  // target, small enough to read as sitting ON the surface rather than
  // covering it. A curated preset keeps its own real aspect ratio (never
  // stretched — CLAUDE.md-aligned brief) rather than forcing a square
  // footprint the way the old procedural canvas used; a "resting" preset's
  // own visual base sits at the surface point (like an object standing on a
  // shelf), while a "wall" preset centres on it (like a hung frame).
  const b = shapeBounds(surface.shape);
  const preset = exhibit.visualId ? presetById(exhibit.visualId) : null;
  const baseSize = Math.max(60, Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.55) * scale;
  const aspect = preset ? preset.naturalWidth / preset.naturalHeight : 1;
  const width = aspect >= 1 ? baseSize : baseSize * aspect;
  const height = aspect >= 1 ? baseSize / aspect : baseSize;
  const half = Math.max(width, height) / 2;

  const fo = document.createElementNS(SVG_NS, "foreignObject");
  fo.setAttribute("x", String(point.x - width / 2));
  fo.setAttribute("y", String(preset?.anchor === "resting" ? point.y - height : point.y - height / 2));
  fo.setAttribute("width", String(width));
  fo.setAttribute("height", String(height));
  fo.setAttribute("class", "object-hit");
  const container = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  container.style.width = "100%";
  container.style.height = "100%";
  fo.appendChild(container);
  g.appendChild(fo);
  renderRelicVisual(container, {
    visualId: exhibit.visualId,
    category: exhibit.category,
    subtype: exhibit.subtype,
    accent: gallery.accent,
    exhibitId: exhibit.id,
  });

  const labelShape = { type: "ellipse", cx: point.x, cy: point.y, rx: half, ry: half };
  g.appendChild(svgLabelFor(labelShape, exhibit.title));

  attachHotspotBehaviour(g, {
    objectId,
    onActivate: () => {
      if (anyOverlayOpen() || illustrator.isTransitioning || placement) return;
      openDossier(exhibit.id);
    },
  });
  return g;
}

// A small label, positioned just below the object's own bounds in viewBox
// units, revealed only via CSS on hover/focus/`.lit` — never a permanently
// visible caption.
function svgLabelFor(shape, text) {
  const b = shapeBounds(shape);
  const fo = document.createElementNS(SVG_NS, "foreignObject");
  const cx = (b.minX + b.maxX) / 2;
  const width = Math.max(140, b.maxX - b.minX);
  fo.setAttribute("x", String(cx - width / 2));
  fo.setAttribute("y", String(b.maxY + 6));
  fo.setAttribute("width", String(width));
  fo.setAttribute("height", "40");
  fo.setAttribute("class", "object-label-wrap");
  const span = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
  span.className = "object-label";
  span.textContent = text; // textContent only — never innerHTML
  fo.appendChild(span);
  return fo;
}

// ---------------------------------------------------------------------------
// Placement mode: a translucent, pointer-following relic preview the
// visitor drags freely within whichever compatible surface it's currently
// over, snapping gently to a valid point (snapIntoShape) rather than a grid
// of fixed anchors. Only surfaces whose `allowedRelicTypes` include the
// chosen subtype are ever shown — a painting is never offered a floor/
// carpet surface, matching the compatibility matrix server/src/world.js
// enforces again server-side.

function renderPlacementSurfaces(objectLayer, scene) {
  if (!placement || scene.id !== `${placement.exhibitForm.galleryId}-main`) return;
  const gallery = world.galleries.find((g) => g.id === placement.exhibitForm.galleryId);
  const subtype = placement.exhibitForm.subtype;
  const compatible = gallery.placementSurfaces.filter((s) => s.allowedRelicTypes.includes(subtype));

  for (const surface of compatible) {
    const node = svgShapeNode(surface.shape);
    node.setAttribute("class", `placement-surface${placement.surfaceId === surface.id ? " chosen" : ""}`);
    node.dataset.surfaceId = surface.id;
    objectLayer.appendChild(node);
  }

  // The translucent, draggable relic preview — rendered once at the chosen
  // point (defaulting to the first compatible surface's own centroid the
  // first time placement mode reaches this scene), via the same transparent
  // object renderer the final integrated relic uses, so what the visitor
  // drags is a true preview of the real thing, never a generic ghost box.
  if (!placement.surfaceId && compatible.length > 0) {
    const first = compatible[0];
    const { u, v } = surfaceCentroidUv(first);
    const point = surfacePointFromUv(first, u, v);
    placement.surfaceId = first.id;
    placement.point = point;
  }
  if (!placement.surfaceId) return;

  const surface = gallery.placementSurfaces.find((s) => s.id === placement.surfaceId);
  const defaultUv = surfaceCentroidUv(surface);
  const point = placement.point ?? surfacePointFromUv(surface, defaultUv.u, defaultUv.v);
  const b = shapeBounds(surface.shape);
  // The exact same curated preset (if one was chosen) the final placed relic
  // will render with, at the exact same aspect ratio — a drag preview is
  // never a generic ghost box, and never a different asset than the one
  // that actually gets persisted.
  const preset = placement.exhibitForm.visualId ? presetById(placement.exhibitForm.visualId) : null;
  const baseSize = Math.max(60, Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.55);
  const aspect = preset ? preset.naturalWidth / preset.naturalHeight : 1;
  const width = aspect >= 1 ? baseSize : baseSize * aspect;
  const height = aspect >= 1 ? baseSize / aspect : baseSize;

  const fo = document.createElementNS(SVG_NS, "foreignObject");
  fo.setAttribute("id", "placement-preview");
  fo.setAttribute("x", String(point.x - width / 2));
  fo.setAttribute("y", String(preset?.anchor === "resting" ? point.y - height : point.y - height / 2));
  fo.setAttribute("width", String(width));
  fo.setAttribute("height", String(height));
  fo.setAttribute("class", "placement-preview");
  const container = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  container.style.width = "100%";
  container.style.height = "100%";
  fo.appendChild(container);
  objectLayer.appendChild(fo);
  renderRelicVisual(container, {
    visualId: placement.exhibitForm.visualId,
    category: gallery.category,
    subtype,
    accent: gallery.accent,
    exhibitId: `placement-preview:${subtype}`,
  });

  wirePlacementDrag(objectLayer, fo, gallery);
}

// Converts a pointer event's client coordinates into the SVG's own viewBox
// coordinate space, accounting for the camera's own current pan/zoom
// transform on the room (the SVG's `getScreenCTM` already reflects the live
// CSS transform, so this stays correct through pan/zoom without this code
// needing to know camera-math.js's own formulas).
function svgPointFromEvent(svg, event) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

let placementDragState = null;
function wirePlacementDrag(objectLayer, previewNode, gallery) {
  if (placementDragState?.cleanup) placementDragState.cleanup();
  const svg = objectLayer;

  function onPointerMove(e) {
    if (!placement) return;
    const p = svgPointFromEvent(svg, e);
    const surfaces = gallery.placementSurfaces.filter((s) => s.allowedRelicTypes.includes(placement.exhibitForm.subtype));
    // Snap into whichever compatible surface the pointer is nearest to —
    // the surface actually under the pointer if it's inside one, otherwise
    // the previously-chosen surface (so a brief overshoot outside every
    // surface doesn't yank the preview to a different wall entirely).
    let target = surfaces.find((s) => pointInShape(s.shape, p.x, p.y));
    if (!target) target = surfaces.find((s) => s.id === placement.surfaceId) ?? surfaces[0];
    if (!target) return;
    const snapped = snapIntoShape(target.shape, p.x, p.y);
    placement.surfaceId = target.id;
    placement.point = snapped;
    const b = shapeBounds(target.shape);
    const footprint = Math.max(60, Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.55);
    previewNode.setAttribute("x", String(snapped.x - footprint / 2));
    previewNode.setAttribute("y", String(snapped.y - footprint / 2));
    previewNode.setAttribute("width", String(footprint));
    previewNode.setAttribute("height", String(footprint));
    el("placement-confirm-btn").disabled = false;
    for (const node of svg.querySelectorAll(".placement-surface")) {
      node.classList.toggle("chosen", node.dataset.surfaceId === target.id);
    }
  }

  let dragging = false;
  function onPointerDown(e) {
    dragging = true;
    onPointerMove(e);
  }
  function onPointerUp() {
    dragging = false;
  }
  function onMove(e) {
    if (dragging) onPointerMove(e);
  }

  previewNode.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onPointerUp);
  // A click anywhere on a compatible surface (not just a drag of the
  // preview itself) also moves the preview there — placement should feel
  // like "drop it where I click," not require grabbing the preview first.
  function onSurfaceClick(e) {
    if (e.target.classList?.contains("placement-surface")) onPointerMove(e);
  }
  svg.addEventListener("click", onSurfaceClick);

  placementDragState = {
    cleanup() {
      previewNode.removeEventListener("pointerdown", onPointerDown);
      svg.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onPointerUp);
      svg.removeEventListener("click", onSurfaceClick);
    },
  };
  // Confirm is enabled as soon as there's a valid chosen point (the initial
  // centroid default already counts as one).
  if (placement.surfaceId && placement.point) el("placement-confirm-btn").disabled = false;
}

function refreshInteractiveObjects() {
  const { objectLayer } = illustrator.activeLayers();
  if (!objectLayer) return;
  while (objectLayer.firstChild) objectLayer.removeChild(objectLayer.firstChild);
  const scene = illustrator.currentScene();

  if (placement) {
    renderPlacementSurfaces(objectLayer, scene);
  } else {
    for (const object of scene.interactiveObjects) {
      objectLayer.appendChild(buildObjectGlow(object, scene));
    }
    if (scene.kind === "main" && scene.galleryId) {
      const gallery = world.galleries.find((g) => g.id === scene.galleryId);
      const exhibits = [...exhibitsById.values()].filter((e) => e.galleryId === scene.galleryId);
      for (const exhibit of exhibits) {
        const node = buildExhibitObject(exhibit, gallery, scene);
        if (node) objectLayer.appendChild(node);
      }
    }
  }
  if (focusedObjectId) setFocusedObject(focusedObjectId);

  renderCornerNav(scene);
  galleryTitleEl.textContent = scene.id === "hall" ? "" : scene.caption;
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
    illustrator.goToScene("hall", { direction: "back" });
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
  if (ambient.isOn) ambient.setGallery(scene.galleryId ?? null);
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
  if (e.code === "ArrowLeft") {
    illustrator.camera.panLeft();
  } else if (e.code === "ArrowRight") {
    illustrator.camera.panRight();
  } else if (e.key === "+" || e.key === "=") {
    illustrator.camera.zoomIn();
  } else if (e.key === "-" || e.key === "_") {
    illustrator.camera.zoomOut();
  }
});

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  myIdentity = await fetchMe();
  updateWhoami();

  await loadWorld();
  await loadRelicPresets();
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
