import { createServer } from "node:http";
import { identify, nameCookieFor } from "./identity.js";
import { GALLERY_IDS, publicWorld, isWalkable } from "./world.js";
import * as db from "./db.js";
import * as sse from "./sse.js";
import { serveStatic } from "./static.js";
import { renderReadmePage } from "./readme-page.js";
import {
  ACCOUNT_KIND_SET,
  VERDICT_SET,
  MAX_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_ACCOUNT_LENGTH,
  MAX_CLAIM_LENGTH,
  DONATE_COOLDOWN_MS,
  ACCOUNT_COOLDOWN_MS,
  MOVE_MIN_INTERVAL_MS,
} from "./constants.js";

const PORT = Number(process.env.PORT ?? 8080);

const lastDonateAt = new Map(); // visitorId -> epoch ms
const lastAccountAt = new Map();
const lastMoveAt = new Map();

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function withCookies(headers, identity, extra = []) {
  const cookies = [...(identity.setCookieHeaders ?? []), ...extra];
  if (cookies.length === 0) return headers;
  return { ...headers, "Set-Cookie": cookies };
}

async function readJsonBody(req, limit = 8192) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function isNonEmptyString(v, max) {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const { pathname } = url;

  try {
    if (req.method === "GET" && pathname === "/") {
      const identity = identify(req);
      const { body } = await serveStatic("/index.html");
      res.writeHead(200, withCookies({ "Content-Type": "text/html; charset=utf-8" }, identity));
      res.end(body);
      return;
    }

    if (req.method === "GET" && (pathname === "/readme/" || pathname === "/readme")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderReadmePage());
      return;
    }

    if (req.method === "GET" && pathname === "/api/world") {
      json(res, 200, publicWorld());
      return;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      const identity = identify(req);
      db.upsertVisitor(identity.id, identity.name);
      json(res, 200, { name: identity.name, color: identity.color }, withCookies({}, identity));
      return;
    }

    if (req.method === "POST" && pathname === "/api/me") {
      const identity = identify(req);
      let payload;
      try {
        payload = await readJsonBody(req, 256);
      } catch {
        json(res, 400, { error: "bad request body" }, withCookies({}, identity));
        return;
      }
      const nameCookie = nameCookieFor(payload.name);
      if (!nameCookie) {
        json(res, 400, { error: "invalid display name" }, withCookies({}, identity));
        return;
      }
      const name = decodeURIComponent(nameCookie.split(";")[0].split("=")[1]);
      db.upsertVisitor(identity.id, name);
      json(res, 200, { name, color: identity.color }, withCookies({}, identity, [nameCookie]));
      return;
    }

    if (req.method === "GET" && pathname === "/api/exhibits") {
      const identity = identify(req);
      json(res, 200, { exhibits: db.allExhibits(identity.id) }, withCookies({}, identity));
      return;
    }

    const exhibitMatch = pathname.match(/^\/api\/exhibits\/([a-zA-Z0-9_-]+)$/);
    if (req.method === "GET" && exhibitMatch) {
      const identity = identify(req);
      const exhibit = db.exhibitById(exhibitMatch[1], identity.id);
      if (!exhibit) {
        json(res, 404, { error: "no such exhibit" }, withCookies({}, identity));
        return;
      }
      json(res, 200, { exhibit }, withCookies({}, identity));
      return;
    }

    if (req.method === "POST" && pathname === "/api/exhibits") {
      const identity = identify(req);
      const last = lastDonateAt.get(identity.id) ?? 0;
      const now = Date.now();
      if (now - last < DONATE_COOLDOWN_MS) {
        json(res, 429, { error: "one donation at a time — wait a moment" }, withCookies({}, identity));
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req);
      } catch {
        json(res, 400, { error: "bad request body" }, withCookies({}, identity));
        return;
      }

      const { galleryId, slotId } = payload;
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      const originClaim = typeof payload.originClaim === "string" ? payload.originClaim.trim() : "";
      const donorName = typeof payload.donorName === "string" ? payload.donorName.trim() : identity.name;

      if (
        !GALLERY_IDS.has(galleryId) ||
        typeof slotId !== "string" ||
        !isNonEmptyString(title, MAX_TITLE_LENGTH) ||
        !isNonEmptyString(originClaim, MAX_CLAIM_LENGTH) ||
        !isNonEmptyString(donorName, MAX_NAME_LENGTH)
      ) {
        json(res, 400, { error: "invalid donation" }, withCookies({}, identity));
        return;
      }

      const result = db.donateExhibit({
        galleryId,
        slotId,
        title,
        originClaim,
        donorName,
        visitorId: identity.id,
      });

      if (result.error === "not_found") {
        json(res, 400, { error: "unknown gallery or slot" }, withCookies({}, identity));
        return;
      }
      if (result.error === "slot_taken") {
        json(res, 409, { error: "that slot is already occupied" }, withCookies({}, identity));
        return;
      }

      sse.broadcast("exhibit", result.exhibit);
      lastDonateAt.set(identity.id, now);
      json(res, 201, { exhibit: result.exhibit }, withCookies({}, identity));
      return;
    }

    const accountsMatch = pathname.match(/^\/api\/exhibits\/([a-zA-Z0-9_-]+)\/accounts$/);
    if (req.method === "POST" && accountsMatch) {
      const identity = identify(req);
      const last = lastAccountAt.get(identity.id) ?? 0;
      const now = Date.now();
      if (now - last < ACCOUNT_COOLDOWN_MS) {
        json(res, 429, { error: "wait a moment before publishing another account" }, withCookies({}, identity));
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req);
      } catch {
        json(res, 400, { error: "bad request body" }, withCookies({}, identity));
        return;
      }

      const { kind, challengedAccountId } = payload;
      const body = typeof payload.body === "string" ? payload.body.trim() : "";
      const authorName = typeof payload.authorName === "string" ? payload.authorName.trim() : identity.name;

      if (
        !ACCOUNT_KIND_SET.has(kind) ||
        !isNonEmptyString(body, MAX_ACCOUNT_LENGTH) ||
        !isNonEmptyString(authorName, MAX_NAME_LENGTH) ||
        (challengedAccountId !== undefined && typeof challengedAccountId !== "string")
      ) {
        json(res, 400, { error: "invalid account" }, withCookies({}, identity));
        return;
      }

      const result = db.addAccount({
        exhibitId: accountsMatch[1],
        kind,
        body,
        challengedAccountId: challengedAccountId ?? null,
        authorName,
        visitorId: identity.id,
      });

      if (result.error === "not_found") {
        json(res, 404, { error: "no such exhibit or challenged account" }, withCookies({}, identity));
        return;
      }

      sse.broadcast("account", { ...result.account, exhibitClassification: result.exhibitClassification });
      lastAccountAt.set(identity.id, now);
      json(res, 201, { account: result.account }, withCookies({}, identity));
      return;
    }

    const voteMatch = pathname.match(/^\/api\/accounts\/([a-zA-Z0-9_-]+)\/vote$/);
    if (req.method === "POST" && voteMatch) {
      // Deliberately not rate-limited like donate/account: the blueprint
      // treats changing your mind as ordinary use ("permit vote change
      // rather than duplicate votes"), and the upsert-per-(account,visitor)
      // constraint already prevents any actual spam accumulation — there is
      // nothing here a cooldown would protect that the unique constraint
      // doesn't already handle.
      const identity = identify(req);
      let payload;
      try {
        payload = await readJsonBody(req, 256);
      } catch {
        json(res, 400, { error: "bad request body" }, withCookies({}, identity));
        return;
      }

      if (!VERDICT_SET.has(payload.verdict)) {
        json(res, 400, { error: "invalid verdict" }, withCookies({}, identity));
        return;
      }

      const result = db.castVote({
        accountId: voteMatch[1],
        visitorId: identity.id,
        verdict: payload.verdict,
      });

      if (result.error === "not_found") {
        json(res, 404, { error: "no such account" }, withCookies({}, identity));
        return;
      }

      sse.broadcast("vote", { ...result.account, exhibitClassification: result.exhibitClassification });
      json(res, 200, { account: result.account }, withCookies({}, identity));
      return;
    }

    if (req.method === "POST" && pathname === "/api/presence/move") {
      const identity = identify(req);
      const last = lastMoveAt.get(identity.id) ?? 0;
      const now = Date.now();
      if (now - last < MOVE_MIN_INTERVAL_MS) {
        // Silently dropped, not an error: a client posting faster than the
        // floor is just told nothing changed server-side this time.
        json(res, 204, {});
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req, 512);
      } catch {
        json(res, 400, { error: "bad request body" }, withCookies({}, identity));
        return;
      }

      const { x, z, yaw } = payload;
      if (
        typeof x !== "number" || !Number.isFinite(x) ||
        typeof z !== "number" || !Number.isFinite(z) ||
        typeof yaw !== "number" || !Number.isFinite(yaw) ||
        !isWalkable(x, z)
      ) {
        json(res, 400, { error: "invalid position" }, withCookies({}, identity));
        return;
      }

      lastMoveAt.set(identity.id, now);
      sse.recordAndBroadcastMove(identity.id, {
        x, z, yaw,
        name: identity.name,
        color: identity.color,
      });
      json(res, 200, { ok: true }, withCookies({}, identity));
      return;
    }

    if (req.method === "GET" && pathname === "/api/events") {
      const identity = identify(req);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 2000\n\n`);

      // Hydrate the new connection with everyone already known to be
      // present, so it doesn't wait for their next move to draw them.
      res.write(
        `event: hello\ndata: ${JSON.stringify({
          you: identity.id,
          presence: sse.knownPresence(identity.id),
        })}\n\n`,
      );

      sse.addClient(res, identity.id);
      req.on("close", () => {
        const { visitorId, stillConnected } = sse.removeClient(res);
        if (visitorId && !stillConnected) sse.broadcastDeparture(visitorId);
      });
      return;
    }

    if (req.method === "GET") {
      const file = await serveStatic(pathname);
      if (file) {
        res.writeHead(200, { "Content-Type": file.contentType });
        res.end(file.body);
        return;
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("request failed:", err);
    json(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`The Cursed Museum listening on :${PORT}`);
});
