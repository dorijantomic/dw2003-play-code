import json, sys
import numpy as np
pre = sys.argv[1]
meta = json.load(open(pre + ".json")); C, R = meta["cols"], meta["rows"]
v = np.fromfile(pre + ".bin", "<f4").reshape(R, C)
EYE = 640; k = EYE / meta["cameraHeightM"]
j, i = np.mgrid[0:R, 0:C]
lat = np.pi / 2 - j * np.pi / (R - 1); az = -np.pi + i * 2 * np.pi / (C - 1)
d = v * k
P = np.stack([np.sin(az) * np.cos(lat) * d, EYE + np.sin(lat) * d, -np.cos(az) * np.cos(lat) * d], -1)
q = [(slice(0, -1), slice(0, -1)), (slice(0, -1), slice(1, None)), (slice(1, None), slice(0, -1)), (slice(1, None), slice(1, None))]
D4 = np.stack([d[a] for a in q], -1); ok = ~np.isnan(D4).any(-1)
ratio = np.nanmax(D4, -1) / np.nanmin(D4, -1)
a, c, dd, b = (P[x] for x in q)   # a=(j,i) c=(j,i+1) dd=(j+1,i) b=(j+1,i+1)
e1 = b - a; e2 = dd - c
n = np.cross(e1, e2); nl = np.linalg.norm(n, axis=-1) + 1e-9
m = (a + b) / 2; m[..., 1] -= EYE; ml = np.linalg.norm(m, axis=-1) + 1e-9
cosv = np.abs((n * m).sum(-1)) / (nl * ml); ny = np.abs(n[..., 1]) / nl
print("quads", int(ok.sum()))
for t in (1.1, 1.2, 1.3, 1.5, 2.0):
    s = ok & (ratio > t)
    print(f"ratio>{t}: {int(s.sum())}  of them non-level {int((s & (ny < 0.8)).sum())}  cos<0.15 {int((s & (ny < 0.8) & (cosv < 0.15)).sum())}  cos<0.3 {int((s & (ny < 0.8) & (cosv < 0.3)).sum())}")
s = ok & (ny < 0.8)
print("non-level quads cos percentiles p5/p25/p50:", np.percentile(cosv[s], [5, 25, 50]).round(3))
# elongation: longest edge vs the size a cell should have at that distance (cell angle 1.4 deg)
edges = np.stack([np.linalg.norm(c - a, axis=-1), np.linalg.norm(dd - a, axis=-1), np.linalg.norm(b - c, axis=-1), np.linalg.norm(b - dd, axis=-1)], -1)
expect = np.nanmin(D4, -1) * (np.pi / (R - 1))
stretch = np.nanmax(edges, -1) / expect
for t in (3, 5, 10):
    print(f"stretch>{t}: {int((ok & (stretch > t)).sum())} (non-level {int((ok & (stretch > t) & (ny < 0.8)).sum())})")
