# Vendored libraries

`three.module.min.js` — [three.js](https://github.com/mrdoob/three.js) r169,
MIT-licensed. Downloaded once from
`https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js` and
committed here as a static file — it is served by `server/src/static.js`
exactly like a scene photograph, never `npm install`ed. This is the one
deliberate exception to `CLAUDE.md`'s "zero runtime npm dependencies" rule:
nothing changes in the server's own dependency graph, and the file is only
ever fetched by the browser when a visitor navigates to a scene with
depth-parallax rendering (currently only Kambri Lawn) — see
`docs/adr/0002-kambri-depth-parallax.md`.

To update: download the same URL at a newer pinned version, replace this
file, and keep that exact version number in this note so provenance stays
traceable.
