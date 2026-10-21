// A real top-down architectural floor plan — rooms as connected rectangular
// floor areas with walls, corridors and door openings, replacing the old
// compass-diagram-of-nodes-and-connector-lines. Shared by the Rooms button
// (opens straight to this) and the Museum Guide's own "Floor Plan" section,
// so there is exactly one floor-plan renderer, never two inconsistent maps.
//
// Visitor and donated-relic markers are derived entirely client-side from
// data already fetched over the existing SSE presence channel and
// `/api/exhibits` — never a new server field, never a continuous position
// sent or stored (see docs/adr/0003-scene-exploration.md: presence is
// scene-scoped, never a continuous position). A marker's position within
// its room is a deterministic hash of the visitor's own public key (or the
// exhibit's own id), exactly the same "stable per-identity, not server-
// assigned" trick public/app.js's own `renderCameos()` already uses for
// in-scene cameo anchors.

const VIEWBOX = { width: 1000, height: 1000 };

// Schematic room rectangles — a central hub with four wings, the same
// cardinal assignment the old MAP_LAYOUT used (portraits=N, memento=E,
// specimen=S, childhood=W), carried forward for continuity. This is a
// diagram, not a pixel trace of any illustration, so round, clean numbers.
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

  const currentRoomId = roomIdForScene(currentSceneId) ?? "hall";
  const rooms = [
    { id: "hall", name: "Entrance Hall" },
    ...world.galleries.map((g) => ({ id: g.id, name: g.name })),
  ];

  // Exterior walls / corridors first, so room fills + markers draw on top.
  for (const corridor of CORRIDORS) {
    svgRoot.appendChild(
      svg("rect", {
        x: corridor.rect.x,
        y: corridor.rect.y,
        width: corridor.rect.w,
        height: corridor.rect.h,
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

    const floor = svg("rect", {
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      class: "floor-plan-room-floor",
    });
    g.appendChild(floor);

    if (isCurrent) {
      g.appendChild(
        svg("rect", {
          x: rect.x - 4,
          y: rect.y - 4,
          width: rect.w + 8,
          height: rect.h + 8,
          class: "floor-plan-here-ring",
        }),
      );
    }

    const label = svg("text", {
      x: rect.x + rect.w / 2,
      y: rect.y + 20,
      class: "floor-plan-room-label",
      "text-anchor": "middle",
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

    // Visitor markers: deterministic sub-position per publicKey, same
    // "stable per-identity, never server-assigned" discipline as app.js's
    // own renderCameos() anchor assignment — sorted by hash so the same
    // visitor lands on the same marker position across re-renders.
    const sortedVisitors = [...visitors].sort((a, b) => hashKey(a.publicKey) - hashKey(b.publicKey));
    const overflow = sortedVisitors.length > MAX_VISITOR_MARKERS_PER_ROOM;
    const shownCount = overflow ? MAX_VISITOR_MARKERS_PER_ROOM - 1 : sortedVisitors.length;
    const visitorPositions = subPositions(rect, Math.max(1, shownCount), 28);
    sortedVisitors.slice(0, shownCount).forEach((visitor, i) => {
      const p = visitorPositions[i];
      const dot = svg("circle", {
        cx: p.x,
        cy: p.y,
        r: 7,
        class: "floor-plan-visitor-dot",
        fill: colorForKey(visitor.publicKey),
      });
      const title = svg("title", {});
      title.textContent = visitor.displayName;
      dot.appendChild(title);
      g.appendChild(dot);
    });
    if (overflow) {
      const p = visitorPositions[visitorPositions.length - 1] ?? subPositions(rect, 1, 28)[0];
      const chip = svg("text", { x: p.x, y: p.y + 4, class: "floor-plan-overflow", "text-anchor": "middle" });
      chip.textContent = `+${sortedVisitors.length - shownCount}`;
      g.appendChild(chip);
    }

    // Donated-relic markers: a small gold diamond, visually distinct from a
    // visitor's round ghost-dot — positioned on a SEPARATE sub-position
    // grid (offset toward the room's lower half) so a relic marker never
    // coincides with a visitor marker.
    const relicRect = { x: rect.x, y: rect.y + rect.h * 0.45, w: rect.w, h: rect.h * 0.45 };
    const shownRelics = exhibits.slice(0, MAX_RELIC_MARKERS_PER_ROOM);
    const relicPositions = subPositions(relicRect, Math.max(1, shownRelics.length), 20);
    shownRelics.forEach((exhibit, i) => {
      const p = relicPositions[i];
      const size = 6;
      const diamond = svg("polygon", {
        points: `${p.x},${p.y - size} ${p.x + size},${p.y} ${p.x},${p.y + size} ${p.x - size},${p.y}`,
        class: "floor-plan-relic-marker",
      });
      const title = svg("title", {});
      title.textContent = `${exhibit.title} — donated by ${exhibit.donorName} — ${exhibit.classification}`;
      diamond.appendChild(title);
      g.appendChild(diamond);
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
  visitorSwatch.className = "floor-plan-legend-dot";
  const visitorLabel = document.createElement("span");
  visitorLabel.textContent = "Another visitor";
  const relicSwatch = document.createElement("span");
  relicSwatch.className = "floor-plan-legend-diamond";
  const relicLabel = document.createElement("span");
  relicLabel.textContent = "Donated relic";
  legend.append(visitorSwatch, visitorLabel, relicSwatch, relicLabel);
  wrap.appendChild(legend);

  container.appendChild(wrap);
  container.appendChild(list);
}
