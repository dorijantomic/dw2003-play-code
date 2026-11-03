"""Repaint a game arena's 360 render (equirect, horizon at mid) with SDXL 360 Diffusion + canny ControlNet img2img.

  python pano360_restyle.py <in.png> <out_dir> [--strength 0.4,0.55,0.7] [--cn 0.6] [--steps 30] [--seed 7]

Left/right wrap: every Conv2d pads x circularly, y with zeros (so the seam is generated joined).
Numbers per output (out_dir/report.json):
  size, seconds, seam = mean |col0 - colLast| vs mean |col i - col i+1| (inner),
  layout = correlation of 8 px blurred edge maps (input vs output) at 1024x512, and best (dx, dy) in -16..16 px.
"""
import argparse, json, os, time
import numpy as np, cv2, torch
from PIL import Image
import torch.nn.functional as F
from diffusers import (StableDiffusionXLControlNetImg2ImgPipeline, ControlNetModel, UNet2DConditionModel,
                       AutoencoderKL, DPMSolverMultistepScheduler)

PROMPT = ("equirectangular 360 view, 360 panorama, smooth clean soft hand-painted game backdrop, "
          "soft brush shading, calm and uncluttered")
NEG = "photo, photograph, film grain, noise, outlines, line art, text, watermark, people, frame, border, blurry"


def wrap_x(model):
    for m in model.modules():
        if isinstance(m, torch.nn.Conv2d) and m.padding != (0, 0) and not getattr(m, "_wrapx", False):
            py, px = m.padding
            m._wrapx = True
            m._pad = (px, px, py, py)
            m.padding = (0, 0)
            def fwd(x, self=m):
                x = F.pad(x, (self._pad[0], self._pad[1], 0, 0), mode="circular")
                x = F.pad(x, (0, 0, self._pad[2], self._pad[3]), mode="constant")
                return self._conv_forward(x, self.weight, self.bias)
            m.forward = fwd


def edges(a):
    g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    e = cv2.Canny(g, 60, 140).astype(np.float32)
    return cv2.GaussianBlur(e, (0, 0), 4)


def measure(inp, out):
    o = np.asarray(out).astype(np.float32)
    seam = float(np.abs(o[:, 0] - o[:, -1]).mean())
    inner = float(np.abs(o[:, 1:] - o[:, :-1]).mean())
    a = np.asarray(inp.resize((1024, 512), Image.BILINEAR))
    b = np.asarray(out.resize((1024, 512), Image.BILINEAR))
    ea, eb = edges(a), edges(b)
    best = (-2, 0, 0)
    for dy in range(-16, 17, 2):
        for dx in range(-16, 17, 2):
            sb = np.roll(eb, (dy, dx), axis=(0, 1))[20:-20]
            c = float(np.corrcoef(ea[20:-20].ravel(), sb.ravel())[0, 1])
            if c > best[0]:
                best = (c, dx, dy)
    c0 = float(np.corrcoef(ea.ravel(), eb.ravel())[0, 1])
    return {"seam": round(seam, 2), "inner": round(inner, 2), "edgeCorr": round(c0, 3),
            "bestShift": [best[1], best[2]], "bestCorr": round(best[0], 3),
            "meanRGB": [round(float(x)) for x in o.reshape(-1, 3).mean(0)]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp"); ap.add_argument("out")
    ap.add_argument("--strength", default="0.4,0.55,0.7")
    ap.add_argument("--cn", type=float, default=0.6)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--cfg", type=float, default=6.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--w", type=int, default=2048)
    ap.add_argument("--prompt", default=PROMPT)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    dev, dt = "cuda", torch.float16

    unet = UNet2DConditionModel.from_pretrained("ProGamerGov/sdxl-360-diffusion", subfolder="unet", torch_dtype=dt)
    vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=dt)
    cn = ControlNetModel.from_pretrained("diffusers/controlnet-canny-sdxl-1.0", variant="fp16", torch_dtype=dt)
    pipe = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0", unet=unet, vae=vae, controlnet=cn, variant="fp16", torch_dtype=dt)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
    for m in (pipe.unet, pipe.vae, pipe.controlnet):
        wrap_x(m)
    if a.w > 1024:
        pipe.enable_attention_slicing()
        pipe.enable_model_cpu_offload()
    else:
        pipe.to(dev)

    W, H = a.w, a.w // 2
    inp = Image.open(a.inp).convert("RGB").resize((W, H), Image.LANCZOS)
    g = cv2.cvtColor(np.asarray(inp), cv2.COLOR_RGB2GRAY)
    ctrl = Image.fromarray(np.stack([cv2.Canny(g, 60, 140)] * 3, -1))
    ctrl.save(os.path.join(a.out, "control_canny.png"))
    rep = {"input": a.inp, "size": [W, H], "prompt": a.prompt, "neg": NEG, "cn": a.cn, "steps": a.steps,
           "cfg": a.cfg, "seed": a.seed, "inputMeasure": measure(inp, inp), "runs": []}
    for s in [float(x) for x in a.strength.split(",")]:
        t = time.time()
        img = pipe(prompt=a.prompt, negative_prompt=NEG, image=inp, control_image=ctrl, strength=s,
                   controlnet_conditioning_scale=a.cn, num_inference_steps=a.steps, guidance_scale=a.cfg,
                   width=W, height=H, generator=torch.Generator(dev).manual_seed(a.seed)).images[0]
        sec = time.time() - t
        name = "restyle_s%02d.png" % round(s * 100)
        img.save(os.path.join(a.out, name))
        r = {"file": name, "strength": s, "seconds": round(sec, 1), "size": list(img.size), **measure(inp, img)}
        rep["runs"].append(r)
        print(json.dumps(r), flush=True)
        json.dump(rep, open(os.path.join(a.out, "report.json"), "w"), indent=1)
    print("peak GB %.1f" % (torch.cuda.max_memory_allocated() / 2**30))


if __name__ == "__main__":
    main()
