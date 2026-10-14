# Asset credits and provenance

Every visual asset in The Cursed Museum is either a third-party library
already covered by `CLAUDE.md`'s dependency rules, or built as original
procedural content at load time — nothing here is a downloaded image,
texture, or 3D model file.

## Third-party

- **Three.js** r169, MIT-licensed. Vendored as a static file at
  `public/vendor/three.module.min.js` (see that directory's own README for
  the exact pinned version and download source) — the one deliberate
  exception to the zero-runtime-npm-dependencies rule, documented since the
  prior crit.

## Original procedural content

Everything else a visitor sees is generated in the browser from code, not
sourced from an external file:

- **World geometry** (`public/world/scene.js`, `server/src/world.js`) —
  floors, walls, ceilings, gallery layout and collision are plain Three.js
  primitives (boxes, planes) positioned from the server's static world
  config.
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
- **The visitor avatar** (`public/world/avatar.js`) — a jointed humanoid
  (head, torso, two arms, two legs on hip/shoulder pivots) in a
  Gothic-Victorian coat-and-cape silhouette, built from primitive geometry
  with a simple procedural walk-cycle animation. Not an imported rigged
  model: no properly-licensed humanoid glTF/FBX was available to source and
  verify provenance for inside this build, and this keeps the same
  known-provenance guarantee every other asset in this file holds itself
  to. If a specific CC0/CC-BY rigged humanoid model is identified and
  approved later, swapping it in only touches `avatar.js`'s mesh-building
  functions — the rig interface (`{ group, rig: { leftArm, rightArm,
  leftLeg, rightLeg } }`) is already the seam for that.
- **Exhibit category icons** (`public/world/scene.js`'s
  `buildCategoryMesh`) — one simple procedural object family per gallery
  category (framed canvas, pedestal-and-relic, vitrine-and-specimen,
  plinth-and-toy), unchanged from the prior pass: original geometry, never
  user-supplied or AI-generated imagery, per the blueprint's "no required AI
  image generation" instruction.

## Why procedural over downloaded assets

The stack has no asset pipeline (no bundler, no texture/model importer —
see `CLAUDE.md`'s zero-runtime-dependencies rule) and the course's one Fly
machine has a 256MB memory budget. Generating textures and models at load
time means there is nothing to license-check, nothing to credit beyond this
file, and no binary assets bloating the Docker image or the download a
visitor's browser has to fetch on a cold load — the entire visual
presentation ships as the same few KB of JavaScript that was already being
deployed, at the cost of the geometry reading as stylised rather than
photorealistic. That trade-off is treated as a known limitation, not hidden
— see `PROCESS.md`.
