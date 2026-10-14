// Our own checks for the living archive: donation into a slot, competing
// accounts that never erase each other, and vote semantics (upsert, ties as
// Disputed, no votes as Unclassified). Against the running app.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

async function freeSlot(): Promise<{ galleryId: string; slotId: string }> {
  const { galleries } = await (await fetch(url("/api/world"))).json();
  const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
  const occupied = new Set(exhibits.map((e: { slotId: string }) => e.slotId));
  for (const gallery of galleries) {
    for (const slot of gallery.slots) {
      if (!occupied.has(slot.id)) return { galleryId: gallery.id, slotId: slot.id };
    }
  }
  throw new Error("no free slot in any gallery — widen the seed or extend this test");
}

async function donate(body: Record<string, unknown>) {
  return fetch(url("/api/exhibits"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("donating a relic", () => {
  it("places a validated donation into a free slot, visible in the archive", async () => {
    const { galleryId, slotId } = await freeSlot();
    const title = `spec exhibit ${Date.now()}`;
    const res = await donate({
      galleryId,
      slotId,
      title,
      originClaim: "Found behind a false wall.",
      donorName: "Spec Visitor",
    });
    expect(res.status).toBe(201);
    const { exhibit } = await res.json();
    expect(exhibit.title).toBe(title);
    expect(exhibit.slotId).toBe(slotId);

    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    expect(exhibits.some((e: { id: string }) => e.id === exhibit.id)).toBe(true);
  });

  it("rejects a donation into an already-occupied slot", async () => {
    const { galleryId, slotId } = await freeSlot();
    const first = await donate({
      galleryId,
      slotId,
      title: "first claim",
      originClaim: "x",
      donorName: "A",
    });
    expect(first.status).toBe(201);

    const second = await donate({
      galleryId,
      slotId,
      title: "second claim, same slot",
      originClaim: "y",
      donorName: "B",
    });
    expect(second.status).toBe(409);
  });

  it("rejects a donation with no title or an unknown slot", async () => {
    const { galleryId, slotId } = await freeSlot();
    expect((await donate({ galleryId, slotId, title: "", originClaim: "x", donorName: "A" })).status).toBe(400);
    expect(
      (await donate({ galleryId, slotId: "not-a-real-slot", title: "x", originClaim: "x", donorName: "A" })).status,
    ).toBe(400);
  });
});

describe("rewriting history", () => {
  it("never erases a prior account — a contradiction is a new row alongside it", async () => {
    const { galleryId, slotId } = await freeSlot();
    const { exhibit } = await (
      await donate({ galleryId, slotId, title: "The Disputed Locket", originClaim: "1892.", donorName: "A" })
    ).json();

    const original = exhibit.accounts[0];
    const contraRes = await fetch(url(`/api/exhibits/${exhibit.id}/accounts`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "contradiction",
        body: "Manufacturing records disagree entirely.",
        challengedAccountId: original.id,
        authorName: "B",
      }),
    });
    expect(contraRes.status).toBe(201);

    const { exhibit: after } = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(after.accounts.length).toBe(2);
    expect(after.accounts.some((a: { id: string }) => a.id === original.id)).toBe(true);
    expect(after.accounts.some((a: { kind: string }) => a.kind === "contradiction")).toBe(true);
  });
});

describe("exhibit-level classification", () => {
  it("starts Unclassified and reflects the leading account's votes", async () => {
    const { galleryId, slotId } = await freeSlot();
    const { exhibit } = await (
      await donate({ galleryId, slotId, title: "The Whispering Mirror", originClaim: "It answers questions.", donorName: "A" })
    ).json();
    expect(exhibit.classification).toBe("Unclassified");

    const cookieRes = await fetch(url("/api/me"));
    const cookie = cookieRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    await fetch(url(`/api/accounts/${exhibit.accounts[0].id}/vote`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ verdict: "Definitely Cursed" }),
    });

    const after = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(after.exhibit.classification).toBe("Definitely Cursed");
  });
});

describe("voting", () => {
  it("upserts one vote per visitor per account, and reports Unclassified with none", async () => {
    const { galleryId, slotId } = await freeSlot();
    const { exhibit } = await (
      await donate({ galleryId, slotId, title: "The Humming Jar", originClaim: "It arrived humming.", donorName: "A" })
    ).json();
    const accountId = exhibit.accounts[0].id;

    const before = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(before.exhibit.accounts[0].verdict).toBe("Unclassified");

    const cookieRes = await fetch(url("/api/me"));
    const cookie = cookieRes.headers.get("set-cookie")?.split(";")[0] ?? "";

    const vote = (verdict: string) =>
      fetch(url(`/api/accounts/${accountId}/vote`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ verdict }),
      });

    expect((await vote("Believable")).status).toBe(200);
    let after = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    let account = after.exhibit.accounts.find((a: { id: string }) => a.id === accountId);
    expect(account.votes.Believable).toBe(1);

    // Changing a vote updates the same row rather than adding a second.
    expect((await vote("Suspicious")).status).toBe(200);
    after = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    account = after.exhibit.accounts.find((a: { id: string }) => a.id === accountId);
    expect(account.votes.Believable).toBe(0);
    expect(account.votes.Suspicious).toBe(1);
  });

  it("rejects a vote with an unknown verdict", async () => {
    const { galleryId, slotId } = await freeSlot();
    const { exhibit } = await (
      await donate({ galleryId, slotId, title: "The Second Jar", originClaim: "Also humming.", donorName: "A" })
    ).json();
    const accountId = exhibit.accounts[0].id;
    const res = await fetch(url(`/api/accounts/${accountId}/vote`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "Definitely Fine" }),
    });
    expect(res.status).toBe(400);
  });
});
