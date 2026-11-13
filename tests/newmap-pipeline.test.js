// New Gemini-made maps, end to end with a SYNTHETIC map (shapes drawn by this test, nothing from the disc):
//   tools/newmap_export.py -> a fake "Gemini" answer (map.png + walk.png at another size) -> tools/newmap_import.py
//   -> the game's own loader (web/newmaps.js) + collision code (engine/core/util/collision.ts, engine/systems/map-manager.ts)
//   read it back in node: spawn and exits walkable and connected, and the exits link both ways.
// Also: a mask with a blocked exit, and a grey mask, are refused and write nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fromJSON, rectBlocked } from "../engine/core/util/collision.ts";
import { hitRect } from "../engine/systems/map-manager.ts";
import { loadNewMaps, mergeNewMaps, newMapScene, addNewMapExits } from "../web/newmaps.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = join(ROOT, "tools");
const TMP = mkdtempSync(join(tmpdir(), "newmap-test-"));
const REPO = join(TMP, "repo");
const OUT = join(TMP, "out", "n900");
const WEB = join(REPO, "web");
const readJ = (p) => JSON.parse(readFileSync(p, "utf8"));

function py(args, input) {
    return spawnSync("python3", args, { encoding: "utf8", input });
}

// ---- synthetic neighbour "zt01" 512x384: grass, a pond, a walled border except open ground; and the fake Gemini answer
const SYNTH = String.raw`
import json, sys
from PIL import Image, ImageDraw
mode, root = sys.argv[1], sys.argv[2]
if mode == "neighbour":
    W, H = 512, 384
    im = Image.new("RGB", (W, H), (96, 160, 80)); d = ImageDraw.Draw(im)
    d.ellipse([100, 100, 220, 200], fill=(60, 110, 200)); d.rectangle([0, 0, W - 1, 23], fill=(40, 90, 40))
    d.rectangle([0, H - 24, W - 1, H - 1], fill=(40, 90, 40)); d.rectangle([0, 0, 23, H - 1], fill=(40, 90, 40))
    import os
    os.makedirs(root + "/web/assets/maps", exist_ok=True); os.makedirs(root + "/web/assets/collision", exist_ok=True)
    os.makedirs(root + "/web/assets/scenes", exist_ok=True)
    im.save(root + "/web/assets/maps/zt01.png")
    cols, rows = W // 8, H // 8
    blocked = []
    for r in range(rows):
        row = ""
        for c in range(cols):
            x, y = c * 8 + 4, r * 8 + 4
            wall = x < 24 or y < 24 or y >= H - 24            # the right edge stays open ground
            pond = ((x - 160) / 60) ** 2 + ((y - 150) / 50) ** 2 < 1
            row += "1" if (wall or pond) else "0"
        blocked.append(row)
    json.dump({"cell": 8, "cols": cols, "rows": rows, "blocked": blocked}, open(root + "/web/assets/collision/zt01.json", "w"))
    json.dump({"npcs": [], "exits": [], "zones": []}, open(root + "/web/assets/scenes/zt01.json", "w"))
    json.dump({"characters": [], "npcs": [], "maps": [{"id": "zt01", "name": "Test Sector — Plain", "image": "assets/maps/zt01.png",
               "width": W, "height": H, "music": "bgm001"}]}, open(root + "/web/assets/manifest.json", "w"))
else:
    # fake Gemini: 768x576 (1.5x of the 512x384 spec), a river with a bridge gap, trees. walk.png = black/white of it.
    kind, folder = mode, root
    W, H = 768, 576
    s = json.load(open(folder + "/spec.json"))
    img = Image.new("RGB", (W, H), (110, 170, 90)); di = ImageDraw.Draw(img)
    walk = Image.new("L", (W, H), 255); dw = ImageDraw.Draw(walk)
    def block(box):
        dw.rectangle(box, fill=0); di.rectangle(box, fill=(30, 70, 30))
    block([0, 0, W - 1, 35]); block([0, H - 36, W - 1, H - 1]); block([W - 36, 0, W - 1, H - 1])
    # left edge closed except the exit gap taken from the spec (scaled 1.5x)
    r = s["exits"][0]["rect"]; k = 1.5
    gy0, gy1 = int(r["y"] * k), int((r["y"] + r["h"]) * k)
    block([0, 0, 35, gy0 - 1]); block([0, gy1, 35, H - 1])
    # a lake in the middle with the walkable ring around it
    dw.ellipse([300, 200, 560, 420], fill=0); di.ellipse([300, 200, 560, 420], fill=(60, 110, 200))
    if kind == "blocked_exit":
        block([0, gy0 - 5, 120, gy1 + 5])                                  # closes the exit gap
    if kind == "islands":
        block([170, 0, 200, H - 1])                                         # a wall across: cuts the far side off
    if kind == "grey":
        dw.rectangle([100, 100, 700, 500], fill=128)
    img.save(folder + "/map.png"); walk.save(folder + "/walk.png")
`;

function synth(mode, root) {
    const r = py(["-c", SYNTH, mode, root]);
    assert.equal(r.status, 0, r.stderr);
}

test("export writes prompt, ref, guide and a spec whose exits line up", () => {
    synth("neighbour", REPO);
    const r = py([join(TOOLS, "newmap_export.py"), "zt01", "right", "--size", "512x384", "--id", "n900",
        "--name", "Test Sector — Synthetic Glade", "--out", OUT, "--repo", REPO]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    for (const f of ["prompt.txt", "ref.png", "guide.png", "spec.json"]) assert.ok(existsSync(join(OUT, f)), f);
    const spec = readJ(join(OUT, "spec.json"));
    const prompt = readFileSync(join(OUT, "prompt.txt"), "utf8");
    assert.match(prompt, /512 x 384/);
    assert.match(prompt, /walk mask/);
    assert.match(prompt, /LEFT edge/);
    assert.match(prompt, /#000000/);
    const ne = spec.neighbour_exit, ex = spec.exits[0];
    // new map sits on the RIGHT of the neighbour: its exit is on the LEFT edge, at the same height as the neighbour's
    assert.equal(ex.rect.x, 0);
    assert.equal(ne.rect.x + ne.rect.w, 512, "neighbour exit flush with its right edge");
    assert.equal(ex.rect.y + ex.rect.h / 2, ne.rect.y + ne.rect.h / 2, "same height on both sides");
    assert.equal(ex.to, "zt01");
    assert.equal(ne.to, "n900");
    // the neighbour spawn is walkable ground of the neighbour, outside its exit rect
    const g = fromJSON(readJ(join(WEB, "assets/collision/zt01.json")));
    assert.equal(rectBlocked(g, ex.spawnX - 6, ex.spawnY - 8, ex.spawnX + 6, ex.spawnY), false);
    assert.equal(hitRect([ne.rect], ex.spawnX, ex.spawnY), null);
});

test("fake Gemini answer imports; the game's own loader and collision read it; exits link both ways", async () => {
    synth("good", OUT);
    const r = py([join(TOOLS, "newmap_import.py"), OUT, "--repo", REPO]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const spec = readJ(join(OUT, "spec.json"));
    const auth = join(REPO, "data/authored/web/assets/data/newmaps");
    assert.deepEqual(readdirSync(auth).sort(), ["index.json", "n900.collision.json", "n900.json"]);
    assert.ok(!readdirSync(join(REPO, "data/authored")).includes("maps"), "no picture in data/authored by default");
    assert.ok(existsSync(join(WEB, "assets/maps/n900.png")), "picture installed locally");

    // the game's loader, reading the installed files from disk
    const get = async (url) => { const p = join(WEB, url); return existsSync(p) ? readJ(p) : null; };
    const has = async (url) => existsSync(join(WEB, url));
    const nm = await loadNewMaps(get, has);
    const manifest = readJ(join(WEB, "assets/manifest.json"));
    assert.deepEqual(mergeNewMaps(manifest, nm), ["n900"]);
    const rec = manifest.maps.find((m) => m.id === "n900");
    assert.equal(rec.width, 512); assert.equal(rec.height, 384);
    assert.equal(rec.collision, "assets/data/newmaps/n900.collision.json");

    const gridNew = fromJSON(readJ(join(WEB, rec.collision)));
    const gridOld = fromJSON(readJ(join(WEB, "assets/collision/zt01.json")));
    assert.equal(gridNew.cols, 64); assert.equal(gridNew.rows, 48); assert.equal(gridNew.cell, 8);
    const free = (g, x, y) => !rectBlocked(g, x - 6, y - 8, x + 6, y);
    // lake from the fake picture (centre 430,310 in 768x576 -> 287,207 in 512x384) is blocked; ground near the spawn is not
    assert.equal(free(gridNew, 287, 207), false, "lake blocked");

    // scenes: new map's own scene, and the neighbour's scene gets the extra exit
    const sceneNew = structuredClone(newMapScene(nm, "n900"));
    const sceneOld = { npcs: [], exits: [{ x: 1, y: 1, w: 8, h: 8, to: "zzz" }], zones: [] };
    addNewMapExits(nm, "zt01", sceneOld);
    addNewMapExits(nm, "zt01", sceneOld);   // twice = no duplicate
    assert.equal(sceneOld.exits.length, 2);
    const toNew = sceneOld.exits.find((e) => e.to === "n900");
    const toOld = sceneNew.exits.find((e) => e.to === "zt01");
    assert.ok(toNew && toOld);
    assert.ok(manifest.maps.some((m) => m.id === toNew.to) && manifest.maps.some((m) => m.id === toOld.to));

    // walk: flood the new map's walkable ground with the game's foot box from the arrival spawn; it must reach the exit rect
    const reach = (g, sx, sy, W, H) => {
        const seen = new Set([sx + "," + sy]), q = [[sx, sy]];
        while (q.length) {
            const [x, y] = q.pop();
            for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
                const nx = x + dx, ny = y + dy, k = nx + "," + ny;
                if (nx < 0 || ny < 0 || nx > W || ny > H || seen.has(k) || !free(g, nx, ny)) continue;
                seen.add(k); q.push([nx, ny]);
            }
        }
        return seen;
    };
    assert.ok(free(gridNew, toNew.spawnX, toNew.spawnY), "arrival in the new map is walkable");
    const seenNew = reach(gridNew, toNew.spawnX, toNew.spawnY, 512, 384);
    assert.ok([...seenNew].some((k) => { const [x, y] = k.split(",").map(Number); return hitRect([toOld], x, y); }),
        "the way back to the neighbour is reachable from the arrival spot");
    assert.equal(hitRect([toNew], toNew.spawnX, toNew.spawnY), null, "arriving does not stand in the exit just taken");
    // back in the neighbour: walkable and outside the neighbour's own new exit
    assert.ok(free(gridOld, toOld.spawnX, toOld.spawnY), "arrival in the neighbour is walkable");
    assert.equal(hitRect([toNew], toOld.spawnX, toOld.spawnY), null);
    const seenOld = reach(gridOld, toOld.spawnX, toOld.spawnY, 512, 384);
    assert.ok([...seenOld].some((k) => { const [x, y] = k.split(",").map(Number); return hitRect([toNew], x, y); }),
        "the new exit is reachable from where you land in the neighbour");
    assert.equal(spec.id, "n900");
});

test("a map whose picture is missing is skipped whole (fresh clone: data but no art)", async () => {
    const get = async (url) => { const p = join(WEB, url); return existsSync(p) ? readJ(p) : null; };
    const nm = await loadNewMaps(get, async () => false);
    assert.equal(nm.records.length, 0);
    const manifest = { maps: [{ id: "zt01" }] };
    assert.deepEqual(mergeNewMaps(manifest, nm), []);
    // no index at all = nothing happens
    const none = await loadNewMaps(async () => null, async () => true);
    assert.deepEqual(none, { records: [], scenes: {}, exits: {} });
});

for (const [kind, word] of [["blocked_exit", "no walkable ground"], ["islands", "cut-off islands"], ["grey", "grey"]]) {
    test(`import refuses a bad mask (${kind}) and writes nothing`, () => {
        const repo2 = join(TMP, "repo-" + kind), out2 = join(TMP, "out-" + kind);
        synth("neighbour", repo2);
        const e = py([join(TOOLS, "newmap_export.py"), "zt01", "right", "--size", "512x384", "--id", "n901", "--out", out2, "--repo", repo2]);
        assert.equal(e.status, 0, e.stderr);
        synth(kind, out2);
        const r = py([join(TOOLS, "newmap_import.py"), out2, "--repo", repo2]);
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.ok((r.stderr + r.stdout).includes(word), r.stderr);
        assert.ok(!existsSync(join(repo2, "data/authored/web/assets/data/newmaps")), "nothing authored");
        assert.ok(!existsSync(join(repo2, "web/assets/maps/n901.png")), "nothing installed");
    });
}

test("cleanup", () => rmSync(TMP, { recursive: true, force: true }));
