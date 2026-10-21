// An original, hand-drawn-feeling "enchanted parchment map" of the museum —
// an aged, ink-traced floor plan (NOT a clean architectural blueprint, and
// NOT a copy of any specific copyrighted map/artwork — no borrowed names,
// crests or layouts, this is a from-scratch "cursed museum" artifact).
// Shared by the Rooms button and the Museum Guide's own "Floor Plan"
// section, so there is exactly one floor-plan renderer, never two
// inconsistent maps.
//
// Visitor and donated-relic markers are derived entirely client-side from
// data already fetched over the existing SSE presence channel and
// `/api/exhibits` — never a new server field, never a continuous position
// sent or stored (see docs/adr/0003-scene-exploration.md: presence is
// scene-scoped, never a continuous position). A marker's position within
// its room is a deterministic hash of the visitor's own public key (or the
// exhibit's own id), exactly the same "stable per-identity, not server-
// assigned" trick public/app.js's own `renderCameos()` already uses for
// in-scene cameo anchors — reused here so a visitor's footprint mark lands
// in the same spot every time the map redraws, not somewhere new each poll.

const VIEWBOX = { width: 1000, height: 1000 };

// Room rectangles — a central hub with four wings, the same cardinal
// assignment the prior schematic used (portraits=N, memento=E, specimen=S,
// childhood=W), carried forward for continuity. These are the *logical*
// bounds used for layout math (marker grids, label placement); the drawn
// outline below is a hand-jittered trace of this rectangle, never a crisp
// rect itself.
const ROOMS = {
  hall: { x: 380, y: 380, w: 240, h: 240, label: "Entrance Hall" },
  portraits: { x: 380, y: 60, w: 240, h: 240 },
  memento: { x: 700, y: 380, w: 240, h: 240 },
  specimen: { x: 380, y: 700, w: 240, h: 240 },
  childhood: { x: 60, y: 380, w: 240, h: 240 },
};

const CORRIDORS = [
  { from: "hall", to: "portraits", rect: { x: 460, y: 300, w: 80, h: 80 } },
  { from: "hall", to: "memento", rect: { x: 620, y: 460, w: 80, h: 80 } },
  { from: "hall", to: "specimen", rect: { x: 460, y: 620, w: 80, h: 80 } },
  { from: "hall", to: "childhood", rect: { x: 300, y: 460, w: 80, h: 80 } },
];

const SVG_NS = "http://www.w3.org/2000/svg";

function hashKey(key) {
  let h = 1779033703;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
  return (h ^ (h >>> 16)) >>> 0;
}
function colorForKey(key) {
  const hue = hashKey(`hue:${key}`) % 360;
  return `hsl(${hue}, 65%, 60%)`;
}
// A deterministic "random" unit value in [-0.5, 0.5) from a string seed —
// used for every hand-drawn wobble below so the map looks identically
// hand-traced on every re-render (never a fresh jitter each redraw).
function seededUnit(seed) {
  return (hashKey(seed) % 10000) / 10000 - 0.5;
}

// A small fixed grid of sub-positions inside a room rect, inset from the
// walls — visitor markers and relic markers each get their own grid so the
// two kinds of marker never land on exactly the same spot.
function subPositions(rect, count, inset) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const usableW = rect.w - inset * 2;
  const usableH = rect.h - inset * 2;
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (points.length >= count) break;
      const px = rect.x + inset + (cols > 1 ? (c / (cols - 1)) * usableW : usableW / 2);
      const py = rect.y + inset + (rows > 1 ? (r / (rows - 1)) * usableH : usableH / 2);
      points.push({ x: px, y: py });
    }
  }
  return points;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// A hand-traced outline of a rectangle: each corner nudged off-grid and
// each edge given a slight outward/inward bow, both deterministic per
// `seed` — this is what makes a room read as ink-drawn rather than a CAD
// rectangle. `jitter` controls how far corners/edges may wander.
function handDrawnRectPath(rect, seed, jitter = 9) {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ].map((p, i) => ({
    x: p.x + seededUnit(`${seed}:corner${i}:x`) * jitter,
    y: p.y + seededUnit(`${seed}:corner${i}:y`) * jitter,
  }));

  function bowedMidpoint(p1, p2, i) {
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bow = seededUnit(`${seed}:edge${i}`) * jitter * 1.4;
    return { x: mx + nx * bow, y: my + ny * bow };
  }

  let d = `M ${corners[0].x.toFixed(1)},${corners[0].y.toFixed(1)}`;
  for (let i = 0; i < 4; i++) {
    const next = corners[(i + 1) % 4];
    const mid = bowedMidpoint(corners[i], next, i);
    d += ` Q ${mid.x.toFixed(1)},${mid.y.toFixed(1)} ${next.x.toFixed(1)},${next.y.toFixed(1)}`;
  }
  return d + " Z";
}

// A wax-seal-like ink blotch shape for a donated relic: a roughly circular
// blob with an uneven, pressed-wax edge — deterministic per exhibit id so
// the same relic always draws the same seal.
function inkBlotchPath(cx, cy, r, seed) {
  const points = 10;
  let d = "";
  const pts = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const wobble = 1 + seededUnit(`${seed}:blot${i}`) * 0.3;
    pts.push({ x: cx + Math.cos(angle) * r * wobble, y: cy + Math.sin(angle) * r * wobble });
  }
  d += `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < points; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % points];
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    d += ` Q ${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  return d + " Z";
}

function roomIdForScene(sceneId) {
  if (sceneId === "hall") return "hall";
  const match = sceneId.match(/^([a-z]+)-(main|closeup)$/);
  return match ? match[1] : null;
}

// Visitors reported against a gallery's main OR closeup scene both count as
// "in that room" for the floor plan, same aggregation `galleryRoomTotal`
// already uses in app.js for the room-total badge.
function visitorsInRoom(roomId, sceneVisitors) {
  if (roomId === "hall") return sceneVisitors.hall ?? [];
  return [...(sceneVisitors[`${roomId}-main`] ?? []), ...(sceneVisitors[`${roomId}-closeup`] ?? [])];
}

const MAX_VISITOR_MARKERS_PER_ROOM = 6;
const MAX_RELIC_MARKERS_PER_ROOM = 6;

// Decorative parchment texture, stains and ornaments — drawn once, under
// everything interactive, and never participating in hit-testing or the
// accessibility tree (the whole svg is already aria-hidden; the real a11y
// surface is the `<ul>` room list rendered alongside it).
function buildParchmentBackdrop() {
  const group = svg("g", { class: "floor-plan-backdrop", "aria-hidden": "true" });

  const defs = svg("defs", {});
  // Note: deliberately NOT compositing `SourceGraphic` back in here — doing
  // so over an opaque backing rect would just repaint solid black over the
  // parchment tone beneath it. The filter's own last primitive (the
  // low-alpha colour-matrixed noise) IS the rendered result, so this grain
  // layer stays a faint, mostly-transparent speckle sitting on top of the
  // parchment base rect painted separately below.
  const grain = svg("filter", { id: "floor-plan-grain", x: "-5%", y: "-5%", width: "110%", height: "110%" });
  grain.appendChild(svg("feTurbulence", { type: "fractalNoise", baseFrequency: "0.012 0.018", numOctaves: "3", seed: "7", result: "noise" }));
  grain.appendChild(svg("feColorMatrix", { in: "noise", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.12 0" }));
  defs.appendChild(grain);

  const wobble = svg("filter", { id: "floor-plan-ink-wobble", x: "-20%", y: "-20%", width: "140%", height: "140%" });
  wobble.appendChild(svg("feTurbulence", { type: "fractalNoise", baseFrequency: "0.02", numOctaves: "2", seed: "3", result: "wobbleNoise" }));
  wobble.appendChild(svg("feDisplacementMap", { in: "SourceGraphic", in2: "wobbleNoise", scale: "3.5" }));
  defs.appendChild(wobble);
  group.appendChild(defs);

  // Base parchment fill + grain overlay.
  group.appendChild(svg("rect", { x: 0, y: 0, width: VIEWBOX.width, height: VIEWBOX.height, class: "floor-plan-parchment-base" }));
  group.appendChild(
    svg("rect", {
      x: 0,
      y: 0,
      width: VIEWBOX.width,
      height: VIEWBOX.height,
      class: "floor-plan-parchment-grain",
      filter: "url(#floor-plan-grain)",
    }),
  );

  // A few irregular age stains, tucked into corners so they never sit under
  // a room or marker.
  const stains = [
    { x: 110, y: 870, r: 70 },
    { x: 900, y: 140, r: 55 },
    { x: 60, y: 60, r: 40 },
  ];
  for (const [i, s] of stains.entries()) {
    group.appendChild(
      svg("path", {
        d: inkBlotchPath(s.x, s.y, s.r, `stain:${i}`),
        class: "floor-plan-stain",
      }),
    );
  }

  // Fold creases, as if the parchment has been folded in quarters.
  group.appendChild(svg("line", { x1: 500, y1: 20, x2: 500, y2: 980, class: "floor-plan-fold" }));
  group.appendChild(svg("line", { x1: 20, y1: 500, x2: 980, y2: 500, class: "floor-plan-fold" }));

  // A worn-edge vignette, darker toward the border.
  const vignette = svg("radialGradient", { id: "floor-plan-vignette", cx: "50%", cy: "50%", r: "72%" });
  vignette.appendChild(svg("stop", { offset: "70%", "stop-color": "var(--ink)", "stop-opacity": "0" }));
  vignette.appendChild(svg("stop", { offset: "100%", "stop-color": "var(--ink)", "stop-opacity": "0.55" }));
  defs.appendChild(vignette);
  group.appendChild(svg("rect", { x: 0, y: 0, width: VIEWBOX.width, height: VIEWBOX.height, fill: "url(#floor-plan-vignette)" }));

  // Compass rose — an original, purely geometric eight-point star with
  // cardinal tick labels. Not a trace of any real/fictional institution's
  // mark.
  const compass = svg("g", { class: "floor-plan-compass", transform: "translate(140, 140)" });
  const points = 8;
  let starPath = "";
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 48 : 18;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    starPath += `${i === 0 ? "M" : "L"} ${px.toFixed(1)},${py.toFixed(1)} `;
  }
  starPath += "Z";
  compass.appendChild(svg("path", { d: starPath, class: "floor-plan-compass-star" }));
  compass.appendChild(svg("circle", { cx: 0, cy: 0, r: 6, class: "floor-plan-compass-pin" }));
  const n = svg("text", { x: 0, y: -56, class: "floor-plan-compass-label", "text-anchor": "middle" });
  n.textContent = "N";
  compass.appendChild(n);
  group.appendChild(compass);

  // Museum crest — a modest, original shield-and-flame motif (an "eternal
  // light" for a museum, nothing resembling any real or fictional crest).
  const crest = svg("g", { class: "floor-plan-crest", transform: "translate(860, 860)" });
  crest.appendChild(
    svg("path", {
      d: "M 0,-34 C 20,-30 30,-22 30,-4 C 30,16 16,30 0,36 C -16,30 -30,16 -30,-4 C -30,-22 -20,-30 0,-34 Z",
      class: "floor-plan-crest-shield",
    }),
  );
  crest.appendChild(svg("path", { d: "M 0,-14 C 6,-6 8,2 0,14 C -8,2 -6,-6 0,-14 Z", class: "floor-plan-crest-flame" }));
  group.appendChild(crest);

  return group;
}

export function renderFloorPlan(container, { world, sceneVisitors, exhibitsById, currentSceneId, myPublicKey, onRoomSelect }) {
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "floor-plan-wrap";

  const svgRoot = svg("svg", {
    viewBox: `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`,
    class: "floor-plan-svg",
    role: "group",
    "aria-hidden": "true",
  });

  svgRoot.appendChild(buildParchmentBackdrop());

  const currentRoomId = roomIdForScene(currentSceneId) ?? "hall";
  const rooms = [
    { id: "hall", name: "Entrance Hall" },
    ...world.galleries.map((g) => ({ id: g.id, name: g.name })),
  ];

  // Corridors first (hand-drawn, ink-wobbled), so room fills + markers draw
  // on top.
  for (const corridor of CORRIDORS) {
    svgRoot.appendChild(
      svg("path", {
        d: handDrawnRectPath(corridor.rect, `corridor:${corridor.from}-${corridor.to}`, 6),
        class: "floor-plan-corridor",
      }),
    );
  }

  const list = document.createElement("ul");
  list.className = "floor-plan-room-list";
  list.setAttribute("aria-label", "Rooms");

  for (const room of rooms) {
    const rect = ROOMS[room.id];
    if (!rect) continue;
    const isCurrent = room.id === currentRoomId;
    const visitors = visitorsInRoom(room.id, sceneVisitors).filter((v) => v.publicKey !== myPublicKey);
    const exhibits =
      room.id === "hall" ? [] : [...exhibitsById.values()].filter((e) => e.galleryId === room.id && e.origin !== "builtin");

    const g = svg("g", {
      class: `floor-plan-room${isCurrent ? " current" : ""}`,
      tabindex: "0",
      role: "button",
    });
    const detail = [
      visitors.length === 0 ? "empty" : visitors.length === 1 ? "1 visitor" : `${visitors.length} visitors`,
      exhibits.length > 0 ? `${exhibits.length} relic${exhibits.length === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    g.setAttribute("aria-label", `${room.name}. ${detail}.${isCurrent ? " You are here." : ""}`);

    const floor = svg("path", {
      d: handDrawnRectPath(rect, `room:${room.id}`, 9),
      class: "floor-plan-room-floor",
      filter: "url(#floor-plan-ink-wobble)",
    });
    g.appendChild(floor);

    if (isCurrent) {
      const ringRect = { x: rect.x - 10, y: rect.y - 10, w: rect.w + 20, h: rect.h + 20 };
      g.appendChild(
        svg("path", {
          d: handDrawnRectPath(ringRect, `room:${room.id}:here-ring`, 11),
          class: "floor-plan-here-ring",
        }),
      );
    }

    const labelRotation = (seededUnit(`label:${room.id}`) * 3).toFixed(1);
    const label = svg("text", {
      x: rect.x + rect.w / 2,
      y: rect.y + 20,
      class: "floor-plan-room-label",
      "text-anchor": "middle",
      transform: `rotate(${labelRotation} ${rect.x + rect.w / 2} ${rect.y + 20})`,
    });
    label.textContent = room.name;
    g.appendChild(label);

    if (isCurrent) {
      const hereLabel = svg("text", {
        x: rect.x + rect.w / 2,
        y: rect.y + 36,
        class: "floor-plan-here-label",
        "text-anchor": "middle",
      });
      hereLabel.textContent = "You are here";
      g.appendChild(hereLabel);
    }

    // Visitor markers: a small pair of ink footprints, not a plain dot — the
    // sub-position is still a deterministic hash of the visitor's own
    // publicKey (same "stable per-identity, never server-assigned"
    // discipline as app.js's own renderCameos() anchor assignment), so the
    // same visitor's footprints land in the same spot across re-renders.
    const sortedVisitors = [...visitors].sort((a, b) => hashKey(a.publicKey) - hashKey(b.publicKey));
    const overflow = sortedVisitors.length > MAX_VISITOR_MARKERS_PER_ROOM;
    const shownCount = overflow ? MAX_VISITOR_MARKERS_PER_ROOM - 1 : sortedVisitors.length;
    const visitorPositions = subPositions(rect, Math.max(1, shownCount), 28);
    sortedVisitors.slice(0, shownCount).forEach((visitor, i) => {
      const p = visitorPositions[i];
      const color = colorForKey(visitor.publicKey);
      const delay = ((hashKey(`delay:${visitor.publicKey}`) % 1000) / 1000) * 1.6;
      const footGroup = svg("g", {
        class: "floor-plan-footprint",
        style: `--floor-plan-footprint-delay: ${delay.toFixed(2)}s`,
      });
      const title = svg("title", {});
      title.textContent = visitor.displayName;
      footGroup.appendChild(title);
      // Left footstep, nudged back-left and rotated outward.
      footGroup.appendChild(
        svg("ellipse", {
          cx: p.x - 4.5,
          cy: p.y + 3,
          rx: 3.2,
          ry: 5.2,
          fill: color,
          class: "floor-plan-footprint-mark",
          transform: `rotate(-18 ${p.x - 4.5} ${p.y + 3})`,
        }),
      );
      // Right footstep, ahead and rotated the opposite way — the pair reads
      // as a stride.
      footGroup.appendChild(
        svg("ellipse", {
          cx: p.x + 4.5,
          cy: p.y - 3,
          rx: 3.2,
          ry: 5.2,
          fill: color,
          class: "floor-plan-footprint-mark",
          transform: `rotate(18 ${p.x + 4.5} ${p.y - 3})`,
        }),
      );
      g.appendChild(footGroup);
    });
    if (overflow) {
      const p = visitorPositions[visitorPositions.length - 1] ?? subPositions(rect, 1, 28)[0];
      const chip = svg("text", { x: p.x, y: p.y + 4, class: "floor-plan-overflow", "text-anchor": "middle" });
      chip.textContent = `+${sortedVisitors.length - shownCount}`;
      g.appendChild(chip);
    }

    // Donated-relic markers: a small pressed-wax-seal blotch, visually
    // distinct from a visitor's ink footprints — positioned on a SEPARATE
    // sub-position grid (offset toward the room's lower half) so a relic
    // marker never coincides with a visitor marker.
    const relicRect = { x: rect.x, y: rect.y + rect.h * 0.45, w: rect.w, h: rect.h * 0.45 };
    const shownRelics = exhibits.slice(0, MAX_RELIC_MARKERS_PER_ROOM);
    const relicPositions = subPositions(relicRect, Math.max(1, shownRelics.length), 20);
    shownRelics.forEach((exhibit, i) => {
      const p = relicPositions[i];
      const sealGroup = svg("g", { class: "floor-plan-relic-marker" });
      const title = svg("title", {});
      title.textContent = `${exhibit.title} — donated by ${exhibit.donorName} — ${exhibit.classification}`;
      sealGroup.appendChild(title);
      sealGroup.appendChild(svg("path", { d: inkBlotchPath(p.x, p.y, 6.5, `relic:${exhibit.id}`), class: "floor-plan-relic-blotch" }));
      // A small pressed-seal mark inside the blotch: a tiny ring + dot,
      // purely decorative and never itself a separate hover target.
      sealGroup.appendChild(svg("circle", { cx: p.x, cy: p.y, r: 2.6, class: "floor-plan-relic-seal-ring" }));
      g.appendChild(sealGroup);
    });
    if (exhibits.length > MAX_RELIC_MARKERS_PER_ROOM) {
      const p = relicPositions[relicPositions.length - 1];
      const chip = svg("text", { x: p.x, y: p.y + 14, class: "floor-plan-overflow", "text-anchor": "middle" });
      chip.textContent = `+${exhibits.length - MAX_RELIC_MARKERS_PER_ROOM}`;
      g.appendChild(chip);
    }

    const select = () => onRoomSelect?.(room.id);
    g.addEventListener("click", select);
    g.addEventListener("keydown", (e) => {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        select();
      }
    });
    svgRoot.appendChild(g);

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "floor-plan-room-list-item";
    if (isCurrent) btn.classList.add("current");
    btn.textContent = `${room.name} — ${detail}`;
    btn.addEventListener("click", select);
    li.appendChild(btn);
    list.appendChild(li);
  }

  wrap.appendChild(svgRoot);

  const legend = document.createElement("div");
  legend.className = "floor-plan-legend";
  legend.innerHTML = "";
  const visitorSwatch = document.createElement("span");
  visitorSwatch.className = "floor-plan-legend-footprint";
  const visitorLabel = document.createElement("span");
  visitorLabel.textContent = "Another visitor";
  const relicSwatch = document.createElement("span");
  relicSwatch.className = "floor-plan-legend-seal";
  const relicLabel = document.createElement("span");
  relicLabel.textContent = "Donated relic";
  legend.append(visitorSwatch, visitorLabel, relicSwatch, relicLabel);
  wrap.appendChild(legend);

  container.appendChild(wrap);
  container.appendChild(list);
}
