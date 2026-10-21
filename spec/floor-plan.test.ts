// Checks for the data contract behind the architectural floor plan
// (public/world/floor-plan.js): the client's room-rect layout is a static
// mapping keyed on the gallery ids `/api/world` reports — this guards that
// mapping against drifting out of sync (a renamed/added/removed gallery
// should fail this test loudly, not silently vanish from the drawn plan).
// Visitor-marker and donated-relic-marker rendering are pure client-side
// derivations of data spec/map.test.ts and spec/presence-ghosts.test.ts
// already cover server-side (scene-presence counts/rosters, exhibit
// galleryId grouping) — no new server contract is needed for those, so
// this file doesn't duplicate that coverage.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

// Must match public/world/floor-plan.js's own ROOMS keys exactly.
const EXPECTED_ROOM_IDS = ["hall", "portraits", "memento", "specimen", "childhood"];

describe("architectural floor plan data contract", () => {
  it("/api/world's galleries are exactly the stable ids the floor plan's room-rect layout hardcodes", async () => {
    const { galleries, defaultSceneId } = await (await fetch(url("/api/world"))).json();
    expect(defaultSceneId).toBe("hall");
    const ids = galleries.map((g: { id: string }) => g.id).sort();
    const expectedGalleryIds = EXPECTED_ROOM_IDS.filter((id) => id !== "hall").sort();
    expect(ids).toEqual(expectedGalleryIds);
  });

  it("a hall-owned builtin exhibit's galleryId is 'hall'; a gallery-owned one is a real gallery id", async () => {
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const builtin = exhibits.filter((e: { origin: string }) => e.origin === "builtin");
    expect(builtin.length).toBeGreaterThan(0);

    const { galleries } = await (await fetch(url("/api/world"))).json();
    const galleryIds = new Set(galleries.map((g: { id: string }) => g.id));

    const hallOwned = builtin.filter((e: { galleryId: string }) => e.galleryId === "hall");
    const galleryOwned = builtin.filter((e: { galleryId: string }) => e.galleryId !== "hall");
    expect(hallOwned.length).toBeGreaterThan(0);
    expect(galleryOwned.length).toBeGreaterThan(0);
    for (const exhibit of galleryOwned) {
      expect(galleryIds.has(exhibit.galleryId), `builtin exhibit ${exhibit.id} has an unknown galleryId`).toBe(true);
    }
  });

  it("a donated/founding relic marker excludes builtin exhibits — the floor plan's relic count is donor+founding pieces only", async () => {
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const relicMarkerCandidates = exhibits.filter((e: { origin: string }) => e.origin !== "builtin");
    expect(relicMarkerCandidates.length).toBeGreaterThan(0);
    for (const exhibit of relicMarkerCandidates) {
      expect(["donated", "founding"]).toContain(exhibit.origin);
    }
  });
});
