# Design — The Cursed Museum

This is the current product contract. Historical pivots and their reasons are
recorded in `docs/adr/`, `PROCESS.md`, and `reflections/`.

The human-readable contract lives here. Runtime names and object stories come
from `server/src/narrative.js`; scene geometry comes from
`server/src/world.js`; fixed interaction vocabularies come from
`server/src/constants.js` and `server/src/relic-presets.js`. Historical ADRs
and reference files record what was true at the time and do not override these
current sources.

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
`server/src/world.js`: **The Hall of the Fifth Door** and one main scene for
each of four galleries. The Hall connects the four rooms through visible
doors and the persistent Floor Plan. Four legacy close-up scene records remain
in the graph for schema and saved-link compatibility, but no current object
opens them and they contain no interactive objects.

Each scene includes:

- a full-bleed source image and its native dimensions;
- bounded `minPan`, `maxPan`, `minZoom`, and `maxZoom` camera settings;
- SVG shapes traced over real painted objects;
- quiet edge navigation to another scene or back;
- scene-specific anchors for other visitors' ghosts;
- real wall, shelf, cabinet, tabletop, or plinth shapes where donations may
  be placed.

The client applies a single CSS 2.5D transform to the illustration and every
spatial layer above it. Drag/swipe, trackpad gestures, and all four arrow keys pan;
wheel/pinch and `+`/`-` zoom. Bounds prevent the illustration from being
dragged beyond its authored view. This is deliberately not a claimed 360°
panorama or collision-based 3D world.

Interactive objects are transparent, focusable SVG controls whose geometry
matches the item in the source art. Their exact silhouette glows on hover,
focus, or touch. A padded invisible hit target improves accessibility without
turning the glow back into a visible rectangular button.

## Exhibition architecture and story spine

At 1:13 on the Night of Five Bells, founding curator Lenora Vane vanished.
Her name was removed from the record. The Hall has four visible doors, while
its compass and floor plan insist on a fifth. Every room supplies a different
class of evidence:

- **The Gallery of Borrowed Faces:** identity and erased portraiture; clues
  repeat Lenora's face, eyes, and the silver thread.
- **The Cabinet of the Stolen Hour:** memory and time; clocks stop at 1:13,
  Drawer XIII turns a key from inside, and records contradict one another.
- **The Menagerie of Unfinished Things:** impossible natural history; missing
  wings, hybrid specimens, and Lenora's crest suggest something crossed the
  absent threshold.
- **The Nursery of the Unclaimed Child:** suppressed childhood; primers,
  lullabies, toys, and an unlisted bed reveal the life the catalogue denied.

The short recurring vocabulary—five bells, 1:13, keys, silver thread,
Westmere, lullabies, and the blank wall—joins individual object labels into
one explorable case. `server/src/narrative.js` is the canonical authored copy.

The Hall is the shared first impression and onboarding space. Lenora's floor
plan opens the Museum Guide; the `?` control opens the same guide, and
**Rooms** opens it directly on the Floor Plan.

## Core interactions

### Inspect and interpret

Built-in museum objects, Founding Collection exhibits, and visitor donations
all resolve to the same dossier model. A dossier contains provenance, an
original account, later accounts, the relationship between a challenge and
its target, and each account's votes.

Publishing testimony, contradiction, revision, or counter-evidence always
creates a new account row. It never mutates or deletes the challenged account.
One active vote is stored per `(account_id, visitor_id)` and may be changed.
The three verdicts are **Believable**, **Suspicious**, and **Definitely
Cursed**; ties render as **Disputed**, while an account with no votes remains
**Unclassified**.

The original museum record remains first. Later accounts sort by the Wilson
95% lower bound of their Believable share, descending, then by creation time
when scores match. The UI displays that score. It is a confidence-aware
ordering signal, not a replacement for the account's plurality verdict. An
exhibit's overall classification uses the verdict of the single account with
the most total votes; tied leaders make the exhibit **Disputed**.

On every database boot, an idempotent production seed adds 28 fictional
prior-visitor accounts and 463 votes to seven story-critical built-in objects.
The records exercise consensus, thin evidence, suspicion, curses, disputes,
and no-vote states. Stable ids prevent duplicates; real visitor accounts are
never overwritten by this seed.

Built-in objects use cropped details from their own scene art in the dossier.
Donated relics use their chosen curated illustration. The dormant **Inspect
Closer** control remains hidden because no current object links to a close-up
scene.

### Donate and place a relic

**Donate a Relic** is available from the main interface. The donor chooses one
of sixteen curated appearances covering twelve of the thirteen subtypes (the
specimen gallery's `curiosity` subtype has no matching preset, so it isn't
currently reachable through a donation). Appearance fixes the relic's
category, subtype, and compatible surface types, but not its room: any relic
may be placed in any gallery's free-placement region. The donor may also
apply one of four optional tints, arrange any of twelve sticker overlays,
paint a capped freehand layer, and set scale and rotation. A rotated relic
never changes visible size: the preview and placed exhibit grow their own
invisible layout box to the rotated bounding box rather than shrinking the
artwork to fit a fixed one (a shrink-based fix was tried, shipped, and
reverted after watching it live — see `docs/adr/0009-rotated-relic-sizing.md`);
the two static card previews are the one place that still shrinks to fit,
since there the rotation is never watched live. The donor then provides a
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
first-person view. If a legacy close-up scene is reached by an old link, it
still shares the gallery's logical room.

Selecting a ghost opens the room-scoped **Séance**. It supports short messages,
a fixed reaction vocabulary, threaded replies, and wordless reach-outs. A
reply carries only a bounded opaque `replyToMessageId`, which the server
echoes back purely for client-side transcript threading — it is never
persisted and never treated as permission to address a different room. These
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
exhibits       gallery/slot, category/subtype, title/donor, surface/u/v/scale/
               rotation, visual/tint/overlays/paint, ownership, close-up link,
               deleted_at
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
- Every published page keeps a semantic accessibility floor: a declared
  language, meaningful title, one main landmark (never `role="application"`,
  which would opt assistive technology out of ordinary browser navigation),
  a visible heading, alt text on every image, labelled form fields, and
  accessible names on dialogs and controls — checked by
  `spec/accessibility.test.ts`.
- There is no login or moderation queue beyond validation and rate limits;
  this is a classroom-scale shared museum. Donation appearance stays
  curated: the public UI offers no file picker or remote-image URL field —
  only a server-published `visualId`, with tint, sticker, and paint-layer
  personalisation of that curated asset — enforced by
  `spec/current-contract.test.ts`.
- Sixteen curated donated-relic illustrations, fixed tint and sticker
  vocabularies, and a capped paint layer scaffold contribution while keeping
  new objects coherent. Three.js remains only
  as a defensive preview fallback for a legacy row with no curated visual.
- `spec/persistence-restart.test.ts` spawns the server twice against one
  temporary SQLite file and asserts a visitor contribution survives the
  process boundary, proving the redeploy-persistence claim directly rather
  than relying only on a manual walkthrough.
