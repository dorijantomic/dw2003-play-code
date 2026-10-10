// The comparison tool's path and key helpers (tools/compare_pause_map.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { splitPath, parseKey, gamesharkPokes } from "../tools/compare_pause_map.mjs";

test("splitPath follows the list's clamped cursor to the page Cross opens", () => {
    assert.deepEqual(splitPath(["Start", "Cross"]), { page: "items", row: 0, rest: [] });
    assert.deepEqual(splitPath(["Start", "Up", "Down", "Down", "Cross", "Up"]), { page: "map", row: 2, rest: ["Up"] });
    assert.equal(splitPath(["Start", "Down", "Down", "Down", "Down", "Down", "Down", "Cross"]).page, "status");
    assert.equal(splitPath(["Start", "Triangle"]), null);
    assert.equal(splitPath(["Cross"]), null);
});

test("parseKey splits a robot key into its named parts", () => {
    assert.deepEqual(parseKey("host=1,1|sort=1,6|scene_id=1000"), { host: "1,1", sort: "1,6", scene_id: "1000" });
});

test("gamesharkPokes expands the fill codes exactly as the driver does", () => {
    const path = "docs/research/ui/captures/pal-gameshark-fill-codes.txt";
    const js = gamesharkPokes(readFileSync(path, "utf8"));
    const py = JSON.parse(execFileSync("python3", ["-c",
        "import sys, json; sys.path.insert(0, 'tools/windows-rig'); import game_driver as g; " +
        `print(json.dumps(g.gameshark_pokes(open('${path}').read())))`]).toString());
    assert.deepEqual(js, py);
    assert.equal(js.length, 635);
});

test("splitPath counts six rows once CARD FOLDERS is unlocked", () => {
    const path = ["Start", "Down", "Down", "Down", "Down", "Down", "Cross"];
    assert.equal(splitPath(path, 5).page, "status");
    assert.equal(splitPath(path, 6).page, "cardfolders");
});
