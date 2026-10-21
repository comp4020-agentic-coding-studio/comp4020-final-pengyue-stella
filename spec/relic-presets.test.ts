// Our own checks for the curated donated-relic visual catalog (see
// server/src/relic-presets.js): the catalog is served as a small, fixed
// list; a donation can claim a compatible preset and have it persisted and
// echoed back over both the REST read path and (indirectly, since it's the
// same exhibit payload) the SSE broadcast; an incompatible or unknown preset
// is rejected server-side; and an exhibit donated with no visualId at all
// (every legacy exhibit, and any donor who skips the picker) still has a
// real, readable record — never a crash from a null visualId.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

type Surface = {
  id: string;
  surfaceType: string;
  allowedRelicTypes: string[];
  shape: { type: string; points?: [number, number][]; cx?: number; cy?: number; rx?: number; ry?: number };
};

const MIN_SURFACE_SEPARATION = 0.22;

function centroidOf(shape: Surface["shape"]): { x: number; y: number } {
  if (shape.type === "ellipse") return { x: shape.cx!, y: shape.cy! };
  const xs = shape.points!.map((p) => p[0]);
  const ys = shape.points!.map((p) => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function uvFromPoint(shape: Surface["shape"], x: number, y: number): { u: number; v: number } {
  let minX: number, maxX: number, minY: number, maxY: number;
  if (shape.type === "ellipse") {
    minX = shape.cx! - shape.rx!;
    maxX = shape.cx! + shape.rx!;
    minY = shape.cy! - shape.ry!;
    maxY = shape.cy! + shape.ry!;
  } else {
    const xs = shape.points!.map((p) => p[0]);
    const ys = shape.points!.map((p) => p[1]);
    minX = Math.min(...xs);
    maxX = Math.max(...xs);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
  }
  return { u: (x - minX) / (maxX - minX), v: (y - minY) / (maxY - minY) };
}

async function freeSpotFor(galleryId: string, surfaceType: string) {
  const { galleries } = await (await fetch(url("/api/world"))).json();
  const gallery = galleries.find((g: { id: string }) => g.id === galleryId);
  const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
  const occupiedSlots = new Set(exhibits.map((e: { slotId: string }) => e.slotId));
  const slot = gallery.slots.find((s: { id: string }) => !occupiedSlots.has(s.id));
  const surface = gallery.placementSurfaces.find((s: Surface) => s.surfaceType === surfaceType);
  const taken = exhibits.filter(
    (e: { galleryId: string; placement?: { surfaceId: string } }) =>
      e.galleryId === galleryId && e.placement?.surfaceId === surface.id,
  );
  for (const u of [0.15, 0.35, 0.55, 0.75, 0.9]) {
    for (const v of [0.2, 0.5, 0.8]) {
      const clear = taken.every(
        (e: { placement: { u: number; v: number } }) => Math.hypot(e.placement.u - u, e.placement.v - v) >= MIN_SURFACE_SEPARATION,
      );
      if (clear) return { gallery, slot, surface, u, v };
    }
  }
  throw new Error(`no free spot on a ${surfaceType} surface in ${galleryId}`);
}

async function donate(body: Record<string, unknown>) {
  return fetch(url("/api/exhibits"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the curated donated-relic visual catalog", () => {
  it("serves a small, fixed list of real presets, each with a real asset path and aspect-ratio dimensions", async () => {
    const res = await fetch(url("/api/relic-presets"));
    expect(res.status).toBe(200);
    const { presets } = await res.json();
    expect(Array.isArray(presets)).toBe(true);
    expect(presets.length).toBeGreaterThanOrEqual(4);
    for (const preset of presets) {
      expect(typeof preset.id).toBe("string");
      expect(typeof preset.name).toBe("string");
      expect(typeof preset.category).toBe("string");
      expect(typeof preset.subtype).toBe("string");
      expect(Array.isArray(preset.compatibleSurfaceTypes)).toBe(true);
      expect(preset.compatibleSurfaceTypes.length).toBeGreaterThan(0);
      expect(preset.assetPath).toMatch(/^\/assets\/donated-relics\//);
      expect(preset.naturalWidth).toBeGreaterThan(0);
      expect(preset.naturalHeight).toBeGreaterThan(0);
      expect(["wall", "resting"]).toContain(preset.anchor);

      // The asset itself is actually served, not just referenced.
      const assetRes = await fetch(url(preset.assetPath));
      expect(assetRes.status, `${preset.assetPath} should be served`).toBe(200);
    }
  });

  it("accepts a donation with a compatible preset, persisting and echoing back its visualId", async () => {
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    // "memento" is never used as the fixed target gallery by any other spec
    // file's own hard-coded single-gallery test (world.test.ts targets
    // portraits/memento/specimen/childhood once each across its OWN five
    // surface tests, archive.test.ts's freeSlot() scans every gallery) — picking
    // a category most other files don't repeatedly hammer keeps this test's
    // own slot search cheap without relying on a retry loop for the common case.
    const preset = presets.find((p: { category: string }) => p.category === "memento");

    // Other spec files still donate concurrently (vitest runs spec files in
    // parallel by default) — a slot/surface spot that looked free a moment
    // ago can legitimately be taken by the time this request lands, exactly
    // the race server/src/db.js's own 409 handling exists for. Retry against
    // a freshly re-queried free spot rather than treating that race as a
    // real failure.
    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "cabinet");
      res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        subtype: preset.subtype,
        title: `visual-preset test ${Date.now()}-${attempt}`,
        originClaim: "x",
        donorName: "Spec Visitor",
        visualId: preset.id,
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    expect(exhibit.visualId).toBe(preset.id);

    const { exhibit: fetched } = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(fetched.visualId).toBe(preset.id);
  });

  it("rejects a preset that doesn't match the donation's own category/subtype/surface, even though it's a real preset elsewhere", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("childhood", "shelf");
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: surface.allowedRelicTypes[0],
      title: "mismatched visual",
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "cursed-gilt-portrait",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown visualId outright", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "shelf");
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: surface.allowedRelicTypes[0],
      title: "unknown visual",
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "not-a-real-preset",
    });
    expect(res.status).toBe(400);
  });

  it("donating with no visualId at all still succeeds, with visualId null in the response (the legacy-fallback path)", async () => {
    // Other spec files donate concurrently into the same small fixed slot
    // pool — retry against a freshly re-queried free spot on a 409, same
    // discipline the preset-donation test above already applies.
    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("specimen", "shelf");
      res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        subtype: surface.allowedRelicTypes[0],
        title: `no visual at all ${Date.now()}-${attempt}`,
        originClaim: "x",
        donorName: "Spec Visitor",
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    expect(exhibit.visualId).toBeNull();
  });

  // A seeded Founding Collection exhibit predates the preset catalog the
  // same way a legacy donation would, so the startup backfill
  // (server/src/db.js's backfillLegacyVisualIds) assigns it a category-
  // matched curated visual rather than leaving it null forever — flagged
  // explicitly as `visualIdBackfilled` so the dossier can disclose it's an
  // archival stand-in, not the donor's own choice.
  it("a pre-existing (seeded Founding Collection) exhibit gets a backfilled visualId, flagged as such", async () => {
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const founding = exhibits.find((e: { id: string }) => e.id.startsWith("exhibit_founding_"));
    expect(founding).toBeTruthy();
    expect(founding.visualId).toBeTypeOf("string");
    expect(founding.visualIdBackfilled).toBe(true);
  });

  // Each of the 4 curated presets maps to exactly one category/gallery —
  // looping all of them (not just one hard-coded "memento" case) proves the
  // server's own donation validation isn't accidentally restricted to a
  // single category the way the old CLIENT-side picker bug was.
  it("accepts a donation using any of the four presets' own declared category/subtype/surface combo", async () => {
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    for (const preset of presets) {
      const galleries = (await (await fetch(url("/api/world"))).json()).galleries;
      const gallery = galleries.find((g: { category: string }) => g.category === preset.category);
      expect(gallery, `no gallery for preset category ${preset.category}`).toBeTruthy();
      const surfaceType = preset.compatibleSurfaceTypes[0];

      let res: Response | undefined;
      let lastStatus = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { gallery: g, slot, surface, u, v } = await freeSpotFor(gallery.id, surfaceType);
        res = await donate({
          galleryId: g.id,
          slotId: slot.id,
          surfaceId: surface.id,
          u,
          v,
          subtype: preset.subtype,
          title: `all-presets test ${preset.id} ${Date.now()}-${attempt}`,
          originClaim: "x",
          donorName: "Spec Visitor",
          visualId: preset.id,
        });
        lastStatus = res.status;
        if (res.status !== 409) break;
      }
      expect(lastStatus, `preset ${preset.id} should donate successfully`).toBe(201);
      const { exhibit } = await res!.json();
      expect(exhibit.visualId).toBe(preset.id);
    }
  });
});
