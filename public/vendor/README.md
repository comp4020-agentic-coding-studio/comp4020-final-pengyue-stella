# Vendored libraries and assets

Everything here is a static file served by `server/src/static.js` exactly
like a scene photograph — never `npm install`ed, never touching the
server's own dependency graph. This is the one deliberate exception to
`CLAUDE.md`'s "zero runtime npm dependencies" rule, and (for the avatar
model) the one deliberate exception to this project's otherwise-procedural
visual stack — see `ASSETS.md` for the full reasoning on both.

## Three.js r169 (MIT)

- `three.module.min.js` — the core library. Downloaded once from
  `https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js`.
- `addons/loaders/GLTFLoader.js` and `addons/utils/BufferGeometryUtils.js`,
  `addons/utils/SkeletonUtils.js` — the three.js example addons needed to
  load a skinned glTF model and clone its skeleton per avatar instance.
  Downloaded from the matching `three@0.169.0` build
  (`examples/jsm/loaders/GLTFLoader.js`, `examples/jsm/utils/
  BufferGeometryUtils.js`, `examples/jsm/utils/SkeletonUtils.js`), same
  license. The `loaders/`/`utils/` split mirrors the upstream package
  layout exactly, because `GLTFLoader.js` imports `BufferGeometryUtils.js`
  by the relative path `../utils/BufferGeometryUtils.js` — moving either
  file to a flat layout would break that import.

To update any of these: download the same URLs at a newer pinned version,
replace the files, and keep the version number in this note current so
provenance stays traceable.

## Kenney "Mini Characters" v1.0 (CC0 1.0 Universal)

- `assets/avatar/character-male-a.glb` + `assets/avatar/Textures/
  colormap.png` — one character model and its one shared texture from
  Kenney's CC0 "Mini Characters" pack (`kenney.nl/assets/mini-characters`),
  used as the visitor avatar's base rigged model (see
  `public/world/avatar.js` and `ASSETS.md`). The texture's path is kept
  exactly as the GLB's own internal relative URI
  (`Textures/colormap.png`) expects it, so `GLTFLoader` resolves it without
  any remapping.
