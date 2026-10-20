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

    type Scene = {
      id: string;
      parentSceneId: string | null;
      interactiveObjects: Array<{ targetSceneId?: string; anchor: { x: number; y: number; width: number; height: number } }>;
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
        // Every interactive object anchors to a real BOX region on the
        // illustration, not a bare point — this is what lets the client
        // render a glow clipped to the actual painted item instead of a
        // pill floating at a single coordinate.
        expect(typeof object.anchor.x).toBe("number");
        expect(typeof object.anchor.y).toBe("number");
        expect(typeof object.anchor.width).toBe("number");
        expect(typeof object.anchor.height).toBe("number");
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
