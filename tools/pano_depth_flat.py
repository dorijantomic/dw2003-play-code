import numpy as np, json, sys
pre = sys.argv[1]
D = np.load(pre + ".npy"); H0 = json.load(open(pre + ".json"))["cameraHeightM"]
Hh, W = D.shape
az = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi; lat = np.pi / 2 - (np.arange(Hh) + 0.5) / Hh * np.pi
AZ, LAT = np.meshgrid(az, lat)
x = D * np.sin(AZ) * np.cos(LAT); y = H0 + D * np.sin(LAT); z = -D * np.cos(AZ) * np.cos(LAT)
rh = np.hypot(x, z)
ok = ~np.isnan(D) & (LAT < 0)
for r0, r1 in [(0, 4), (4, 8), (8, 12), (12, 20), (20, 40), (40, 80)]:
    m = ok & (rh >= r0) & (rh < r1)
    if m.sum() == 0: print(r0, r1, "none"); continue
    yy = y[m]; print(f"radius {r0:2d}-{r1:2d} m: n {m.sum():6d}  ground y p10 {np.percentile(yy, 10):6.2f} p50 {np.percentile(yy, 50):6.2f} p90 {np.percentile(yy, 90):6.2f}")
for s in range(8):
    a0 = -np.pi + s * np.pi / 4; m = ok & (rh >= 4) & (rh < 12) & (AZ >= a0) & (AZ < a0 + np.pi / 4)
    if m.sum(): print(f"sector az {np.degrees(a0 + np.pi / 8):5.0f}: n {m.sum():5d} y p10 {np.percentile(y[m], 10):6.2f} p50 {np.percentile(y[m], 50):6.2f} p90 {np.percentile(y[m], 90):6.2f}")
    else: print(f"sector az {np.degrees(a0 + np.pi / 8):5.0f}: none (ground nearer than 4 m or further than 12 m)")
nanrows = np.isnan(D).all(axis=1)
print("nan share", round(float(np.isnan(D).mean()), 3), "uncovered above lat", round(float(np.degrees(lat[np.where(nanrows)[0].max()])), 1) if nanrows.any() else None)
