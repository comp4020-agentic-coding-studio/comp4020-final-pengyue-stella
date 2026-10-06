// Persistence, deliberately the simplest thing that survives a restart or a
// redeploy correctly: an append-only JSONL log on the one Fly volume. The
// whole dataset for a handful of campus scenes fits in memory, so reads never
// touch disk; writes only ever append, so a crash mid-write can corrupt at
// most the last line, never the history before it.
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const DATA_FILE = process.env.TRACES_FILE ?? "/data/traces.jsonl";

const bySceneId = new Map();
let all = [];
let loaded = false;

function ensureDir() {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function load() {
  all = [];
  bySceneId.clear();
  ensureDir();
  if (!existsSync(DATA_FILE)) {
    loaded = true;
    return;
  }
  const raw = readFileSync(DATA_FILE, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const trace = JSON.parse(line);
      all.push(trace);
      const list = bySceneId.get(trace.sceneId) ?? [];
      list.push(trace);
      bySceneId.set(trace.sceneId, list);
    } catch {
      // One corrupt line (a half-written append from a killed process)
      // doesn't take the rest of the log down with it.
      console.warn("store: skipping unparseable line in", DATA_FILE);
    }
  }
  loaded = true;
}

export function tracesFor(sceneId) {
  if (!loaded) load();
  return bySceneId.get(sceneId) ?? [];
}

export function count() {
  if (!loaded) load();
  return all.length;
}

export function add(trace) {
  if (!loaded) load();
  all.push(trace);
  const list = bySceneId.get(trace.sceneId) ?? [];
  list.push(trace);
  bySceneId.set(trace.sceneId, list);
  ensureDir();
  // Synchronous and small: one short-lived request handles at most one of
  // these, and the scale here (a handful of scenes, a classroom of visitors)
  // never makes this a bottleneck. It also sidesteps any question of two
  // concurrent async appends interleaving their writes.
  appendFileSync(DATA_FILE, JSON.stringify(trace) + "\n");
}
