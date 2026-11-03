#!/usr/bin/env python3
"""Save helper for web/quest-editor.html (port 8091, this machine only).

    python3 tools/quest_editor_server.py        (start it hidden: nohup, or wsl.exe hidden from Start-Process)

Why a second server: ~/serve_game.py (8090) only serves files, and the launcher (8770) only knows the disc picks. The page
is served on 8090 as usual and talks to this one for load / save.

  GET  /load   {characters, paths, maps}   the sources: data/authored/quests/new_characters.json and quest-paths.json
  POST /save   {keep: [npc_id...], residents: {npc_id: [...]}, paths: {...}}
                 1. checks every resident and path point is walkable (tools/quest_editor_check.mjs = web/quest-walk.js);
                 2. backs the old files up (first overwrite: ~/quest-editor-backups/orig/, every save: .../last/, kept as a safety copy);
                 3. writes data/authored/quests/new_characters.json + quest-paths.json and their mirrors in quests/
                    (what tools/install_authored_data.py would copy) and web/quest-paths.json (what the game reads);
                 4. rebuilds web/extra_npcs.json with tools/make_quest_sprites.py.
  (Discard in the page just reloads the files from /load: the last save.)

Nothing here touches disc data. Backups live outside the repo.
"""
import glob
import http.server
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "data", "authored", "quests")
CHARS = os.path.join(SRC, "new_characters.json")
PATHS = os.path.join(SRC, "quest-paths.json")
MIRROR = os.path.join(ROOT, "quests")
WEB_PATHS = os.path.join(ROOT, "web", "quest-paths.json")
WEB_NPCS = os.path.join(ROOT, "web", "extra_npcs.json")
BACKUP = os.path.expanduser("~/quest-editor-backups")
PORT = 8091
ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1):\d+$")
PATHS_COMMENT = ("Named walking routes for quest scenes. A scene step { \"walk\": 27, \"path\": \"name\" } walks the points in "
                 "order, each leg routed round walls like any quest walk (web/quest-scenes.js). Drawn in web/quest-editor.html; "
                 "every point is walkable ground (web/quest-walk.js). Mirrored to quests/ and web/quest-paths.json on save.")


def node():
    found = shutil.which("node")
    if found:
        return found
    cands = sorted(glob.glob(os.path.expanduser("~/.nvm/versions/node/*/bin/node")))
    if not cands:
        raise RuntimeError("node not found")
    return cands[-1]


def read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data, indent):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent, ensure_ascii=False)
        f.write("\n")


def maps():
    return sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(ROOT, "web", "assets", "collision", "s*.json")))


def references(npc_id):
    """Source files that name this character (quest packs, dialogue): removing it would break them."""
    hit = []
    pat = re.compile(r"(?<![\d.])%d(?![\d.])" % npc_id)
    files = glob.glob(os.path.join(SRC, "*.py")) + [os.path.join(SRC, "characters.json"), os.path.join(SRC, "legacy.json")]
    for f in sorted(files):
        if os.path.exists(f) and pat.search(open(f, encoding="utf-8").read()):
            hit.append(os.path.basename(f))
    return hit


def clean_resident(r):
    return {"map": str(r["map"]), "x": int(round(r["x"])), "y": int(round(r["y"])), "dir": str(r["dir"])}


def clean_paths(paths):
    out = {}
    for name in sorted(paths):
        p = paths[name]
        rec = {"map": str(p["map"])}
        if p.get("npc") is not None:
            rec["npc"] = int(p["npc"])
        rec["points"] = [[int(round(x)), int(round(y))] for x, y in p["points"]]
        out[name] = rec
    return out


def save(body):
    cur = read_json(CHARS, {"characters": []})
    keep = [int(n) for n in body["keep"]]
    res = {int(k): v for k, v in body["residents"].items()}
    new_chars = []
    for ch in cur["characters"]:
        if ch["npc_id"] not in keep:
            refs = references(ch["npc_id"])
            if refs:
                return 409, {"problems": [f"{ch['name']} ({ch['npc_id']}) is used by {', '.join(refs)}: take it out of the quests first"]}
            continue
        ch = dict(ch)
        ch["residents"] = [clean_resident(r) for r in res.get(ch["npc_id"], ch.get("residents", []))]
        new_chars.append(ch)
    new_paths = clean_paths(body.get("paths", {}))
    ids = {c["npc_id"] for c in new_chars}
    for name, p in new_paths.items():
        if "npc" in p and p["npc"] not in ids:
            return 409, {"problems": [f"path {name} belongs to character {p['npc']} who is being removed: delete the path too"]}
    data = {"characters": new_chars, "paths": new_paths}
    r = subprocess.run([node(), os.path.join(ROOT, "tools", "quest_editor_check.mjs")], input=json.dumps(data), text=True,
                       capture_output=True, cwd=ROOT)
    if r.returncode != 0:
        return 500, {"problems": ["the walk check failed to run: " + r.stderr.strip()[-300:]]}
    problems = json.loads(r.stdout)
    if problems:
        return 422, {"problems": problems}
    # back up: the first overwrite keeps the originals for good; every save keeps the state before it (for Discard)
    files = [CHARS, PATHS, WEB_NPCS, WEB_PATHS]
    for kind in ("orig", "last"):
        d = os.path.join(BACKUP, kind)
        if kind == "orig" and os.path.isdir(d):
            continue
        os.makedirs(d, exist_ok=True)
        for f in files:
            if os.path.exists(f):
                shutil.copyfile(f, os.path.join(d, os.path.basename(f)))
    cur["characters"] = new_chars
    write_json(CHARS, cur, 1)
    paths_doc = {"_comment": PATHS_COMMENT, "paths": new_paths}
    write_json(PATHS, paths_doc, 1)
    write_json(WEB_PATHS, paths_doc, 1)
    for name in ("new_characters.json", "quest-paths.json"):
        shutil.copyfile(os.path.join(SRC, name), os.path.join(MIRROR, name))
    b = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "make_quest_sprites.py")], capture_output=True, text=True, cwd=ROOT)
    if b.returncode != 0:
        return 500, {"problems": ["saved, but make_quest_sprites.py failed: " + (b.stderr or b.stdout).strip()[-400:]]}
    lines = b.stdout.strip().splitlines()
    return 200, {"ok": True, "built": lines[-1] if lines else ""}


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        origin = self.headers.get("Origin", "")
        if ORIGIN.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.reply(204, {})

    def do_GET(self):
        if self.path.split("?")[0] == "/load":
            return self.reply(200, {"characters": read_json(CHARS, {"characters": []})["characters"],
                                    "paths": read_json(PATHS, {"paths": {}})["paths"], "maps": maps()})
        self.reply(404, {"problems": ["not found"]})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/save":
                return self.reply(*save(body))
            self.reply(404, {"problems": ["not found"]})
        except Exception as e:  # a bad request must answer, not hang the page
            self.reply(400, {"problems": [f"{type(e).__name__}: {e}"]})


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
