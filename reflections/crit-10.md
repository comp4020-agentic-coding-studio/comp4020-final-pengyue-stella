# Crit 10 — A different museum entirely

**The breakthrough.** The user handed over a complete, decided product
blueprint for a different app — The Cursed Museum — and asked for the full
first version in one autonomous run, not a scoped-down slice. The temptation
with a brief this large is to quietly shrink it into something safer: drop
the second camera rig, fake the vote math, skip the non-destructive
rewrite-history rule. The breakthrough was treating the blueprint's own
constraints as load-bearing rather than aspirational — "a genuine freely
moving first-person camera cannot be supplied by cropping a fixed 2D museum
painting" is exactly the kind of sentence that's easy to read past and keep
reusing the prior app's photo-panning interaction anyway, because it
already worked. Taking it literally meant deciding, before writing any app
code, that this was a one-way pivot: the prior project's scene/store code
and photography came out, SQLite went in, and one real Three.js world with
two camera rigs over one avatar transform became the actual architecture,
not a stretch goal layered on top of something smaller. The same discipline
applied to the archive: a contradiction is genuinely a new row beside the
account it challenges, never an edit, enforced by what the database will
and won't let the application code do (a unique slot claim, an upsert-only
vote), not just by a comment promising good behaviour.

**What this changed.** Two bugs only showed up by actually walking an avatar
through the running app rather than reading the collision code: a CSS rule
that quietly showed all three modal gates at once, and a collision seam
where two rectangles that exactly touched left a dead zone neither one's
radius-shrunk interior covered, permanently stopping movement at every
gallery doorway. Neither was visible from the code in isolation; both were
obvious within one screenshot and one scripted walk. It reinforced something
crit 8 already taught but which generalises further than I'd realised: for a
genuinely spatial, real-time, multi-session app, "I reasoned about the logic
and it looks right" and "I watched two independent sessions actually do the
thing" are different claims, and only the second one is evidence. The
discipline that changed is spawning two browser contexts and actually moving
through the world before calling any interaction loop done, not just before
calling the whole project done.
