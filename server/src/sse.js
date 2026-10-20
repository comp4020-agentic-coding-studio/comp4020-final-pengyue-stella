// One shared hub for Server-Sent Events, carried over unchanged in
// mechanism from the prior project's architecture (see
// docs/adr/0003-scene-exploration.md) and from this project's own first
// version. Every connected browser is a response object kept open;
// broadcasting writes the same event to all of them.
//
// Presence is scene-scoped, not a position: there is no (x, z, yaw) to relay
// — a visitor is just "currently looking at scene S," the same shape ADR
// 0001 ("Traces of ANU") used for campus presence. `POST /api/presence`
// (see server.js) re-tags a visitor's connection whenever they navigate;
// this module turns that into a live per-scene roster (who, by a stable
// public key and display name — never the raw visitor cookie) and headcount,
// restoring visible visitor cameos without ever reintroducing a position or
// trajectory to relay.
const clients = new Map(); // res -> { visitorId, sceneId, publicKey, displayName }

export function addClient(res, visitorId, sceneId, publicKey, displayName) {
  clients.set(res, { visitorId, sceneId, publicKey, displayName });
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

// The visible roster for one scene: one entry per distinct visitor currently
// tagged with it (a visitor open in two tabs counts once), each only a
// stable public key, a display name, and a colour — never the raw visitor
// cookie value, never a position. This is what restores visible cameos
// without reintroducing anything the scene-exploration pivot deliberately
// removed (see docs/adr/0003-scene-exploration.md).
export function visitorsInScene(sceneId) {
  const byKey = new Map();
  for (const { sceneId: s, visitorId, publicKey, displayName } of clients.values()) {
    if (s !== sceneId || !publicKey) continue;
    byKey.set(publicKey, { publicKey, displayName, visitorId });
  }
  return [...byKey.values()].map(({ publicKey, displayName }) => ({ publicKey, displayName }));
}

// The scene a visitor is currently tagged with (their most recent
// `/api/presence` report), used to scope a focus broadcast to the right
// room without the client having to re-assert its own scene on every
// focus event. A visitor open in two tabs on different scenes is an edge
// case not worth resolving precisely — the first matching connection wins.
export function sceneIdForVisitor(visitorId) {
  for (const entry of clients.values()) {
    if (entry.visitorId === visitorId) return entry.sceneId ?? null;
  }
  return null;
}

export function connectedCount() {
  return new Set([...clients.values()].map((c) => c.visitorId)).size;
}

// Re-tags every open connection for `visitorId` (a visitor can have more
// than one tab) and broadcasts the fresh count + roster for both the scene
// they left and the scene they entered, so every other client's headcount
// and visible cameos update within one SSE round-trip — no polling, no
// reload.
export function setVisitorScene(visitorId, sceneId, publicKey, displayName) {
  let previousSceneId = null;
  for (const [res, entry] of clients.entries()) {
    if (entry.visitorId !== visitorId) continue;
    previousSceneId = entry.sceneId;
    clients.set(res, { visitorId, sceneId, publicKey: publicKey ?? entry.publicKey, displayName: displayName ?? entry.displayName });
  }
  const counts = sceneCounts();
  if (previousSceneId && previousSceneId !== sceneId) {
    broadcast("scene-presence", {
      sceneId: previousSceneId,
      count: counts[previousSceneId] ?? 0,
      visitors: visitorsInScene(previousSceneId),
    });
  }
  broadcast("scene-presence", { sceneId, count: counts[sceneId] ?? 0, visitors: visitorsInScene(sceneId) });
}

// Broadcasts an event only to clients currently tagged with `sceneId` — used
// for the focus signal (a visitor turning to look at an object), which is
// only meaningful to other visitors sharing that same room; broadcasting it
// globally would mean every client re-filters by scene itself for no
// benefit, and would leak "who is looking at what" to rooms that can't even
// see that visitor's cameo.
export function broadcastToScene(sceneId, event, data, { exceptVisitorId } = {}) {
  for (const [res, entry] of clients.entries()) {
    if (entry.sceneId !== sceneId) continue;
    if (exceptVisitorId && entry.visitorId === exceptVisitorId) continue;
    try {
      write(res, event, data);
    } catch {
      clients.delete(res);
    }
  }
}

export function broadcastDeparture(visitorId, sceneId) {
  if (sceneId) {
    const counts = sceneCounts();
    broadcast("scene-presence", { sceneId, count: counts[sceneId] ?? 0, visitors: visitorsInScene(sceneId) });
  }
  broadcast("presence-left", { visitorId });
}
