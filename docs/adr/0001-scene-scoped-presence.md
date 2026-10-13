# ADR 0001: Presence is a per-scene count, not a global count or cursor positions

**Status:** Accepted — C9

## Context

The final project brief asks for a design decision about several-people-in-it
behaviour (see `PROCESS.md`, "Open for the next crit"). The app already
broadcasts a presence count over the existing SSE hub (`sse.js`), but it's
campus-wide: every connected browser is counted together regardless of which
of the four scenes it's looking at. That technically satisfies "real-time"
but not "feels shared in this place" — a visitor standing alone at Union Court
sees "3 people wandering campus" and has no way to tell whether any of those 3
are actually nearby.

The goal (per the C9 brief) is to make visitors feel they share the campus
without the app becoming a social tracking platform — so whatever ships has to
answer "how many people are here with me" without exposing who they are or
where exactly they are.

## Decision

Make presence **scene-scoped**: each open SSE connection is tagged with the
scene its visitor is currently viewing, and presence events report
`{ sceneId, count }` for one scene at a time. The client only updates its
on-screen count when the event's `sceneId` matches the scene currently on
screen; counts for other scenes are received but ignored (mirroring the
existing trace/toast split in `app.js`'s SSE handler).

Mechanically:

- `GET /api/events` takes an initial `?scene=` query param so the connection
  is tagged correctly from the moment it opens (the client always knows its
  starting scene before it opens the `EventSource`).
- A new `POST /api/presence { sceneId }` re-tags a visitor's open
  connection(s) whenever they navigate between scenes client-side (the SSE
  stream itself stays open the whole session — only its scene tag changes).
- On tag or disconnect, the server rebroadcasts the affected scene(s)' counts
  to every connection currently tagged with that scene.

## Options considered

1. **Global count only (status quo).** Already shipped, cheapest to keep, but
   answers the wrong question — it's campus traffic, not room occupancy.
2. **Scene-scoped count (chosen).** One new route, one extra field per
   tracked connection, no new persisted data, same SSE transport. Answers
   "who's here with me" directly while still exposing nothing more specific
   than an integer.
3. **Live cursor positions.** Rejected. Requires either a return channel from
   browser to server (bidirectional, pushing toward WebSockets — against the
   zero-dependency, one-directional SSE architecture recorded in `PROCESS.md`)
   or frequent polling, and exposes real-time per-visitor location within a
   scene, which is close to tracking and explicitly the thing the brief warns
   against normalising.

## Consequences

- New route: `POST /api/presence`.
- `sse.js`'s client registry changes shape (adds a scene tag per connection
  and a visitor→connections index) but stays a single in-memory structure,
  still broadcast-only, still one-directional server→browser for the actual
  push.
- No change to `traces.jsonl`, `store.js`, or the trace broadcast path —
  presence is ephemeral, in-memory only, never written to disk.
- Known limitation: a visitor with two tabs open on different scenes shares
  one scene tag server-side (tagging is per-visitor-identity, not per-tab),
  so both tabs reflect whichever tab navigated most recently. Acceptable at
  classroom scale with no accounts; worth revisiting only if it causes
  confusion in practice.
- Privacy: the payload leaving the server is `{ sceneId, count }` — an
  integer, nothing else. No names, no colours, no coordinates, no visitor ids
  cross the wire in a presence event.

## Verification

Two independent browser sessions (separate cookies), same method already used
for traces in `PROCESS.md`:

1. Session A at Union Court, session B at Kambri Lawn — A shows "1 person
   here", not "2".
2. Navigate B to Union Court — A's count updates to "2 people here" within
   about a second, no reload.
3. Close or navigate B away — A's count drops back to "1" within about a
   second.
4. Confirm the existing trace broadcast still fires independently in the same
   two sessions (regression check against `broadcast("trace", …)`).
