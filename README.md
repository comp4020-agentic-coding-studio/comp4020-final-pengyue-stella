# The Cursed Museum

Every object has a story. None of them can be trusted.

The Cursed Museum is a shared, illustrated Gothic museum: you walk in under
a display name, step between richly illustrated scenes in four haunted
galleries — The Portraits That Watch, Objects That Remember, The Cabinet of
Impossible Life, The Forgotten Childhood — and find relics other visitors
have already donated: a spoon that remembers dinner-table secrets, a
portrait whose hallway keeps changing. Other visitors are there with you,
visible as small cameo medallions carrying their chosen names, and the
archive changes under your eyes as they donate, dispute and vote.

Every relic has a dossier: who donated it, what they claimed, and everyone
since who has disputed it. Publishing a new account never erases the old
one — a "rewrite" is a competing claim alongside the one it contradicts,
permanently attributed and timestamped. Visitors vote each account
**Believable**, **Suspicious**, or **Definitely Cursed**; the "accepted"
account can change as votes shift, but every earlier version stays in the
record. The archive only grows.

## What "good" means here

A stranger should be able to walk in, notice a glowing exhibit card, inspect
it, and donate or dispute something — without being told how. Two visitors
in two browsers must see each other's cameo, must see what the other
donates or disputes appear without a reload, and must still find it all
there the next day, after a restart, after a redeploy. A tie vote is shown
as **Disputed**, never silently resolved in either direction.

So, for this project, "good" currently means:

- the museum reads as Gothic-Victorian and specifically itself on first
  screen — amber light, dark wood, crowded cabinets — never a generic
  slideshow of flat photographs;
- every scene, inspection, donation and the archive are reachable with
  nothing but a mouse click, a tap, or Tab/Enter — no movement keys;
- other visitors' presence is visibly real — a cameo with a name in
  whatever scene you're standing in, not just a headcount string;
- donating, writing a competing account, and voting are all one honest
  shared write, seen by everyone else within about a second;
- the record survives a refresh, a server restart, and a real redeploy.

## What this deliberately isn't

Not free-roam, and not a live 3D room either — there is no camera a visitor
steers; exploration is a small fixed graph of full-bleed illustrated
scenes, moved between by clicking glowing hotspots or a framed exhibit card
(see `docs/adr/0004-illustrated-scenes.md` for why this replaced an earlier
live-Three.js-room version this repo shipped). Not embodied avatars — other
visitors are cameo medallions with a name and a restrained idle motion,
never a character a visitor controls. Not a moderated social network — no
accounts, no profile pages, no likes; a visitor is a cookie-backed identity
with a chosen display name, and abuse handling is validation, length caps,
and rate limits, not a moderation queue.

## Controls

| Input | Action |
| --- | --- |
| Click a glowing hotspot | Move to another scene, look closer, or go back |
| Click a framed exhibit card | Open its dossier |
| `◀` / `▶` (or arrow keys, in the hall) | Turn to face a different gallery doorway |
| `Esc` | Close an overlay, or step back a scene |
| `Tab` / `Enter` | Reach and activate any control without a mouse |

## Stack

Node.js, ESM, **zero runtime npm dependencies** beyond what Node ships —
`node:http`, `node:sqlite`, Server-Sent Events, and Three.js vendored as a
static file (used only for small disposable exhibit preview thumbnails —
see `PROCESS.md` for the full decision record on this stack).
