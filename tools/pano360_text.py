"""Text-only 360 panoramas with SDXL 360 Diffusion on the RX 9060 XT (ROCm venv pano360-rocm), 1024x512.

Method (measured 2026-10-28, beach prompt, seeds 2 and 3, then 4 prompts):
- x-circular conv padding on the UNet from the FIRST step gives colour garbage (45% of pixels saturation > 200 vs 6-12%),
  with Euler and DPM alike. The wrap itself is correct (a rolled input gives the rolled output, diff 0.0006 of 0.66).
- So: UNet wrap only for the last 30% of steps, VAE wrap always. Seam then at or below the neighbour-column difference.
- No negative prompt and cfg 7 looked best to the user (no negative = fewer oversaturated pixels on every prompt).
Upscale afterwards with upscale_assets.py: pad 32 px from the opposite side first, cut 128 px after (else seam opens).

  python pano360_text.py <prompts.txt> <out_dir> [--cfg 7] [--steps 30] [--late 0.3] [--seed 1] [--neg ""]
"""
import argparse, json, os, time
import numpy as np, torch
import torch.nn.functional as F
from diffusers import StableDiffusionXLPipeline, UNet2DConditionModel, AutoencoderKL

ON = {"v": False}


def wrap_x(model, switch):
    """Pad x circularly, y with zeros, in every padded Conv2d. switch=True: only while ON["v"]."""
    for m in model.modules():
        if isinstance(m, torch.nn.Conv2d) and m.padding != (0, 0):
            r = m._reversed_padding_repeated_twice
            px, py, orig = r[0], r[2], m._conv_forward

            def cf(x, weight, bias, self=m, px=px, py=py, orig=orig):
                if switch and not ON["v"]:
                    return orig(x, weight, bias)
                x = F.pad(x, (px, px, 0, 0), mode="circular")
                x = F.pad(x, (0, 0, py, py))
                return F.conv2d(x, weight, bias, self.stride, 0, self.dilation, self.groups)
            m._conv_forward = cf


def measure(img):
    o = np.asarray(img).astype(np.float32)
    s = np.asarray(img.convert("HSV"))[..., 1]
    return {"seam": round(float(np.abs(o[:, 0] - o[:, -1]).mean()), 2),
            "inner": round(float(np.abs(o[:, 1:] - o[:, :-1]).mean()), 2),
            "sat200": round(float((s > 200).mean()), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prompts"); ap.add_argument("out")
    ap.add_argument("--cfg", type=float, default=7.0)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--late", type=float, default=0.3)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--neg", default="")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    dt = torch.float16
    unet = UNet2DConditionModel.from_pretrained("ProGamerGov/sdxl-360-diffusion", subfolder="unet", torch_dtype=dt)
    vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=dt)
    pipe = StableDiffusionXLPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", unet=unet, vae=vae,
                                                     variant="fp16", torch_dtype=dt)
    wrap_x(pipe.unet, True); wrap_x(pipe.vae, False); pipe.to("cuda")

    def cb(p, i, t, kw):
        ON["v"] = i + 1 >= a.steps * (1 - a.late)
        return kw
    rep = []
    for i, p in enumerate(l.strip() for l in open(a.prompts, encoding="utf-8") if l.strip()):
        ON["v"] = False; t = time.time()
        img = pipe(prompt=p, negative_prompt=a.neg, width=1024, height=512, num_inference_steps=a.steps,
                   guidance_scale=a.cfg, generator=torch.Generator("cuda").manual_seed(a.seed + i),
                   callback_on_step_end=cb).images[0]
        name = "p%02d.png" % (i + 1)
        img.save(os.path.join(a.out, name))
        r = {"file": name, "prompt": p, "cfg": a.cfg, "seconds": round(time.time() - t, 1), **measure(img)}
        rep.append(r); print(json.dumps(r), flush=True)
        json.dump(rep, open(os.path.join(a.out, "report.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
