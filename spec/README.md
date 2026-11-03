# The spec

The [final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/)
and its spec are on the course website, along with the specs for crits 8, 9 and
10, which run in this repo. The brief poses the problem; the spec is the fixed
contract.

## What these checks protect

The project's definition of good is a **participatory, living museum**:
visitors discover objects, encounter competing interpretations, and leave
durable contributions for later visitors. The app is not good merely because
its endpoints respond or its Gothic artwork renders. These specs protect the
mechanical invariants that make that experience trustworthy:

- accounts can challenge one another without erasing prior accounts;
- votes, donations, ownership changes, and free placements are durable and
  broadcast only after their database transaction commits;
- named ghost presence and Séance interactions are visible only to the right
  logical room and never expose a visitor's raw identity;
- built-in and visitor-donated objects use the same dossier model;
- illustrated-object shapes, bounded camera movement, accessible controls,
  and compatible placement surfaces preserve the authored museum experience.

Tests can prove these contracts hold. Human walkthroughs still decide whether
the resulting participation, atmosphere, and discovery are actually good.

## What ships

`invariants.test.ts` checks the two things the course relies on:

- `/` answers with a 200, which is what the deploy and the crit capture read
- `/readme/` publishes `README.md`. Markdown renderers all differ slightly, so
  it checks the README's headings rather than every word: each one has to
  appear, in order, in the HTML the server sends, since no script runs. Render
  it however you like, as long as it's there in full; the marker reads it there.

Both run against the **running** app over HTTP, so they hold whatever it's built
with. In CI that app is the image your `Dockerfile` builds, started with a
throwaway `/data`, and a red run blocks the deploy. Locally, start the app
however you run it and `pnpm check` finds it at `APP_URL` (default
`http://localhost:8080`). Keep them; don't delete them.

## Your checks

Everything else in `spec/` is yours to write. Any `spec/*.test.ts` runs with
`pnpm check`, against the same running app. Some lines of a spec only a person
can judge; those are left to the crit and the marker.

At a crit, a green `check` job is half the shipped mark, but it's never the
judgement of the work: your tutor checks what you deployed against the published
spec.
