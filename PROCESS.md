# Process overview

Rewritten at each crit to describe the project as it stands, not appended to
— this is the state as of the Final Project pivot to **The Cursed Museum**.
`PLAN.md` is the working plan; this is the account of how it was built and
why.

## From Traces of ANU to The Cursed Museum

This repo carried crits 8 and 9 as *Traces of ANU*, a 2D pannable-photo
campus app (see Git history before
[`804aabc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/804aabc)
and `reflections/crit-8.md`, `crit-9.md` for that account). For the Final
Project the user supplied a full product blueprint —
`design/The_Cursed_Museum_Project_Blueprint.pdf` — for a different app
entirely: a shared, explorable Gothic museum with a real 3D world, dual
camera rigs, and a living archive of competing, votable claims about
donated relics. The blueprint's own "feasibility note" is explicit that this
cannot be built as a cropped 2D scene the way Traces of ANU was — a genuine
freely-navigable first-person camera needs real 3D world geometry — so this
was a full pivot, not an incremental crit: the prior app's scene/store code,
scene photography and SVG-era prototype were removed rather than kept
alongside a second, unrelated product. Git history before the pivot commit
stays in the repo as process evidence; nothing was force-pushed away.

`README.md`, `DESIGN.md`, `PLAN.md` and `CLAUDE.md` were rewritten for the
new product before any app code was touched — the galleries, the data model,
the vote/classification rules and the safety rules were decided up front,
same discipline the original harness used.

## Stack decision record

**Context.** Same infrastructure as before: one Fly machine, 256MB, one
volume, no separate database app. The new brief adds real geometry (a 3D
world, two camera rigs) and a richer write surface (donations, competing
accounts, votes) on top of the same multi-user/real-time/persistence
requirements.

**Persistence: `node:sqlite`, not a flat file.** Traces of ANU's JSONL log
fit a handful of append-only pins; this project needs relational structure
(an exhibit claims exactly one slot, an account can challenge exactly one
other account, a vote is unique per account+visitor) that a flat file would
otherwise re-implement by hand. Node 24 ships `node:sqlite` as a stable,
unflagged built-in — confirmed directly in this environment before
committing to it — so SQLite is available with the same "zero runtime npm
dependencies" constraint intact: no `better-sqlite3` native module, no
install step, same install-free Docker image Traces of ANU had.

**Transport: still one SSE hub, not WebSockets.** The blueprint suggests a
WebSocket layer for presence/position/room events. This project adds a new
kind of traffic (client → server movement, which the prior app never had),
but the brief's own bar — a change reaches another open session within
about a second — doesn't need full duplex: a rate-limited `POST
/api/presence/move`, relayed over the *same* SSE hub Traces of ANU already
proved, is a complete multiplayer-movement loop with one live channel
instead of two. Recorded in full in
[`docs/adr/0002-transport.md`](docs/adr/0002-transport.md), including the
documented fallback if real testing later shows movement reads as laggy.

**World: Three.js, vendored, one coordinate system, two camera rigs.**
Three.js was already vendored as a static file for the retired
depth-parallax prototype (`public/vendor/three.module.min.js` — see its own
README for provenance); this project is the first one to actually need it in
production. `server/src/world.js` is the single source of truth for gallery
geometry, display slots and collision rectangles — the client never invents
geometry the server doesn't know about, so client-side collision (in
`public/world/movement.js`) can never disagree with what the server
validates in `POST /api/presence/move`. Camera A (overhead) and camera C
(first-person) in `public/world/cameras.js` both read the one avatar
transform; switching (`V`) touches only which rig renders it, never the
transform itself.

## What was checked, and how

Automated, against the running app (`spec/world.test.ts`,
`spec/archive.test.ts`, alongside the course's own `invariants.test.ts`): the
museum has exactly four galleries each with at least one display slot; two
visitors get distinct identities and the same visitor is recognised across
requests; a donation claims a free slot and is rejected on an already-
occupied one; a contradiction never erases the account it challenges;
casting, then changing, a vote upserts rather than duplicates; an account
with no votes reports Unclassified; a presence move broadcasts over SSE
within the brief's ~1s window.

Manually observed, not just asserted, with two independent `agent-browser`
sessions (genuinely separate cookies — genuinely separate visitors):

- A visitor's avatar is visible to another session **immediately on
  connect**, not only after their first move — this was a real gap the
  first implementation had (presence only ever broadcast from the movement
  handler, so a visitor standing still at spawn was invisible to anyone
  already in the museum) and is fixed by posting the spawn position once at
  boot.
- Live avatar movement, visible in the other session within roughly the
  movement-post interval, well under 1s.
- A donation made in one session appears as a real mesh in the other
  session's world without a reload.
- A contradiction published against another visitor's original account in
  one session appears, with the original account still intact, in the
  other session.
- A vote cast in one session updates the *other* session's already-open
  dossier — both the per-account verdict and the exhibit's derived overall
  classification — live, with no reload and no re-fetch triggered by the
  voter's own client.
- Switching camera rigs (`V`) while a dossier-eligible exhibit is in range
  preserves position, yaw and which exhibit `E`/click resolves to, exactly,
  in both rigs.
- A real server-process kill and restart: a donation made before the
  restart was still present, under the same SQLite file, after it.

## Two real bugs this process caught

**A CSS specificity bug, not a logic bug.** `.overlay-gate { display: flex }`
outranked the `hidden` attribute's default `display: none`, so all three
overlay gates (name entry, donation form, dossier) rendered stacked on top
of each other on first paint — invisible from reading the HTML/JS, only
visible from actually loading the page. Fixed by scoping the `display: flex`
rule to `:not([hidden])`, the general lesson being the same one `CLAUDE.md`
already states for dedupe sets: don't let two independent visibility
mechanisms (an HTML attribute and a class rule) fight over the same
property without one of them deferring explicitly.

**A collision seam, found by actually walking through it.** Corridor
rectangles were defined to exactly abut the hall and gallery bounds they
connect. Collision shrinks each rectangle's walkable interior inward by the
avatar's radius before testing a point against it — so two rectangles that
only *touch* at a shared edge have no radius-shrunk interior in common at
that edge, and a visitor walking toward the seam gets clamped back into
whichever rectangle they're already in, forever. The clamp logic read as
correct in isolation; only driving an avatar at the seam surfaced it. Fixed
by overlapping each corridor into both neighbouring rectangles by more than
twice the collision radius (see the `OVERLAP` constant and its comment in
`server/src/world.js`).

## Known limitations, stated rather than hidden

Exhibit imagery is simple original procedural geometry keyed to each
gallery's category (a pedestal-and-relic family per category), not bespoke
art per donation — true to the blueprint's "no required AI image
generation" instruction, but a real simplification against the mood boards
in `design/references/`. There is no moderation queue beyond length caps and
per-visitor rate limits, acceptable at classroom scale and explicitly not a
claim of readiness for open public UGC. Spatial audio, named optional in the
blueprint, is out of this first version.
