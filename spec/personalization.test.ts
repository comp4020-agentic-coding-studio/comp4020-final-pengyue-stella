// Our own checks for donation personalization: recolor (a fixed swatch
// vocabulary), the relic customiser's placed overlay stickers (a fixed
// local-PNG catalog, freely combinable on any preset), and a freehand paint
// layer (size-capped). Against the running app.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

type Surface = {
  id: string;
  surfaceType: string;
  allowedRelicTypes: string[];
  shape: { type: string; points?: [number, number][]; cx?: number; cy?: number; rx?: number; ry?: number };
};

// A comfortable normalized-u/v separation threshold for this file's own
// candidate-point search — matches the discipline of every other spec
// file's own MIN_SURFACE_SEPARATION constant (server/src/db.js enforces
// 0.22 on a named surface; the freeform region's own pixel-based threshold
// is comfortably covered by picking points this far apart in u/v too).
const CANDIDATE_POINT_SEPARATION = 0.25;

async function freeSpotFor(galleryId: string, surfaceType: string, offset = 0) {
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
  for (let i = offset; i < 5; i++) {
    const u = [0.15, 0.35, 0.55, 0.75, 0.9][i];
    for (const v of [0.2, 0.5, 0.8]) {
      const clear = taken.every(
        (e: { placement: { u: number; v: number } }) =>
          Math.hypot(e.placement.u - u, e.placement.v - v) >= CANDIDATE_POINT_SEPARATION,
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

describe("recolor (tint)", () => {
  it("persists a valid tint swatch and echoes it back", async () => {
    const { tints } = await (await fetch(url("/api/relic-tints"))).json();
    expect(Array.isArray(tints)).toBe(true);
    const swatch = tints.find((t: { hex: string | null }) => t.hex);
    expect(swatch).toBeTruthy();

    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "freeform", attempt);
      res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        subtype: "spoon",
        title: `tint test ${Date.now()}-${attempt}`,
        originClaim: "x",
        donorName: "Spec Visitor",
        visualId: "tarnished-silver-spoon",
        tintColor: swatch.hex,
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    expect(exhibit.tintColor).toBe(swatch.hex);

    const { exhibit: fetched } = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(fetched.tintColor).toBe(swatch.hex);
  });

  it("defaults tintColor to null when omitted", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "freeform", 1);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "key",
      title: `no tint ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "key-that-opens-nothing",
    });
    expect(res.status).toBe(201);
    const { exhibit } = await res.json();
    expect(exhibit.tintColor).toBeNull();
  });

  it("rejects a tint that isn't one of the available swatches", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "freeform", 2);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "clock",
      title: `bad tint ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "clock-that-keeps-no-hour",
      tintColor: "#123456",
    });
    expect(res.status).toBe(400);
  });
});

describe("relic customiser overlays", () => {
  it("serves the Gothic overlay catalog as local transparent PNG stickers", async () => {
    const res = await fetch(url("/api/relic-overlays"));
    expect(res.status).toBe(200);
    const { overlays } = await res.json();
    expect(Array.isArray(overlays)).toBe(true);
    expect(overlays.map((overlay: { id: string }) => overlay.id)).toEqual(
      expect.arrayContaining([
        "wax-seal",
        "number-tag",
        "antique-label",
        "ribbon",
        "crack",
        "cobweb",
        "glowing-rune",
        "eye-symbol",
        "dried-flower",
        "tiny-key",
        "dust-scratches",
      ]),
    );
    for (const overlay of overlays) {
      expect(typeof overlay.id).toBe("string");
      expect(typeof overlay.name).toBe("string");
      expect(overlay.assetPath).toMatch(/^\/assets\/overlays\/.+\.png$/);
      const assetRes = await fetch(url(overlay.assetPath));
      expect(assetRes.status, `${overlay.assetPath} should be served`).toBe(200);
    }
  });

  it("accepts valid placed overlays on ANY preset (no figural-only gate) and echoes them back", async () => {
    const { overlays } = await (await fetch(url("/api/relic-overlays"))).json();
    const [sealId, labelId] = overlays.map((o: { id: string }) => o.id);

    let res: Response | undefined;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "freeform", attempt);
      res = await donate({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        subtype: "spoon",
        title: `overlay test ${Date.now()}-${attempt}`,
        originClaim: "x",
        donorName: "Spec Visitor",
        visualId: "tarnished-silver-spoon",
        overlayItems: [
          { assetId: sealId, x: 0.3, y: 0.4, scale: 1.2, rotation: 15, zIndex: 0 },
          { assetId: labelId, x: 0.7, y: 0.6, scale: 0.8, rotation: 340, zIndex: 1 },
        ],
      });
      lastStatus = res.status;
      if (res.status !== 409) break;
    }
    expect(lastStatus).toBe(201);
    const { exhibit } = await res!.json();
    expect(exhibit.overlayItems).toHaveLength(2);
    expect(exhibit.overlayItems[0]).toMatchObject({ assetId: sealId, x: 0.3, y: 0.4, scale: 1.2, rotation: 15 });

    const { exhibit: fetched } = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(fetched.overlayItems).toHaveLength(2);
  });

  it("defaults overlayItems to an empty array when omitted", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("specimen", "freeform", 4);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "botanical",
      title: `no overlays ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "impossible-botanical-jar",
    });
    expect(res.status).toBe(201);
    const { exhibit } = await res.json();
    expect(exhibit.overlayItems).toEqual([]);
  });

  it("rejects an unknown overlay asset id", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("portraits", "wall", 0);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "painting",
      title: `unknown overlay ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "cursed-gilt-portrait",
      overlayItems: [{ assetId: "not-a-real-overlay", x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 0 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects an overlay item with an out-of-range scale or coordinate", async () => {
    const { overlays } = await (await fetch(url("/api/relic-overlays"))).json();
    const overlayId = overlays[0].id;

    const { gallery, slot, surface, u, v } = await freeSpotFor("portraits", "wall", 1);
    const badScaleRes = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "sketch",
      title: `bad scale overlay ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "unfinished-charcoal-study",
      overlayItems: [{ assetId: overlayId, x: 0.5, y: 0.5, scale: 99, rotation: 0, zIndex: 0 }],
    });
    expect(badScaleRes.status).toBe(400);

    const { gallery: g2, slot: s2, surface: sf2, u: u2, v: v2 } = await freeSpotFor("portraits", "wall", 2);
    const badCoordRes = await donate({
      galleryId: g2.id,
      slotId: s2.id,
      surfaceId: sf2.id,
      u: u2,
      v: v2,
      subtype: "sketch",
      title: `bad coord overlay ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "unfinished-charcoal-study",
      overlayItems: [{ assetId: overlayId, x: 50, y: 0.5, scale: 1, rotation: 0, zIndex: 0 }],
    });
    expect(badCoordRes.status).toBe(400);
  });
});

describe("freehand paint layer", () => {
  // A minimal valid 1x1 transparent PNG, well under the server's cap.
  const TINY_PNG_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("accepts a small valid PNG data URL and echoes it back", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("memento", "freeform", 4);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "spoon",
      title: `paint test ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "tarnished-silver-spoon",
      paintLayer: TINY_PNG_DATA_URL,
    });
    expect(res.status).toBe(201);
    const { exhibit } = await res.json();
    expect(exhibit.paintLayer).toBe(TINY_PNG_DATA_URL);
  });

  it("defaults paintLayer to null when omitted", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("specimen", "freeform", 2);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "botanical",
      title: `no paint ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "impossible-botanical-jar",
    });
    expect(res.status).toBe(201);
    const { exhibit } = await res.json();
    expect(exhibit.paintLayer).toBeNull();
  });

  it("rejects a malformed paint layer (wrong data URL prefix)", async () => {
    const { gallery, slot, surface, u, v } = await freeSpotFor("specimen", "freeform", 3);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "botanical",
      title: `malformed paint ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "impossible-botanical-jar",
      paintLayer: "data:text/plain;base64,aGVsbG8=",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a paint layer over the server's own byte cap", async () => {
    // Comfortably over PAINT_LAYER_MAX_BYTES (150KB decoded) — a repeated
    // base64 alphabet string of this length decodes to well over the cap.
    const oversizedBase64 = "A".repeat(220 * 1024);
    const { gallery, slot, surface, u, v } = await freeSpotFor("childhood", "freeform", 4);
    const res = await donate({
      galleryId: gallery.id,
      slotId: slot.id,
      surfaceId: surface.id,
      u,
      v,
      subtype: "book",
      title: `oversized paint ${Date.now()}`,
      originClaim: "x",
      donorName: "Spec Visitor",
      visualId: "locked-nursery-diary",
      paintLayer: `data:image/png;base64,${oversizedBase64}`,
    });
    expect(res.status).toBe(400);
  });
});
