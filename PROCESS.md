# Process overview

Rewritten at each crit to describe the project as it stands, not appended to —
this is the state as of C8. `PLAN.md` is the working plan; this is the account
of how it was built and why.

## From brief to harness

The brief fixes three things (multi-user, real-time, persists) and leaves the
app itself open. Before writing code, the student's concept — an immersive,
connected-scene layer over campus where traces are anchored to places — became
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
  static half, but a separate database app is outside the course's Fly setup,
  and a framework buys nothing an app this small needs (routing, client state)
  — it has neither problem.
- *Node + Express + `ws` + SQLite.* Conventional, reasonable, and still more
  than the scale needs: a handful of scenes and a classroom of visitors fit in
  memory, so a query engine and a routing framework both solve problems that
  don't exist here.
- **Node, `node:http`, zero runtime dependencies, an append-only JSONL file,
  Server-Sent Events.** What's actually here: ~10 routes, one-directional
  server→browser push, a dataset that fits comfortably in memory. Every
  dependency not taken is a Docker layer that can't fail to install on a
  remote builder.

**Consequences.** Real cost: no framework conveniences, no SQL, and a flat
file that would need revisiting (an index, or a real embedded DB) well past
classroom scale — worth revisiting once a feature actually needs it, not
before. Real benefit: the Docker image has no install step at all (`COPY` then
`node server.js`), which matters on a 256MB machine with a remote builder and
a deadline. SSE over WebSockets was the same logic in miniature: the app never
needs to hear from a browser outside a normal HTTP request, so a full-duplex
protocol buys nothing a one-way `EventSource` cannot already deliver inside
the brief's ~1s window — verified directly in `spec/traces.test.ts`.

The four scenes are real ANU photographs (Wikimedia Commons, CC BY-SA — credits
in README.md), not illustration: Sullivans Creek at Kambri, Chifley Library's
footbridge, Union Court, the sign on University Avenue. Each is built by
`tools/build-scenes.py` into a pseudo-panorama — shown sharp at its own
aspect, centred on a wider canvas whose edges are a softly blurred, darkened
extension of the *same* photo, giving real pan room without a 360 shoot this
week. The interaction model (pan a wide image, anchor pins at normalised
`{x, y}`) doesn't know or care what format the image is; real equirectangular
photos later touch only `scenes.js` and `public/scenes/`, nothing client-side.

**This replaced a first attempt at hand-authored SVG illustrations** (still in
earlier commits). Those satisfied every mechanical spec line — a connected
graph, a pannable wide image, anchored pins — but failed what the spec can't
check: on sight, the app read as a generic prototype, not specifically ANU.
Illustration was chosen first to avoid blocking on asset sourcing; the
correction was to go find real sourcing instead (Commons has ample CC-licensed
campus photography) rather than defend placeholder art. The anchoring
architecture didn't change — only `scenes.js`'s data and `public/scenes/`'s
files did, the payoff of keeping those decoupled from day one.

## Agent workflow

The build followed `PLAN.md`'s own order: static scaffold, scene data and
panning, trace read/write, SSE wiring, a persistence check, then `spec/`. Each
stage was checked against the running app before moving on — `curl` for the
API surface first (faster than a browser for routing/validation bugs), then
two independent `agent-browser` sessions (genuinely separate cookies, so
genuinely separate "visitors") for everything that only shows up with two
people actually in the app at once
([`b22c513`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/b22c513)).

That two-session pass is what caught the first real bug: a trace posted in a
scene session A wasn't viewing produced a toast, but silently never rendered
as a pin if session A navigated there afterwards — one id-set was doing both
"don't double-render" and "don't double-toast" duty, so the toast path's
bookkeeping deleted the render path's chance to ever draw that pin. Fixed in
the same commit and written up in `CLAUDE.md` ("a dedupe/seen-set is scoped to
one concern") so it isn't reintroduced under a different name.

Switching to real photos surfaced two more, both only visible by actually
clicking through the running app rather than reading the code: clicking the
look-left/-right chevrons opened a compose bubble instead of panning, because
their click bubbled up to the viewport's own "click empty ground" handler,
which didn't exclude `.pan-btn` the way it already excluded `.pin`/`.bubble`;
and on a narrow (mobile) viewport, a scene loaded panned all the way to its
left edge, which for a photo built sharp-centred-on-a-wider-canvas meant the
real photo could be entirely out of frame — only its blurred margin showing on
first paint. Both fixed directly (the click guard gained `.pan-btn`; scene
load now centres on the pan range's midpoint, which is always where the sharp
photo sits, by construction).

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
live, no reload); persistence across a killed-and-restarted dev server; and,
once deployed, persistence across a **real Fly redeploy** — a trace posted
live before a second `flyctl deploy` was still there after it, over the actual
volume. `pnpm check` also ran directly against the live URL, not only a dev
server. The visual correction above was re-verified the same way (both
viewports, both sessions) before redeploying again.

## Open for the next crit

Crit 9 asks for one written decision about several-people-in-it behaviour; the
cooldown and the ambient toast are the first candidates, not the final answer.
The flat-file store is sized for this week's scale on purpose — worth a note
here, not a surprise, if traffic later outgrows it.
