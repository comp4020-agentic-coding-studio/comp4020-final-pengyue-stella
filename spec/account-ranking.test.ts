import { describe, expect, it } from "vitest";

import { sortAccountsForDisplay, trustScore, wilsonLowerBound } from "../public/account-ranking.js";

function account(id: string, kind: string, believable: number, suspicious: number, cursed: number, createdAt: string) {
  return {
    id,
    kind,
    createdAt,
    votes: {
      Believable: believable,
      Suspicious: suspicious,
      "Definitely Cursed": cursed,
    },
  };
}

describe("account trust ordering", () => {
  it("ranks broad corroboration above one perfect but lonely vote", () => {
    const corroborated = account("corroborated", "testimony", 18, 2, 1, "2026-11-01T00:00:00.000Z");
    const lonely = account("lonely", "testimony", 1, 0, 0, "2026-10-01T00:00:00.000Z");

    expect(trustScore(corroborated)).toBeGreaterThan(trustScore(lonely));
    expect(wilsonLowerBound(18, 21)).toBeGreaterThan(wilsonLowerBound(1, 1));
  });

  it("keeps the original record first, then trust-sorts later contributions", () => {
    const records = [
      account("unvoted", "revision", 0, 0, 0, "2026-10-01T00:00:00.000Z"),
      account("thin", "testimony", 1, 0, 0, "2026-10-02T00:00:00.000Z"),
      account("original", "original", 0, 0, 0, "2026-09-01T00:00:00.000Z"),
      account("contested", "contradiction", 7, 7, 1, "2026-10-03T00:00:00.000Z"),
      account("corroborated", "counter-evidence", 18, 2, 1, "2026-10-04T00:00:00.000Z"),
    ];

    expect(sortAccountsForDisplay(records).map((record) => record.id)).toEqual([
      "original",
      "corroborated",
      "contested",
      "thin",
      "unvoted",
    ]);
  });
});
