# Crit 10 — A different museum, twice reconsidered

**The breakthrough.** The user handed over a complete product blueprint for
The Cursed Museum and asked for the full first version in one autonomous
run. The real breakthrough wasn't 3D geometry — it was treating the
blueprint's multi-user and archival constraints as load-bearing from the
first line of server code, not as polish added once a single-player demo
worked. A visitor is a cookie-backed identity, distinct per browser context
and stable across reloads, never an account anyone logs into
(`server/src/identity.js`). Every donation, account, and vote is a SQLite
transaction (`server/src/db.js`) committed before its event reaches
`server/src/sse.js`'s broadcast hub — so "another visitor sees it within a
second" and "it's still there after a restart" are both true by
construction, not by coincidence. A contradiction is a new `accounts` row
with `parent_id` pointing at what it disputes, never an `UPDATE`; one vote
per `(account, visitor)` is a unique constraint, not an application-level
check. Getting this right early meant the harder multiplayer/persistence
half of the brief never had to be retrofitted later.

**What this changed.** Two bugs only showed up by actually running two
browser sessions side by side rather than reading the collision or CSS
code: a CSS specificity bug that showed all three modal gates stacked at
once, and a collision seam where two exactly-touching rectangles left a
dead zone neither one's shrunk interior covered, permanently stopping
movement at every gallery doorway (both from the original free-roam
build — see `PROCESS.md`'s fuller account). Neither was visible in
isolation; both were obvious within one screenshot and one scripted walk.
That reinforced a rule that now generalises past multiplayer: for a
real-time, multi-session app, "I reasoned about the logic and it looks
right" and "I watched two independent sessions actually do the thing" are
different claims, and only the second is evidence.

**The part the free-roam era didn't get right.** The first full build
(`docs/adr/0002-transport.md`'s SSE decision, a walkable avatar, two
camera rigs) was technically sound — it passed every check, supported two
simultaneous sessions, and survived a real restart — but it still read as
a generic grey 3D sandbox, not the Gothic cabinet of curiosities the
blueprint described. More freedom to walk around an empty room is not the
same as a richer museum; unrestricted movement was solving a problem the
brief didn't actually pose. That's the judgment `docs/adr/0003-scene-
exploration.md` records: replacing continuous movement with a small fixed
graph of staged camera vantages, click-driven hotspots, and scene-scoped
presence instead of an embodied avatar. The domain layer — SQLite schema,
vote/classification rules, the SSE hub itself — didn't need to change at
all, which is exactly the evidence that separating durable domain
behaviour from replaceable presentation had been done correctly the first
time; only `public/world/exploration.js` and the hotspot/scene glue in
`public/app.js` were new.

**Where that pivot still fell short, and what's next.** Even the fixed-
scene version, built from primitive Three.js geometry and procedural
canvas textures, still reads closer to an empty furnished room than the
richly illustrated, lit, cluttered wunderkammer the project references
show. Reducing spatial freedom was the right call; it wasn't sufficient by
itself — more 3D, and less 3D, both missed the same requirement: the room
has to look worth exploring, not just be structurally navigable. That's
the next correction in progress, not yet integrated into the running app
as of this reflection.

**Changed practice, going forward.** Judge visual work from rendered
frames and real multi-session behaviour, not from how clean the
geometry-generating code reads. Keep the domain (schema, transactions,
vote math, append-only history) separate from the presentation layer so a
visual pivot never has to touch either. Record every correction — what was
removed and why it was safe to remove — in an ADR and in `PROCESS.md`, not
just in a commit message. And because Crit 10 is specifically about
observable multi-user behaviour, verify it by opening two distinct browser
contexts and reading the server's own action logs, not by trusting that
the code path for "another visitor" is correct because the single-session
path is.
