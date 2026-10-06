# Crit 8 — It's alive!

**The breakthrough.** It wasn't an architecture choice — it was switching from
`curl` to two genuinely independent browser sessions (different cookies,
different "visitors") before calling the real-time loop done. Posting a trace
in one and watching it arrive, unprompted, in the other is what actually
exercises "multi-user" and "real-time" as lived behaviour rather than as two
separate API responses. That pass found a real bug ([`b22c513`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-pengyue-stella/commit/b22c513)):
a trace from a scene you weren't looking at got marked "handled" by the toast
that announced it, so navigating there later silently dropped its pin forever.
No amount of single-session testing, or reading the code, would have surfaced
that — it only exists in the gap between two people's views of the same state.

**What this changed.** Choosing the plainest possible stack (no framework, no
database, no WebSocket library) wasn't just about fitting 256MB — it bought
back the time and attention to actually run two sessions side by side instead
of trusting that the design was obviously correct. I want to be the kind of
developer who treats "two people use this at once" as something to watch
happen, not something to reason about from one browser tab. Keeping the
infrastructure boring is partly what makes that kind of checking affordable
instead of a thing there's never quite time for.
