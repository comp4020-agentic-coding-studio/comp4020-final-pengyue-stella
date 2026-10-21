// Checks for the legacy-visual backfill (server/src/db.js's
// backfillLegacyVisualIds): every exhibit donated/seeded before the curated
// relic-preset catalog existed gets a category-matched visual assigned at
// startup, flagged as `visualIdBackfilled` so the dossier can disclose it's
// an archival stand-in rather than the donor's own choice — never a
// primitive procedural model left rendering in a visible gallery. A
// built-in museum object (origin: "builtin") is excluded: it renders via
// its own world-object shape, never a relic image, so it keeps visualId
// null and visualIdBackfilled false forever.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

describe("legacy visual backfill", () => {
  // The backfill only ever runs once, at server startup, against whatever
  // exhibits existed at that moment — a freshly donated exhibit AFTER
  // startup that explicitly skips the preset picker legitimately keeps
  // visualId null forever (that's the "Classic"/no-curated-image path,
  // covered by spec/relic-presets.test.ts's own "no visual at all" case),
  // so this only asserts the backfill reached every exhibit that predates
  // it — the Founding Collection seed, identified by its own fixed id
  // pattern, same anchor spec/relic-presets.test.ts already uses.
  it("every exhibit present at startup (the Founding Collection) has a non-null visualId after the backfill", async () => {
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const seededAtStartup = exhibits.filter((e: { id: string }) => e.id.startsWith("exhibit_founding_"));
    expect(seededAtStartup.length).toBeGreaterThan(0);
    for (const exhibit of seededAtStartup) {
      expect(exhibit.visualId, `exhibit ${exhibit.id} should have a non-null visualId`).not.toBeNull();
    }
  });

  it("flags a backfilled (pre-existing) exhibit's visual as backfilled, never claiming it was the donor's own choice", async () => {
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const founding = exhibits.find((e: { id: string }) => e.id.startsWith("exhibit_founding_"));
    expect(founding).toBeTruthy();
    expect(founding.visualIdBackfilled).toBe(true);
  });

  it("a builtin museum object never gets a backfilled visual — it renders via its own world-object shape", async () => {
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const builtin = exhibits.find((e: { origin: string }) => e.origin === "builtin");
    expect(builtin).toBeTruthy();
    expect(builtin.visualId).toBeNull();
    expect(builtin.visualIdBackfilled).toBe(false);
  });

  it("a freshly donated exhibit with an explicitly chosen preset is NOT flagged as backfilled", async () => {
    const MIN_SURFACE_SEPARATION = 0.22;
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();

    const preset = presets[0];
    const gallery = galleries.find((g: { category: string }) => g.category === preset.category);

    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
      const occupiedSlots = new Set(exhibits.map((e: { slotId: string }) => e.slotId));
      const slot = gallery.slots.find((s: { id: string }) => !occupiedSlots.has(s.id));
      expect(slot, "expected a free slot for the backfill-flag test").toBeTruthy();
      const surface = gallery.placementSurfaces.find((s: { surfaceType: string }) =>
        preset.compatibleSurfaceTypes.includes(s.surfaceType),
      );
      const taken = exhibits.filter(
        (e: { galleryId: string; placement?: { surfaceId: string } }) =>
          e.galleryId === gallery.id && e.placement?.surfaceId === surface.id,
      );
      let point: { u: number; v: number } | null = null;
      for (const u of [0.15, 0.35, 0.55, 0.75, 0.9]) {
        for (const v of [0.2, 0.5, 0.8]) {
          const clear = taken.every(
            (e: { placement: { u: number; v: number } }) => Math.hypot(e.placement.u - u, e.placement.v - v) >= MIN_SURFACE_SEPARATION,
          );
          if (clear) {
            point = { u, v };
            break;
          }
        }
        if (point) break;
      }
      expect(point, "expected a free surface point for the backfill-flag test").toBeTruthy();

      res = await fetch(url("/api/exhibits"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          galleryId: gallery.id,
          slotId: slot.id,
          surfaceId: surface.id,
          u: point!.u,
          v: point!.v,
          subtype: preset.subtype,
          title: `backfill-flag test ${Date.now()}-${attempt}`,
          originClaim: "x",
          donorName: "Spec Visitor",
          visualId: preset.id,
        }),
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    expect(exhibit.visualIdBackfilled).toBe(false);
  });
});
