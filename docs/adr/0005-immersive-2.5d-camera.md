# ADR 0005: A bounded 2.5D camera and invisible-until-attended objects, over the same illustrations

**Status:** Accepted — Final Project immersion pass, following 0004

## Context

ADR 0004 replaced a live Three.js room with full-bleed illustrated scenes and
restored visible donation, voting, and presence — a real improvement, but
manual review at this pass found the interaction layer still read as
"ordinary web buttons pasted over a background": pill-shaped hotspot labels
("Look closer: The Watching Portrait"), floating exhibit cards with a
thumbnail/title/donor/INSPECT button, a large central room-entry bubble, and
a "Display slot" `<select>` for donation placement. None of that chrome
looks like it belongs to the museum; all of it sits on top of the art rather
than inside it.

## Decision

**A bounded, per-scene 2.5D camera** (`public/world/camera-math.js` +
`camera.js`) replaces the fixed, un-pannable illustration. Pan is an
abstract 0–100 position along a scene-authored `[minPan, maxPan]` range;
zoom is a multiplier within `[minZoom, maxZoom]`. Both are driven by
pointer drag (with inertia, skipped under `prefers-reduced-motion`), wheel/
trackpad (vertical = zoom, horizontal = pan), and keyboard (`←`/`→` pan,
`+`/`-` zoom). The art, interactive-object glows, and visitor cameos all
live inside one `.scene-room` plane that takes a single `scale() 
translateX()` transform per tick, so a glow stays pixel-locked to the
painted item it represents as the camera moves; the dust layer takes a
lighter parallax fraction of the same transform, and the vignette/frame
sit outside it entirely (fixed — "the edge of the window"). This is
presented honestly as a wide 2.5D room view, never a 360° panorama — the
source illustrations are single 16:9 frames; a wider panorama could later
drop into the same `camera` config without any camera-code changes, since
the config's `minPan`/`maxPan` degrees of freedom don't assume any specific
image width.

**Interactive objects replace hotspot pills and exhibit cards.** Each
scene's `interactiveObjects` (`server/src/world.js`) carries a box `anchor`
over a specific painted item (a portrait, a bust, a locked drawer, a caged
glow) rather than a label floating at a point. The client renders each as a
`<button>` that is visually `background: none` at idle — the actual object
only gets an outline/glow on hover, keyboard focus, or while its
information is open (`.hovered`/`:focus-visible`/`.lit` in `styles.css`),
clipped to the anchor box so it reads as the chandelier/portrait/relic
itself lighting up, not a UI affordance drawn over it. A real donated
exhibit renders the same way (`buildExhibitObject`), replacing the old
tilted "Gothic display card."

**Room-to-room navigation is a first-class, separate field (`nav: {
forward, back }`)**, not an `interactiveObjects` entry — this is what lets
the client render it as quiet corner chrome (`#nav-forward` upper-left,
clear of the title; `#nav-back` lower-right) with the label hidden until
hover/focus, rather than guessing which in-room object is "actually a
door." A "Rooms" menu gives direct access to any gallery without walking
through the hub one facing at a time.

**Lore and dossier content open in a side drawer** (`.side-drawer`, slides
from the right, `width: min(420px, 100%)`), not a full-screen gate — the
illuminated object stays visible beside it, satisfying "the selected object
remains illuminated while its information is open" directly rather than by
convention.

**Donation placement becomes a two-step spatial workflow**, not a "Display
slot" `<select>`. The existing form (gallery, relic type, title, claim,
donor) is unchanged; submitting it enters *placement mode* instead of
POSTing immediately — the client navigates to the chosen gallery, renders
only the gallery's currently-free, server-defined slot anchors as glowing
`.placement-anchor` elements (an occupied anchor is invisible, never a
decorative empty card), and the donor clicks one, confirms a ghost preview,
and only then does the client POST to the *same, unchanged*
`POST /api/exhibits` with `{ ...form, slotId }`. No pixel coordinate ever
reaches the server — the slot id is still the one server-defined,
allow-listed value it always was; this is a presentation change over an
unchanged, already-transactional slot-claim.

**Visitor cameos move to server-defined `visitorAnchors`** (a small fixed
set of percentage boxes per scene, each with a `depth` value used as a
parallax-scale cue) instead of a fixed `CAMEO_SPOTS` array keyed only by
slot index. Visitors are assigned anchors deterministically by sorting on a
hash of each visitor's existing one-way `publicKey` (`assignAnchors` in
`app.js`), so a given visitor's position is stable across re-renders
without the server needing to track or broadcast positions — consistent
with ADR 0002's "high-frequency movement is never persisted, and here not
even server-assigned" stance. A name stays hidden until hover/focus/open,
with a compact visitor-list chip row as the always-visible alternative.

## What was removed, and why it's safe to remove

- **Pill-shaped hotspot buttons and floating exhibit cards** (`.hotspot`,
  `.hotspot-donate`, `.exhibit-card` and all its children,
  `.decorative-frame`, `@keyframes hotspot-glow`) — replaced by the
  invisible-until-attended `.interactive-object` treatment described above,
  which both galleries' and the hub's objects now use uniformly.
- **The donate form's "Display slot" `<select>`** — replaced by the
  placement-mode anchor-click workflow; the server-side slot validation and
  uniqueness constraint it relied on did not change.
- **The single global `#hotspot-layer`/`#cameo-layer`** — replaced by
  per-physical-layer `object-layer`/`cameo-layer` pairs (one per A/B scene
  layer) so each layer's own camera transform carries its own objects and
  cameos without the two physical layers' content bleeding into each
  other during a scene-cut transition.

## Consequences

- **Added:** `public/world/camera-math.js` (pure, unit-tested: clamping,
  drag-to-pixel conversion, inertia decay, the layer transform itself),
  `public/world/camera.js` (DOM wiring), `spec/camera.test.ts`, `nav`/
  `camera`/`visitorAnchors`/widened `anchor` boxes on `server/src/world.js`'s
  scene graph, the placement-mode and corner-nav/rooms-menu UI in `app.js`.
- **Changed `tsconfig.json`:** added `allowJs` (with `checkJs` left off) so
  `tsc --noEmit` can resolve `spec/camera.test.ts`'s import of the
  plain-JS, dependency-free `camera-math.js` module without erroring on an
  implicit `any` — this does not newly typecheck any application code, only
  lets the existing `spec/`-scoped typecheck see through this one import.
- **Unchanged:** the donation/exhibit/slot data model and its transactional
  slot-claim, vote/classification rules, SQLite persistence, the one-SSE-hub
  transport, and the percentage-anchor world model itself (anchors grew a
  `width`/`height` box instead of staying a bare point, but the underlying
  "server defines valid positions, client never sends a free coordinate"
  contract from ADR 0004 is unchanged).

## Verification

Checked directly against the running app (headless Chrome over the Chrome
DevTools Protocol, no Playwright/Puppeteer available in this environment):
hub → gallery → close-up scene cut with camera reconfiguration and
side-drawer lore; hover/focus glow on an in-room object, confirmed via
`getComputedStyle`; the full donation → placement-mode → anchor-click →
confirm → receipt → dossier flow; vote casting and the resulting
classification-label update in the dossier; a two-independent-browser-
context session confirming both visitors see each other's cameo and a live
donation without a reload; a 390×844 mobile viewport pass including a
touch-drag pan; a `prefers-reduced-motion: reduce` pass confirming pulse/
glow animations disable; a keyboard-only pass (Tab order, native button
Enter/Space activation, arrow-key pan, Esc closing lore/placement/menus in
turn); and a console-error check across the whole walkthrough (none).

This caught two real bugs, both fixed before this commit:

1. **The camera's layer transform could drag art off its own edge.** The
   original `transformFor` used `(pan - 50)` directly as a `translateX`
   percentage, ignoring how `scale()` and `translateX()` compose (a
   pre-scale translate ends up visually multiplied by the outer scale) — at
   a narrow mobile viewport, a full-width drag could reveal bare black
   background past the illustration's edge, violating "the artwork can
   never be dragged outside valid viewing area" directly. Fixed by deriving
   the safe translate bound from the layer's own overflow,
   `(scale-1)/(2*scale) * 100`, and covered by a new test in
   `spec/camera.test.ts` that asserts the *visual* shift (`translateX% *
   scale`) never exceeds the layer's own overflow at any pan/zoom
   combination the scene graph can produce.
2. **"View My Relic" (and the Archive's "jump to this exhibit") silently
   did nothing when the target gallery was already the current scene.**
   Both relied on `illustrator.goToScene` to fire a scene-change event
   that would then open the dossier — but `goToScene` intentionally no-ops
   when the destination is already current (there is no scene to cut to),
   which is exactly the common case right after placing a relic in the
   gallery the donor is already standing in. Fixed with a small
   `goToSceneThen(sceneId, then)` helper that runs `then` immediately when
   already on the target scene, used by both call sites.
