# Your harness — The Cursed Museum

Durable rules for working in this repo. Task-specific notes belong in commit
messages or `PLAN.md`, not here.

This repo previously carried **Traces of ANU** (crits 8–9); it was pivoted
to **The Cursed Museum** for the Final Project per
`design/The_Cursed_Museum_Project_Blueprint.pdf`. Git history before the
pivot commit still belongs to this repo's process evidence — never rewrite
or force-push it away.

## Stack, fixed for this project

Node.js, ESM, **zero runtime npm dependencies** beyond what Node itself
ships — `node:http`, `node:sqlite` (stable and unflagged on the pinned Node
version; confirmed working before committing to it), Server-Sent Events, and
Three.js vendored as a static file in `public/vendor/` (the one deliberate
exception, documented in `public/vendor/README.md` — it never touches the
server's own dependency graph and is fetched by the browser, not installed
by npm). If a future crit genuinely needs a new dependency, add it
deliberately and say why in `PROCESS.md`; don't reach for one by habit.

- Persistence is SQLite at `/data/museum.db` (the Fly volume in production,
  a scratch dir locally), `journal_mode = WAL`. Every exhibit, account and
  vote write is a transaction, committed before its event is broadcast —
  never announce a change to other visitors before it's durable.
- Visitor presence is scene-scoped, never a continuous position, and
  **never** persisted to SQLite — only relayed live (see
  `docs/adr/0003-scene-exploration.md`). A visitor reports which fixed
  scene they're currently viewing over a rate-limited `POST /api/presence`;
  the server never accepts or relays a free-form position.
- Real-time is one shared Server-Sent Events hub over `GET /api/events`,
  reused unchanged in spirit from the prior project — see
  `docs/adr/0002-transport.md` for why this is one channel, not a second
  WebSocket layer, and don't add one without updating that ADR first.
- The world is a fixed **scene graph**, not a live-steered camera: a small,
  server-defined set of illustrated scenes (`server/src/world.js`), each
  with hotspots and display slots placed as a `{x, z}` percentage anchor
  of that scene's image, not a 3D world coordinate (see
  `docs/adr/0004-illustrated-scenes.md`). There is no camera a visitor
  steers and no collision; moving between scenes is a click/tap on a
  hotspot or exhibit card, never a movement key. Three.js is kept only for
  small, disposable, non-interactive still-frame previews of a donated
  exhibit's procedural model (`public/world/artifacts.js`'s
  `renderArtifactPreview`) — never a live render loop. A visitor's visible
  cameo (medallion + display name) is derived from their scene presence and
  a stable, non-reversible per-visitor key (`identity.js`'s
  `publicKeyFor`), never their raw cookie or visitor id.

## Conventions that matter here

- **User-supplied text is never trusted as HTML.** Display names, exhibit
  titles, origin claims, and every account body render via
  `textContent`/`createElement`, never `innerHTML`, on the client. The
  server doesn't need to escape it for the JSON API — escaping happens
  exactly once, at render.
- **An account is never mutated or deleted once published.** "Rewrite
  history" means a new row with `challengedAccountId` pointing at what it
  disputes, never an `UPDATE`/`DELETE` on an existing account. The
  "currently accepted" account is a value *derived* from votes at read
  time, never a field written directly — don't introduce a code path that
  writes it.
- **One active vote per `(accountId, visitorId)`, enforced at the database
  layer** (a unique constraint), not just checked in application code — a
  repeat vote is an `UPDATE`, never a second row. A tie renders as
  **Disputed**; an account with zero votes renders as **Unclassified** —
  never silently default either case to a specific verdict.
- **Exhibits occupy a specific, validated display slot.** A donation names a
  gallery and a slot; the server checks the slot belongs to that gallery and
  is currently free, inside the same transaction that creates the exhibit.
  Never let two donations race onto the same slot — this is exactly the
  kind of invariant a unique constraint (`display_slots.occupied_exhibit_id`
  claimed once) should enforce, not a check-then-write in application code.
- **Every interaction works with a mouse, a touchscreen and a keyboard.**
  Every hotspot and exhibit card is a real focusable element mouse-click,
  tap, and Tab+Enter all resolve the same way; the dossier, donation/account
  forms, archive, and hub-turn controls are reachable and operable by
  Tab/Enter alone. This is checked live at crits — don't let it regress
  silently behind a mouse-only feature.
- Keep the four galleries visually distinct (lighting colour-grade, prop
  density, palette accent) so "which gallery am I in" never relies on
  reading the sign text alone.
- A mark on an exhibit that's currently interactable must read clearly
  against a crowded, dimly-lit scene — a highlight/glow treatment is
  load-bearing, not decorative, the same way the prior project's pin-ring
  treatment was; don't simplify it away.

## A correction worth keeping (carried over from Traces of ANU)

Manual cross-session testing there found a real bug: the client used one
`Set` of ids both to stop a pin rendering twice **and** to stop a toast
firing twice, and one path's bookkeeping silently corrupted the other's.
Fixed by giving the render-dedupe set exactly one job. The general rule:
**a dedupe/seen-set is scoped to one concern.** If two code paths both want
"have I handled this id before," that's two sets, not one. This applies
directly here: cameo-presence dedup (by `publicKey`, in `sse.js`'s
`visitorsInScene`) and archive-event dedup must not share a set either.

## Process discipline

- Run `pnpm check` before every commit. Never commit or push a failing
  state.
- One meaningful commit per logical checkpoint (design, world, archive,
  interaction, multiplayer, polish), with a message that names the decision
  or fix it completes — not one combined dump at the end.
- Keep changes focused on the task at hand; don't expand scope beyond what
  was asked.
- Never push, deploy, or change repository visibility without being
  explicitly told to.
- Machine-checkable and human-judged are different things: `pnpm check`
  proves the contract holds, not that the design is good. A green run is not
  the bar for "done" — it's the floor.
- Verify actual behaviour (open the running app, exercise the feature)
  before calling something fixed or finished. For this app specifically,
  "verified" means two real sessions (different cookies/browser contexts)
  moving and acting at once, and an actual reload or redeploy — a single
  fetch assertion exercises neither the multiplayer claim nor the
  persistence claim.

## This repo across crits 8–10 and the Final Project

One repo and one Fly app carried crit 8, crit 9 (as Traces of ANU) and now
carry crit 10 and the Final Project submission (as The Cursed Museum) —
there's no new clone or new stack choice each week; the pivot is itself the
documented decision for this week, recorded in `PROCESS.md` and this file.

- `spec/` tests for the retired app (`spec/traces.test.ts`) were removed as
  part of the pivot, since they assert endpoints that no longer exist; the
  course's own `spec/invariants.test.ts` (checks `/` and `/readme/`) is
  untouched and still the floor. New spec files for this project's own
  invariants (world, archive, votes, realtime) live alongside it.
- `PROCESS.md` is **rewritten at each crit** to describe the project as it
  currently stands (its own header says this) — not appended to
  indefinitely. Fold a past moment forward as a line or two if it's still
  relevant context; don't let it grow into a diary of every session.
- One reflection per crit — `reflections/crit-8.md`, `crit-9.md`, `crit-10.md`
  — each in place by its own cutoff. The sweep reads the exact filename for
  that week; the others staying in the repo doesn't satisfy a missing
  current one.
- Shipping (`/comp4020:ship`) tags the deployed commit `crit-<n>`. That tag
  can move if you reship before the same crit's cutoff (force-push that one
  tag ref, the sole permitted force in this course) but must never move
  after — past the cutoff it records what the tutor marked.

## Checks

`pnpm check` (typecheck + `spec/`) targets the **running app** at `APP_URL`
(default `http://localhost:8080`) — start the server first. `pnpm
check:evidence` is separate and needs no running app. Both chain in CI
exactly as the course's `checks.yml` runs them; see `spec/README.md` for the
split between what the course's own `invariants.test.ts` covers and what's
ours to add. In CI, `check` runs against the same Docker image `deploy`
ships, built fresh with a throwaway `/data` standing in for the Fly volume;
`deploy` only runs once `check` is green and the repo is public.

**Secrets.** `.githooks/pre-commit` (installed by `pnpm install`) blocks any
staged content shaped like the course API key before it's committed — that's
the sensor that matters, since CI's secret scan only ever sees a push that's
already happened. The local `FLY_API_TOKEN` used for manual
`flyctl deploy --remote-only --ha=false -a comp4020-final-pengyue-stella`
lives in `mise.local.toml` (gitignored); CI deploys use a separate copy of
the same name installed as a repo secret. Never put either in a tracked
file.
