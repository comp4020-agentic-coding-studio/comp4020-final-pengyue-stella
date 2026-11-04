# Plan — The Cursed Museum

This is the current implementation state and remaining-scope boundary. The
earlier free-roam 3D build and presentation pivots are recorded in
`PROCESS.md`, `reflections/crit-10.md`, and `docs/adr/0003`–`0007`.

## Product standard

The build must prove one idea: a good digital museum can be a
**participatory, living collection**. A visitor discovers an object,
encounters competing interpretations, contributes an object/account/vote,
and leaves a durable record that changes what a later visitor finds. Social
presence and Gothic illustration support that loop without turning the
museum into a generic chat room or CRUD dashboard.

## Completed system

1. **Illustrated 2.5D exploration** — one high-resolution Entrance Hall and
   four distinct galleries, bounded pan/zoom, object-shaped SVG hotspots,
   close-ups, edge navigation, reduced-motion behaviour, and mouse/touch/
   keyboard input.
2. **Unified living archive** — built-in, Founding Collection, and donated
   objects share dossiers, attributed accounts, challenge relationships,
   classifications, and non-destructive vote history.
3. **Curated spatial donation** — four illustrated relic presets, compatible
   wall/furniture surfaces, draggable placement, scale and collision
   validation, ownership, revision-based editing, and soft withdrawal.
4. **Visible shared presence** — three selectable ghost forms, named visitors
   anchored in the artwork, logical-room presence across main/close-up views,
   focus cues, and a room-scoped ephemeral Séance.
5. **Wayfinding and discovery** — a physical hall-map Guide, live Floor Plan
   with individual visitor markers, room travel, and an Archive index that
   reopens any active dossier.
6. **Durability and realtime** — SQLite/WAL transactions, one SSE hub, restart
   and redeploy persistence, reconnect hydration, validation, rate limits,
   and browser-cookie ownership.

## Current API surface

- `GET /` — museum shell.
- `GET /readme/` — the project argument, operation guide, and technical notes.
- `GET /api/world` — galleries, illustrated scenes, cameras, object shapes,
  visitor anchors, internal capacity slots, and placement surfaces.
- `GET /api/relic-presets` — curated donation visuals and compatibility data.
- `GET /api/reactions` — the fixed Séance reaction vocabulary.
- `GET|POST /api/me` — read or update cookie-backed display identity and
  apparition form.
- `GET /api/exhibits` and `GET /api/exhibits/:id` — active collection records,
  placement, ownership view, accounts, and vote tallies.
- `POST /api/exhibits` — validate and publish a spatial donation.
- `PATCH|DELETE /api/exhibits/:id` — owner-only edit or withdrawal.
- `POST /api/exhibits/:id/accounts` — publish a new competing account.
- `POST /api/accounts/:id/vote` — cast or change one visitor's verdict.
- `POST /api/presence` — report the visitor's exact scene.
- `POST /api/presence/focus` — relay an ephemeral object-attention cue.
- `POST /api/presence/interact` — relay a room-scoped Séance message,
  reaction, or reach-out.
- `GET /api/events` — the shared SSE connection for durable and ephemeral
  realtime events.

## Data model notes

`DESIGN.md` is authoritative. The database retains `display_slots` and
`exhibits.slot_id` as an internal capacity/uniqueness mechanism for backwards
compatibility. Visitors never select those legacy boxes: current placement is
stored as `surface_id`, normalized `placement_u`/`placement_v`, and scale.

Published accounts are append-only. A donor's origin-claim edit creates a
revision instead of overwriting the original. Withdrawn exhibits are excluded
from normal reads but their rows, accounts, votes, and events remain retained.

## Verification before submission

- Run `pnpm check` against a running server and `pnpm check:evidence`.
- Render `/readme/` through the project's Markdown renderer; do not assume
  GitHub Markdown features such as tables are supported.
- Walk through the app in two independent browser contexts: room presence,
  ghost rendering, Floor Plan movement, Séance delivery, account/vote update,
  donation/placement, owner controls, refresh, and redeploy persistence.
- Check desktop and narrow mobile layouts with console errors monitored.
- Keep README, `CLAUDE.md`, `spec/README.md`, `DESIGN.md`, and this plan aligned
  with the shipped product and its single definition of good.

## Explicit limits

The current version deliberately has four galleries, twelve curated donation
visuals, three apparition forms, no login, no arbitrary image upload, and no
moderation queue beyond validation and rate limits. The Séance is ephemeral
and room-scoped; it is not part of the durable museum archive. The experience
is a bounded illustrated 2.5D museum, not a full 360° or free-roam 3D world.
