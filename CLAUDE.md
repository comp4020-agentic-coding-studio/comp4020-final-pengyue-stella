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
- `setPan(…, {smooth:false})` toggles `.viewport.dragging` as a side effect
  (it's how a real drag kills the transform transition mid-gesture). Any
  non-drag caller of it — `centerPan()` on scene load is the one so far — must
  remove that class itself afterward, or the cursor and the next transition
  stay stuck in "drag" state until the visitor happens to drag once.

## A correction worth keeping

Manual cross-session testing (see `PROCESS.md`) found a real bug: the client
used one `Set` of trace ids both to stop a pin rendering twice **and** to stop
a toast firing twice. An off-screen trace got added to it when its toast
showed, so navigating to that scene later silently dropped its pin forever.
Fixed in `b22c513` by giving the render-dedupe set exactly one job. The
general rule: **a dedupe/seen-set is scoped to one concern.** If two code
paths both want "have I handled this id before", that's two sets, not one —
reusing one almost always means one path's bookkeeping corrupts the other's.

## Process discipline

- Run `pnpm check` before every commit. Never commit or push a failing state.
- One meaningful commit per logical checkpoint, with a message that names the
  decision or fix it completes — not one combined dump at the end.
- Keep changes focused on the task at hand; don't expand scope beyond what was
  asked.
- Never push, deploy, or change repository visibility without being explicitly
  told to.
- Machine-checkable and human-judged are different things: `pnpm check` proves
  the contract holds, not that the design is good. A green run is not the bar
  for "done" — it's the floor.
- Verify actual behaviour (open the running app, exercise the feature) before
  calling something fixed or finished — a passing test suite can still miss a
  broken experience it wasn't written to catch. For this app specifically,
  "verified" means two real sessions (different cookies/browser contexts, e.g.
  separate `agent-browser --session` names) and an actual reload or redeploy —
  a single fetch assertion exercises neither the multi-user claim nor the
  persistence claim.

## This repo across crits 8–10

One repo and one Fly app carry crit 8, 9, 10 and the Final Project submission —
there's no new clone or new stack choice each week.

- Add each new crit's spec tests alongside the previous crits' in `spec/`;
  don't delete or replace an earlier crit's tests when a new one lands.
- `PROCESS.md` is **rewritten at each crit** to describe the project as it
  currently stands (its own header says this) — not appended to indefinitely.
  Fold a past moment forward as a line or two if it's still relevant context;
  don't let it grow into a diary of every session.
- One reflection per crit — `reflections/crit-8.md`, `crit-9.md`, `crit-10.md`
  — each in place by its own cutoff. The sweep reads the exact filename for
  that week; the others staying in the repo doesn't satisfy a missing current
  one.
- Shipping (`/comp4020:ship`) tags the deployed commit `crit-<n>`. That tag can
  move if you reship before the same crit's cutoff (force-push that one tag
  ref, the sole permitted force in this course) but must never move after —
  past the cutoff it records what the tutor marked.

## Checks

`pnpm check` (typecheck + `spec/`) targets the **running app** at `APP_URL`
(default `http://localhost:8080`) — start the server first. `pnpm
check:evidence` is separate and needs no running app. Both chain in CI exactly
as the course's `checks.yml` runs them; see `spec/README.md` for the split
between what the course's own `invariants.test.ts` covers and what's ours to
add. In CI, `check` runs against the same Docker image `deploy` ships, built
fresh with a throwaway `/data` standing in for the Fly volume; `deploy` only
runs once `check` is green and the repo is public.

**Secrets.** `.githooks/pre-commit` (installed by `pnpm install`) blocks any
staged content shaped like the course API key before it's committed — that's
the sensor that matters, since CI's secret scan only ever sees a push that's
already happened. The local `FLY_API_TOKEN` used for manual
`flyctl deploy --remote-only --ha=false -a comp4020-final-pengyue-stella` lives
in `mise.local.toml` (gitignored); CI deploys use a separate copy of the same
name installed as a repo secret. Never put either in a tracked file.
