# Asset credits and provenance

Every visual asset in The Cursed Museum is either Three.js itself or
original procedural content built at load time — there are no other
downloaded assets. An earlier pass (the crit-10 free-roam version) also
vendored a downloaded rigged humanoid model for the visitor avatar; the
2.5D scene-exploration pivot removed embodied avatars entirely (see
`docs/adr/0003-scene-exploration.md`), so that model and its loader addons
were removed along with it — see "Retired" below for the full account,
kept for provenance rather than deleted silently.

## Third-party

- **Three.js** r169, MIT-licensed. Vendored as a static file at
  `public/vendor/three.module.min.js` (see that directory's own README for
  the exact pinned version and download source) — the one deliberate
  exception to the zero-runtime-npm-dependencies rule, documented since the
  prior crit: fetched by the browser, never installed, never touching the
  server's own dependency graph.

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

Everything else a visitor sees is generated in the browser from code, not
sourced from an external file:

- **World geometry** (`public/world/scene.js`, `server/src/world.js`) —
  floors, walls, ceilings and gallery layout are plain Three.js primitives
  (boxes, planes) positioned from the server's static world config; the
  fixed camera scenes/hotspots that replace the old collision/movement
  model are config of the same kind, not a visual asset.
- **Textures** (`public/world/textures.js`) — wallpaper, wood grain, carpet
  pattern, portrait-canvas imagery, and trim patterns are drawn onto an
  HTML `<canvas>` at boot and used as `THREE.CanvasTexture`s. No image
  files are fetched; nothing here depicts a real person, place or
  copyrighted artwork — the "portrait" texture is an abstract silhouette
  generated from a gradient and simple shapes, inspired by (not reproducing)
  the mood-board reference in `design/references/03_portrait_reference.png`.
- **Furniture** (`public/world/furniture.js`) — display cabinets, portrait
  frames, rugs, potted plants, candles with their own flickering point
  lights, a chandelier, a bookshelf with procedurally-spined books, specimen
  vitrines, a standing clock, and doll displays are all assembled from
  primitive Three.js geometry (boxes, cylinders, cones, tori, spheres) and
  the canvas textures above. Each gallery's furnishing selection is
  original composition work, inspired by the visual *mood* of
  `design/references/01_gallery_reference.png` and
  `02_cabinet_reference.png` (dense, warm, cluttered Victorian curiosity
  cabinets) without copying their specific arrangement, objects or any
  pixel content from those screenshots.
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

## Why procedural over downloaded assets

The stack has no asset pipeline (no bundler, no texture/model importer —
see `CLAUDE.md`'s zero-runtime-dependencies rule) and the course's one Fly
machine has a 256MB memory budget. Generating textures and models at load
time means there is nothing to license-check, nothing to credit beyond this
file, and no binary assets bloating the Docker image or the download a
visitor's browser has to fetch on a cold load — the entire furniture/
artifact/environment presentation ships as the same few KB of JavaScript
that was already being deployed, at the cost of the geometry reading as
stylised rather than photorealistic. That trade-off is treated as a known
limitation, not hidden — see `PROCESS.md`.

The crit-10 free-roam version carried one deliberate exception (a
downloaded rigged humanoid for the visitor avatar, recorded above under
"Retired"), justified at the time by how hard a believable walk cycle is to
fake with primitive geometry. The scene-exploration pivot removed embodied
avatars from the product entirely, which removed the exception along with
it — there is no longer a visitor avatar to render at all, so the question
of how convincingly to fake one no longer applies. Everything a visitor
sees is now Three.js itself plus procedural content, with no remaining
downloaded-asset exception beyond Three.js.
