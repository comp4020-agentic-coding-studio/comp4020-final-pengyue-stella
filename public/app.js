import { renderArtifactObject } from "./world/artifacts.js";
import { createIllustrationController } from "./world/illustration.js";
import { createAmbientSoundscape } from "./world/ambient.js";
import { pointInShape, shapeBounds, snapIntoShape, surfaceUvFromPoint, surfacePointFromUv, surfaceCentroidUv, expandShape } from "./world/geometry.js";
import { renderFloorPlan } from "./world/floor-plan.js";

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
let reactions = []; // the Séance panel's fixed reaction vocabulary — see server/src/constants.js's REACTIONS
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

async function setDisplayName(name, ghostType) {
  const res = await fetch("/api/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ghostType !== undefined ? { name, ghostType } : { name }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "could not set name");
  return res.json();
}

function updateWhoami() {
  if (!myIdentity) return;
  whoamiEl.textContent = `You are ${myIdentity.name}`;
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

async function loadReactions() {
  const res = await fetch("/api/reactions");
  const { reactions: list } = await res.json();
  reactions = list;
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

// The donor's chosen curated visual id — a preset is now REQUIRED to submit
// a donation (see CLAUDE.md-aligned brief: "require a preset for new
// donations"); there is no "Classic"/no-image id any more. Kept outside the
// form's own native fields since a radio-grid of image tiles isn't a native
// form control the submit handler can read via `form.someField.value` the
// way a plain <select> is. `selectedSubtype` is derived FROM the chosen
// preset (a preset names exactly one subtype — see relic-presets.js) rather
// than read from a separate control, since a preset IS the subtype choice
// (decision: removed the subtype <select> fallback entirely rather than
// just blocking submission with it still visible — the brief's option (b) —
// so a donor is never shown two controls that could disagree about "what is
// this").
let selectedVisualId = null;
let selectedSubtype = null;

function populateDonateForm() {
  const gallerySelect = el("donate-gallery");
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
  // reachable from every main scene, not gated by orientation). Superseded
  // below by whichever gallery the default preset belongs to, if any.
  const scene = illustrator?.currentScene();
  if (scene?.galleryId) gallerySelect.value = scene.galleryId;

  function selectVisual(visualId, subtype) {
    selectedVisualId = visualId;
    selectedSubtype = subtype ?? null;
    for (const tile of visualGrid.querySelectorAll(".visual-preset-tile")) {
      tile.setAttribute("aria-checked", tile.dataset.visualId === String(visualId) ? "true" : "false");
    }
    el("donate-error").textContent = "";
  }

  // The visual picker: all four curated presets, always shown together,
  // regardless of which gallery happens to be selected — selecting one
  // DRIVES the gallery/subtype choice (preset-first), rather than being
  // filtered down to whichever single preset matches an already-chosen
  // gallery (the old "only one preset + Classic" bug). Changing the
  // gallery dropdown directly (without clicking a preset) no longer clears
  // the chosen preset to a "Classic" fallback — the picker and the gallery
  // dropdown both just reflect the same preset's own category; a donor
  // changing the dropdown away from that category is gently corrected back
  // by reselecting the matching gallery whenever a tile is clicked, and the
  // submit handler below refuses to submit a mismatch either way.
  function buildVisualGrid() {
    visualGrid.innerHTML = "";
    for (const preset of relicPresets) {
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
        const targetGalleryId = world.galleries.find((g) => g.category === preset.category)?.id;
        if (targetGalleryId) gallerySelect.value = targetGalleryId;
        selectVisual(preset.id, preset.subtype);
      });
      visualGrid.appendChild(tile);
    }
  }

  buildVisualGrid();
  // Default to the first curated preset overall, so a donor sees an
  // integrated illustrated relic by default rather than having to discover
  // the picker — this also sets the gallery to match that preset's own
  // category, superseding the "default to the visitor's current gallery"
  // convenience above when a default preset is available.
  if (relicPresets.length > 0) {
    const first = relicPresets[0];
    const targetGalleryId = world.galleries.find((g) => g.category === first.category)?.id;
    if (targetGalleryId) gallerySelect.value = targetGalleryId;
    selectVisual(first.id, first.subtype);
  } else {
    selectVisual(null, null);
  }
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
  const errEl = el("donate-error");

  // A preset is now REQUIRED to submit (CLAUDE.md-aligned brief: "a donor
  // must NOT be able to submit a new donation without a valid curated
  // preset chosen"). Blocked here with a specific message directing the
  // donor back to the picker, rather than silently falling back to a
  // "Classic" procedural look the way the old gallerySelect.onchange path
  // used to. The server independently re-validates this (db.js's
  // donateExhibit now rejects a missing visualId with "visual_required") —
  // this check is a friendly, immediate client-side message, never the
  // actual authority.
  if (!selectedVisualId || !selectedSubtype) {
    errEl.textContent = "Choose a relic appearance above before placing your relic.";
    const firstTile = el("donate-visual-grid").querySelector(".visual-preset-tile");
    firstTile?.focus();
    return;
  }

  // The chosen preset's own category is what actually determines the
  // gallery a preset-driven donation belongs to — read it back off the
  // preset rather than trusting the gallery <select>'s current value,
  // which a donor could in principle still have changed after picking a
  // tile (buildVisualGrid's click handler already re-syncs it, but this is
  // the authoritative source either way, consistent with "the preset IS
  // the subtype/category choice").
  const preset = presetById(selectedVisualId);
  const galleryId = world.galleries.find((g) => g.category === preset?.category)?.id ?? form.galleryId.value;
  const gallery = world.galleries.find((g) => g.id === galleryId);
  const free = gallery.slots.filter((s) => !occupiedSlotIdsForGallery(galleryId).has(s.id));
  if (free.length === 0) {
    errEl.textContent = "No free display spot in this gallery right now — try another gallery.";
    return;
  }
  errEl.textContent = "";
  const exhibitForm = {
    galleryId,
    subtype: selectedSubtype,
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
  const galleryName = gallery?.name ?? (exhibit.galleryId === "hall" ? "Entrance Hall" : exhibit.galleryId);
  // A built-in museum object was never "donated" — its provenance line
  // reads as recorded by the curator rather than attributed to a visitor.
  const provenance = exhibit.origin === "builtin" ? `recorded by ${exhibit.donorName}` : `donated by ${exhibit.donorName}`;
  el("dossier-meta").textContent = `${galleryName} · ${provenance} · ${exhibit.accounts.length} account${exhibit.accounts.length === 1 ? "" : "s"}`;

  if (dossierPreviewExhibitId !== exhibit.id) {
    dossierPreviewExhibitId = exhibit.id;
    // A built-in museum object (origin: "builtin") was never donated and
    // never has a visualId — its dossier preview is instead a real CSS crop
    // of the actual painted object straight from its own scene's gallery
    // art (see renderBuiltinObjectVisual), never a generic procedural shape
    // or an arbitrary donated-relic preset image.
    if (exhibit.origin === "builtin") {
      renderBuiltinObjectVisual(el("dossier-preview"), exhibit);
    } else {
      renderRelicVisual(el("dossier-preview"), {
        visualId: exhibit.visualId,
        category: exhibit.category,
        subtype: exhibit.subtype,
        accent: gallery?.accent ?? "#88653d",
        exhibitId: exhibit.id,
      });
    }
  }

  // A backfilled visual (an exhibit donated/seeded before the curated
  // preset catalog existed) is an archival stand-in, not the donor's own
  // choice — disclose that honestly rather than letting the image imply a
  // match to the dossier's own subtype text.
  const backfillNote = el("dossier-visual-note");
  backfillNote.textContent = exhibit.visualIdBackfilled ? "Shown with an archival representative image." : "";

  // A dossier whose backing object is itself a gallery's own marquee
  // closeup trigger (e.g. "Look closer: The Watching Portrait") offers a
  // way to actually enter that closeup scene, rather than leaving it
  // reachable only by the old direct-click navigation.
  const inspectBtn = el("dossier-inspect-closer");
  if (exhibit.closeupSceneId) {
    inspectBtn.hidden = false;
    inspectBtn.onclick = () => {
      closeDossier();
      illustrator.goToScene(exhibit.closeupSceneId, { direction: "forward" });
    };
  } else {
    inspectBtn.hidden = true;
    inspectBtn.onclick = null;
  }

  const container = el("dossier-accounts");
  container.innerHTML = "";
  for (const account of exhibit.accounts) {
    container.appendChild(renderAccountBlock(account, exhibit));
  }
  el("account-challenged").value = exhibit.accounts[exhibit.accounts.length - 1]?.id ?? "";

  // Owner-only controls: `isOwnedByRequester` is computed server-side, per
  // requester, by comparing the exhibit's real donor_visitor_id against this
  // visitor's own identity cookie — never derived from donorName (a
  // free-text field anyone could type) and never trusted from anywhere but
  // this server response. A builtin/founding exhibit's donor_visitor_id is
  // always NULL, so this is always false for those regardless of who asks.
  el("dossier-owner-controls").hidden = !exhibit.isOwnedByRequester;
  if (!exhibit.isOwnedByRequester) {
    closeDossierEdit();
    closeDossierDeleteConfirm();
  }
}

function openDossier(exhibitId) {
  const exhibit = exhibitsById.get(exhibitId);
  if (!exhibit) return;
  hideLoreDrawer();
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
  closeDossierEdit();
  closeDossierDeleteConfirm();
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
// Owner-only edit/delete (a brand new feature). Controls only ever render
// when the server's own `isOwnedByRequester` said so (see renderDossier) —
// but every PATCH/DELETE below still relies on the server to re-check real
// ownership; nothing here is itself a security boundary.

function openDossierEdit() {
  if (!openDossierExhibitId) return;
  const exhibit = exhibitsById.get(openDossierExhibitId);
  if (!exhibit) return;
  closeDossierDeleteConfirm();
  el("dossier-edit-title").value = exhibit.title;
  el("dossier-edit-claim").value = "";
  el("dossier-edit-error").textContent = "";
  el("dossier-edit-form").hidden = false;
  el("dossier-edit-title").focus();
}
function closeDossierEdit() {
  el("dossier-edit-form").hidden = true;
  el("dossier-edit-error").textContent = "";
}
el("dossier-edit").addEventListener("click", openDossierEdit);
el("dossier-edit-cancel").addEventListener("click", closeDossierEdit);

el("dossier-edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!openDossierExhibitId) return;
  const title = el("dossier-edit-title").value.trim();
  const originClaim = el("dossier-edit-claim").value.trim();
  const errEl = el("dossier-edit-error");
  if (!title) {
    errEl.textContent = "Title can't be empty.";
    return;
  }
  const payload = { title };
  if (originClaim) payload.originClaim = originClaim;
  const res = await fetch(`/api/exhibits/${openDossierExhibitId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error ?? "Could not save those changes.";
    return;
  }
  exhibitsById.set(data.exhibit.id, data.exhibit);
  closeDossierEdit();
  if (openDossierExhibitId === data.exhibit.id) renderDossier(data.exhibit);
  refreshInteractiveObjects(); // the title shown on the in-room label/card may have changed
  toast(`"${data.exhibit.title}" updated.`);
});

function openDossierDeleteConfirm() {
  closeDossierEdit();
  el("dossier-delete-error").textContent = "";
  el("dossier-delete-confirm").hidden = false;
  el("dossier-delete-cancel").focus();
}
function closeDossierDeleteConfirm() {
  el("dossier-delete-confirm").hidden = true;
  el("dossier-delete-error").textContent = "";
}
el("dossier-delete").addEventListener("click", openDossierDeleteConfirm);
el("dossier-delete-cancel").addEventListener("click", closeDossierDeleteConfirm);

el("dossier-delete-confirm-btn").addEventListener("click", async () => {
  if (!openDossierExhibitId) return;
  const exhibitId = openDossierExhibitId;
  const res = await fetch(`/api/exhibits/${exhibitId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    el("dossier-delete-error").textContent = data.error ?? "Could not withdraw that relic.";
    return;
  }
  removeExhibitLocally(exhibitId, "You withdrew this relic from the museum.");
});

// Shared by both the owner's own successful DELETE and an `exhibit.deleted`
// SSE broadcast from someone else's tab/session — one path, not two, for
// "this exhibit no longer exists anywhere in local state."
function removeExhibitLocally(exhibitId, toastMessage) {
  const exhibit = exhibitsById.get(exhibitId);
  exhibitsById.delete(exhibitId);
  if (openDossierExhibitId === exhibitId) closeDossier();
  refreshInteractiveObjects();
  refreshGuideFloorPlanIfOpen();
  if (!el("archive-gate").hidden) renderArchiveList();
  if (toastMessage) toast(toastMessage);
  else if (exhibit) toast(`"${exhibit.title}" was withdrawn by its donor.`);
}

// ---------------------------------------------------------------------------
// Environmental lore drawer — now used only for a close-up scene's own
// arrival caption (every in-room lore OBJECT opens the unified dossier
// instead, see handleObjectActivate). Closing a caption that was shown
// automatically on arrival should return to the parent scene (the visitor
// came here only to see this caption); closing one a visitor opened
// deliberately must never navigate anywhere — `loreDrawerAutoOpened` tracks
// which case this is, set by the one caller that auto-opens it
// (onSceneChange), reset to "user-opened" by default on every open so any
// future caller defaults safely.

let loreDrawerAutoOpened = false;

function openLoreCard(title, text, objectId) {
  loreDrawerAutoOpened = false;
  el("lore-title").textContent = title;
  el("lore-text").textContent = text;
  el("lore-drawer").hidden = false;
  if (objectId) setFocusedObject(objectId);
}
// Dismisses the lore drawer without ever triggering the auto-opened "return
// to parent scene" behaviour — used when something ELSE (opening a dossier,
// a scene change) needs the drawer out of the way, not a deliberate close.
function hideLoreDrawer() {
  el("lore-drawer").hidden = true;
  loreDrawerAutoOpened = false;
  if (focusedObjectId?.startsWith("object:")) setFocusedObject(null);
}
function closeLoreCard() {
  const wasAutoOpened = loreDrawerAutoOpened;
  hideLoreDrawer();
  if (wasAutoOpened) illustrator.back();
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
  const ghostType = new FormData(el("name-form")).get("ghostType");
  if (!name || !ghostType) return;
  try {
    myIdentity = await setDisplayName(name, ghostType);
    markNamed();
    el("name-gate").hidden = true;
    updateWhoami();
    if (!hasTouredBefore()) {
      startTour();
    } else {
      viewport.focus();
    }
  } catch (err) {
    console.error(err);
  }
});

// ---------------------------------------------------------------------------
// Entrance Hall onboarding: a short first-visit guided intro, run once after
// the name gate (localStorage-gated, same per-viewer-convenience pattern as
// `hasNamedBefore`/`markNamed` above), replayable later via the topbar "?"
// button. Each step points at a real control or a real in-room object
// rather than a generic product-tour overlay covering the artwork's centre —
// a small card anchored near the thing it describes, never a modal blocking
// the whole scene.
const TOUR_STORAGE_KEY = "cursedMuseumToured";
const TOUR_SHIMMER_KEY = "cursedMuseumDiscoveredObject";
const GUIDE_SEEN_KEY = "cursedMuseumGuideSeen";

function hasSeenGuide() {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, "1");
  } catch {
    // Private browsing / blocked storage: the shimmer cue just reappears.
  }
}

function hasTouredBefore() {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function markToured() {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // Private browsing / blocked storage: the tour just replays next visit.
  }
}
function hasDiscoveredAnObject() {
  try {
    return localStorage.getItem(TOUR_SHIMMER_KEY) === "1";
  } catch {
    return false;
  }
}
function markDiscoveredAnObject() {
  try {
    localStorage.setItem(TOUR_SHIMMER_KEY, "1");
  } catch {
    // Same per-viewer convenience — fine if it never sticks.
  }
}

// Each step names an anchor element id (for the card's own position, via
// `anchorEl`) or null to centre the card without pointing at anything, plus
// which real control/object it highlights with a soft outline while active.
function tourSteps() {
  return [
    {
      text: "Drag to look around; scroll or pinch to move closer.",
      anchorEl: null,
      highlightEl: null,
    },
    {
      text: "Objects that answer the light can be examined.",
      anchorEl: null,
      highlightObjectId: tourHighlightObjectId(),
    },
    {
      text: "Use the map to visit another collection and see where other visitors are.",
      anchorEl: "open-rooms",
      highlightEl: "open-rooms",
    },
    {
      text: "Leave a relic and story, or inspect the museum record.",
      anchorEl: "open-donate",
      highlightEl: "open-donate",
    },
  ];
}

// Picks a real lore object in the current (Entrance Hall) scene to light up
// for step 2 — never an arbitrary element, always one of the scene's own
// traced interactive objects.
function tourHighlightObjectId() {
  const scene = illustrator?.currentScene();
  const candidate = scene?.interactiveObjects?.find((o) => o.type === "lore");
  return candidate ? `object:${candidate.id}` : null;
}

let tourStepIndex = 0;
let tourHighlightedNode = null;

function clearTourHighlight() {
  if (tourHighlightedNode) {
    tourHighlightedNode.classList.remove("tour-highlight");
    tourHighlightedNode = null;
  }
}

function positionOnboardingCard(anchorElId) {
  const card = el("onboarding-card");
  const overlay = el("onboarding");
  overlay.classList.toggle("onboarding-centered", !anchorElId);
  if (!anchorElId) {
    card.style.removeProperty("--onboarding-x");
    card.style.removeProperty("--onboarding-y");
    return;
  }
  const anchor = el(anchorElId);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const margin = 16;
  // Measure the card's actual rendered width rather than assuming the
  // un-clamped 280px — the mobile media query widens it to fill the
  // viewport, and clamping against a stale estimate let the card (and its
  // Next/Skip buttons) spill past the right edge there.
  card.style.removeProperty("--onboarding-x");
  const cardWidth = card.getBoundingClientRect().width || Math.min(280, window.innerWidth - margin * 2);
  const estimatedCardHeight = card.getBoundingClientRect().height || 120;
  const x = Math.min(Math.max(rect.left + rect.width / 2, margin + cardWidth / 2), window.innerWidth - margin - cardWidth / 2);
  const y = Math.min(rect.bottom + 10, window.innerHeight - margin - estimatedCardHeight);
  card.style.setProperty("--onboarding-x", `${x}px`);
  card.style.setProperty("--onboarding-y", `${y}px`);
}

function renderTourStep() {
  const steps = tourSteps();
  const step = steps[tourStepIndex];
  if (!step) {
    endTour();
    return;
  }
  clearTourHighlight();

  if (step.highlightEl) {
    const node = el(step.highlightEl);
    if (node) {
      node.classList.add("tour-highlight");
      tourHighlightedNode = node;
    }
  } else if (step.highlightObjectId) {
    const { objectLayer } = illustrator.activeLayers();
    const node = objectLayer?.querySelector(`[data-object-id="${step.highlightObjectId}"]`);
    if (node) {
      node.classList.add("tour-highlight");
      tourHighlightedNode = node;
    }
  }

  el("onboarding-text").textContent = step.text;
  el("onboarding-next").textContent = tourStepIndex === steps.length - 1 ? "Done" : "Next";
  positionOnboardingCard(step.anchorEl);
}

function startTour() {
  if (!illustrator || illustrator.currentScene().id !== "hall") return;
  tourStepIndex = 0;
  el("onboarding").hidden = false;
  renderTourStep();
}

function advanceTour() {
  tourStepIndex += 1;
  if (tourStepIndex >= tourSteps().length) {
    endTour();
  } else {
    renderTourStep();
  }
}

function endTour() {
  clearTourHighlight();
  el("onboarding").hidden = true;
  markToured();
  refreshInteractiveObjects();
  viewport.focus();
}

el("onboarding-next").addEventListener("click", advanceTour);
el("onboarding-skip").addEventListener("click", endTour);
// The topbar Help/"?" control now reopens the Museum Guide (which itself
// offers a "replay the tour" affordance in its own Welcome section) rather
// than jumping straight back into the first-visit tour.
el("replay-tour").addEventListener("click", () => {
  if (anyOverlayOpen() || placement) return;
  openMuseumGuide({ section: "welcome" });
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

function cameoOpacityFor(publicKey) {
  return (0.72 + (hashKey(`opacity:${publicKey}`) % 20) / 100).toFixed(2);
}
function cameoGlowFor(publicKey) {
  return (0.35 + (hashKey(`glow:${publicKey}`) % 30) / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// The apparition itself: one of three fixed, pre-made transparent PNG
// templates (public/assets/ui/visitor-ghost-{feminine,masculine,small}.png)
// rather than a generated SVG silhouette. The template is chosen
// deterministically from the visitor's own public key — never from their
// (user-supplied, untrusted) display name, so this never infers gender from
// a name — and stays stable for that visitor across re-renders, refreshes
// and reconnects, the same "stable per-identity" discipline the anchor/
// colour/idle-delay assignment above already uses.
//
// The artwork itself is never recoloured or altered: each cameo layers
// three elements —
//   1. `.apparition-aura`, a blurred, screen-blended copy of the template
//      masked by its own alpha, behind everything, for a soft per-visitor
//      glow;
//   2. `.apparition-base`, the PNG at full/original detail (`object-fit:
//      contain` preserves its proportions);
//   3. `.apparition-tint`, a flat `--cameo-color` layer masked by the SAME
//      template's alpha channel (`mask-image`/`-webkit-mask-image`, never
//      `filter: hue-rotate`, which would shift the hue of every pixel
//      uniformly rather than respecting the garment's own shading) and
//      composited with `mix-blend-mode: color` so it recolours the figure
//      while the base layer's clothing folds and facial shading still show
//      through underneath.
// Only colour, transparency (`--cameo-opacity`/`--cameo-tint-opacity`),
// glow (`--cameo-glow-opacity`) and animation timing (`--cameo-delay`,
// already set in renderCameos) vary per visitor — the character art itself
// is identical for every visitor who lands on the same template.
const APPARITION_TEMPLATES_BY_GHOST_TYPE = {
  feminine: "/assets/ui/visitor-ghost-feminine.png",
  masculine: "/assets/ui/visitor-ghost-masculine.png",
  small: "/assets/ui/visitor-ghost-small.png",
};
const APPARITION_TEMPLATES = Object.values(APPARITION_TEMPLATES_BY_GHOST_TYPE);

// A visitor's own chosen `ghostType` (see the name-gate's ghost picker)
// decides their template directly. Only a visitor who connected before that
// feature existed — and so carries no `ghostType` at all — falls back to the
// old stable-hash-of-publicKey assignment, never the other way around.
function apparitionTemplateFor(visitor) {
  const chosen = APPARITION_TEMPLATES_BY_GHOST_TYPE[visitor?.ghostType];
  if (chosen) return chosen;
  const publicKey = typeof visitor === "string" ? visitor : visitor?.publicKey;
  return APPARITION_TEMPLATES[hashKey(`template:${publicKey}`) % APPARITION_TEMPLATES.length];
}

function buildApparitionFigure(visitor) {
  const template = apparitionTemplateFor(visitor);

  const wrap = document.createElement("div");
  wrap.className = "apparition";

  const aura = document.createElement("div");
  aura.className = "apparition-aura";
  aura.style.maskImage = `url(${template})`;
  aura.style.webkitMaskImage = `url(${template})`;
  aura.style.backgroundImage = `url(${template})`;
  wrap.appendChild(aura);

  const base = document.createElement("img");
  base.className = "apparition-base";
  base.src = template;
  base.alt = "";
  base.setAttribute("aria-hidden", "true");
  base.draggable = false;
  wrap.appendChild(base);

  const tint = document.createElement("div");
  tint.className = "apparition-tint";
  tint.style.maskImage = `url(${template})`;
  tint.style.webkitMaskImage = `url(${template})`;
  wrap.appendChild(tint);

  return wrap;
}

let recentActivityByKey = new Map(); // publicKey -> timestamp, for the activity-pulse cue
let recentFocusByKey = new Map(); // publicKey -> objectId, for "their silhouette turns toward what they're looking at"

// Deterministically distributes however many OTHER visitors are in this
// scene across its fixed anchors by sorting on each visitor's own hashed
// key rather than arrival order — so which anchor a given visitor lands on
// is stable for them across re-renders. When there are more visitors than
// anchors, the last anchor becomes a small "+N" grouped-count chip instead
// of letting two ghosts stack exactly on top of one another (CLAUDE.md:
// "prevent overlap").
function renderCameos() {
  const { cameoLayer } = illustrator.activeLayers();
  if (!cameoLayer) return;
  cameoLayer.innerHTML = "";
  const scene = illustrator.currentScene();
  const anchors = scene.visitorAnchors ?? [];
  const visitors = (lastSceneVisitors[currentSceneId] ?? []).filter((v) => v.publicKey !== myPublicKey);
  if (anchors.length === 0 || visitors.length === 0) return;

  const sorted = [...visitors].sort((a, b) => hashKey(a.publicKey) - hashKey(b.publicKey));
  const overflow = sorted.length > anchors.length;
  const shownCount = overflow ? Math.max(0, anchors.length - 1) : sorted.length;
  const shown = sorted.slice(0, shownCount);
  const hiddenCount = sorted.length - shown.length;

  shown.forEach((visitor, i) => {
    const anchor = anchors[i];
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
    cameo.style.setProperty("--cameo-opacity", cameoOpacityFor(visitor.publicKey));
    cameo.style.setProperty("--cameo-glow-opacity", cameoGlowFor(visitor.publicKey));
    cameo.tabIndex = 0;
    // A real interactive control now — clicking/tapping/Enter-ing another
    // visitor's apparition opens the Séance panel for them (see
    // openSeancePanel below), so this is role="button", not the earlier
    // decorative role="img". The pointer/touch target stays the whole
    // `.cameo` box (comfortably larger than the slim illustrated silhouette
    // inside it — see styles.css's own sizing note), satisfying "a
    // comfortably large pointer/touch target even if the silhouette itself
    // is kept slim."
    cameo.setAttribute("role", "button");
    cameo.setAttribute("aria-label", `${visitor.displayName}, another visitor in this room. Press Enter to open a Séance.`);
    cameo.addEventListener("click", () => openSeancePanel(visitor));
    cameo.addEventListener("keydown", (e) => {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        openSeancePanel(visitor);
      }
    });

    const silhouette = document.createElement("div");
    silhouette.className = "cameo-silhouette";
    silhouette.appendChild(buildApparitionFigure(visitor));
    cameo.appendChild(silhouette);

    // The name reveals only on hover/focus (CLAUDE.md: "do not show large
    // name bubbles permanently; reveal the name on hover/focus") — always
    // present in the DOM for a11y/focus, visually hidden otherwise via CSS.
    const name = document.createElement("span");
    name.className = "cameo-name";
    name.textContent = visitor.displayName; // textContent only — never innerHTML
    cameo.appendChild(name);

    cameoLayer.appendChild(cameo);
  });

  if (overflow && hiddenCount > 0) {
    const anchor = anchors[anchors.length - 1];
    const chip = document.createElement("div");
    chip.className = "cameo cameo-overflow";
    chip.style.left = `${anchor.x}%`;
    chip.style.top = `${anchor.y}%`;
    chip.style.setProperty("--cameo-depth", String(anchor.depth ?? 1));
    chip.tabIndex = 0;
    chip.setAttribute("role", "img");
    chip.setAttribute("aria-label", `${hiddenCount} more visitor${hiddenCount === 1 ? "" : "s"} here`);
    const badge = document.createElement("span");
    badge.className = "cameo-overflow-badge";
    badge.textContent = `+${hiddenCount}`;
    chip.appendChild(badge);
    cameoLayer.appendChild(chip);
  }

  clampCameosIntoViewport();
}

// A pragmatic safety net against a visitor cameo rendering outside the
// visible viewport (observed live in a two-browser test — a `.cameo`'s own
// `translate(-50%, -100%) scale()` compounds with the scene camera's own
// pan/zoom transform on its ancestor, and a near-edge anchor at an extreme
// zoom/pan combination can push the result past the visible frame). Runs
// after every cameo (re)render AND after every camera pan/zoom change (see
// `onCameraTransform` wiring in boot()) and window resize, nudging any
// cameo whose own bounding rect falls outside the viewport back inward —
// independent of fully isolating the underlying transform-composition
// cause, this guarantees no ghost is ever rendered off-screen.
function clampCameosIntoViewport() {
  if (!illustrator) return;
  const { cameoLayer } = illustrator.activeLayers();
  if (!cameoLayer) return;
  const viewportRect = viewport.getBoundingClientRect();
  for (const cameo of cameoLayer.querySelectorAll(".cameo")) {
    const rect = cameo.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.left < viewportRect.left) dx = viewportRect.left - rect.left;
    else if (rect.right > viewportRect.right) dx = viewportRect.right - rect.right;
    if (rect.top < viewportRect.top) dy = viewportRect.top - rect.top;
    else if (rect.bottom > viewportRect.bottom) dy = viewportRect.bottom - rect.bottom;
    if (dx !== 0 || dy !== 0) {
      const currentLeft = cameo.style.left ? parseFloat(cameo.style.left) : 0;
      const currentTop = cameo.style.top ? parseFloat(cameo.style.top) : 0;
      const layerRect = cameoLayer.getBoundingClientRect();
      if (layerRect.width > 0) cameo.style.left = `${currentLeft + (dx / layerRect.width) * 100}%`;
      if (layerRect.height > 0) cameo.style.top = `${currentTop + (dy / layerRect.height) * 100}%`;
    }
  }
}

let cameoClampResizeTimer = null;
window.addEventListener("resize", () => {
  if (cameoClampResizeTimer) clearTimeout(cameoClampResizeTimer);
  cameoClampResizeTimer = setTimeout(clampCameosIntoViewport, 120);
});

// The "logical room" a scene belongs to for presence purposes — a
// gallery's `-main` and `-closeup` scenes are the same physical room
// (closeup is just a zoomed-in look at one painted object within it, not a
// separate space), so the headcount and "who else is here" list treat them
// as one room even though they're different exact scene ids. Mirrors
// public/world/floor-plan.js's own roomIdForScene, reading the same
// galleryId field /api/world already puts on every scene rather than
// re-deriving it by regex. A cameo's own rendered anchor position stays
// exact-scene-scoped (see renderCameos) — see server/src/sse.js's doc
// comment for the full reasoning.
function roomIdForScene(sceneId) {
  const scene = world?.scenes.find((s) => s.id === sceneId);
  return scene?.galleryId ?? sceneId;
}


// ---------------------------------------------------------------------------
// The Séance panel: a compact Gothic interaction dialog opened from another
// visitor's own apparition (see renderCameos — a `.cameo` is now a real
// `role="button"`, not decorative). Everything here is ephemeral/session-
// local — the transcript lives only in this tab's own memory, mirroring the
// server's own "never persisted" treatment of the interaction itself (see
// server.js's /api/presence/interact doc comment). A page reload starts a
// fresh, empty transcript, same as a reload already resets focus/activity
// cues elsewhere in this app.

let seanceTargetPublicKey = null; // whoever the open panel currently targets, or null if closed
let seanceReplyToId = null; // the local transcript-entry id a typed message will reply to, or null
const seanceTranscripts = new Map(); // publicKey -> [{ id, mine, kind, body?, reactionId?, replyToId?, displayName }]
const mutedPublicKeys = new Set(); // publicKeys this session has chosen to stop hearing from — client-only, cleared on reload
let seanceEntryIdCounter = 0;
function nextSeanceEntryId() {
  seanceEntryIdCounter += 1;
  return `seance-entry-${seanceEntryIdCounter}`;
}

function transcriptFor(publicKey) {
  let list = seanceTranscripts.get(publicKey);
  if (!list) {
    list = [];
    seanceTranscripts.set(publicKey, list);
  }
  return list;
}

function reactionLabelFor(reactionId) {
  return reactions.find((r) => r.id === reactionId)?.label ?? reactionId;
}

// The Séance panel's own buttons/transcript still show the full server
// vocabulary label (reactionLabelFor, above) — this is only for the small
// glyph shown in the ephemeral burst beside a visitor's own cameo, which has
// no room for a full label like "🕯️ Offer a candle" without overwhelming
// the silhouette. `heart` renders as a plain text "♥" character (not the
// red ❤️ emoji) so it reads in this app's own muted rose/gold palette
// instead of a jarring bright-red glyph.
const REACTION_GLYPHS = {
  wave: "✧", // ✧
  bow: "❦", // ❦
  candle: "✦", // ✦
  heart: "♥", // ♥
  gasp: "!",
};
function reactionGlyphFor(reactionId) {
  return REACTION_GLYPHS[reactionId] ?? reactionLabelFor(reactionId);
}

// Renders the currently-open panel's transcript — called after every send
// AND every incoming interact event for the currently-open target, so the
// panel never needs a manual refresh. Each bubble uses this project's
// existing Gothic palette tokens via .seance-entry's own CSS (never a
// modern flat-design chat bubble — see styles.css's doc comment), and every
// piece of visitor-supplied text renders via textContent, never innerHTML.
function renderSeanceTranscript() {
  const container = el("seance-transcript");
  if (!container || !seanceTargetPublicKey) return;
  container.innerHTML = "";
  for (const entry of transcriptFor(seanceTargetPublicKey)) {
    const bubble = document.createElement("div");
    bubble.className = `seance-entry${entry.mine ? " mine" : ""}`;
    bubble.dataset.entryId = entry.id;

    const byline = document.createElement("span");
    byline.className = "seance-entry-byline";
    byline.textContent = entry.mine ? "You" : entry.displayName; // textContent only
    bubble.appendChild(byline);

    if (entry.kind === "reaction") {
      const body = document.createElement("p");
      body.className = "seance-entry-body seance-entry-reaction";
      body.textContent = `${reactionLabelFor(entry.reactionId)}`; // fixed server vocabulary, still textContent
      bubble.appendChild(body);
    } else if (entry.kind === "reach-out") {
      const body = document.createElement("p");
      body.className = "seance-entry-body";
      body.textContent = entry.mine ? "You reached out." : "Reached out to you.";
      bubble.appendChild(body);
    } else {
      if (entry.replyToId) {
        const replied = transcriptFor(seanceTargetPublicKey).find((e) => e.id === entry.replyToId);
        if (replied?.body) {
          const replyNote = document.createElement("p");
          replyNote.className = "seance-entry-byline";
          replyNote.textContent = `In reply to: "${replied.body.slice(0, 60)}"`; // textContent only
          bubble.appendChild(replyNote);
        }
      }
      const body = document.createElement("p");
      body.className = "seance-entry-body";
      body.textContent = entry.body; // textContent only — never innerHTML
      bubble.appendChild(body);

      // A small inline "Reply" affordance on every real message (yours or
      // theirs) — clicking it sets this entry as the reply target for the
      // NEXT message sent, shown in the form's own reply indicator below.
      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "seance-reply-btn";
      replyBtn.textContent = "Reply";
      replyBtn.addEventListener("click", () => setSeanceReplyTarget(entry));
      bubble.appendChild(replyBtn);
    }
    container.appendChild(bubble);
  }
  container.scrollTop = container.scrollHeight;
}

function setSeanceReplyTarget(entry) {
  seanceReplyToId = entry.id;
  const indicator = el("seance-reply-indicator");
  if (indicator) {
    indicator.hidden = false;
    indicator.textContent = `Replying to: "${entry.body.slice(0, 60)}"`; // textContent only
  }
  el("seance-message-input").focus();
}

function clearSeanceReplyTarget() {
  seanceReplyToId = null;
  const indicator = el("seance-reply-indicator");
  if (indicator) {
    indicator.hidden = true;
    indicator.textContent = "";
  }
}

function renderSeanceReactionButtons() {
  const container = el("seance-reactions");
  if (!container) return;
  container.innerHTML = "";
  for (const reaction of reactions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seance-reaction-btn";
    btn.textContent = reaction.label; // textContent only — a fixed server list, still never innerHTML
    btn.addEventListener("click", () => sendSeanceInteraction({ kind: "reaction", reactionId: reaction.id }));
    container.appendChild(btn);
  }
}

// Opens the Séance panel for `visitor` ({ publicKey, displayName }) — the
// panel shows that visitor's own transcript (empty on first open) and lets
// this visitor send a message/reaction/reach-out back to them. Never opened
// automatically for an unsolicited incoming interaction (see
// handleIncomingInteract below) — only a deliberate click/tap/Enter on that
// visitor's own apparition opens it.
function openSeancePanel(visitor) {
  if (anyOverlayOpen() && el("seance-panel").hidden) return; // don't pop this over some other open gate
  seanceTargetPublicKey = visitor.publicKey;
  clearSeanceReplyTarget();
  el("seance-title").textContent = visitor.displayName; // textContent only
  el("seance-error").textContent = "";
  el("seance-message-input").value = "";
  renderSeanceReactionButtons();
  renderSeanceTranscript();
  el("seance-panel").hidden = false;
  el("seance-message-input").focus();
}

function closeSeancePanel() {
  el("seance-panel").hidden = true;
  seanceTargetPublicKey = null;
  clearSeanceReplyTarget();
  viewport.focus();
}

async function sendSeanceInteraction(body) {
  if (!seanceTargetPublicKey) return;
  const errEl = el("seance-error");
  errEl.textContent = "";
  const res = await fetch("/api/presence/interact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPublicKey: seanceTargetPublicKey, ...body }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errEl.textContent = data.error ?? "That didn't reach them — try again in a moment.";
    return;
  }
  const entry = {
    id: nextSeanceEntryId(),
    mine: true,
    displayName: "You",
    replyToId: body.kind === "message" ? seanceReplyToId : null,
    ...body,
  };
  transcriptFor(seanceTargetPublicKey).push(entry);
  clearSeanceReplyTarget();
  renderSeanceTranscript();
  // A reaction/reach-out you send also briefly animates near YOUR OWN
  // apparition-less self (you have no rendered cameo — CLAUDE.md: never a
  // cameo of yourself), so there's nothing to animate on this sender's own
  // screen beyond the transcript entry just added above; the recipient's
  // screen is where the near-ghost animation happens (handleIncomingInteract).
}

el("seance-close").addEventListener("click", closeSeancePanel);
el("seance-reach-out").addEventListener("click", () => sendSeanceInteraction({ kind: "reach-out" }));
el("seance-mute").addEventListener("click", () => {
  if (!seanceTargetPublicKey) return;
  mutedPublicKeys.add(seanceTargetPublicKey);
  toast("Muted for this visit — you won't see cues from them again until you reload.");
  closeSeancePanel();
});
el("seance-message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = el("seance-message-input");
  const body = input.value.trim();
  if (!body) return;
  await sendSeanceInteraction({ kind: "message", body, replyToMessageId: seanceReplyToId });
  input.value = "";
});

// Briefly animates a reaction glyph rising beside a specific visitor's own
// rendered cameo in the CURRENT scene, if they currently have one on screen
// (they might not — the interaction could target a visitor in this room's
// OTHER exact scene, main vs. closeup, where this client never renders a
// ghost for them at all — see renderCameos' own exact-scene scoping).
// Known limitation: renderCameos() fully rebuilds cameoLayer's innerHTML on
// every re-render (another visitor's activity/focus/scene-presence event),
// which would delete this burst early if one fires mid-animation — accepted
// as a rare cosmetic truncation rather than threading a second persistent
// overlay layer through the camera's own transform just for this, matching
// this app's existing tolerance for similarly "best-effort" ephemeral cues.
function burstReactionNearCameo(publicKey, label) {
  const cameo = illustrator
    ?.activeLayers()
    .cameoLayer?.querySelector(`.cameo[data-public-key="${CSS.escape(publicKey)}"] .cameo-silhouette`);
  if (!cameo) return;
  const burst = document.createElement("span");
  burst.className = "cameo-reaction-burst";
  burst.textContent = label; // textContent only
  burst.setAttribute("aria-hidden", "true");
  cameo.appendChild(burst);
  window.setTimeout(() => burst.remove(), 1900);
}

// Shows a received message as a small restrained speech/parchment bubble
// near the SENDER's own rendered cameo, if visible in this exact scene —
// same visibility caveat as burstReactionNearCameo above.
function showMessageBubbleNearCameo(publicKey, body) {
  const cameo = illustrator
    ?.activeLayers()
    .cameoLayer?.querySelector(`.cameo[data-public-key="${CSS.escape(publicKey)}"] .cameo-silhouette`);
  if (!cameo) return;
  const bubble = document.createElement("div");
  bubble.className = "cameo-message-bubble";
  bubble.textContent = body; // textContent only — never innerHTML
  cameo.appendChild(bubble);
  window.setTimeout(() => bubble.remove(), 6200);
}

function announceToScreenReader(text) {
  const live = el("seance-announcer");
  if (live) live.textContent = text;
}

// Handles an incoming `interact` SSE event (see server.js's
// /api/presence/interact and sse.js's broadcastToVisitor) — never auto-
// opens the Séance panel for an unsolicited interaction (a toast/near-ghost
// cue is enough, matching this app's existing restrained toast() style);
// only updates the panel's own live transcript if it's ALREADY open for
// this exact sender.
function handleIncomingInteract(e) {
  const { fromPublicKey, fromDisplayName, kind, body, reactionId, replyToMessageId } = JSON.parse(e.data);
  if (!fromPublicKey || mutedPublicKeys.has(fromPublicKey)) return;

  const entry = {
    id: nextSeanceEntryId(),
    mine: false,
    displayName: fromDisplayName,
    kind,
    body,
    reactionId,
    replyToId: replyToMessageId ?? null,
  };
  transcriptFor(fromPublicKey).push(entry);

  if (kind === "message") {
    showMessageBubbleNearCameo(fromPublicKey, body);
    toast(`${fromDisplayName} sent you a message.`);
    announceToScreenReader(`${fromDisplayName} sent you a message: ${body}`);
  } else if (kind === "reaction") {
    const label = reactionLabelFor(reactionId);
    burstReactionNearCameo(fromPublicKey, reactionGlyphFor(reactionId));
    announceToScreenReader(`${fromDisplayName} reacted: ${label}`);
  } else if (kind === "reach-out") {
    burstReactionNearCameo(fromPublicKey, "♥");
    toast(`${fromDisplayName} reached out to you.`);
    announceToScreenReader(`${fromDisplayName} reached out to you.`);
  }

  if (seanceTargetPublicKey === fromPublicKey && !el("seance-panel").hidden) {
    renderSeanceTranscript();
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
    const { sceneCounts, visitors, sceneVisitors, yourPublicKey } = JSON.parse(e.data);
    lastSceneCounts = sceneCounts ?? {};
    if (yourPublicKey) myPublicKey = yourPublicKey;
    // `sceneVisitors` is the full per-scene roster snapshot (every scene
    // with at least one connection, not just this connection's own scene —
    // see sse.js's allSceneVisitors) — a full REPLACE of the cache, not a
    // merge, since a scene that has since emptied out is correctly absent
    // from this snapshot and a stale merge would leave its old roster
    // behind. Without this, the cache would otherwise start with only
    // `currentSceneId` populated and under-count its own room whenever the
    // OTHER exact scene of that room (main vs. closeup) already had
    // visitors in it before this connection ever opened. Fall back to the
    // old single-scene shape defensively (`visitors`) in case of a stale
    // cached client mid-deploy.
    lastSceneVisitors = sceneVisitors ?? { ...lastSceneVisitors, [currentSceneId]: visitors ?? [] };
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
    // Room-scoped comparison (not just the exact scene) — a visitor
    // arriving in this gallery's OTHER exact scene (main vs. closeup) is
    // still "another visitor entering this room" and must update this
    // room's own headcount/list/toast, even though `sceneId` itself won't
    // equal `currentSceneId`.
    const sameRoom = roomIdForScene(sceneId) === roomIdForScene(currentSceneId);
    const previousRoomCount = sameRoom ? roomCount(currentSceneId) : 0;
    lastSceneCounts = { ...lastSceneCounts, [sceneId]: count };
    if (visitors) lastSceneVisitors = { ...lastSceneVisitors, [sceneId]: visitors };
    if (sameRoom) {
      // Restrained: only a genuine increase in this room's own headcount
      // gets a toast, not every scene's count everywhere.
      const newRoomCount = roomCount(currentSceneId);
      if (newRoomCount > previousRoomCount && previousRoomCount > 0) toast("Another visitor has entered this room.");
      updatePresenceLabel();
      renderCameos();
    }
    refreshGuideFloorPlanIfOpen();
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
    refreshGuideFloorPlanIfOpen();
  });

  eventSource.addEventListener("account", (e) => {
    const account = JSON.parse(e.data);
    applyAccountUpdate(account.exhibitId, account, { isNew: true });
  });

  eventSource.addEventListener("vote", (e) => {
    const account = JSON.parse(e.data);
    applyAccountUpdate(account.exhibitId, account);
  });

  // Owner-edited elsewhere (another tab/session for the SAME visitor, or —
  // once ownership transfer ever existed — someone else's view of it): the
  // broadcast payload never carries `isOwnedByRequester` (server.js strips
  // it before broadcasting, since that field is only ever correct for one
  // specific requester) — merge everything else, but keep this client's own
  // previously-known value for that one field rather than treating the
  // broadcast's absence of it as "not mine".
  eventSource.addEventListener("exhibit.updated", (e) => {
    const incoming = JSON.parse(e.data);
    const existing = exhibitsById.get(incoming.id);
    const merged = { ...existing, ...incoming, isOwnedByRequester: existing?.isOwnedByRequester ?? false };
    exhibitsById.set(incoming.id, merged);
    if (openDossierExhibitId === incoming.id) renderDossier(merged);
    refreshInteractiveObjects(); // the title shown on the in-room label/card may have changed
    refreshGuideFloorPlanIfOpen();
    if (!el("archive-gate").hidden) renderArchiveList();
    toast(`"${merged.title}" was updated by its donor.`);
  });

  eventSource.addEventListener("exhibit.deleted", (e) => {
    const { exhibitId } = JSON.parse(e.data);
    removeExhibitLocally(exhibitId);
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

  // The Séance panel's own ephemeral interaction channel — see
  // handleIncomingInteract's own doc comment for why this never auto-opens
  // the panel.
  eventSource.addEventListener("interact", handleIncomingInteract);

  eventSource.onerror = () => {
    // EventSource auto-reconnects; on reconnect the server resends `hello`
    // with current scene counts, and a fresh GET /api/exhibits hydrates
    // anything missed meanwhile.
  };
}

// The room-total headcount, including yourself — the sum of every exact
// scene belonging to this room (see roomIdForScene), since `lastSceneCounts`
// is still keyed by exact scene id (sceneCounts()/scene-presence stay exact-
// scene-scoped server-side — see sse.js). Falls back to 1 (just yourself)
// before any count has arrived yet, matching the old per-scene behaviour.
function roomCount(sceneId) {
  const roomId = roomIdForScene(sceneId);
  let total = 0;
  let any = false;
  for (const scene of world?.scenes ?? []) {
    if (roomIdForScene(scene.id) !== roomId) continue;
    if (scene.id in lastSceneCounts) any = true;
    total += lastSceneCounts[scene.id] ?? 0;
  }
  return any ? total : 1;
}

function updatePresenceLabel() {
  const n = roomCount(currentSceneId);
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
    !el("museum-guide").hidden ||
    !el("onboarding").hidden ||
    !el("seance-panel").hidden
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
  if (!hasDiscoveredAnObject()) {
    markDiscoveredAnObject();
    for (const node of illustrator.activeLayers().objectLayer?.querySelectorAll(".ambient-shimmer") ?? []) {
      node.classList.remove("ambient-shimmer");
    }
  }
  if (object.type === "donate") {
    openDonateGate();
    return;
  }
  if (object.type === "guide") {
    openMuseumGuide({ section: "welcome" });
    return;
  }
  if (object.type === "lore") {
    openDossier(`exhibit_builtin_${object.id}`);
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

// ---------------------------------------------------------------------------
// Built-in object dossier preview: a CSS "sprite crop" straight out of the
// object's own scene art, rather than a generic procedural shape or an
// arbitrary donated-relic preset image (the bug this task fixes). A
// built-in exhibit's own `cropInfo` (server/src/db.js's fullExhibit, backed
// by world.js's builtinObjectCropInfo) carries the owning sceneId + the
// object's own hand-traced `shape` in that scene's 1672x941 viewBox — this
// derives `background-position`/`background-size` percentages from that
// shape's bounding box (server/src/geometry.js's `shapeBounds`, mirrored
// client-side by world/geometry.js's own copy already imported above) so
// the preview shows the EXACT real painted region, pixel for pixel,
// scaled up so that region fills the container.
//
// MARGIN pads the crop region outward by 18% of its own box size in each
// dimension before computing background-size — several hand-traced
// bounding boxes (e.g. a bust's plinth box, a mirror's tight ellipse) crop
// right to the object's own silhouette with very little surrounding
// context, which can read as an ambiguous close-up texture rather than a
// recognisable object; a modest outward pad keeps a little of the
// surrounding frame/shelf/wall in frame so the object still reads clearly
// against its setting. 18% was chosen by spot-checking several objects
// across different galleries (busts, the chandelier, mirrors, cabinets)
// and is a single constant, not tuned per-object, so every builtin object
// gets the same honest treatment.
const BUILTIN_CROP_MARGIN = 0.18;

function renderBuiltinObjectVisual(container, exhibit) {
  container.innerHTML = "";
  const cropInfo = exhibit.cropInfo;
  const scene = cropInfo ? world?.scenes.find((s) => s.id === cropInfo.sceneId) : null;
  if (!cropInfo || !scene) {
    // Defensive fallback only — should never happen for a real builtin
    // exhibit (every one of them has a real owning scene/shape), but keeps
    // this resilient rather than leaving the preview blank.
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
    renderArtifactObject(canvas, { category: exhibit.category, subtype: exhibit.subtype, accent: "#88653d", exhibitId: exhibit.id });
    return;
  }

  const { width: sceneWidth, height: sceneHeight } = viewBoxSize(cropInfo.shape.viewBox);
  const b = shapeBounds(cropInfo.shape);
  const boxW = Math.max(1, b.maxX - b.minX);
  const boxH = Math.max(1, b.maxY - b.minY);
  // Pad outward by BUILTIN_CROP_MARGIN of the box's own size, clamped to
  // the scene image's own bounds so a near-edge object never asks for a
  // crop region that would reach past the actual art.
  const padX = boxW * BUILTIN_CROP_MARGIN;
  const padY = boxH * BUILTIN_CROP_MARGIN;
  const minX = Math.max(0, b.minX - padX);
  const maxX = Math.min(sceneWidth, b.maxX + padX);
  const minY = Math.max(0, b.minY - padY);
  const maxY = Math.min(sceneHeight, b.maxY + padY);
  const cropW = Math.max(1, maxX - minX);
  const cropH = Math.max(1, maxY - minY);

  const div = document.createElement("div");
  div.className = "builtin-object-crop";
  div.style.backgroundImage = `url(${sceneImageUrl(scene)})`;
  // Scaling the FULL scene image up by (sceneWidth / cropW) horizontally
  // and (sceneHeight / cropH) vertically makes the crop region exactly
  // fill the container (background-size on the full image, not a sub-
  // image) — then background-position places that scaled image so the
  // crop region's own top-left lands at the container's own top-left.
  // This is the standard CSS-sprite-crop technique: no server-side image
  // cropping or new asset needed, just background-size/-position math
  // derived from the shape's own bounding box.
  const scaleX = sceneWidth / cropW;
  const scaleY = sceneHeight / cropH;
  div.style.backgroundSize = `${scaleX * 100}% ${scaleY * 100}%`;
  const posX = cropW >= sceneWidth ? 0 : (minX / (sceneWidth - cropW)) * 100;
  const posY = cropH >= sceneHeight ? 0 : (minY / (sceneHeight - cropH)) * 100;
  div.style.backgroundPositionX = `${isFinite(posX) ? posX : 0}%`;
  div.style.backgroundPositionY = `${isFinite(posY) ? posY : 0}%`;
  container.appendChild(div);
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

  // After the tour (but before the visitor has ever opened a single real
  // object), a subtle ambient shimmer invites discovery — removed for good
  // the first time any object is activated (markDiscoveredAnObject), and
  // skipped entirely under reduced-motion.
  if (hasTouredBefore() && !hasDiscoveredAnObject() && !prefersReducedMotion()) {
    node.classList.add("ambient-shimmer");
  }
  // The physical hall-map object gets its own restrained first-visit cue
  // (a shimmer plus a short label, never a centred modal) inviting the
  // visitor to open the Museum Guide — independent of the general
  // ambient-shimmer-until-first-discovery cue above, since the Guide is
  // worth surfacing even after that first discovery has already happened.
  if (object.type === "guide" && !hasSeenGuide() && !prefersReducedMotion()) {
    node.classList.add("ambient-shimmer", "guide-shimmer");
  }

  return node;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
// Museum Guide: one shared modal (Welcome / Floor Plan / How to Explore /
// How the Archive Works) replacing both the old compass map popup and the
// old plain tour-replay button — the hall-map object, the "Rooms" control,
// and the topbar "?" Help control all open this same component, each
// pinned to a different starting section. The Floor Plan section renders
// the real architectural floor plan (public/world/floor-plan.js), reused
// unchanged by both the "Rooms" shortcut and this fuller guide.

const GUIDE_SECTIONS = ["welcome", "floorplan", "explore", "archive"];

function selectGuideSection(section) {
  for (const tab of document.querySelectorAll(".guide-tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.section === section));
  }
  for (const panel of document.querySelectorAll(".guide-panel")) {
    panel.hidden = panel.id !== `guide-panel-${section}`;
  }
  if (section === "floorplan") {
    renderFloorPlan(el("guide-floor-plan-mount"), {
      world,
      sceneVisitors: lastSceneVisitors,
      exhibitsById,
      currentSceneId,
      myPublicKey,
      onRoomSelect: (roomId) => {
        closeMuseumGuide();
        if (roomId === "hall") illustrator.goToScene("hall", { direction: "back" });
        else illustrator.goToScene(`${roomId}-main`, { direction: "forward" });
      },
    });
  }
}

function openMuseumGuide({ section = "welcome" } = {}) {
  hideLoreDrawer();
  selectGuideSection(GUIDE_SECTIONS.includes(section) ? section : "welcome");
  el("museum-guide").hidden = false;
  markGuideSeen();
}
function closeMuseumGuide() {
  el("museum-guide").hidden = true;
  viewport.focus();
}
function refreshGuideFloorPlanIfOpen() {
  if (!el("museum-guide").hidden && el("guide-panel-floorplan") && !el("guide-panel-floorplan").hidden) {
    selectGuideSection("floorplan");
  }
}
el("guide-close").addEventListener("click", closeMuseumGuide);
for (const tab of document.querySelectorAll(".guide-tab")) {
  tab.addEventListener("click", () => selectGuideSection(tab.dataset.section));
}
for (const btn of document.querySelectorAll(".guide-begin")) {
  btn.addEventListener("click", closeMuseumGuide);
}
el("open-rooms").addEventListener("click", () => openMuseumGuide({ section: "floorplan" }));

// A visitor who already named/formed themselves (so the tour never implies
// the name/ghost gate is reopening) can deliberately replay the first-visit
// guided intro from the Guide's own Welcome page — closes the Guide first,
// then runs the exact same startTour() the automatic first-visit run uses,
// without touching the "has toured before"/name/ghost localStorage flags
// (a replay is a visitor's own choice, not a reset of first-visit state).
el("guide-replay-tour").addEventListener("click", () => {
  closeMuseumGuide();
  startTour();
});

function onSceneChange(scene) {
  currentSceneId = scene.id;
  // A scene change is already underway — dismiss any lore drawer left over
  // from the PREVIOUS scene without re-triggering its own auto-opened
  // "return to parent" behaviour (that would double-navigate).
  hideLoreDrawer();
  refreshInteractiveObjects();
  postPresence(scene.id);
  updatePresenceLabel();
  renderCameos();
  if (ambient.isOn) ambient.setGallery(scene.galleryId ?? null);
  if (scene.kind === "closeup" && scene.lore) {
    openLoreCard(scene.caption, scene.lore, null);
    loreDrawerAutoOpened = true;
  }
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
    else if (!el("seance-panel").hidden) closeSeancePanel();
    else if (!el("dossier").hidden) closeDossier();
    else if (!el("donate-gate").hidden) closeDonateGate();
    else if (!el("donate-receipt").hidden) closeReceipt();
    else if (!el("archive-gate").hidden) closeArchive();
    else if (!el("museum-guide").hidden) closeMuseumGuide();
    else if (!el("onboarding").hidden) endTour();
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
  await loadReactions();
  await loadExhibits();

  illustrator = createIllustrationController({
    layerA: el("scene-layer-a"),
    layerB: el("scene-layer-b"),
    world,
    onSceneChange,
    onCameraTransform: clampCameosIntoViewport,
  });
  currentSceneId = illustrator.currentScene().id;

  connectEvents();
  refreshInteractiveObjects();
  updatePresenceLabel();
  postPresence(currentSceneId);

  const namedBefore = hasNamedBefore();
  // A visitor who already chose a name but connected before the ghost-form
  // picker existed has no `ghostType` on their identity at all — show the
  // gate again so they can pick one, with their existing chosen name
  // pre-filled (never make them retype it). A brand new visitor still sees
  // an empty input with its placeholder, not the server's whimsical
  // fallback name.
  if (!namedBefore || !myIdentity.ghostType) {
    if (namedBefore) el("name-input").value = myIdentity.name ?? "";
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
