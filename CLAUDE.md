# Your harness — Traces of ANU

Durable rules for working in this repo. Task-specific notes belong in commit
messages or `PLAN.md`, not here.

## Stack, fixed for this project

Node.js, ESM, **zero runtime npm dependencies** — `node:http` only, no
framework, no `ws`, no ORM. See `PROCESS.md`'s decision record for why. If a
future crit genuinely needs a dependency, add it deliberately and say why in
`PROCESS.md`; don't reach for one by habit.

- Persistence is the append-only file at `/data/traces.jsonl` (served from the
  Fly volume in production, a scratch dir locally). Never write trace data
  anywhere else, and never replace the file wholesale — append only, so a
  crash mid-write can't lose history.
- Real-time is Server-Sent Events over `GET /api/events`, one shared hub
  broadcasting to every connected browser. Don't add WebSockets alongside it;
  the traffic is one-directional (server → browser) and SSE already covers
  that within the ~1s the brief asks for.
- Scene backgrounds are **real ANU photographs** (Wikimedia Commons, CC BY-SA —
  credits in README.md), built into a pseudo-panorama by
  `tools/build-scenes.py`: the real photo shown sharp at its own aspect,
  centred on a wider canvas whose sides are a softly blurred, darkened
  extension of the *same* photo for pan room — not invented content. The
  interaction model (pan a wide image, anchor pins at normalised `x, y`)
  doesn't know or care that the image is a JPEG; it kept working unchanged
  when this replaced the earlier hand-illustrated SVG version (see
  `PROCESS.md`), and must keep working if real 360/equirectangular photography
  replaces these later. Raw source photos live in `tools/sources/`
  (gitignored, large, fully reproducible — see the script's header for exact
  source URLs); only the built output in `public/scenes/` is tracked.

## Conventions that matter here

- **User-supplied text is never trusted as HTML.** Trace bodies render via
  `textContent`/`createElement`, never `innerHTML`, on the client. The server
  doesn't need to escape it for the JSON API — escaping happens exactly once,
  at render.
- **Trace and exit pins share one anchoring mechanism**: `{x, y}` normalised
  0–1 against the scene image's own box. A new kind of overlay marker reuses
  this, it doesn't invent a second coordinate system.
- **Every interaction works with a mouse, a touchscreen and a keyboard.**
  Panning supports drag, swipe and arrow keys; the compose bubble and pins are
  reachable by Tab/Enter. This is checked live at crits — don't let it regress
  silently behind a mouse-only feature.
- Keep the four scenes visually distinct, recognisable ANU places (a real
  landmark, not a generic "plaza" or "walk") so "which place am I in" never
  relies on reading the title text — and so the app reads as ANU specifically
  within the first screen, not as a generic campus-shaped prototype.
- A mark (trace or exit) must read clearly against a busy photo, not just a
  flat colour: the white-ring treatment on `.pin-dot` is load-bearing, not
  decorative — don't simplify it away.

## A correction worth keeping

Manual cross-session testing (see `PROCESS.md`) found a real bug: the client
used one `Set` of trace ids both to stop a pin rendering twice **and** to stop
a toast firing twice. An off-screen trace got added to it when its toast
showed, so navigating to that scene later silently dropped its pin forever.
Fixed in `b22c513` by giving the render-dedupe set exactly one job. The
general rule: **a dedupe/seen-set is scoped to one concern.** If two code
paths both want "have I handled this id before", that's two sets, not one —
reusing one almost always means one path's bookkeeping corrupts the other's.

## Checks

`pnpm check` (typecheck + `spec/`) targets the **running app** at `APP_URL`
(default `http://localhost:8080`) — start the server first. `pnpm
check:evidence` is separate and needs no running app. Both chain in CI exactly
as the course's `checks.yml` runs them; see `spec/README.md` for the split
between what the course's own `invariants.test.ts` covers and what's ours to
add.
