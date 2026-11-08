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

## Options considered

1. **Restyle the existing chrome in place (reskin hotspot pills and exhibit
   cards with gothic CSS, keep the flat un-pannable illustration).**
   Rejected: the problem isn't the pills' *styling*, it's that a label or
   card floating over the art is structurally a UI affordance bolted on top
   of a picture, never the picture's own object lighting up — CLAUDE.md's
   "a highlight/glow treatment is load-bearing, not decorative" standard
   can't be satisfied by a prettier label, only by the object itself
   reacting. A flat illustration also still reads as a static image rather
   than a room, no matter how its overlays are styled.
2. **Reintroduce a free 3D camera the visitor steers (undo ADR 0003's
   pivot).** Rejected: this is exactly the "generic 3D sandbox" complexity
   and embodied-avatar framing ADR 0003 already removed for good reason —
   bringing back continuous camera movement to fix a 2D chrome problem
   would re-open the collision/rig surface the prior pivot closed, for a
   problem that doesn't require it.
3. **A bounded, per-scene 2.5D camera (pan/tilt/zoom) over the same
   illustration, with hover/focus glow clipped to each painted object's own
   anchor instead of a floating label (chosen).** Restores a sense of depth
   and "looking around a room" without any continuous position to
   validate, and lets every interactive element — object, nav, placement —
   read as part of the room rather than UI pasted over it.

## Decision

**A bounded, per-scene 2.5D camera** (`public/world/camera-math.js` +
`camera.js`) replaces the fixed, un-pannable illustration. Pan is an
abstract 0–100 position along a scene-authored `[minPan, maxPan]` range;
tilt is pan's vertical twin, the same 0–100 space bounded by a scene-
authored `[minTilt, maxTilt]` range (a scene config that doesn't author it
defaults to 50/50 — no vertical range at all — so every camera config
written before this addendum keeps behaving exactly as it did); zoom is a
multiplier within `[minZoom, maxZoom]`. All three are driven by pointer drag
(both axes at once, each with its own independent inertia, skipped under
`prefers-reduced-motion`), wheel/trackpad (vertical wheel still zooms —
the far more common gesture for "move closer/further" — horizontal pans;
tilt is a drag/keyboard-only axis), and keyboard (`←`/`→` pan, `↑`/`↓`
tilt, `+`/`-` zoom). The art, interactive-object glows, and visitor cameos
all live inside one `.scene-room` plane that takes a single `scale()
translate()` transform per tick, so a glow stays pixel-locked to the
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

## Addendum: ephemeral cross-visitor focus broadcast

A deterministic anchor and a hover-reveal name alone still leave "there are
two of us in this room" feeling inert — nothing connects one visitor's
cameo to what they're actually doing. A new `POST /api/presence/focus`
reports a visitor's current `object:<id>`/`exhibit:<id>` focus (or `null`,
"stopped looking at anything") whenever `setFocusedObject` changes it on
the client; the server relays it as a `focus` SSE event, but only to other
connections already tagged with the *sender's own* current scene
(`sse.sceneIdForVisitor` + the new `sse.broadcastToScene`, never a client-
asserted scene) — a client can never announce a focus event into a room it
isn't actually in. The payload is `{ publicKey, objectId }`: no position,
no new personal information, and nothing persisted — this is the same
"ephemeral, scene-scoped, never a reintroduced position" discipline ADR
0004's cameo work already established, extended to a second, equally
transient signal. A receiving client turns the sender's own cameo
`.attending` (the existing cameo-silhouette treatment from ADR 0004,
unchanged) and gives the focused object itself a brief, distinct
`.peer-glance` glow — a cool-toned flash, so "someone else is looking at
this" never reads as "you are looking at this" (the warm amber `.lit`
state). Both client-side and server-side rate-limiting (debounce + the
existing `*_MIN_INTERVAL_MS` pattern) bound this to a discrete per-
interaction event, never a per-frame stream.

Verified with the server-level scoping test in `spec/world.test.ts`
(`real-time: ephemeral focus broadcast`, two independent visitor cookies,
asserting a focus event from a different-scene visitor never arrives and a
same-scene one does), and live in two independent headless-Chrome browser
contexts: opening a portrait's close-up or a lore object from one visitor's
session visibly turns the other visitor's cameo "attending" and flashes
the shared object's glow within one SSE round-trip.

This caught one real bug: activating a `closeup`-type interactive object
(clicking "look closer" at a portrait — the single most common interaction
in the museum) never called `setFocusedObject` at all, because a click
never fires a native DOM `focus` event the way Tab navigation does, and
`handleObjectActivate`'s `closeup` branch only ever called
`illustrator.goToScene`. Fixed by calling `setFocusedObject` explicitly
before the scene cut.

## Addendum: vertical tilt, pan's missing twin

Manual review after the horizontal-only camera shipped found a visitor
could drag/swipe left-right but a vertical drag or the `↑`/`↓` keys did
nothing — a room with real vertical composition (a chandelier overhead, a
carpet runner underfoot) still only let a visitor look sideways, not up or
down, within the same bounded "look around the room" the brief asks for.

**Tilt is pan's exact vertical twin**, not a new mechanism: the same
abstract 0–100 range (50 centred), the same per-scene authored bound
(`minTilt`/`maxTilt` alongside `minPan`/`maxPan` in `server/src/world.js`),
the same safe-overflow derivation in `transformFor` (now `scale()
translate(x%, y%)` instead of `scale() translateX(x%)`), the same drag-to-
pixel conversion (`dragDeltaToTilt`, against the container's height instead
of its width), and its own independent inertia on release. A scene that
doesn't author `minTilt`/`maxTilt` defaults to 50/50 — no vertical range at
all — so every existing camera config (and `spec/camera.test.ts`'s existing
pan-only assertions) keeps behaving exactly as before; `DEFAULT_MAIN_CAMERA`
and `DEFAULT_CLOSEUP_CAMERA`, and every gallery's own `closeupCamera`
override, now author a real (narrower) vertical range so every scene
actually gets a meaningful up/down look, not just a theoretical one.

Wheel/trackpad input keeps a plain vertical wheel mapped to zoom (the more
common "move closer" gesture, and the one visitors already learned from the
horizontal-only camera) rather than repurposing it for tilt — tilt is
reachable by drag and by the new `↑`/`↓` keys, mirroring `←`/`→` for pan
exactly.

Verified with `spec/camera.test.ts`'s extended transform test (the same
"never exceeds the layer's own overflow" assertion, now checked on both
axes across a pan × tilt × zoom grid) and live in headless Chrome: `↑`/`↓`
visibly change the room plane's computed `transform` and clamp at the
scene's authored bound, a vertical pointer drag changes the same transform's
vertical component while an unrelated horizontal drag still changes only the
horizontal one, and no console errors across the walkthrough.

## Addendum: procedural ambient audio

**Superseded.** This addendum describes the soundscape as it stood at the
time it was written. At the project owner's direction it was later replaced
with a single licensed music track played through an `HTMLAudioElement`
instead of synthesized Web Audio — see `ASSETS.md`'s "Background music"
section for the track's title/source and `public/world/ambient.js`'s own
header comment for the current implementation. The user-gesture gating,
on/off toggle, persisted preference, and pause-while-hidden behaviour
described below all still apply to the current version; only the audio
source itself (synthesized vs. a decoded file) and the default preference
(now on, not off) changed.

A small, original Web Audio soundscape (`public/world/ambient.js`) — a low
sine/triangle drone plus occasional distant chime tones and filtered-noise
creaks, entirely synthesized, never a decoded audio file — gives each
gallery a restrained tonal identity without adding any copyrighted audio
asset or a new runtime dependency (CLAUDE.md's zero-dependency stance
extends naturally to audio here). Per-gallery variation (drone pitch, chime
timbre) is derived deterministically from the gallery's own id via a small
hash, so no new server field or audio asset is needed per room; changing
gallery glides the drone to its new pitch rather than cutting.

The `AudioContext` is constructed only inside the `#sound-toggle` button's
own click handler — never on page load, never from a restored preference —
so audio can never start without a real user gesture. The toggle's visual
state always reflects whether audio is actually playing, never a stale
`localStorage` preference, so it can never read "on" to a screen reader
while silent; the preference is still persisted for a possible future
default, but restoring it never itself triggers playback. The whole graph
suspends on `visibilitychange` (not just mutes) while the tab is hidden, so
no oscillator/scheduling work runs on an unseen page, and resumes only if
the visitor had actually turned it on.

Verified: toggling on/off updates `aria-pressed`/the stored preference
correctly; a full walkthrough (toggle on, navigate hub → gallery → close-up
→ back → back, simulate a hide/show visibility cycle, toggle off) produces
no console errors; Tab order naturally includes the toggle alongside the
other topbar controls, so it participates in the existing keyboard pass
without any new handling.

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
