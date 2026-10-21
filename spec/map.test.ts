// Checks for the live museum map's own data contract — see
// public/app.js's renderMuseumMap/galleryRoomTotal/exhibitsByGallery. The
// map itself is client-side rendering, so these assert the server-side
// facts the client's aggregation depends on: that /api/world exposes a
// stable hub scene plus one main+closeup pair per gallery, that
// /api/events' scene-presence counts can be summed per gallery (main +
// closeup, never double-counted against a different gallery), and that
// every exhibit the map groups into a gallery node actually carries that
// gallery's id. The map's own click-navigation and keyboard access were
// verified manually in a real browser (see PROCESS.md), not here — DOM
// behaviour isn't this file's job.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

describe("the live museum map's data contract", () => {
  it("exposes a hub scene plus a main+closeup scene pair per gallery, so the map can aggregate one count per room", async () => {
    const { galleries, scenes, defaultSceneId } = await (await fetch(url("/api/world"))).json();
    const sceneIds = new Set(scenes.map((s: { id: string }) => s.id));

    // The hub (Entrance Hall) is its own room, never folded into a gallery.
    expect(sceneIds.has(defaultSceneId)).toBe(true);
    const hub = scenes.find((s: { id: string }) => s.id === defaultSceneId);
    expect(hub.galleryId == null).toBe(true);

    expect(galleries.length).toBe(4);
    for (const gallery of galleries) {
      expect(sceneIds.has(`${gallery.id}-main`), `${gallery.id} should have a main scene`).toBe(true);
      expect(sceneIds.has(`${gallery.id}-closeup`), `${gallery.id} should have a closeup scene`).toBe(true);

      const main = scenes.find((s: { id: string }) => s.id === `${gallery.id}-main`);
      const closeup = scenes.find((s: { id: string }) => s.id === `${gallery.id}-closeup`);
      expect(main.galleryId).toBe(gallery.id);
      expect(closeup.galleryId).toBe(gallery.id);
    }
  });

  it("reports a gallery's room total as the sum of its main and closeup scene-presence counts, not just one of them", async () => {
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const gallery = galleries[0];
    const mainScene = `${gallery.id}-main`;
    const closeupScene = `${gallery.id}-closeup`;

    const aCookie = (await fetch(url("/api/me"))).headers.get("set-cookie")?.split(";")[0];
    const bCookie = (await fetch(url("/api/me"))).headers.get("set-cookie")?.split(";")[0];
    if (!aCookie || !bCookie) throw new Error("expected visitor cookies");

    // Open SSE connections (the read path the real client's map relies on)
    // and move one visitor into the gallery's main scene, the other into its
    // closeup scene — a room total that only reads one of the two scenes
    // would miss one of these visitors.
    const aStream = await fetch(url(`/api/events?scene=${encodeURIComponent(mainScene)}`), { headers: { Cookie: aCookie } });
    const bStream = await fetch(url(`/api/events?scene=${encodeURIComponent(closeupScene)}`), { headers: { Cookie: bCookie } });
    const aReader = aStream.body!.getReader();
    const bReader = bStream.body!.getReader();

    await fetch(url("/api/presence"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aCookie },
      body: JSON.stringify({ sceneId: mainScene }),
    });
    await fetch(url("/api/presence"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: bCookie },
      body: JSON.stringify({ sceneId: closeupScene }),
    });

    // Drain each visitor's own stream briefly just to let the moves land
    // server-side before asking for the hello-equivalent snapshot a fresh
    // connection gets; a third observer connection's own `hello` event
    // carries the authoritative sceneCounts snapshot the map itself reads.
    async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
      const deadline = Date.now() + ms;
      let buffered = "";
      while (Date.now() < deadline) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: false }>((resolve) => setTimeout(() => resolve({ value: undefined, done: false }), 150)),
        ]);
        if (done) break;
        if (value) buffered += new TextDecoder().decode(value);
      }
      return buffered;
    }
    await Promise.all([drain(aReader, 300), drain(bReader, 300)]);

    const observerStream = await fetch(url("/api/events"));
    const observerReader = observerStream.body!.getReader();
    const helloText = await drain(observerReader, 1500);
    await observerReader.cancel();
    await aReader.cancel();
    await bReader.cancel();

    const helloLine = helloText.split("\n\n").find((chunk) => chunk.includes("event: hello"));
    expect(helloLine, "expected a hello event with a sceneCounts snapshot").toBeTruthy();
    const dataLine = helloLine!.split("\n").find((l) => l.startsWith("data: "));
    const payload = JSON.parse(dataLine!.slice("data: ".length));
    const sceneCounts = payload.sceneCounts as Record<string, number>;

    const roomTotal = (sceneCounts[mainScene] ?? 0) + (sceneCounts[closeupScene] ?? 0);
    expect(roomTotal).toBeGreaterThanOrEqual(2);
  });

  it("groups every exhibit under its own galleryId, so the map never shows a relic marker on the wrong room's node", async () => {
    const { galleries } = await (await fetch(url("/api/world"))).json();
    // A built-in museum object (origin: "builtin") turned into a real
    // exhibit may belong to the Entrance Hall itself, not one of the four
    // real galleries — "hall" is a valid room id for the floor plan even
    // though it's never one of `/api/world`'s own `galleries` entries.
    const galleryIds = new Set([...galleries.map((g: { id: string }) => g.id), "hall"]);
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();

    expect(Array.isArray(exhibits)).toBe(true);
    expect(exhibits.length).toBeGreaterThan(0);
    for (const exhibit of exhibits) {
      expect(galleryIds.has(exhibit.galleryId), `exhibit ${exhibit.id} has an unknown galleryId ${exhibit.galleryId}`).toBe(true);
    }
  });
});
