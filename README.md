# The Cursed Museum

Every object has a story. None of them can be trusted.

**Visit the museum:** [https://comp4020-final-pengyue-stella.fly.dev/](https://comp4020-final-pengyue-stella.fly.dev/)

## Start here

The Cursed Museum is a shared, illustrated Gothic museum. No login, demo account, command, MCP client, school-network connection, or paid service is required. Enter a display name, choose an apparition, and select **Enter the Museum**. The first request may take a few seconds while the Fly.io machine wakes from its automatic stop.

For the full shared experience, open the museum in **two separate Chrome profiles**, not two tabs in one profile. Each profile has its own cookie-backed visitor identity.

### A short first visit

1. Enter the museum and use **Rooms** or the physical map in the Entrance Hall to understand its layout.
2. Enter a gallery, then drag or swipe horizontally to look around. Use the mouse wheel, pinch gesture, or `+`/`-` to zoom.
3. Select a glowing object in the illustrated room. Read its dossier, add an interpretation, or vote on an existing account.
4. Select **Donate a Relic**, choose an illustrated relic, give it a title and origin claim, and place it on a glowing compatible surface in a gallery.
5. Use **Archive** to find museum-owned objects, Founding Collection relics, and visitor donations without returning to every room.
6. When another visitor is in the same logical room, their named ghost appears in the scene. Select the ghost to communicate through the room-scoped **Séance**.

Refreshing the page does not remove donated relics, accounts, votes, or placements. A donor may reopen their own relic to edit its title, publish a revised origin claim, or withdraw it. Museum-owned objects cannot be privately edited or withdrawn.

## What makes The Cursed Museum good?

For this project, “good” means creating a participatory, living museum in which visitors do more than consume an official story: they help build the collection, interpret its objects, and leave evidence for future visitors. A conventional digital museum can display attractive objects and authoritative labels, but I wanted The Cursed Museum to make curiosity productive. Visitors should be able to discover something strange, form an opinion, encounter disagreement, and change what the next visitor finds.

This criterion is informed by Nina Simon’s *The Participatory Museum* (2010). Simon describes a participatory institution as a platform where visitors can act not only as consumers, but also as creators, critics, and collaborators. She also argues that participation should produce value for later audiences, rather than exist as an isolated activity. In The Cursed Museum, visitors can donate relics, choose their illustrated appearance, write an origin claim, and place them inside a gallery. Other visitors can then inspect these contributions, add interpretations, and vote on individual accounts. The collection therefore grows through visitor activity instead of remaining a fixed exhibition.

Participation also needs to feel socially present. Each visitor chooses a name and ghost form that other people can see. Visitors occupying the same room can encounter one another and communicate through the room-scoped Séance, while the Floor Plan shows where people are. These features are not intended to turn the museum into a generic chat room. They make other visitors’ actions legible as part of the museum experience: someone else is exploring, interpreting, and changing the same collection.

A living museum must also preserve disagreement. One visitor may claim that a portrait is haunted, while another proposes an ordinary explanation. Adding a contradiction, revision, testimony, or counter-evidence does not overwrite the earlier account. Each contribution retains its author, timestamp, relationship to the account it challenges, and voting history. This adapts principles from the Society of American Archivists’ *Describing Archives: A Content Standard* (DACS), which treats records, agents, activities, and their relationships as essential context and describes archival interpretation as iterative. Voting can change how believable an account appears, but it cannot erase less popular interpretations. The archive shows how understanding developed, not only the current result.

The illustrated Gothic design supports the same goal. I initially explored a free-roaming 3D museum, but its rooms felt generic and made the objects less distinctive. I shifted to richly illustrated scenes with object-shaped interactive areas, bounded panning, and zoom. This gives each gallery a recognisable identity and focuses attention on discovery. Free movement mattered less than creating an atmosphere in which visitors want to inspect objects and uncover their stories.

The project succeeds when contribution, interpretation, and persistence reinforce one another: a visitor discovers a mysterious object, responds to somebody else’s account, and leaves a relic or interpretation that remains for the next visitor. The museum never has to declare one supernatural story true. Its value comes from making collective storytelling explorable while keeping the history of participation and disagreement visible.

### References

- Simon, N. (2010). *The Participatory Museum*, Chapter 1: Principles of Participation. Museum 2.0. [https://participatorymuseum.org/chapter1/](https://participatorymuseum.org/chapter1/)
- Society of American Archivists. (2022). *Describing Archives: A Content Standard*, Version 2022.0.4, Statement of Principles. [https://saa-ts-dacs.github.io/dacs/04_statement_of_principles.html](https://saa-ts-dacs.github.io/dacs/04_statement_of_principles.html)

## What visitors can do

### Explore the museum

The Entrance Hall connects four galleries: **The Portraits That Watch**, **Objects That Remember**, **The Cabinet of Impossible Life**, and **The Forgotten Childhood**. Each room is a wide illustrated scene with bounded horizontal panning and zoom. Navigation controls remain at the edges of the view so the artwork, rather than floating interface bubbles, stays central.

Object-shaped hotspots are traced over real painted items such as portraits, sculptures, clocks, dolls, cabinets, and chandeliers. Their glow appears on hover, focus, or touch, and selecting one opens its dossier or a closer view.

### Read and extend dossiers

Built-in museum objects and donated relics use the same dossier model. A dossier records the object, its provenance, its original account, later interpretations, and the votes attached to each account.

Visitors can contribute a **testimony**, **contradiction**, **revision**, or **counter-evidence**. A contribution may challenge an earlier account, but it never replaces or deletes it. Every account remains attributed and timestamped.

Each visitor may classify an account as **Believable**, **Suspicious**, or **Definitely Cursed**. Changing a vote updates that visitor's existing vote rather than creating duplicates. Tied results appear as **Disputed** and accounts without votes appear as **Unclassified**.

### Donate and place a relic

The donation flow provides twelve curated illustrated relic appearances, one per relic subtype. After choosing an appearance, the donor supplies a title, a one-sentence origin claim, and a donor name.

Placement happens inside the destination room. The relic preview can be dragged across compatible walls, shelves, cabinets, tabletops, or plinths. The server validates the chosen surface, position, scale, compatibility, and separation from existing relics before saving it. The new relic then appears for connected visitors and in the Archive without a reload.

### Encounter other visitors

A visitor chooses one of three apparition forms. Other visitors in the same logical room appear as named Gothic ghosts placed within the illustrated scene. The visitor's own ghost is omitted from their first-person view.

Selecting another ghost opens the **Séance**, which supports short messages, reactions, and wordless reach-outs. Séance activity is ephemeral and room-scoped: visitors in different rooms do not share the same conversation. A gallery's main and close-up scenes still count as the same logical room.

### Navigate with the Floor Plan and Archive

The Entrance Hall's physical map and the `?` control open the Museum Guide. **Rooms** opens the same guide directly on its Floor Plan tab. The plan shows the museum layout, the current visitor, other connected visitors, and room occupancy; selecting a room travels there.

**Archive** provides a collection-wide index grouped by gallery. It can reopen any built-in, founding, or donated object's dossier directly.

## Controls

- **Look around:** drag or swipe horizontally, use a horizontal trackpad gesture, or press Left/Right.
- **Zoom:** use the mouse wheel, pinch gesture, or `+`/`-`.
- **Inspect or enter:** select a glowing object, doorway, or focused control with click, tap, or `Enter`.
- **Open the Séance:** select another visitor's ghost.
- **Open the Floor Plan:** select **Rooms**.
- **Browse the collection:** select **Archive**.
- **Create and place a relic:** select **Donate a Relic**.
- **Close or step back:** press `Esc` or use the lower-right back control.
- **Move between controls:** press `Tab` or `Shift+Tab`.

Reduced-motion preferences disable inertia and shorten decorative transitions. Essential actions remain available with mouse, touch, or keyboard.

## Technical design

- **Runtime:** Node.js 24 with ESM and no installed runtime npm dependencies.
- **HTTP server:** Node's built-in `node:http`.
- **Persistence:** `node:sqlite` in WAL mode; production data is stored on the Fly.io volume at `/data/museum.db`.
- **Realtime:** one Server-Sent Events stream distributes presence, exhibit, account, vote, ownership, and Séance events.
- **Identity:** an HttpOnly cookie stores a visitor identity per browser profile; no account or login is required.
- **World model:** a server-authored graph of illustrated scenes with bounded 2.5D camera settings, SVG object shapes, visitor anchors, and compatible relic-placement surfaces.
- **Visual assets:** full-bleed gallery artwork, three transparent ghost templates, twelve curated donated-relic images, and cropped details from the scene artwork for built-in-object dossiers.
- **Safety:** user text is rendered with DOM text nodes rather than `innerHTML`; server-side length limits, ownership checks, rate limits, surface validation, and transactional writes protect shared state.
- **Deployment:** Docker on Fly.io with automated checks and deployment from the course repository.

Architectural decisions are recorded in `docs/adr/`, the current product contract in `DESIGN.md`, the working implementation state in `PLAN.md`, and the agentic-coding evidence in `PROCESS.md` and `reflections/`.

### Local development

The deployed museum requires no local setup. To run the repository locally:

```sh
pnpm install --frozen-lockfile
MUSEUM_DB_FILE=/tmp/cursed-museum.db PORT=8080 node server/src/server.js
```

With the server running in another terminal:

```sh
pnpm check
pnpm check:evidence
```
