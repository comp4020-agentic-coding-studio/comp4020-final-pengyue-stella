"""Exports browser-ready assets from infer.py's raw MoGe output: a
downsampled color texture, and a binary grid of real 3D point-map vertices
for the three.js mesh in index.html. Run after infer.py.
"""
import struct

import cv2
import numpy as np

OUT_DIR = "out"
ASSETS_DIR = "assets"
SOURCE = "../../tools/sources/kambri.jpg"

TEXTURE_WIDTH = 1600   # browser-friendly color texture width
GRID_W, GRID_H = 240, 108  # mesh resolution: enough geometric detail for
                           # parallax, light enough to stay well under one
                           # frame budget even on modest hardware

import os
os.makedirs(ASSETS_DIR, exist_ok=True)

points = np.load(f"{OUT_DIR}/points.npy")
depth = np.load(f"{OUT_DIR}/depth.npy")
mask = np.load(f"{OUT_DIR}/mask.npy")
color = cv2.cvtColor(cv2.imread(SOURCE), cv2.COLOR_BGR2RGB)

H, W = mask.shape
scale = TEXTURE_WIDTH / W
target_h = round(H * scale)
color_small = cv2.resize(color, (TEXTURE_WIDTH, target_h), interpolation=cv2.INTER_AREA)
cv2.imwrite(f"{ASSETS_DIR}/color.jpg", cv2.cvtColor(color_small, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
print(f"wrote {ASSETS_DIR}/color.jpg at {TEXTURE_WIDTH}x{target_h}")

# Sample the point map on a regular grid. MoGe leaves `inf` in points at
# pixels its own mask marks invalid (sky, thin foliage the model couldn't
# resolve) — not just in the depth channel, in X/Y too, which breaks
# three.js's bounding-sphere computation if passed through unfixed.
xs = np.linspace(0, W - 1, GRID_W).astype(int)
ys = np.linspace(0, H - 1, GRID_H).astype(int)
grid_points = points[np.ix_(ys, xs)].copy()
grid_mask = mask[np.ix_(ys, xs)]

valid_pts = points[mask]
cz = np.percentile(valid_pts[:, 2], 99) * 1.3  # push invalid verts to a consistent far distance
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

assert not np.isinf(grid_points).any() and not np.isnan(grid_points).any(), "invalid values survived the fallback fill"

buf = grid_points.astype(np.float32).tobytes()
with open(f"{ASSETS_DIR}/points.bin", "wb") as f:
    f.write(struct.pack("<II", GRID_W, GRID_H))
    f.write(buf)
print(f"wrote {ASSETS_DIR}/points.bin: {GRID_W}x{GRID_H} grid, {len(buf)} bytes, {bad.sum()}/{bad.size} vertices used fallback geometry")
