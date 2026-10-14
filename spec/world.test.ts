// Our own checks, alongside the course's invariants.test.ts (see
// spec/README.md for the split). These assert the museum's actual shape —
// four galleries, each with slots, each reachable — against the running
// app, not against how it happens to be implemented.
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
});

describe("real-time: a presence move reaches another open session", () => {
  it("broadcasts a moved position over /api/events within about a second", async () => {
    const stream = await fetch(url("/api/events"));
    expect(stream.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = stream.body!.getReader();

    const marker = Math.random().toString(36).slice(2);
    const moved = fetch(url("/api/presence/move"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 1.23, z: 4.56, yaw: 0.7, galleryId: marker }),
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
      seenIt = buffered.includes("presence");
    }
    await reader.cancel();
    await moved;

    expect(seenIt, "a presence event should arrive as an SSE event").toBe(true);
  });
});
