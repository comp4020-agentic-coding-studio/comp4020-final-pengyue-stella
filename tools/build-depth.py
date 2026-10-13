#!/usr/bin/env python3
"""Builds public/scenes/kambri.depth.bin — a real depth-displaced mesh of
Kambri Lawn's BUILT panorama (public/scenes/kambri.jpg), for the client-side
depth-parallax rendering depth-scene.js uses.

This is a local, by-hand build step, like tools/build-scenes.py — it never
runs in CI or in the Docker image, and nothing it depends on (Python, MoGe,
PyTorch) ships to production. The only committed output is the .bin file
this script writes.

Uses Microsoft MoGe (https://github.com/microsoft/MoGe), pinned to commit
b942f00bdc — the last commit before the repo moved to MoGe-3 packaging,
which hard-depends on Triton/FlexGEMM and explicitly excludes macOS from
install. The MoGe-2-era pin at that commit is plain PyTorch/torchvision,
MIT-licensed (its bundled DINOv2 encoder is Apache 2.0), and runs on Apple
Silicon MPS. See prototypes/moge-depth-parallax/README.md for the full
feasibility writeup this reuses, and docs/adr/0002-kambri-depth-parallax.md
for why this script targets the BUILT panorama rather than the raw source
photo tools/sources/kambri.jpg: traces and exits anchor at {x,y} normalised
against the built canvas, not the raw photo, so running MoGe on the built
image keeps depth geometry and trace/exit coordinates in one shared space
with no remapping layer between them.

Setup (once):
    cd prototypes/moge-depth-parallax
    python3 -m venv .venv && source .venv/bin/activate
    pip install torch torchvision
    git clone https://github.com/microsoft/MoGe.git MoGe-src
    cd MoGe-src && git checkout b942f00bdc && pip install -e . && cd ..

Run (from the repo root, with that venv active):
    python3 tools/build-depth.py
"""
import struct
from pathlib import Path

import cv2
import numpy as np
import torch
from moge.model.v2 import MoGeModel

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "public" / "scenes" / "kambri.jpg"
OUT = ROOT / "public" / "scenes" / "kambri.depth.bin"

# Higher than the prototype's 240x108 (prototype measured a locked ~120fps on
# real GPU hardware at that resolution — there's budget to spend on finer
# geometry, which means fewer / smaller gaps from the edge-coherence cull
# depth-scene.js applies).
GRID_W, GRID_H = 360, 160

DEPTH_TOLERANCE = 0.04  # must match depth-scene.js's own culling tolerance

# tools/build-scenes.py's own placement math for Kambri: the sharp photo
# occupies this normalised x-range of the built canvas; outside it is the
# synthetic blurred "letterbox" margin. See docs/adr/0002 for why this
# matters: MoGe, run on the full built panorama, does NOT treat the blurred
# margins as low-confidence — it confidently reads the blur+darkening as
# "very close to the camera" (empirically ~1.1, against the sharp region's
# 9-83 range), which would otherwise render as a jarring depth cliff right
# at the pan range's edges, exactly where visitors reach when they pan all
# the way to either side.
SHARP_X_LO, SHARP_X_HI = 0.2075187969924812, 0.7922932330827067


def main() -> None:
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device: {device}")

    model = MoGeModel.from_pretrained("Ruicheng/moge-2-vits-normal").to(device).eval()

    image = cv2.cvtColor(cv2.imread(str(SOURCE)), cv2.COLOR_BGR2RGB)
    print(f"input image ({SOURCE.name}): {image.shape}")

    input_tensor = torch.tensor(image / 255, dtype=torch.float32, device=device).permute(2, 0, 1)
    with torch.no_grad():
        output = model.infer(input_tensor)

    points = output["points"].cpu().numpy()
    mask = output["mask"].cpu().numpy()
    H, W = mask.shape
    print(f"inference done: {W}x{H}, {mask.sum()}/{mask.size} valid pixels")

    xs = np.linspace(0, W - 1, GRID_W).astype(int)
    ys = np.linspace(0, H - 1, GRID_H).astype(int)
    grid_points = points[np.ix_(ys, xs)].copy()
    grid_mask = mask[np.ix_(ys, xs)]

    valid_pts = points[mask]
    cz = np.percentile(valid_pts[:, 2], 99) * 1.3
    x_lo, x_hi = np.percentile(valid_pts[:, 0], [1, 99])
    y_lo, y_hi = np.percentile(valid_pts[:, 1], [1, 99])

    row_idx, col_idx = np.indices((GRID_H, GRID_W))
    norm_x = col_idx / (GRID_W - 1)
    norm_y = row_idx / (GRID_H - 1)
    fallback_x = x_lo + norm_x * (x_hi - x_lo)
    fallback_y = y_lo + norm_y * (y_hi - y_lo)

    bad = ~grid_mask
    grid_points[..., 0] = np.where(bad, fallback_x, grid_points[..., 0])
    grid_points[..., 1] = np.where(bad, fallback_y, grid_points[..., 1])
    grid_points[..., 2] = np.where(bad, cz, grid_points[..., 2])

    # The blurred letterbox margins (see SHARP_X_LO/HI above) get overridden
    # regardless of MoGe's own mask: empirically, MoGe reads the blur and
    # darkening there as "very close to the camera" with high confidence
    # (~1.1, against the sharp region's 9-83 range) — not a low-confidence
    # gap the generic fallback above already handles, but a confidently
    # wrong depth that would show up as a visible cliff right at the pan
    # range's edges. Instead of inventing an arbitrary "far" distance (which
    # would itself look like a sudden recession), each margin column's depth
    # is set to continue its nearest sharp-region edge column's depth
    # outward — a flat continuation, so the seam between real and synthetic
    # content is at least depth-continuous, not falsely near.
    sharp_col_lo = round(SHARP_X_LO * (GRID_W - 1))
    sharp_col_hi = round(SHARP_X_HI * (GRID_W - 1))
    for col in range(GRID_W):
        if sharp_col_lo <= col <= sharp_col_hi:
            continue
        edge_col = sharp_col_lo if col < sharp_col_lo else sharp_col_hi
        grid_points[:, col, 2] = grid_points[:, edge_col, 2]
        grid_mask[:, col] = False  # so the margin counts toward "fallback" reporting below

    assert not np.isinf(grid_points).any() and not np.isnan(grid_points).any(), (
        "invalid values survived the fallback fill"
    )

    buf = grid_points.astype(np.float32).tobytes()
    with open(OUT, "wb") as f:
        f.write(struct.pack("<II", GRID_W, GRID_H))
        f.write(buf)
    final_bad = (~grid_mask).sum()
    print(f"wrote {OUT.relative_to(ROOT)}: {GRID_W}x{GRID_H} grid, {len(buf) + 8} bytes, "
          f"{final_bad}/{grid_mask.size} vertices used fallback/margin-continuation geometry")


if __name__ == "__main__":
    main()
