# Process overview

Rewritten at each crit to describe the project as it stands, not appended
to — this is the state as of the illustrated-scene presentation pivot to
**The Cursed Museum**. `PLAN.md` is the working plan; this is the account
of how it was built and why.

## From Traces of ANU, through free-roam 3D, to illustrated scenes

This repo carried crits 8 and 9 as *Traces of ANU*, a 2D pannable-photo
campus app (see Git history before
[`804aabc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/804aabc)
and `reflections/crit-8.md`, `crit-9.md`). For the Final Project the user
supplied a full product blueprint —
`design/The_Cursed_Museum_Project_Blueprint.pdf` — for a shared, explorable
Gothic museum with a living archive of competing, votable claims about
donated relics. Crit 10's first build shipped a genuine free-roam 3D world:
a walkable avatar, server-authoritative position, client-side collision,
two camera rigs over the same transform.

The direction then changed twice more, each change a presentation pivot,
not a backend rewrite — the data model, vote/classification rules, and
donation transaction discipline were untouched by either:

1. **Free-roam to fixed 2.5D scenes** (`docs/adr/0003-scene-exploration.md`):
   replaced continuous movement with a small graph of fixed camera
   vantages, click-driven navigation, no collision.
2. **A live Three.js room to illustrated scenes**
   (`docs/adr/0004-illustrated-scenes.md`): rendered and reviewed honestly,
   the fixed-scene version still read as a technically correct but
   generic furnished room (`reflections/crit-10.md` records this
   assessment directly). Replaced the live room with full-bleed illustrated
   scene images, restored visible visitor cameos (removed during the first
   pivot in favour of a bare headcount), made donation reachable from a
   persistent action in every scene instead of only the in-world donor
   counter, and added a persistent "Archive" action plus a founding seed so
   a fresh deploy's galleries are never empty.

`README.md`, `DESIGN.md` and `PLAN.md` were rewritten for the current
presentation model in the same pass as each pivot.

## Stack decision record

**Context.** Same infrastructure throughout: one Fly machine, 256MB, one
volume, no separate database app. Each pivot removed requirements rather
than adding them.

**Persistence: `node:sqlite`, unchanged.** The relational structure this
project needs (an exhibit claims exactly one slot, an account can challenge
exactly one other account, a vote is unique per account+visitor) was never
about camera presentation, so neither pivot touched `server/src/db.js`'s
schema or transaction discipline. See `docs/adr/0002-transport.md`'s
original record for why `node:sqlite` was chosen over a flat file.

**Transport: still one SSE hub.** `POST /api/presence` reports which fixed
scene a visitor is viewing, never a continuous position; the server
broadcasts a per-scene headcount and a roster of that scene's visible
cameos — each only a stable, non-reversible public key and a display name,
never the raw visitor cookie (`identity.js`'s `publicKeyFor`). Same
one-SSE-hub architecture `docs/adr/0002-transport.md` chose.

**World: illustrated scenes, one percentage-anchor coordinate space.**
`server/src/world.js`'s scene graph positions hotspots and display slots
as a `{x, z}` percentage of a scene's illustration, not a 3D world
coordinate — the same shape `db.js`'s `galleryById`/`slotById` already
expected, so nothing downstream changed its understanding of "a slot."
Three.js is kept only for a small, disposable, per-exhibit still-frame
preview (`artifacts.js`'s `renderArtifactPreview`) — never a live render
loop or a camera a visitor steers.

## What was checked, and how

Automated, against the running app (`spec/world.test.ts`,
`spec/archive.test.ts`, alongside the course's own `invariants.test.ts`):
the museum has exactly four galleries each with at least one display slot;
the scene graph has a hub plus a main and close-up scene per gallery, each
reachable; two visitors get distinct identities and the same visitor is
recognised across requests; a donation claims a free slot and is rejected
on an already-occupied one; a contradiction never erases the account it
challenges; casting, then changing, a vote upserts rather than duplicates;
an account with no votes reports Unclassified; a scene-presence report
broadcasts over SSE; an unknown scene id is rejected.

Manually observed, not just asserted: a full click-driven walkthrough
(headless Chrome, driven directly over the Chrome DevTools Protocol with
Node's built-in `WebSocket`, since no Playwright/Puppeteer is installed
here) through the name gate, a hub turn, a gallery's main scene, its
close-up with lore popover, back navigation, a framed exhibit card's
dossier, the donate form, and the archive index — at both a desktop
viewport and a real 390×844 phone viewport, with console exceptions
actively monitored rather than assumed absent, under `pnpm check` and
`pnpm check:evidence` run clean beforehand.

## Real bugs this process caught

**An uncaught WebGL context-creation failure silently truncating a
scene's hotspot refresh.** `renderArtifactPreview`, called once per
exhibit card while a gallery scene builds its hotspot layer, threw when
headless Chrome had no hardware WebGL available; the exception propagated
up through the hotspot-refresh loop and aborted it partway through,
leaving some cards rendered and the scene's caption/hint stale with no
visible error anywhere in the UI — invisible by reading the code, only
caught by actually loading the page and watching the console. Fixed by
wrapping the preview renderer in a try/catch with a flat-color 2D-canvas
fallback, so a single preview's rendering failure can never again break
the caller that draws every other card in the scene.

**Two mobile-only layout bugs, both only visible at a real narrow
viewport.** A hotspot label near a scene's right edge could overflow past
the viewport boundary at 390px wide, since it was styled `white-space:
nowrap` with no width cap — fixed by letting hotspot text wrap within a
`max-width`. Separately, a fully occupied gallery's six display cards
overlapped heavily at the same width — fixed by shrinking card and
decorative-frame sizing further under the existing narrow-viewport
breakpoint. Both were only found by actually testing at 390×844, not by
reading the percentage-anchor layout code and assuming it would scale.

**From earlier eras, still-relevant lessons:** a CSS specificity bug where
`.overlay-gate { display: flex }` outranked the `hidden` attribute (fixed
by scoping to `:not([hidden])`), and hotspot/slot placement bugs caused by
anchoring a hotspot to an unrelated piece of geometry rather than the
vantage it needed to be visible from (`docs/adr/0003-scene-exploration.md`)
— the general lesson, that a position valid in one context isn't
automatically valid in the context that renders it, carried forward into
how the illustrated-scene percentage anchors were checked.

## Known limitations, stated rather than hidden

Exhibit preview models are a procedural library keyed to category and
subtype, not bespoke art per individual donation. There is no moderation
queue beyond length caps and per-visitor rate limits, acceptable at
classroom scale and explicitly not a claim of readiness for open public
UGC. Spatial audio, named optional in the blueprint, is out of this
version. Other visitors are represented by a cameo medallion with a
display name, not an embodied character — a deliberate choice per the
blueprint's own permission to represent presence this way.
