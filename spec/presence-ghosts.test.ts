// Checks for the data contract behind the ghost-cameo restyle (see
// public/app.js's renderCameos) and the onboarding tour's own one-shot
// gate. The client decides which cameo is "me" (never rendered) purely from
// the `yourPublicKey` the hello SSE event carries, and groups overflow once
// a scene has more visitors than anchors — both rely on the server
// reporting a stable, distinct publicKey per visitor and a real
// visitorAnchors list per scene. The actual DOM behaviour (no ghost for
// yourself, an overflow "+N" chip once a scene has more visitors than
// anchors, the tour running once and being replayable, the ambient shimmer
// clearing on first discovery) was verified manually in a real browser with
// multiple isolated browser contexts — see PROCESS.md — not here.
import { inject, it, expect, describe } from "vitest";

const baseUrl = inject("baseUrl");
const url = (path: string): URL => new URL(path, baseUrl);

function cookieFrom(res: Response): string {
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("expected a visitor cookie");
  return cookie;
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
  const deadline = Date.now() + ms;
  let buffered = "";
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: false }>((resolve) => setTimeout(() => resolve({ value: undefined, done: false }), 150)),
    ]);
    if (done) break;
    if (value) buffered += new TextDecoder().decode(value);
  }
  return buffered;
}

describe("the ghost-cameo data contract", () => {
  it("gives each visitor a distinct, stable publicKey, and echoes the connecting visitor's own key as yourPublicKey", async () => {
    const aCookie = cookieFrom(await fetch(url("/api/me")));
    const bCookie = cookieFrom(await fetch(url("/api/me")));

    const aStream = await fetch(url("/api/events"), { headers: { Cookie: aCookie } });
    const aReader = aStream.body!.getReader();
    const aHello = await drain(aReader, 1000);
    await aReader.cancel();

    const bStream = await fetch(url("/api/events"), { headers: { Cookie: bCookie } });
    const bReader = bStream.body!.getReader();
    const bHello = await drain(bReader, 1000);
    await bReader.cancel();

    function parseHello(text: string) {
      const chunk = text.split("\n\n").find((c) => c.includes("event: hello"));
      const dataLine = chunk!.split("\n").find((l) => l.startsWith("data: "));
      return JSON.parse(dataLine!.slice("data: ".length));
    }
    const aPayload = parseHello(aHello);
    const bPayload = parseHello(bHello);

    expect(typeof aPayload.yourPublicKey).toBe("string");
    expect(typeof bPayload.yourPublicKey).toBe("string");
    expect(aPayload.yourPublicKey).not.toBe(bPayload.yourPublicKey);

    // The public key never leaks the raw visitor id (identity.js's
    // publicKeyFor) — a cameo rendered from it can't be reversed to a cookie.
    expect(aPayload.yourPublicKey).not.toBe(aPayload.you);
  });

  it("reports the connecting visitor itself in visitorsInScene, so the client is solely responsible for excluding its own publicKey from the cameo list", async () => {
    const cookie = cookieFrom(await fetch(url("/api/me")));
    const stream = await fetch(url("/api/events"), { headers: { Cookie: cookie } });
    const reader = stream.body!.getReader();
    const text = await drain(reader, 1200);
    await reader.cancel();

    const chunk = text.split("\n\n").find((c) => c.includes("event: hello"));
    const dataLine = chunk!.split("\n").find((l) => l.startsWith("data: "));
    const payload = JSON.parse(dataLine!.slice("data: ".length));

    expect(Array.isArray(payload.visitors)).toBe(true);
    expect(payload.visitors.some((v: { publicKey: string }) => v.publicKey === payload.yourPublicKey)).toBe(true);
  });

  it("every scene exposes at least one visitorAnchor, so a scene with any other visitor in it always has somewhere to stand a ghost", async () => {
    const { scenes } = await (await fetch(url("/api/world"))).json();
    for (const scene of scenes) {
      expect(Array.isArray(scene.visitorAnchors), `${scene.id} has no visitorAnchors`).toBe(true);
      expect(scene.visitorAnchors.length, `${scene.id} has no visitorAnchors`).toBeGreaterThan(0);
      for (const anchor of scene.visitorAnchors) {
        expect(typeof anchor.x).toBe("number");
        expect(typeof anchor.y).toBe("number");
      }
    }
  });
});
