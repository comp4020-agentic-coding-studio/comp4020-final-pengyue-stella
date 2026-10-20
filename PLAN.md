# Plan — The Cursed Museum

Working implementation plan for the final-project pivot. This repo
previously carried Traces of ANU (crits 8–9, see Git history and
`reflections/`); it was rebuilt around
`design/The_Cursed_Museum_Project_Blueprint.pdf` as a free-roam 3D museum
for crit 10, pivoted to a 2.5D fixed-scene presentation
(`docs/adr/0003-scene-exploration.md`), then pivoted again to the
illustrated-scene presentation this plan now describes — see
`docs/adr/0004-illustrated-scenes.md` for that pivot's full decision
record. Update this file when direction materially changes; it isn't a
changelog — `PROCESS.md` is.

## What this build needs to prove

One shared museum presented as full-bleed illustrated scenes: a fixed graph
of scenes (a four-facing Entrance Hall, a main view and a close-up per
gallery), moved between by clicking hotspots or a framed exhibit card,
visible to every other connected visitor through a live cameo roster per
scene; exhibits are inspected and donated into specific display slots via
a persistent action reachable from anywhere; written accounts contradict
each other without erasing anything; votes classify each account; all of
it survives a restart and a redeploy.

## Build order (checkpoints, each a commit)

The first six checkpoints shipped the crit-10 free-roam version
(`docs/adr/0002-transport.md`). The scene-exploration pivot
(`docs/adr/0003-scene-exploration.md`) replaced the exploration layer with
fixed camera vantages in its own checkpoints. The illustrated-scene pivot
(this plan's current state, `docs/adr/0004-illustrated-scenes.md`) replaced
that live-3D-room presentation with illustrated scenes, in four further
checkpoints:

1. **Illustrated scenes and navigation** — full-bleed scene images
   (`public/assets/gallery-scenes/`), the percentage-anchor world model
   (`server/src/world.js`), the cross-slide/page-turn controller
   (`public/world/illustration.js`), removal of the live Three.js room
   (`scene.js`, `exploration.js`) and its room-only furniture/texture code.
2. **Visible visitor presence** — a non-reversible per-visitor public key
   (`identity.js`'s `publicKeyFor`), a per-scene visitor roster
   (`sse.js`'s `visitorsInScene`), and cameo medallions in the client
   (`public/app.js`'s cameo rendering) with an activity pulse on
   donate/account/vote (`activity` SSE event).
3. **Discoverable donation** — a persistent "Donate a Relic" action in
   every main scene, with the in-world donor counter kept as a secondary
   entrance; new exhibits render as dimensional Gothic display cards.
4. **Discoverable dossiers and voting** — every real exhibit as an
   interactive framed card with hover/focus lift; a persistent "Archive"
   action listing every exhibit by gallery; an idempotent founding seed
   (`db.js`'s `seedFoundingCollection`) so a fresh deploy's galleries are
   never empty.

## Original build order (crit-10 free-roam version, for reference)

1. **Design** — `DESIGN.md`, `README.md`, `docs/adr/0002-transport.md`,
   `spec/world.test.ts` + `spec/archive.test.ts` stubs for the invariants
   worth asserting mechanically.
2. **World** — `node:sqlite` schema + seed, static gallery/slot config
   (`server/src/world.js`), Three.js scene construction client-side
   (`public/world/`), WASD movement + collision, overhead and first-person
   camera rigs switched by `V`, avatar sync over SSE + `POST /api/presence/move`.
3. **Archive** — donation form + donor counter hotspot, exhibit meshes
   instantiated into slots, dossier overlay, `POST /api/exhibits`.
4. **Interaction** — accounts (original/testimony/contradiction/revision/
   counter-evidence), `POST /api/exhibits/:id/accounts`, votes with upsert
   semantics, derived "currently accepted" + Disputed/Unclassified display,
   live broadcast of both.
5. **Multiplayer polish** — presence join/leave, remote avatar interpolation,
   reconnect state hydration (re-fetch world + archive snapshot on
   reconnect), focus-aware keyboard handling.
6. **Finish** — visual pass (lighting, modular prop density, reduced-motion),
   mobile/touch fallback, Dockerfile/fly.toml updates for the new stack,
   deploy.

## Data model

See `DESIGN.md`'s "Primary domain tables" section — this plan intentionally
doesn't duplicate it; keep that section authoritative.

## API surface (current)

- `GET /` — app shell
- `GET /readme/` — README.md rendered in full (spec requirement, unchanged
  mechanism from the prior project)
- `GET /api/world` — galleries, display slots (occupied/free), the fixed
  scene graph (`scenes`, each with its illustration and hotspot anchors)
- `GET /api/exhibits` — every exhibit with its slot, gallery, donor, and
  nested accounts + vote tallies (full archive snapshot, used on load and
  on reconnect)
- `POST /api/exhibits` — donate a relic into a free slot
- `POST /api/exhibits/:id/accounts` — publish a new competing account
- `POST /api/accounts/:id/vote` — cast or change a vote
- `GET /api/me` — visitor identity (cookie-backed, unchanged mechanism)
- `POST /api/presence` — report which fixed scene this visitor is
  currently viewing (rate-limited; not persisted)
- `GET /api/events` — SSE stream: `scene-presence` (count + visible cameo
  roster), `exhibit`, `account`, `vote`, `activity` events

## Explicitly out of scope for this version

User-uploaded exhibit images, spatial audio, a moderation queue beyond
length caps/rate limits, more than four galleries, account/login system,
editing or deleting a published account or vote's history, free-roam
movement, and embodied third-person avatars for other visitors (presence
is a cameo medallion, never a walking character).

## Status

The illustrated-scene pivot (checkpoints 1-4 above) is complete: illustrated
scenes with page-turn/cross-slide navigation, visible visitor cameos,
discoverable donation, and discoverable dossiers/voting with a founding
seed. See `docs/adr/0004-illustrated-scenes.md`'s own verification section
for what was checked before calling it done.
