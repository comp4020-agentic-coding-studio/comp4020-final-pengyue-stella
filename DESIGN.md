# Design — The Cursed Museum

Source of creative truth: `design/The_Cursed_Museum_Project_Blueprint.pdf`.
This file is the working translation of that blueprint into a buildable
contract; where the two disagree, the blueprint wins unless a binding course
constraint (see `PROCESS.md`) forces a change, in which case the change and
its reason are recorded here.

## Visual identity

Gothic cabinet of curiosities / Victorian wunderkammer: warm amber light in
deep shadow, dark carved wood, brass fittings, crowded glass cases, aged
parchment. Never gore or cheap horror; the unease is in suggestion and
accumulation (how much is in the room, how it's lit), not shock.

| Role | Hex | Use |
| --- | --- | --- |
| Obsidian | `#11100F` | Deepest backgrounds, void beyond the walls |
| Mahogany | `#35251C` | Architecture, floors, wood props |
| Antique brass | `#88653D` | Ornament, metal trim, frame edges |
| Old gold | `#C6A16B` | Highlights, interactive glow, focus rings |
| Parchment | `#E9DDC5` | Text, dossier paper, UI panels |
| Dried rose | `#663D43` | Disputes, warnings, "Definitely Cursed" |

Typography: a serif display face for titles and brass nameplates, a neutral
accessible sans for forms and long archival text (system font stacks —
Georgia/Cormorant-style serif, system-ui sans — rather than a webfont
dependency, since nothing here needs licensing risk for a four-gallery demo).

Lighting in the 3D world is a handful of warm point lights per room (per-room
colour-graded ambient + 2–4 lamps), not one flat scene light, so the rooms
read as distinct even built from the same modular geometry kit.

## World model — one shared space, two camera rigs

Everything lives in one Three.js scene graph and one coordinate system.
There is exactly one avatar position per visitor (`x, z` on the floor plane,
plus a facing `yaw`), maintained server-side as the authoritative value and
mirrored by every connected client.

- **Camera A — Overhead.** A third-person camera fixed at a steep downward
  angle, offset behind-and-above the avatar's yaw, orbiting with it. Good
  for spatial awareness of a whole room.
- **Camera C — First-person.** The camera sits at head height directly on
  the avatar's position; mouse-look controls yaw/pitch (pointer-lock on
  desktop, drag on touch). The avatar mesh itself is hidden in this mode
  (its camera is "inside" that mesh).
- **V** swaps the active rig without touching position, yaw, collision
  state, or server-authoritative state at all — it is a pure client-side
  render switch over the same transform.

Collision: each gallery carries a simple set of axis-aligned wall segments
and a few prop footprints; movement is resolved by clamping the attempted
displacement against the nearest segment each frame, run identically
regardless of which camera is active (the world doesn't know which camera is
looking at it).

Floors, doors, and the four galleries are static server-side config (not
donated/user content), each with a stable `galleryId`. Each gallery exposes a
small number of **display slots** — predefined `{x, z, rotationY}` anchors
where a donated exhibit's mesh is placed — enough per gallery that the
opening room never looks sparse, with a documented behaviour for when a
gallery's slots are all full (see Interaction below).

Pointer picking (mouse click in either camera) raycasts against exhibit
meshes and resolves to the same `exhibitId` regardless of which rig is
active; **E** interacts with whichever exhibit is nearest the avatar within a
fixed interaction radius, so inspection works identically for a keyboard-only
visitor.

## Exhibition architecture

| Gallery | Theme | Staging |
| --- | --- | --- |
| I. The Portraits That Watch | Ambiguous portraits, identity | Framed portraits on walls, a worn runner rug |
| II. Objects That Remember | Impossible provenance | Pedestal cases, a long table of small relics |
| III. The Cabinet of Impossible Life | Unreliable natural history | Glass vitrines, specimen jars on shelving |
| IV. The Forgotten Childhood | Unsettling toys | Velvet-topped plinths, shelved dolls and music boxes |

Galleries connect off a central Entrance Hall (visitor spawn, donor counter,
shared presence first impression). Each gallery has a sign naming it, a
doorway back to the hall, collision walls, and enough non-interactive clutter
(generated prop instances, not hand-placed one by one) to read as inhabited
rather than empty.

## Core loops

**Visitor journey.** Enter a display name → spawn in the Entrance Hall →
move via WASD/arrows → see a highlighted/glinting exhibit → approach, click,
or press E → dossier overlay opens → read competing accounts, vote, or add a
new account → Esc → back in the world, now aware the archive just changed
under other visitors too.

**Donate a relic.** At the donor counter (an interactive hotspot in the
Entrance Hall), a form collects: gallery, category (portrait / memento /
specimen / toy — one per gallery, keeping the gallery-category mapping
simple and always valid), title, one-sentence origin claim, donor display
name, and a specific open display slot in that gallery (occupied slots are
not offered). The server validates the gallery/category/slot combination
inside one transaction, creates the exhibit, and broadcasts `exhibit.created`
to every connected client, who instantiate its mesh at that slot without a
page reload.

**Inspect a relic.** The dossier is a parchment/brass-styled overlay over the
(paused but not hidden) world: exhibit number, procedurally-styled icon,
title, gallery, donor, every account in chronological order each tagged
*Original Account / New Testimony / Contradiction / Proposed Revision /
Counter-Evidence*, each account's own vote tally and the visitor's own current
vote on it, and an "Add Counter-Evidence" action. Esc returns to the world
at the exact same position/facing. The overlay is reachable and operable by
Tab/Enter alone.

**Rewrite history.** Publishing a new account never mutates or removes an
existing row. A new account optionally carries `challengedAccountId`,
pointing at the account it disputes; the exhibit's "currently accepted"
account is a derived pointer (highest `Believable`-weighted vote total among
accounts with no higher-voted account between them in time) recomputed on
each vote change, not a field anyone writes directly — so the audit trail
(every account, every vote) is always the complete, honest history, and the
"accepted" label is a view over it, not the archive itself.

**Verdicts.** One active vote per `(accountId, visitorId)` pair —
`Believable | Suspicious | Definitely Cursed` — upserted, not duplicated,
so changing your mind just changes the row. A tied top verdict renders as
**Disputed** rather than picking a winner arbitrarily. An account with no
votes shows **Unclassified**, never a default verdict.

## Primary domain tables

```
visitors        id, display_name, created_at, last_seen_at
galleries       id, name, order_index              -- static config, not writable via API
display_slots   id, gallery_id, x, z, rotation_y, occupied_exhibit_id
exhibits        id, gallery_id, slot_id, category, title, donor_id, created_at
accounts        id, exhibit_id, parent_id, kind, body, author_id, created_at
votes           id, account_id, visitor_id, verdict, updated_at
events          id, actor_id, event_type, payload_json, created_at
```

`galleries` and each gallery's `display_slots` are seeded once at startup
from static config (see `server/src/world.js`) and never created via the
public API — only their `occupied_exhibit_id` changes, inside the same
transaction that creates the exhibit claiming them. `votes` is unique on
`(account_id, visitor_id)`; a repeat vote is an `UPDATE`, enforced at the
database layer, not just in application code. `events` is an append-only
audit trail, written alongside every exhibit/account/vote write in the same
transaction, used only to recover/replay state after a reconnect — never
edited.

High-frequency avatar movement is **not** written to SQLite at all (per the
blueprint's explicit instruction): it's relayed over the live presence
channel only, current position held in memory per connected visitor.

## Realtime and persistence

**Transport.** One shared Server-Sent Events hub (`GET /api/events`),
reused from the prior project's proven architecture: every connected browser
holds one open stream; the server writes `presence`, `exhibit`, `account`,
and `vote` events to all of them. Movement updates flow the other direction
over a plain rate-limited `POST /api/presence/move` (bounded payload, bounded
frequency) rather than adding a second, bidirectional protocol: the brief's
~1-second budget is comfortably met by polling-rate POSTs server-side
rebroadcast over the existing SSE hub, and this avoids running two live
channels (SSE + WebSocket) for what is still one-directional traffic to any
given listener once the server has relayed it. See `docs/adr/0002-transport.md`
for the full trade-off record, including why this differs from the
blueprint's suggested WebSocket layer.

**Persistence.** SQLite via Node's built-in `node:sqlite` (stable, unflagged,
in Node 24 — confirmed in this environment), at `/data/museum.db` on the Fly
volume, `journal_mode = WAL`. Every donation, account, and vote is a
synchronous transaction before its broadcast goes out, so nothing is ever
announced to other visitors before it is durable.

## Safety and ergonomics

- All user-supplied text (display names, titles, origin claims, accounts)
  renders via `textContent`/DOM construction on the client, never
  `innerHTML` — carried over unchanged from the prior project's rule.
- Every text field has a server-enforced max length; donation and account
  submission are rate-limited per visitor, matching the prior project's
  cooldown pattern.
- No login system: a visitor is an HttpOnly cookie-backed id with a
  self-chosen display name, stable across reloads, distinct per browser
  context — exactly the identity model the brief asks for ("no account
  system required unless needed for stronger vote integrity").
- Keyboard focus inside a form (donation, account, display-name entry) must
  not leak WASD into avatar movement — movement keys are ignored whenever
  focus sits inside an `<input>`/`<textarea>`, mirroring the blueprint's
  "player control must not be trapped by text-input focus" principle in the
  opposite direction (text input must not be hijacked by movement either).
- Reduced-motion: camera transitions and ambient animation (dust, glow
  breathing) are skipped under `prefers-reduced-motion`.

## Known limitations (first version)

- Exhibit imagery is simple original procedural iconography per category,
  not bespoke art per donation — documented, not hidden.
- No moderation queue beyond length caps and rate limits — acceptable for a
  classroom-scale deployment, not for open public UGC at scale.
- Spatial audio is the blueprint's explicitly optional item and is out of
  this first version.
