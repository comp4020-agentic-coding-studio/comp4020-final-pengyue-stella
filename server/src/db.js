// Persistence: SQLite via Node's built-in node:sqlite (stable, unflagged in
// the pinned Node version — see CLAUDE.md), at /data/museum.db on the Fly
// volume. WAL journal mode, synchronous transactions: every exhibit,
// account and vote write commits before its event is broadcast, so nothing
// is ever announced to other visitors before it's durable. High-frequency
// avatar movement is never written here (see docs/adr/0002-transport.md).
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  GALLERIES,
  surfaceById,
  legacySlotPlacement,
  surfacePointFromUv,
  allBuiltinLoreObjects,
  builtinObjectCropInfo,
} from "./world.js";
import { pointInShape, shapeBounds } from "./geometry.js";
import { VERDICTS } from "./constants.js";
import { RELIC_PRESETS_BY_ID, RELIC_PRESETS } from "./relic-presets.js";

const DB_FILE = process.env.MUSEUM_DB_FILE ?? "/data/museum.db";

function ensureDir(file) {
  const dir = dirname(file);
  if (dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}

ensureDir(DB_FILE);
export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS visitors (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS galleries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    order_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS display_slots (
    id TEXT PRIMARY KEY,
    gallery_id TEXT NOT NULL REFERENCES galleries(id),
    x REAL NOT NULL,
    z REAL NOT NULL,
    rotation_y REAL NOT NULL,
    occupied_exhibit_id TEXT
  );

  CREATE TABLE IF NOT EXISTS exhibits (
    id TEXT PRIMARY KEY,
    gallery_id TEXT NOT NULL REFERENCES galleries(id),
    slot_id TEXT NOT NULL UNIQUE REFERENCES display_slots(id),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    donor_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  -- exhibits.rowid (SQLite's implicit integer key, stable and
  -- insertion-ordered since the id column above is a non-integer TEXT
  -- primary key) backs the "Exhibit #N" the dossier/receipt show — a free,
  -- honest display number with no separate counter to keep in sync.

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    exhibit_id TEXT NOT NULL REFERENCES exhibits(id),
    parent_id TEXT REFERENCES accounts(id),
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    visitor_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (account_id, visitor_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Additive migration: `subtype` (which artifact model family within a
// category — see constants.js's SUBTYPES_BY_CATEGORY) was added after this
// table first shipped. Guarded the same way the gallery/slot seeding below
// is idempotent: check before writing, so an exhibits table that already has
// the column (every boot after the first with this code) is never touched,
// and one that doesn't (an older deployed database) gets it without losing
// any existing row.
const exhibitColumns = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumns.some((c) => c.name === "subtype")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN subtype TEXT");
}

// Additive migration: surface-aware free placement (replacing the old
// fixed-box slot arc as the visitor-facing placement model — see
// server/src/world.js's `placementSurfaces`). `slot_id` and `display_slots`
// stay exactly as they were (still the thing the UNIQUE constraint race-
// guards), so every exhibit donated before this shipped keeps resolving
// normally; `surface_id`/`u`/`v`/`scale` are simply NULL on those older rows
// and derived on read via `legacySlotPlacement` (see `placementFor` below)
// rather than backfilled, so no migration can corrupt or lose an existing
// row's own slot assignment.
const exhibitColumnsAfterSubtype = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumnsAfterSubtype.some((c) => c.name === "surface_id")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN surface_id TEXT");
  db.exec("ALTER TABLE exhibits ADD COLUMN placement_u REAL");
  db.exec("ALTER TABLE exhibits ADD COLUMN placement_v REAL");
  db.exec("ALTER TABLE exhibits ADD COLUMN placement_scale REAL");
}

// Additive migration: `visual_id` (the curated relic-preset image catalog —
// see relic-presets.js), added after this table first shipped. An exhibit
// donated before this column existed simply has visual_id = NULL forever
// (never backfilled); the client falls back to the old procedural renderer
// for exactly those rows (see `visualFor` below) — the same "never migrate,
// only derive at read time" discipline `placementFor`'s own legacy-slot
// comment already describes.
const exhibitColumnsAfterSurface = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumnsAfterSurface.some((c) => c.name === "visual_id")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN visual_id TEXT");
}

// Additive migration: `origin` distinguishes a visitor-donated exhibit from
// the seeded Founding Collection and from a built-in museum object turned
// into a real exhibit (see `seedBuiltinLoreExhibits` below) — a labelling
// field only, never a different permission set (accounts/votes work
// identically regardless of origin). Existing rows default to 'donated';
// the one-time backfill below promotes the Founding Collection's own fixed
// ids to 'founding', matching what they already are.
const exhibitColumnsAfterVisual = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumnsAfterVisual.some((c) => c.name === "origin")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN origin TEXT NOT NULL DEFAULT 'donated'");
  db.exec("UPDATE exhibits SET origin = 'founding' WHERE id LIKE 'exhibit_founding_%'");
}

// Additive migration: `visual_id_backfilled` distinguishes a donor's own
// curated preset choice from a visual `backfillLegacyVisualIds()` assigned
// after the fact purely as an archival stand-in — the dossier uses this to
// caption a backfilled image honestly rather than presenting it as the
// donor's own choice.
const exhibitColumnsAfterOrigin = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumnsAfterOrigin.some((c) => c.name === "visual_id_backfilled")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN visual_id_backfilled INTEGER NOT NULL DEFAULT 0");
}

// Additive migration: `closeup_scene_id` — set only by
// `seedBuiltinLoreExhibits()` for the handful of built-in objects that are
// themselves a gallery's own marquee "look closer" trigger (folded into the
// unified dossier model so they get real seeded content too), never
// user-writable. Powers the dossier's "Inspect Closer" action.
const exhibitColumnsAfterBackfillFlag = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumnsAfterBackfillFlag.some((c) => c.name === "closeup_scene_id")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN closeup_scene_id TEXT");
}

// Additive migration: `donor_visitor_id` records which visitor's cookie
// actually donated an exhibit — the true ownership fact `donor_name` (a
// free-text field anyone could type identically) can never serve as (see
// CLAUDE.md). Populated going forward by `donateExhibit`'s INSERT below;
// NULL on every row that predates this column, including the entire
// Founding Collection and every built-in museum object (neither has a real
// owner) AND every real donation made before this feature shipped — those
// older donations simply have no recorded owner forever (never backfilled,
// per this file's "never migrate, only derive" discipline), so "no edit/
// delete available because this donation predates ownership tracking" is
// the honest, expected state for them, not a bug.
const exhibitColumnsAfterCloseup = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumnsAfterCloseup.some((c) => c.name === "donor_visitor_id")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN donor_visitor_id TEXT");
}

// Additive migration: `deleted_at` — a soft-delete marker set only by
// `softDeleteExhibit` (the owner withdrawing their own donation). NULL means
// "not deleted" (every existing row). A soft-deleted row is excluded from
// `allExhibits()`/`exhibitById()`'s normal lookup so the REST API simply
// stops returning it to every visitor, including its own former owner — but
// the row, and every account/vote/event ever attached to it, stays in the
// database forever (CLAUDE.md: historical data is retained, never erased).
const exhibitColumnsAfterDonorVisitor = db.prepare("PRAGMA table_info(exhibits)").all();
if (!exhibitColumnsAfterDonorVisitor.some((c) => c.name === "deleted_at")) {
  db.exec("ALTER TABLE exhibits ADD COLUMN deleted_at TEXT");
}

// Seed galleries + slots from the static world layout, idempotently — this
// is config, never written to via the public API, so re-seeding on every
// boot (INSERT OR IGNORE) just confirms the schema matches the current
// layout rather than duplicating rows.
const insertGallery = db.prepare(
  "INSERT OR IGNORE INTO galleries (id, name, category, order_index) VALUES (?, ?, ?, ?)",
);
const insertSlot = db.prepare(
  "INSERT OR IGNORE INTO display_slots (id, gallery_id, x, z, rotation_y) VALUES (?, ?, ?, ?, ?)",
);
for (const gallery of GALLERIES) {
  insertGallery.run(gallery.id, gallery.name, gallery.category, gallery.orderIndex);
  for (const slot of gallery.slots) {
    insertSlot.run(slot.id, gallery.id, slot.x, slot.z, slot.rotationY);
  }
}

// A synthetic `hall` row, purely to satisfy exhibits.gallery_id's FK for
// the Entrance Hall's own built-in objects (which belong to no real
// gallery) — never shown as a donation destination, never counted among
// the four real galleries the client's `/api/world` reports.
insertGallery.run("hall", "Entrance Hall", "hall", -1);

function logEvent(actorId, eventType, payload) {
  db.prepare(
    "INSERT INTO events (id, actor_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(randomUUID(), actorId ?? null, eventType, JSON.stringify(payload), new Date().toISOString());
}

export function upsertVisitor(id, displayName) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO visitors (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at,
       display_name = COALESCE(?, display_name)`,
  ).run(id, displayName ?? "Visitor", now, now, displayName ?? null);
}

// Two donations on the same surface must never visually overlap — rather
// than a database UNIQUE constraint (which can't express "far enough apart
// in continuous u/v space" the way it can express "exactly this slot id"),
// collision is checked inside the same BEGIN IMMEDIATE transaction that
// performs the insert, against every other exhibit already placed on that
// (gallery, surface) pair. 0.22 is a fraction of the surface's own
// normalized span — comfortably wider than a relic's own footprint at
// default scale, so two confirmed placements never render on top of each
// other.
const MIN_SURFACE_SEPARATION = 0.22;

// The free-placement region (see world.js's `${galleryId}-free` entry) is
// much larger than any of the old named surfaces, so reusing
// MIN_SURFACE_SEPARATION's normalized-u/v threshold unchanged would only
// let a handful of items fit in the whole room. Collision there is checked
// in real viewBox pixels instead — comfortably wider than a free-placed
// relic's own ~100-120px base footprint, but far smaller a fraction of the
// region's own span than 0.22 would be.
const MIN_FREE_PLACEMENT_PIXEL_SEPARATION = 110;

function surfaceCollision(galleryId, surfaceId, u, v, surface) {
  const rows = db
    .prepare(
      "SELECT placement_u AS u, placement_v AS v FROM exhibits WHERE gallery_id = ? AND surface_id = ? AND deleted_at IS NULL",
    )
    .all(galleryId, surfaceId);
  if (surface?.surfaceType === "freeform") {
    const point = surfacePointFromUv(surface, u, v);
    return rows.some((r) => {
      const other = surfacePointFromUv(surface, r.u, r.v);
      return Math.hypot(other.x - point.x, other.y - point.y) < MIN_FREE_PLACEMENT_PIXEL_SEPARATION;
    });
  }
  return rows.some((r) => Math.hypot(r.u - u, r.v - v) < MIN_SURFACE_SEPARATION);
}

// Returns { exhibit } or an { error } naming exactly what failed validation:
// "not_found" (unknown gallery/surface), "incompatible_surface" (this
// relic's subtype isn't allowed on that surface type), "outside_surface"
// (the normalized point doesn't actually fall inside the surface's own
// authorised polygon — never trust a raw client-supplied u/v blindly),
// "invalid_scale", or "surface_taken" (collides with an existing
// placement). `slotId` is still accepted and still used for the gallery's
// own fixed-capacity bookkeeping (display_slots/occupied_exhibit_id, the
// same mechanism spec/archive.test.ts's freeSlot() already exercises) even
// though the *visual* position a visitor sees now comes entirely from
// surfaceId/u/v — this is what keeps "no free display spot in this
// gallery" a real, finite constraint without needing a second counter.
export function donateExhibit({
  galleryId,
  slotId,
  surfaceId,
  u,
  v,
  scale,
  title,
  subtype,
  originClaim,
  donorName,
  visitorId,
  visualId,
}) {
  const slotRow = db
    .prepare("SELECT * FROM display_slots WHERE id = ? AND gallery_id = ?")
    .get(slotId, galleryId);
  if (!slotRow) return { error: "not_found" };

  const galleryRow = db.prepare("SELECT * FROM galleries WHERE id = ?").get(galleryId);
  if (!galleryRow) return { error: "not_found" };

  const located = surfaceById(galleryId, surfaceId);
  if (!located) return { error: "not_found" };
  const { surface } = located;

  if (!(surface.allowedRelicTypes ?? []).includes(subtype)) return { error: "incompatible_surface" };

  const point = surfacePointFromUv(surface, u, v);
  if (!pointInShape(surface.shape, point.x, point.y)) return { error: "outside_surface" };

  const appliedScale = typeof scale === "number" && Number.isFinite(scale) ? scale : 1;
  if (appliedScale < surface.minScale || appliedScale > surface.maxScale) return { error: "invalid_scale" };

  // visualId is now REQUIRED for a NEW donation (the "Classic" procedural-
  // fallback path is retired as a visitor-facing choice — see
  // public/app.js's populateDonateForm, which no longer offers a no-preset
  // submit state) — a curated preset IS how a donor says what the relic
  // looks like AND what subtype it is, so skipping it entirely is now a
  // rejected donation, not a quietly-accepted one. This does NOT touch any
  // already-persisted exhibit: a pre-existing row with visual_id = NULL
  // (predating this requirement) keeps resolving exactly as before via
  // backfillLegacyVisualIds()/the client's defensive procedural fallback —
  // only the INSERT path below is affected.
  if (visualId === undefined || visualId === null) return { error: "visual_required" };
  const preset = RELIC_PRESETS_BY_ID.get(visualId);
  // The free-placement region ("freeform") never appears in a preset's own
  // `compatibleSurfaceTypes` (that list only ever names real wall/shelf/
  // tabletop/cabinet/plinth surface types) — a free placement only needs
  // the preset's category/subtype to match, the same compatibility a named
  // surface's own subtype-vs-surfaceType check already enforced above via
  // `allowedRelicTypes`.
  const validVisual =
    preset &&
    preset.category === galleryRow.category &&
    preset.subtype === subtype &&
    (surface.surfaceType === "freeform" || preset.compatibleSurfaceTypes.includes(surface.surfaceType));
  if (!validVisual) return { error: "invalid_visual" };
  const appliedVisualId = visualId;

  const exhibitId = `exhibit_${randomUUID()}`;
  const accountId = `account_${randomUUID()}`;
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    // The UNIQUE constraint on exhibits.slot_id is what actually prevents a
    // race between two simultaneous donations into the same slot — this
    // row-exists check is a fast, friendly 409 for the common case, not the
    // mechanism that makes it safe.
    const stillFree = db
      .prepare("SELECT occupied_exhibit_id FROM display_slots WHERE id = ?")
      .get(slotId);
    if (stillFree.occupied_exhibit_id) {
      db.exec("ROLLBACK");
      return { error: "slot_taken" };
    }

    if (surfaceCollision(galleryId, surfaceId, u, v, surface)) {
      db.exec("ROLLBACK");
      return { error: "surface_taken" };
    }

    db.prepare(
      "INSERT INTO exhibits (id, gallery_id, slot_id, category, title, donor_name, created_at, subtype, surface_id, placement_u, placement_v, placement_scale, visual_id, donor_visitor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(exhibitId, galleryId, slotId, galleryRow.category, title, donorName, now, subtype, surfaceId, u, v, appliedScale, appliedVisualId, visitorId ?? null);

    db.prepare("UPDATE display_slots SET occupied_exhibit_id = ? WHERE id = ?").run(
      exhibitId,
      slotId,
    );

    db.prepare(
      "INSERT INTO accounts (id, exhibit_id, parent_id, kind, body, author_name, author_id, created_at) VALUES (?, ?, NULL, 'original', ?, ?, ?, ?)",
    ).run(accountId, exhibitId, originClaim, donorName, visitorId ?? "", now);

    logEvent(visitorId, "exhibit.created", { exhibitId, galleryId, slotId, surfaceId, title });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // visitorId here so the donor's own immediate REST response correctly
  // reports isOwnedByRequester: true (server.js strips this field again
  // before the shared `exhibit` SSE broadcast — see its own comment there —
  // so no OTHER connected visitor ever receives it as true for someone
  // else's fresh donation).
  return { exhibit: fullExhibit(exhibitId, visitorId) };
}

// The normalized placement a client should actually render an exhibit at —
// its own surface_id/u/v/scale if it was donated under the surface model,
// or a deterministic default derived from its legacy slot if it predates
// it (CLAUDE.md-aligned brief: "maintain backward compatibility... by
// mapping old slots to default positions"). Never a data migration: an old
// row's slot_id is untouched, this is purely a read-time fallback.
export function placementFor(exhibitRow) {
  if (exhibitRow.surface_id) {
    return { surfaceId: exhibitRow.surface_id, u: exhibitRow.placement_u, v: exhibitRow.placement_v, scale: exhibitRow.placement_scale ?? 1 };
  }
  const gallery = GALLERIES.find((g) => g.id === exhibitRow.gallery_id);
  const slot = gallery?.slots.find((s) => s.id === exhibitRow.slot_id);
  if (!gallery || !slot) return null;
  return legacySlotPlacement(gallery, slot, exhibitRow.subtype);
}

// Returns { account } or { error: "not_found" }.
export function addAccount({ exhibitId, kind, body, challengedAccountId, authorName, visitorId }) {
  // A soft-deleted exhibit (see softDeleteExhibit) is excluded here too — it
  // no longer exists from the API's point of view, so it can't accept new
  // accounts either, same as a genuinely unknown exhibit id.
  const exhibitRow = db.prepare("SELECT id FROM exhibits WHERE id = ? AND deleted_at IS NULL").get(exhibitId);
  if (!exhibitRow) return { error: "not_found" };

  if (challengedAccountId) {
    const parent = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND exhibit_id = ?")
      .get(challengedAccountId, exhibitId);
    if (!parent) return { error: "not_found" };
  }

  const accountId = `account_${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO accounts (id, exhibit_id, parent_id, kind, body, author_name, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(accountId, exhibitId, challengedAccountId ?? null, kind, body, authorName, visitorId ?? "", now);
  logEvent(visitorId, "account.created", { accountId, exhibitId, kind });

  return { account: fullAccount(accountId), exhibitClassification: classifyExhibit(fullExhibit(exhibitId).accounts) };
}

// Owner-only exhibit edit/delete — a brand new feature, additive to the
// donate/account/vote machinery above, never a second parallel path for any
// of it. Ownership is always checked against the real `donor_visitor_id`
// column (never the free-text `donor_name` — see that column's own migration
// comment), and a builtin/founding exhibit (donor_visitor_id IS NULL always)
// can therefore never pass this check for anyone, which is the whole
// belt-and-braces story CLAUDE.md asks for: the primary defense is real
// ownership, origin is just never going to match for those rows.
//
// Returns { exhibit } or { error: "not_found" | "forbidden" | "invalid_title" }.
// Title is a direct field update (exhibits.title is not an account, so
// CLAUDE.md's "an account is never mutated" rule doesn't reach it), logged
// via logEvent for an audit trail exactly like every other write here.
export function updateExhibitTitle({ exhibitId, visitorId, title }) {
  const row = db.prepare("SELECT donor_visitor_id FROM exhibits WHERE id = ? AND deleted_at IS NULL").get(exhibitId);
  if (!row) return { error: "not_found" };
  if (!visitorId || !row.donor_visitor_id || row.donor_visitor_id !== visitorId) return { error: "forbidden" };

  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed) return { error: "invalid_title" };

  db.prepare("UPDATE exhibits SET title = ? WHERE id = ?").run(trimmed, exhibitId);
  logEvent(visitorId, "exhibit.title_edited", { exhibitId, title: trimmed });

  return { exhibit: fullExhibit(exhibitId, visitorId) };
}

// The owner's "edit description" action never overwrites the original
// account's own body (CLAUDE.md: "an account is never mutated or deleted
// once published") — it reuses the exact same mechanism an unrelated
// visitor's counter-evidence already uses: a brand new `accounts` row with
// `kind: "revision"` and `challengedAccountId` pointing at the account being
// revised, authored as the owner. The only thing distinguishing an owner's
// own revision from anyone else's is `authorId === donor_visitor_id`, which
// the client can already see via `isOwnedByRequester` plus the account's own
// `authorName` — no new account kind or table needed.
//
// Returns { account } or { error: "not_found" | "forbidden" }. `not_found`
// covers both an unknown exhibit and an unknown/foreign `challengedAccountId`
// (addAccount already guards the latter).
export function addOwnerDescriptionRevision({ exhibitId, visitorId, body, authorName, challengedAccountId }) {
  const row = db.prepare("SELECT donor_visitor_id FROM exhibits WHERE id = ? AND deleted_at IS NULL").get(exhibitId);
  if (!row) return { error: "not_found" };
  if (!visitorId || !row.donor_visitor_id || row.donor_visitor_id !== visitorId) return { error: "forbidden" };

  return addAccount({
    exhibitId,
    kind: "revision",
    body,
    challengedAccountId,
    authorName,
    visitorId,
  });
}

// Soft delete: the row (and every account/vote/event attached to it) is
// never removed — only `deleted_at` is set, which `fullExhibit`/`allExhibits`
// already exclude on every normal read, so a withdrawn exhibit disappears
// from the API exactly as if it never existed, while its full history stays
// physically in the database forever (CLAUDE.md: retain historical data).
// The display slot it occupied is released in the SAME transaction, so a new
// donation can claim it immediately once this commits. Returns { ok: true }
// or { error: "not_found" | "forbidden" }.
//
// `exhibits.slot_id` is `NOT NULL UNIQUE REFERENCES display_slots(id)` —
// freeing the real slot (`occupied_exhibit_id = NULL`) alone is NOT enough to
// let a new exhibit claim it, because the soft-deleted row would still
// permanently hold that same slot_id forever (a second row can never take a
// slot_id another row still references, deleted or not). So the deleted
// row's own slot_id is re-pointed to a fresh, never-rendered tombstone slot —
// exactly the same "a row still needs *some* unique slot to satisfy the FK,
// even though it holds no real display position" reasoning
// seedBuiltinLoreExhibits' own virtual slots already use — before the real
// slot is released, so the UNIQUE constraint is never violated.
export function softDeleteExhibit({ exhibitId, visitorId }) {
  const row = db.prepare("SELECT donor_visitor_id, slot_id, gallery_id FROM exhibits WHERE id = ? AND deleted_at IS NULL").get(exhibitId);
  if (!row) return { error: "not_found" };
  if (!visitorId || !row.donor_visitor_id || row.donor_visitor_id !== visitorId) return { error: "forbidden" };

  const now = new Date().toISOString();
  const tombstoneSlotId = `${exhibitId}_withdrawn_slot`;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO display_slots (id, gallery_id, x, z, rotation_y, occupied_exhibit_id) VALUES (?, ?, 0, 0, 0, ?)",
    ).run(tombstoneSlotId, row.gallery_id, exhibitId);
    db.prepare("UPDATE exhibits SET slot_id = ?, deleted_at = ? WHERE id = ?").run(tombstoneSlotId, now, exhibitId);
    db.prepare("UPDATE display_slots SET occupied_exhibit_id = NULL WHERE id = ?").run(row.slot_id);
    logEvent(visitorId, "exhibit.deleted", { exhibitId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { ok: true };
}

// Returns { vote } or { error: "not_found" }.
export function castVote({ accountId, visitorId, verdict }) {
  const accountRow = db.prepare("SELECT id, exhibit_id FROM accounts WHERE id = ?").get(accountId);
  if (!accountRow) return { error: "not_found" };

  const previousClassification = classifyExhibit(fullExhibit(accountRow.exhibit_id).accounts);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO votes (id, account_id, visitor_id, verdict, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, visitor_id) DO UPDATE SET verdict = excluded.verdict, updated_at = excluded.updated_at`,
  ).run(`vote_${randomUUID()}`, accountId, visitorId, verdict, now);
  logEvent(visitorId, "vote.changed", { accountId, verdict });

  return {
    exhibitId: accountRow.exhibit_id,
    account: fullAccount(accountId),
    previousClassification,
    exhibitClassification: classifyExhibit(fullExhibit(accountRow.exhibit_id).accounts),
  };
}

function voteTallyFor(accountId) {
  const rows = db
    .prepare("SELECT verdict, COUNT(*) as n FROM votes WHERE account_id = ? GROUP BY verdict")
    .all(accountId);
  const tally = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const row of rows) tally[row.verdict] = row.n;
  return tally;
}

function verdictFromTally(tally) {
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  if (total === 0) return "Unclassified";
  const max = Math.max(...Object.values(tally));
  const winners = Object.entries(tally).filter(([, n]) => n === max);
  return winners.length > 1 ? "Disputed" : winners[0][0];
}

export function visitorVoteOn(accountId, visitorId) {
  if (!visitorId) return null;
  const row = db
    .prepare("SELECT verdict FROM votes WHERE account_id = ? AND visitor_id = ?")
    .get(accountId, visitorId);
  return row?.verdict ?? null;
}

function fullAccount(accountId, visitorId) {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  if (!row) return null;
  const votes = voteTallyFor(accountId);
  return {
    id: row.id,
    exhibitId: row.exhibit_id,
    parentId: row.parent_id,
    challengedAccountId: row.parent_id,
    kind: row.kind,
    body: row.body,
    authorName: row.author_name,
    createdAt: row.created_at,
    votes,
    verdict: verdictFromTally(votes),
    myVote: visitorVoteOn(accountId, visitorId),
  };
}

// The exhibit's own "currently accepted" classification (the blueprint's
// dossier contract: "Current classification: DISPUTED"), derived purely
// from vote totals at read time — never a field anyone writes directly (see
// CLAUDE.md). The account with the most total votes across all its verdicts
// is "currently accepted"; a tie for most-voted is Disputed at the exhibit
// level too, and an exhibit with no votes anywhere is Unclassified. If the
// single most-voted account's own verdict is itself Disputed (a tied
// Believable/Suspicious/Cursed split on that one account), that bubbles up
// unchanged rather than being silently resolved into one verdict.
function classifyExhibit(accounts) {
  const totals = accounts.map((a) => Object.values(a.votes).reduce((x, y) => x + y, 0));
  const max = Math.max(0, ...totals);
  if (max === 0) return "Unclassified";
  const leaders = accounts.filter((_, i) => totals[i] === max);
  if (leaders.length > 1) return "Disputed";
  return leaders[0].verdict;
}

function fullExhibit(exhibitId, visitorId) {
  // Soft-deleted rows (see `deleted_at`'s own migration comment above) are
  // excluded here, not just filtered client-side — the REST API simply
  // stops returning a withdrawn exhibit to anyone, including its own former
  // owner, while the row and its full account/vote/event history stay
  // physically in the database forever.
  const row = db.prepare("SELECT *, rowid AS number FROM exhibits WHERE id = ? AND deleted_at IS NULL").get(exhibitId);
  if (!row) return null;
  const accountRows = db
    .prepare("SELECT id FROM accounts WHERE exhibit_id = ? ORDER BY created_at ASC")
    .all(exhibitId);
  const accounts = accountRows.map((a) => fullAccount(a.id, visitorId));
  return {
    id: row.id,
    number: row.number,
    galleryId: row.gallery_id,
    slotId: row.slot_id,
    category: row.category,
    subtype: row.subtype,
    title: row.title,
    donorName: row.donor_name,
    createdAt: row.created_at,
    accounts,
    classification: classifyExhibit(accounts),
    placement: row.origin === "builtin" ? null : placementFor(row),
    visualId: row.visual_id ?? null,
    origin: row.origin,
    visualIdBackfilled: !!row.visual_id_backfilled,
    closeupSceneId: row.closeup_scene_id ?? null,
    // Per-requester only (never broadcast globally — see server.js's
    // donate/edit/delete handlers, which strip this before an `sse.broadcast`
    // so no OTHER visitor's client ever receives a stale/wrong value for a
    // peer's own exhibit): true exactly when the requesting visitor is the
    // one who actually donated this exhibit, checked against the real
    // `donor_visitor_id` column, never the free-text `donor_name`. Always
    // false for `founding`/`builtin` exhibits (donor_visitor_id is NULL for
    // both) and for any donation made before this column existed.
    isOwnedByRequester: !!visitorId && !!row.donor_visitor_id && row.donor_visitor_id === visitorId,
    // Builtin-object dossier preview support: the owning scene id + the
    // object's own hand-traced `shape` (world.js's builtinObjectCropInfo),
    // so the client can render a CSS background-image crop of the EXACT
    // real painted object straight from that scene's own gallery art
    // (public/app.js's renderBuiltinObjectVisual) instead of a generic
    // procedural shape. `shape` is already public (the same shape served on
    // every scene's `interactiveObjects`), so this adds no new server-only
    // data — just the lookup a client would otherwise have to duplicate.
    // Non-builtin exhibits never carry this field.
    cropInfo:
      row.origin === "builtin" ? builtinObjectCropInfo(row.id.replace(/^exhibit_builtin_/, "")) : null,
  };
}

export function exhibitById(exhibitId, visitorId) {
  return fullExhibit(exhibitId, visitorId);
}

export function allExhibits(visitorId) {
  const rows = db
    .prepare("SELECT id FROM exhibits WHERE deleted_at IS NULL ORDER BY created_at ASC")
    .all();
  return rows.map((r) => fullExhibit(r.id, visitorId));
}

export function occupiedSlotIds() {
  const rows = db
    .prepare("SELECT id FROM display_slots WHERE occupied_exhibit_id IS NOT NULL")
    .all();
  return new Set(rows.map((r) => r.id));
}

// A small, honestly-identified "Founding Collection": one real, persisted
// exhibit (plus its original account, same model as a donated one — the
// database doesn't distinguish "seeded" from "donated" by row shape, only by
// donor name) per gallery, so a freshly-created database never shows an
// empty archive before anyone has donated anything. Idempotent via a fixed
// id per gallery (`exhibit_founding_<galleryId>`) — re-running this on every
// boot is a no-op once seeded, the same pattern the gallery/slot seed above
// already uses. Deliberately claims only the gallery's FIRST slot, leaving
// every other slot free — spec/archive.test.ts's freeSlot() helper (and any
// real donor) must always find room.
const FOUNDING_COLLECTION = {
  portraits: {
    subtype: "painting",
    title: "The Unfinished Sitter",
    originClaim: "Commissioned in 1884; the sitter's face was never completed. The museum acquired it exactly as left on the easel.",
  },
  memento: {
    subtype: "clock",
    title: "The Clock That Keeps No Hour",
    originClaim: "Found stopped at no particular time in an estate clearance. It has never been wound since arriving, yet it is never found at the same hour twice.",
  },
  specimen: {
    subtype: "biological",
    title: "The Cataloguer's Specimen",
    originClaim: "Logged by the museum's first curator in 1901 as 'pending identification.' It remains pending.",
  },
  childhood: {
    subtype: "doll",
    title: "The Nursery's First Doll",
    originClaim: "The founding donation to this gallery — present, by the ledger's account, before the nursery it depicts was ever furnished.",
  },
};

export function seedFoundingCollection() {
  const now = new Date().toISOString();
  for (const gallery of GALLERIES) {
    const piece = FOUNDING_COLLECTION[gallery.id];
    if (!piece) continue;
    const exhibitId = `exhibit_founding_${gallery.id}`;
    const existing = db.prepare("SELECT id FROM exhibits WHERE id = ?").get(exhibitId);
    if (existing) continue;

    const slot = gallery.slots[0];
    const accountId = `account_founding_${gallery.id}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      const stillFree = db.prepare("SELECT occupied_exhibit_id FROM display_slots WHERE id = ?").get(slot.id);
      if (stillFree?.occupied_exhibit_id) {
        db.exec("ROLLBACK");
        continue;
      }
      db.prepare(
        "INSERT INTO exhibits (id, gallery_id, slot_id, category, title, donor_name, created_at, subtype) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(exhibitId, gallery.id, slot.id, gallery.category, piece.title, "The Founding Collection", now, piece.subtype);
      db.prepare("UPDATE display_slots SET occupied_exhibit_id = ? WHERE id = ?").run(exhibitId, slot.id);
      db.prepare(
        "INSERT INTO accounts (id, exhibit_id, parent_id, kind, body, author_name, author_id, created_at) VALUES (?, ?, NULL, 'original', ?, ?, ?, ?)",
      ).run(accountId, exhibitId, piece.originClaim, "The Founding Collection", "", now);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

// Every built-in museum object (world.js's `allBuiltinLoreObjects()` — the
// chandelier, the busts, the folded map's silent neighbours, and so on)
// becomes a real, persisted `exhibits` row here, exactly like a donated or
// Founding Collection one — same table, same accounts/votes machinery, the
// only difference is `origin = 'builtin'` and a stable id derived from the
// world object's own id (`exhibit_builtin_<objectId>`), so re-running this
// on every boot is a no-op once seeded (same `existing` guard pattern as
// `seedFoundingCollection` above).
//
// A built-in object has no gallery/slot/surface placement of its own — it
// renders at its world-authored `shape`, never a second surface-anchored
// glow (see public/app.js's `refreshInteractiveObjects`, which excludes
// `origin: 'builtin'` exhibits from the donated-relic render loop). But
// `exhibits.slot_id` is `NOT NULL UNIQUE REFERENCES display_slots(id)`, so
// each builtin exhibit still gets its own tiny virtual slot (never rendered,
// never counted toward a gallery's real donation capacity) purely to
// satisfy that constraint without relaxing it.
export function seedBuiltinLoreExhibits() {
  const now = new Date().toISOString();
  const insertVirtualSlot = db.prepare(
    "INSERT OR IGNORE INTO display_slots (id, gallery_id, x, z, rotation_y) VALUES (?, ?, 0, 0, 0)",
  );
  for (const object of allBuiltinLoreObjects()) {
    const exhibitId = `exhibit_builtin_${object.id}`;
    const existing = db.prepare("SELECT id FROM exhibits WHERE id = ?").get(exhibitId);
    if (existing) continue;

    const virtualSlotId = `${object.id}_virtual_slot`;
    const accountId = `account_builtin_${object.id}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      insertVirtualSlot.run(virtualSlotId, object.galleryId);
      db.prepare(
        "INSERT INTO exhibits (id, gallery_id, slot_id, category, title, donor_name, created_at, subtype, origin, closeup_scene_id) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'builtin', ?)",
      ).run(exhibitId, object.galleryId, virtualSlotId, object.category, object.label, "Museum collection", now, object.closeupSceneId);
      db.prepare("UPDATE display_slots SET occupied_exhibit_id = ? WHERE id = ?").run(exhibitId, virtualSlotId);
      db.prepare(
        "INSERT INTO accounts (id, exhibit_id, parent_id, kind, body, author_name, author_id, created_at) VALUES (?, ?, NULL, 'original', ?, ?, ?, ?)",
      ).run(accountId, exhibitId, object.text, "Museum collection", "", now);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

// Idempotent startup backfill: every exhibit donated/seeded before the
// curated relic-preset catalog existed has `visual_id = NULL` forever
// (never migrated, per `placementFor`'s own "never migrate, only derive"
// discipline elsewhere in this file) — EXCEPT this one field, which this
// pass explicitly asks to backfill so no primitive procedural model ever
// renders in a visible, illustrated gallery. Matches purely on the
// exhibit's own category (there is exactly one curated preset per
// category, not per subtype), so this is an "archival representative
// image," not a claim the image depicts the exact original subtype —
// `visual_id_backfilled` lets the client caption that honestly. Never
// touches title/subtype/accounts/votes/placement. Builtin exhibits are
// excluded — they render via their own world-object shape, never a relic
// image.
export function backfillLegacyVisualIds() {
  const rows = db
    .prepare("SELECT id, category FROM exhibits WHERE visual_id IS NULL AND origin != 'builtin'")
    .all();
  for (const row of rows) {
    const preset = RELIC_PRESETS.find((p) => p.category === row.category);
    if (!preset) continue;
    db.prepare("UPDATE exhibits SET visual_id = ?, visual_id_backfilled = 1 WHERE id = ?").run(preset.id, row.id);
  }
}
