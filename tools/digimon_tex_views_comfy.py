"""Windows-side ComfyUI client for tools/digimon_tex_views.py (ComfyUI listens on 127.0.0.1 of Windows, WSL cannot reach it).
Run with L:\\fibo\\venv\\Scripts\\python.exe (stdlib only):
  python digimon_tex_views_comfy.py ping                 exit 0 if ComfyUI answers /system_stats
  python digimon_tex_views_comfy.py start <log>          start L:\\fibo\\scripts\\start-comfy.cmd with the stable flags
                                                         (--disable-mmap --disable-pinned-memory --disable-async-offload),
                                                         detached, output to <log>; wait until it answers (600 s)
  python digimon_tex_views_comfy.py kill                 end the process tree listening on port 8199, wait until it is free
  python digimon_tex_views_comfy.py run <graph.json> [timeout s]   queue the graph, wait, print the outputs as JSON
"""
import json, subprocess, sys, time, urllib.request

SRV = "http://127.0.0.1:8199"
START = r"L:\fibo\scripts\start-comfy.cmd"
FLAGS = ["--disable-mmap", "--disable-pinned-memory", "--disable-async-offload"]


def get(path):
    return json.load(urllib.request.urlopen(SRV + path, timeout=10))


def post(path, obj):
    r = urllib.request.Request(SRV + path, json.dumps(obj).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=30))


def alive():
    try:
        get("/system_stats")
        return True
    except Exception:
        return False


def pids():
    r = subprocess.run(["powershell.exe", "-NoProfile", "-Command",
                        "Get-NetTCPConnection -LocalPort 8199 -State Listen -ErrorAction SilentlyContinue | "
                        "Select-Object -ExpandProperty OwningProcess"], capture_output=True, text=True)
    return sorted({int(x) for x in r.stdout.split() if x.strip().isdigit() and int(x) > 0})


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "ping":
        sys.exit(0 if alive() else 1)
    if cmd == "kill":
        for p in pids():
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(p)], capture_output=True)
        t0 = time.time()
        while (pids() or alive()) and time.time() - t0 < 60:
            time.sleep(1)
        print("killed" if not pids() else "still listening")
        sys.exit(0 if not pids() else 1)
    if cmd == "start":
        if alive():
            print("already running")
            sys.exit(0)
        log = open(sys.argv[2], "ab")
        flags = 0x00000008 | 0x00000200 | 0x08000000      # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        subprocess.Popen(["cmd.exe", "/c", START] + FLAGS, stdout=log, stderr=log, stdin=subprocess.DEVNULL,
                         creationflags=flags, cwd="L:\\")
        t0 = time.time()
        while time.time() - t0 < 600:
            if alive():
                print(f"started in {time.time() - t0:.0f} s")
                sys.exit(0)
            time.sleep(2)
        print("did not start", file=sys.stderr)
        sys.exit(1)
    g = json.load(open(sys.argv[2], encoding="utf-8"))
    limit = float(sys.argv[3]) if len(sys.argv) > 3 else 900
    pid = post("/prompt", {"prompt": g})["prompt_id"]
    t0 = time.time()
    while True:
        h = get(f"/history/{pid}")
        if pid in h:
            st = h[pid]["status"]
            if st.get("status_str") == "error":
                print(json.dumps(st.get("messages"))[:2000], file=sys.stderr)
                sys.exit(1)
            if st.get("completed"):
                break
        if time.time() - t0 > limit:
            print("timeout", file=sys.stderr)
            sys.exit(3)
        time.sleep(0.5)
    imgs = [o["images"][0] for o in h[pid]["outputs"].values() if o.get("images")]
    print(json.dumps(dict(imgs[0] if imgs else {}, secs=round(time.time() - t0, 1))))
