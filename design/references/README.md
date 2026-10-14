# The Cursed Museum — Visual references and implementation brief

## Source and image quality
These four PNGs are cropped from the user-provided screenshot (not original full-resolution image files). They are moodboard references ONLY. Do not ship them as final art without confirming the underlying images’ provenance and usage rights. Create original scene/asset artwork matching the art direction instead.

## Vision
An eerie yet elegant multiplayer interactive museum, with dense Victorian curiosity cabinets, unsettling portraits, antique wood, brass, glass display cases, low amber light, a slightly playful supernatural tone.

## Player experience
- Enter with a visitor nickname; move an avatar around interconnected galleries using WASD/arrow keys; E or mouse-click to inspect nearby exhibits. Camera: 2.5D/isometric or fixed perspective; priority is reliable collision, navigability, and beautiful curated scenes.
- Other active visitors appear in the room, with smoothly updated live positions; idle/disconnect handling.
- Galleries: Portraits That Watch; Objects That Remember; Cabinet of Impossible Life; Forgotten Childhood. Each room has varied decorative props and clearly identifiable interactive exhibit positions.
- Donate Relic: title, description, donor name, object type, target gallery, display slot; new exhibit appears for everyone.
- Exhibit dossier: illustration, original donor statement, chronological provenance/history, claimed contradictions, current consensus, vote counts and activity.
- Rewrite History: add a new competing account or annotation; NEVER erase or silently overwrite another person's writing. Preserve provenance and version/event history.
- Vote on each account: Believable / Suspicious / Definitely Cursed. Votes are tied to a stable browser identity or account and can be changed, to discourage accidental double voting. Make levels derived clearly from actual votes, never random.
- Presence, new exhibits, new accounts and votes update live across connected sessions (target ~1 second).
- SQLite persists exhibits, accounts, versions, votes and records across restart/redeploy using the configured persistent Fly volume.
- Input validation, text escaping, basic abuse/rate limits, content/report moderation to handle public UGC. No user-supplied HTML scripts.

## Design principles
- The room is the primary navigation: not a feed or card grid.
- Exquisite, crowded mise-en-scène with restrained interactive highlighting and excellent text readability.
- Narrative uncertainty is the mechanic: competing accounts and visible history of alterations.
- Quality and accessibility: keyboard movement, focus handling, clear proximity targets, reduced-motion support, mobile fallback using click/tap navigation.
- Create automated tests and actual multi-browser verification for persistence and realtime behaviour; commits at meaningful green checkpoints.

## Technical considerations
Use the official COMP4020 final-project starter as the source of truth. Check its current README, spec, CI, Fly configuration before selecting an engine. Suggested architecture: Astro/Node SSR + SQLite + WebSocket or SSE, with a canvas-based 2D exploration layer. Carefully assess realtime movement traffic versus event broadcasts, one-machine Fly volume limits, and content-management complexity before implementing.

## Development phases (full vision retained; staged implementation)
1. Set world layout/art direction, user journeys, README definition of good, acceptance criteria.
2. Build walkable interconnected galleries and object hotspots with placeholder original shapes; validate navigation.
3. Add database models, donation placement, dossier creation and accounts history.
4. Add multiple visitors/presence, live movement and synchronized museum updates.
5. Voting, status/curse classifications and historical conflict/archive UI.
6. Replace placeholder art with consistent original illustrated room scenes, object variants and animation; test with two browsers and redeploy.

## Reference images
- 01_gallery_reference.png: dense display-room composition
- 02_cabinet_reference.png: crowded cabinet arrangement and ornamentation
- 03_portrait_reference.png: ornate frame, shadow and painting treatment
- 04_spoon_reference.png: unsettling anthropomorphic exhibit concept
