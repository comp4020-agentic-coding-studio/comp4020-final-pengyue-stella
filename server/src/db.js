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
import { GALLERIES } from "./world.js";
import { VERDICTS } from "./constants.js";

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

// Returns { exhibit } or { error: "slot_taken" | "not_found" }.
export function donateExhibit({ galleryId, slotId, title, originClaim, donorName, visitorId }) {
  const slotRow = db
    .prepare("SELECT * FROM display_slots WHERE id = ? AND gallery_id = ?")
    .get(slotId, galleryId);
  if (!slotRow) return { error: "not_found" };

  const galleryRow = db.prepare("SELECT * FROM galleries WHERE id = ?").get(galleryId);
  if (!galleryRow) return { error: "not_found" };

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

    db.prepare(
      "INSERT INTO exhibits (id, gallery_id, slot_id, category, title, donor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(exhibitId, galleryId, slotId, galleryRow.category, title, donorName, now);

    db.prepare("UPDATE display_slots SET occupied_exhibit_id = ? WHERE id = ?").run(
      exhibitId,
      slotId,
    );

    db.prepare(
      "INSERT INTO accounts (id, exhibit_id, parent_id, kind, body, author_name, author_id, created_at) VALUES (?, ?, NULL, 'original', ?, ?, ?, ?)",
    ).run(accountId, exhibitId, originClaim, donorName, visitorId ?? "", now);

    logEvent(visitorId, "exhibit.created", { exhibitId, galleryId, slotId, title });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { exhibit: fullExhibit(exhibitId) };
}

// Returns { account } or { error: "not_found" }.
export function addAccount({ exhibitId, kind, body, challengedAccountId, authorName, visitorId }) {
  const exhibitRow = db.prepare("SELECT id FROM exhibits WHERE id = ?").get(exhibitId);
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

// Returns { vote } or { error: "not_found" }.
export function castVote({ accountId, visitorId, verdict }) {
  const accountRow = db.prepare("SELECT id, exhibit_id FROM accounts WHERE id = ?").get(accountId);
  if (!accountRow) return { error: "not_found" };

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO votes (id, account_id, visitor_id, verdict, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, visitor_id) DO UPDATE SET verdict = excluded.verdict, updated_at = excluded.updated_at`,
  ).run(`vote_${randomUUID()}`, accountId, visitorId, verdict, now);
  logEvent(visitorId, "vote.changed", { accountId, verdict });

  return {
    exhibitId: accountRow.exhibit_id,
    account: fullAccount(accountId),
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
  const row = db.prepare("SELECT * FROM exhibits WHERE id = ?").get(exhibitId);
  if (!row) return null;
  const accountRows = db
    .prepare("SELECT id FROM accounts WHERE exhibit_id = ? ORDER BY created_at ASC")
    .all(exhibitId);
  const accounts = accountRows.map((a) => fullAccount(a.id, visitorId));
  return {
    id: row.id,
    galleryId: row.gallery_id,
    slotId: row.slot_id,
    category: row.category,
    title: row.title,
    donorName: row.donor_name,
    createdAt: row.created_at,
    accounts,
    classification: classifyExhibit(accounts),
  };
}

export function exhibitById(exhibitId, visitorId) {
  return fullExhibit(exhibitId, visitorId);
}

export function allExhibits(visitorId) {
  const rows = db.prepare("SELECT id FROM exhibits ORDER BY created_at ASC").all();
  return rows.map((r) => fullExhibit(r.id, visitorId));
}

export function occupiedSlotIds() {
  const rows = db
    .prepare("SELECT id FROM display_slots WHERE occupied_exhibit_id IS NOT NULL")
    .all();
  return new Set(rows.map((r) => r.id));
}
