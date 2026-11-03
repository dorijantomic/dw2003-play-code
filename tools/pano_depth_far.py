import json, sys
import numpy as np
pre = sys.argv[1]
meta = json.load(open(pre + ".json")); C, R = meta["cols"], meta["rows"]
v = np.fromfile(pre + ".bin", "<f4").reshape(R, C); H = meta["cameraHeightM"]
lat = np.pi / 2 - np.arange(R) * np.pi / (R - 1)
# non-sky corners next to sky (silhouettes against the sky): their distance
sky = np.isnan(v)
nb = np.zeros_like(sky)
nb[1:] |= sky[:-1]; nb[:-1] |= sky[1:]; nb[:, 1:] |= sky[:, :-1]; nb[:, :-1] |= sky[:, 1:]
edge = ~sky & nb
print("corners against the sky:", int(edge.sum()), "distance m p10/p50/p90:", np.percentile(v[edge], [10, 50, 90]).round(1))
up = (lat > 0)[:, None] & ~sky
print("non-sky above the horizon m p10/p50/p90:", np.percentile(v[up], [10, 50, 90]).round(1))
# ground (below horizon) distance at which points lie horizontally from the viewpoint
LAT = lat[:, None] * np.ones((1, C)); rh = v * np.cos(LAT)
down = ~sky & (LAT < 0)
print("below horizon, horizontal distance m p50/p90/p99:", np.percentile(rh[down], [50, 90, 99]).round(1))
print("fight area: fighters <= 2150 units = 5.4 m, camera <= 4260 units = 10.7 m from the centre (400 units/m)")
