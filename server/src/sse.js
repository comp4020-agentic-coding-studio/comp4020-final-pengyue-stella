// One shared hub for Server-Sent Events, carried over unchanged in
// mechanism from the prior project's architecture (see
// docs/adr/0003-scene-exploration.md) and from this project's own first
// version. Every connected browser is a response object kept open;
// broadcasting writes the same event to all of them.
//
// Presence is scene-scoped, not a position: the pivot to 2.5D scene
// exploration (ADR 0003) removed continuous avatar movement entirely, so
// there is no (x, z, yaw) to relay any more — a visitor is just "currently
// looking at scene S," the same shape ADR 0001 ("Traces of ANU") used for
// campus presence. `POST /api/presence` (see server.js) re-tags a visitor's
// connection whenever they navigate; this module turns that into a live
// per-scene headcount, never anything more specific (no position, no
// trajectory) — "how many people are here with me," not a tracking feed.
const clients = new Map(); // res -> { visitorId, sceneId }

export function addClient(res, visitorId, sceneId) {
  clients.set(res, { visitorId, sceneId });
}

export function removeClient(res) {
  const entry = clients.get(res);
  clients.delete(res);
  if (!entry) return { visitorId: null };
  const stillConnected = [...clients.values()].some((c) => c.visitorId === entry.visitorId);
  return { visitorId: entry.visitorId, sceneId: entry.sceneId, stillConnected };
}

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcast(event, data, { exceptVisitorId } = {}) {
  for (const [res, entry] of clients.entries()) {
    if (exceptVisitorId && entry.visitorId === exceptVisitorId) continue;
    try {
      write(res, event, data);
    } catch {
      // A dead connection fails here before 'close' has run; drop it so one
      // stale client doesn't throw on every broadcast after.
      clients.delete(res);
    }
  }
}

// Every scene currently holding at least one connection, with its count —
// used to hydrate a freshly-connected client with the full picture rather
// than waiting for the next re-tag/disconnect to reveal it.
export function sceneCounts() {
  const counts = new Map();
  const seenVisitorsByScene = new Map();
  for (const { visitorId, sceneId } of clients.values()) {
    if (!sceneId) continue;
    let seen = seenVisitorsByScene.get(sceneId);
    if (!seen) {
      seen = new Set();
      seenVisitorsByScene.set(sceneId, seen);
    }
    seen.add(visitorId);
  }
  for (const [sceneId, visitors] of seenVisitorsByScene) counts.set(sceneId, visitors.size);
  return Object.fromEntries(counts);
}

export function connectedCount() {
  return new Set([...clients.values()].map((c) => c.visitorId)).size;
}

// Re-tags every open connection for `visitorId` (a visitor can have more
// than one tab) and broadcasts the fresh count for both the scene they left
// and the scene they entered, so every other client's headcount updates
// within one SSE round-trip — no polling, no reload.
export function setVisitorScene(visitorId, sceneId) {
  let previousSceneId = null;
  for (const [res, entry] of clients.entries()) {
    if (entry.visitorId !== visitorId) continue;
    previousSceneId = entry.sceneId;
    clients.set(res, { visitorId, sceneId });
  }
  const counts = sceneCounts();
  if (previousSceneId && previousSceneId !== sceneId) {
    broadcast("scene-presence", { sceneId: previousSceneId, count: counts[previousSceneId] ?? 0 });
  }
  broadcast("scene-presence", { sceneId, count: counts[sceneId] ?? 0 });
}

export function broadcastDeparture(visitorId, sceneId) {
  if (sceneId) {
    const counts = sceneCounts();
    broadcast("scene-presence", { sceneId, count: counts[sceneId] ?? 0 });
  }
  broadcast("presence-left", { visitorId });
}
