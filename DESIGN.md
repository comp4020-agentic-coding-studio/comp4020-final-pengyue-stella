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

## World model — one shared graph, illustrated scenes

The museum is a small, server-defined graph of **scenes**
(`server/src/world.js`'s `GALLERY_LAYOUT`/`buildHallScenes`/
`buildGalleryScenes`): the Entrance Hall (one of four "facings," turned
between — see below), a main establishing view per gallery, and a close-up
view per gallery aimed at its own hero display. Each scene carries a
full-bleed illustration (`public/assets/gallery-scenes/`) and a list of
**hotspots** — door, closeup, back, donate, lore, and every donated
exhibit currently displayed there. See
`docs/adr/0004-illustrated-scenes.md` for the decision to present scenes
this way instead of as a live Three.js room (ADR 0003's version), and
`docs/adr/0003-scene-exploration.md` for the earlier decision this
extends: click-driven navigation between fixed vantages, not free-roam.

- **Turning** (the hub's only multi-exit case) is a cross-slide between
  two illustrations — standing in place, turning to face a different
  doorway.
- **Every other navigation** (entering a gallery, looking closer, going
  back) is a page-turn/cabinet-door cut: the incoming scene rotates in
  from a hinge edge over the outgoing one.

Both transitions collapse to a near-instant swap under
`prefers-reduced-motion`. There is no collision model and no camera a
visitor steers — a scene is, by construction, always the exact view
someone illustrated.

Floors, doors, and the four galleries are still static server-side config
(not donated/user content), each with a stable `galleryId`. Each gallery
still exposes a small number of **display slots** — predefined `{x, z}`
percentage anchors (of the illustration's width/height) where a donated
exhibit's card is positioned — enough per gallery that the opening room
never looks sparse, with a documented behaviour for when a gallery's slots
are all full (see Interaction below).

Hotspots and exhibit cards are real, always-visible, focusable elements,
positioned from their server-given percentage anchor — the same control a
mouse clicks, a finger taps, or Tab+Enter reaches, with no separate
raycast-under-cursor path to keep in sync.

## Exhibition architecture

| Gallery | Theme | Staging |
| --- | --- | --- |
| I. The Portraits That Watch | Ambiguous portraits, identity | Framed portraits on walls, a worn runner rug |
| II. Objects That Remember | Impossible provenance | Pedestal cases, a long table of small relics |
| III. The Cabinet of Impossible Life | Unreliable natural history | Glass vitrines, specimen jars on shelving |
| IV. The Forgotten Childhood | Unsettling toys | Velvet-topped plinths, shelved dolls and music boxes |

Galleries connect off a central Entrance Hall (the default scene, donor
counter, shared presence first impression). Each gallery has a sign naming
it, a doorway hotspot back to the hall, and enough non-interactive clutter
(generated prop instances, not hand-placed one by one) to read as inhabited
rather than empty.

## Core loops

**Visitor journey.** Enter a display name → arrive in the Entrance Hall →
turn to face a gallery doorway → click it → a crafted establishing shot of
the gallery, its donated exhibits glowing → click an exhibit's label →
dossier overlay opens → read competing accounts, vote, or add a new account
→ Esc → back in the scene, now aware the archive just changed under other
visitors too. A gallery's own close-up hotspot cuts to a tighter shot of its
hero display, with a short environmental-lore popover, before a "back"
hotspot returns to the main shot.

**Donate a relic.** A persistent "Donate a Relic" action is reachable from
every main scene, not only the in-world donor counter (kept as an
atmospheric secondary entrance). The form collects: gallery, category
(portrait / memento / specimen / toy — one per gallery), title,
one-sentence origin claim, donor display name, and a specific open display
slot in that gallery (occupied slots are not offered). The server validates
the gallery/category/slot combination inside one transaction, creates the
exhibit, and broadcasts `exhibit.created` to every connected client, who
render its dimensional display card at that slot without a page reload. A
receipt overlay with a live rendered preview follows, offering "View My
Relic" — a scene cut straight to the donated exhibit's gallery, landing on
its dossier.

**Find and inspect a relic.** A persistent "Archive" action lists every
exhibit grouped by gallery, each with its number and current classification,
so a visitor can find one without knowing which room it's in; selecting one
navigates there and opens its dossier directly. Every real exhibit also
renders in its gallery as a framed, dimensional display card (a small live
preview of its 3D model, title, donor), with hover/focus lifting it and
dimming its neighbours. Clicking a card opens the dossier: exhibit number,
the same live preview, title, gallery, donor, every account in chronological
order each tagged *Original Account / New Testimony / Contradiction /
Proposed Revision / Counter-Evidence*, each account's own vote tally and the
visitor's own current vote, and an "Add Counter-Evidence" action. Esc
returns to the scene underneath. The overlay is reachable and operable by
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

Scene presence is **not** written to SQLite at all: which scene each
visitor currently has open is relayed over the live SSE channel only,
held in memory per connected visitor (see
`docs/adr/0003-scene-exploration.md`).

## Realtime and persistence

**Transport.** One shared Server-Sent Events hub (`GET /api/events`),
reused from the prior project's proven architecture: every connected browser
holds one open stream; the server writes `scene-presence`, `exhibit`,
`account`, `vote`, and `activity` events to all of them. Presence is
scene-scoped, not a continuous position: a visitor reports which fixed scene
they're currently viewing over a plain rate-limited `POST /api/presence`
whenever they navigate, and the server rebroadcasts a live per-scene
headcount plus a roster of that scene's visible cameos — each only a
stable, non-reversible public key and display name, never the raw visitor
cookie (`identity.js`'s `publicKeyFor`, `sse.js`'s `visitorsInScene`). See
`docs/adr/0002-transport.md` for the original transport decision,
`docs/adr/0003-scene-exploration.md` for scene-scoped presence, and
`docs/adr/0004-illustrated-scenes.md` for restoring visible cameos on top
of it.

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
- There is no movement input to protect form focus from any more (see
  `docs/adr/0003-scene-exploration.md`) — the only global keyboard bindings
  left are Esc (close/back) and the hub's left/right turn, neither of
  which a visitor would ever type while filling in a form field.
- Reduced-motion: scene-cut fades and hub turns shorten to a near-instant
  swap, and ambient animation (dust, glow breathing, watching-portrait eye
  tracking) is skipped entirely, under `prefers-reduced-motion`.

## Known limitations (first version)

- Exhibit models are a procedural library keyed to a donation's category and
  subtype (one bespoke model family per subtype, varied per donation by a
  seeded scale/rotation/tone PRNG), not bespoke art per individual donation
  — documented, not hidden; see `ASSETS.md`.
- No moderation queue beyond length caps and rate limits — acceptable for a
  classroom-scale deployment, not for open public UGC at scale.
- Spatial audio is the blueprint's explicitly optional item and is out of
  this first version.
