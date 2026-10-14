// A small static file server for public/ — no framework, just enough content
// typing and path-traversal safety for a handful of known file types.
import { readFile } from "node:fs/promises";
import { resolve, extname, join } from "node:path";

const PUBLIC_DIR = resolve(process.cwd(), "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

// Returns { body, contentType } or null if nothing servable lives there.
// `pathname` is a URL path like "/scenes/kambri.svg"; empty or "/" means the
// app shell.
export async function serveStatic(pathname) {
  const clean = pathname === "/" ? "/index.html" : pathname;
  const full = resolve(join(PUBLIC_DIR, clean));
  // Path-traversal guard: whatever the URL contained, stay under public/.
  if (!full.startsWith(PUBLIC_DIR)) return null;

  const type = CONTENT_TYPES[extname(full)];
  if (!type) return null;

  try {
    const body = await readFile(full);
    return { body, contentType: type };
  } catch {
    return null;
  }
}
