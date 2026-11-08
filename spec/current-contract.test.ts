import { readFileSync } from "node:fs";
import { describe, expect, inject, it } from "vitest";

import { COMMUNITY_ACCOUNT_SEEDS, SEEDED_ACCOUNT_COUNT } from "../server/src/community-seeds.js";
import { RELIC_TINTS } from "../server/src/constants.js";
import { GALLERY_NARRATIVE, HALL_NAME, MUSEUM_MYSTERY } from "../server/src/narrative.js";
import { RELIC_OVERLAYS, RELIC_PRESETS } from "../server/src/relic-presets.js";

const baseUrl = inject("baseUrl");
const contractDocs = ["DESIGN.md", "PLAN.md", "CLAUDE.md"].map((path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
);
const normalizedContractDocs = contractDocs.map((document) => document.replace(/\s+/g, " "));

describe("current product contract", () => {
  it("keeps current documentation on the canonical room names", () => {
    const canonicalNames = [HALL_NAME, ...Object.values(GALLERY_NARRATIVE).map((gallery) => gallery.name)];
    for (const document of normalizedContractDocs) {
      for (const name of canonicalNames) expect(document).toContain(name);
    }

    const retiredNames = [
      "The Portraits That Watch",
      "Objects That Remember",
      "The Cabinet of Impossible Life",
      "The Forgotten Childhood",
    ];
    for (const document of normalizedContractDocs) {
      for (const name of retiredNames) expect(document).not.toContain(name);
    }
  });

  it("keeps the running catalogs aligned with their canonical sources", async () => {
    const [world, presets, tints, overlays] = await Promise.all([
      fetch(`${baseUrl}/api/world`).then((response) => response.json()),
      fetch(`${baseUrl}/api/relic-presets`).then((response) => response.json()),
      fetch(`${baseUrl}/api/relic-tints`).then((response) => response.json()),
      fetch(`${baseUrl}/api/relic-overlays`).then((response) => response.json()),
    ]);

    expect(world.hall.name).toBe(HALL_NAME);
    expect(world.mystery).toEqual(MUSEUM_MYSTERY);
    expect(world.galleries.map((gallery: { name: string }) => gallery.name)).toEqual(
      Object.values(GALLERY_NARRATIVE).map((gallery) => gallery.name),
    );
    expect(presets.presets).toHaveLength(RELIC_PRESETS.length);
    expect(tints.tints).toHaveLength(RELIC_TINTS.length);
    expect(overlays.overlays).toHaveLength(RELIC_OVERLAYS.length);
  });

  it("documents the production community seed exactly", () => {
    const voteCount = COMMUNITY_ACCOUNT_SEEDS.flatMap((exhibit) => exhibit.accounts).reduce(
      (total, account) => total + Object.values(account.votes).reduce((sum, votes) => sum + votes, 0),
      0,
    );
    expect(COMMUNITY_ACCOUNT_SEEDS).toHaveLength(7);
    expect(SEEDED_ACCOUNT_COUNT).toBe(28);
    expect(voteCount).toBe(463);
    expect(contractDocs[0]).toContain(`${SEEDED_ACCOUNT_COUNT} fictional`);
    expect(contractDocs[0]).toContain(`${voteCount} votes`);
  });
});
