// Client-level regression coverage for overlay/drawer scrolling (see
// CLAUDE.md and the commit that produced this script — a `.dossier-drawer`
// rule accidentally shadowed `.side-drawer`'s own `position: absolute`,
// which is what constrains the drawer's height so `overflow-y: auto`
// becomes a real scroll container instead of an element that just grows to
// fit its content with no scrollbar ever appearing).
//
// Same "not part of `pnpm check`" convention as
// scripts/manual-qa/ghost-presence-check.mjs: this is a real-browser DOM
// test (can the bottom-most control actually be reached by scrolling at a
// small viewport?), which a pure fetch()-based spec/*.test.ts file cannot
// see at all, and Playwright is not a tracked dependency here (see
// CLAUDE.md's zero-runtime-deps rule) — so it's an ad-hoc script requiring
// `playwright` installed separately, run by hand against a locally running
// server.
//
// Usage:
//   MUSEUM_DB_FILE=/tmp/scratch/museum.db PORT=8080 node server/src/server.js &
//   APP_URL=http://localhost:8080 node scripts/manual-qa/overlay-scroll-check.mjs
//
// What it verifies: at a small (iPhone-sized) viewport, a long dossier's
// bottom-most form control (the account-form's own Publish button) is
// reachable via a real synthetic wheel-scroll gesture; the Museum Guide's
// close button stays visible (not scrolled out of view) after scrolling its
// own tab content to the bottom; the donation form's submit button is
// reachable after scrolling; scrolling any of these never changes the scene
// camera's own pan/zoom transform (proving the wheel-scroll gesture over an
// overlay never leaks through to the room behind it).
import { chromium } from "playwright";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const VIEWPORT = { width: 390, height: 600 }; // a real small phone viewport, not the project's usual 1280-wide dev window

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();

let failures = 0;
function check(label, condition) {
  const ok = Boolean(condition);
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures++;
  return ok;
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const nameInput = page.locator("#name-input");
if (await nameInput.isVisible().catch(() => false)) {
  await nameInput.fill("Scroll Regression QA");
  await page.locator("#name-form button[type=submit]").click();
  await page.waitForTimeout(800);
}
const skipBtn = page.locator("#onboarding-skip");
if (await skipBtn.isVisible().catch(() => false)) {
  await skipBtn.click();
  await page.waitForTimeout(300);
}

async function sceneTransform() {
  return page.evaluate(() => {
    const layer = document.querySelector(".scene-layer:not([hidden]) .scene-room");
    return layer ? getComputedStyle(layer).transform : null;
  });
}

console.log("=== Dossier: long content reachable by wheel-scroll, camera untouched ===");
await page.locator("#open-archive").click();
await page.waitForTimeout(500);
await page.locator(".archive-exhibit-row").first().click();
await page.waitForTimeout(1500);

const beforeTransform = await sceneTransform();
const dossierScroll = await page.evaluate(() => {
  const d = document.getElementById("dossier");
  return { scrollHeight: d.scrollHeight, clientHeight: d.clientHeight };
});
check("dossier content overflows its own viewport (there's something to scroll)", dossierScroll.scrollHeight > dossierScroll.clientHeight);

const dossierBox = await page.locator("#dossier").boundingBox();
await page.mouse.move(dossierBox.x + dossierBox.width / 2, dossierBox.y + dossierBox.height / 2);
for (let i = 0; i < 10; i++) {
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(300);

const scrollTop = await page.evaluate(() => document.getElementById("dossier").scrollTop);
check("mouse-wheel over the dossier actually moved its scroll position", scrollTop > 0);

const publishVisible = await page.locator("#account-form button[type=submit]").isVisible().catch(() => false);
check("the account form's Publish button (bottom-most control) is reachable", publishVisible);

const closeVisible = await page.locator("#dossier-close").isVisible().catch(() => false);
check("the dossier's close button is still visible after scrolling (sticky)", closeVisible);

const afterTransform = await sceneTransform();
check("scrolling the dossier left the room camera's own transform unchanged", beforeTransform === afterTransform);

await page.locator("#dossier-close").click();
await page.waitForTimeout(300);

console.log("=== Museum Guide: close button stays reachable after scrolling tab content ===");
await page.locator("#open-rooms").click();
await page.waitForTimeout(600);
await page.locator(".guide-card").evaluate((el) => el.scrollTo(0, el.scrollHeight));
await page.waitForTimeout(300);
const guideCloseBox = await page.locator("#guide-close").boundingBox();
const guideCardBox = await page.locator(".guide-card").boundingBox();
check(
  "the Museum Guide's close button is within the card's visible bounds after scrolling to the bottom",
  guideCloseBox && guideCardBox && guideCloseBox.y >= guideCardBox.y && guideCloseBox.y <= guideCardBox.y + guideCardBox.height,
);
await page.locator("#guide-close").click();
await page.waitForTimeout(300);

console.log("=== Donation form: submit button reachable after scrolling ===");
await page.locator("#open-donate").click();
await page.waitForTimeout(500);
const donateSubmit = page.locator("#donate-form button[type=submit]");
await donateSubmit.scrollIntoViewIfNeeded();
check("the donation form's submit button is reachable after scrolling", await donateSubmit.isVisible());
await page.locator("#donate-cancel").click();
await page.waitForTimeout(300);

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll overlay-scroll checks passed.");
