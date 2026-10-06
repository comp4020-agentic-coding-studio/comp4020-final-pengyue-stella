# Process overview

Rewritten at each crit to describe the project as it stands, not appended to —
this is the state as of C8. `PLAN.md` is the working plan; this is the account
of how it was built and why.

## From brief to harness

The brief fixes three things (multi-user, real-time, persists) and leaves
everything else, including the app itself, open. Before writing any code we
turned the student's concept — an immersive, connected-scene layer over campus
where traces are anchored to places — into
[`e3e1934`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/e3e1934),
which is `PLAN.md`: the data model, the API, which four scenes, and explicitly
what was staying out (accounts, drawing, uploads, more than four scenes).
`CLAUDE.md` was written alongside it, not after: the stack rules and the
user-content-safety rule ("never `innerHTML`") were decided before they were
needed, not patched in once something broke.

## Stack decision record

**Context.** One Fly machine, 256MB, one volume, no separate database. The
brief needs multi-user, real-time (~1s), and persistence across restarts and
redeploys.

**Options considered.**

- *Astro/React + a managed Postgres-like store.* The course default for the
  static half of the term, but a separate database app is explicitly outside
  the course's Fly setup, and a framework's dev server and build step buy
  nothing for an app this small — most of a React app's weight goes toward
  problems (routing, client state libraries) this app doesn't have.
- *Node + Express + `ws` + SQLite.* A conventional, reasonable choice. Rejected
  for being more than the scale needs: a handful of campus scenes and a
  classroom of visitors fit in memory, so a query engine is solving a problem
  that doesn't exist yet, and a routing framework is solving a problem
  (a dozen routes) `node:http` solves in a page of code.
- **Node, `node:http`, zero runtime dependencies, an append-only JSONL file,
  Server-Sent Events.** What's actually here. Chosen because the honest
  requirement is small: ~10 routes, one-directional server→browser push, a
  dataset that fits comfortably in memory. Every dependency not taken is a
  Docker layer that can't fail to install on a remote builder, and a thing
  `CLAUDE.md` doesn't have to tell a future session not to add a second way
  to do.

**Consequences.** Real cost: no framework conveniences, no SQL for whatever
richer queries later crits might want, and a flat file that would need
revisiting (an index, or a real embedded DB) well past classroom scale — a
trade-off worth revisiting once a specific feature actually needs it, not
before. Real benefit: the Docker image has no install step at all (`COPY` then
`node server.js`), which matters more than it sounds on a 256MB machine with a
remote builder and a deadline. SSE over WebSockets was the same logic in
miniature: the app never needs to hear from a browser outside a normal HTTP
request, so a full-duplex protocol buys nothing a one-way `EventSource` cannot
already deliver inside the brief's ~1s window — verified directly in
`spec/traces.test.ts`, not assumed.

The four scene panoramas are hand-authored SVGs, not photographs — no real
360 campus photography was available this week, and the brief is explicit that
this isn't worth blocking on. The interaction model (pan a wide image, anchor
pins at a normalised `{x, y}`) doesn't know or care that the image is an SVG;
swapping in real equirectangular photos later touches only
`server/src/scenes.js` and the files in `public/scenes/`, not the client logic
that makes them feel spatial.

## Agent workflow

The build followed `PLAN.md`'s own order: static scaffold, scene data and
panning, trace read/write, SSE wiring, a persistence check, then `spec/`. Each
stage was checked against the running app before moving on — `curl` for the
API surface first (faster than a browser for routing/validation bugs), then
two independent `agent-browser` sessions (genuinely separate cookies, so
genuinely separate "visitors") for everything that only shows up with two
people actually in the app at once
([`b22c513`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/b22c513)).

That two-session pass is what caught the one real bug so far: a trace posted
in a scene session A wasn't viewing correctly produced a toast, but silently
never rendered as a pin if session A navigated there afterwards. The client was
using one id-set to mean both "don't double-render this pin" and "don't
double-toast this event" — the toast path's bookkeeping was quietly deleting
the render path's chance to ever draw that pin. Not a guess: found by actually
watching a second session, confirmed by reading the store's file directly to
see the trace existed server-side while the client showed only one of two.
Fixed in the same commit, and written up as a standing rule in `CLAUDE.md`
("a dedupe/seen-set is scoped to one concern") so the next session doesn't
reintroduce it under a different name.

## What was checked, and how

Automated, against the running app
([`2cd146c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/2cd146c)):
the scene graph stays connected and every scene's image is actually served; a
posted trace round-trips and bad input is rejected; two visitors get distinct
identities and the same visitor is recognised across requests; a trace posted
while an SSE client is connected arrives as an event within the brief's ~1s
window. `pnpm check` runs these alongside the course's own `invariants.test.ts`
(`/` answers, `/readme/` carries the README's headings).

Manually observed, not just assumed: the full loop end-to-end across two
browser sessions (explore → discover → leave → the *other* session receives it
live, no reload); and persistence specifically, by killing the running dev
server and starting it again against the same data file, then confirming both
earlier traces were still there before any client re-rendered anything. A true
restart-under-Fly (a redeploy, not a kill) is the next thing to confirm once
the deploy itself runs, since CI only ever runs one container per check.

## Open for the next crit

Crit 9 asks for one written decision about several-people-in-it behaviour; the
cooldown and the ambient toast are the first candidates, not yet the final
answer. The flat-file store is sized for this week's scale deliberately —
worth a note here, not a surprise, if a later crit's traffic actually outgrows
it.
