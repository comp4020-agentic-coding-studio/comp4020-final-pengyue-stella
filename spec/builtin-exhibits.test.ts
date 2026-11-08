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
import { allBuiltinLoreObjects } from "../server/src/world.js";

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

  // The builtin-object dossier preview (public/app.js's
  // renderBuiltinObjectVisual) needs the object's own owning sceneId + its
  // hand-traced shape to CSS-crop the real painted item straight out of
  // that scene's gallery art — server/src/db.js's fullExhibit attaches this
  // as `cropInfo` for every builtin exhibit (server/src/world.js's
  // builtinObjectCropInfo), never for a donated/founding one.
  it("a builtin exhibit's own response carries cropInfo with a real sceneId and shape", async () => {
    const { exhibit } = await (await fetch(url("/api/exhibits/exhibit_builtin_hall-chandelier"))).json();
    expect(exhibit.cropInfo).toBeTruthy();
    expect(exhibit.cropInfo.sceneId).toBe("hall");
    expect(["polygon", "ellipse", "path"]).toContain(exhibit.cropInfo.shape.type);
    if (exhibit.cropInfo.shape.type === "ellipse") {
      expect(exhibit.cropInfo.shape.rx).toBeGreaterThan(0);
      expect(exhibit.cropInfo.shape.ry).toBeGreaterThan(0);
    } else if (exhibit.cropInfo.shape.type === "polygon") {
      expect(exhibit.cropInfo.shape.points.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("a gallery-owned builtin exhibit's cropInfo names that gallery's own main scene, not the hall", async () => {
    const { scenes, galleries } = await (await fetch(url("/api/world"))).json();
    const gallery = galleries[0];
    const main = scenes.find((s: { id: string }) => s.id === `${gallery.id}-main`);
    const loreObject = main.interactiveObjects.find((o: { type: string }) => o.type === "lore");
    const { exhibit } = await (await fetch(url(`/api/exhibits/exhibit_builtin_${loreObject.id}`))).json();
    expect(exhibit.cropInfo.sceneId).toBe(`${gallery.id}-main`);
  });

  it("serves curated dossier images for the three low-resolution portrait-gallery objects", async () => {
    const expected = new Map([
      ["portraits-object-1", "/assets/builtin-details/left-plinth-bust.png"],
      ["portraits-object-2", "/assets/builtin-details/right-plinth-bust.png"],
      ["portraits-object-4", "/assets/builtin-details/second-framed-portrait.png"],
    ]);

    for (const [objectId, detailImage] of expected) {
      const { exhibit } = await (await fetch(url(`/api/exhibits/exhibit_builtin_${objectId}`))).json();
      expect(exhibit.cropInfo.detailImage).toBe(detailImage);
    }
  });

  it("a non-builtin exhibit never carries cropInfo", async () => {
    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    const founding = exhibits.find((e: { id: string }) => e.id.startsWith("exhibit_founding_"));
    expect(founding).toBeTruthy();
    expect(founding.cropInfo).toBeNull();
  });

  // The per-gallery marquee "look closer" trigger (a lore object carrying
  // closeupSceneId, folded into the dossier model the same as any other
  // builtin exhibit) no longer exists anywhere in the museum: portraits,
  // memento, and specimen each had theirs retraced into an ordinary object,
  // and childhood's own ("Look closer: The Shelf That Waits" / "The
  // Third-Shelf Lacuna") was removed outright at the user's request — see
  // each gallery's own comment in server/src/world.js, and
  // spec/world.test.ts's CLOSEUP_OBJECT_COUNT_EXCEPTIONS, which now
  // includes all four galleries.

  // A real regression once slipped past exactly here: db.js's
  // seedBuiltinLoreExhibits() re-syncs an existing builtin exhibit's title
  // on every boot but, before this test existed, never re-synced
  // closeup_scene_id — so an exhibit row written back when e.g. "The
  // Borrowed Countess" WAS a marquee trigger kept serving a stale non-null
  // closeupSceneId (and the client's "Inspect Closer" button with it) on
  // every later boot forever, even once world.js's own authored content
  // said that object was never a trigger again. world.js is this field's
  // one source of truth, so a running server's DB must always agree with
  // it exactly, not just at first-ever seed.
  it("every builtin exhibit's closeupSceneId matches its current world.js authoring, not a stale seeded value", async () => {
    for (const object of allBuiltinLoreObjects()) {
      const { exhibit } = await (await fetch(url(`/api/exhibits/exhibit_builtin_${object.id}`))).json();
      expect(exhibit.closeupSceneId, `${object.id} has a stale closeupSceneId`).toBe(object.closeupSceneId ?? null);
    }
  });
});
