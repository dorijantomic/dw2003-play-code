#!/usr/bin/env python3
"""Painted 360 battle backdrop -> a distance for every pixel, so the battle can stand INSIDE the picture (HD Remaster).

  python tools/pano_depth.py <panorama.png> <out_prefix> [--model depth-anything/Depth-Anything-V2-Metric-Outdoor-Large-hf]

The panorama is equirectangular (u 0.5 = -Z, horizon at v 0.5; dir = (sin az cos lat, sin lat, -cos az cos lat)).
Depth models are trained on ordinary photos, so the picture is cut into 13 ordinary 90-degree views (8 around at the
horizon, 4 looking 60 degrees down, 1 straight down), each view gets a metric depth (metres along the view axis),
which becomes a distance along each pixel's ray. Views overlap; each view gets one scale factor so they agree:
 * camera height from the ground: for pixels looking down (lat < -15 deg) h = distance * -sin(lat) is the camera's
   height above whatever the ray hits; on flat ground it is the camera height, on anything standing up it is less.
   Per view the upper quartile of h (the flat ground, not the rocks) is that view's camera height; every view is
   scaled so its height equals the median over the views (a view with too little ground, < 5% pixels, keeps scale 1).
 * the merged map is a weighted mean of log distance (weight falls to 0 at a view's edge).
Writes <out_prefix>.npy (float32 metres, H x W) and <out_prefix>.json (numbers per view, camera height).
"""
import argparse, json, math, sys
import numpy as np
from PIL import Image

N = 518                                   # view size (the model's own input size, a multiple of 14)
VIEWS = [(y, 0) for y in range(0, 360, 45)] + [(y, -60) for y in (0, 90, 180, 270)] + [(0, -90)]


def dir_of(az, lat):
    return np.stack([np.sin(az) * np.cos(lat), np.sin(lat), -np.cos(az) * np.cos(lat)], -1)


def basis(yaw_deg, pitch_deg):
    f = dir_of(math.radians(yaw_deg), math.radians(pitch_deg))
    up = np.array([0.0, 1.0, 0.0]) if abs(pitch_deg) < 89 else dir_of(math.radians(yaw_deg), 0.0)
    r = np.cross(f, up); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return f, r, u


def sample_equirect(img, d):
    H, W = img.shape[:2]
    az = np.arctan2(d[..., 0], -d[..., 2]); lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    x = (0.5 + az / (2 * np.pi)) * W - 0.5; y = (0.5 - lat / np.pi) * H - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    g = lambda yy, xx: img[np.clip(yy, 0, H - 1), xx % W].astype(np.float32)
    return (g(y0, x0) * (1 - fx) * (1 - fy) + g(y0, x0 + 1) * fx * (1 - fy) + g(y0 + 1, x0) * (1 - fx) * fy + g(y0 + 1, x0 + 1) * fx * fy)


def view_rays(yaw, pitch):
    f, r, u = basis(yaw, pitch)
    t = (2 * (np.arange(N) + 0.5) / N - 1)
    X, Y = np.meshgrid(t, -t)
    ray = f[None, None] + X[..., None] * r + Y[..., None] * u
    return ray, f, r, u


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("pano"); ap.add_argument("out")
    ap.add_argument("--model", default="depth-anything/Depth-Anything-V2-Metric-Outdoor-Large-hf")
    ap.add_argument("--width", type=int, default=1024)
    a = ap.parse_args()
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    try:
        import torch_directml; dev = torch_directml.device()
    except Exception:
        dev = torch.device("cpu")
    proc = AutoImageProcessor.from_pretrained(a.model)
    model = AutoModelForDepthEstimation.from_pretrained(a.model).to(dev).eval()
    img = np.asarray(Image.open(a.pano).convert("RGB"))
    views = []
    for yaw, pitch in VIEWS:
        ray, f, r, u = view_rays(yaw, pitch)
        norm = np.linalg.norm(ray, axis=-1)
        d = ray / norm[..., None]
        rgb = sample_equirect(img, d).clip(0, 255).astype(np.uint8)
        inp = proc(images=Image.fromarray(rgb), return_tensors="pt")
        with torch.no_grad():
            z = model(pixel_values=inp["pixel_values"].to(dev)).predicted_depth
        z = torch.nn.functional.interpolate(z[:, None].float().cpu(), size=(N, N), mode="bilinear", align_corners=False)[0, 0].numpy()
        dist = z * norm                                     # depth along the axis -> distance along the ray
        down = d[..., 1] < -math.sin(math.radians(15))
        h = (dist * -d[..., 1])[down]
        hq = float(np.percentile(h, 75)) if down.mean() > 0.05 else None
        views.append({"yaw": yaw, "pitch": pitch, "f": f, "r": r, "u": u, "dist": dist, "groundShare": float(down.mean()), "h75": hq,
                      "distRange": [float(np.percentile(dist, 2)), float(np.percentile(dist, 98))]})
        print(f"view yaw {yaw:4d} pitch {pitch:4d}: dist p2..p98 {views[-1]['distRange'][0]:.1f}..{views[-1]['distRange'][1]:.1f} m, camera height (ground) {hq if hq is None else round(hq, 2)}", flush=True)
    hs = [v["h75"] for v in views if v["h75"] is not None]
    H0 = float(np.median(hs))
    for v in views: v["scale"] = H0 / v["h75"] if v["h75"] else 1.0
    # merge into an equirect map
    W = a.width; Hh = W // 2
    az = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi; lat = np.pi / 2 - (np.arange(Hh) + 0.5) / Hh * np.pi
    AZ, LAT = np.meshgrid(az, lat); D = dir_of(AZ, LAT)
    acc = np.zeros((Hh, W)); wsum = np.zeros((Hh, W))
    for v in views:
        zf = D @ v["f"]; ok = zf > 0.2
        x = np.where(ok, (D @ v["r"]) / np.maximum(zf, 1e-6), 9); y = np.where(ok, (D @ v["u"]) / np.maximum(zf, 1e-6), 9)
        inside = ok & (np.abs(x) < 1) & (np.abs(y) < 1)
        w = np.where(inside, (1 - np.maximum(np.abs(x), np.abs(y))) ** 2, 0)
        px = np.clip(((x + 1) / 2 * N - 0.5).round().astype(int), 0, N - 1); py = np.clip(((1 - y) / 2 * N - 0.5).round().astype(int), 0, N - 1)
        dv = v["dist"][py, px] * v["scale"]
        acc += w * np.log(np.maximum(dv, 1e-3)); wsum += w
    out = np.where(wsum > 0, np.exp(acc / np.maximum(wsum, 1e-9)), np.nan).astype(np.float32)
    np.save(a.out + ".npy", out)
    json.dump({"model": a.model, "cameraHeightM": H0, "views": [{k: v[k] for k in ("yaw", "pitch", "groundShare", "h75", "scale", "distRange")} for v in views],
               "covered": float((wsum > 0).mean())}, open(a.out + ".json", "w"), indent=1)
    print("camera height (median of views):", round(H0, 2), "m; covered", round(float((wsum > 0).mean()), 3))


if __name__ == "__main__":
    main()
