#!/usr/bin/env python3
"""fibo_p5_one: ONE FIBO picture per ComfyUI start (the method that works; I:\\fibo-prompt-test\\run_p56.py). Runs on WINDOWS python
(stdlib only):  L:\\fibo\\venv\\Scripts\\python.exe -I tools\\fibo_p5_one.py one <in.png> <out.png> <prompt.txt> [steps]
                                                          check          -> "port8199 listening=N, main.py/8199 python procs=M"
                                                          kill           -> kill every FIBO ComfyUI (port 8199 / main.py + 8199), whole tree
Per picture: pre-kill, C: guard, start L:\\fibo\\scripts\\start-comfy.cmd (flags below), wait, post the graph (seed 1234, steps 4, input = the
given *_in.png), poll, copy the result, finally-kill, then check port 8199 listening=0 and FIBO python=0.
Retries: a closed connection (WinError 10054 etc.) is retried up to 2 times (fresh start each time).
C: guard 2.5 GB (polled each second while running): below -> FIBO killed, status "lowC" (the caller waits for C: > 10 GB and retries once).
Last stdout line = JSON {"status": ok|lowC|fail, "secs": compute secs, "err": ..., "check": ...}.
"""
import json, os, shutil, subprocess, sys, time, urllib.request

SRV = "http://127.0.0.1:8199"
C = r"L:\fibo\ComfyUI"
START = r"L:\fibo\scripts\start-comfy.cmd"
FLAGS = ["--disable-mmap", "--disable-pinned-memory", "--disable-async-offload"]
# extra ComfyUI flags (one line) from I:/arena-objects/_helper/extra_flags.txt when present (2026-11-03: --cache-none)
try:
    FLAGS += open("I:/arena-objects/_helper/extra_flags.txt").read().split()
except OSError:
    pass
GUARD = 2.5
PS_KILL = ("Get-NetTCPConnection -LocalPort 8199 -State Listen -EA SilentlyContinue | %{ taskkill /PID $_.OwningProcess /T /F }; "
           "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ?{ $_.CommandLine -match 'main.py' -and $_.CommandLine -match '8199' } "
           "| %{ taskkill /PID $_.ProcessId /T /F }")
PS_CHECK = ("$p=@(Get-NetTCPConnection -LocalPort 8199 -State Listen -EA SilentlyContinue).Count; "
            "$q=@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ?{ $_.CommandLine -match 'main.py' -and $_.CommandLine -match '8199' }).Count; "
            "\"port8199 listening=$p, main.py/8199 python procs=$q\"")


DBG = [None]


def dbg(msg):
    """timestamped step log next to the picture (<out>_helper.log) so a hang/crash shows where"""
    if DBG[0]:
        with open(DBG[0], "a") as f:
            f.write(time.strftime("%H:%M:%S ") + msg + chr(10))


def free():
    return shutil.disk_usage("C:\\").free / 1e9


def killport():
    dbg("killport start")
    subprocess.run(["powershell", "-NoProfile", "-Command", PS_KILL], capture_output=True, timeout=90, stdin=subprocess.DEVNULL)
    dbg("killport done")


def check():
    dbg("check start")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", PS_CHECK], capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL).stdout.strip()
    dbg("check done: " + r)
    return r


def get(u):
    return json.load(urllib.request.urlopen(SRV + u, timeout=10))


def graph(inname, prompt, prefix, steps):
    return {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": "fibo2_edit_turbo_int8_convrot.safetensors", "weight_dtype": "default"}},
            "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_int8_convrot.safetensors", "type": "fibo2", "device": "default"}},
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
            "10": {"class_type": "LoadImage", "inputs": {"image": inname}},
            "4": {"class_type": "TextEncodeFibo2", "inputs": {"clip": ["2", 0], "prompt": prompt, "negative_prompt": "", "vae": ["3", 0], "images.image_1": ["10", 0], "width": 1024, "height": 1024, "batch_size": 1}},
            "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["4", 1], "latent_image": ["4", 2], "seed": 1234, "steps": steps, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
            "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["3", 0]}},
            "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}}}


def attempt(inimg, outimg, prompt, steps):
    """returns (status, secs, err). status ok | lowC | retry (connection closed) | fail"""
    dbg("attempt start")
    killport(); time.sleep(2)
    if free() < GUARD:
        return "lowC", 0, "C: free %.1f GB before start" % free()
    # ComfyUI's own output, one log per picture (<out>_comfy.log), unbuffered so a crash leaves its last lines; cwd = a Windows path (not the UNC repo path)
    # (a DETACHED process gets no std handles, so the redirect is done by cmd itself)
    lgp = os.path.splitext(outimg)[0] + "_comfy.log"
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    subprocess.Popen('cmd.exe /c ""%s" %s > "%s" 2>&1"' % (START, " ".join(FLAGS), lgp), stdin=subprocess.DEVNULL, cwd=r"I:\arena-objects", env=env,
                     creationflags=0x00000008 | 0x00000200)
    t0 = time.time()
    dbg("ComfyUI launched with flags %s, waiting for port" % " ".join(FLAGS))
    while True:
        try:
            get("/system_stats"); dbg("ComfyUI up after %.0f s" % (time.time() - t0)); break
        except Exception:
            if free() < GUARD:
                return "lowC", 0, "C: free %.1f GB while starting" % free()
            if time.time() - t0 > 240:
                return "fail", 0, "ComfyUI did not start in 240 s"
            time.sleep(2)
    name = "p5_" + os.path.basename(inimg)
    shutil.copy(inimg, os.path.join(C, "input", name))
    prefix = "p5/" + os.path.splitext(os.path.basename(outimg))[0]
    t = time.time()
    try:
        r = urllib.request.Request(SRV + "/prompt", json.dumps({"prompt": graph(name, prompt, prefix, steps)}).encode(), {"Content-Type": "application/json"})
        pid = json.load(urllib.request.urlopen(r, timeout=30))["prompt_id"]
        while time.time() - t < 420:
            time.sleep(1)
            if free() < GUARD:
                return "lowC", 0, "C: free %.1f GB while running" % free()
            h = get("/history/" + pid)
            if pid in h:
                st = h[pid]["status"]
                if st.get("status_str") == "error":
                    msg = json.dumps(st["messages"])
                    dbg("ERROR MESSAGE FULL: " + msg[:6000])
                    if "1455" in msg or "paging file" in msg:    # Windows commit limit hit while the model loads (seen 2026-11-03): try again in a minute
                        return "retry", 0, "paging file too small (os error 1455) while loading the model"
                    return "fail", 0, "error " + msg[:600]
                if st.get("completed"):
                    o = h[pid]["outputs"]["7"]["images"][0]
                    shutil.copy(os.path.join(C, "output", o["subfolder"], o["filename"]), outimg)
                    dbg("picture copied")
                    return "ok", round(time.time() - t, 1), ""
        return "fail", 0, "timeout 420 s"
    except (ConnectionError, OSError) as e:   # WinError 10054 forcibly closed, URLError, ...
        return "retry", 0, "%s: %s" % (type(e).__name__, str(e)[:200])


WORK = r"L:\fibo\work"
PHASED = not os.path.exists("I:/arena-objects/_helper/single.txt")    # default: three ComfyUI starts per picture, one int8 model each (attempt_phased; byte-identical pictures to the single graph, tested on floor_05_c0_r253, and it fits the Windows commit limit). single.txt = the old one-graph way


def phased_graphs(name, prompt, cond, lat, prefix, steps):
    """The P5 graph cut at disk caches exactly like tools/digimon_tex_views.py (custom nodes L:/fibo/ComfyUI/custom_nodes/dtv_cache.py), so a
    ComfyUI process never holds two int8 models: A = TextEncodeFibo2 with the photo -> cond file; B = UNet sampling -> latent file;
    C = VAE decode -> PNG. Same node inputs / seed / steps / cfg / sampler as graph()."""
    models = {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": "fibo2_edit_turbo_int8_convrot.safetensors", "weight_dtype": "default"}},
              "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_int8_convrot.safetensors", "type": "fibo2", "device": "default"}},
              "3": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}}}
    A = {"2": models["2"], "3": models["3"], "10": {"class_type": "LoadImage", "inputs": {"image": name}},
         "4": {"class_type": "TextEncodeFibo2", "inputs": {"clip": ["2", 0], "prompt": prompt, "negative_prompt": "", "vae": ["3", 0], "images.image_1": ["10", 0],
                                                          "width": 1024, "height": 1024, "batch_size": 1}},
         "20": {"class_type": "DTVSaveCond", "inputs": {"positive": ["4", 0], "negative": ["4", 1], "latent": ["4", 2], "path": cond}}}
    B = {"1": models["1"], "21": {"class_type": "DTVLoadCond", "inputs": {"path": cond}},
         "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["21", 0], "negative": ["21", 1], "latent_image": ["21", 2], "seed": 1234,
                                                    "steps": steps, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
         "22": {"class_type": "DTVSaveLatent", "inputs": {"samples": ["5", 0], "path": lat}}}
    C = {"3": models["3"], "23": {"class_type": "DTVLoadLatent", "inputs": {"path": lat}}, "6": {"class_type": "VAEDecode", "inputs": {"samples": ["23", 0], "vae": ["3", 0]}},
         "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}}}
    return A, B, C


def run_graph(g, outimg, tag):
    """start a fresh ComfyUI, run graph g, leave it running (the caller kills). Returns (status, err, history entry). status ok | retry | lowC | fail"""
    killport(); time.sleep(2)
    if free() < GUARD:
        return "lowC", "C: free %.1f GB before start" % free(), None
    lgp = os.path.splitext(outimg)[0] + "_comfy.log"
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    subprocess.Popen('cmd.exe /c ""%s" %s > "%s" 2>&1"' % (START, " ".join(FLAGS), lgp), stdin=subprocess.DEVNULL, cwd=r"I:\arena-objects", env=env,
                     creationflags=0x00000008 | 0x00000200)
    t0 = time.time()
    dbg("phase %s: ComfyUI launched, waiting for port" % tag)
    while True:
        try:
            get("/system_stats"); dbg("phase %s: ComfyUI up after %.0f s" % (tag, time.time() - t0)); break
        except Exception:
            if free() < GUARD:
                return "lowC", "C: free %.1f GB while starting" % free(), None
            if time.time() - t0 > 240:
                return "fail", "ComfyUI did not start in 240 s", None
            time.sleep(2)
    t = time.time()
    try:
        r = urllib.request.Request(SRV + "/prompt", json.dumps({"prompt": g}).encode(), {"Content-Type": "application/json"})
        pid = json.load(urllib.request.urlopen(r, timeout=30))["prompt_id"]
        while time.time() - t < 300:
            time.sleep(1)
            if free() < GUARD:
                return "lowC", "C: free %.1f GB while running" % free(), None
            h = get("/history/" + pid)
            if pid in h:
                st = h[pid]["status"]
                if st.get("status_str") == "error":
                    msg = json.dumps(st["messages"])
                    dbg("phase %s ERROR MESSAGE FULL: %s" % (tag, msg[:6000]))
                    if "1455" in msg or "paging file" in msg:
                        return "retry", "paging file too small (os error 1455) in phase " + tag, None
                    return "fail", "error " + msg[:600], None
                if st.get("completed"):
                    dbg("phase %s done after %.0f s" % (tag, time.time() - t))
                    return "ok", "", h[pid]
        return "fail", "timeout 300 s in phase " + tag, None
    except (ConnectionError, OSError) as e:
        return "retry", "%s in phase %s: %s" % (type(e).__name__, tag, str(e)[:200]), None


def attempt_phased(inimg, outimg, prompt, steps):
    """3 ComfyUI starts per picture (A text encode, B UNet, C VAE). A phase whose file already exists is skipped (so a retry resumes)."""
    stem = "p5_" + os.path.splitext(os.path.basename(outimg))[0]
    cond, lat = WORK + "\\cond\\" + stem + ".pt", WORK + "\\lat\\" + stem + ".pt"
    os.makedirs(WORK + "\\cond", exist_ok=True); os.makedirs(WORK + "\\lat", exist_ok=True)
    name = "p5_" + os.path.basename(inimg)
    shutil.copy(inimg, os.path.join(C, "input", name))
    A, B, Cg = phased_graphs(name, prompt, cond, lat, "p5/" + os.path.splitext(os.path.basename(outimg))[0], steps)
    t = time.time()
    for tag, g, done in (("A", A, cond), ("B", B, lat)):
        if not os.path.exists(done):
            try:
                s, err, _ = run_graph(g, outimg, tag)
            finally:
                killport(); time.sleep(3)
            if s != "ok" or not os.path.exists(done):
                return (s if s != "ok" else "fail"), 0, err or ("phase %s left no file" % tag)
    try:
        s, err, h = run_graph(Cg, outimg, "C")
        if s != "ok":
            return s, 0, err
        o = h["outputs"]["7"]["images"][0]
        shutil.copy(os.path.join(C, "output", o["subfolder"], o["filename"]), outimg)
    finally:
        killport(); time.sleep(3)
    dbg("picture copied")
    for f in (cond, lat):
        try: os.remove(f)
        except OSError: pass
    return "ok", round(time.time() - t, 1), ""


def one(inimg, outimg, prompt, steps=4):
    DBG[0] = os.path.splitext(outimg)[0] + "_helper.log"
    dbg("one start %s" % os.path.basename(outimg))
    res = {"status": "fail", "secs": 0, "err": "", "check": ""}
    try:
        for n in range(6):          # first try + up to 5 retries on a closed connection / paging-file (1455) error
            try:
                s, secs, err = (attempt_phased if PHASED else attempt)(inimg, outimg, prompt, steps)
            finally:
                killport(); time.sleep(5)
            dbg("attempt %d result: %s %s" % (n + 1, s, err))
            res.update(status=s, secs=secs, err=err + ("" if n == 0 else " (try %d)" % (n + 1)))
            if s != "retry":
                break
            if "1455" in err:
                time.sleep(20)
        if res["status"] == "retry":
            res["status"] = "fail"
    except Exception as e:
        res.update(status="fail", err="EXC %s %s" % (type(e).__name__, str(e)[:300]))
    finally:
        killport(); time.sleep(3)
        for _ in range(3):
            res["check"] = check()
            if "listening=0" in res["check"] and "procs=0" in res["check"]:
                break
            killport(); time.sleep(3)
    dbg("result " + json.dumps(res))
    rf = os.path.splitext(outimg)[0] + "_result.json"
    with open(rf + ".tmp", "w") as fh:
        fh.write(json.dumps(res) + chr(10))
    os.replace(rf + ".tmp", rf)
    print(json.dumps(res), flush=True)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "one":
        one(sys.argv[2], sys.argv[3], open(sys.argv[4], encoding="utf-8").read().strip(), int(sys.argv[5]) if len(sys.argv) > 5 else 4)
    elif cmd == "check":
        print(check())
    elif cmd == "kill":
        killport(); time.sleep(3); print(check())
    elif cmd == "free":
        print(round(free(), 2))
