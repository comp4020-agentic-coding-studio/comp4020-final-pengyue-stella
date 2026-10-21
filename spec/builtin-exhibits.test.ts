// Checks for the unified dossier model (server/src/db.js's
// seedBuiltinLoreExhibits): every built-in museum object (a chandelier, a
// bust, a mirror, etc.) is a real, persisted `exhibits` row — the SAME
// table and API surface a donated or Founding Collection exhibit uses —
// with origin "builtin", a stable id derived from its world-object id, a
// seeded original account, and museum-collection provenance. The hall-map
// object is excluded (it's the Museum Guide trigger now, type "guide", not
// a dossier at all). Accounts/votes/SSE behaviour on a builtin exhibit are
// covered by spec/archive.test.ts's own extension, not duplicated here.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

describe("unified dossier model: built-in museum objects", () => {
  it("hall-map is now a guide trigger, not a lore object converted to an exhibit", async () => {
    const { scenes } = await (await fetch(url("/api/world"))).json();
    const hall = scenes.find((s: { id: string }) => s.id === "hall");
    const mapObject = hall.interactiveObjects.find((o: { id: string }) => o.id === "hall-map");
    expect(mapObject).toBeTruthy();
    expect(mapObject.type).toBe("guide");

    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    expect(exhibits.some((e: { id: string }) => e.id === "exhibit_builtin_hall-map")).toBe(false);
  });

  it("every other hall lore object keeps type 'lore' and gets a real seeded exhibit", async () => {
    const { scenes } = await (await fetch(url("/api/world"))).json();
    const hall = scenes.find((s: { id: string }) => s.id === "hall");
    const loreObjects = hall.interactiveObjects.filter((o: { type: string }) => o.type === "lore");
    expect(loreObjects.length).toBeGreaterThan(0);

    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const exhibitsById = new Map(exhibits.map((e: { id: string }) => [e.id, e]));
    for (const object of loreObjects) {
      const exhibit = exhibitsById.get(`exhibit_builtin_${object.id}`) as
        | { origin: string; donorName: string; accounts: unknown[]; galleryId: string; title: string }
        | undefined;
      expect(exhibit, `expected a seeded exhibit for ${object.id}`).toBeTruthy();
      expect(exhibit!.origin).toBe("builtin");
      expect(exhibit!.donorName).toBe("Museum collection");
      expect(exhibit!.galleryId).toBe("hall");
      expect(exhibit!.title).toBe(object.label);
      expect(Array.isArray(exhibit!.accounts)).toBe(true);
      expect(exhibit!.accounts.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("a gallery-owned lore object also gets a real seeded exhibit under that gallery's id", async () => {
    const { scenes, galleries } = await (await fetch(url("/api/world"))).json();
    const gallery = galleries[0];
    const main = scenes.find((s: { id: string }) => s.id === `${gallery.id}-main`);
    const loreObject = main.interactiveObjects.find((o: { type: string }) => o.type === "lore");
    expect(loreObject).toBeTruthy();

    const { exhibit } = await (await fetch(url(`/api/exhibits/exhibit_builtin_${loreObject.id}`))).json();
    expect(exhibit).toBeTruthy();
    expect(exhibit.origin).toBe("builtin");
    expect(exhibit.galleryId).toBe(gallery.id);
  });

  it("GET /api/exhibits/:id serves a builtin exhibit through the exact same endpoint as any other exhibit (200, not 404)", async () => {
    const res = await fetch(url("/api/exhibits/exhibit_builtin_hall-chandelier"));
    expect(res.status).toBe(200);
    const { exhibit } = await res.json();
    expect(exhibit.id).toBe("exhibit_builtin_hall-chandelier");
  });

  it("a built-in object has no spatial placement (it renders via its own world-object shape, never a surface glow)", async () => {
    const { exhibit } = await (await fetch(url("/api/exhibits/exhibit_builtin_hall-chandelier"))).json();
    expect(exhibit.placement).toBeNull();
  });

  it("the per-gallery marquee closeup trigger is folded into the dossier model too, carrying its own closeupSceneId", async () => {
    const { scenes, galleries } = await (await fetch(url("/api/world"))).json();
    const gallery = galleries[0];
    const main = scenes.find((s: { id: string }) => s.id === `${gallery.id}-main`);
    const marquee = main.interactiveObjects.find((o: { closeupSceneId?: string }) => o.closeupSceneId);
    expect(marquee, "expected the gallery's marquee closeup object to carry closeupSceneId").toBeTruthy();
    expect(marquee.type).toBe("lore");

    const { exhibit } = await (await fetch(url(`/api/exhibits/exhibit_builtin_${marquee.id}`))).json();
    expect(exhibit.closeupSceneId).toBe(`${gallery.id}-closeup`);
  });
});
