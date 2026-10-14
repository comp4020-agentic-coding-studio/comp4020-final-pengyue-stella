// No accounts. A visitor is just whoever holds a particular cookie, and the
// name/colour attached to that cookie are derived, not chosen — so two
// browsers are visibly different people (different cookie, different name)
// and the same browser stays the same person across a reload, a day, a
// restart of the server.
import { randomUUID } from "node:crypto";

const ADJECTIVES = [
  "Quiet", "Wandering", "Sunlit", "Nocturnal", "Caffeinated", "Drowsy",
  "Curious", "Breezy", "Studious", "Restless", "Early-Morning", "Midnight",
  "Barefoot", "Half-Awake", "Cheerful", "Lanky",
];

const NOUNS = [
  "Wombat", "Possum", "Cockatoo", "Magpie", "Ibis", "Currawong",
  "Kookaburra", "Echidna", "Bandicoot", "Cicada", "Night-Owl", "Backpacker",
  "Librarian", "Cyclist", "Skateboarder", "Postgrad",
];

function hashString(s) {
  // FNV-1a — small, dependency-free, fine for picking words, not for security.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function nameFor(visitorId) {
  const h = hashString(visitorId);
  const adjective = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
  return `${adjective} ${noun}`;
}

// Comma-separated syntax, not the newer space-separated CSS4 form: browsers'
// CSS parser accepts either, so this is a safe, maximally-compatible choice
// for the one place this value is consumed — `whoamiEl.style.color` in
// `public/app.js`. (An earlier version also fed this into
// `THREE.Color.setStyle` to tint a 3D avatar's dressing; that regex only
// matched the comma form, which is what made this choice deliberate rather
// than arbitrary. The avatar itself was removed in the scene-exploration
// pivot — see `docs/adr/0003-scene-exploration.md` — but the comma-form
// choice is kept, since it's still strictly safer than the alternative.)
export function colorFor(visitorId) {
  const h = hashString(`colour:${visitorId}`);
  const hue = h % 360;
  return `hsl(${hue}, 70%, 42%)`;
}

function parseCookies(header) {
  const out = new Map();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return out;
}

const VISITOR_COOKIE = "visitor";
const NAME_COOKIE = "visitor_name";
const ONE_YEAR = 60 * 60 * 24 * 365;
const NAME_RE = /^[\p{L}\p{N} '-]{1,40}$/u;

// Reads the visitor cookie off the request, or mints one. If the visitor has
// chosen a display name (a separate cookie, set via POST /api/me), that name
// wins; otherwise a stable whimsical name is derived from the id, so a
// visitor is never nameless even before they type anything. Returns the
// identity plus any Set-Cookie headers to attach to the response — callers
// send them however they're building their response.
export function identify(req) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies.get(VISITOR_COOKIE);
  const id = existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : randomUUID();
  const isNew = id !== existing;

  const chosenName = cookies.get(NAME_COOKIE);
  const name = chosenName && NAME_RE.test(chosenName) ? chosenName : nameFor(id);

  const headers = [];
  if (isNew) headers.push(`${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax`);

  return {
    id,
    name,
    color: colorFor(id),
    isNew,
    setCookieHeaders: headers,
  };
}

// Validates and returns a Set-Cookie header for a visitor-chosen display
// name, or null if the candidate is invalid (caller should 400).
export function nameCookieFor(candidate) {
  const trimmed = typeof candidate === "string" ? candidate.trim() : "";
  if (!NAME_RE.test(trimmed)) return null;
  return `${NAME_COOKIE}=${encodeURIComponent(trimmed)}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax`;
}
