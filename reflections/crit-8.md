# Crit 8 — It's alive!

**The breakthrough.** The first working version passed every check — the
scene graph connected, traces round-tripped, two browser sessions saw each
other live — and was still wrong, because the four scenes were hand-illustrated
SVGs that read as a generic campus-shaped prototype, not as ANU. Nothing in
`spec/` can catch that; it only shows up when someone actually looks. The fix
wasn't cleverness, it was going and getting real photographs (Wikimedia
Commons has ample CC-licensed ANU campus imagery) and building a "blurred
letterbox" pseudo-panorama from them — the real photo sharp and centred, a
softly blurred extension of the *same* image either side for pan room. The
anchoring architecture underneath didn't change at all, which only worked
because scene content was already decoupled from the interaction model. Two
more real bugs turned up the moment real people clicked through the real
result instead of trusting the design on paper: the pan buttons silently
opened a compose form instead of panning, and a scene could load with its
real photo entirely out of frame on a narrow screen.

**What this changed.** A green `pnpm check` answers "does it work", not "is it
good" — the brief's actual question. I'd treated passing specs as evidence of
being done; now I check what a stranger would see in the first second, before
checking what the code does. The two-session, both-viewports habit from
earlier in the week is what caught all three bugs here too: watching the real
thing, not reasoning about it, keeps finding what reading code alone doesn't.
