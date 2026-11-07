import { describe, expect, it } from "vitest";

import { GALLERY_NARRATIVE, HALL_NAME, narrativeCoverage, storyForObject } from "../server/src/narrative.js";
import { allBuiltinLoreObjects, publicWorld } from "../server/src/world.js";

describe("the museum's central mystery", () => {
  it("gives the hall and four galleries distinct authored names", () => {
    const world = publicWorld();
    expect(world.hall.name).toBe(HALL_NAME);
    expect(world.galleries.map((gallery) => gallery.name)).toEqual(
      Object.values(GALLERY_NARRATIVE).map((gallery) => gallery.name),
    );
    expect(new Set(world.galleries.map((gallery) => gallery.name)).size).toBe(4);
  });

  it("replaces every built-in object's placeholder copy with a short clue", () => {
    const objects = allBuiltinLoreObjects();
    expect(objects.length).toBeGreaterThan(100);

    for (const object of objects) {
      const story = storyForObject(object.id);
      expect(story, `${object.id} needs authored story copy`).not.toBeNull();
      expect(object.label).toBe(story!.label);
      expect(object.text).toBe(story!.text);
      expect(object.text.trim().split(/\s+/).length).toBeLessThanOrEqual(30);
      expect(object.label).not.toMatch(/^(A|An)\s/i);
      expect(object.label).not.toMatch(/\b(left|right|beside|beneath|upper shelf|lower shelf|far cabinet)\b/i);
    }

    expect(narrativeCoverage().has("hall-map")).toBe(true);
  });
});
