# ADR 0002: SSE + rate-limited POST for movement, not a WebSocket layer

**Status:** Accepted — final-project pivot to The Cursed Museum

## Context

The blueprint's own "Realtime multiplayer and persistence" section suggests
a Node/WebSocket layer for presence, position and room events, alongside
SQLite for durable archive data, explicitly allowing "an equally coherent
alternative if it explains the decision in an ADR." The course brief's fixed
requirement is narrower than any specific protocol: a change in one session
must reach every other open session within about a second, with no reload.

The prior project in this repo (Traces of ANU) already proved an SSE hub
meets that ~1s bar for one-directional server→browser push, server-side
broadcasting to every open connection with no bidirectional channel needed
for *that* traffic.

The new requirement this project adds is avatar movement: a client now also
needs to tell the *server* something, every time it moves. That's new; the
old app never needed client→server push beyond ordinary request/response.

## Options considered

- **WebSockets**, as suggested. Full duplex, a conventional choice for game-
  like movement traffic. Cost: a second live protocol to implement, test, and
  keep alive (reconnect/backoff logic independent from the SSE hub's), on a
  stack that otherwise has zero runtime dependencies and no socket library
  to reach for (`ws` is exactly the kind of "reach for a dependency by habit"
  `CLAUDE.md`'s rule warns against) — meaning a hand-rolled WebSocket server
  over `node:http`'s upgrade event, maintained alongside the existing SSE hub
  doing a /different/ half of the same job.
- **SSE for everything the server pushes out, rate-limited `POST` for what a
  client reports in.** Movement isn't latency-critical gameplay — the
  brief's bar is "about a second," not frame-perfect sync — so a client
  posting its own position on a short interval (e.g. every 100–150ms, only
  when it actually moved) and the server relaying that over the *existing*
  SSE hub is a complete multiplayer-movement loop using one live channel,
  not two. This is the direction chosen.

## Decision

Keep exactly one live channel: `GET /api/events` (SSE), broadcasting
`presence`, `exhibit`, `account`, `vote` events, unchanged in spirit from the
prior project's hub. Movement is `POST /api/presence/move` — small, bounded,
rate-limited per visitor — validated and then relayed to every *other*
connected SSE client as a `presence` event carrying the mover's id, position
and yaw. The server is the single authority: a client never trusts another
client's claimed position directly, only what the server has relayed.

## Consequences

**Benefit.** No new protocol, no new dependency, one reconnect/backoff
story instead of two, and the existing SSE hub (`server/src/sse.js`) is
reused rather than replaced — carrying forward a component that already has
a crit's worth of verified behaviour behind it (scene-scoped presence, ADR
0001) rather than retiring it for an unrelated technology mid-project.

**Real cost, accepted.** A WebSocket's round-trip latency is lower than
POST-then-broadcast for truly twitch-sensitive movement; this museum's pace
(walking visitors in a static room, not a shooter) doesn't need that
headroom, and the brief's own bar is ~1 second. If a future crit's feedback
says movement reads as laggy under real testing, revisiting this decision
(adding a WebSocket specifically for movement, SSE untouched for everything
else) is the documented fallback — not a silent scope change.

**Verification.** Checked directly: two independent browser sessions moving
simultaneously, confirming each sees the other's avatar update within the
~1s budget, before this ADR is marked anything but a plan.
