# Process overview

This is the current account of how The Cursed Museum was built and why. The
repo carried crits 8 and 9 as *Traces of ANU*; that earlier work remains in
Git history before [`804aabc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/804aabc) and in the earlier reflections.

## Finding the product

The final-project blueprint proposed a shared, explorable Gothic museum with
a living archive of donated relics and competing, votable stories. The first
complete implementation genuinely was a free-roam Three.js museum: avatar
movement, collision, first-person/overhead cameras, furnished rooms, donation,
accounts, votes, SQLite persistence, and SSE multiplayer all worked.

It was technically substantial but visually wrong. Primitive geometry and
modular furniture kept producing a generic demonstration room rather than the
specific crowded Gothic museum the project needed. The important lesson was
that “more 3D” was not the same as “more immersive.” The presentation changed
in two explicit stages: fixed click-driven 2.5D scenes in
[`00e5c0a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/00e5c0a), then full-bleed illustrated rooms in
[`4c1652e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/4c1652e). The archive, transactions, and SSE transport survived both pivots.

The illustrated version was then tested as an experience rather than treated
as finished. Early scenes behaved like flat slides covered by rectangular
bubbles; the foyer used a small image and unique left/right arrows; donated
objects appeared as unrelated procedural shapes; multiplayer presence was
little more than a count. Successive passes added a bounded pan/zoom camera,
one high-resolution foyer, object-shaped SVG hotspots, real placement
surfaces, curated relic illustrations, a live Floor Plan, named apparition
forms, a room-scoped Séance, and unified dossiers for built-in objects. Free
placement landed in
[`2794778`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/2794778), and the Séance became a logical-room group interaction in
[`2fc2e9c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/2fc2e9c).

## The standard that guided the revisions

The project became coherent when “good” was defined as a participatory,
living museum. Every feature now supports discovery → interpretation →
contribution → persistence. Illustrated rooms make objects worth discovering;
unified dossiers and non-destructive accounts make interpretation visible;
donations, votes, and owner controls let visitors contribute; SQLite keeps
that contribution available to the next visitor. Ghosts, the Floor Plan, and
the Séance make other people present without turning the museum into a generic
chat room.

This standard also explained what to remove. Free-roam movement did not help
visitors interpret objects. Floating hotspot bubbles obscured the illustrations.
A site-wide social feed would detach conversation from the room and collection.
Arbitrary uploaded imagery would break visual coherence. The current limits —
bounded views, room-scoped interaction, sixteen curated donation visuals, and
fixed tint/sticker vocabularies — are deliberate scaffolding rather than
missing ambition.

The final narrative pass made the same coherence rule apply to words. The Hall
and four galleries now follow one erased-curator case: Lenora Vane, the Night
of Five Bells, 1:13, and the absent fifth door. `server/src/narrative.js`
overrides every built-in object with a formal name and short clue. A later
archive pass added 28 fictional prior-visitor accounts and 463 votes across
seven key objects, then ordered later accounts with a Wilson lower-bound trust
score so a single positive vote cannot masquerade as strong consensus.

## Architecture that remained stable

The server uses Node's built-ins: `node:http`, `node:sqlite`, and one SSE hub.
SQLite runs in WAL mode on the Fly volume. Donation, account, vote, edit, and
withdrawal events are broadcast only after their transaction commits.
Accounts are append-only; a contradiction or revision links to an earlier
account instead of overwriting it. Votes are unique per visitor/account.

Presence is ephemeral and scene-scoped. The server maps main and close-up
scenes to one logical gallery room for ghost and Séance delivery, but retains
exact-scene anchors so ghosts fit each composition. Clients receive a stable,
non-reversible public key, display name, and ghost type — never the raw cookie.

The database still allocates a unique internal display slot to each donation
for capacity and backwards compatibility. The visitor-facing model is now a
validated point on a traced wall, shelf, cabinet, table, or plinth. Normalized
surface coordinates survive different viewport sizes; the server checks
containment, subtype compatibility, scale, and collision before commit.

The one deliberate exception to zero runtime dependencies is a dev-only tool,
not the museum: `public/tools/hotspot-editor.html` traces hotspot geometry by
hand against the real gallery images, exported as `polygon()`/`ellipse()`
calls to paste into `world.js`. An earlier colour-threshold "auto-trace" mode
was tried and dropped — these source images are painterly with no flat
background region to subtract, so it fractured a drawn box into dozens of
useless fragments rather than one outline. It was replaced with SlimSAM (a
distilled Segment Anything model), run client-side via transformers.js and
onnxruntime-web, vendored under `public/tools/vendor-sam/` (~25MB: weights,
runtime, and its one wasm backend) rather than fetched from a CDN at use
time, so the tool works offline and doesn't depend on a third party's
uptime. This is a real new dependency, used exactly where `CLAUDE.md`'s own
rule says one may land: never linked from museum navigation, never imported
by any `server/` or `public/` app code, and the museum's deployed dependency
graph is unchanged by its presence. The only production-code touch it
required was `server/src/static.js` gaining `.wasm`/`.onnx` MIME types so
the vendored files can be served at all.

## What testing changed

Automated coverage grew with the product and now checks world reachability,
camera bounds, SVG geometry, free placement, preset compatibility, built-in
dossiers, append-only accounts, vote semantics, owner-only edit/withdraw,
Floor Plan data, ghost identity, logical-room presence, Séance delivery,
realtime events, and persistence contracts. The course `/` and `/readme/`
invariants remain unchanged.

Manual browser walkthroughs still found failures that isolated assertions did
not. A camera pointer capture swallowed ordinary object clicks until capture
was delayed past a drag threshold. `background-size: cover` and the SVG layer
used different coordinate assumptions, so glows appeared beside their painted
objects; both now share the image's native viewBox. Close-up images required
their own measured crop coordinate systems. Mobile overlays lost their close
buttons below the viewport until scrolling and pinned actions were repaired.
These were interaction and composition bugs, not API bugs, and justified the
rule in `CLAUDE.md`: green tests are the floor, not the definition of done.

Final verification uses two independent browser contexts, not two tabs sharing
one identity: enter different names/forms, share a room, see both ghosts,
exchange a Séance interaction, move one visitor and watch the Floor Plan,
publish an account/vote/donation, verify the second context updates without a
reload, then refresh and confirm durable state remains. `pnpm check` and
`pnpm check:evidence` run before each shipped documentation or product change.

## Honest limits

The museum has four galleries, sixteen curated donation illustrations, and
three apparition forms. It has no login, arbitrary image upload, or moderation
queue beyond validation and rate limits. Séance transcripts are intentionally
ephemeral. Four empty close-up scene records remain for compatibility but are
not opened by current objects. The experience is a bounded illustrated 2.5D
museum, not a full 360° panorama or free-roam 3D world. Three.js remains
vendored only as a defensive preview fallback for a legacy record without a
curated visual.
