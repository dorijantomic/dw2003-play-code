#!/usr/bin/env python3
"""Windows-side helper for arena_to_gallery.py (WSL cannot reach ComfyUI on 127.0.0.1:8199, Windows can). Stdlib only.
  python.exe fibo_http.py up                   -> exit 0 if ComfyUI answers
  python.exe fibo_http.py submit graph.json    -> runs the graph, prints "<saved file path>" (of node 7), exit 1 + error text on failure
"""
import json, os, sys, time, urllib.request
SRV = "http://127.0.0.1:8199"
C = r"L:\fibo\ComfyUI"
if sys.argv[1] == "up":
    try:
        urllib.request.urlopen(SRV + "/system_stats", timeout=3).read(); sys.exit(0)
    except Exception:
        sys.exit(1)
g = json.load(open(sys.argv[2]))
r = urllib.request.Request(SRV + "/prompt", json.dumps({"prompt": g}).encode(), {"Content-Type": "application/json"})
pid = json.load(urllib.request.urlopen(r))["prompt_id"]
while True:
    h = json.load(urllib.request.urlopen(SRV + "/history/" + pid))
    if pid in h:
        st = h[pid]["status"]
        if st.get("status_str") == "error":
            print(json.dumps(st["messages"])[:2000]); sys.exit(1)
        if st.get("completed"): break
    time.sleep(1)
o = h[pid]["outputs"]["7"]["images"][0]
print(os.path.join(C, "output", o["subfolder"], o["filename"]))
