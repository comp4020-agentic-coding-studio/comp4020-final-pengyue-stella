# ADR 0008: Order dossier accounts by Wilson-score trust, not raw vote count or ratio

**Status:** Accepted — Final Project

## Context

Every account's `verdict` (Believable / Suspicious / Definitely Cursed /
Disputed / Unclassified) was already a documented invariant, derived from
votes at read time (`db.js`'s `voteTallyFor`/`verdictFromTally`). What it
did **not** have was a display order inside a crowded dossier: accounts
rendered in the server's own chronological insertion order
(`ORDER BY created_at ASC`), so a highly-corroborated piece of testimony
could sit buried under four newer, barely-voted ones. The product goal
(see `CLAUDE.md`'s "Disagreement remains legible") is for a visitor opening
a dossier to see the account the room currently trusts most without
scrolling past everything chronologically newer first.

"Trust" needed a precise definition before it could become a sort key. The
options below were tried in the order listed, each one surfacing a concrete
failure the next option fixed.

## Options considered

1. **Total vote count (all three verdicts weighted 1:1:1).** `score =
   Believable + Suspicious + Definitely Cursed`. Simplest to implement and
   reason about. Rejected as the final answer because it ranks by "how much
   attention this account attracted," not "how trusted it is" — a heavily
   **Disputed** account (say 10 Believable vs. 10 Suspicious) would outrank
   a quietly, unanimously endorsed one with only 6 Believable votes, purely
   because more people showed up to argue about it.
2. **Believable weighted higher than the other two verdicts** (e.g. 2:1:1
   or 3:1:1). Tried as a middle ground. Rejected: any fixed weight ratio is
   an arbitrary knob with no principled way to pick its value, and it still
   doesn't solve option 1's core problem — a contested account can still
   out-score a quiet consensus one if enough people vote on it, just at a
   different threshold.
3. **Plain Believable ratio** (`Believable / total`). Fixes the "contested
   accounts shouldn't win" problem directly — a 10/10 split scores exactly
   0.5, no matter how many total votes it drew. But it introduces a worse
   failure: a single lonely Believable vote (1/1 = 100%) outranks fifty
   Believable votes sitting alongside two Suspicious ones (50/52 ≈ 96%),
   which is backwards from what any reasonable visitor would call "more
   trusted." Confirmed with a concrete before/after comparison
   (`spec/account-ranking.test.ts`'s "ranks broad corroboration above one
   perfect but lonely vote").
4. **Wilson score 95% lower bound on the Believable share (chosen).**
   `wilsonLowerBound(positive, total)` in `public/account-ranking.js`
   answers a different question than a raw ratio: not "what fraction of
   votes are Believable" but "how confident can we be that the *true*
   Believable share is at least this high, given only this many votes." A
   single vote could easily have gone the other way, so its lower bound
   sits low (≈0.21 for 1/1); fifty votes at 96% leaves little statistical
   room for doubt, so its bound sits close to 96% (≈0.87). This is the same
   formula Reddit and other "best rated" rankings use for exactly this
   reason, and it resolves options 1–3's failures without any hand-picked
   weight or minimum-vote threshold — well-corroborated accounts naturally
   outrank thin ones, and a contested account's uncertainty is penalized
   automatically rather than needing a separate "ignore Disputed" rule.

## Decision

- Sort a dossier's accounts by `trustScore()` (`wilsonLowerBound` on each
  account's own `Believable / total` share), descending.
- The `kind: "original"` account (the museum's own seeded record) is always
  pinned first regardless of score, so a heavily-corroborated rebuttal can
  never bury the thing it's rebutting — this mirrors the existing rule that
  an account can challenge another but never erase it.
- An account with **zero votes** gets a sentinel score of `-1` (not `0`),
  so it ranks behind every voted account rather than tying with a unanimous
  "everyone thinks this is false" account that would otherwise also score
  near 0.
- Ties (most often several zero-vote accounts) break chronologically,
  oldest first — the same order they'd render in without this sort, so a
  tie never looks arbitrary.
- This sort is **display-only**. `exhibit.accounts` itself is never
  reordered; `renderDossier`'s "default challenge target = most recently
  published account" (`public/app.js`) deliberately keeps reading the raw,
  server-chronological array, because "what did I just read" and "what does
  the room trust most" are different questions and must not be allowed to
  silently swap answers depending on how votes happen to land.
- This is explicitly a **separate rule** from exhibit-level classification
  (`classifyExhibit` in `server/src/db.js`): the exhibit's overall verdict
  is still "the verdict of whichever single account has the most total
  votes, or Disputed on a tie" — an unrelated, already-shipped invariant
  that this ADR does not change. `CLAUDE.md` calls out the distinction
  explicitly so the two are never conflated in future work.

## Consequences

### Benefits

- A dossier now visually leads with the account the room has the strongest
  evidence for, not merely the most recently or most heavily argued-over
  one.
- No magic weight constants to justify or re-tune later — the formula's
  only input is each account's own vote counts.
- Implemented as pure functions (`public/account-ranking.js`) with no
  server round-trip: `wilsonLowerBound`, `trustScore`, and
  `sortAccountsForDisplay` are independently unit-tested
  (`spec/account-ranking.test.ts`) without needing a running app.

### Accepted costs

- The Wilson score formula is less immediately legible to a future reader
  than a raw ratio or vote count — this ADR exists specifically so "why
  this formula and not a simpler one" has a durable answer instead of
  living only in a code comment.
- A visitor cannot currently see *why* an account ranks where it does
  (no exposed numeric score in the UI) — only the ordering itself and the
  raw vote tally underneath each account. Acceptable for now since the
  product goal is "show me the most-trusted account first," not "teach me
  statistics," but a future surfaced score/tooltip would be a reasonable
  follow-up.

## Verification

`spec/account-ranking.test.ts` checks, without a running server:

- broad corroboration (18 Believable / 2 Suspicious / 1 Cursed) outranks a
  single lonely Believable vote;
- the original account stays first regardless of score, with the remaining
  accounts trust-sorted around it, matching a hand-worked expected order
  across unvoted, thin, contested, and well-corroborated accounts in one
  list.

`spec/community-seeds.test.ts` additionally confirms the seeded demo data
(`seedCommunityAccounts()`) actually produces every verdict shape this
ranking needs to be meaningful on first launch — Believable, Suspicious,
Definitely Cursed, Disputed, and Unclassified accounts all exist on at
least one seeded exhibit, including both a "lonely positive" and a
"heavily corroborated" account side by side.
