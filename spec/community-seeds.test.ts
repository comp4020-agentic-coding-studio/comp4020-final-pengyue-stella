import { describe, expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

const seededObjectIds = [
  "hall-clock",
  "portraits-object-0",
  "memento-object-0",
  "specimen-object-13",
  "childhood-object-2",
  "childhood-object-18",
  "childhood-object-35",
];

async function seededExhibit(objectId: string) {
  const response = await fetch(`${baseUrl}/api/exhibits/exhibit_builtin_${objectId}`);
  expect(response.status).toBe(200);
  return (await response.json()).exhibit;
}

describe("seeded museum community", () => {
  it("gives selected story objects four varied visitor contributions", async () => {
    const exhibits = await Promise.all(seededObjectIds.map(seededExhibit));
    for (const exhibit of exhibits) {
      expect(exhibit.accounts).toHaveLength(5); // one museum record + four visitor accounts
      const original = exhibit.accounts.find((account: { kind: string }) => account.kind === "original");
      const contributions = exhibit.accounts.filter((account: { kind: string }) => account.kind !== "original");
      expect(original).toBeTruthy();
      expect(contributions.every((account: { challengedAccountId: string }) =>
        account.challengedAccountId === original.id,
      )).toBe(true);
    }

    const kinds = new Set(exhibits.flatMap((exhibit) => exhibit.accounts.slice(1).map((account: { kind: string }) => account.kind)));
    expect(kinds).toEqual(new Set(["testimony", "contradiction", "revision", "counter-evidence"]));
  });

  it("covers believable, suspicious, cursed, disputed, and unclassified vote profiles", async () => {
    const exhibits = await Promise.all(seededObjectIds.map(seededExhibit));
    const visitorAccounts = exhibits.flatMap((exhibit) => exhibit.accounts.slice(1));
    const verdicts = new Set(visitorAccounts.map((account: { verdict: string }) => account.verdict));

    expect(verdicts).toEqual(new Set([
      "Believable",
      "Suspicious",
      "Definitely Cursed",
      "Disputed",
      "Unclassified",
    ]));

    const lonelyPositive = visitorAccounts.find((account: { votes: Record<string, number> }) =>
      account.votes.Believable === 1 && account.votes.Suspicious === 0 && account.votes["Definitely Cursed"] === 0,
    );
    const corroborated = visitorAccounts.find((account: { votes: Record<string, number> }) =>
      account.votes.Believable >= 18,
    );
    expect(lonelyPositive).toBeTruthy();
    expect(corroborated).toBeTruthy();
  });
});
