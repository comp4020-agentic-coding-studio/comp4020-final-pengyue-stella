# Plan — Traces of ANU

Working implementation plan for the C8 slice. Update this when the direction
materially changes; it isn't a changelog.

## What C8 needs to prove

Core loop: **explore a place → discover traces → leave a trace → another open
session receives it → it remains when users return.**

The final project overall needs multi-user, real-time and persistence; C8's own
spec only asks for "alive" + a first README, but building the real thing now
(rather than a static placeholder first) means crit 9's real-time requirement
is already met and crit 9 can focus on the "several people in it" decision
instead of bolting real-time on afterwards.

## Architecture

**Server:** Node.js, ESM, **zero runtime npm dependencies**. Built-ins only:
`node:http` for routing and static files, Server-Sent Events (plain HTTP
streaming, no `ws`) for push, a ~60-line hand-rolled markdown renderer for
`/readme/` (we control the README's own markdown, so full CommonMark
compliance buys nothing). See the ADR in `PROCESS.md` for why.

**Storage:** an append-only JSONL file at `/data/traces.jsonl`, loaded into
memory on boot, appended to on every new trace, indexed by scene in memory.
No SQLite, no ORM — the whole dataset for a handful of campus scenes fits in
memory comfortably inside 256MB, and an append-only log is the simplest thing
that survives a restart or redeploy correctly.

**Real-time:** one shared SSE hub. Every connected browser opens
`GET /api/events`; every new trace is broadcast to all of them as a
`trace` event. The client only renders a pin if the event's `sceneId` matches
the scene it's currently looking at; otherwise it shows a small ambient toast
("someone left a trace near Union Court") so the site still feels alive
without forcing a scene switch.

**Identity:** no accounts. First visit gets an HttpOnly cookie
(`visitor=<uuid>`); the server derives a stable whimsical name + colour from
that id (e.g. "Quiet Wombat", a hue) so two browsers are visibly different
people and the same browser stays the same person across reloads.

**Scenes:** four real ANU photographs (CC-licensed, via Wikimedia Commons —
credits in README.md), each built by `tools/build-scenes.py` into a
pseudo-360 look-around: the real photo shown sharp at its own size, centred on
a wider canvas whose edges are a softly blurred extension of the *same* photo
for pan room. (A first version used hand-authored SVG illustrations instead;
replaced after the crit feedback that it read as a generic prototype rather
than specifically ANU — see `PROCESS.md`.) Each scene is an `<img>` much wider
than its viewport, panned by drag / swipe / arrow keys, exactly like a
one-axis Street View, starting centred on the real photo so it's in frame on
any viewport width. Exits between scenes are rendered as pins anchored to a
normalised `(x, y)` on the image — the **same anchoring mechanism user traces
use** — positioned where you'd have to pan to find them, so moving between
scenes is a spatial discovery, not a menu. Swapping these for real
equirectangular photos later only touches the scene background, not the
interaction model.

Scene graph (a loop, so there's always somewhere new to walk to): Kambri Lawn
↔ Chifley Library ↔ Union Court ↔ University Avenue ↔ (back to Kambri).

## Data model

```jsonc
// one line per trace in /data/traces.jsonl
{
  "id": "t_...",
  "sceneId": "kambri",
  "x": 0.42, "y": 0.63,      // normalised to the scene image, 0..1
  "emoji": "💡",              // one of a small fixed set (tip/memory/story/spark)
  "body": "the vending machine in...",
  "authorName": "Quiet Wombat",
  "authorColor": "#...",
  "createdAt": "2026-..."
}
```

Scene graph and exits are static config in `server/src/scenes.js`, not stored
data — they're part of the app, not something a visitor creates.

## API

- `GET /` — the app shell
- `GET /readme/` — README.md rendered in full (spec requirement)
- `GET /api/scenes` — the four scenes + their exits
- `GET /api/scenes/:id/traces` — traces for one scene
- `POST /api/scenes/:id/traces` — create a trace (rate-limited per visitor)
- `GET /api/events` — SSE stream: `trace` events, `presence` events (a cheap
  "N people wandering right now" count)

## Explicitly out of scope for this slice

Accounts/profiles, freehand drawing, image uploads, animated creatures,
day/night secrets, long easter-egg trails, more than four scenes, trace
editing/deletion, moderation tooling. Revisit after C8 if the core loop holds
up and time allows — not before.

## Build order

1. Static scaffold: server boots, serves `/`, `/readme/` renders README.
2. Scene data + pannable viewport + exit pins (navigation working, no traces
   yet).
3. Trace read/write API + compose-bubble UI + pin rendering (loop works for
   one visitor, no live push yet).
4. SSE wiring both directions; verify a second tab receives a trace without
   reloading.
5. Persistence: restart the dev server, confirm traces survive.
6. Write `spec/` tests for the parts worth asserting mechanically (see
   `spec/README.md`'s split between mechanical and judged).
7. README / PROCESS / reflection; manual end-to-end pass; deploy if the Fly
   token is available by then.

## Status

All seven build-order steps above are done and deployed at
`comp4020-final-pengyue-stella.fly.dev`; see `PROCESS.md` for what was checked
and how. Next up is crit 9's "several people in it" decision.
