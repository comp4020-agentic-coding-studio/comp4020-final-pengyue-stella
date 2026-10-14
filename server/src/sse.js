// One shared hub for Server-Sent Events, carried over from the prior
// project's architecture (see docs/adr/0002-transport.md for why this stays
// the only live channel rather than adding a WebSocket for movement). Every
// connected browser is a response object kept open; broadcasting writes the
// same event to all of them. There is one shared world now (not per-scene
// rooms), so presence here is "everyone in the museum," not scoped further.
const clients = new Map(); // res -> visitorId
const lastPosition = new Map(); // visitorId -> { x, z, yaw, name, color }

export function addClient(res, visitorId) {
  clients.set(res, visitorId);
}

export function removeClient(res) {
  const visitorId = clients.get(res);
  clients.delete(res);
  // Only announce a departure once no other tab/connection for this visitor
  // remains open, so a reload (close-then-reconnect) doesn't flicker an
  // avatar out and back in for everyone else.
  const stillConnected = [...clients.values()].includes(visitorId);
  if (visitorId && !stillConnected) lastPosition.delete(visitorId);
  return { visitorId, stillConnected };
}

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcast(event, data, { exceptVisitorId } = {}) {
  for (const [res, visitorId] of clients.entries()) {
    if (exceptVisitorId && visitorId === exceptVisitorId) continue;
    try {
      write(res, event, data);
    } catch {
      // A dead connection fails here before 'close' has run; drop it so one
      // stale client doesn't throw on every broadcast after.
      clients.delete(res);
    }
  }
}

// Every other visitor currently known to be somewhere in the museum, so a
// freshly-connected client can draw them immediately rather than waiting
// for their next move.
export function knownPresence(exceptVisitorId) {
  return [...lastPosition.entries()]
    .filter(([id]) => id !== exceptVisitorId)
    .map(([visitorId, p]) => ({ visitorId, ...p }));
}

export function recordAndBroadcastMove(visitorId, position) {
  lastPosition.set(visitorId, position);
  broadcast("presence", { visitorId, ...position }, { exceptVisitorId: visitorId });
}

export function broadcastDeparture(visitorId) {
  broadcast("presence-left", { visitorId });
}

export function connectedCount() {
  return new Set(clients.values()).size;
}
