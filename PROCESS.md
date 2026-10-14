# Process overview

Rewritten at each crit to describe the project as it stands, not appended to
— this is the state as of the Final Project's 2.5D scene-exploration pivot
to **The Cursed Museum**. `PLAN.md` is the working plan; this is the account
of how it was built and why.

## From Traces of ANU, to a free-roam 3D museum, to 2.5D scene exploration

This repo carried crits 8 and 9 as *Traces of ANU*, a 2D pannable-photo
campus app (see Git history before
[`804aabc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/804aabc)
and `reflections/crit-8.md`, `crit-9.md` for that account). For the Final
Project the user supplied a full product blueprint —
`design/The_Cursed_Museum_Project_Blueprint.pdf` — for a different app
entirely: a shared, explorable Gothic museum with a living archive of
competing, votable claims about donated relics. The blueprint's own
"feasibility note" argued this couldn't be a cropped 2D scene the way
Traces of ANU was, so the first build of The Cursed Museum (crit 10) shipped
a genuine free-roam 3D world: a walkable avatar, server-authoritative
position, client-side collision, and two camera rigs (overhead, pointer-
locked first-person) over the same transform.

After that version was built, verified, and shipped for crit 10, the
direction changed again: move from "a generic 3D sandbox with a roaming
avatar" to a **crafted 2.5D cabinet-of-curiosities presentation** —
richly staged fixed camera scenes, click-driven navigation, optional
close-up sub-scenes, multiplayer represented through shared activity
rather than an embodied character. This is a presentation and interaction
pivot, not a backend rewrite: the full decision record, including exactly
what was removed and why it's safe to remove, lives in
[`docs/adr/0003-scene-exploration.md`](docs/adr/0003-scene-exploration.md).
`README.md`, `DESIGN.md` and `PLAN.md` were rewritten for the new
presentation model in the same pass; the data model, vote/classification
rules, and safety rules were untouched, because none of them depended on
how the camera moved.

## Stack decision record

**Context.** Same infrastructure as before: one Fly machine, 256MB, one
volume, no separate database app. The scene-exploration pivot removes a
requirement (continuous server-validated movement) rather than adding one.

**Persistence: `node:sqlite`, unchanged.** The relational structure this
project needs (an exhibit claims exactly one slot, an account can challenge
exactly one other account, a vote is unique per account+visitor) was never
about movement, so this pivot touches none of `server/src/db.js`'s schema
or transaction discipline. See `docs/adr/0002-transport.md`'s original
record for why `node:sqlite` was chosen over a flat file in the first
place.

**Transport: still one SSE hub.** The free-roam version added
client→server movement traffic (`POST /api/presence/move`) alongside the
inherited SSE broadcast hub. The scene-exploration pivot replaces that
traffic with something strictly lighter: `POST /api/presence` reports
which *fixed scene* a visitor is viewing, not a continuous position, and
the server broadcasts a per-scene headcount rather than per-visitor
coordinates — the same one-SSE-hub architecture `docs/adr/0002-transport.md`
chose, carrying strictly less specific data than before. See
`docs/adr/0003-scene-exploration.md` for the full before/after.

**World: Three.js, vendored, one fixed scene graph.** The world geometry,
furniture, lighting and artifact-library code (`public/world/scene.js`,
`furniture.js`, `textures.js`, `artifacts.js`) are exactly what the
free-roam version built — this pivot only changes how the camera is
positioned and how a visitor tells it where to go next. `server/src/
world.js` is still the single source of truth, now for a graph of named
camera vantages and their hotspots (`SCENES`) instead of walkable
rectangles and collision; the client never invents geometry or a hotspot
position the server doesn't define.

## What was checked, and how

Automated, against the running app (`spec/world.test.ts`,
`spec/archive.test.ts`, alongside the course's own `invariants.test.ts`):
the museum has exactly four galleries each with at least one display slot;
the fixed scene graph has a hub plus a main and close-up scene per gallery,
each reachable (a `parentSceneId`/`turnLeft`/`turnRight` chain back to
somewhere); two visitors get distinct identities and the same visitor is
recognised across requests; a donation claims a free slot and is rejected
on an already-occupied one; a contradiction never erases the account it
challenges; casting, then changing, a vote upserts rather than duplicates;
an account with no votes reports Unclassified; a scene-presence report
broadcasts over SSE within the brief's ~1s window; an unknown scene id is
rejected.

A genuinely new category of check this pivot needed, since a bug here is
invisible by reading the code and only shows up as "this is in the room
but has no way to click it": every hotspot's and every display slot's
world position was checked (view-angle math against the actual camera
vantage, not just "the number looks plausible in isolation") to fall
inside that scene's real camera frustum — at the reference aspect ratio,
at a square aspect, and down to a real phone-portrait aspect ratio
(~0.46). Several real placement bugs were caught and fixed exactly this
way; the full list is in the ADR.

Manually observed, not just asserted, with a real headless-browser
walkthrough (Chromium via Playwright) and two independent browser
contexts (genuinely separate cookies — genuinely separate visitors):

- A full click-driven path through the app — name gate, hub turn, enter a
  gallery, close-up, lore popover (both auto-shown and via its own
  hotspot), back, exit to hub, donate, receipt, "View My Relic", dossier —
  with zero console/page errors at any step, on both a desktop viewport
  and a real iPhone-portrait viewport (390×844).
- Two independent sessions both see "2 visitors in this room" immediately
  on joining the same scene, and only "alone" before the second arrives —
  the scene-scoped presence claim, not just the old global count.
- A donation made in one session instantiates its real mesh, with its own
  clickable hotspot, in the other session's already-open scene, with no
  reload.
- A real server-process kill and restart: every exhibit donated before the
  restart was still present, under the same SQLite file, after it.

## Real bugs this process caught

**Several hotspot/slot placement bugs, all found by actually computing (and
then clicking) view angles, not by reading the code.** The first version of
each gallery's main-scene camera stood near one side wall at a diagonal
angle "for a nicer establishing shot" — which meant roughly half of every
gallery's own display slots fell outside that camera's actual field of
view, so a donation landing in one of those slots would have rendered with
no way to click it at all. Centreing the vantage on the room's own
cross-axis fixed this structurally rather than per-slot. A `back` hotspot
anchored at its close-up scene's literal lookAt target, and lore/closeup
hotspots anchored at raw furniture coordinates, both suffered the same
class of bug for the same reason: a position that's valid *somewhere* in
the room isn't necessarily valid *from this specific camera*. The general
fix (`hotspotNear`, in `server/src/world.js`) derives a hotspot's position
from the vantage it actually needs to be visible from.

**A narrower-than-reference viewport silently shrinking the usable field of
view.** Three.js's camera FOV is vertical; horizontal FOV follows from
aspect, so a viewport narrower than the one every scene was authored
against (most visibly a phone in portrait) quietly lost horizontal field of
view and pushed side-wall content out of frame — invisible on the desktop
screenshot used to author the scenes, only caught by actually computing the
frustum at a phone's real aspect ratio and then loading the app at that
viewport. Fixed two ways: a vertical-FOV correction that holds horizontal
FOV roughly constant down to a capped minimum (`exploration.js`'s
`verticalFovFor`), and moving side-wall display slots further from the
doorway than a desktop-only check would have required.

**Overlapping hotspots, a distinct bug from the frustum one.** Once every
hotspot was reliably in frame, several of them still projected close enough
together on a narrow viewport to visually stack and make some unclickable
— a whole room's width collapses toward one vanishing point on a tall,
narrow screen. Fixed generally (`declutterHotspots` in `public/app.js`):
every frame, after projecting hotspots to screen space, clamp each
horizontally within the viewport and greedily push any still-overlapping
pair apart vertically, rather than hand-tuning spacing per scene.

**From the crit-10 free-roam version, carried forward as still-relevant
context:** a CSS specificity bug where `.overlay-gate { display: flex }`
outranked the `hidden` attribute (fixed by scoping to `:not([hidden])`),
and a collision seam at corridor boundaries (fixed by deliberately
overlapping rectangles) — both retired along with the collision system
itself in this pivot, but the general lesson (two independent mechanisms
must not silently fight over the same property without one deferring
explicitly) is the same lesson the hotspot-declutter fix above follows.

## Known limitations, stated rather than hidden

Exhibit models are a procedural library keyed to category and subtype, not
bespoke art per individual donation — true to the blueprint's "no required
AI image generation" instruction, but a real simplification against the
mood boards in `design/references/`. There is no moderation queue beyond
length caps and per-visitor rate limits, acceptable at classroom scale and
explicitly not a claim of readiness for open public UGC. Spatial audio,
named optional in the blueprint, is out of this version. Other visitors
are represented by a live per-room headcount and shared archive activity,
not an embodied character — a deliberate choice per the blueprint's own
permission to represent presence this way, not an unstated simplification.
