# The Cursed Museum

Every object has a story. None of them can be trusted.

## Marker quick start

**Deployed app:** [Open The Cursed Museum](https://comp4020-final-pengyue-stella.fly.dev/)

No login, demo account, command, MCP client, school-network connection, or
paid service is required. Start here at `/readme/`, then follow **Enter the
museum**. The first request can take a few seconds while the course Fly.io
machine wakes from its automatic stop.

For the multi-user checks, use **two separate Chrome profiles** (not two tabs
in one profile). Each profile has its own cookie-backed visitor identity.

### Five-minute marking walkthrough

1. Open the deployed URL in Chrome profile A and profile B. In each profile, enter a different display name, choose a different apparition form, and enter the museum.
2. Leave both visitors in the Entrance Hall. Each profile should show the other visitor as a named, coloured ghost. Click the other ghost to open the room-scoped **Séance**; send a short message or reaction and confirm it appears in the other profile without a reload.
3. Open **Rooms**. The Floor Plan shows the current visitor, the other visitor, room occupancy, and donated-relic markers. Move one visitor to a gallery and confirm the live markers and in-room ghost update.
4. In a gallery, drag horizontally (or use Left/Right) to look around and use the mouse wheel or `+`/`-` to zoom. Click a glowing object. Built-in museum objects and donated relics use the same dossier model: read the original account, add a testimony/contradiction/revision/counter-evidence, and vote **Believable**, **Suspicious**, or **Definitely Cursed**. The other profile should receive the shared update without reloading.
5. Select **Donate a Relic**. Choose one of the four illustrated appearances, provide a title and origin claim, and select **Place Relic**. Drag the preview to a glowing compatible surface in the destination gallery and confirm placement. If a position is occupied, choose another point on the surface. The relic should appear for both visitors and in **Archive**.
6. Refresh both profiles. The donated relic, accounts, votes, and placement should still be present. The donor can also reopen their relic to test owner-only **Edit** and **Withdraw** controls; museum-owned objects cannot be edited or withdrawn.

### Useful secondary checks

- Click the physical map in the Entrance Hall, or `?`, to open the Museum Guide. **Rooms** opens the same guide directly on its Floor Plan tab.
- Use **Archive** to browse every museum-owned, founding, and donated exhibit by gallery and reopen its dossier.
- Visitors in different rooms do not share an in-room ghost or Séance transcript. Visitors in a gallery's main and close-up scenes still belong to the same logical room.
- `Tab` and `Enter` can reach and activate the main controls and exhibits; `Esc` closes the active panel or returns from a close-up.

If the second visitor is counted but no ghost is visible, first confirm the
two windows really use different Chrome profiles and that both visitors are
in the same logical room.

## What the project is

The Cursed Museum is a shared, illustrated Gothic museum. Visitors enter
under a chosen display name and apparition form, explore an Entrance Hall and
four haunted galleries, and discover a growing collection of museum-owned
objects and visitor-donated relics:

- The Portraits That Watch
- Objects That Remember
- The Cabinet of Impossible Life
- The Forgotten Childhood

Every collection object has a dossier. Publishing a new account never erases
the old one: testimony, contradiction, revision, and counter-evidence remain
attributed and timestamped beside the claim they challenge. Visitors vote on
each account; classifications can change as the shared evidence changes, but
the history remains visible.

The illustrated scenes support bounded drag-to-pan and zoom rather than
free-roam movement. Object-shaped hotspots are traced over real items in the
artwork. Other visitors appear as coloured Gothic ghosts, the architectural
Floor Plan reports live room presence, and the room-scoped Séance provides
ephemeral messages and reactions while the archive itself remains durable.

## What the marker should be able to verify

- **Multi-user presence:** two independent browser profiles see one another in the same room as distinct named ghosts.
- **Real-time collaboration:** presence, donations, accounts, votes, edits, withdrawals, and Séance events update without a page reload.
- **Persistence:** museum records and relic placement survive refreshes, server restarts, and redeploys through the mounted SQLite database.
- **Shared provenance:** built-in and donated objects use the same dossier, account, classification, and voting machinery.
- **Spatial contribution:** a donor chooses an illustrated relic and freely places it on a compatible, non-colliding surface in the relevant gallery.
- **Ownership boundaries:** only a relic's donor can edit or withdraw it; museum-owned and Founding Collection records are not privately editable.
- **Accessible exploration:** all essential actions are available with mouse, touch, or keyboard, and reduced-motion preferences are respected.

## Controls

- **Look around:** drag horizontally or use Left/Right.
- **Zoom:** use the mouse wheel or `+`/`-`.
- **Inspect or enter:** click a glowing object or press `Enter` when it is focused.
- **Open Séance:** click another visitor's ghost.
- **Open the live Floor Plan:** select **Rooms**.
- **Browse collection dossiers:** select **Archive**.
- **Create and place a visitor-owned relic:** select **Donate a Relic**.
- **Close or step back:** press `Esc`.
- **Move between controls:** press `Tab` or `Shift+Tab`.

## Technical notes

The application is a Node.js ESM server with no runtime npm dependencies
beyond Node's built-ins. It uses `node:http`, `node:sqlite`, Server-Sent
Events, SVG scene overlays, and static illustrated assets. The course-managed
Fly.io volume is mounted at `/data`, where the SQLite database persists.

The course repository contains all source code and Git history. Architectural
decisions are recorded under `docs/adr/`; implementation and agentic-coding
evidence are in `PROCESS.md` and `reflections/`.

For local development only, start the server before running the checks:

```sh
MUSEUM_DB_FILE=/tmp/cursed-museum.db PORT=8080 node server/src/server.js
pnpm check
pnpm check:evidence
```

The deployed marker walkthrough above does not require any of these local
commands.
