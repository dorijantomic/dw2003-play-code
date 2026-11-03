#!/usr/bin/env python3
"""Depth map (tools/pano_depth.py) -> the small file the battle loads: distances at the corners of a 256 x 128 grid.

  python3 tools/pano_depth_export.py <depth_prefix> <panorama.png> <out_prefix>

Grid corner (i, j): az = -pi + i * 2pi / 256, lat = pi/2 - j * pi / 128 (the battle's dome layout, u = i / 256,
v = j / 128). Each value is the distance (the depth tool's metres) from the painted viewpoint, the mean of log distance
over the depth pixels around the corner; NaN = sky (nothing there: the far dome shows the picture). Sky = no depth at
all (above 45 deg up), or above the horizon with sky colours in the panorama (the battle shader's own sky rule: blue,
saturated, bright; or near-white clouds with a blue cast) for most of the corner's pixels.
Writes <out_prefix>.bin (float32, 129 rows x 257, row 0 = straight up) and <out_prefix>.json
{cols, rows, cameraHeightM, skyShare}.
"""
import json, sys
import numpy as np
from PIL import Image

pre, pano, out = sys.argv[1:4]
D = np.load(pre + ".npy"); meta = json.load(open(pre + ".json"))
img = np.asarray(Image.open(pano).convert("RGB").resize((D.shape[1], D.shape[0]), Image.BILINEAR), dtype=np.float32) / 255
Hh, W = D.shape
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx = img.max(-1); mn = img.min(-1); sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
skycol = ((sat > 0.15) & (mx > 0.3) & (b > r + 0.06) & (b >= g)) | ((mx > 0.75) & (sat < 0.2) & (b >= r))
lat = np.pi / 2 - (np.arange(Hh) + 0.5) / Hh * np.pi
above = (lat > 0)[:, None] & np.ones((1, W), bool)
sky = np.isnan(D) | (above & skycol)
C, R = 256, 128
out_v = np.full((R + 1, C + 1), np.nan, np.float32)
logD = np.log(np.where(np.isnan(D), 1, D))
for j in range(R + 1):
    y0 = int(max(0, (j - 0.5) / R * Hh)); y1 = int(min(Hh, (j + 0.5) / R * Hh)); y1 = max(y1, y0 + 1)
    for i in range(C + 1):
        xs = [(x % W) for x in range(int((i - 0.5) / C * W), int((i + 0.5) / C * W) + 1)]
        blk_sky = sky[y0:y1][:, xs]; blk = logD[y0:y1][:, xs]
        if blk_sky.mean() > 0.5: continue
        out_v[j, i] = float(np.exp(blk[~blk_sky].mean()))
out_v.astype("<f4").tofile(out + ".bin")
json.dump({"cols": C + 1, "rows": R + 1, "cameraHeightM": meta["cameraHeightM"], "skyShare": float(np.isnan(out_v).mean())}, open(out + ".json", "w"))
print("corners", out_v.size, "sky", round(float(np.isnan(out_v).mean()), 3), "dist p5..p95", np.nanpercentile(out_v, [5, 95]).round(1))
