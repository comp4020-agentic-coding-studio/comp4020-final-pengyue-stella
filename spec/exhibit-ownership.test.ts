// Owner-only edit/delete for donated exhibits — a brand new feature on top
// of the donate/account/vote machinery spec/archive.test.ts already covers.
// Ownership is checked against the real donor_visitor_id column (never the
// free-text donorName), so a different visitor cookie must always get 403,
// the actual owner must be able to PATCH/DELETE, a builtin/founding exhibit
// (no real owner) must always reject, and the freed display slot must become
// donatable again immediately after a delete commits.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

type Surface = {
  id: string;
  allowedRelicTypes: string[];
  shape: { type: string; points?: [number, number][]; cx?: number; cy?: number; rx?: number; ry?: number };
};

// Mirrors spec/archive.test.ts's own freeSlot()/donateRetrying() helpers
// exactly (including the 0.22 MIN_SURFACE_SEPARATION constant and the same
// deterministic candidate-point grid) — copied rather than imported since
// these spec files don't share a module, matching this repo's existing
// per-file-helper convention.
const MIN_SURFACE_SEPARATION = 0.22;

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

async function donate(body: Record<string, unknown>, cookie?: string) {
  return fetch(url("/api/exhibits"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function donateRetrying(extra: Record<string, unknown>, cookie?: string) {
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const placement = await freeSlot();
    res = await donate({ ...placement, ...extra }, cookie);
    if (res.status !== 409) return { res, placement };
  }
  return { res: res!, placement: await freeSlot() };
}

async function freshCookie(): Promise<string> {
  const res = await fetch(url("/api/me"));
  return res.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function donateAsOwner(title: string) {
  const cookie = await freshCookie();
  const { res, placement } = await donateRetrying(
    { title, originClaim: "Original claim.", donorName: "Owner" },
    cookie,
  );
  expect(res.status).toBe(201);
  const { exhibit } = await res.json();
  return { exhibit, ownerCookie: cookie, placement };
}

describe("owner-only exhibit edit", () => {
  it("lets the donor edit the title, rejects a different visitor with 403, and the exhibit is unchanged", async () => {
    const title = `Owned Relic ${Date.now()}`;
    const { exhibit, ownerCookie } = await donateAsOwner(title);
    expect(exhibit.isOwnedByRequester).toBe(true);

    const otherCookie = await freshCookie();
    const otherGetRes = await fetch(url(`/api/exhibits/${exhibit.id}`), { headers: { Cookie: otherCookie } });
    const otherGet = await otherGetRes.json();
    expect(otherGet.exhibit.isOwnedByRequester).toBe(false);

    const forbidden = await fetch(url(`/api/exhibits/${exhibit.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: otherCookie },
      body: JSON.stringify({ title: "Hijacked Title" }),
    });
    expect(forbidden.status).toBe(403);

    const unchanged = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(unchanged.exhibit.title).toBe(title);

    const newTitle = `${title} (edited)`;
    const ownerPatch = await fetch(url(`/api/exhibits/${exhibit.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ title: newTitle }),
    });
    expect(ownerPatch.status).toBe(200);
    const patched = await ownerPatch.json();
    expect(patched.exhibit.title).toBe(newTitle);

    // Persists on reload (a fresh GET, not just the mutating response).
    const reread = await (await fetch(url(`/api/exhibits/${exhibit.id}`))).json();
    expect(reread.exhibit.title).toBe(newTitle);
  });

  it("publishes an origin-claim edit as a brand new revision account, never overwriting the original", async () => {
    const { exhibit, ownerCookie } = await donateAsOwner(`Revision Relic ${Date.now()}`);
    const originalAccountId = exhibit.accounts[0].id;
    const originalBody = exhibit.accounts[0].body;

    const res = await fetch(url(`/api/exhibits/${exhibit.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ originClaim: "A revised, more complete origin story." }),
    });
    expect(res.status).toBe(200);
    const { exhibit: after } = await res.json();

    expect(after.accounts.length).toBe(2);
    const original = after.accounts.find((a: { id: string }) => a.id === originalAccountId);
    expect(original.body).toBe(originalBody); // never mutated
    const revision = after.accounts.find((a: { kind: string }) => a.kind === "revision");
    expect(revision).toBeTruthy();
    expect(revision.body).toBe("A revised, more complete origin story.");
    expect(revision.challengedAccountId).toBe(originalAccountId);
  });
});

describe("owner-only exhibit delete", () => {
  it("rejects a different visitor with 403 and leaves the exhibit intact", async () => {
    const { exhibit } = await donateAsOwner(`Protected Relic ${Date.now()}`);
    const otherCookie = await freshCookie();

    const forbidden = await fetch(url(`/api/exhibits/${exhibit.id}`), {
      method: "DELETE",
      headers: { Cookie: otherCookie },
    });
    expect(forbidden.status).toBe(403);

    const stillThere = await fetch(url(`/api/exhibits/${exhibit.id}`));
    expect(stillThere.status).toBe(200);
  });

  it("lets the owner delete: it vanishes from the list and its own GET, and the freed slot is donatable again", async () => {
    const { exhibit, ownerCookie, placement } = await donateAsOwner(`Withdrawable Relic ${Date.now()}`);

    const del = await fetch(url(`/api/exhibits/${exhibit.id}`), {
      method: "DELETE",
      headers: { Cookie: ownerCookie },
    });
    expect(del.status).toBe(200);

    const getAfter = await fetch(url(`/api/exhibits/${exhibit.id}`));
    expect(getAfter.status).toBe(404);

    const { exhibits } = await (await fetch(url("/api/exhibits"))).json();
    expect(exhibits.some((e: { id: string }) => e.id === exhibit.id)).toBe(false);

    // The exact freed slotId must be donatable again immediately — a new
    // donation targeting it directly (not just "some free slot") must
    // succeed, proving the slot was actually released inside the delete's
    // own transaction (CLAUDE.md: a unique constraint, not check-then-write).
    const secondCookie = await freshCookie();
    const second = await donate(
      {
        galleryId: placement.galleryId,
        slotId: placement.slotId,
        surfaceId: placement.surfaceId,
        u: placement.u,
        v: placement.v,
        subtype: placement.subtype,
        visualId: placement.visualId,
        title: "Reclaimed the freed slot",
        originClaim: "A new donation into the exact slot the withdrawn relic left behind.",
        donorName: "Second Owner",
      },
      secondCookie,
    );
    expect(second.status).toBe(201);
    const { exhibit: reclaimed } = await second.json();
    expect(reclaimed.slotId).toBe(placement.slotId);
  });
});

describe("builtin and founding exhibits have no owner", () => {
  it("rejects PATCH and DELETE on a builtin exhibit for any visitor", async () => {
    const exhibitId = "exhibit_builtin_hall-guardian-right";
    const cookie = await freshCookie();

    const patch = await fetch(url(`/api/exhibits/${exhibitId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Should never work" }),
    });
    expect(patch.status).toBe(403);

    const del = await fetch(url(`/api/exhibits/${exhibitId}`), { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(403);

    const { exhibit } = await (await fetch(url(`/api/exhibits/${exhibitId}`), { headers: { Cookie: cookie } })).json();
    expect(exhibit.isOwnedByRequester).toBe(false);
  });

  it("rejects PATCH and DELETE on a Founding Collection exhibit for any visitor", async () => {
    const exhibitId = "exhibit_founding_memento";
    const cookie = await freshCookie();

    const patch = await fetch(url(`/api/exhibits/${exhibitId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Should never work" }),
    });
    expect(patch.status).toBe(403);

    const del = await fetch(url(`/api/exhibits/${exhibitId}`), { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(403);
  });
});

describe("realtime: exhibit.updated / exhibit.deleted are scoped correctly over SSE", () => {
  it("broadcasts exhibit.updated to another visitor's connection without ever including isOwnedByRequester", async () => {
    const { exhibit, ownerCookie } = await donateAsOwner(`SSE Edit Relic ${Date.now()}`);

    const stream = await fetch(url("/api/events"));
    const reader = stream.body!.getReader();

    // Same readUntil helper as spec/archive.test.ts's own SSE test — reads
    // sequentially against one overall deadline, never issuing a new read()
    // while a prior one could still resolve.
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

    const newTitle = `${exhibit.title} (via SSE)`;
    const [eventText] = await Promise.all([
      readUntil((t) => t.includes("event: exhibit.updated"), 6000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const res = await fetch(url(`/api/exhibits/${exhibit.id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: ownerCookie },
          body: JSON.stringify({ title: newTitle }),
        });
        expect(res.status).toBe(200);
      })(),
    ]);
    expect(eventText).toContain("event: exhibit.updated");
    expect(eventText).toContain(newTitle);
    // The shared broadcast payload must never carry the per-requester
    // isOwnedByRequester field — it's only ever correct for the one
    // requester who triggered the change, not for every other connected
    // client that receives this same event.
    const dataLine = eventText.split("event: exhibit.updated")[1]?.split("\n").find((l) => l.startsWith("data:")) ?? "";
    expect(dataLine).not.toContain("isOwnedByRequester");

    await reader.cancel();
  });

  it("broadcasts exhibit.deleted with just the exhibitId", async () => {
    const { exhibit, ownerCookie } = await donateAsOwner(`SSE Delete Relic ${Date.now()}`);

    const stream = await fetch(url("/api/events"));
    const reader = stream.body!.getReader();

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

    const [eventText] = await Promise.all([
      readUntil((t) => t.includes("event: exhibit.deleted"), 6000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const res = await fetch(url(`/api/exhibits/${exhibit.id}`), { method: "DELETE", headers: { Cookie: ownerCookie } });
        expect(res.status).toBe(200);
      })(),
    ]);
    expect(eventText).toContain("event: exhibit.deleted");
    expect(eventText).toContain(exhibit.id);

    await reader.cancel();
  });
});
