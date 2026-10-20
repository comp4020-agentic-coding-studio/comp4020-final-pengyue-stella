// Original procedural textures, generated on canvas at load time rather
// than fetched image files — there is nothing here to credit a third party
// for (see ASSETS.md). Only the exhibit-preview subset remains: wood grain
// (for the small staging furniture artifacts.js builds), the portrait canvas
// (for painting/sketch donations), and the brass nameplate every donated
// relic's card carries. The room-scale textures (carpet, wallpaper, a
// generic bordered label) this file used to carry were retired along with
// the live Three.js room itself — see docs/adr/0003-scene-exploration.md
// and ASSETS.md.
import * as THREE from "three";

function canvas(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return { c, ctx: c.getContext("2d") };
}

function toTexture(c, { repeat = [1, 1] } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Wood grain: vertical streaks over a warm brown base, for panelling and
// furniture carcasses.
export function buildWoodTexture(base = "#2a1c14", grain = "#1c1109") {
  const { c, ctx } = canvas(128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = grain;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 128;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 4, 40, x - 4, 80, x + (Math.random() - 0.5) * 6, 128);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(c);
}

// A dim, moody "oil painting" for portrait canvases: a gradient ground with
// a soft dark silhouette, echoing reference C's ambiguous-figure framing
// without reproducing it.
export function buildPortraitTexture(accent = "#663D43") {
  const { c, ctx } = canvas(256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2a2018");
  grad.addColorStop(1, "#140f0a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // A soft vertical light shaft, the "light at the end of a hallway" cue.
  const shaft = ctx.createLinearGradient(128, 0, 128, 256);
  shaft.addColorStop(0, "rgba(230,200,150,0.25)");
  shaft.addColorStop(1, "rgba(230,200,150,0)");
  ctx.fillStyle = shaft;
  ctx.fillRect(80, 0, 96, 256);

  // Silhouette: a simple dark figure shape, deliberately ambiguous.
  ctx.fillStyle = "rgba(10,8,6,0.88)";
  ctx.beginPath();
  ctx.ellipse(128, 90, 22, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(100, 110);
  ctx.quadraticCurveTo(128, 100, 156, 110);
  ctx.lineTo(170, 230);
  ctx.lineTo(86, 230);
  ctx.closePath();
  ctx.fill();

  // Two faint painted eye-sockets on the silhouette's face, at the exact
  // spot buildWatchingPortrait (furniture.js) positions its literal 3D
  // pupil meshes — the painted socket gives the floating pupil somewhere to
  // visually sit, rather than looking like a dot pasted on top of a blank
  // silhouette.
  ctx.fillStyle = "rgba(220,210,195,0.35)";
  ctx.beginPath();
  ctx.ellipse(119, 86, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(137, 86, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 248, 248);
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: [1, 1] });
}

// A worn brass museum nameplate: title on top, "Donated by ..." smaller
// beneath — the exhibit library's one shared label style, so every donated
// relic (whatever its procedural model family) carries the same archival
// read the blueprint asks for ("a readable brass nameplate with its title
// and donor").
export function buildNameplateTexture(title, donorName) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 176;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 176);
  grad.addColorStop(0, "#9c7a44");
  grad.addColorStop(1, "#6b5330");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 176);
  ctx.strokeStyle = "#2a1c14";
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, 504, 168);
  ctx.strokeStyle = "rgba(42,28,20,0.5)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(14, 14, 484, 148);

  ctx.fillStyle = "#1c1109";
  ctx.textAlign = "center";
  ctx.font = "700 36px Georgia, serif";
  const trimmedTitle = title.length > 30 ? `${title.slice(0, 29)}…` : title;
  ctx.fillText(trimmedTitle, 256, 76);

  ctx.font = "italic 26px Georgia, serif";
  const trimmedDonor = donorName.length > 34 ? `${donorName.slice(0, 33)}…` : donorName;
  ctx.fillText(`Donated by ${trimmedDonor}`, 256, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
