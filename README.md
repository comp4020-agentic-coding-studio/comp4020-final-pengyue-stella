# The Cursed Museum

Every object has a story. None of them can be trusted.

The Cursed Museum is a shared, explorable gothic museum, presented as a
crafted 2.5D cabinet of curiosities: you walk in under a display name, step
between richly staged scenes in four haunted galleries — The Portraits That
Watch, Objects That Remember, The Cabinet of Impossible Life, The Forgotten
Childhood — and find relics other visitors have already donated: a spoon
that remembers dinner-table secrets, a portrait whose hallway keeps
changing. Other visitors are there with you, moving through the same
galleries in real time, and you can feel it — the room tells you how many of
you are here, and the archive changes under your eyes as they donate,
dispute and vote.

Every relic has a dossier: who donated it, what they claimed, and everyone
since who has disputed it. Publishing a new account never erases the old
one — a "rewrite" is a competing claim sitting alongside the one it
contradicts, each permanently attributed and timestamped. Visitors vote each
account **Believable**, **Suspicious**, or **Definitely Cursed**; the
museum's current, provisional "accepted" account can change as votes shift,
but every earlier version stays in the record. The archive only grows.

## What "good" means here

A stranger should be able to walk in, explore a room, notice a glinting
object, inspect it, and donate or dispute something — without being told how.
Exploration should feel like entering a crowded, specific museum, not
browsing a card grid: the room is the interface. Two visitors in two browsers
must see each other move, must see what the other donates or disputes appear
without a reload, and must still find it all there the next day, after a
restart, after a redeploy. Contradictions are the point, not a bug: nothing
written is ever silently destroyed, and the museum does not pretend crowd
votes are settled fact — a tie is shown as **Disputed**, not resolved in
either direction.

So, for this project, "good" currently means:

- the museum reads as Gothic-Victorian and specifically itself within the
  first screen — amber light, dark wood, crowded cabinets — never a generic
  grey 3D box, and never a flat slideshow of static images either;
- a visitor can step between scenes, look closer at a display, and inspect
  an object using nothing but a mouse click, a tap, or Tab/Enter — no
  movement keys to learn;
- other visitors' presence is visibly, immediately real — a live headcount
  in whatever room you're standing in, not a simulated placeholder;
- donating a relic, writing a competing account, and casting a vote are all
  one honest shared write, seen by everyone else within about a second;
- the record survives a refresh, a server restart, and a real redeploy.

## What this deliberately isn't

Not unrestricted free-roam — there is no walkable floor, no avatar, no
collision; exploration is a small fixed graph of richly staged camera
vantages (an Entrance Hall you turn to face each doorway from, a main view
per gallery, a close-up per gallery's hero display), moved between by
clicking glowing hotspots, in the spirit of a crafted cabinet-of-curiosities
game rather than a generic 3D sandbox (see
`docs/adr/0003-scene-exploration.md` for the full decision record — this
replaces an earlier, fully free-roam version this same repo shipped at
crit 10). Not a flat slideshow either — every scene is a real staged Three.js
composition (furnished rooms, warm point-light pooling, watching portraits),
not a static image with hotspots painted over it. Not a moderated social
network — there are no accounts, no profile pages, no likes; a visitor is a
cookie-backed identity with a chosen display name, and reports/abuse handling
is limited to input validation, length caps and per-visitor rate limits, not
a moderation queue. Not AI-generated art — exhibit imagery is simple,
original, procedurally-styled iconography keyed to each gallery's category,
not a generated or scraped image per donation. Not embodied multiplayer
avatars — other visitors are represented by a live per-room headcount and
shared archive activity, not a walking character, per the brief's own
permission to represent presence this way.

## Controls

| Input | Action |
| --- | --- |
| Click a glowing hotspot | Move to another scene, look closer, or go back |
| Click an exhibit's label | Open its dossier |
| `◀` / `▶` (or arrow keys, in the hall) | Turn to face a different gallery doorway |
| `Esc` | Close the dossier/donation form, or step back a scene |
| `Enter` | Submit a form |
| `Tab` | Move focus through every hotspot and overlay control in turn |

## Stack

Node.js, ESM, **zero runtime npm dependencies** beyond what Node ships —
`node:http`, `node:sqlite`, Server-Sent Events, and Three.js vendored as a
static file (the one prior exception, unchanged). See `PROCESS.md` for the
full decision record on why this stack serves a one-machine, one-volume Fly
deployment better than a framework would.

Photo credits for the project this one replaced (Traces of ANU) remain in
Git history; this build uses original procedural geometry and iconography
throughout, referencing (not reproducing) the mood boards in
`design/references/`.
