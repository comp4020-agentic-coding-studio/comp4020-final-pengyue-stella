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
- Scene backgrounds are hand-authored SVGs standing in for real 360 photos.
  The interaction model (pan a wide image, anchor pins at normalised `x, y`)
  must keep working unchanged if a real equirectangular photo replaces an SVG
  later — don't let scene code assume "it's an SVG".

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
- Keep the four scenes flat-illustrated and visually distinct from each other
  (palette, landmark shape) so "which place am I in" never relies on reading
  the title text.

## Checks

`pnpm check` (typecheck + `spec/`) targets the **running app** at `APP_URL`
(default `http://localhost:8080`) — start the server first. `pnpm
check:evidence` is separate and needs no running app. Both chain in CI exactly
as the course's `checks.yml` runs them; see `spec/README.md` for the split
between what the course's own `invariants.test.ts` covers and what's ours to
add.
