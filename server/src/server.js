import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { identify } from "./identity.js";
import { SCENES, SCENE_IDS, getScene } from "./scenes.js";
import * as store from "./store.js";
import * as sse from "./sse.js";
import { serveStatic } from "./static.js";
import { renderReadmePage } from "./readme-page.js";
import { TRACE_TYPE_IDS, MAX_BODY_LENGTH, POST_COOLDOWN_MS, emojiForType } from "./constants.js";

const PORT = Number(process.env.PORT ?? 8080);

store.load();

const lastPostAt = new Map(); // visitorId -> epoch ms, cheap per-visitor cooldown

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function withCookie(headers, identity) {
  return identity.setCookieHeader ? { ...headers, "Set-Cookie": identity.setCookieHeader } : headers;
}

async function readJsonBody(req, limit = 4096) {
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

function publicScenes() {
  // Same shape the client needs, nothing server-only.
  return SCENES.map(({ id, title, blurb, image, width, height, exits }) => ({
    id, title, blurb, image, width, height, exits,
  }));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const { pathname } = url;

  try {
    if (req.method === "GET" && pathname === "/") {
      const identity = identify(req);
      const { body } = await serveStatic("/index.html");
      res.writeHead(200, withCookie({ "Content-Type": "text/html; charset=utf-8" }, identity));
      res.end(body);
      return;
    }

    if (req.method === "GET" && (pathname === "/readme/" || pathname === "/readme")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderReadmePage());
      return;
    }

    if (req.method === "GET" && pathname === "/api/scenes") {
      json(res, 200, { scenes: publicScenes() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      const identity = identify(req);
      json(res, 200, { name: identity.name, color: identity.color }, withCookie({}, identity));
      return;
    }

    const traceMatch = pathname.match(/^\/api\/scenes\/([a-z]+)\/traces$/);
    if (traceMatch) {
      const sceneId = traceMatch[1];
      if (!SCENE_IDS.has(sceneId)) {
        json(res, 404, { error: `no such scene: ${sceneId}` });
        return;
      }

      if (req.method === "GET") {
        json(res, 200, { traces: store.tracesFor(sceneId) });
        return;
      }

      if (req.method === "POST") {
        const identity = identify(req);
        const last = lastPostAt.get(identity.id) ?? 0;
        const now = Date.now();
        if (now - last < POST_COOLDOWN_MS) {
          json(
            res,
            429,
            { error: "one trace at a time — wait a moment before leaving another" },
            withCookie({}, identity),
          );
          return;
        }

        let payload;
        try {
          payload = await readJsonBody(req);
        } catch {
          json(res, 400, { error: "bad request body" }, withCookie({}, identity));
          return;
        }

        const { x, y, type } = payload;
        const body = typeof payload.body === "string" ? payload.body.trim() : "";

        if (
          typeof x !== "number" || x < 0 || x > 1 ||
          typeof y !== "number" || y < 0 || y > 1 ||
          !TRACE_TYPE_IDS.has(type) ||
          body.length === 0 || body.length > MAX_BODY_LENGTH
        ) {
          json(res, 400, { error: "invalid trace" }, withCookie({}, identity));
          return;
        }

        const trace = {
          id: `t_${randomUUID()}`,
          sceneId,
          x, y,
          type,
          emoji: emojiForType(type),
          body,
          authorName: identity.name,
          authorColor: identity.color,
          createdAt: new Date().toISOString(),
        };
        store.add(trace);
        sse.broadcast("trace", trace);

        lastPostAt.set(identity.id, now);
        json(res, 201, { trace }, withCookie({}, identity));
        return;
      }
    }

    if (req.method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // Several reverse proxies buffer SSE by default; harmless where this
        // header is ignored, necessary where it isn't.
        "X-Accel-Buffering": "no",
      });
      res.write(`retry: 2000\n\n`);
      sse.addClient(res);
      sse.broadcastPresence();
      req.on("close", () => {
        sse.removeClient(res);
        sse.broadcastPresence();
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
  console.log(`Traces of ANU listening on :${PORT} (traces on disk: ${store.count()})`);
});
