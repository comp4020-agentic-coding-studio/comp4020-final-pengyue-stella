# Asset credits and provenance

Almost every visual asset in The Cursed Museum is either a third-party
library already covered by `CLAUDE.md`'s dependency rules, or built as
original procedural content at load time. The one deliberate exception
beyond Three.js itself is the visitor avatar's 3D model (below) — a
considered, documented hybrid decision, not a quiet reversal of the
project's zero-downloaded-assets stance: a jointed, walking humanoid is the
one asset class genuinely hard to fake convincingly with primitive geometry
and a hand-rolled walk cycle, so it alone is downloaded and vendored; every
other visual (furniture, artifact models, textures, environment) stays
procedural, for the reasons in "Why procedural over downloaded assets"
below.

## Third-party

- **Three.js** r169, MIT-licensed. Vendored as a static file at
  `public/vendor/three.module.min.js` (see that directory's own README for
  the exact pinned version and download source) — the original deliberate
  exception to the zero-runtime-npm-dependencies rule, documented since the
  prior crit. `GLTFLoader.js`, `BufferGeometryUtils.js` and
  `SkeletonUtils.js` (the three.js example addons needed to load and clone a
  skinned glTF model) are vendored alongside it at
  `public/vendor/addons/{loaders,utils}/`, downloaded from the same pinned
  `three@0.169.0` build and under the same MIT license — each imports only
  from `three` itself (or, for `GLTFLoader.js`, from
  `BufferGeometryUtils.js` next to it), so none of this touches the
  server's own dependency graph; all of it is fetched by the browser, never
  installed.
- **Kenney "Mini Characters"** (v1.0, 2024), CC0 1.0 Universal
  (public domain) — `kenney.nl/assets/mini-characters`. Only
  `character-male-a.glb` and its texture (`Textures/colormap.png`) are used,
  vendored at `public/vendor/assets/avatar/`. This is the visitor avatar's
  base model: a small rigged humanoid with an `idle` and a `walk` animation
  clip among its ~30 named clips, used for every visitor (local and remote)
  with a procedural Gothic-Victorian cape/collar/belt layered on top (see
  `public/world/avatar.js`). CC0 requires no attribution, but it's recorded
  here anyway for provenance — same discipline as crediting Three.js even
  though its license doesn't demand it either.

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
- **The visitor avatar's dressing** (`public/world/avatar.js`'s
  `buildDressing`) — a cape, collar and belt in a Gothic-Victorian
  silhouette, original primitive geometry layered onto the downloaded Kenney
  model above (tinted to the visitor's own server-assigned colour), carried
  over from the project's earlier fully-procedural avatar.
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

## Why procedural over downloaded assets (and the one exception)

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

The avatar is the one deliberate exception. A believable jointed humanoid
with a real walk cycle is a different kind of problem than a cabinet or a
candlestick — convincing joint proportions, weight-bearing animation, and a
recognisable human silhouette from any angle are exactly what primitive
geometry and a hand-authored sine-wave walk cycle struggle to sell, which
the project's earlier fully-procedural avatar (visible in git history before
this pass) openly was not. The total added footprint is small and bounded
— one ~250KB GLB plus an ~9KB texture, fetched once and cached by every
visitor's browser, not re-fetched per avatar instance — well inside the
256MB machine budget, and the license (CC0) and exact files used are
pinned above, so the "nothing to license-check" property is preserved even
though the "nothing downloaded" property isn't. Everything else a visitor
sees stays procedural.
