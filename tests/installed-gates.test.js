// The installed copy (window.__dwInstalled) hides the dev top-bar controls and ignores the ?slerp=1 URL flag;
// the owner PC (no marker) keeps all of them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
const b3 = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

test("the top-bar Partner, Map, Showcase and Chapter selects sit in their own labels in index.html", () => {
    for (const [name, id] of [["Partner", "charSelect"], ["Map", "mapSelect"], ["Showcase", "showcaseSelect"], ["Chapter", "chapterSelect"]]) {
        assert.match(html, new RegExp(`<label>${name}\\s*<select id="${id}"`), name);
    }
});

test("game.js hides exactly those four labels only when window.__dwInstalled is set", () => {
    const m = game.match(/if \(window\.__dwInstalled\) \{\n\s*for \(const id of \[([^\]]*)\]\) \{[\s\S]*?display", "none"/);
    assert.ok(m, "the hiding block");
    assert.deepEqual(m[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1)), ["charSelect", "mapSelect", "showcaseSelect", "chapterSelect"]);
    assert.ok(!/Music|musicSelect|assetModeSelect/.test(m[0]), "Music and Visuals stay");
});

test("game.js removes the Force encounter button and skips the F9 key in the installed copy, and keeps both otherwise", () => {
    assert.match(game, /if \(window\.__dwInstalled\) btn\?\.remove\(\);\n\s*else \{\n\s*btn\?\.addEventListener\("click"[^\n]*\n\s*addEventListener\("keydown", \(e\) => \{ if \(e\.code === "F9"\)/);
});

test("the ?slerp=1 flag is read only when the copy is not installed", () => {
    assert.match(b3, /if \(!window\.__dwInstalled && slerpFlagFromUrl\(window\.location\.search\)\) _slerpRot = true;/);
});

test("run for real: ?slerp=1 switches slerp on for the owner PC and not in the installed copy", () => {
    const run = (installed) => spawnSync(process.execPath, ["--input-type=module", "-e",
        `globalThis.window = { location: { search: "?slerp=1" }${installed ? ", __dwInstalled: true" : ""} };
         const m = await import(${JSON.stringify(new URL("../web/battle3d.js", import.meta.url).href)});
         console.log(m.slerpRotationEnabled());`], { encoding: "utf8", env: { ...process.env, ANIM_SLERP: "" } });
    assert.equal(run(false).stdout.trim(), "true");
    assert.equal(run(true).stdout.trim(), "false");
});
