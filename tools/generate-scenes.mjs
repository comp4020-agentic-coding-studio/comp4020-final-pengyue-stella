#!/usr/bin/env node
// Generates the four flat-illustration scene panoramas into public/scenes/.
// Hand-authored, not photography — real 360 photos of campus weren't
// available for this slice, so these stand in for them (see PLAN.md /
// CLAUDE.md on why that's fine for now). Deterministic (a seeded PRNG, never
// Math.random) so re-running this produces byte-identical output: regenerate
// freely rather than hand-editing the SVGs.
//
// Run: node tools/generate-scenes.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "scenes");
const W = 3600;
const H = 900;

// mulberry32 — tiny, deterministic, good enough for "slightly different each
// time" foliage and windows.
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const el = (tag, attrs, children = "") => {
  const a = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<${tag} ${a}>${children}</${tag}>`;
};
const selfEl = (tag, attrs) => {
  const a = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<${tag} ${a} />`;
};

function tree(cx, groundY, scale, trunkColor, canopyColor) {
  const trunkH = 70 * scale;
  const trunkW = 10 * scale;
  return [
    selfEl("rect", {
      x: cx - trunkW / 2, y: groundY - trunkH, width: trunkW, height: trunkH,
      fill: trunkColor,
    }),
    selfEl("circle", { cx, cy: groundY - trunkH - 28 * scale, r: 42 * scale, fill: canopyColor, opacity: 0.95 }),
    selfEl("circle", { cx: cx - 28 * scale, cy: groundY - trunkH - 10 * scale, r: 30 * scale, fill: canopyColor, opacity: 0.9 }),
    selfEl("circle", { cx: cx + 30 * scale, cy: groundY - trunkH - 14 * scale, r: 32 * scale, fill: canopyColor, opacity: 0.9 }),
  ].join("\n");
}

function lampPost(cx, groundY, lit) {
  const parts = [
    selfEl("rect", { x: cx - 4, y: groundY - 140, width: 8, height: 140, fill: "#2b2b33" }),
    selfEl("circle", { cx, cy: groundY - 150, r: 14, fill: lit ? "#ffd98a" : "#444455" }),
  ];
  if (lit) {
    parts.push(selfEl("circle", { cx, cy: groundY - 150, r: 34, fill: "#ffd98a", opacity: 0.18 }));
  }
  return parts.join("\n");
}

function svgDoc(body, defs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${defs}</defs>
${body}
</svg>
`;
}

// ---- Kambri Lawn: midday, open grass, amphitheatre -------------------------
function kambriLawn() {
  const groundY = 620;
  const rand = rng(1);
  const defs = `
    <linearGradient id="skyKambri" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bfe6ff" />
      <stop offset="1" stop-color="#eaf7e0" />
    </linearGradient>
    <linearGradient id="groundKambri" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fc46b" />
      <stop offset="1" stop-color="#6fa94f" />
    </linearGradient>`;
  const parts = [];
  parts.push(selfEl("rect", { x: 0, y: 0, width: W, height: groundY, fill: "url(#skyKambri)" }));
  parts.push(selfEl("rect", { x: 0, y: groundY, width: W, height: H - groundY, fill: "url(#groundKambri)" }));

  // sun
  parts.push(selfEl("circle", { cx: 420, cy: 150, r: 70, fill: "#fff3c4" }));

  // winding path
  parts.push(selfEl("path", {
    d: `M -50 ${groundY + 150} C 600 ${groundY + 60}, 1200 ${groundY + 220}, 1900 ${groundY + 120}
        S 3100 ${groundY + 180}, 3650 ${groundY + 90}`,
    fill: "none", stroke: "#d9cba0", "stroke-width": 46, opacity: 0.85,
  }));

  // amphitheatre: concentric curved steps around x≈2500
  for (let i = 0; i < 5; i++) {
    const r = 260 - i * 40;
    parts.push(selfEl("path", {
      d: `M ${2500 - r} ${groundY + 230} A ${r} ${r * 0.5} 0 0 1 ${2500 + r} ${groundY + 230}`,
      fill: "none", stroke: "#c9b98f", "stroke-width": 34,
    }));
  }

  // scattered trees
  const treeXs = [180, 520, 1020, 1480, 2050, 2900, 3250, 3480];
  for (const x of treeXs) {
    const s = 0.8 + rand() * 0.6;
    parts.push(tree(x, groundY + 40 + rand() * 60, s, "#6b4a2f", "#4f8f3c"));
  }

  // tiny "people" dots, far off
  for (let i = 0; i < 10; i++) {
    const x = 200 + rand() * (W - 400);
    const y = groundY + 60 + rand() * 180;
    parts.push(selfEl("ellipse", { cx: x, cy: y, rx: 7, ry: 10, fill: "#33363f", opacity: 0.5 }));
  }

  return svgDoc(parts.join("\n"), defs);
}

// ---- Chifley Steps: golden afternoon, library + staircase ------------------
function chifleySteps() {
  const groundY = 650;
  const rand = rng(2);
  const defs = `
    <linearGradient id="skyChifley" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd9a0" />
      <stop offset="1" stop-color="#ffb37a" />
    </linearGradient>
    <linearGradient id="groundChifley" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d7b98a" />
      <stop offset="1" stop-color="#b9955f" />
    </linearGradient>`;
  const parts = [];
  parts.push(selfEl("rect", { x: 0, y: 0, width: W, height: groundY, fill: "url(#skyChifley)" }));
  parts.push(selfEl("rect", { x: 0, y: groundY, width: W, height: H - groundY, fill: "url(#groundChifley)" }));
  parts.push(selfEl("circle", { cx: 3300, cy: 180, r: 90, fill: "#fff0cf" }));

  // the building: a long sandstone block with a colonnade, centred 1200-2600
  const bx = 1150, bw = 1500, by = groundY - 420, bh = 420;
  parts.push(selfEl("rect", { x: bx, y: by, width: bw, height: bh, fill: "#c7a877" }));
  parts.push(selfEl("polygon", {
    points: `${bx - 40},${by} ${bx + bw / 2},${by - 140} ${bx + bw + 40},${by}`,
    fill: "#b6966a",
  }));
  const colCount = 10;
  for (let i = 0; i < colCount; i++) {
    const cx = bx + 60 + (i * (bw - 120)) / (colCount - 1);
    parts.push(selfEl("rect", { x: cx - 14, y: by + 20, width: 28, height: bh - 20, fill: "#9c7e52" }));
  }

  // staircase in front, stacked trapezoids narrowing upward
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const stepW = bw + 200 - i * 160;
    const stepH = 24;
    const y = groundY - (steps - i) * stepH;
    parts.push(selfEl("rect", {
      x: bx + bw / 2 - stepW / 2, y, width: stepW, height: stepH + 6, fill: "#e7d3ac",
    }));
  }

  // long afternoon shadows + flanking trees
  for (const x of [250, 650, 2950, 3350]) {
    const s = 0.9 + rand() * 0.4;
    parts.push(tree(x, groundY + 30 + rand() * 50, s, "#5b3d26", "#8a6a2e"));
    parts.push(selfEl("polygon", {
      points: `${x - 20},${groundY + 60} ${x + 20},${groundY + 60} ${x + 160},${groundY + 100} ${x + 120},${groundY + 100}`,
      fill: "#6b3f1f", opacity: 0.25,
    }));
  }

  return svgDoc(parts.join("\n"), defs);
}

// ---- Union Court: dusk, umbrellas, lit lamps -------------------------------
function unionCourt() {
  const groundY = 640;
  const rand = rng(3);
  const defs = `
    <linearGradient id="skyUnion" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2c2550" />
      <stop offset="1" stop-color="#8a5a9c" />
    </linearGradient>
    <linearGradient id="groundUnion" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9a9aa6" />
      <stop offset="1" stop-color="#75757f" />
    </linearGradient>`;
  const parts = [];
  parts.push(selfEl("rect", { x: 0, y: 0, width: W, height: groundY, fill: "url(#skyUnion)" }));
  // stars
  for (let i = 0; i < 40; i++) {
    const x = rand() * W, y = rand() * (groundY - 300);
    parts.push(selfEl("circle", { cx: x, cy: y, r: 1.6, fill: "#ffffff", opacity: 0.4 + rand() * 0.4 }));
  }
  parts.push(selfEl("rect", { x: 0, y: groundY, width: W, height: H - groundY, fill: "url(#groundUnion)" }));
  // paving grid
  for (let x = 0; x < W; x += 120) {
    parts.push(selfEl("line", { x1: x, y1: groundY, x2: x, y2: H, stroke: "#5f5f68", "stroke-width": 3, opacity: 0.5 }));
  }

  // a building edge on the far left
  parts.push(selfEl("rect", { x: 0, y: groundY - 360, width: 420, height: 360, fill: "#44415a" }));
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 6; j++) {
      parts.push(selfEl("rect", {
        x: 40 + j * 60, y: groundY - 340 + i * 80, width: 36, height: 50,
        fill: rand() > 0.6 ? "#ffd98a" : "#2c2a3c",
      }));
    }
  }

  // umbrella row
  for (let i = 0; i < 9; i++) {
    const x = 700 + i * 300 + rand() * 40;
    const color = ["#d1495b", "#edae49", "#2e86ab", "#5bc0a6"][i % 4];
    parts.push(selfEl("rect", { x: x - 5, y: groundY - 130, width: 10, height: 130, fill: "#2b2b33" }));
    parts.push(selfEl("polygon", {
      points: `${x - 90},${groundY - 110} ${x + 90},${groundY - 110} ${x},${groundY - 200}`,
      fill: color, opacity: 0.92,
    }));
  }

  // lamp posts, lit (dusk)
  for (const x of [600, 1500, 2400, 3300]) lampPost(x, groundY, true);

  return svgDoc(parts.join("\n"), defs);
}

// ---- Science Walk: overcast, glass buildings + pond ------------------------
function scienceWalk() {
  const groundY = 630;
  const rand = rng(4);
  const defs = `
    <linearGradient id="skyScience" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c7d2da" />
      <stop offset="1" stop-color="#e4ebee" />
    </linearGradient>
    <linearGradient id="groundScience" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b9bfc4" />
      <stop offset="1" stop-color="#9aa1a7" />
    </linearGradient>
    <linearGradient id="pond" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7fa8bd" />
      <stop offset="1" stop-color="#5c8599" />
    </linearGradient>`;
  const parts = [];
  parts.push(selfEl("rect", { x: 0, y: 0, width: W, height: groundY, fill: "url(#skyScience)" }));
  parts.push(selfEl("rect", { x: 0, y: groundY, width: W, height: H - groundY, fill: "url(#groundScience)" }));

  // row of glass buildings, varying height, spanning the width
  let x = -40;
  while (x < W) {
    const bw = 260 + rand() * 120;
    const bh = 260 + rand() * 180;
    const by = groundY - bh;
    parts.push(selfEl("rect", { x, y: by, width: bw, height: bh, fill: "#8fa6b3" }));
    for (let col = 20; col < bw - 20; col += 40) {
      for (let row = 20; row < bh - 20; row += 50) {
        parts.push(selfEl("rect", {
          x: x + col, y: by + row, width: 26, height: 34,
          fill: rand() > 0.5 ? "#cfe3ec" : "#aebfc9", opacity: 0.85,
        }));
      }
    }
    x += bw + 30;
  }

  // reflective pond in front
  parts.push(selfEl("ellipse", { cx: W / 2, cy: groundY + 150, rx: 1500, ry: 90, fill: "url(#pond)" }));
  for (let i = 0; i < 10; i++) {
    const wy = groundY + 110 + i * 14;
    parts.push(selfEl("path", {
      d: `M ${W / 2 - 1300} ${wy} Q ${W / 2} ${wy + 10} ${W / 2 + 1300} ${wy}`,
      fill: "none", stroke: "#ffffff", "stroke-width": 2, opacity: 0.2,
    }));
  }

  // lamp posts (daytime, unlit) + a bench every so often
  for (const lx of [300, 1100, 1900, 2700, 3400]) lampPost(lx, groundY, false);
  for (const bx2 of [700, 1700, 2900]) {
    parts.push(selfEl("rect", { x: bx2, y: groundY + 40, width: 140, height: 14, fill: "#5b4632" }));
    parts.push(selfEl("rect", { x: bx2 + 10, y: groundY + 54, width: 10, height: 24, fill: "#3b2d20" }));
    parts.push(selfEl("rect", { x: bx2 + 120, y: groundY + 54, width: 10, height: 24, fill: "#3b2d20" }));
  }

  return svgDoc(parts.join("\n"), defs);
}

const scenes = {
  "kambri.svg": kambriLawn(),
  "chifley.svg": chifleySteps(),
  "union.svg": unionCourt(),
  "science.svg": scienceWalk(),
};

for (const [name, content] of Object.entries(scenes)) {
  writeFileSync(join(OUT_DIR, name), content);
  console.log(`wrote public/scenes/${name} (${content.length} bytes)`);
}
