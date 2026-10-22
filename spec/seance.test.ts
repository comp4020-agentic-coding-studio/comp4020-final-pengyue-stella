// The Séance panel's server-side contract: POST /api/presence/interact lets
// one connected visitor reach a specific OTHER connected visitor currently
// sharing their room — a message, a fixed-vocabulary reaction, or a
// wordless reach-out — relayed only over that target's own open SSE
// connection(s), never persisted (CLAUDE.md: visitor presence/interaction
// stays ephemeral, the same way `focus` already does). Mirrors the exact
// readUntil-SSE-pattern and cookie-extraction idiom spec/archive.test.ts and
// spec/exhibit-ownership.test.ts already use, and the two-cookie/two-scene
// setup spec/world.test.ts's own focus-broadcast test already uses for
// "same room" vs. "different room" scoping.
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
    const { publicKey } = await connectInScene(cookie, "hall");
    const otherCookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(otherCookie, "hall");

    const res = await interact(otherCookie, { kind: "message", targetPublicKey: publicKey, body: "   " });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  it("rejects a message over 160 characters (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { publicKey } = await connectInScene(cookie, "hall");
    const otherCookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(otherCookie, "hall");

    const res = await interact(otherCookie, {
      kind: "message",
      targetPublicKey: publicKey,
      body: "x".repeat(161),
    });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  it("rejects an unknown reaction id (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { publicKey } = await connectInScene(cookie, "hall");
    const otherCookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(otherCookie, "hall");

    const res = await interact(otherCookie, {
      kind: "reaction",
      targetPublicKey: publicKey,
      reactionId: "not-a-real-reaction",
    });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  it("rejects an unknown interaction kind (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { publicKey } = await connectInScene(cookie, "hall");
    const otherCookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(otherCookie, "hall");

    const res = await interact(otherCookie, { kind: "shout", targetPublicKey: publicKey });
    expect(res.status).toBe(400);
    await reader.cancel();
  });

  it("rejects a request with no targetPublicKey (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const res = await interact(cookie, { kind: "reach-out" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/presence/interact: self-targeting", () => {
  it("rejects a sender targeting their own publicKey (400)", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { publicKey, reader } = await connectInScene(cookie, "hall");

    const res = await interact(cookie, { kind: "reach-out", targetPublicKey: publicKey });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/yourself/i);
    await reader.cancel();
  });
});

describe("POST /api/presence/interact: target must be connected and in the same room", () => {
  it("rejects a targetPublicKey that doesn't correspond to anyone currently connected", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const { reader } = await connectInScene(cookie, "hall");

    const res = await interact(cookie, { kind: "reach-out", targetPublicKey: "nobody-is-this-key" });
    expect([404, 400]).toContain(res.status);
    await reader.cancel();
  });

  it("rejects targeting a visitor connected in a DIFFERENT room", async () => {
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const galleryId = galleries[0].id;

    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, "hall");
    const b = await connectInScene(bCookie, `${galleryId}-main`);

    const res = await interact(aCookie, { kind: "reach-out", targetPublicKey: b.publicKey });
    expect(res.status).toBe(404);

    await a.reader.cancel();
    await b.reader.cancel();
  });

  it("allows targeting a visitor sharing a gallery's OTHER exact scene (main vs. closeup) — same logical room", async () => {
    const { galleries } = await (await fetch(url("/api/world"))).json();
    const galleryId = galleries[0].id;

    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, `${galleryId}-main`);
    const b = await connectInScene(bCookie, `${galleryId}-closeup`);

    const res = await interact(aCookie, { kind: "reach-out", targetPublicKey: b.publicKey });
    expect(res.status).toBe(200);

    await a.reader.cancel();
    await b.reader.cancel();
  });
});

describe("POST /api/presence/interact: rate limiting", () => {
  it("rejects a rapid repeated reaction with 429", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));
    const a = await connectInScene(aCookie, "hall");
    const b = await connectInScene(bCookie, "hall");

    const first = await interact(aCookie, { kind: "reaction", targetPublicKey: b.publicKey, reactionId: "wave" });
    expect(first.status).toBe(200);
    const second = await interact(aCookie, { kind: "reaction", targetPublicKey: b.publicKey, reactionId: "wave" });
    expect(second.status).toBe(429);

    await a.reader.cancel();
    await b.reader.cancel();
  });
});

describe("POST /api/presence/interact: delivery over SSE", () => {
  it("delivers a message to the target's own connection, and not to an unrelated third connection in the same room", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));
    const cCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, "hall");
    const b = await connectInScene(bCookie, "hall");
    const c = await connectInScene(cCookie, "hall");

    const messageBody = `A whisper ${Date.now()}`;
    const [bText] = await Promise.all([
      readUntil(b.reader, (t) => t.includes("event: interact"), 4000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await interact(aCookie, { kind: "message", targetPublicKey: b.publicKey, body: messageBody });
        expect(res.status).toBe(200);
      })(),
    ]);
    expect(bText).toContain("event: interact");
    expect(bText).toContain(messageBody);
    expect(bText).toContain(a.publicKey);

    // C, an unrelated third connection in the very same room, must never
    // see this targeted interaction — it's relayed only to B's own
    // connection (sse.js's broadcastToVisitor), never broadcast room-wide.
    const cText = await readUntil(c.reader, (t) => t.includes("event: interact"), 800);
    expect(cText).not.toContain("event: interact");

    await a.reader.cancel();
    await b.reader.cancel();
    await c.reader.cancel();
  });

  it("delivers a reaction to the target's own connection, scoped the same way", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const a = await connectInScene(aCookie, "hall");
    const b = await connectInScene(bCookie, "hall");

    const [bText] = await Promise.all([
      readUntil(b.reader, (t) => t.includes("event: interact"), 4000),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const res = await interact(aCookie, { kind: "reaction", targetPublicKey: b.publicKey, reactionId: "bow" });
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
        const res = await interact(aCookie, { kind: "reach-out", targetPublicKey: b.publicKey });
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
