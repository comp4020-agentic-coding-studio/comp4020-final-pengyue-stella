# The Cursed Museum

Every object has a story. None of them can be trusted.

**Visit the museum:** [https://comp4020-final-pengyue-stella.fly.dev/](https://comp4020-final-pengyue-stella.fly.dev/)

## Start here

The Cursed Museum is a shared, illustrated Gothic museum. No login, installation, paid service, or school-network connection is required. Enter a display name, choose one of three apparitions, and select **Enter the Museum**. The first request may take a few seconds while the Fly.io machine wakes.

1. Open **Rooms** to see the floor plan, then choose one of the four galleries. Drag, swipe, or use the arrow keys to look around; use the wheel, pinch, or `+`/`-` to zoom.
2. Select a glowing object to open its dossier. Read the museum record and later visitor accounts. Add testimony, a contradiction, a revision, or counter-evidence; then classify any account as **Believable**, **Suspicious**, or **Definitely Cursed**. Later accounts are ordered by the lower confidence bound of their Believable votes, so broad support outranks one lucky vote. Existing fictional visitor records make the ranking and disputed evidence visible from the first visit.
3. Select **Donate a Relic**. Choose an illustrated object, customise its tint, stickers, paint, scale, and rotation, then write its title and one-sentence origin claim. Place it in any gallery. You can later edit its title, publish a revised claim, or withdraw your own relic.
4. Open **Archive** to find every museum object and visitor donation without searching each room again.
5. For the shared experience, open the site in **two separate Chrome profiles**, not two tabs. Visitors in the same room appear as named ghosts. Select a ghost to open the room-scoped **Séance** for messages, replies, reactions, and wordless reach-outs. The floor plan shows room occupancy, and shared changes appear without a reload.

Donations, accounts, votes, and placements survive refreshes and redeploys. Press `Esc` to step back or close a panel. Mouse, touch, and keyboard controls are supported.

## What makes The Cursed Museum good?

For this project, “good” means a participatory museum where curiosity leaves a durable trace. A visitor should not merely read an official story. They should discover an unsettling object, judge competing explanations, contribute evidence, and change what the next visitor encounters. The museum is successful when exploration, interpretation, and persistence form one loop.

This definition follows Nina Simon’s account of the participatory museum as a platform on which visitors act as creators, critics, and collaborators, and where their participation creates value for later audiences. The Cursed Museum applies that idea through relic donation, placement, linked visitor accounts, and voting. A donated object becomes part of the same archive as the founding collection. A later visitor can inspect it, challenge its origin claim, or strengthen it with testimony. Participation therefore changes the collection instead of disappearing as a private interaction.

Good participation must preserve disagreement. The Society of American Archivists’ *Describing Archives: A Content Standard* treats records, agents, and their relationships as essential context, and describes archival description as iterative. Accordingly, testimony, contradictions, revisions, and counter-evidence are appended rather than overwriting earlier accounts. Attribution, time, links, and votes remain visible. The ranking can make well-supported accounts easier to find, but cannot erase an unpopular interpretation; [ADR 0008](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/blob/main/docs/adr/0008-account-trust-ordering.md) records why I chose Wilson-score trust over raw totals or ratios. The museum presents how knowledge changed, not a single authorised truth.

Social presence supports this purpose. Named ghosts, room occupancy, and the room-scoped Séance reveal that other people are exploring the same collection. They do not create a site-wide social feed: conversation stays attached to a place, while the durable record stays attached to an object. This keeps collaboration inside the museum rather than turning the project into a chat room with Gothic decoration.

The illustrated rooms also matter. I rejected a free-roaming 3D museum because early versions made the galleries generic and the objects less distinctive; [ADR 0003](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/blob/main/docs/adr/0003-scene-exploration.md) records that pivot. Bounded 2.5D scenes, panning, and zoom give each room a strong identity and reward close looking, while [ADR 0011](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/blob/main/docs/adr/0011-object-shaped-interaction.md) explains why the interactive areas follow each painted object’s silhouette. I also rejected arbitrary image uploads and a global feed because both would weaken the visual and narrative coherence.

Some claims are enforced by the system: tests cover durable contributions, one vote per visitor per account, ownership rules, room-scoped realtime updates, and the published `/readme/` route. Other qualities require judgement: atmosphere, room distinction, curiosity, and whether the clues feel coherent. I assess those through manual walkthroughs at the marking viewports, with keyboard and touch controls, and with two independent Chrome profiles. The intended result is not a museum that proves a curse. It is one that makes collective uncertainty worth exploring.

### Sources

- Nina Simon, *The Participatory Museum*, Chapter 1: [Principles of Participation](https://participatorymuseum.org/chapter1/) (2010).
- Society of American Archivists, *Describing Archives: A Content Standard*, [Statement of Principles](https://saa-ts-dacs.github.io/dacs/04_statement_of_principles.html) (Version 2022.0.4).
