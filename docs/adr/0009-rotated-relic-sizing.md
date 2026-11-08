# ADR 0009: Grow the invisible layout box for a rotated relic, never shrink the relic itself

**Status:** Accepted — Final Project

## Context

A donation's placement preview (and the final placed exhibit) supports a
0–359° rotation dial (`public/app.js`'s `adjustPlacementRotation`), applied
as a CSS `transform: rotate()` on the relic's own rendered wrap
(`.relic-visual-wrap`, the element `applyPlacementRotation` targets). This
surfaced a real visual bug: an elongated preset (`tarnished-silver-spoon`,
naturalWidth:202/naturalHeight:673, the most extreme aspect ratio of the 16
curated presets) visibly clipped at non-axial rotation angles (reported
directly against the live deploy, e.g. a spoon rotated to 75°).

The root cause: a rotated rectangle's own axis-aligned bounding box is
larger than its unrotated one (worst near 90°/270° for an elongated asset,
near 45°/135°/225°/315° for a roughly square one), but every container the
rotated wrap sits inside — the free-placement `<foreignObject>` for both
the live drag preview and the final placed exhibit, and the fixed-size
`.receipt-preview`/`.dossier-preview` cards — was sized to the **unrotated**
artwork with `overflow: hidden` (explicit on the two cards, the SVG
`<foreignObject>`'s own UA-default elsewhere). Anything the rotated bounding
box pushed past that edge was silently clipped.

## Options considered

1. **Shrink the relic to fit its rotated bounding box back inside the
   existing container (tried first, shipped briefly, then reverted).**
   `applyPlacementRotation` computed a scale factor from the wrap's own
   aspect ratio and the rotation angle (`scale = min(ratio/(ratio·cos+sin),
   1/(ratio·sin+cos), 1)`) and applied `rotate(...) scale(...)` together.
   This genuinely eliminated clipping at every angle for all 16 presets
   (verified: the per-preset worst-case scale factor stayed in `(0, 1]`
   across every 15° step, from the spoon's 0.288 at 75° to the music box's
   0.556 at 240°). It was rejected anyway after seeing it live: turning the
   rotation dial visibly shrank and re-grew the relic as the angle changed,
   which reads as "the object changes size while you turn it" — wrong for
   any real physical object, and actively confusing feedback while
   live-dragging the rotation stepper on the in-room preview. This was a
   real, shipped, then-reverted decision (see commits `8fcf02c` then
   `ebcd7f4`), not a hypothetical rejected up front — worth recording
   exactly because it looked correct in isolation and only failed on
   actually watching it move.
2. **Grow the (otherwise invisible) layout container to the rotated
   bounding box, keep the relic's own rendered size constant (chosen).**
   `rotatedBoundingBox(width, height, rotationDegrees)`
   (`public/world/geometry.js`) computes the grown axis-aligned footprint;
   the `<foreignObject>` is sized/positioned to that grown box, centred on
   the placement point, while the inner container holding the actual relic
   artwork keeps its true, constant width/height and is centred inside the
   grown box (`layoutFreeformRelicBox`, `public/app.js`). The relic now
   visibly rotates in place at a fixed size — turning the dial changes only
   its orientation, matching how a real object behaves — because the thing
   that grows is a hit-region/layout box with no border, background, or
   visible edge of its own.
3. **Shrink only for the two fixed-box card previews (receipt, dossier),
   grow for the in-room preview and final exhibit (the actual decision,
   combining options 1 and 2 per call site).** The two card previews are
   static: a visitor looks at a rotation they already chose earlier, it is
   never dragged live in that view, and the card itself is a bordered
   element laid out next to its own title/meta text that cannot grow
   without disturbing that layout. There, shrinking to fit reads as "this
   is a photo of the relic at the angle I chose," not as a live resize, so
   option 1's downside doesn't apply. `applyPlacementRotation` keeps a
   `shrinkToFit` option (default `true`, the two cards' behaviour) and the
   in-room call sites explicitly pass `{ shrinkToFit: false }`.

## Decision

Use option 3: grow the invisible `<foreignObject>` for the in-room drag
preview and the final placed exhibit (via the shared `layoutFreeformRelicBox`
helper, used identically by `buildExhibitObject`, `renderPlacementSurfaces`,
and `updatePlacementPreviewLayout` so the three can never disagree about
where a relic's edges land on screen); keep the shrink-to-fit behaviour only
for `.receipt-preview`/`.dossier-preview`, where no visible container
resizes and the rotation is never watched live.

The bounding-box math used by both the rejected shrink approach and the
chosen grow approach is the same geometry, just applied in opposite
directions — this is not "we found a smarter formula," it is "we asked a
different thing to absorb the same unavoidable rotation overhang."

## Consequences

### Benefits

- No preset clips at any rotation angle (unchanged guarantee from option
  1 — confirmed again for all 16 presets after switching to option 2/3).
- The in-room relic — both while being actively rotated via the stepper and
  once placed — keeps a visually constant size, matching a visitor's
  physical intuition about turning an object.
- One shared helper (`layoutFreeformRelicBox`) for sizing/positioning,
  instead of three call sites independently computing `foreignObject`
  x/y/width/height, so drag preview, stepper re-layout, and the confirmed
  exhibit cannot silently drift from each other.
- `rotatedBoundingBox` is a small, pure, independently reasoned-about
  geometry function with no DOM dependency.

### Accepted costs

- Two different rotation-sizing behaviours now exist in the same codebase
  (`shrinkToFit: true` for cards, `false` for in-room boxes) rather than
  one universal rule — a future call site must deliberately choose which
  one applies, rather than there being a single obvious default. The
  `shrinkToFit` parameter and this ADR exist specifically so that choice is
  visible and justified rather than accidental.
- The in-room `<foreignObject>`'s hit region is now larger than the relic's
  own visible silhouette at any non-axial rotation (it has to be, to avoid
  clipping) — acceptable because it's a free-placement preview/exhibit box
  with generous click/drag tolerance already, not a precisely-traced hotspot
  shape the way built-in lore objects are.

## Verification

Checked both mathematically and live:

- A standalone script evaluated `rotatedBoundingBox`'s underlying formula
  against all 16 curated presets (ratios 0.300–1.500) at every 15° step and
  confirmed the grown box is always ≥ the unrotated box, consistent with
  the geometry it's modelling (the same check previously run against the
  rejected shrink factor, confirming scale stayed in `(0, 1]` everywhere).
- `pnpm check` (typecheck + `spec/`) stayed green across both the shrink
  version and the grow version — this bug class is a visual/geometry
  property neither the existing test suite nor a green CI run was built to
  catch, which is why this ADR records the live-viewing step that actually
  caught option 1's problem rather than relying on automated checks alone.
- Manually verified in the running app: rotating the placement dial through
  a full 360° sweep on the spoon preset (the most extreme aspect ratio) in
  both the live drag preview and after confirming placement, with no
  clipping and no visible size change at any angle.
