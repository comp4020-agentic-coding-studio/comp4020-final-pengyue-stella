"""Run MoGe-2 inference on the Kambri Lawn source photo and dump the raw
outputs (points, depth, mask) as .npy for the parallax prototype to consume.
Isolated prototype script — not part of the production app or its Docker
image. See README.md in this directory for scope and licensing notes.
"""
import time
import numpy as np
import cv2
import torch
from moge.model.v2 import MoGeModel

SOURCE = "../../tools/sources/kambri.jpg"
OUT_DIR = "out"

device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
print("device:", device)

t0 = time.time()
model = MoGeModel.from_pretrained("Ruicheng/moge-2-vits-normal").to(device).eval()
print(f"model loaded in {time.time() - t0:.1f}s")

image = cv2.cvtColor(cv2.imread(SOURCE), cv2.COLOR_BGR2RGB)
print("input image shape:", image.shape)

input_tensor = torch.tensor(image / 255, dtype=torch.float32, device=device).permute(2, 0, 1)

t0 = time.time()
with torch.no_grad():
    output = model.infer(input_tensor)
elapsed = time.time() - t0
print(f"inference in {elapsed:.2f}s")

for k, v in output.items():
    if hasattr(v, "shape"):
        print(f"  {k}: {tuple(v.shape)} {v.dtype}")
    else:
        print(f"  {k}: {v}")

import os
os.makedirs(OUT_DIR, exist_ok=True)
np.save(f"{OUT_DIR}/points.npy", output["points"].cpu().numpy())
np.save(f"{OUT_DIR}/depth.npy", output["depth"].cpu().numpy())
np.save(f"{OUT_DIR}/mask.npy", output["mask"].cpu().numpy())
print(f"saved to {OUT_DIR}/")
