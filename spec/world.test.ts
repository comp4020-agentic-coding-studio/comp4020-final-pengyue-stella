// Our own checks, alongside the course's invariants.test.ts (see
// spec/README.md for the split). These assert the museum's actual shape —
// four galleries each with slots, a fixed graph of scenes each reachable —
// against the running app, not against how it happens to be implemented.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

describe("the museum world", () => {
  it("has exactly four galleries, each with at least one display slot", async () => {
    const res = await fetch(url("/api/world"));
    expect(res.status).toBe(200);
    const { galleries } = await res.json();

    expect(Array.isArray(galleries)).toBe(true);
    expect(galleries.length).toBe(4);

    for (const gallery of galleries) {
      expect(typeof gallery.id).toBe("string");
      expect(typeof gallery.name).toBe("string");
      expect(Array.isArray(gallery.slots), `${gallery.id} has no slots`).toBe(true);
      expect(gallery.slots.length, `${gallery.id} has no slots`).toBeGreaterThan(0);
      for (const slot of gallery.slots) {
        expect(typeof slot.id).toBe("string");
        expect(typeof slot.x).toBe("number");
        expect(typeof slot.z).toBe("number");
      }
    }
  });

  it("gives two different visitors different names, and remembers one across requests", async () => {
    const a = await (await fetch(url("/api/me"))).json();
    const b = await (await fetch(url("/api/me"))).json();
    expect(a.name).not.toBe(b.name);

    const cookie = (await fetch(url("/api/me"))).headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("expected /api/me to mint a visitor cookie");
    const first = await (await fetch(url("/api/me"), { headers: { Cookie: cookie } })).json();
    const second = await (await fetch(url("/api/me"), { headers: { Cookie: cookie } })).json();
    expect(second.name).toBe(first.name);
  });

  it("exposes a fixed scene graph: a hub, and a main + close-up scene per gallery, each reachable", async () => {
    const { galleries, scenes, defaultSceneId } = await (await fetch(url("/api/world"))).json();
    expect(Array.isArray(scenes)).toBe(true);
    expect(scenes.some((s: { id: string }) => s.id === defaultSceneId)).toBe(true);

    type Shape =
      | { type: "polygon"; viewBox: string; points: [number, number][] }
      | { type: "ellipse"; viewBox: string; cx: number; cy: number; rx: number; ry: number }
      | { type: "path"; viewBox: string; d: string };
    type Scene = {
      id: string;
      parentSceneId: string | null;
      interactiveObjects: Array<{ targetSceneId?: string; shape: Shape }>;
      nav?: { forward?: { targetSceneId: string }; back?: { targetSceneId: string } };
      camera: { minPan: number; maxPan: number; minZoom: number; maxZoom: number };
    };
    const byId = new Map<string, Scene>(scenes.map((s: Scene) => [s.id, s]));
    for (const gallery of galleries) {
      const main = byId.get(`${gallery.id}-main`);
      const closeup = byId.get(`${gallery.id}-closeup`);
      expect(main, `${gallery.id} has no main scene`).toBeTruthy();
      expect(closeup, `${gallery.id} has no close-up scene`).toBeTruthy();
      if (!main || !closeup) continue;

      // Every scene a visitor can reach has a way back — either a
      // parentSceneId (closeup -> main -> hub) or, for the hub's own
      // facings, a turnLeft/turnRight neighbour.
      expect(typeof main.parentSceneId).toBe("string");
      expect(byId.has(main.parentSceneId as string)).toBe(true);
      expect(closeup.parentSceneId).toBe(main.id);

      // Navigation out of the main scene (back to the hub) resolves to a
      // real scene id, and so does every in-room interactive object's own
      // target (a "look closer" object pointing at its own close-up) — no
      // object or nav entry should ever point at a scene id the world
      // doesn't know.
      expect(main.nav?.back?.targetSceneId).toBeTruthy();
      expect(byId.has(main.nav!.back!.targetSceneId)).toBe(true);
      expect(closeup.nav?.back?.targetSceneId).toBe(main.id);
      for (const object of main.interactiveObjects) {
        if (object.targetSceneId) expect(byId.has(object.targetSceneId)).toBe(true);
        // Every interactive object carries a real traced SHAPE (a polygon's
        // point list, or an ellipse's own cx/cy/rx/ry), never an
        // {x,y,width,height} rectangle — this is what lets the client clip
        // the glow to the actual painted object's silhouette instead of a
        // bounding box, and what a test asserting only "it received focus"
        // would miss entirely.
        expect(["polygon", "ellipse", "path"]).toContain(object.shape.type);
        expect(typeof object.shape.viewBox).toBe("string");
        if (object.shape.type === "polygon") {
          expect(Array.isArray(object.shape.points)).toBe(true);
          expect(object.shape.points.length).toBeGreaterThanOrEqual(3);
          for (const point of object.shape.points) {
            expect(point.length).toBe(2);
            expect(typeof point[0]).toBe("number");
            expect(typeof point[1]).toBe("number");
          }
        }
        if (object.shape.type === "ellipse") {
          expect(typeof object.shape.cx).toBe("number");
          expect(typeof object.shape.cy).toBe("number");
          expect(object.shape.rx).toBeGreaterThan(0);
          expect(object.shape.ry).toBeGreaterThan(0);
        }
      }

      // Every scene ships a bounded camera range — pan/zoom bounds must be
      // real, ordered numbers, never an accidental "camera can't move" or
      // "camera can go anywhere" default.
      for (const scene of [main, closeup]) {
        expect(scene.camera.minPan).toBeLessThanOrEqual(scene.camera.maxPan);
        expect(scene.camera.minZoom).toBeLessThanOrEqual(scene.camera.maxZoom);
        expect(scene.camera.minZoom).toBeGreaterThan(0);
      }
    }

    // Each main gallery scene offers 6-15 real clickable objects (the "look
    // closer" portal into its own close-up counts as one of them, same as
    // any other object a visitor can click — every gallery should feel
    // densely populated, per the museum-collection-object expansion pass;
    // `childhood`'s own artwork genuinely supports the high end of that
    // range), and each close-up scene offers 3-5 of its own — verified here
    // so it can't silently regress back to a sparse scene without a test
    // noticing.
    for (const gallery of galleries) {
      const main = byId.get(`${gallery.id}-main`)!;
      const closeup = byId.get(`${gallery.id}-closeup`)!;
      expect(
        main.interactiveObjects.length,
        `${gallery.id}-main should have 6-15 interactive objects, has ${main.interactiveObjects.length}`,
      ).toBeGreaterThanOrEqual(6);
      expect(main.interactiveObjects.length).toBeLessThanOrEqual(15);
      expect(
        closeup.interactiveObjects.length,
        `${gallery.id}-closeup should have 3-5 interactive objects, has ${closeup.interactiveObjects.length}`,
      ).toBeGreaterThanOrEqual(3);
      expect(closeup.interactiveObjects.length).toBeLessThanOrEqual(5);
    }

    // The hall is now exactly one scene — panned/zoomed/dragged the same
    // bounded way as every other main room, not a special four-facing "hub"
    // mode. Its own doorways are ordinary in-room `type: "portal"` objects
    // pointing directly at real scenes, rather than a `nav.forward`/
    // turnLeft/turnRight pair.
    const hub = byId.get(defaultSceneId);
    expect(hub).toBeTruthy();
    expect(hub?.camera.minPan).toBeLessThanOrEqual(hub!.camera.maxPan);
    const portalTargets = (hub?.interactiveObjects ?? [])
      .filter((o: { targetSceneId?: string }) => o.targetSceneId)
      .map((o: { targetSceneId?: string }) => o.targetSceneId as string);
    expect(portalTargets.length).toBeGreaterThan(0);
    for (const targetId of portalTargets) {
      expect(byId.has(targetId)).toBe(true);
    }
  });
});

describe("real-time: scene presence reaches another open session", () => {
  it("broadcasts a scene headcount over /api/events within about a second", async () => {
    const stream = await fetch(url("/api/events"));
    expect(stream.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = stream.body!.getReader();

    const { scenes } = await (await fetch(url("/api/world"))).json();
    const sceneId = scenes[0].id;
    const moved = fetch(url("/api/presence"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId }),
    });

    const deadline = Date.now() + 2000;
    let seenIt = false;
    let buffered = "";
    while (Date.now() < deadline && !seenIt) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: false }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: false }), 200),
        ),
      ]);
      if (done) break;
      if (value) buffered += new TextDecoder().decode(value);
      seenIt = buffered.includes("scene-presence");
    }
    await reader.cancel();
    await moved;

    expect(seenIt, "a scene-presence event should arrive as an SSE event").toBe(true);
  });

  it("rejects a presence report naming an unknown scene", async () => {
    const res = await fetch(url("/api/presence"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId: "not-a-real-scene" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("real-time: ephemeral focus broadcast (a visitor looking at an object)", () => {
  // Two independent visitors (separate cookie jars) are required here — a
  // single client never receives its own focus broadcast (the server
  // excepts the sender), so this is the one test in this file that can't
  // use a single fetch session.
  function cookieFrom(res: Response): string {
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("expected a visitor cookie");
    return cookie;
  }

  it("reaches another visitor who shares the same scene, but not one in a different scene", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const { scenes } = await (await fetch(url("/api/world"))).json();
    const sceneA = scenes[0].id;
    const sceneB = scenes[1].id;

    // A's own current scene is read server-side from its own open SSE
    // connection (sse.sceneIdForVisitor), not from the presence POST alone
    // — a visitor's "current scene" only exists once their /api/events
    // stream is open, exactly as the real client's connectEvents() does
    // before it ever posts presence. A is in sceneA, B is in sceneB — a
    // focus event from A should never reach B's stream.
    const aStream = await fetch(url(`/api/events?scene=${encodeURIComponent(sceneA)}`), {
      headers: { Cookie: aCookie },
    });
    const aReader = aStream.body!.getReader();

    const bStream = await fetch(url(`/api/events?scene=${encodeURIComponent(sceneB)}`), {
      headers: { Cookie: bCookie },
    });
    const bReader = bStream.body!.getReader();

    await fetch(url("/api/presence/focus"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aCookie },
      body: JSON.stringify({ objectId: "object:test-object-0" }),
    });

    let buffered = "";
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        bReader.read(),
        new Promise<{ value: undefined; done: false }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: false }), 200),
        ),
      ]);
      if (done) break;
      if (value) buffered += new TextDecoder().decode(value);
    }
    await bReader.cancel();
    expect(buffered.includes("event: focus"), "a different-scene visitor should never see A's focus event").toBe(false);

    // Now put B in sceneA too — the same focus event from A should reach it.
    await fetch(url("/api/presence"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: bCookie },
      body: JSON.stringify({ sceneId: sceneA }),
    });
    // GET /api/events re-tags the connection using its own ?scene= query
    // param (defaulting otherwise) — the same thing the real client's
    // EventSource call passes — so it must be given explicitly here too, or
    // this second connection would silently land back in the default scene
    // and never see sceneA's focus broadcast.
    const bStream2 = await fetch(url(`/api/events?scene=${encodeURIComponent(sceneA)}`), {
      headers: { Cookie: bCookie },
    });
    const bReader2 = bStream2.body!.getReader();

    await fetch(url("/api/presence/focus"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aCookie },
      body: JSON.stringify({ objectId: "object:test-object-0" }),
    });

    let buffered2 = "";
    let sawFocus = false;
    const deadline2 = Date.now() + 2000;
    while (Date.now() < deadline2 && !sawFocus) {
      const { value, done } = await Promise.race([
        bReader2.read(),
        new Promise<{ value: undefined; done: false }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: false }), 200),
        ),
      ]);
      if (done) break;
      if (value) buffered2 += new TextDecoder().decode(value);
      sawFocus = buffered2.includes("event: focus") && buffered2.includes("test-object-0");
    }
    await bReader2.cancel();
    expect(sawFocus, "a same-scene visitor should see A's focus event").toBe(true);
  });

  it("rejects a focus report with a malformed objectId", async () => {
    const res = await fetch(url("/api/presence/focus"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectId: "<script>nope</script>" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts objectId: null as a real state (stopped looking at anything)", async () => {
    const res = await fetch(url("/api/presence/focus"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectId: null }),
    });
    expect([200, 204]).toContain(res.status);
  });
});

describe("surface-aware free relic placement", () => {
  type Surface = {
    id: string;
    surfaceType: string;
    shape: { type: string; points?: [number, number][]; cx?: number; cy?: number; rx?: number; ry?: number };
    allowedRelicTypes: string[];
    minScale: number;
    maxScale: number;
  };

  async function world() {
    return (await (await fetch(url("/api/world"))).json()) as {
      galleries: Array<{ id: string; subtypes: string[]; slots: Array<{ id: string }>; placementSurfaces: Surface[] }>;
    };
  }

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

  async function freeGallerySlot(galleryId: string) {
    const { galleries } = await world();
    const gallery = galleries.find((g) => g.id === galleryId)!;
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const occupied = new Set(exhibits.map((e: { slotId: string }) => e.slotId));
    const slot = gallery.slots.find((s) => !occupied.has(s.id));
    if (!slot) throw new Error(`no free slot in ${galleryId}`);
    return { gallery, slot };
  }

  it("every gallery's placement surfaces only allow relic types compatible with that surface type", async () => {
    const { galleries } = await world();
    for (const gallery of galleries) {
      expect(gallery.placementSurfaces.length).toBeGreaterThan(0);
      for (const surface of gallery.placementSurfaces) {
        expect(["wall", "shelf", "tabletop", "cabinet", "plinth", "floor"]).toContain(surface.surfaceType);
        // A painting/sketch must never be offered a floor or carpet
        // placement — the one hard rule the brief calls out by name.
        if (surface.surfaceType === "floor") {
          expect(surface.allowedRelicTypes).not.toContain("painting");
          expect(surface.allowedRelicTypes).not.toContain("sketch");
        }
      }
    }
    const portraits = galleries.find((g) => g.id === "portraits")!;
    for (const surface of portraits.placementSurfaces) {
      expect(surface.surfaceType).toBe("wall");
    }
  });

  it("places a relic at a valid normalized point on a compatible surface, and persists it", async () => {
    const { gallery, slot } = await freeGallerySlot("portraits");
    const surface = gallery.placementSurfaces.find((s) => s.allowedRelicTypes.includes("painting"))!;
    // Offset well clear of this surface's own centroid: the seeded Founding
    // Collection exhibit (server/src/db.js's seedFoundingCollection) already
    // occupies this gallery's first surface near its centroid via
    // legacySlotPlacement, so placing exactly on it here would legitimately
    // collide — this test is about a valid placement succeeding, not about
    // collision (world.test.ts's own collision test covers that directly).
    const centroid = centroidOf(surface.shape);
    const bounds = (() => {
      const xs = surface.shape.points!.map((p) => p[0]);
      const ys = surface.shape.points!.map((p) => p[1]);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    })();
    const { u, v } = uvFromPoint(surface.shape, centroid.x + bounds.w * 0.3, centroid.y + bounds.h * 0.3);

    const res = await fetch(url("/api/exhibits"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        u,
        v,
        subtype: "painting",
        title: `placed painting ${Date.now()}`,
        originClaim: "x",
        donorName: "Spec Visitor",
      }),
    });
    expect(res.status).toBe(201);
    const { exhibit } = await res.json();
    expect(exhibit.placement).toBeTruthy();
    expect(exhibit.placement.surfaceId).toBe(surface.id);
    expect(exhibit.placement.u).toBeCloseTo(u, 5);
    expect(exhibit.placement.v).toBeCloseTo(v, 5);

    const { exhibit: fetched } = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(fetched.placement.surfaceId).toBe(surface.id);
  });

  it("rejects a relic type that isn't allowed on the chosen surface, even though it's valid elsewhere in the same gallery", async () => {
    const { gallery, slot } = await freeGallerySlot("memento");
    // A memento tabletop surface doesn't accept "curiosity" (curiosity's own
    // allowed surface types are shelf/cabinet/plinth, never tabletop) even
    // though curiosity is a perfectly valid subtype for the memento
    // category in general and would be accepted on this gallery's shelf or
    // cabinet surfaces.
    const tabletop = gallery.placementSurfaces.find((s) => s.surfaceType === "tabletop")!;
    expect(tabletop.allowedRelicTypes).not.toContain("curiosity");
    const res = await fetch(url("/api/exhibits"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: tabletop.id,
        u: 0.5,
        v: 0.5,
        subtype: "curiosity",
        title: "x",
        originClaim: "x",
        donorName: "A",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a normalized point that falls outside the chosen surface's authorised polygon", async () => {
    const { gallery, slot } = await freeGallerySlot("specimen");
    const surface = gallery.placementSurfaces[0];
    const res = await fetch(url("/api/exhibits"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: surface.id,
        // Just outside the surface's own bounding box in u/v terms.
        u: 1.4,
        v: 1.4,
        subtype: surface.allowedRelicTypes[0],
        title: "x",
        originClaim: "x",
        donorName: "A",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a donation whose surfaceId doesn't exist in that gallery", async () => {
    const { gallery, slot } = await freeGallerySlot("childhood");
    const res = await fetch(url("/api/exhibits"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        galleryId: gallery.id,
        slotId: slot.id,
        surfaceId: "not-a-real-surface",
        u: 0.5,
        v: 0.5,
        subtype: gallery.placementSurfaces[0].allowedRelicTypes[0],
        title: "x",
        originClaim: "x",
        donorName: "A",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a second placement that collides with one already on the same surface", async () => {
    const { galleries } = await world();
    const gallery = galleries.find((g) => g.id === "memento")!;
    const surface = gallery.placementSurfaces[0];
    const centroid = centroidOf(surface.shape);
    const { u, v } = uvFromPoint(surface.shape, centroid.x, centroid.y);

    async function place() {
      const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
      const occupied = new Set(exhibits.map((e: { slotId: string }) => e.slotId));
      const slot = gallery.slots.find((s) => !occupied.has(s.id))!;
      return fetch(url("/api/exhibits"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          galleryId: gallery.id,
          slotId: slot.id,
          surfaceId: surface.id,
          u,
          v,
          subtype: surface.allowedRelicTypes[0],
          title: `collision test ${Date.now()}-${Math.random()}`,
          originClaim: "x",
          donorName: "A",
        }),
      });
    }

    const first = await place();
    expect(first.status).toBe(201);
    const second = await place();
    expect(second.status).toBe(409);
  });

  it("gives a legacy slot-based exhibit (no surfaceId) a derived default placement, never a missing one", async () => {
    // The Founding Collection is seeded through the pre-surface path
    // (server/src/db.js's seedFoundingCollection), so it's never donated
    // with a surfaceId — exactly the "existed before this shipped" case
    // backward compatibility exists for.
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const founding = exhibits.find((e: { id: string }) => e.id.startsWith("exhibit_founding_"));
    expect(founding, "expected a seeded Founding Collection exhibit").toBeTruthy();
    expect(founding.placement).toBeTruthy();
    expect(typeof founding.placement.surfaceId).toBe("string");
    expect(typeof founding.placement.u).toBe("number");
    expect(typeof founding.placement.v).toBe("number");
  });
});
