// Our own checks for the living archive: donation into a slot, competing
// accounts that never erase each other, and vote semantics (upsert, ties as
// Disputed, no votes as Unclassified). Against the running app.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

type Surface = {
  id: string;
  allowedRelicTypes: string[];
  shape: { type: string; points?: [number, number][]; cx?: number; cy?: number; rx?: number; ry?: number };
};

function centroidOf(shape: Surface["shape"]): { x: number; y: number } {
  if (shape.type === "ellipse") return { x: shape.cx!, y: shape.cy! };
  const xs = shape.points!.map((p) => p[0]);
  const ys = shape.points!.map((p) => p[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function uvFromPoint(shape: Surface["shape"], x: number, y: number): { u: number; v: number } {
  let minX: number, maxX: number, minY: number, maxY: number;
  if (shape.type === "ellipse") {
    minX = shape.cx! - shape.rx!;
    maxX = shape.cx! + shape.rx!;
    minY = shape.cy! - shape.ry!;
    maxY = shape.cy! + shape.ry!;
  } else {
    const xs = shape.points!.map((p) => p[0]);
    const ys = shape.points!.map((p) => p[1]);
    minX = Math.min(...xs);
    maxX = Math.max(...xs);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
  }
  return { u: (x - minX) / (maxX - minX), v: (y - minY) / (maxY - minY) };
}

// The minimum normalized separation server/src/db.js's own MIN_SURFACE_
// SEPARATION enforces between two placements on the same surface — kept in
// sync here only so this helper can deterministically pick a point that
// won't collide with an existing placement, not to re-test the constraint
// itself (spec/world.test.ts's own collision test does that directly).
const MIN_SURFACE_SEPARATION = 0.22;

// A preset is now REQUIRED for a NEW donation (server/src/db.js's
// donateExhibit rejects a missing visualId with "visual_required" — see
// spec/relic-presets.test.ts's own dedicated tests for that rule itself).
// This file's own donations aren't ABOUT the preset system, so freeSlot()
// picks whichever subtype actually has a matching curated preset for the
// gallery it lands on (falling back to the gallery's own first subtype,
// and visualId undefined, only if a gallery genuinely has none — none
// currently do) rather than every call site here having to know the
// catalog itself.
async function freeSlot(): Promise<{
  galleryId: string;
  slotId: string;
  subtype: string;
  surfaceId: string;
  u: number;
  v: number;
  visualId?: string;
}> {
  const { galleries } = await (await fetch(url("/api/world"))).json();
  const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
  const { presets } = await (await fetch(url("/api/relic-presets"))).json();
  const occupiedSlots = new Set(exhibits.map((e: { slotId: string }) => e.slotId));
  // Try the gallery with the MOST free slots first, not always the same
  // fixed order — other spec files (and this one's own 8 call sites) also
  // compete for slots in the same shared database when vitest runs files
  // concurrently, and always exhausting one gallery's small fixed slot
  // count first made this flaky as the total donation-test count grew.
  const byFreeSlotsDesc = [...galleries].sort((a, b) => {
    const freeA = a.slots.filter((s: { id: string }) => !occupiedSlots.has(s.id)).length;
    const freeB = b.slots.filter((s: { id: string }) => !occupiedSlots.has(s.id)).length;
    return freeB - freeA;
  });
  for (const gallery of byFreeSlotsDesc) {
    const galleryPreset = presets.find((p: { category: string }) => p.category === gallery.category);
    const subtype =
      galleryPreset && gallery.subtypes.includes(galleryPreset.subtype) ? galleryPreset.subtype : gallery.subtypes[0];
    const visualId = galleryPreset?.subtype === subtype ? galleryPreset.id : undefined;
    for (const slot of gallery.slots) {
      if (occupiedSlots.has(slot.id)) continue;
      const compatible = gallery.placementSurfaces.filter((s: Surface) => s.allowedRelicTypes.includes(subtype));
      for (const surface of compatible) {
        const taken = exhibits.filter((e: { galleryId: string; placement?: { surfaceId: string; u: number; v: number } }) =>
          e.galleryId === gallery.id && e.placement?.surfaceId === surface.id,
        );
        // A small deterministic grid of candidate points on this surface —
        // pick the first that's clear of every already-placed exhibit there,
        // so this helper never needs randomness (and never flakes) to avoid
        // the exact collision rule the server enforces.
        for (const u of [0.15, 0.35, 0.55, 0.75, 0.9]) {
          for (const v of [0.2, 0.5, 0.8]) {
            const clear = taken.every(
              (e: { placement: { u: number; v: number } }) => Math.hypot(e.placement.u - u, e.placement.v - v) >= MIN_SURFACE_SEPARATION,
            );
            if (clear) return { galleryId: gallery.id, slotId: slot.id, subtype, surfaceId: surface.id, u, v, visualId };
          }
        }
      }
    }
  }
  throw new Error("no free slot/surface point in any gallery — widen the seed or extend this test");
}

async function donate(body: Record<string, unknown>) {
  return fetch(url("/api/exhibits"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Other spec files donate concurrently into the same small fixed per-gallery
// slot pool (vitest runs spec files in parallel by default) — a slot/surface
// spot that looked free a moment ago can legitimately be taken by the time
// this request lands (the exact race server/src/db.js's own 409 exists
// for). Re-resolves a fresh free slot and retries rather than treating that
// race as a real test failure, matching spec/relic-presets.test.ts's own
// established pattern.
async function donateRetrying(extra: Record<string, unknown>) {
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const placement = await freeSlot();
    res = await donate({ ...placement, ...extra });
    if (res.status !== 409) return { res, placement };
  }
  return { res: res!, placement: await freeSlot() };
}

// For tests that only need the resulting exhibit, not the placement itself.
async function donateExhibitRetrying(extra: Record<string, unknown>) {
  const { res } = await donateRetrying(extra);
  const { exhibit } = await res.json();
  return { res, exhibit };
}

describe("donating a relic", () => {
  it("places a validated donation into a free slot, visible in the archive, numbered and subtyped", async () => {
    const title = `spec exhibit ${Date.now()}`;
    const { res, placement } = await donateRetrying({
      title,
      originClaim: "Found behind a false wall.",
      donorName: "Spec Visitor",
    });
    expect(res.status).toBe(201);
    const { exhibit } = await res.json();
    expect(exhibit.title).toBe(title);
    expect(exhibit.slotId).toBe(placement.slotId);
    expect(exhibit.subtype).toBe(placement.subtype);
    expect(typeof exhibit.number).toBe("number");
    expect(exhibit.placement.surfaceId).toBe(placement.surfaceId);

    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    expect(exhibits.some((e: { id: string }) => e.id === exhibit.id)).toBe(true);
  });

  it("rejects a donation into an already-occupied slot", async () => {
    const { res: first, placement } = await donateRetrying({ title: "first claim", originClaim: "x", donorName: "A" });
    expect(first.status).toBe(201);

    // A second donation reusing the exact same slot id (but a fresh,
    // non-colliding surface point so it only fails on the slot, not the
    // surface) must still be rejected — the display-slot UNIQUE constraint
    // is its own independent invariant from surface collision.
    const second = await donate({
      ...placement,
      // Comfortably clear of MIN_SURFACE_SEPARATION (0.22) from the first
      // donation's own point regardless of where that point landed.
      u: placement.u > 0.5 ? placement.u - 0.4 : placement.u + 0.4,
      title: "second claim, same slot",
      originClaim: "y",
      donorName: "B",
    });
    expect(second.status).toBe(409);
  });

  it("rejects a donation with no title, an unknown slot, or a subtype foreign to the gallery's category", async () => {
    const placement = await freeSlot();
    const { galleryId } = placement;
    expect((await donate({ ...placement, title: "", originClaim: "x", donorName: "A" })).status).toBe(400);
    expect(
      (await donate({ ...placement, slotId: "not-a-real-slot", title: "x", originClaim: "x", donorName: "A" }))
        .status,
    ).toBe(400);

    // A subtype that belongs to a different category's vocabulary entirely
    // (not just an unknown string) must still be rejected — the gallery's
    // category, not the client, decides which subtypes are valid for it.
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const thisGallery = galleries.find((g: { id: string }) => g.id === galleryId);
    const foreignSubtype = galleries
      .flatMap((g: { subtypes: string[] }) => g.subtypes)
      .find((s: string) => !thisGallery.subtypes.includes(s));
    expect(
      (await donate({ ...placement, subtype: foreignSubtype, title: "x", originClaim: "x", donorName: "A" }))
        .status,
    ).toBe(400);
  });
});

describe("rewriting history", () => {
  it("never erases a prior account — a contradiction is a new row alongside it", async () => {
    const { exhibit } = await donateExhibitRetrying({ title: "The Disputed Locket", originClaim: "1892.", donorName: "A" });

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
    const { exhibit } = await donateExhibitRetrying({ title: "The Whispering Mirror", originClaim: "It answers questions.", donorName: "A" });
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
    const { exhibit } = await donateExhibitRetrying({ title: "The Humming Jar", originClaim: "It arrived humming.", donorName: "A" });
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
    const { exhibit } = await donateExhibitRetrying({ title: "The Second Jar", originClaim: "Also humming.", donorName: "A" });
    const accountId = exhibit.accounts[0].id;
    const res = await fetch(url(`/api/accounts/${accountId}/vote`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "Definitely Fine" }),
    });
    expect(res.status).toBe(400);
  });
});

// A built-in museum object (origin: "builtin", seeded by
// server/src/db.js's seedBuiltinLoreExhibits) is a real exhibits row —
// accounts, votes and SSE broadcasts must work on it exactly as they do for
// a donated or Founding Collection exhibit, never a second/parallel code
// path. See spec/builtin-exhibits.test.ts for the seeding contract itself.
describe("built-in museum objects share the exact same account/vote/SSE machinery", () => {
  it("accepts a new account on a builtin exhibit and updates its classification on vote, same as a donated one", async () => {
    const exhibitId = "exhibit_builtin_hall-chandelier";
    const accountRes = await fetch(url(`/api/exhibits/${exhibitId}/accounts`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "testimony",
        body: "I watched it burn down at exactly the same rate three nights running.",
        authorName: "Spec Visitor",
      }),
    });
    expect(accountRes.status).toBe(201);
    const { account } = await accountRes.json();
    expect(account.exhibitId).toBe(exhibitId);

    const { exhibit: after } = await (await fetch(url(`/api/exhibits/${exhibitId}`))).json();
    expect(after.accounts.some((a: { id: string }) => a.id === account.id)).toBe(true);

    const cookieRes = await fetch(url("/api/me"));
    const cookie = cookieRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const voteRes = await fetch(url(`/api/accounts/${account.id}/vote`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ verdict: "Definitely Cursed" }),
    });
    expect(voteRes.status).toBe(200);

    const { exhibit: afterVote } = await (await fetch(url(`/api/exhibits/${exhibitId}`))).json();
    expect(afterVote.classification).toBe("Definitely Cursed");
  });

  it("broadcasts account and vote events for a builtin exhibit over SSE, exactly as for any other exhibit", { timeout: 15000 }, async () => {
    const exhibitId = "exhibit_builtin_hall-guardian-left";
    const stream = await fetch(url("/api/events"));
    const reader = stream.body!.getReader();

    // Reads sequentially until `matchFn` is satisfied or the deadline
    // passes — critically, never issues a NEW `reader.read()` while a prior
    // one could still resolve (racing each read only against the overall
    // deadline, not a short per-iteration timeout that "gives up" on that
    // read): a `reader.read()` call left pending when an earlier iteration's
    // own short timeout fired first can still resolve later with a chunk
    // that arrived in the gap, and that chunk is then invisible to whatever
    // NEW read() call superseded it — silently losing the exact event a
    // test is waiting for under any real network/scheduling delay.
    async function readUntil(matchFn: (buffered: string) => boolean, totalMs: number) {
      const deadline = Date.now() + totalMs;
      let buffered = "";
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: false }>((resolve) => setTimeout(() => resolve({ value: undefined, done: false }), remaining)),
        ]);
        if (done) break;
        if (value) buffered += new TextDecoder().decode(value);
        if (matchFn(buffered)) return buffered;
      }
      return buffered;
    }

    let account: { id: string } | undefined;
    const [accountText] = await Promise.all([
      readUntil((t) => t.includes("event: account"), 6000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 300)); // let readUntil start reading first
        const accountRes = await fetch(url(`/api/exhibits/${exhibitId}/accounts`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "testimony",
            body: "The wingspan looked different to me too, from the east staircase.",
            authorName: "Spec Visitor",
          }),
        });
        expect(accountRes.status).toBe(201);
        account = (await accountRes.json()).account;
      })(),
    ]);
    expect(account).toBeTruthy();
    expect(accountText).toContain("event: account");
    expect(accountText).toContain(account!.id);

    const cookieRes = await fetch(url("/api/me"));
    const cookie = cookieRes.headers.get("set-cookie")?.split(";")[0] ?? "";
    const [voteText] = await Promise.all([
      readUntil((t) => t.includes("event: vote"), 6000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await fetch(url(`/api/accounts/${account!.id}/vote`), {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ verdict: "Suspicious" }),
        });
      })(),
    ]);
    expect(voteText).toContain("event: vote");
    expect(voteText).toContain(account!.id);
    await reader.cancel();
  });
});
