# Asset credits and provenance

This file describes the assets used by the current illustrated museum. Older
presentation experiments remain documented in the ADRs and Git history.

## Illustrated rooms

`public/assets/gallery-scenes/` contains the Entrance Hall, four main gallery
views, dedicated reference close-ups, and earlier source/reference images.
They are project-specific illustrated artwork rather than screenshots of a
live Three.js room. Main scenes use a wide 1672px footing so the same bounded
pan/zoom system can be applied consistently.

The decision to replace a technically functional but visually generic 3D room
with illustration is documented in `docs/adr/0004-illustrated-scenes.md`. The
later single high-resolution foyer replacement is documented in
`docs/adr/0006-foyer-repair-and-archive.md`.

Built-in object previews are not separate downloaded thumbnails. The client
crops the relevant traced object directly from its own scene image, preserving
the relationship between the dossier and the item the visitor selected.

## Donated-relic illustrations

`public/assets/donated-relics/` contains four transparent PNG presets created
for the project:

- `cursed-gilt-portrait.png`
- `lunar-music-box.png`
- `impossible-botanical-jar.png`
- `burgundy-porcelain-doll.png`

The catalog in `server/src/relic-presets.js` records each image's natural
dimensions, gallery category, subtype, compatible physical surfaces, anchor,
and default scale. A donor chooses one of these images; the server validates
the declared `visualId` instead of accepting arbitrary URLs or uploads. This
small vocabulary keeps visitor contributions visually coherent while still
allowing different titles, stories, positions, scales, accounts, and votes.

## Visitor apparitions

`public/assets/ui/visitor-ghost-masculine.png`,
`visitor-ghost-feminine.png`, and `visitor-ghost-small.png` are transparent
project-specific apparition templates. A visitor chooses one at the entrance;
the selected id is shared with room-scoped presence so other visitors render
the same form. Colour and placement variation are applied by the interface,
not stored as separate image files.

## Interface and procedural assets

The Floor Plan, SVG object glows, placement-surface outlines, focus effects,
ornamental frames, dust, and ambient audio are generated from HTML/CSS/SVG or
small browser scripts. Object and surface geometry comes from hand-authored
shapes in `server/src/world.js`, not from an invisible rectangular image map.

Three.js r169 remains vendored at `public/vendor/three.module.min.js` under its
MIT licence. It is no longer part of the museum rooms or the normal donation
flow. `public/world/artifacts.js`, `furniture.js`, and `textures.js` survive as
a defensive still-preview fallback for an old database row that has no
curated `visualId`. New donations must choose a curated PNG and never enter
that fallback.

## Retired assets

The crit-10 free-roam prototype used Kenney **Mini Characters** (v1.0, 2024,
CC0 1.0 Universal) as a rigged avatar base together with Three.js loader
addons. The switch away from embodied free-roam removed the model, loader
addons, `avatar.js`, and the live room renderer. This history is retained in
Git and `docs/adr/0003-scene-exploration.md`; those files are not shipped by
the current app.

The retired procedural room furniture remains described in earlier commits
and ADRs. Current room architecture and lighting are pixels in the illustrated
scene assets, while live DOM/SVG layers provide interaction, presence, and
visitor-placed relics.
