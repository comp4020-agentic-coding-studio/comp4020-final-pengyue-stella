# Design — The Cursed Museum

This is the current product contract. Historical pivots and their reasons are
recorded in `docs/adr/`, `PROCESS.md`, and `reflections/`.

## Design standard

The Cursed Museum should feel like a **participatory, living museum**. Its
central loop is discovery → interpretation → contribution → persistence:

1. a visitor discovers an object embedded in a distinctive Gothic room;
2. its dossier exposes an account and the context around it;
3. the visitor encounters other interpretations and may contribute or vote;
4. the resulting record remains available to later visitors.

Multiplayer presence, the Séance, donation, voting, archival provenance, and
visual atmosphere all serve this one loop. None should turn into a generic
chat, CRUD form, or navigation menu detached from the museum.

## Visual identity

The visual language is a Gothic cabinet of curiosities / Victorian
wunderkammer: warm amber light in deep shadow, dark carved wood, brass
fittings, crowded glass cases, aged parchment, and dried-rose accents. The
unease comes from suggestion and accumulation rather than gore or shock.

- **Obsidian `#11100F`:** deepest backgrounds and the void beyond rooms.
- **Mahogany `#35251C`:** architecture, furniture, and supporting surfaces.
- **Antique brass `#88653D`:** ornament, borders, and inactive controls.
- **Old gold `#C6A16B`:** interactive glow, focus rings, and highlights.
- **Parchment `#E9DDC5`:** dossier paper and long-form text.
- **Dried rose `#663D43`:** disputes, warnings, and social accents.

Titles use a display serif; forms and archival text use a readable system
sans. Lighting is authored into each illustration, giving every gallery a
distinct atmosphere without a live 3D lighting engine.

## World and camera model

The museum is a server-authored graph of illustrated scenes in
`server/src/world.js`: one Entrance Hall, a main scene for each of four
galleries, and optional close-up scenes. The Hall connects the four rooms
through visible doors and the persistent Floor Plan.

Each scene includes:

- a full-bleed source image and its native dimensions;
- bounded `minPan`, `maxPan`, `minZoom`, and `maxZoom` camera settings;
- SVG shapes traced over real painted objects;
- quiet edge navigation to another scene or back;
- scene-specific anchors for other visitors' ghosts;
- real wall, shelf, cabinet, tabletop, or plinth shapes where donations may
  be placed.

The client applies a single CSS 2.5D transform to the illustration and every
spatial layer above it. Drag/swipe and horizontal trackpad gestures pan;
wheel/pinch and `+`/`-` zoom. Bounds prevent the illustration from being
dragged beyond its authored view. This is deliberately not a claimed 360°
panorama or collision-based 3D world.

Interactive objects are transparent, focusable SVG controls whose geometry
matches the item in the source art. Their exact silhouette glows on hover,
focus, or touch. A padded invisible hit target improves accessibility without
turning the glow back into a visible rectangular button.

## Exhibition architecture

- **The Portraits That Watch:** ambiguous portraits and identity; wall-based
  donated paintings.
- **Objects That Remember:** impossible provenance; shelves, cabinets, and
  tabletops for small relics.
- **The Cabinet of Impossible Life:** unreliable natural history; glass cases,
  shelves, and plinths for specimens.
- **The Forgotten Childhood:** unsettling toys; shelves, tables, and plinths
  for dolls, books, and music boxes.

The Entrance Hall is the shared first impression and onboarding space. Its
physical map opens the Museum Guide; the `?` control opens the same guide, and
**Rooms** opens it directly on the Floor Plan.

## Core interactions

### Inspect and interpret

Built-in museum objects, Founding Collection exhibits, and visitor donations
all resolve to the same dossier model. A dossier contains provenance, an
original account, later accounts in chronological order, the relationship
between a challenge and its target, and each account's votes.

Publishing testimony, contradiction, revision, or counter-evidence always
creates a new account row. It never mutates or deletes the challenged account.
One active vote is stored per `(account_id, visitor_id)` and may be changed.
The three verdicts are **Believable**, **Suspicious**, and **Definitely
Cursed**; ties render as **Disputed**, while an account with no votes remains
**Unclassified**.

Built-in objects use cropped details from their own scene art in the dossier.
Donated relics use their chosen curated illustration. A marquee object may
also offer **Inspect Closer**, which enters its authored close-up scene.

### Donate and place a relic

**Donate a Relic** is available from the main interface. The donor chooses one
of four curated appearances; that choice fixes the compatible gallery,
category, subtype, and physical surface types. The donor then provides a
title, one-sentence origin claim, and donor name.

After selecting **Place Relic**, the visitor enters the destination scene with
a draggable preview. Only compatible placement surfaces glow. The client
snaps the preview to the surface, but the server is authoritative: it verifies
the gallery, visual preset, subtype, surface, normalized `u`/`v` point, scale,
surface containment, collision distance, and one internal capacity slot in a
single transaction. After commit, an SSE event makes the relic appear in the
room and Archive for other visitors without a reload.

`display_slots` remain in the database as an internal capacity, uniqueness,
and backwards-compatibility mechanism. They are not visitor-facing placement
boxes. Older slot-only exhibits receive a stable derived surface position.

### Manage a donated relic

Ownership is tied to the HttpOnly visitor cookie that created a donation, not
the free-text donor name. Only that visitor can edit or withdraw it.

Changing the title updates the exhibit. Changing the origin claim publishes a
new revision account so the original claim remains visible. Withdrawal is a
transactional soft delete: the exhibit disappears from ordinary room,
Archive, and dossier reads; its historical rows remain in SQLite; and its
internal capacity slot becomes reusable. Built-in and Founding Collection
objects never expose owner controls.

### Encounter other visitors

Each visitor chooses a display name and one of three illustrated apparition
forms. Other visitors in the same logical room appear as named ghosts at
scene-specific anchors; the current visitor is not rendered in their own
first-person view. Main and close-up scenes for one gallery share a logical
room even though their visual anchors differ.

Selecting a ghost opens the room-scoped **Séance**. It supports short messages,
a fixed reaction vocabulary, threaded replies, and wordless reach-outs. These
events are ephemeral and delivered only to other visitors currently in the
same logical room. This makes co-presence visible without adding a permanent,
museum-wide social feed to the archive.

### Find rooms and records

The architectural Floor Plan shows the current visitor, other connected
visitors, and room occupancy as distinct markers. Selecting a room navigates
there. The Archive lists every active built-in, founding, and donated exhibit
by gallery and opens any dossier directly.

## Data and realtime model

The durable domain is SQLite in WAL mode:

```text
visitors       id, display_name, created_at, last_seen_at
galleries      id, name, category, order_index
display_slots  id, gallery_id, occupied_exhibit_id, legacy anchor fields
exhibits       gallery/slot, category/subtype, title/donor, surface/u/v/scale,
               visual/origin/ownership fields, close-up link, deleted_at
accounts       exhibit, challenged/parent account, kind, body, author, time
votes          account, visitor, verdict, updated_at; unique per visitor/account
events         actor, event type, JSON payload, time
```

Every durable mutation commits before it is broadcast. One Server-Sent Events
hub distributes exhibit, account, vote, ownership, presence, focus, and
Séance events. Presence, focus, and Séance transcripts are deliberately
ephemeral and held only for connected sessions; museum records are durable.

Visitor identity is an HttpOnly cookie. A public non-reversible key is used in
presence payloads so another browser can recognise a reconnecting ghost
without receiving the raw identity.

## Safety, accessibility, and limits

- User-supplied text renders through `textContent`/DOM construction, never
  `innerHTML`.
- Server-side length limits, rate limits, vocabulary validation, ownership
  checks, and database constraints apply even if the client is bypassed.
- Object, ghost, doorway, dossier, Archive, Guide, donation, and Séance
  controls are keyboard reachable. Pan and zoom have keyboard alternatives.
- `prefers-reduced-motion` disables camera inertia and shortens decorative
  transitions.
- There is no login, user-uploaded image system, or moderation queue beyond
  validation and rate limits; this is a classroom-scale shared museum.
- Four curated donated-relic illustrations intentionally scaffold
  contribution and keep new objects visually coherent. Three.js remains only
  as a defensive preview fallback for a legacy row with no curated visual.
