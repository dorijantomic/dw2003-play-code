// New Gemini-made NPCs and bosses, end to end with SYNTHETIC data (shapes drawn by this test, nothing from the disc):
//   tools/newnpc_export.py (measures the synthetic townspeople sprites) -> a fake "Gemini" picture (3 figures on the flat
//   background colour the prompt asked for) -> tools/newnpc_export.py --install -> tools/make_quest_sprites.py
//   -> web/extra_npcs.json record + web/extra_sprites/q<id>.png in the 120 x 384 layout.
// Everything happens in a temp copy of the tools; the real new_characters.json / extra_npcs.json are hashed before and after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fromJSON, rectBlocked } from "../engine/core/util/collision.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "newnpc-test-"));
const REPO = join(TMP, "repo");
const WEB = join(REPO, "web");
const readJ = (p) => JSON.parse(readFileSync(p, "utf8"));
const py = (args) => spawnSync("python3", args, { encoding: "utf8" });
const sha = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "absent");
const REAL = ["data/authored/quests/new_characters.json", "quests/new_characters.json", "web/extra_npcs.json"].map((f) => join(ROOT, f));
const realBefore = REAL.map(sha);

const SYNTH = String.raw`
import json, os, sys
from PIL import Image, ImageDraw
mode, root = sys.argv[1], sys.argv[2]
if mode == "repo":
    for d in ("web/assets/sprites", "web/assets/collision", "web/assets/scenes", "web/assets/maps", "data/authored/quests", "quests"):
        os.makedirs(root + "/" + d, exist_ok=True)
    recs = []
    for i, (h, w) in enumerate([(33, 20), (34, 21), (35, 21), (35, 22), (60, 50)]):
        sid = "ps0%d" % i
        sh = Image.new("RGBA", (3 * 40, 8 * 64), (0, 0, 0, 0)); d = ImageDraw.Draw(sh)
        x0, y0 = 10, 60 - h                      # frame 0 of row 'down': outline #202030 around a body of flat colours
        d.rectangle([x0, y0, x0 + w - 1, 59], fill=(32, 32, 48, 255))
        d.rectangle([x0 + 1, y0 + 1, x0 + w - 2, 58], fill=(200 - i * 10, 90, 60, 255))
        d.rectangle([x0 + 1, y0 + 1, x0 + w - 2, y0 + 8], fill=(240, 200, 160, 255))
        sh.save(root + "/web/assets/sprites/%s.png" % sid)
        recs.append({"id": sid, "name": sid, "sheet": "assets/sprites/%s.png" % sid, "frameW": 40, "frameH": 64})
    W, H = 512, 384
    Image.new("RGB", (W, H), (96, 160, 80)).save(root + "/web/assets/maps/zt01.png")
    cols, rows = W // 8, H // 8
    blocked = []
    for r in range(rows):
        row = ""
        for c in range(cols):
            x, y = c * 8 + 4, r * 8 + 4
            row += "1" if (x < 24 or y < 24 or x >= W - 24 or y >= H - 24 or ((x - 160) / 60) ** 2 + ((y - 150) / 50) ** 2 < 1) else "0"
        blocked.append(row)
    json.dump({"cell": 8, "cols": cols, "rows": rows, "blocked": blocked}, open(root + "/web/assets/collision/zt01.json", "w"))
    json.dump({"npcs": [{"sprite": "ps0%d" % i, "npc_id": 50 + i, "x": 300 + 20 * i, "y": 200} for i in range(5)],
               "exits": [{"x": 440, "y": 160, "w": 72, "h": 64, "to": "zt02"}], "doors": [], "warps": []},
              open(root + "/web/assets/scenes/zt01.json", "w"))
    json.dump({"characters": [], "npcs": recs, "maps": [{"id": "zt01", "name": "Test Sector", "image": "assets/maps/zt01.png",
               "width": W, "height": H, "music": "bgm001"}]}, open(root + "/web/assets/manifest.json", "w"))
    ch = {"characters": [{"npc_id": 1102, "name": "Coach Test", "look": {"skin": "#e8b890", "hair": "#703018", "top": "#b03020", "bottom": "#402820"},
                          "residents": [{"map": "zt01", "x": 300, "y": 300, "dir": "down"}]}]}
    for p in ("/data/authored/quests/new_characters.json", "/quests/new_characters.json"):
        open(root + p, "w").write(json.dumps(ch, indent=1) + "\n")
    json.dump({"by_npc_id": {}}, open(root + "/quests/characters.json", "w"))
elif mode == "views":                       # fake Gemini: 3 figures on a flat background of the colour given as argv[3]
    bg = tuple(int(sys.argv[3].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    im = Image.new("RGB", (1536, 512), bg); d = ImageDraw.Draw(im)
    for k, cx in enumerate((260, 760, 1260)):
        d.rectangle([cx - 90, 60, cx + 90, 500], fill=(30, 30, 40))
        d.rectangle([cx - 80, 70, cx + 80, 490], fill=(60 + 50 * k, 70, 160 - 40 * k))
        d.rectangle([cx - 60, 80, cx + 60, 200], fill=(240, 200, 160))
    im.save(sys.argv[4])
elif mode == "blank":
    Image.new("RGB", (1536, 512), (0, 255, 0)).save(sys.argv[3])
`;
const synth = (...a) => { const r = py(["-c", SYNTH, ...a]); assert.equal(r.status, 0, r.stderr); };

test("export measures the map's sprites, writes the folder, picks a walkable spot", () => {
    synth("repo", REPO);
    mkdirSync(join(REPO, "tools"), { recursive: true });
    for (const f of ["make_quest_sprites.py", "newnpc_export.py", "newmap_common.py"]) copyFileSync(join(ROOT, "tools", f), join(REPO, "tools", f));
    const out = join(TMP, "out", "guy");
    const r = py([join(REPO, "tools/newnpc_export.py"), "zt01", "--name", "Test Guy", "--desc", "a fisher with a straw hat", "--out", out, "--repo", REPO]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const f of ["prompt.txt", "ref.png", "entry.json", "measured.json"]) assert.ok(existsSync(join(out, f)), f);
    const m = readJ(join(out, "measured.json")), e = readJ(join(out, "entry.json"));
    // the 4 people sprites on the map are 33, 34, 35, 35 px tall (the 60 px one is no townsperson): median 34 or 35
    assert.deepEqual([...m.basis_sprites].sort(), ["ps00", "ps01", "ps02", "ps03"]);
    assert.ok(m.median_height === 34 || m.median_height === 35, "median " + m.median_height);
    assert.equal(e.height, m.height_used);
    assert.equal(m.outline, "#202030");
    assert.equal(m.soft_alpha_pixels, 0);
    assert.ok(m.background_min_distance_to_palette >= 150, "background too close to the palette");
    assert.equal(e.npc_id, 1103);                                   // 1102 is taken
    assert.equal(e.residents[0].map, "zt01");
    const g = fromJSON(readJ(join(WEB, "assets/collision/zt01.json")));
    const { x, y } = e.residents[0];
    assert.equal(rectBlocked(g, x - 6, y - 8, x + 6, y), false, "stand spot blocked");
    assert.ok(!(x > 416 && y > 136 && y < 248), "stand spot inside the exit");
    const p = readFileSync(join(out, "prompt.txt"), "utf8");
    for (const s of [m.background, m.outline, "FRONT", "SIDE", "BACK", "a fisher with a straw hat", `${e.height} px tall`, "1536 x 512"]) assert.ok(p.includes(s), s);
    // a boss gets the biggest figure the sprite cell holds
    const ob = join(TMP, "out", "boss");
    const rb = py([join(REPO, "tools/newnpc_export.py"), "zt01", "--role", "boss", "--out", ob, "--repo", REPO]);
    assert.equal(rb.status, 0, rb.stderr);
    assert.equal(readJ(join(ob, "entry.json")).height, 44);
    assert.ok(readFileSync(join(ob, "prompt.txt"), "utf8").includes("boss"));
});

test("install: refuses a missing or empty picture and leaves the json alone; then installs the fake picture", () => {
    const out = join(TMP, "out", "guy");
    const files = ["data/authored/quests/new_characters.json", "quests/new_characters.json"].map((f) => join(REPO, f));
    const before = files.map((f) => readFileSync(f, "utf8"));
    const inst = (folder) => py([join(REPO, "tools/newnpc_export.py"), "--install", folder, "--repo", REPO]);
    let r = inst(out);
    assert.equal(r.status, 2); assert.match(r.stderr, /views\.png/);
    synth("blank", REPO, join(out, "views.png"));
    r = inst(out);
    assert.equal(r.status, 2); assert.match(r.stderr, /0 separate figures/);
    assert.deepEqual(files.map((f) => readFileSync(f, "utf8")), before);
    assert.ok(!existsSync(join(REPO, "web/extra_npcs.json")));

    const m = readJ(join(out, "measured.json")), e = readJ(join(out, "entry.json"));
    synth("views", REPO, m.background, join(out, "views.png"));
    r = inst(out);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const f of files) {
        const c = readJ(f).characters;
        assert.equal(c.length, 2); assert.equal(c[1].npc_id, 1103); assert.equal(c[1].views, e.views);
    }
    assert.ok(existsSync(join(REPO, e.views)), "picture copied into the art folder");
    const ex = readJ(join(REPO, "web/extra_npcs.json"));
    assert.equal(ex.npc_sprites["1103"], "q1103");
    const rec = ex.npcs.find((n) => n.id === "q1103");
    assert.ok(rec && rec.name === "Test Guy" && rec.frameW === 24 && rec.frameH === 48);
    assert.ok(rec.clips["1"] && rec.clips["4"], "idle clips");
    assert.deepEqual(ex.residents.filter((q) => q.npc_id === 1103), [{ npc_id: 1103, map: "zt01", x: e.residents[0].x, y: e.residents[0].y, dir: "down" }]);
    // the sprite sheet: 120 x 384, 8 rows x 5 frames, each frame holds a figure of the asked height
    const chk = py(["-c", `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
hs = []
for r in range(8):
    for c in range(5):
        b = im.crop((c * 24, r * 48, c * 24 + 24, r * 48 + 48)).getchannel("A").getbbox()
        hs.append(None if b is None else b[3] - b[1])
print(json.dumps({"size": im.size, "row0": hs[0:5], "empty": sum(1 for h in hs if h is None), "mx": max(h or 0 for h in hs)}))`,
        join(REPO, "web/extra_sprites/q1103.png")]);
    assert.equal(chk.status, 0, chk.stderr);
    const s = JSON.parse(chk.stdout);
    assert.deepEqual(s.size, [120, 384]);
    assert.equal(s.empty, 0);
    assert.equal(s.row0[0], e.height);                              // standing frame = the measured height
    assert.ok(s.mx <= e.height + 2);
    assert.ok(existsSync(join(REPO, "web/extra_sprites/clips/q1103.png")));
    r = inst(out);                                                  // the same id twice is refused
    assert.equal(r.status, 2); assert.match(r.stderr, /already in/);
    assert.equal(readJ(files[0]).characters.length, 2);
});

test("with the real repo data (when present): export only writes to --out", () => {
    if (!existsSync(join(ROOT, "web/assets/scenes/s340.json"))) return;
    const out = join(TMP, "out", "real");
    const r = py([join(ROOT, "tools/newnpc_export.py"), "s340", "--out", out, "--repo", ROOT]);
    assert.equal(r.status, 0, r.stderr);
    const m = readJ(join(out, "measured.json"));
    assert.ok(m.median_height >= 28 && m.median_height <= 40);
    assert.ok(readJ(join(out, "entry.json")).npc_id >= 1103);
    assert.deepEqual(REAL.map(sha), realBefore);
});

test("the real data files are exactly as before", () => {
    assert.deepEqual(REAL.map(sha), realBefore);
});
