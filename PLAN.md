# Plan — The Cursed Museum

Working implementation plan for the final-project pivot. This repo
previously carried Traces of ANU (crits 8–9, see Git history and
`reflections/`); it was rebuilt around
`design/The_Cursed_Museum_Project_Blueprint.pdf` as a free-roam 3D museum
for crit 10, then pivoted again, post-crit-10, to the 2.5D fixed-scene
presentation this plan now describes — see
`docs/adr/0003-scene-exploration.md` for that second pivot's full decision
record. Update this file when direction materially changes; it isn't a
changelog — `PROCESS.md` is.

## What this build needs to prove

One shared museum presented as a crafted 2.5D cabinet of curiosities: a
fixed graph of richly staged camera scenes (a four-facing Entrance Hall, a
main shot and a close-up per gallery), moved between by clicking hotspots,
visible to every other connected visitor through a live per-room headcount;
exhibits are inspected and donated into specific display slots; written
accounts contradict each other without erasing anything; votes classify
each account; all of it survives a restart and a redeploy.

## Build order (checkpoints, each a commit)

The first six checkpoints below shipped the crit-10 free-roam version
(`docs/adr/0002-transport.md`, world/archive/interaction/multiplayer/finish
in that order). The scene-exploration pivot (this plan's current state)
replaced the exploration/presentation layer afterward, in its own
checkpoints:

1. **Exploration model** — `server/src/world.js`'s `SCENES` (hub facings,
   main shots, close-ups, hotspots), `public/world/exploration.js` (the
   scene-cut/turn controller), `docs/adr/0003-scene-exploration.md`.
2. **Hotspot + scene system** — the hotspot overlay in `public/app.js`
   (positioned every frame via `projectToScreen`), the fade/turn UI in
   `index.html`/`styles.css`, removal of the old movement/camera-rig/avatar
   modules.
3. **Dynamic exhibit integration** — every donated exhibit in a gallery's
   main scene gets its own hotspot; verified every hotspot and display slot
   actually falls inside its scene's camera frustum (not just assumed from
   the geometry), including at narrow/phone-portrait aspect ratios.
4. **Dossier/voting adaptation** — unchanged data/API, re-wired entry
   points ("View My Relic" is now a scene cut, not a guided walk).
5. **Multiplayer presence redesign** — scene-scoped presence (`POST
   /api/presence`, `scene-presence` SSE event) replacing continuous
   position broadcast; no embodied avatars.
6. **Final polish** — hotspot declutter (`declutterHotspots`, so
   overlapping anchors never stack unclickable), reduced-motion for
   scene-cuts/turns, doc updates, redeploy.

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
  scene graph (`scenes`, each with its vantage and hotspots), and static
  geometry config the client needs to build the world
- `GET /api/exhibits` — every exhibit with its slot, gallery, donor, and
  nested accounts + vote tallies (full archive snapshot, used on load and
  on reconnect)
- `POST /api/exhibits` — donate a relic into a free slot
- `POST /api/exhibits/:id/accounts` — publish a new competing account
- `POST /api/accounts/:id/vote` — cast or change a vote
- `GET /api/me` — visitor identity (cookie-backed, unchanged mechanism)
- `POST /api/presence` — report which fixed scene this visitor is
  currently viewing (rate-limited; not persisted — see
  `docs/adr/0003-scene-exploration.md`; replaces the retired
  `POST /api/presence/move`)
- `GET /api/events` — SSE stream: `scene-presence`, `exhibit`, `account`,
  `vote` events

## Explicitly out of scope for this version

User-uploaded exhibit images, spatial audio, a moderation queue beyond
length caps/rate limits, more than four galleries, account/login system,
editing or deleting a published account or vote's history, unrestricted
free-roam movement (deliberately retired — see
`docs/adr/0003-scene-exploration.md`), embodied third-person avatars for
other visitors.

## Status

The scene-exploration pivot (checkpoints 1-6 above) is complete: fixed
scenes, hotspot overlay, dynamic exhibit hotspots, dossier/voting
unchanged, scene-scoped presence, declutter/reduced-motion polish. See
`docs/adr/0003-scene-exploration.md`'s own verification section for what
was checked before calling it done.
