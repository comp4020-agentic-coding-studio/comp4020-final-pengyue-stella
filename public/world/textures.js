// Original procedural textures, generated on canvas at load time rather
// than fetched image files — there is nothing here to credit a third party
// for (see ASSETS.md), and it keeps the zero-asset-pipeline stack: no image
// files to source, license-check, or ship. Each is built once and reused
// (repeat-tiled) across every mesh that wants it, so the cost is one canvas
// render per texture type, not per mesh instance.
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

// A patterned carpet: a deep base colour, a border, and a repeating diamond
// motif — the dense Victorian-rug read from the reference boards, without
// needing a real fabric photograph.
export function buildCarpetTexture(base = "#5a1f22", accent = "#caa15a") {
  const { c, ctx } = canvas(256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 236, 236);
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, 212, 212);
  ctx.globalAlpha = 0.4;
  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x + 16, y);
      ctx.lineTo(x + 32, y + 16);
      ctx.lineTo(x + 16, y + 32);
      ctx.lineTo(x, y + 16);
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return toTexture(c);
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

// Damask-style wallpaper: a muted ground with a repeating diamond-and-dot
// motif in a slightly darker tone, read from a distance as "patterned", not
// a flat colour wash.
export function buildWallpaperTexture(base = "#3a2a22", motif = "#2e2019") {
  const { c, ctx } = canvas(128);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = motif;
  ctx.globalAlpha = 0.45;
  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-18, -18, 36, 36);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.arc(128, 0, 5, 0, Math.PI * 2);
  ctx.arc(0, 128, 5, 0, Math.PI * 2);
  ctx.arc(128, 128, 5, 0, Math.PI * 2);
  ctx.fill();
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

  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 248, 248);
  ctx.globalAlpha = 1;
  return toTexture(c, { repeat: [1, 1] });
}

// A ceiling/ornament gilt-on-dark pattern for crown moulding trims.
export function buildTrimTexture(base = "#1c1109", gold = "#c6a16b") {
  const { c, ctx } = canvas(64);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = gold;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(32, 0, 16, 0, Math.PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
  return toTexture(c);
}
