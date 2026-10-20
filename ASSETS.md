# Asset credits and provenance

The Cursed Museum's scenes are original illustrated artwork
(`public/assets/gallery-scenes/`); its exhibit preview thumbnails and the
retired live-3D room were Three.js plus procedural content built at load
time. An earlier pass (the crit-10 free-roam version) also vendored a
downloaded rigged humanoid model for the visitor avatar; the scene-
exploration pivot removed embodied avatars entirely (see
`docs/adr/0003-scene-exploration.md`), so that model and its loader addons
were removed along with it — see "Retired" below for the full account,
kept for provenance rather than deleted silently.

## Illustrated scenes

`public/assets/gallery-scenes/*.webp` — one full-bleed illustration per
hall facing and per gallery main/close-up scene, plus reference images used
to compose them. Source images were supplied for this project and encoded
to WebP (`cwebp`, quality 82–85) to keep the total payload small (~1.6MB
across eight images, down from ~15MB of source PNGs) — see
`docs/adr/0004-illustrated-scenes.md` for the decision to present scenes
this way instead of as a live Three.js room.

## Third-party

- **Three.js** r169, MIT-licensed. Vendored as a static file at
  `public/vendor/three.module.min.js` (see that directory's own README for
  the exact pinned version and download source) — the one deliberate
  exception to the zero-runtime-npm-dependencies rule, used only for the
  small disposable per-exhibit preview thumbnail
  (`public/world/artifacts.js`'s `renderArtifactPreview`), never a live
  render loop or a camera a visitor steers: fetched by the browser, never
  installed, never touching the server's own dependency graph.

## Retired: the crit-10 avatar model

Crit 10's free-roam version used **Kenney "Mini Characters"** (v1.0, 2024,
CC0 1.0 Universal) as the visitor avatar's base rigged model, dressed in an
original procedural Gothic ensemble, plus the Three.js `GLTFLoader`/
`BufferGeometryUtils`/`SkeletonUtils` addons needed to load and clone it.
The scene-exploration pivot removed embodied avatars (other visitors are
now represented by a live per-room headcount, not a walking character — see
the ADR), so none of this is loaded or shipped any more:
`public/vendor/assets/avatar/`, `public/vendor/addons/`, and
`public/world/avatar.js` were all deleted in that pivot. This removes the
project's one non-Three.js downloaded asset and its ~260KB payload
entirely — the visual stack is now Three.js plus procedural content, full
stop.

## Original procedural content

Beyond the illustrated scenes, the exhibit preview library is generated in
the browser from code, not sourced from an external file:

- **Furniture** (`public/world/furniture.js`, trimmed in the illustrated-
  scene pivot to only what the preview still needs) — a display cabinet,
  a portrait frame, and a specimen vitrine, assembled from primitive
  Three.js geometry (boxes, cylinders, cones, tori, spheres) and canvas
  textures (`public/world/textures.js`: wood grain, portrait-canvas
  imagery, nameplate text). The room-scale furnishing set this module
  built for the retired live-3D room (rugs, potted plants, candles, a
  chandelier, a bookshelf, a standing clock, doll displays, and their
  matching wallpaper/carpet/label/trim textures) was removed in that pivot
  — see `docs/adr/0004-illustrated-scenes.md` — since nothing renders a
  room any more.
- **Donated-relic artifact library** (`public/world/artifacts.js`) — a
  dedicated model family per subtype (spoon, key, clock, mirror, painting,
  sketch, doll, toy, book, botanical specimen, biological specimen,
  curiosity — see `server/src/constants.js`'s `SUBTYPES_BY_CATEGORY`), each
  staged in real display furniture (a gilt frame, a glass specimen vitrine,
  a velvet pedestal under a glass dome, or a small display cabinet, reusing
  `furniture.js`'s own builders) with a brass nameplate
  (`textures.js`'s `buildNameplateTexture`) and its own small exhibition
  light. A donation's specific look (scale, rotation, material tone) is
  derived from a small seeded PRNG keyed on the exhibit's own id — stable
  across reloads, but never two donations looking pixel-identical — never
  from user-supplied or AI-generated imagery, per the blueprint's "no
  required AI image generation" instruction and without needing per-donation
  art.

## Why illustrated scenes, procedural previews

The illustrated-scene pivot (`docs/adr/0004-illustrated-scenes.md`) traded
a fully procedural live-3D room for static illustrated artwork, because a
rendered room built from primitive geometry read as technically correct
but visually generic no matter how it was staged (see
`reflections/crit-10.md`) — a specific, cursed-feeling museum needed actual
illustration, not more procedural polish. The per-exhibit preview and the
exhibit-card display stay procedural, since a donation needs a distinct
look generated on the spot, not a pre-authored image per possible exhibit.
The stack still has no asset pipeline (no bundler, no texture/model
importer — see `CLAUDE.md`'s zero-runtime-dependencies rule); the scene
images are a handful of WebP files served as plain static assets, not run
through any build step.

The crit-10 free-roam version carried one deliberate downloaded-asset
exception (a rigged humanoid for the visitor avatar, recorded above under
"Retired"), removed when embodied avatars left the product entirely. The
illustrated-scene pivot adds a second, different kind of exception — the
scene artwork itself — documented here rather than treated as an unstated
simplification.
