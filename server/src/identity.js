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

export function colorFor(visitorId) {
  const h = hashString(`colour:${visitorId}`);
  const hue = h % 360;
  return `hsl(${hue} 70% 42%)`;
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
const ONE_YEAR = 60 * 60 * 24 * 365;

// Reads the visitor cookie off the request, or mints one. Returns the
// identity plus the Set-Cookie header value to attach to the response when
// `isNew` is true — callers send it however they're building their response.
export function identify(req) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies.get(VISITOR_COOKIE);
  const id = existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : randomUUID();
  const isNew = id !== existing;
  return {
    id,
    name: nameFor(id),
    color: colorFor(id),
    isNew,
    setCookieHeader: isNew
      ? `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; SameSite=Lax`
      : null,
  };
}
