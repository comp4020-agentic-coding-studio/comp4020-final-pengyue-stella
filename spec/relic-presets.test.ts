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

  // A preset is now REQUIRED for a NEW donation (CLAUDE.md-aligned brief:
  // "making a preset REQUIRED for new donations") — the old "Classic"
  // no-image fallback is retired as a visitor-facing choice. A donation
  // that omits visualId entirely must now be rejected outright, never
  // silently accepted with visualId null the way it used to be (that
  // behaviour is kept only for exhibits that already existed before this
  // requirement shipped — see spec/legacy-visual-backfill.test.ts).
  it("rejects a donation with no visualId at all — a preset is now required", async () => {
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
      // A 400 (visual_required) is the expected outcome everywhere except a
      // genuine slot/surface race (409), which this retries past exactly
      // like every other test in this file.
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(400);
    const body = await res!.json();
    expect(typeof body.error).toBe("string");
  });

  it("rejects a donation with visualId explicitly null, same as omitting it", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("portraits", "wall");
    const res = await donate({
      galleryId: gallery?.id,
      slotId: slot?.id,
      surfaceId: surface?.id,
      u,
      v,
      subtype: surface?.allowedRelicTypes?.[0],
      title: "explicit null visual",
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: null,
    });
    expect(res.status).toBe(400);
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

  // Each curated preset must still donate successfully into its own
  // category-matched gallery — looping all of them (not just one
  // hard-coded "memento" case) proves the server's own donation validation
  // isn't accidentally restricted to a single category the way the old
  // CLIENT-side picker bug was. This always uses the gallery's freeform
  // region (never a named legacy surface, whose own small, fixed set of
  // surface types some of the newer subtypes — e.g. "sketch", "biological",
  // "book" — were never traced for) and spreads each retry attempt's u/v by
  // a comfortable margin, since this now exercises every one of a
  // category's presets (up to 6, for memento) against that one gallery's
  // small fixed slot pool, concurrently with every other spec file's own
  // donations into the same shared database.
  it("accepts a donation using each curated preset's own declared category/subtype/surface combo", async () => {
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    const candidateOffsets: [number, number][] = [
      [0, 0],
      [-300, -180],
      [300, -180],
      [-300, 180],
      [300, 180],
      [-600, 0],
      [600, 0],
      [0, -300],
      [0, 300],
    ];
    for (const preset of presets) {
      const { galleries } = await (await fetch(url("/api/world"))).json();
      const gallery = galleries.find((g: { category: string }) => g.category === preset.category);
      expect(gallery, `no gallery for preset category ${preset.category}`).toBeTruthy();

      let res: Response | undefined;
      let lastStatus = 0;
      for (let attempt = 0; attempt < candidateOffsets.length; attempt++) {
        const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
        const occupied = new Set(exhibits.map((e: { slotId: string }) => e.slotId));
        const slot = gallery.slots.find((s: { id: string }) => !occupied.has(s.id));
        expect(slot, `no free slot in ${gallery.id}`).toBeTruthy();
        const freeform = gallery.placementSurfaces.find((s: Surface) => s.surfaceType === "freeform");
        // Offset by attempt so a retry after a 409 lands on a different
        // point, comfortably clear of MIN_FREE_PLACEMENT_PIXEL_SEPARATION
        // (110px, server/src/db.js) and of other spec files' own concurrent
        // donations into this same freeform region.
        const centroid = centroidOf(freeform.shape);
        const [dx, dy] = candidateOffsets[attempt];
        const { u, v } = uvFromPoint(freeform.shape, centroid.x + dx, centroid.y + dy);
        res = await donate({
          galleryId: gallery.id,
          slotId: slot.id,
          surfaceId: freeform.id,
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
      const ownerCookie = res!.headers.get("set-cookie")?.split(";")[0];
      expect(ownerCookie, `preset ${preset.id} donation should mint an owner cookie`).toBeTruthy();
      const { exhibit } = await res!.json();
      expect(exhibit.visualId).toBe(preset.id);

      // The exact preset must round-trip through both read paths a real
      // visitor uses: a single exhibit fetch and a full archive reload
      // (CLAUDE.md-aligned brief: "survives... a page reload").
      const { exhibit: fetchedOne } = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
      expect(fetchedOne.visualId).toBe(preset.id);

      const { exhibits: fetchedAll } = await (await fetch(url("/api/exhibits"))).json();
      const fetchedFromList = fetchedAll.find((e: { id: string }) => e.id === exhibit.id);
      expect(fetchedFromList, `donated exhibit ${exhibit.id} should appear in a full /api/exhibits reload`).toBeTruthy();
      expect(fetchedFromList.visualId).toBe(preset.id);

      // This catalog-wide test runs beside every other spec file against
      // one shared live database. Withdraw each verified exhibit before
      // moving to the next preset so expanding the catalog does not consume
      // the gallery's finite slot/placement pool and starve unrelated tests.
      const withdrawn = await fetch(url(`/api/exhibits/${exhibit.id}`), {
        method: "DELETE",
        headers: { Cookie: ownerCookie! },
      });
      expect(withdrawn.status).toBe(200);
    }
  });
});

describe("donor-controlled scale and rotation", () => {
  it("persists a non-default scale and rotation and echoes both back on read", async () => {
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    const preset = presets.find((p: { id: string }) => p.id === "tarnished-silver-spoon");

    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "tabletop");
      res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        scale: 0.8,
        rotation: 45,
        subtype: preset.subtype,
        title: `rotation test ${Date.now()}-${attempt}`,
        originClaim: "x",
        donorName: "Spec Visitor",
        visualId: preset.id,
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    expect(exhibit.placement.scale).toBeCloseTo(0.8);
    expect(exhibit.placement.rotation).toBe(45);

    const { exhibit: fetched } = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(fetched.placement.rotation).toBe(45);
  });

  it("defaults rotation to 0 when omitted", async () => {
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    const preset = presets.find((p: { category: string }) => p.category === "specimen");

    // Same retry-on-409 loop as the test above: freeSpotFor's own read
    // (what's occupied) and this donation's write race against whatever
    // else is concurrently donating into the same gallery/surface across
    // other test files running in parallel, so a single candidate spot can
    // already be taken by the time the POST lands.
    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("specimen", "plinth");
      res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        subtype: preset.subtype,
        title: `no rotation ${Date.now()}-${attempt}`,
        originClaim: "x",
        donorName: "Spec Visitor",
        visualId: preset.id,
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    expect(exhibit.placement.rotation).toBe(0);
  });

  // A non-numeric rotation is silently treated as "omitted" (same
  // leniency `scale` already has at the server.js parsing layer — only a
  // genuine out-of-range NUMBER reaches db.js's own rejection), so only
  // actual numeric out-of-range values are expected to 400 here.
  it("rejects an out-of-range numeric rotation", async () => {
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    const preset = presets.find((p: { category: string }) => p.category === "toy");
    for (const rotation of [360, -1]) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("childhood", "tabletop");
      const res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        rotation,
        subtype: preset.subtype,
        title: `bad rotation ${rotation}`,
        originClaim: "x",
        donorName: "Spec Visitor",
        visualId: preset.id,
      });
      expect(res.status, `rotation ${rotation} should be rejected`).toBe(400);
    }
  });
});

describe("any-room placement", () => {
  // A toy-category preset (the doll), placed via a DIFFERENT gallery's own
  // freeform region (portraits, a portrait-category room) with a matching
  // subtype — this is the real regression guard for "place in any room":
  // the gallery's own category must no longer gate what can be donated
  // into it, only the preset's own subtype/surface compatibility matters.
  it("accepts a preset whose own category differs from the destination gallery's, given a matching subtype", async () => {
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    const doll = presets.find((p: { id: string }) => p.id === "burgundy-porcelain-doll");
    expect(doll.category).toBe("toy");

    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("portraits", "freeform");
      res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        subtype: doll.subtype,
        title: `any-room test ${Date.now()}-${attempt}`,
        originClaim: "x",
        donorName: "Spec Visitor",
        visualId: doll.id,
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    // `category` on the persisted exhibit is the PRESET's own category
    // (what the object is), never the gallery's — the gallery it actually
    // sits in is `galleryId`, already separate.
    expect(exhibit.category).toBe("toy");
    expect(exhibit.galleryId).toBe("portraits");
  });

  it("every gallery's freeform region now lists every real subtype, not just its own category's", async () => {
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const { presets } = await (await fetch(url("/api/relic-presets"))).json();
    const everySubtype = new Set(presets.map((p: { subtype: string }) => p.subtype));
    for (const gallery of galleries) {
      const freeform = gallery.placementSurfaces.find((s: Surface) => s.surfaceType === "freeform");
      for (const subtype of everySubtype) {
        expect(
          freeform.allowedRelicTypes.includes(subtype),
          `${gallery.id}'s freeform region should allow subtype ${subtype}`,
        ).toBe(true);
      }
    }
  });
});
