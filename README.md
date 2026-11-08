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

The museum is for curious online visitors who enjoy Gothic stories and collaborative interpretation, including people who arrive alone and have no specialist museum knowledge. Their problem is that a conventional fictional museum is fixed and solitary: every visitor sees the same authoritative labels, and their interpretation disappears when they leave. The product value is a low-barrier shared investigation. A visitor can explore a coherent mystery, compare uncertain accounts, and leave the collection meaningfully changed for someone else.

For this project, “good” therefore means a participatory museum where curiosity leaves a durable trace. This follows Nina Simon’s account of the participatory museum as a platform on which visitors act as creators, critics, and collaborators, producing value for later audiences. The Cursed Museum applies that idea through relic donation, placement, linked visitor accounts, and voting. Participation is not a detached comment box: it becomes part of the collection visitors must interpret.

Persistence is necessary because it makes participation consequential across time. A donated relic changes what occupies a gallery and what appears in the Archive. New testimony or counter-evidence changes the dossier around an object. Votes can change which later account is encountered first. The next visitor therefore receives a materially different room, evidence set, and path through the mystery, then can answer what earlier visitors left behind. Without persistence, contribution would decorate one session but create no value for the next audience.

Good participation must also preserve disagreement. The Society of American Archivists’ *Describing Archives: A Content Standard* treats records, agents, and their relationships as essential context, and archival description as iterative. Testimony, contradictions, revisions, and counter-evidence are therefore appended rather than overwriting earlier accounts. Attribution, time, links, and votes remain visible. Ranking makes supported accounts easier to find but cannot erase an unpopular interpretation; [ADR 0008](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/blob/main/docs/adr/0008-account-trust-ordering.md) explains the Wilson-score decision. The museum shows how its knowledge changed, not one authorised truth.

Real-time interaction is necessary for a different reason: it turns simultaneous browsing into a shared investigation. Named ghosts and room occupancy make another visitor’s attention perceptible. Room-scoped Séance messages, reactions, and reach-outs let visitors exchange suspicion at the object and moment that produced it, while live collection updates show that the museum is changing around them. This creates presence and immediacy that an asynchronous archive alone cannot provide. It is deliberately room-scoped and ephemeral, so conversation supports close looking instead of becoming a global social feed added only to satisfy the course requirement.

The scope is intentionally narrow. I rejected free-roaming 3D because it made rooms generic and objects less distinctive; [ADR 0003](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/blob/main/docs/adr/0003-scene-exploration.md) records the shift to bounded illustrated scenes. [ADR 0011](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/blob/main/docs/adr/0011-object-shaped-interaction.md) explains the object-shaped hotspots that reward close looking. I also excluded login accounts and persistent social profiles, private messaging, a global feed, arbitrary image uploads, and unrestricted free-form room building. These features would expand moderation and identity work while weakening the curated visual story. The project concentrates instead on four distinct rooms, one mystery, object-centred disagreement, and constrained contribution.

Tests enforce durable contributions, vote and ownership rules, room-scoped updates, and the published `/readme/`. They cannot judge atmosphere, curiosity, or clue coherence. I assess those qualities at both marking viewports, with keyboard and touch input and two independent Chrome profiles. The intended result is not a museum that proves a curse. It is one that makes collective uncertainty worth exploring.

### Sources

- Nina Simon, *The Participatory Museum*, Chapter 1: [Principles of Participation](https://participatorymuseum.org/chapter1/) (2010).
- Society of American Archivists, *Describing Archives: A Content Standard*, [Statement of Principles](https://saa-ts-dacs.github.io/dacs/04_statement_of_principles.html) (Version 2022.0.4).
