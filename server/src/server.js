import { createServer } from "node:http";
import { identify, nameCookieFor, publicKeyFor } from "./identity.js";
import { galleryById, publicWorld, SCENE_IDS, DEFAULT_SCENE_ID } from "./world.js";
import * as db from "./db.js";
import * as sse from "./sse.js";
import { serveStatic } from "./static.js";
import { renderReadmePage } from "./readme-page.js";
import { RELIC_PRESETS } from "./relic-presets.js";
import {
  ACCOUNT_KIND_SET,
  VERDICT_SET,
  SUBTYPES_BY_CATEGORY,
  MAX_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_ACCOUNT_LENGTH,
  MAX_CLAIM_LENGTH,
  DONATE_COOLDOWN_MS,
  ACCOUNT_COOLDOWN_MS,
  PRESENCE_MIN_INTERVAL_MS,
  FOCUS_MIN_INTERVAL_MS,
} from "./constants.js";

const PORT = Number(process.env.PORT ?? 8080);

// A freshly-created database starts with a small, honestly-identified
// Founding Collection rather than an empty archive — see db.js's own
// comment for why this is safe against the free-slot tests and real donors
// alike (it only ever claims each gallery's first slot).
db.seedFoundingCollection();
// Every built-in museum object (chandelier, busts, mirrors, etc.) becomes a
// real seeded exhibit too, so it gets the same dossier/accounts/votes
// machinery a donated relic does — see db.js's own comment.
db.seedBuiltinLoreExhibits();
// Backfill a curated visual onto any exhibit donated/seeded before the
// preset catalog existed, so no primitive procedural model ever renders in
// a visible illustrated gallery — see db.js's own comment.
db.backfillLegacyVisualIds();

const lastDonateAt = new Map(); // visitorId -> epoch ms
const lastAccountAt = new Map();
const lastPresenceAt = new Map();
const lastFocusAt = new Map();

// A focus object id is always rendered via textContent/attribute, never
// HTML, on the client, and is only ever one of the fixed, server-authored
// `object:<id>` / `exhibit:<id>` strings the world graph or an exhibit
// record already produced — but the server still bounds its length and
// shape before relaying it to every other visitor in the room, the same
// "never trust a client-supplied value past a sanity check" discipline the
// rest of this file applies to every other write.
const FOCUS_OBJECT_ID_PATTERN = /^(object|exhibit):[A-Za-z0-9_-]{1,80}$/;

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

// Structured, legible action logs — "who did what, to which thing, with what
// outcome" — the shape a crit-10 demonstration narrates from, without ever
// printing a cookie, a full header, or an account's actual body text (see
// CLAUDE.md). `identity.id` is a full UUID; only its first 8 hex characters
// are logged, which is already enough to distinguish visitors in a live demo
// without printing the literal cookie value.
function logAction(identity, action, detail, outcome = "ok") {
  const shortId = identity.id.slice(0, 8);
  const extra = detail ? ` ${Object.entries(detail).map(([k, v]) => `${k}=${v}`).join(" ")}` : "";
  console.log(`[action] visitor=${shortId} name="${identity.name}" action=${action}${extra} outcome=${outcome}`);
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

    // The curated donated-relic visual catalog (see relic-presets.js) — a
    // small, fixed, server-authored list, exactly like /api/world's own
    // galleries/subtypes, never something a client assembles itself.
    if (req.method === "GET" && pathname === "/api/relic-presets") {
      json(res, 200, { presets: RELIC_PRESETS });
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

      const { galleryId, slotId, surfaceId, subtype } = payload;
      const visualId = typeof payload.visualId === "string" ? payload.visualId : undefined;
      const title = typeof payload.title === "string" ? payload.title.trim() : "";
      const originClaim = typeof payload.originClaim === "string" ? payload.originClaim.trim() : "";
      const donorName = typeof payload.donorName === "string" ? payload.donorName.trim() : identity.name;
      const u = typeof payload.u === "number" && Number.isFinite(payload.u) ? payload.u : NaN;
      const v = typeof payload.v === "number" && Number.isFinite(payload.v) ? payload.v : NaN;
      const scale = typeof payload.scale === "number" && Number.isFinite(payload.scale) ? payload.scale : undefined;
      const gallery = galleryById(galleryId);

      if (
        !gallery ||
        typeof slotId !== "string" ||
        typeof surfaceId !== "string" ||
        Number.isNaN(u) ||
        Number.isNaN(v) ||
        u < 0 ||
        u > 1 ||
        v < 0 ||
        v > 1 ||
        !isNonEmptyString(title, MAX_TITLE_LENGTH) ||
        !isNonEmptyString(originClaim, MAX_CLAIM_LENGTH) ||
        !isNonEmptyString(donorName, MAX_NAME_LENGTH) ||
        !(SUBTYPES_BY_CATEGORY[gallery.category] ?? []).includes(subtype)
      ) {
        json(res, 400, { error: "invalid donation" }, withCookies({}, identity));
        return;
      }

      const result = db.donateExhibit({
        galleryId,
        slotId,
        surfaceId,
        u,
        v,
        scale,
        title,
        subtype,
        originClaim,
        donorName,
        visitorId: identity.id,
        visualId,
      });

      if (result.error === "invalid_visual") {
        logAction(identity, "donate", { gallery: galleryId, visual: String(visualId) }, "rejected:invalid_visual");
        json(res, 400, { error: "that relic appearance isn't available for this gallery/surface" }, withCookies({}, identity));
        return;
      }
      if (result.error === "not_found") {
        logAction(identity, "donate", { gallery: galleryId, slot: slotId }, "rejected:unknown_gallery_or_slot");
        json(res, 400, { error: "unknown gallery, slot or surface" }, withCookies({}, identity));
        return;
      }
      if (result.error === "incompatible_surface") {
        logAction(identity, "donate", { gallery: galleryId, surface: surfaceId }, "rejected:incompatible_surface");
        json(res, 400, { error: "that relic type can't be placed on that surface" }, withCookies({}, identity));
        return;
      }
      if (result.error === "outside_surface") {
        logAction(identity, "donate", { gallery: galleryId, surface: surfaceId }, "rejected:outside_surface");
        json(res, 400, { error: "that position is outside the chosen surface" }, withCookies({}, identity));
        return;
      }
      if (result.error === "invalid_scale") {
        logAction(identity, "donate", { gallery: galleryId, surface: surfaceId }, "rejected:invalid_scale");
        json(res, 400, { error: "that scale is outside the surface's allowed range" }, withCookies({}, identity));
        return;
      }
      if (result.error === "slot_taken") {
        logAction(identity, "donate", { gallery: galleryId, slot: slotId }, "rejected:slot_taken");
        json(res, 409, { error: "that slot is already occupied" }, withCookies({}, identity));
        return;
      }
      if (result.error === "surface_taken") {
        logAction(identity, "donate", { gallery: galleryId, surface: surfaceId }, "rejected:surface_taken");
        json(res, 409, { error: "that spot on the surface is already taken" }, withCookies({}, identity));
        return;
      }

      sse.broadcast("exhibit", result.exhibit);
      sse.broadcast("activity", { publicKey: publicKeyFor(identity.id), kind: "donate", exhibitTitle: result.exhibit.title });
      lastDonateAt.set(identity.id, now);
      logAction(identity, "donate", { gallery: galleryId, exhibit: result.exhibit.id.slice(0, 14) });
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
        logAction(identity, "account.create", { exhibit: accountsMatch[1].slice(0, 14), kind }, "rejected:not_found");
        json(res, 404, { error: "no such exhibit or challenged account" }, withCookies({}, identity));
        return;
      }

      sse.broadcast("account", { ...result.account, exhibitClassification: result.exhibitClassification });
      sse.broadcast("activity", { publicKey: publicKeyFor(identity.id), kind: "account", accountKind: kind });
      lastAccountAt.set(identity.id, now);
      logAction(identity, "account.create", { exhibit: accountsMatch[1].slice(0, 14), kind, account: result.account.id.slice(0, 14) });
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
        logAction(identity, "vote", { account: voteMatch[1].slice(0, 14) }, "rejected:invalid_verdict");
        json(res, 400, { error: "invalid verdict" }, withCookies({}, identity));
        return;
      }

      const result = db.castVote({
        accountId: voteMatch[1],
        visitorId: identity.id,
        verdict: payload.verdict,
      });

      if (result.error === "not_found") {
        logAction(identity, "vote", { account: voteMatch[1].slice(0, 14) }, "rejected:not_found");
        json(res, 404, { error: "no such account" }, withCookies({}, identity));
        return;
      }

      sse.broadcast("vote", { ...result.account, exhibitClassification: result.exhibitClassification });
      if (result.exhibitClassification && result.previousClassification !== result.exhibitClassification) {
        sse.broadcast("activity", { publicKey: publicKeyFor(identity.id), kind: "classification", classification: result.exhibitClassification });
      }
      logAction(identity, "vote", { account: voteMatch[1].slice(0, 14), verdict: payload.verdict });
      json(res, 200, { account: result.account }, withCookies({}, identity));
      return;
    }

    // Scene-scoped presence (see docs/adr/0003-scene-exploration.md): a
    // visitor reports which fixed scene they're currently looking at
    // whenever they navigate. There is no position/yaw any more — this is
    // the entire multiplayer-presence write surface now.
    if (req.method === "POST" && pathname === "/api/presence") {
      const identity = identify(req);
      const last = lastPresenceAt.get(identity.id) ?? 0;
      const now = Date.now();
      if (now - last < PRESENCE_MIN_INTERVAL_MS) {
        json(res, 204, {});
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req, 256);
      } catch {
        json(res, 400, { error: "bad request body" }, withCookies({}, identity));
        return;
      }

      if (typeof payload.sceneId !== "string" || !SCENE_IDS.has(payload.sceneId)) {
        logAction(identity, "presence.move", { scene: String(payload.sceneId) }, "rejected:invalid_scene");
        json(res, 400, { error: "invalid scene" }, withCookies({}, identity));
        return;
      }

      lastPresenceAt.set(identity.id, now);
      sse.setVisitorScene(identity.id, payload.sceneId, publicKeyFor(identity.id), identity.name);
      json(res, 200, { ok: true }, withCookies({}, identity));
      return;
    }

    // Ephemeral "I'm looking at this" signal (CLAUDE.md-adjacent brief: a
    // lightweight interaction cue, never persisted, never a position). A
    // visitor opening/focusing an interactive object reports its id; the
    // server relays it only to other visitors already tagged with that same
    // visitor's own current scene (never a client-asserted scene — see
    // sse.sceneIdForVisitor), so a client can never announce a focus event
    // into a room it isn't actually in.
    if (req.method === "POST" && pathname === "/api/presence/focus") {
      const identity = identify(req);
      const last = lastFocusAt.get(identity.id) ?? 0;
      const now = Date.now();
      if (now - last < FOCUS_MIN_INTERVAL_MS) {
        json(res, 204, {});
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req, 256);
      } catch {
        json(res, 400, { error: "bad request body" }, withCookies({}, identity));
        return;
      }

      // objectId is nullable — "I stopped looking at anything" is a real,
      // intentional state (closing a lore drawer/dossier), not an error.
      const objectId = payload.objectId === null ? null : payload.objectId;
      if (objectId !== null && (typeof objectId !== "string" || !FOCUS_OBJECT_ID_PATTERN.test(objectId))) {
        json(res, 400, { error: "invalid objectId" }, withCookies({}, identity));
        return;
      }

      const sceneId = sse.sceneIdForVisitor(identity.id);
      if (!sceneId) {
        json(res, 204, {});
        return;
      }

      lastFocusAt.set(identity.id, now);
      sse.broadcastToScene(
        sceneId,
        "focus",
        { publicKey: publicKeyFor(identity.id), objectId },
        { exceptVisitorId: identity.id },
      );
      json(res, 200, { ok: true }, withCookies({}, identity));
      return;
    }

    if (req.method === "GET" && pathname === "/api/events") {
      const identity = identify(req);
      const initialSceneId = SCENE_IDS.has(url.searchParams.get("scene"))
        ? url.searchParams.get("scene")
        : DEFAULT_SCENE_ID;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 2000\n\n`);

      const myPublicKey = publicKeyFor(identity.id);
      sse.addClient(res, identity.id, initialSceneId, myPublicKey, identity.name);

      // Hydrate the new connection with current per-scene headcounts and its
      // own public key (so the client can tell its own cameo apart from
      // everyone else's — CLAUDE.md's "never share a set across concerns"
      // lesson applies here too: "which cameo is me" and "which cameo is
      // that other visitor" are two different questions, so the client gets
      // its own key explicitly rather than inferring it), so it doesn't wait
      // for someone else to navigate before it draws them.
      res.write(
        `event: hello\ndata: ${JSON.stringify({
          you: identity.id,
          yourPublicKey: myPublicKey,
          sceneCounts: sse.sceneCounts(),
          visitors: sse.visitorsInScene(initialSceneId),
        })}\n\n`,
      );
      // Announce this arrival to everyone else immediately, same reasoning
      // as the old spawn-announce: a visitor present at boot must be
      // visible in the headcount/cameo roster right away, not only once
      // they navigate.
      sse.setVisitorScene(identity.id, initialSceneId, myPublicKey, identity.name);
      logAction(identity, "presence.connect", { scene: initialSceneId });

      req.on("close", () => {
        const { visitorId, sceneId, stillConnected } = sse.removeClient(res);
        if (visitorId && !stillConnected) sse.broadcastDeparture(visitorId, sceneId);
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
