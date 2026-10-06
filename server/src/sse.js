// One shared hub for Server-Sent Events. Every connected browser is just a
// response object we keep open and write to; broadcasting is writing the
// same event to all of them. Traffic here is one-directional (server ->
// browser), which is the whole reason SSE is enough and a WebSocket would be
// more than this needs.
const clients = new Set();

export function addClient(res) {
  clients.add(res);
}

export function removeClient(res) {
  clients.delete(res);
}

export function clientCount() {
  return clients.size;
}

function write(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcast(event, data) {
  for (const res of clients) {
    try {
      write(res, event, data);
    } catch {
      // A dead connection fails here before the 'close' handler has run;
      // drop it so one stale client doesn't throw on every broadcast after.
      clients.delete(res);
    }
  }
}

export function broadcastPresence() {
  broadcast("presence", { count: clientCount() });
}
