# ADR 0011: Hand-traced SVG object shapes, not percentage anchor boxes

**Status:** Accepted — Final Project, following 0005/0010

## Context

ADR 0005 introduced `interactiveObjects` as a box `anchor:
{x, y, width, height}` (a percentage of the illustration) over a specific
painted item, clipped to that box for its hover/focus/lit glow. That model
was accepted at the time and was a real improvement over floating hotspot
pills — but an audit after the foyer rebuild (ADR 0010) found the box model
itself had never actually been fitted tightly to the art it claimed to
anchor: **34 of 72** interactive-object shapes across the four galleries
were unedited 4-point rectangular placeholders, not traced silhouettes
(`d6b59cd`). One of those loose boxes was sitting on the wrong physical
object entirely — a "painted round-topped chest" hotspot was actually
positioned over a nearby ottoman, not the chest it claimed to represent
(`695d116`) — which a box loose enough to "roughly cover the right area"
had silently permitted.

A second, structurally separate problem surfaced alongside the loose-box
issue: the object (hotspot) layer and the room-art layer were being fit to
their container by two *different* scaling laws. The object layer used SVG
`viewBox` + `preserveAspectRatio="xMidYMid slice"`; the art layer used a
CSS `background-image`, with `background-size: cover` for most scenes (the
same law as `slice`, so these stayed aligned) but a hand-derived
`background-size: 180% / 50% 65%` for the `zoom: true` close-up scenes.
`background-size: <percent>` scales from container width only, while
`slice` scales by whichever axis needs the larger factor to cover — the two
rules only agree at one specific viewport aspect ratio. Every `zoom: true`
close-up (childhood, specimen) therefore drifted its art out of alignment
with its own hotspots as the viewport narrowed or the camera panned/zoomed
(`207f3cf`) — not a per-object tracing error at all, but a structural
mismatch no amount of re-tracing individual boxes could have fixed.

Separately, the source illustrations are painterly — strong local
lighting/shadow gradients, no flat background region — which matters
directly for how accurately any hotspot shape (box or traced) can ever be
authored against them by hand at reasonable effort.

## Options considered

1. **Re-trace every box tighter, keep the percentage-box anchor model.**
   Rejected: tightening a box's four corners still only approximates
   silhouettes that are rarely axis-aligned rectangles (a chandelier, a
   raven, a guardian statue's wing) — CLAUDE.md's own standard ("a
   highlight/glow treatment is load-bearing, not decorative... must read
   clearly against a crowded, dimly-lit scene") is specifically about the
   glow matching the actual painted object, which a bounding rectangle
   structurally cannot do for anything but another rectangle. This also
   does nothing to fix the separate `cover`-vs-percentage scaling mismatch
   in close-ups, which is a model-level bug, not a per-shape authoring gap.
2. **Hand-traced SVG shapes (`ellipse`/`polygon`/`path`) in the scene's own
   source-image pixel coordinate system, nested in an SVG object layer
   sharing the camera transform (chosen).** A shape is authored directly
   against the actual painted silhouette rather than approximated by a box,
   so the glow can brighten the chandelier/raven/statue itself rather than
   a rectangle around it. Rendering the object layer as a real `<svg>`
   using `viewBox`/`preserveAspectRatio` gives an exact, principled
   correspondence to the art underneath it — and, once the art itself is
   *also* rendered through the same SVG/viewBox mechanism (see Decision
   below), the two-scaling-laws bug becomes structurally impossible rather
   than something to keep re-fixing per close-up scene.
3. **Automatic silhouette extraction (colour-threshold background
   subtraction), to avoid the labour of hand-tracing 70+ shapes.** Tried
   first, genuinely shipped, then replaced (`825d4af`). It does not work on
   these specific source images: they are painterly, with strong local
   lighting/shadow gradients and no flat background region to subtract, so
   a drawn box fractured into dozens of small, useless blobs instead of one
   clean outline. This ruled out a fully automatic approach for this art
   style specifically — the eventual answer (option 4) is AI-*assisted*
   tracing, not AI-*automatic* tracing, precisely because this option's
   failure showed the model needs a human-supplied prompt region, not a
   blind segmentation pass.
4. **AI-assisted tracing via a real segmentation model (SlimSAM), as
   authoring tooling rather than a runtime feature.** Not an alternative to
   option 2's shape model — a tool built to make authoring option 2's
   shapes fast enough to be practical at this scene count. A dev-only page
   (`public/tools/hotspot-editor.html`) lets an author draw a loose box; the
   box centre becomes a foreground prompt point and its corners become
   background points for SlimSAM (a distilled Segment Anything variant, run
   client-side via transformers.js/onnxruntime-web), and the model's mask is
   traced into a normal, fully hand-editable polygon. This is the
   documented, deliberate exception to the project's zero-runtime-
   dependency rule (`PROCESS.md`, `CLAUDE.md`) — scoped tightly: vendored
   under `public/tools/vendor-sam/`, never linked from museum navigation,
   never imported by any `server/`/`public/` app code, so the museum's own
   dependency graph is unaffected by its presence.

## Decision

Replace percentage anchor boxes with hand-traced (optionally AI-assisted)
SVG shapes, commit `18e9239`:

- Three shape types: `ellipse` (round/oval objects), `polygon` (anything
  with real straight or angled edges), and `path` (reserved for a future
  silhouette too organic for a polygon; not currently needed by any object
  in this world, but the schema supports it per the brief).
- A shape is authored in the scene's own source-image pixel coordinate
  system (`viewBox`, e.g. 1672×941), never a 0–100 percentage — this is
  also why `viewBox` is given in image-native pixels rather than
  percentages: it is what lets the SVG's own internal coordinate system
  track the background image's own crop pixel-for-pixel at any viewport
  size, once the art is rendered the same way (see below).
- The scene's room art itself moved from a CSS `background-image` to an SVG
  `<image>` inside an `<svg>` carrying the *exact same* `viewBox` as the
  object layer (`207f3cf`) — this is what closes the structural scaling
  mismatch from the Context section, not a per-shape fix. Verified via
  `getScreenCTM()`-based pixel measurement across every gallery (main and
  close-up) and the hall, at normal and narrow viewports and through
  drag-pan/wheel-zoom: 0.000px delta between the art and object layers at
  every sampled point.
- Hover/focus/lit now brightens a `clipPath`'d copy of the scene art to the
  object's exact traced silhouette, replacing a glow drawn over a bounding
  box.
- Hotspots are real `<g role="button">` elements with `tabindex` and
  Enter/Space activation (preserving CLAUDE.md's mouse/touch/keyboard
  parity requirement) plus an optional `hitPadding` — a larger invisible
  hit/touch region grown outward from the same silhouette
  (`expandShape`, `server/src/geometry.js`), kept deliberately separate from
  the *visible* glow shape, which always renders at the exact traced
  silhouette and never grows just to be easier to click.
- `placementSurfaces` (traced wall/shelf/tabletop/cabinet/plinth polygons
  with a relic-subtype compatibility list) and the client-side drag-to-place
  preview UI landed in the same commit, since they share the same SVG/shape
  infrastructure and don't split cleanly from it.

## Consequences

### Benefits

- A mark on an exhibit or lore object now genuinely tracks the painted
  object itself, satisfying CLAUDE.md's "glow treatment is load-bearing"
  standard literally rather than approximately.
- The art/object scaling mismatch is now structurally impossible to
  reintroduce per-scene (both layers share one `viewBox`/`preserveAspectRatio`
  mechanism), rather than being a per-close-up value someone has to get
  right by hand every time a new `zoom: true` scene is added.
- `hitPadding` keeps "easy to click" and "visually precise" as two
  independently tunable properties of the same shape, rather than trading
  one off against the other by loosening the visible box.

### Accepted costs

- Hand-tracing (even AI-assisted) is real, ongoing authoring work, not a
  one-time migration — an extended series of later retrace commits
  (`434d013`, `f02b02b`, `3c5e31e`, `b7b5e56`, `250ce7d`, `c3c1d25`,
  `653eb04`, `a203810`, among others) continued tightening outlines, fixing
  misnamed objects, and adding newly-traced objects well after this ADR's
  own commit — this is the expected cost of "shapes that actually match the
  art," not a regression.
- The one deliberate dependency exception (`public/tools/vendor-sam/`,
  ~62MB) exists because of this decision. It is scoped to a dev-only tool
  never reachable from the shipped app, but it is still the project's one
  genuine departure from zero runtime dependencies, and needs to be
  justified again if the tool's scope ever grows.
- `server/src/static.js` gained `.wasm`/`.onnx` MIME types solely to serve
  the vendored SAM runtime/model files — inert unless something under
  `vendor-sam/` is actually requested, but a real (if narrow) production
  code touch this decision required.

## Verification

Checked directly against the running app at each stage, not assumed from
coordinate math alone:

- `d6b59cd`'s retrace of all 34 placeholder-box shapes was verified against
  brightness-enhanced grid crops of each object, with a candidate-overlay
  zoom crop checked before applying each shape.
- `695d116` re-verified every hall and childhood-gallery (now **The Nursery
  of the Unclaimed Child**) hotspot against the source art directly (not
  just re-run coordinate math), which is specifically how the mislabeled
  ottoman/chest hotspot was caught.
- `207f3cf`'s art/object alignment fix was verified with
  `getScreenCTM()`-based pixel measurement (0.000px delta) across every
  gallery and the hall, at both normal and narrow viewports and through
  live drag-pan/wheel-zoom — a measurement a static screenshot review could
  not have caught, since the bug only manifested as the viewport's aspect
  ratio changed.
- `ff9096c` found a related but distinct glow-alignment bug (the close-up
  dossier preview's glow `<image>` was sized from a shape's own cropped
  viewBox rather than the scene's real backing-image size) by the same
  direct-comparison-against-source-art method, fixed by each scene
  declaring an explicit `sourceImage`/`objectViewBox` pair instead of
  `illustration.js` inferring one from the first object's own shape.
- The SAM-assisted tracing tool (`825d4af`) was verified end-to-end against
  a real gallery image in a live, non-headless browser session — not just
  unit-level mask/polygon math — since the thing being verified (does a
  drawn prompt box actually produce a usable traced silhouette on this
  specific painterly art) is not something a unit test can answer.
