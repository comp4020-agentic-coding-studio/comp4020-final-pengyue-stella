// One shared hub for Server-Sent Events. Every connected browser is just a
// response object we keep open and write to; broadcasting is writing the
// same event to all of them. Traffic here is one-directional (server ->
// browser), which is the whole reason SSE is enough and a WebSocket would be
// more than this needs.
//
// Presence is scene-scoped (see docs/adr/0001-scene-scoped-presence.md): each
// connection is tagged with the scene its visitor is currently viewing, kept
// in-memory only, never written to traces.jsonl. `sceneOf` answers "which
// scene is this response tagged with"; `byVisitor` answers "which open
// connections belong to this visitor", so a presence POST (a different
// request to the same identity, not the same request as the open stream) can
// find the right response objects to retag.
const sceneOf = new Map(); // res -> sceneId | null
const byVisitor = new Map(); // visitorId -> Set<res>

export function addClient(res, visitorId, sceneId) {
  sceneOf.set(res, sceneId ?? null);
  const set = byVisitor.get(visitorId) ?? new Set();
  set.add(res);
  byVisitor.set(visitorId, set);
}

// Returns the scene this connection was tagged with at the moment of
// removal — not necessarily the one it connected with, since a presence POST
// can retag a still-open connection after it was added. The caller needs
// this live value to broadcast the right scene's updated count.
export function removeClient(res, visitorId) {
  const sceneId = sceneOf.get(res) ?? null;
  sceneOf.delete(res);
  const set = byVisitor.get(visitorId);
  if (set) {
    set.delete(res);
    if (set.size === 0) byVisitor.delete(visitorId);
  }
  return sceneId;
}

export function countForScene(sceneId) {
  let n = 0;
  for (const s of sceneOf.values()) {
    if (s === sceneId) n++;
  }
  return n;
}

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcast(event, data) {
  for (const res of sceneOf.keys()) {
    try {
      write(res, event, data);
    } catch {
      // A dead connection fails here before the 'close' handler has run;
      // drop it so one stale client doesn't throw on every broadcast after.
      sceneOf.delete(res);
    }
  }
}

export function broadcastPresenceFor(sceneId) {
  if (!sceneId) return;
  broadcast("presence", { sceneId, count: countForScene(sceneId) });
}

// Retags every open connection for one visitor to a new scene, returning the
// distinct scene ids (old and new) whose counts just changed so the caller
// can rebroadcast exactly those.
export function setVisitorScene(visitorId, sceneId) {
  const set = byVisitor.get(visitorId);
  if (!set || set.size === 0) return [];
  const changed = new Set();
  for (const res of set) {
    const prev = sceneOf.get(res);
    if (prev === sceneId) continue;
    if (prev) changed.add(prev);
    sceneOf.set(res, sceneId);
    changed.add(sceneId);
  }
  return [...changed];
}
