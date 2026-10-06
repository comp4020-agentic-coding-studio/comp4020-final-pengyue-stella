// Our own checks, alongside the course's invariants.test.ts (see
// spec/README.md for the split). These assert the app's actual promises —
// multi-user, real-time, the scene graph staying connected — against the
// running app, not against how it happens to be implemented.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

function cookieFrom(res: Response): string | undefined {
  return res.headers.get("set-cookie")?.split(";")[0];
}

async function freshVisitorCookie(): Promise<string> {
  const res = await fetch(url("/api/me"));
  const cookie = cookieFrom(res);
  if (!cookie) throw new Error("expected /api/me to mint a visitor cookie");
  return cookie;
}

describe("the scene graph", () => {
  it("is a handful of connected scenes, each reachable from its own exits", async () => {
    const res = await fetch(url("/api/scenes"));
    expect(res.status).toBe(200);
    const { scenes } = await res.json();

    expect(Array.isArray(scenes)).toBe(true);
    expect(scenes.length).toBeGreaterThanOrEqual(3);

    const ids = new Set(scenes.map((s: { id: string }) => s.id));
    for (const scene of scenes) {
      expect(scene.exits.length, `${scene.id} has no way out`).toBeGreaterThan(0);
      for (const exit of scene.exits) {
        expect(ids.has(exit.to), `${scene.id} exits to unknown scene "${exit.to}"`).toBe(true);
        expect(exit.x).toBeGreaterThanOrEqual(0);
        expect(exit.x).toBeLessThanOrEqual(1);
      }
    }
  });

  it("serves every scene's background image", async () => {
    const { scenes } = await (await fetch(url("/api/scenes"))).json();
    for (const scene of scenes) {
      const res = await fetch(url(scene.image));
      expect(res.status, `${scene.image} should be served`).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/svg/);
    }
  });
});

describe("leaving and discovering traces", () => {
  it("round-trips a trace: posted, then found in that scene's list", async () => {
    const body = `spec check ${Date.now()}`;
    const postRes = await fetch(url("/api/scenes/kambri/traces"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 0.5, y: 0.5, body, type: "spark" }),
    });
    expect(postRes.status).toBe(201);
    const { trace } = await postRes.json();
    expect(trace.body).toBe(body);
    expect(trace.sceneId).toBe("kambri");

    const listRes = await fetch(url("/api/scenes/kambri/traces"));
    const { traces } = await listRes.json();
    expect(traces.some((t: { id: string }) => t.id === trace.id)).toBe(true);
  });

  it("rejects a trace with no body, a bad type, or an out-of-range position", async () => {
    const cases = [
      { x: 0.5, y: 0.5, body: "", type: "spark" },
      { x: 0.5, y: 0.5, body: "fine text", type: "not-a-real-type" },
      { x: 1.5, y: 0.5, body: "fine text", type: "spark" },
    ];
    for (const payload of cases) {
      const res = await fetch(url("/api/scenes/kambri/traces"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status, JSON.stringify(payload)).toBe(400);
    }
  });

  it("404s a scene that doesn't exist, for both reading and writing", async () => {
    expect((await fetch(url("/api/scenes/nonexistent/traces"))).status).toBe(404);
    const res = await fetch(url("/api/scenes/nonexistent/traces"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 0.5, y: 0.5, body: "x", type: "spark" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("multi-user: the app tells visitors apart", () => {
  it("gives two different visitors different names and colours", async () => {
    const a = await (await fetch(url("/api/me"))).json();
    const b = await (await fetch(url("/api/me"))).json(); // a second, cookie-less request
    expect(a.name).not.toBe(b.name);
  });

  it("recognises the same visitor across requests via their cookie", async () => {
    const cookie = await freshVisitorCookie();
    const first = await (await fetch(url("/api/me"), { headers: { Cookie: cookie } })).json();
    const second = await (await fetch(url("/api/me"), { headers: { Cookie: cookie } })).json();
    expect(second.name).toBe(first.name);
    expect(second.color).toBe(first.color);
  });

  it("cools down a visitor who just posted, rather than let them flood a scene", async () => {
    const cookie = await freshVisitorCookie();
    const post = () =>
      fetch(url("/api/scenes/union/traces"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ x: 0.2, y: 0.2, body: "one", type: "tip" }),
      });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
  });
});

describe("real-time: another open session receives it", () => {
  it("broadcasts a newly posted trace over /api/events within about a second", async () => {
    const stream = await fetch(url("/api/events"));
    expect(stream.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = stream.body!.getReader();

    const postedBody = `live push ${Date.now()}`;
    const posted = fetch(url("/api/scenes/science/traces"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 0.3, y: 0.3, body: postedBody, type: "story" }),
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
      seenIt = buffered.includes(postedBody);
    }
    await reader.cancel();
    await posted;

    expect(seenIt, "the posted trace should arrive as an SSE event").toBe(true);
  });
});
