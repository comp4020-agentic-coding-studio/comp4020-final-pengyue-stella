# Plan — The Cursed Museum

Working implementation plan for the final-project pivot. This repo
previously carried Traces of ANU (crits 8–9, see Git history and
`reflections/`); it is now rebuilt around `design/The_Cursed_Museum_Project_Blueprint.pdf`.
Update this file when direction materially changes; it isn't a changelog —
`PROCESS.md` is.

## What this build needs to prove

One shared 3D museum: avatars move and collide in real geometry, visible to
every other connected visitor; exhibits are inspected and donated into
specific display slots; written accounts contradict each other without
erasing anything; votes classify each account; all of it survives a
restart and a redeploy; two independent camera rigs (overhead, first-person)
operate over the exact same world and avatar state.

## Build order (checkpoints, each a commit)

1. **Design** — this file, `DESIGN.md`, `README.md`, `docs/adr/0002-transport.md`,
   `spec/world.test.ts` + `spec/archive.test.ts` stubs for the invariants
   worth asserting mechanically. *(this checkpoint)*
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
7. **Acceptance** — run `pnpm check`, then the two-browser walkthrough from
   the blueprint's acceptance list; fix what it finds; final reflection/
   PROCESS.md update.

## Data model

See `DESIGN.md`'s "Primary domain tables" section — this plan intentionally
doesn't duplicate it; keep that section authoritative.

## API surface (target)

- `GET /` — app shell
- `GET /readme/` — README.md rendered in full (spec requirement, unchanged
  mechanism from the prior project)
- `GET /api/world` — galleries, display slots (occupied/free), static
  geometry config the client needs to build the scene
- `GET /api/exhibits` — every exhibit with its slot, gallery, donor, and
  nested accounts + vote tallies (full archive snapshot, used on load and
  on reconnect)
- `POST /api/exhibits` — donate a relic into a free slot
- `POST /api/exhibits/:id/accounts` — publish a new competing account
- `POST /api/accounts/:id/vote` — cast or change a vote
- `GET /api/me` — visitor identity (cookie-backed, unchanged mechanism)
- `POST /api/presence/move` — report this visitor's current position/yaw
  (rate-limited; not persisted)
- `GET /api/events` — SSE stream: `presence`, `exhibit`, `account`, `vote`
  events

## Explicitly out of scope for this first version

User-uploaded exhibit images, spatial audio, a moderation queue beyond
length caps/rate limits, more than four galleries, account/login system,
editing or deleting a published account or vote's history.

## Status

Checkpoint 1 (design) in progress — this file, `DESIGN.md`, README and the
transport ADR are being written now; `spec/` invariants follow in the same
commit. World/Archive/Interaction/Multiplayer/Finish/Acceptance follow in
that order, each its own commit, per `CLAUDE.md`'s process-discipline rules.
