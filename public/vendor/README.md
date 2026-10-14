# Vendored libraries

Everything here is a static file served by `server/src/static.js` exactly
like a scene photograph — never `npm install`ed, never touching the
server's own dependency graph. This is the one deliberate exception to
`CLAUDE.md`'s "zero runtime npm dependencies" rule — see `ASSETS.md` for
the full reasoning.

## Three.js r169 (MIT)

- `three.module.min.js` — the core library, and the only thing left in this
  directory. Downloaded once from
  `https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js`.

To update: download the same URL at a newer pinned version, replace the
file, and keep the version number in this note current so provenance stays
traceable.

## Retired

An earlier pass (the crit-10 free-roam version) also vendored
`addons/loaders/GLTFLoader.js`, `addons/utils/BufferGeometryUtils.js`,
`addons/utils/SkeletonUtils.js` (the three.js example addons needed to load
and clone a skinned glTF model) and a Kenney "Mini Characters" model under
`assets/avatar/`, used as the visitor avatar's base rigged model. The 2.5D
scene-exploration pivot removed embodied avatars entirely (see
`docs/adr/0003-scene-exploration.md`), so none of that is loaded any more
and all of those files were deleted — see `ASSETS.md`'s own "Retired"
section for the full provenance record, kept there rather than lost.
