# ADR 0003: 2.5D fixed-scene exploration, not free-roam first/overhead movement

**Status:** Accepted — Final Project, post-crit-10 presentation pivot

## Context

The crit-10 build shipped a genuine free-roam 3D museum: a walkable
avatar, server-authoritative `(x, z, yaw)`, client-side collision, two
camera rigs (a fixed overhead third-person view and a pointer-locked
first-person view) both reading the same transform. It worked, and was
verified working (two independent sessions, real restart, real
redeploy — see `PROCESS.md`'s prior account).

The explicit direction for this pass is a presentation and interaction
pivot, not a backend rewrite: move from "a generic 3D sandbox with a
roaming third-person/first-person avatar" to "a crafted 2.5D cabinet-of-
curiosities experience" — richly staged scenes, click-driven navigation
between a small number of fixed camera vantages, optional close-up
sub-scenes, and multiplayer represented through shared activity rather
than embodied characters walking around. The brief is explicit that
unrestricted free roaming is not required and that a slideshow of flat
images is *not* the goal either — the bar is "a crafted 2.5D experience,"
not a cheap simplification of the 3D one.

## Decision

Replace continuous movement with a **fixed scene graph**: a small, named
set of camera vantages (`server/src/world.js`'s `SCENES`) — one hub
"facing" per gallery doorway in the Entrance Hall (turned between, not
cut between — see below), one main establishing shot per gallery, and one
close-up vantage per gallery aimed at its own hero display piece — each
carrying a list of **hotspots**: door (to another scene), closeup (to a
sub-scene), back (closeup → its main scene), donate (the donor counter),
lore (a short in-world caption), and exhibit (every donated relic visible
from that vantage). The client (`public/world/exploration.js`) owns
exactly two transition styles:

- **A hub turn** (left/right, between the four doorway facings) is a
  smooth look-only tween at a fixed position — standing in the hall and
  turning your head, never a cut, since the visitor hasn't gone anywhere.
- **Every other navigation** (entering a gallery, looking closer at a
  display, going back, returning to the hub) is a **cut**: a brief
  obsidian fade-to-opaque, an instant vantage swap while covered, fade back
  in. This is the "stepping through a doorway / focusing into a display"
  transition the brief names as acceptable and desirable.

Hotspots are real, always-visible, focusable `<button>` elements
positioned every frame by projecting their 3D anchor to screen space (see
`exploration.js`'s `projectToScreen`) — not a raycast-under-cursor model.
This is what keeps the mouse/touch/keyboard parity CLAUDE.md requires:
the exact same button is what a mouse clicks, a finger taps, and Tab+Enter
reaches, with no separate "aim and press E" input path to keep in sync.

**The world geometry, furniture, lighting, and artifact-library code are
unchanged.** `public/world/scene.js`, `furniture.js`, `textures.js`, and
`artifacts.js` are exactly the modules that built the free-roam version's
rooms; this pivot only changes how the camera is positioned and how a
visitor tells it where to go next, never what's drawn. The one visual
simplification is the ceiling render-layer split (`CEILING_LAYER`),
removed because it only ever existed to keep the retired overhead rig's
straight-down view unobstructed — every fixed vantage now looks roughly
level or slightly up, so the ceiling simply always renders.

## What was removed, and why it's safe to remove

- **`public/world/movement.js`** (WASD axis input, rectangle-clamp
  collision, the guided "View My Relic" autopilot walk) — there is no
  continuous position to move or collide any more. "View My Relic" is now
  a direct scene cut to the donated exhibit's gallery, landing on the
  dossier the same way walking there and pressing E used to.
- **`public/world/cameras.js`** (the overhead/first-person rig, pointer
  lock, mouse-look) — there is exactly one camera now, and it only ever
  sits at a vantage the server defines; nothing needs "which rig is
  active" branching any more.
- **`public/world/avatar.js`** and the vendored Kenney glTF model
  (`public/vendor/assets/avatar/`, `addons/loaders/GLTFLoader.js`,
  `addons/utils/{BufferGeometryUtils,SkeletonUtils}.js`) — multiplayer
  presence no longer renders any embodied character (see below), so there
  is nothing left to animate or dress. Removing this also removes the
  project's one non-Three.js downloaded asset (see `ASSETS.md`'s updated
  account) and ~260KB of vendored GLTFLoader/model payload the client no
  longer fetches.
- **`server/src/world.js`'s walkable-rect/collision exports** (`SPAWN`,
  `isWalkable`, `WALKABLE_RECTS`) and `POST /api/presence/move` — nothing
  server-side validates a continuous position any more; there is no
  position to validate.

## Multiplayer without embodied avatars

Per the brief's explicit permission ("multiplayer does not need to rely
on visible third-person characters... the primary multiplayer goal is
shared state and shared activity"), presence is now **scene-scoped**, in
the same spirit ADR 0001 (Traces of ANU) already established for that
prior project: `GET /api/events?scene=<id>` tags a connection with the
scene its visitor is currently viewing; `POST /api/presence` re-tags it
on every navigation; `server/src/sse.js` broadcasts `{ sceneId, count }`
to everyone, and the client only surfaces the count for whichever scene
it's currently in ("You are alone in this room" / "N visitors in this
room"). A restrained toast ("Another visitor has entered this room")
fires only on a genuine increase in the *current* room's own count, never
on every scene's traffic everywhere — the same "avoid excessive
notifications" restraint the exhibit/account/vote toasts already follow.
This is strictly less specific than the old presence payload (no `x, z,
yaw` ever crosses the wire for another visitor), which is a privacy
improvement, not merely a simplification.

Donations, accounts, and votes are untouched: still SQLite-backed,
still broadcast over the same SSE hub (`exhibit`, `account`, `vote`
events), still rendered live into whichever client currently has that
gallery's scene open or its dossier open — the "shared museum evolving
under other visitors' actions" claim is unchanged by this pivot.

## Consequences

- **Removed:** `public/world/movement.js`, `cameras.js`, `avatar.js`;
  `public/vendor/addons/`, `public/vendor/assets/avatar/`;
  `POST /api/presence/move`; `MOVE_MIN_INTERVAL_MS` (renamed
  `PRESENCE_MIN_INTERVAL_MS`, since the semantics are now "how often may a
  visitor retag their scene," not "how often may they post a movement
  sample").
- **Added:** `public/world/exploration.js` (the scene-cut/turn controller),
  `server/src/world.js`'s `SCENES`/`hotspotNear`, `POST /api/presence`
  (scene-only body), `scene-presence` SSE event.
- **Unchanged:** `server/src/db.js`, the exhibit/account/vote schema and
  API surface, `public/world/scene.js` + `furniture.js` + `textures.js` +
  `artifacts.js`, the SQLite persistence and transaction-before-broadcast
  discipline, the dossier/voting/donation UI logic in `public/app.js`
  (only its navigation glue changed).
- **A new verified invariant, not previously true:** every hotspot and
  every display slot's world position is checked against its scene's
  actual camera vantage (forward/right/up basis, not just "the number
  looks plausible") — a mismatch here is exactly the kind of bug that
  renders fine as a static screenshot but leaves an exhibit permanently
  unclickable, and several such bugs were caught and fixed this way before
  shipping:
  - A corner-biased establishing shot that put half of every gallery's
    display slots outside the frame — fixed by centring `roomVantage` on
    the room's own cross-axis instead.
  - A `back` hotspot anchored at a world position behind its own camera,
    and lore/closeup hotspots anchored at literal furniture or
    cross-scene coordinates that read fine from one specific vantage but
    not another — fixed by `hotspotNear`/`nearCameraAnchor`, which derive
    a hotspot's position from the vantage it actually needs to be visible
    from, not from an unrelated piece of geometry.
  - A narrower-than-reference viewport (Three.js's `PerspectiveCamera.fov`
    is vertical; horizontal FOV shrinks with aspect) silently pushing
    side-wall content out of frame — fixed two ways: `exploration.js`'s
    `verticalFovFor` keeps horizontal FOV roughly constant down to a
    capped minimum vertical FOV (avoiding fisheye distortion at extreme
    ratios), and `wallSlots`' side-wall slot placement is biased close to
    the room's far end (0.97-0.99 of its depth, not 0.3-0.7) so both fixes
    together keep every slot and hotspot strictly inside frame (no angular
    tolerance) down to a real phone-portrait aspect ratio (~0.46, an
    iPhone's CSS viewport), checked directly rather than assumed from a
    single wide-desktop screenshot.
  - Once every hotspot was reliably *in frame*, a distinct bug surfaced on
    the same narrow viewport: several hotspots projected close enough
    together in screen space (a whole room's width collapses toward one
    vanishing point on a tall, narrow screen) to visually overlap and make
    some unclickable, and an anchor near a vantage's own left/right edge
    could render with its label running off the viewport entirely. Fixed
    generally, not per-scene, by `app.js`'s `declutterHotspots`: every
    frame, after projecting each hotspot to screen space, it clamps
    horizontally within the viewport and greedily pushes any still-
    overlapping pair apart vertically — this is a property of *any* set of
    hotspots on *any* viewport, so it runs for every scene rather than
    hand-tuning spacing per gallery.

## Verification

Checked directly, not just assumed from the code:

- Every scene's hotspots and every gallery's display slots fall within
  that scene's actual camera frustum (forward/right/up angle math against
  the live `/api/world` payload), at the reference 16:10 aspect and at
  narrower (1:1, then a capped minimum) aspects — the three real bugs
  above were all found this way.
- A full click-driven walkthrough in a real headless browser (Chromium via
  Playwright): name gate → hub turn → enter a gallery → close-up → lore
  popover (auto-shown and via its own hotspot) → back → exit to hub →
  donate → receipt → "View My Relic" → dossier, with zero console/page
  errors at any step.
- Two independent browser contexts (separate cookies): both see "2
  visitors in this room" immediately on joining the same scene, neither
  before; a donation in one session instantiates its real mesh in the
  other's already-open scene within the broadcast, with no reload.
- A real process kill and restart against the same SQLite file: every
  donated exhibit from before the restart was still present after it.
