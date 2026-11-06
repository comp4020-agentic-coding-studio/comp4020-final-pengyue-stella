# ADR 0002: Keep SSE + HTTP POST; do not migrate to WebSocket yet

**Status:** Accepted — updated 2026-11-06 after the scene-exploration pivot

## Context

The blueprint's "Realtime multiplayer and persistence" section suggests a
Node/WebSocket layer for presence and room events alongside SQLite, while
explicitly allowing an equally coherent alternative when the decision is
explained in an ADR. The assessed requirement is protocol-neutral: a change
in one open session must reach other open sessions within about one second,
without a reload.

An earlier version of this ADR discussed continuously relaying avatar
position and yaw. That is no longer the product. The current museum uses
illustrated scenes and **scene-scoped presence**: a visitor reports a scene
only when they navigate, never a continuous coordinate stream. The current
realtime workload is therefore low-frequency and event-driven:

- `GET /api/events` opens one `EventSource` connection per tab;
- the server sends `hello`, `scene-presence`, archive changes (`exhibit`,
  `account`, `vote`, `exhibit.updated`, `exhibit.deleted`), `activity`,
  `focus`, and room-scoped `interact` events over that connection;
- the browser reports a scene change, focus change, Séance message,
  reaction, or reach-out through small validated HTTP `POST` requests;
- durable mutations such as donation, account creation, voting, editing,
  and withdrawal remain ordinary request/response operations committed to
  SQLite before their corresponding SSE event is broadcast.

SSE and WebSocket are transport protocols, not application frameworks. The
commonly-used Node package `ws` would provide a WebSocket implementation,
but adding that package does not by itself improve the museum's interaction
design or reliability.

## Options considered

| Concern | SSE + HTTP POST (current) | WebSocket |
| --- | --- | --- |
| Server-to-browser updates | Native fit | Native fit |
| Browser-to-server updates | Separate validated requests | Same persistent connection |
| Connection setup | Standard HTTP response | HTTP upgrade handshake |
| Reconnection | Browser `EventSource` reconnects automatically | Application must own reconnect, backoff, re-subscription, and queued sends |
| Message acknowledgement | Normal HTTP status and response body | Must be designed as an application-level message/acknowledgement protocol |
| High-frequency coordinate or binary traffic | More overhead; not its target use case | Better fit and lower per-message overhead |
| Current museum workload | Well matched | Technically valid but under-used |
| Runtime dependency | None | Normally adds `ws` or equivalent |
| Test surface | One push channel plus existing HTTP endpoints | Socket lifecycle, message routing, errors, acknowledgements, reconnects, and HTTP fallbacks |

### Performance interpretation

WebSocket has a real performance advantage for genuinely high-frequency,
bidirectional traffic: continuous avatar coordinates, collaborative cursor
movement, real-time drawing, fast-action gameplay, audio/video signalling,
or binary messages sent many times per second. It avoids creating a new HTTP
request for every client-to-server message and keeps both directions on one
connection.

That advantage is not material for the current museum. Scene changes happen
occasionally; focus reports are debounced; Séance messages and reactions are
human-paced; archive changes are infrequent. The course target is roughly
one second, not frame-level synchronization. For these events, network
round-trip time, rendering, image loading, animation, interaction clarity,
and reconnect feedback dominate any protocol-level difference a visitor
could perceive. Replacing SSE would therefore be unlikely to improve user
satisfaction by itself.

SSE also has a useful recovery property here: `EventSource` reconnects
automatically. On a fresh or re-established connection, the server sends a
`hello` snapshot containing scene counts and rosters. After a reconnect the
client re-fetches the archive, so any donation/account/vote broadcast missed
during the gap is recovered from SQLite rather than assumed lost forever.

## Decision

Keep one server-to-browser live channel: `GET /api/events` using SSE. Keep
client-to-server actions as small, bounded, rate-limited HTTP requests.
Keep durable writes on the existing REST endpoints and broadcast only after
their SQLite transaction has committed.

This decision is based on workload shape and recovery behaviour, not only
on the repository's zero-runtime-dependency rule. Even if that rule were
removed, WebSocket would still not provide a meaningful experience benefit
for the current event rates.

Do not hand-roll a WebSocket server merely to preserve a literal zero-
dependency count. If a future requirement genuinely needs WebSocket, make a
narrow, documented exception for a maintained implementation such as `ws`,
with protocol and reconnect tests. The broader rule should become "no new
runtime dependency without a demonstrated requirement," rather than being
deleted wholesale.

## Consequences

### Benefits

- One live-channel lifecycle and one reconnection model.
- Native browser `EventSource` support and automatic retry.
- Ordinary HTTP status codes for validation, rate limits, authorization,
  and error reporting on client-to-server actions.
- Durable archive operations remain easy to exercise and inspect as HTTP
  requests.
- No new production dependency or separate socket protocol to secure and
  test.
- The existing `server/src/sse.js` room/scene routing remains reusable.

### Accepted costs

- A client-to-server ephemeral action requires a POST before the server can
  relay it, so its theoretical round-trip latency and header overhead are
  higher than a WebSocket message.
- SSE is text-only. This is harmless for the project's small JSON events but
  would be a limitation for future binary streaming.
- Very many tabs can create many long-lived HTTP responses. The current app
  uses one stream per tab and is far below the scale where this is the
  product's bottleneck.

### Reliability follow-ups that do not require WebSocket

The most useful transport improvements are small SSE hardening tasks:

1. send a comment heartbeat periodically so an idle reverse proxy does not
   silently expire the stream;
2. expose a restrained "Reconnecting…" state while `EventSource` is not
   open, and clear it after the next `hello`;
3. continue treating the reconnect-time archive refresh as the durable
   source of truth;
4. monitor connection count, reconnect frequency, and broadcast failures
   before changing protocols based on assumed performance.

## Scaling boundary

The current realtime hub stores connected responses and presence in a
process-local `Map`. If the Fly deployment is scaled to multiple Node
instances, a visitor connected to instance A will not automatically receive
an event emitted on instance B. This limitation exists with both SSE and
WebSocket; changing the browser protocol does not solve it.

Before horizontally scaling, add a shared publish/subscribe layer (for
example Redis or NATS) or deliberately pin the application to one instance.
A shared event bus and instance-aware presence model would improve real
multi-instance correctness more than replacing SSE with WebSocket.

## Estimated migration cost

These are architectural estimates, not a commitment:

- **Harden the existing SSE path:** approximately 30–100 lines across 2–4
  files for heartbeat, visible reconnect state, and focused tests.
- **Hybrid migration:** approximately 250–450 lines across 5–8 files to move
  only ephemeral presence/focus/Séance traffic to WebSocket while keeping
  durable REST operations unchanged.
- **Full replacement:** approximately 500–900 lines touched across 8–12
  files to replace SSE and the related POST flow, define message envelopes
  and acknowledgements, implement reconnection/re-subscription, update the
  server hub and client handlers, and rewrite realtime tests and ADRs.

The full replacement has a meaningful regression surface: duplicate or
out-of-order events, sends during reconnect, stale room membership, cookie
identity during the upgrade, authorization errors without HTTP semantics,
and test races across a shared live connection.

## Reconsideration triggers

Revisit this ADR when at least one of these becomes a real requirement or
is demonstrated by measurement:

- continuous position/cursor/state updates at roughly 10 or more messages
  per second per visitor;
- interactive latency consistently exceeds the product's target because of
  the POST-then-broadcast path, rather than rendering or network conditions;
- binary realtime messages are required;
- HTTP request overhead becomes measurable at the expected concurrency;
- a feature needs ordered bidirectional session messages with explicit
  acknowledgements and cannot be expressed cleanly as REST plus events.

If that happens, prefer a **hybrid** transition first: WebSocket for the new
high-frequency ephemeral channel, REST for durable mutations, and SSE left
in place until equivalent reconnect and recovery behaviour is proven. Do
not replace the working transport solely because WebSocket benchmarks are
faster for a workload this museum does not have.

## Verification standard

The current choice is considered valid when two independent browser
sessions can:

- see room presence change without reload;
- receive donations, accounts, votes, edits, and withdrawals after commit;
- exchange room-scoped Séance interactions within the approximately one-
  second requirement;
- reconnect and recover a complete archive/roster state after a transient
  disconnect.

If those behaviours meet the target, a protocol rewrite is not justified by
performance claims alone.
