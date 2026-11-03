#!/usr/bin/env python3
"""repaint_sidefill: re-run ONLY the paint stage (tools/project_paint.mjs + tools/paint_check.mjs) for objects already painted by arena_to_gallery,
from the existing meshes + FIBO pictures in I:\\arena-objects\\<meft>\\mesh\\<obj>\\ (mesh.obj, input.png). No FIBO, no TripoSR.
  WSL: python3 tools/repaint_sidefill.py [--only meft1009_floor_06,...]   (default: every painted object of every arena)
Same arguments as arena_to_gallery stage 3. Updates the glb, the objects.json row and results.json (pct_*, check, flags, left_raw, sidefill) of each object.
Writes the table to I:\\arena-objects\\repaint_sidefill.txt. Back up objects.json + glb/ first (done by hand to backup/before_sidefill).
WARNING (2026-11-03): every gallery glb was shrunk to 2,500 tris by tools/shrink_glb.mjs. A repaint from the TripoSR mesh (mesh.obj) rebuilds the full-size glb and UNDOES the shrink: run tools/shrink_glb.mjs --tris 2500 on it again afterwards (and update tris/bytes in objects.json).
"""
import glob, json, os, re, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = os.path.expanduser("~/.nvm/versions/node/v24.16.0/bin/node")
ROOT = "/mnt/i/arena-objects"
CAT = f"{REPO}/web/assets-lab/objects/objects.json"
GLBDIR = f"{REPO}/web/assets-lab/objects/glb"
only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
cat = {r["id"]: r for r in json.load(open(CAT))}
lines, fails, t0 = [], [], time.time()
for rf in sorted(glob.glob(f"{ROOT}/meft*/results.json")):
    W = os.path.dirname(rf); meft = os.path.basename(W); res = json.load(open(rf))
    for n, r in res.items():
        oid = f"{meft}_{n}"
        if not r.get("painted") or (only and oid not in only):
            continue
        row = cat.get(oid)
        mesh, inp = f"{W}/mesh/{n}/mesh.obj", f"{W}/mesh/{n}/input.png"
        if not row or not os.path.exists(mesh) or not os.path.exists(inp):
            fails.append((oid, "missing row/mesh/input")); continue
        p = subprocess.run([NODE, "tools/project_paint.mjs", mesh, inp, "--name", row["name"], "--id", oid, "--category", row["category"], "--kind", row["kind"],
                            "--source", row["source"], "--licence", row["licence"]], cwd=REPO, capture_output=True, text=True)
        out = p.stdout
        left = re.search(r"left raw (\d+)", out); fc = re.search(r"front picture \d+ \((\S+)%\), back picture \d+ \((\S+)%\), vertex colour (\d+) \((\S+)%\)", out)
        fit = re.search(r"FITTED camera: .*IoU (\S+)", out) or re.search(r"stock fov \d+: silhouette IoU (\S+)", out)
        ck = subprocess.run([NODE, "tools/paint_check.mjs", f"{GLBDIR}/{oid}.glb"], cwd=REPO, capture_output=True, text=True)
        if p.returncode or ck.returncode or not (left and fc and fit):
            fails.append((oid, (out + p.stderr + ck.stderr)[-300:])); continue
        c = json.loads(ck.stdout.strip().splitlines()[-1]); iou = float(fit.group(1))
        flags = []
        if c["back"]["bgPct"] is not None and c["back"]["bgPct"] > c["front"]["bgPct"] + 5: flags.append("back background > front + 5")
        if c["front"]["sat"] and c["back"]["sat"] is not None and abs(c["back"]["sat"] - c["front"]["sat"]) > 0.25 * c["front"]["sat"]: flags.append("back saturation off > 25%")
        if iou < 0.85: flags.append("IoU < 0.85")
        nleft, nvert = int(left.group(1)), int(fc.group(3))
        r.update(iou=iou, pct_front=float(fc.group(1)), pct_back=float(fc.group(2)), pct_vertex=float(fc.group(4)), check=c, flags=flags,
                 sidefill=dict(unpainted=nvert, left_raw=nleft, left_raw_pct=round(100 * nleft / max(1, nvert) * float(fc.group(4)) / 100, 2)))
        json.dump(res, open(rf, "w"), indent=1)
        rows = json.load(open(CAT)); at = next((i for i, x in enumerate(rows) if x["id"] == oid), None)   # project_paint rewrote the row: put the gallery detail info back on it
        if at is not None:
            rows[at]["flags"] = flags; rows[at]["paint"] = dict(iou=iou, front=r["pct_front"], back=r["pct_back"], vertex=r["pct_vertex"], left_raw=nleft)
            json.dump(rows, open(CAT, "w"), indent=1); open(CAT, "a").write("\n")
        sf = re.search(r"SIDEFILL: .*", out.split("SIDEFILL colours")[-1]).group(0)[:160]
        lines.append(f"{oid}\tleft_raw {nleft} ({r['sidefill']['left_raw_pct']}% of faces)\tunpainted_before {fc.group(4)}%\tside sat {c['side']['sat']} front sat {c['front']['sat']}\tflags {flags or 'none'}")
        print(lines[-1], flush=True)
open(f"{ROOT}/repaint_sidefill.txt", "w").write("\n".join(lines) + f"\nFAILED {len(fails)}\n" + "\n".join(f"{a}: {b}" for a, b in fails) + f"\nelapsed {round(time.time() - t0)} s\n")
print(f"done {len(lines)} ok, {len(fails)} failed, {round(time.time() - t0)} s")
