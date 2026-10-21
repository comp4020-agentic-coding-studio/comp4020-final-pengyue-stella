// Client-level regression coverage for the visitor-ghost presence feature
// (see CLAUDE.md's "Every exhibit, account and vote write is a
// transaction..." section and docs/adr/0003-scene-exploration.md for the
// presence model this exercises).
//
// Why this lives here instead of spec/: every existing spec/*.test.ts file
// is a pure fetch()-based HTTP contract test (see spec/README.md) — it
// checks what the server SENDS, never what actually renders in a browser.
// The ghost-presence feature is a DOM/rendering feature (which exact
// `.cameo` elements appear, self-exclusion, no duplicate ghosts across a
// reconnect, whether a ghost ends up in the hidden vs. visible scene
// layer) that an HTTP-only test genuinely cannot see. Real client-level
// coverage needs a real browser. Playwright is the obvious tool, but
// CLAUDE.md fixes this project's stack at zero runtime npm dependencies —
// adding `playwright` as a tracked devDependency in package.json is more
// defensible (dev-only, never ships, never touches the server's own
// dependency graph) but still isn't free: it's a ~200MB-with-browsers
// install this repo's own `pnpm install` would otherwise never need, and
// CI's `pnpm check` doesn't need it either (the existing spec/ suite is
// pure HTTP). So instead of either skipping real DOM coverage or quietly
// growing the tracked dependency set, this script is a one-off,
// NOT-part-of-`pnpm check`, ad-hoc Playwright tool: it requires
// `playwright` installed separately (e.g. `npm install playwright` in a
// scratch directory, or `npm install -D playwright` locally if you're
// willing to accept that as a devDependency — your call, not this
// script's), and is run by hand against a locally running server, same
// convention spec/README.md describes for the HTTP suite but one level up
// (a real browser instead of fetch()).
//
// Usage:
//   MUSEUM_DB_FILE=/tmp/scratch/museum.db PORT=8080 node server/src/server.js &
//   APP_URL=http://localhost:8080 node scripts/manual-qa/ghost-presence-check.mjs
//
// What it verifies (see the task that produced this script for the full
// brief): two distinct cookie identities each render exactly one visible
// peer `.cameo`; a visitor never sees their own ghost; a gallery's main and
// closeup scenes are grouped into one logical "room" for headcount/roster
// purposes (see server/src/sse.js's doc comment and app.js's
// roomIdForScene/visitorsInRoom/roomCount) even though they're different
// exact scene ids; moving rooms updates both the old and new room's
// roster; a forced reconnect (simulated via a CDP-level offline toggle,
// since EventSource itself doesn't expose a manual-reconnect hook) never
// produces a duplicate ghost; and the rendered ghost DOM node is in the
// active (visible) scene layer, never the hidden ping-pong buffer layer
// illustration.js's cross-fade keeps around.
//
// It also takes PNG screenshots (see SHOT_DIR below) so the "recognisable
// apparition" visual requirement can be eyeballed, not just bounding-rect
// math — open them with an image viewer (or Claude's own Read tool) after
// a run.
import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const SHOT_DIR = process.env.GHOST_CHECK_SHOT_DIR ?? "/tmp/ghost-presence-check-shots";
await fs.mkdir(SHOT_DIR, { recursive: true });

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

const browser = await chromium.launch();

// Each call opens a genuinely separate cookie jar (browser.newContext()) —
// NOT two tabs in one context, which would share one visitor cookie by
// design (CLAUDE.md: that sharing is correct, not a bug, and must never be
// "fixed").
async function setup(name) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const nameInput = page.locator("#name-input");
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill(name);
    await page.locator("#name-form button[type=submit]").click();
    await page.waitForTimeout(800);
  }
  const skipBtn = page.locator("#onboarding-skip");
  if (await skipBtn.isVisible().catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(300);
  }
  return { context, page };
}

async function myCookieId(page) {
  return page.evaluate(async () => {
    const res = await fetch("/api/me");
    const data = await res.json();
    return data.id ?? data.visitorId ?? JSON.stringify(data);
  });
}

async function myPublicKey(page) {
  return page.evaluate(() => window.__museumDebug().myPublicKey);
}

// Only cameos actually visible to a real user (offsetParent !== null) —
// excludes anything rendered into illustration.js's hidden ping-pong
// buffer layer during a cross-fade.
async function visibleCameos(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll(".cameo")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        publicKey: el.dataset.publicKey ?? null,
        label: el.getAttribute("aria-label"),
        isOverflow: el.classList.contains("cameo-overflow"),
      }));
  });
}

async function goToRoom(page, roomName) {
  await page.locator("#open-rooms").click();
  await page.waitForTimeout(400);
  await page.locator(".floor-plan-room-list-item", { hasText: roomName }).click();
  await page.waitForTimeout(1000);
}

// ---------------------------------------------------------------------------
console.log("\n=== Setup: two genuinely separate browser contexts ===");
const a = await setup("Visitor Alpha");
const b = await setup("Visitor Beta");
await a.page.waitForTimeout(600);
await b.page.waitForTimeout(600);

const aId = await myCookieId(a.page);
const bId = await myCookieId(b.page);
check("two browser contexts have different visitor cookie ids", aId !== bId, `a=${aId} b=${bId}`);

const aKey = await myPublicKey(a.page);
const bKey = await myPublicKey(b.page);
check("two visitors have different publicKeys", aKey !== bKey, `a=${aKey} b=${bKey}`);

// ---------------------------------------------------------------------------
console.log("\n=== Both visitors in the Entrance Hall: exactly one peer ghost each, self excluded ===");
const aCameos1 = await visibleCameos(a.page);
const bCameos1 = await visibleCameos(b.page);
check("A sees exactly one visible peer cameo", aCameos1.length === 1, JSON.stringify(aCameos1));
check("B sees exactly one visible peer cameo", bCameos1.length === 1, JSON.stringify(bCameos1));
check("A's cameo is B, not A itself", aCameos1[0]?.publicKey === bKey && aCameos1[0]?.publicKey !== aKey);
check("B's cameo is A, not B itself", bCameos1[0]?.publicKey === aKey && bCameos1[0]?.publicKey !== bKey);
await a.page.screenshot({ path: `${SHOT_DIR}/01-hall-a.png` });
await b.page.screenshot({ path: `${SHOT_DIR}/01-hall-b.png` });

// ---------------------------------------------------------------------------
console.log("\n=== Main/closeup grouping: A in portraits-main, B in portraits-closeup — must count as one room ===");
await goToRoom(a.page, "The Portraits That Watch");
await a.page.waitForTimeout(800);
await goToRoom(b.page, "The Portraits That Watch");
await b.page.waitForTimeout(800);
// B heads into a closeup scene: click the "Look closer: ..." lore object
// (opens its dossier), then the dossier's own "inspect closer" button,
// which navigates to exhibit.closeupSceneId (see app.js ~line 626). A
// direct click on the object itself just opens its dossier — it never
// navigates by itself.
const loreObjectClicked = await b.page.evaluate(() => {
  const hit = document.querySelector('.interactive-object[data-object-id="object:portraits-object-0"] .object-hit');
  if (!hit) return false;
  hit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  return true;
});
await b.page.waitForTimeout(800);
let closeupClicked = false;
const inspectBtn = b.page.locator("#dossier-inspect-closer");
if (await inspectBtn.isVisible().catch(() => false)) {
  await inspectBtn.click();
  closeupClicked = true;
  await b.page.waitForTimeout(1000);
}
// Closeup scenes auto-open a lore drawer (see app.js's onSceneChange) —
// close it so later camera/scene state settles cleanly.
const loreCloseBtn = b.page.locator("#lore-drawer-close, .lore-drawer-close, #lore-close");
if (await loreCloseBtn.first().isVisible().catch(() => false)) {
  await loreCloseBtn.first().click().catch(() => {});
  await b.page.waitForTimeout(400);
}
console.log("loreObjectClicked:", loreObjectClicked, "closeupClicked:", closeupClicked);

const bDebug = await b.page.evaluate(() => window.__museumDebug());
const aRoomPresenceText = await a.page.locator("#presence").textContent();
check(
  "closeup click actually moved B to a *-closeup scene",
  typeof bDebug.sceneId === "string" && bDebug.sceneId.endsWith("-closeup"),
  bDebug.sceneId,
);
check(
  "A's presence label reflects 2 visitors in the shared room (main+closeup grouped)",
  /2 visitors/.test(aRoomPresenceText ?? ""),
  aRoomPresenceText,
);

// The small always-visible visitor list should also show B even though B
// is standing in the closeup, not A's exact scene — the headcount/roster
// group main+closeup into one room; only a cameo's rendered anchor
// position stays exact-scene-scoped (see sse.js's doc comment).
const aVisitorListNames = await a.page.evaluate(() =>
  [...document.querySelectorAll("#visitor-list .visitor-chip")].map((el) => el.textContent),
);
check(
  "A's visitor-list includes B despite B being in the closeup scene",
  aVisitorListNames.length === 1,
  JSON.stringify(aVisitorListNames),
);

await a.page.screenshot({ path: `${SHOT_DIR}/02-main-closeup-a.png` });
await b.page.screenshot({ path: `${SHOT_DIR}/02-main-closeup-b.png` });

// ---------------------------------------------------------------------------
console.log("\n=== Moving B away removes the roster entry from the old room, and the new room gains it ===");
await goToRoom(b.page, "The Forgotten Childhood");
await b.page.waitForTimeout(1200);
const aPresenceAfterLeave = await a.page.locator("#presence").textContent();
check("A is alone again once B leaves the shared room", /alone/i.test(aPresenceAfterLeave ?? ""), aPresenceAfterLeave);
const aCameosAfterLeave = await visibleCameos(a.page);
check("A's cameo layer is empty once B has left", aCameosAfterLeave.length === 0, JSON.stringify(aCameosAfterLeave));

await goToRoom(a.page, "The Forgotten Childhood");
await a.page.waitForTimeout(1200);
const bPresenceAfterJoin = await b.page.locator("#presence").textContent();
check("B sees A join The Forgotten Childhood", /2 visitors/.test(bPresenceAfterJoin ?? ""), bPresenceAfterJoin);

// ---------------------------------------------------------------------------
console.log("\n=== Reconnect: forcing a network drop (EventSource auto-reconnects) must not duplicate ghosts ===");
await a.context.setOffline(true);
await a.page.waitForTimeout(500);
await a.context.setOffline(false);
await a.page.waitForTimeout(2000);
const aCameosAfterReconnect = await visibleCameos(a.page);
check(
  "no duplicate ghosts after reconnect (still exactly one peer, B)",
  aCameosAfterReconnect.length === 1,
  JSON.stringify(aCameosAfterReconnect),
);

// ---------------------------------------------------------------------------
console.log("\n=== Ghost DOM node is in the active (visible) layer, not a hidden ping-pong buffer ===");
const activeLayerCheck = await a.page.evaluate(() => {
  const cameo = document.querySelector(".cameo");
  if (!cameo) return { ok: false, reason: "no cameo found" };
  const visible = cameo.offsetParent !== null;
  const style = getComputedStyle(cameo);
  return { ok: visible && style.visibility !== "hidden" && style.display !== "none", offsetParent: !!cameo.offsetParent };
});
check("ghost cameo is in the visible/active scene layer", activeLayerCheck.ok, JSON.stringify(activeLayerCheck));

await a.page.screenshot({ path: `${SHOT_DIR}/03-childhood-a.png` });
await b.page.screenshot({ path: `${SHOT_DIR}/03-childhood-b.png` });

// ---------------------------------------------------------------------------
console.log(`\n=== Done: ${failures} failing check(s). Screenshots in ${SHOT_DIR} ===`);
await browser.close();
process.exit(failures > 0 ? 1 : 0);
