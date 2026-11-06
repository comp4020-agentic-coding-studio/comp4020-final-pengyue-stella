import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the SAME running app and its one shared
// database, which spec/global-setup.ts finds. Only spec/ runs: a test
// anywhere else needs adding to `include`.
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    // Several spec files independently donate into the same gallery's same
    // placement surface (e.g. portraits' one "wall"-type surface, hit by
    // world.test.ts, relic-presets.test.ts, and personalization.test.ts
    // alike), picking a spot by reading what's currently occupied and then
    // writing to it. Running files in parallel turns that read-then-write
    // into a real race across files, not just within one — a spot one file
    // just read as free can already be taken by the time its own write
    // lands, by a completely different file's donation. Some individual
    // tests retry once a collision happens; others, like a fixed-offset
    // placement test, don't and can't (there's nothing to retry toward).
    // Serializing file execution removes the race at its root instead of
    // chasing down every place it can surface.
    fileParallelism: false,
  },
});
