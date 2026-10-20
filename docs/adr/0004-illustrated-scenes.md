# ADR 0004: Illustrated full-bleed scenes, not a live Three.js room

**Status:** Accepted — Crit 10 presentation pivot, following 0003

## Context

The 2.5D fixed-scene pivot (ADR 0003) was a real structural improvement —
click-driven navigation, no collision, scene-scoped presence — but the
scenes themselves were still a live Three.js room built from primitive
geometry and canvas textures. Rendered and reviewed honestly, that room
read as technically correct but visually generic: boxes, planes, and a
procedural wallpaper texture do not read as "a specific, cursed museum,"
no matter how well the camera is staged. `reflections/crit-10.md` records
this assessment directly, written before this pivot's code existed, so it
would not retroactively launder the decision.

Separately, three real UX regressions had crept into the fixed-scene
version: donation and voting were implemented correctly end-to-end but
buried behind navigation deep enough that a first-time visitor could miss
them entirely; other visitors were represented only by a headcount string,
with no visible cameo restoring the earlier "I can see someone else is
here" feeling; and nothing surfaced the full exhibit archive independent of
knowing which gallery to walk into.

## Decision

Replace the live Three.js room with full-bleed illustrated scene images
(`public/assets/gallery-scenes/*.webp`), one per hall facing and per
gallery main/close-up scene, layered with a vignette, an ornamental frame,
and a restrained dust-mote overlay so each image reads as viewed through
the museum's own archway rather than as a flat photograph. The world model
keeps exactly the same shape it had under ADR 0003 — galleries, display
slots, the scene graph, hotspots — the only thing that changed is what a
slot or hotspot's `{x, z}` means: "a point on the floor a 3D camera can
see" became "a point on the picture, as a percentage of its width/height."
`server/src/world.js`'s `SLOT_ANCHORS`/`GALLERY_LAYOUT`/`buildHallScenes`/
`buildGalleryScenes` were rewritten around this percentage-anchor model;
`db.js`'s `GALLERIES`/`galleryById`/`slotById` call shape is untouched, so
nothing downstream needed to change its understanding of a "slot."

Navigation transitions became CSS: a hub turn is a cross-slide between two
stacked `.scene-layer`s; entering/leaving a gallery or close-up is a
page-turn/cabinet-door cut using `rotateY` from a hinge edge, both
collapsing to a near-instant swap under `prefers-reduced-motion`
(`public/world/illustration.js`, `public/styles.css`). Three.js is kept,
vendored exactly as before, only for small disposable still-frame canvas
previews of a donated exhibit's procedural mesh (`renderArtifactPreview`,
moved from the retired `scene.js` into `artifacts.js`) — never a live
render loop or a camera a visitor steers.

Each real exhibit now renders as a dimensional "Gothic display card"
(tilt, brass border, hover/focus lift, a `.quiet` dim state on its
siblings while one is focused) positioned over the illustration rather
than a plain pill hotspot, addressing the "exhibits are hard to notice"
regression directly. Donation is now also reachable from a persistent,
always-visible "Donate a Relic" action in every main scene, not only the
in-world donor counter, which stays as an atmospheric secondary entrance.
A persistent "Archive" action opens a full exhibit index grouped by
gallery, so a visitor can find any exhibit without first guessing which
room it's in.

Visible visitor cameos are restored without reintroducing embodied
movement: each connected visitor's scene presence now carries a stable,
non-reversible `publicKey` (`identity.js`'s `publicKeyFor`, a one-way hash
of the visitor id, never the id or cookie itself) and display name;
`sse.js`'s `visitorsInScene` returns the deduplicated roster for a scene,
and the client renders each as a small medallion cameo at a fixed
percentage spot with a restrained idle float and an activity pulse on
donate/account/vote, never a free-roaming avatar.

## What was removed, and why it's safe to remove

- **`public/world/scene.js`** (the live Three.js room: walls, lighting
  rig, the whole furnished-room composition) and **`exploration.js`** (the
  scene-cut/turn controller driving a camera) — there is no camera to
  stage or move any more; `illustration.js` replaces both with image
  layer/transition management.
- **Room-only furniture and texture builders** (`buildRug`,
  `buildPottedPlant`, `buildCandle`, `buildChandelier`, `buildBookshelf`,
  `buildStandingClock`, `buildDollDisplay`, `buildSideTable`,
  `buildFloorMirror`, `buildSculptureBust`, `buildTrunk`,
  `wallpaperMaterial`, `floorMaterial` in `furniture.js`;
  `buildCarpetTexture`, `buildWallpaperTexture`, `buildLabelTexture`,
  `buildTrimTexture` in `textures.js`) — these existed only to furnish a
  room a camera walked through; the illustrated scenes carry that mood in
  the artwork itself. `buildDisplayCabinet`, `buildClutterObject`,
  `buildPortraitFrame`, `buildSpecimenVitrine` are kept, since they're
  still used by `renderArtifactPreview`'s per-exhibit still frame.
- **CLAUDE.md's "two camera rigs" line** — there is exactly one
  presentation mode now (an illustrated scene), not two camera rigs over
  one avatar transform; CLAUDE.md was updated in the same pass to describe
  the scene/hotspot/slot percentage-anchor model instead.

## Consequences

- **Removed:** `public/world/scene.js`, `exploration.js`; the room-only
  furniture/texture builders listed above.
- **Added:** `public/assets/gallery-scenes/*.webp` (original gallery
  illustrations, converted to WebP for size — see `ASSETS.md`),
  `public/world/illustration.js`, the `.exhibit-card`/`.cameo`/
  `.persistent-action`/`.archive-list` presentation in `styles.css`,
  `identity.js`'s `publicKeyFor`, `sse.js`'s `visitorsInScene`, the
  `activity` SSE event, `db.js`'s idempotent `seedFoundingCollection`
  (so a fresh deploy's galleries are never empty on first look — one
  real, honestly-labeled exhibit per gallery, claiming exactly one slot).
- **Unchanged:** the data model, vote/classification rules, donation
  transaction/slot-claim discipline, SQLite persistence, and the one-SSE-
  hub transport — this is a presentation pivot, not a backend rewrite, the
  same framing ADR 0003 used for its own pivot.

## Verification

Checked directly, not just assumed from the code: a headless-Chrome
walkthrough (driven over the Chrome DevTools Protocol, since no
Playwright/Puppeteer is installed in this environment) through the hub,
a gallery main scene, its close-up with lore popover, back navigation, a
dossier, the donate form, and the archive index, at both a desktop
viewport and a 390×844 phone viewport, with console exceptions actively
monitored. This caught two real bugs: an uncaught WebGL context-creation
failure inside `renderArtifactPreview` that silently aborted
`refreshHotspots()` partway through a scene's hotspot refresh (fixed with
a try/catch and a flat-color 2D-canvas fallback, so a preview-rendering
failure can never again break the caller that draws every other card), and
two mobile-only layout bugs — a hotspot label that could overflow past the
right edge of a narrow viewport, and exhibit cards overlapping at a fully
occupied gallery's six-slot density on a 390px-wide screen (fixed by
wrapping hotspot text within a max-width and shrinking card/frame sizing
further under the existing `max-width: 480px` breakpoint).
