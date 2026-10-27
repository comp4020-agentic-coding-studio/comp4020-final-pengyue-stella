// The Séance panel's server-side contract: POST /api/presence/interact is a
// ROOM-SCOPED group broadcast — a message, a fixed-vocabulary reaction, or a
// wordless reach-out sent by one connected visitor reaches every OTHER
// connected visitor currently sharing their own logical room (a gallery's
// `-main` and `-closeup` scenes count as the same room), never a single
// targeted visitor, never a different room, never museum-wide. The room is
// derived from the sender's own real scene on their open SSE connection
// (never a client-supplied roomId or targetPublicKey). Never persisted
// (CLAUDE.md: visitor presence/interaction stays ephemeral, the same way
// `focus` already does). Mirrors the exact readUntil-SSE-pattern and
// cookie-extraction idiom spec/archive.test.ts and spec/exhibit-ownership.
// test.ts already use, and the two-cookie/two-scene setup spec/world.test.ts's
// own focus-broadcast test already uses for "same room" vs. "different room"
// scoping.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

function cookieFrom(res: Response): string {
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("expected a visitor cookie");
  return cookie;
}

// Reads sequentially against one overall deadline, never issuing a new
// read() while a prior one could still resolve — copied from spec/
// archive.test.ts's own readUntil rather than reinvented, per this repo's
// existing per-file-helper convention for spec files that don't share a
// module.
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  matchFn: (buffered: string) => boolean,
  totalMs: number,
): Promise<string> {
  const deadline = Date.now() + totalMs;
  let buffered = "";
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: false }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: false }), remaining),
      ),
    ]);
    if (done) break;
    if (value) buffered += new TextDecoder().decode(value);
    if (matchFn(buffered)) return buffered;
  }
  return buffered;
}

function parseHello(text: string): { yourPublicKey: string } {
  const chunk = text.split("\n\n").find((c) => c.includes("event: hello"));
  const dataLine = chunk!.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(dataLine!.slice("data: ".length));
}

async function connectInScene(cookie: string, sceneId: string) {
  const stream = await fetch(url(`/api/events?scene=${encodeURIComponent(sceneId)}`), {
    headers: { Cookie: cookie },
  });
  const reader = stream.body!.getReader();
  const hello = await readUntil(reader, (t) => t.includes("event: hello"), 2000);
  const { yourPublicKey } = parseHello(hello);
  return { reader, publicKey: yourPublicKey };
}

async function interact(cookie: string, body: Record<string, unknown>) {
  return fetch(url("/api/presence/interact"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

describe("POST /api/presence/interact: validation", () => {
  it("rejects a message with no body (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(cookie, "hall");

    const res = await interact(cookie, { kind: "message", body: "   " });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  it("rejects a message over 160 characters (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(cookie, "hall");

    const res = await interact(cookie, { kind: "message", body: "x".repeat(161) });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  it("rejects an unknown reaction id (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(cookie, "hall");

    const res = await interact(cookie, { kind: "reaction", reactionId: "not-a-real-reaction" });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  it("rejects an unknown interaction kind (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(cookie, "hall");

    const res = await interact(cookie, { kind: "shout" });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  // targetPublicKey is no longer part of the contract at all — a group
  // interaction needs no target, only the sender's own current room.
  it("no longer requires (or looks at) a targetPublicKey", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(cookie, "hall");

    const res = await interact(cookie, { kind: "reach-out", targetPublicKey: "ignored-if-present" });
    expect(res.status).toBe(200);
    await reader.cancel();
  });
});

describe("POST /api/presence/interact: sender must be in a room", () => {
  it("rejects an interaction from a visitor with no open scene connection", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    // Never connects to /api/events — has no live SSE scene to broadcast from.
    const res = await interact(cookie, { kind: "reach-out" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/presence/interact: rate limiting", () => {
  it("rejects a rapid repeated reaction with 429", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const a = await connectInScene(aCookie, "hall");

    const first = await interact(aCookie, { kind: "reaction", reactionId: "wave" });
    expect(first.status).toBe(200);
    const second = await interact(aCookie, { kind: "reaction", reactionId: "wave" });
    expect(second.status).toBe(429);

    await a.reader.cancel();
  });
});

describe("POST /api/presence/interact: room-scoped group delivery over SSE", () => {
  it("delivers a message to every OTHER visitor in the sender's room, not back to the sender's own connection", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));
    const cCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, "hall");
    const b = await connectInScene(bCookie, "hall");
    const c = await connectInScene(cCookie, "hall");

    const messageBody = `A whisper to the room ${Date.now()}`;
    const [bText, cText] = await Promise.all([
      readUntil(b.reader, (t) => t.includes("event: interact"), 4000),
      readUntil(c.reader, (t) => t.includes("event: interact"), 4000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await interact(aCookie, { kind: "message", body: messageBody });
        expect(res.status).toBe(200);
        const data = await res.json();
        // delivered counts every OTHER connection in the room — at least B
        // and C (other spec files running concurrently against this same
        // server may hold their own unrelated "hall" connections open too,
        // so this is a floor, not an exact count).
        expect(data.delivered).toBeGreaterThanOrEqual(2);
      })(),
    ]);
    expect(bText).toContain("event: interact");
    expect(bText).toContain(messageBody);
    expect(bText).toContain(a.publicKey);
    expect(cText).toContain("event: interact");
    expect(cText).toContain(messageBody);
    expect(cText).toContain(a.publicKey);

    // The sender's OWN connection never receives its own broadcast echoed
    // back over SSE — their own tab renders it locally on send instead.
    const aText = await readUntil(a.reader, (t) => t.includes("event: interact"), 800);
    expect(aText).not.toContain("event: interact");

    await a.reader.cancel();
    await b.reader.cancel();
    await c.reader.cancel();
  });

  it("delivers to a visitor sharing a gallery's OTHER exact scene (main vs. closeup) — same logical room", async () => {
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const galleryId = galleries[0].id;

    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, `${galleryId}-main`);
    const b = await connectInScene(bCookie, `${galleryId}-closeup`);

    const [bText] = await Promise.all([
      readUntil(b.reader, (t) => t.includes("event: interact"), 4000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await interact(aCookie, { kind: "reach-out" });
        expect(res.status).toBe(200);
      })(),
    ]);
    expect(bText).toContain("event: interact");
    expect(bText).toContain("reach-out");

    await a.reader.cancel();
    await b.reader.cancel();
  });

  it("never delivers to a visitor connected in a DIFFERENT room", async () => {
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const galleryId = galleries[0].id;

    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const dCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, "hall");
    const d = await connectInScene(dCookie, `${galleryId}-main`);

    const res = await interact(aCookie, { kind: "reach-out" });
    expect(res.status).toBe(200);

    // D, connected in a different gallery room, must never receive this —
    // the real assertion is D's own stream staying silent, not a global
    // delivered count (other spec files running concurrently against this
    // same server may hold their own unrelated "hall" connections open too).
    const dText = await readUntil(d.reader, (t) => t.includes("event: interact"), 800);
    expect(dText).not.toContain("event: interact");

    await a.reader.cancel();
    await d.reader.cancel();
  });

  it("delivers a reaction to the whole room, carrying the fixed reactionId", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, "hall");
    const b = await connectInScene(bCookie, "hall");

    const [bText] = await Promise.all([
      readUntil(b.reader, (t) => t.includes("event: interact"), 4000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await interact(aCookie, { kind: "reaction", reactionId: "bow" });
        expect(res.status).toBe(200);
      })(),
    ]);
    expect(bText).toContain("event: interact");
    expect(bText).toContain("bow");
    expect(bText).toContain(a.publicKey);

    await a.reader.cancel();
    await b.reader.cancel();
  });

  it("delivers a reach-out with its own kind, carrying no body/reactionId", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, "hall");
    const b = await connectInScene(bCookie, "hall");

    const [bText] = await Promise.all([
      readUntil(b.reader, (t) => t.includes("event: interact"), 4000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await interact(aCookie, { kind: "reach-out" });
        expect(res.status).toBe(200);
      })(),
    ]);
    expect(bText).toContain("event: interact");
    expect(bText).toContain("reach-out");

    await a.reader.cancel();
    await b.reader.cancel();
  });
});

describe("GET /api/reactions", () => {
  it("publishes the fixed reaction vocabulary the Séance panel renders", async () => {
    const res = await fetch(url("/api/reactions"));
    expect(res.status).toBe(200);
    const { reactions } = await res.json();
    expect(Array.isArray(reactions)).toBe(true);
    expect(reactions.length).toBeGreaterThan(0);
    for (const r of reactions) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.label).toBe("string");
    }
  });
});
