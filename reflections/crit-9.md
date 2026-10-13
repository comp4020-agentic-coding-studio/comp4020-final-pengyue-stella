# Crit 9 — Several people, one place

**The decision.** Presence was already live from C8, but campus-wide: every
connected browser counted together, so "3 people wandering campus" told you
nothing about whether anyone was actually near you. The brief's real question
— make visitors feel they share the place, without building a tracking
platform — meant the fix wasn't "add presence," it was "scope the presence
that already exists to the scene it's actually about." Compared against the
alternative of going further (live cursor positions), the smaller move won:
cursors answer "where exactly" when the brief only asked for "how many," and
getting there would have meant a return channel from browser to server,
pushing against the one-directional SSE architecture decided back in C8.
Written up as an ADR (`docs/adr/0001-scene-scoped-presence.md`) rather than
folded into `PROCESS.md`, so the decision has its own record instead of
getting buried in a running account.

**The bug this caught.** Tagging a connection by scene at connect time wasn't
enough, because `POST /api/presence` retags a *still-open* connection when a
visitor navigates — the SSE stream itself never closes on a scene change,
only its tag does. The first version of the disconnect handler closed over
the scene captured when the connection opened, so a visitor who navigated
from Kambri to Union Court and then disconnected caused the server to
rebroadcast a stale Kambri count instead of Union Court's. Curling through the
actual sequence (connect, retag, disconnect) rather than trusting the code by
inspection is what surfaced it — the same lesson C8 drew from the toast/pin
dedupe bug, applied again: `removeClient` now returns the connection's
*current* tag at the moment of removal, not whatever it was handed at
`addClient` time.

**What was verified, concretely.** Two independent headless-browser contexts
(separate cookie jars, same method as C8's two-session habit, this time with
Playwright since no project driver was already set up for it): both sessions
at Kambri Lawn showed "2 people here right now"; one navigated to Union Court
and the other dropped to "Just you here" within single-digit milliseconds,
well inside the ~1s budget, no reload; closing the second session's context
entirely produced the same drop, also within milliseconds. The existing trace
flow was exercised in the same pass to confirm it wasn't disturbed. No change
touched `store.js` or `traces.jsonl` — presence stays in-memory only, same as
the SSE client registry it extends.
