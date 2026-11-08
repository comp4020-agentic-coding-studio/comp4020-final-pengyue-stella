# ADR 0010: One real high-resolution foyer image, not four stitched low-res facings

**Status:** Accepted — Final Project, following 0005

## Context

Before this pass, the Entrance Hall was not one scene but four
("hall-n"/"hall-e"/"hall-s"/"hall-w"), each a `kind: "hub"` facing turned
between with dedicated left/right "turn" UI controls — standing in place
and looking a different direction, never actually going anywhere. All four
facings were crops of the exact same single reference image,
`entrance-reference.webp`, which is only **494×398px** — far below the
1672×941 full-size illustration every gallery's own main scene already had.
Only the south-facing crop showed the donor counter at all, and the hall
had no real lore objects of its own (a chandelier, guardian statues, a
floor mosaic, an antique map) the way every gallery already did, because
there was no detailed enough source image to trace them against.

This mismatch mattered beyond resolution: the hall was the museum's actual
entrance, the first thing every visitor saw, and it was visibly the
thinnest, lowest-fidelity room in the building — four soft, cropped facings
and a special "turn" interaction mode no other scene had, instead of the
same bounded pan/zoom/drag every gallery already used. A high-resolution
replacement illustration (`entrance-hall-v2.png`, 1672×941 — the same
full-size footing as every gallery image) became available, making a real
fix possible rather than a workaround.

## Options considered

1. **Re-crop the four facings from a newer, larger single source image,
   keep the turn-between-facings interaction.** Rejected: this still
   leaves the hall as a special case with its own navigation mode (dedicated
   turn-left/turn-right controls, `kind: "hub"` special-casing throughout
   `illustration.js`/`app.js`/`index.html`/`styles.css`) that every other
   room doesn't need, for no benefit once a single wide image exists. It
   would also have kept the four-facing door layout, which only showed two
   of the four galleries' doorways in any given facing at once — a visitor
   had to turn through up to three facings to find the door they wanted.
2. **One real wide-angle foyer scene, panned/zoomed/dragged exactly like
   every gallery's main scene (chosen).** Collapses all four facings into a
   single `hall` scene using `entrance-hall-v2.png`, with the same bounded
   camera treatment (ADR 0005) every other room already has — no special
   interaction mode, no turn controls to maintain. The hall's two doorways
   actually visible in this one wide frame (to the memento and specimen
   galleries) become ordinary `type: "portal"` interactive objects, pointing
   directly at those two galleries; the other two galleries stay reachable
   exactly the way an off-frame gallery already was for any other scene —
   through the persistent "Rooms" menu, not a doorway click. This is an
   accepted trade-off, not an oversight: only 2 of 4 galleries get a direct
   in-frame doorway, because the single wide image genuinely only shows two
   archways from this one vantage; a visitor loses nothing they could
   reliably do before (finding all four doors required turning through
   facings in the old model too), and gains a hall that finally looks and
   behaves like the rest of the museum.

## Decision

Replace the four-facing hub with one `hall` scene over `entrance-hall-v2.png`
(commit `b55d693`). Concretely:

- Removes `HALL_FACINGS`, the turn-left/turn-right UI, and all `kind: "hub"`
  special-casing across `illustration.js`, `app.js`, `index.html`, and
  `styles.css` — the hall now goes through the exact same scene/camera code
  path as a gallery's main scene.
- Adds real, hand-traced lore objects anchored to the actual painted hall
  furnishings now visible at full resolution: the chandelier, both guardian
  statues, the floor compass mosaic, the antique map, the mechanical clock,
  and the chained guestbook.
- Expands each gallery's own display-slot anchors from 6 to 8, aligned
  across two rows of real floor/wall furniture — a side effect of the
  higher-resolution source giving more room to place donated relics
  legibly.
- `spec/world.test.ts`'s scene-graph assertions updated to match the
  single-scene hall instead of four facings.

## Consequences

### Benefits

- The hall now matches every gallery's own interaction model exactly — one
  less special case to maintain, test, or explain to a new contributor.
- The hall finally carries its own lore and atmosphere instead of being a
  thin pass-through corridor between galleries.
- Higher base resolution gave the subsequent object-shaped hotspot pass
  (ADR 0011) something precise enough to trace against — this pass is a
  direct precondition for that one, not an independent improvement.

### Accepted costs

- Only 2 of 4 galleries have a direct in-frame doorway from the hall's one
  vantage; the other 2 require the Rooms menu. Accepted because no prior
  version let a visitor reach all four galleries without some form of
  turning/menu use either.
- A full retrace pass was still needed immediately after (several follow-up
  commits — `2c660ad`, `647a2e8`, `0364f10`, `3910934`, `e7e67d8` — fixing
  doorway arch shapes, portal/antique-map alignment, and adding further hall
  lore objects) — a new, more detailed source image doesn't retrace itself,
  and this cost was paid up front rather than discovered incrementally
  across unrelated later work.

## Verification

Checked directly against the new image, not assumed from the old facings'
coordinates: `2c660ad` hand-retraced all 13 hall objects against
`entrance-hall-v2.png` using the hotspot-tracing tool (ADR 0011); `647a2e8`
specifically corrected two doorway hitboxes that had been traced as plain
rectangles cutting through the surrounding stone spandrel, refitted to the
actual gothic arch opening; `0364f10` and `3910934` caught and fixed small
residual misalignments (a uniform coordinate nudge, then a visual — not
just coordinate-math — re-inspection using a since-removed debug overlay
against real screenshots, which found a couple of "fine traced" polygons
were actually less accurate than the boxes they'd replaced and reverted
those specific ones).
