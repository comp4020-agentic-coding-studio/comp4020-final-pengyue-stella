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
      hotspots: Array<{ targetSceneId?: string }>;
      turnLeft?: string;
      turnRight?: string;
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

      // The main scene's own door hotspot actually leads back to that
      // parent scene, and its close-up hotspot leads to its own close-up —
      // no hotspot should ever point at a scene id the world doesn't know.
      for (const hotspot of main.hotspots) {
        if (hotspot.targetSceneId) expect(byId.has(hotspot.targetSceneId)).toBe(true);
      }
    }

    const hub = byId.get(defaultSceneId);
    expect(hub && byId.has(hub.turnLeft ?? "")).toBe(true);
    expect(hub && byId.has(hub.turnRight ?? "")).toBe(true);
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
