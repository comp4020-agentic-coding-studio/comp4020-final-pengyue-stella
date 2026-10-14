# The Cursed Museum

Every object has a story. None of them can be trusted.

The Cursed Museum is a shared, explorable gothic museum. You walk in under a
display name, pick a route through four haunted galleries — The Portraits
That Watch, Objects That Remember, The Cabinet of Impossible Life, The
Forgotten Childhood — and find relics other visitors have already donated:
a spoon that remembers dinner-table secrets, a portrait whose hallway keeps
changing. Other visitors are there with you, moving through the same rooms
in real time. Press **V** to drop from a diagonal overhead view into a
freely-navigable first-person view and back, in place, mid-stride.

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
  grey 3D box;
- a visitor can move, look around freely, and inspect an object using
  nothing but WASD/arrows, the mouse, E, V and Esc;
- other visitors' presence and movement are visibly, immediately real —
  no simulated placeholder players;
- donating a relic, writing a competing account, and casting a vote are all
  one honest shared write, seen by everyone else within about a second;
- the record survives a refresh, a server restart, and a real redeploy.

## What this deliberately isn't

Not a 2D painted scene cropped to fake movement — a genuine freely-navigable
first-person camera needs real 3D world geometry, so the museum is one
coherent Three.js world with two camera rigs over the same coordinates, not
two different experiences bolted together. Not a moderated social network —
there are no accounts, no profile pages, no likes; a visitor is a
cookie-backed identity with a chosen display name, and reports/abuse handling
is limited to input validation, length caps and per-visitor rate limits, not
a moderation queue. Not AI-generated art — exhibit imagery is simple,
original, procedurally-styled iconography keyed to each gallery's category,
not a generated or scraped image per donation.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move (diagonal speed normalised) |
| Mouse (first-person) | Look around |
| `V` | Toggle overhead ⇄ first-person, in place |
| `E` / click | Inspect the nearest or clicked exhibit |
| `Esc` | Close the dossier or donation form |
| `Enter` | Submit a form without moving the avatar |
| `Tab` | Move focus through the overlay's own controls |

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
