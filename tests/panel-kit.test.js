// Free-height panels from the pause list's own tiles (web/panel-kit.js). The tile recipe is checked against the sheet's
// own clips for five, six and seven rows, so the eight- and nine-row panels are the same recipe with more bands.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
    PANEL_COLS, PANEL_FRAMES, PAUSE_PANEL_EXTRA_BASE, buildPanelClip, panelHeight, registerPausePanels, tileFrames,
} from "../web/panel-kit.js";
import { PAUSE_PANEL_EXTRA_BASE as ENGINE_BASE, pausePanelClip } from "../engine/dw3/ui/native/pause-list.ts";

const SHEET = new URL("../web/assets/ui/cmfont_sheet.json", import.meta.url);
const haveSheet = existsSync(SHEET);
const load = () => { const j = JSON.parse(readFileSync(SHEET, "utf8")); return j.ids ?? j; };
const canon = (layers) => layers.map((l) => JSON.stringify([l.frame, l.x, l.y, l.w, l.h, l.dx, l.dy])).sort();

test("the web base equals the engine's, and the engine asks for base + rows above seven", () => {
    assert.equal(PAUSE_PANEL_EXTRA_BASE, ENGINE_BASE);
    assert.equal(pausePanelClip(8), PAUSE_PANEL_EXTRA_BASE + 8);
    assert.equal(pausePanelClip(9), PAUSE_PANEL_EXTRA_BASE + 9);
});

test("the recipe rebuilds the disc's 5, 6 and 7 row panels layer for layer", { skip: !haveSheet && "cmfont sheet not extracted here" }, () => {
    const ids = load();
    const frames = tileFrames(ids);
    assert.ok(frames, "the five-row panel carries all six tile frames");
    for (const [rows, clip] of [[5, "28"], [6, "27"], [7, "25"]]) {
        const built = buildPanelClip(frames, PANEL_COLS, rows - 2);
        assert.deepEqual(canon(built.layers), canon(ids[clip].layers), `${rows} rows = clip ${clip}`);
    }
});

test("heights are 84, 98, 112 for 5, 6, 7 rows and 126, 140 for 8, 9", { skip: !haveSheet && "cmfont sheet not extracted here" }, () => {
    const frames = tileFrames(load());
    assert.deepEqual([3, 4, 5, 6, 7].map((bands) => panelHeight(frames, bands)), [84, 98, 112, 126, 140]);
});

test("registerPausePanels adds clips 8..12 rows, 160 px wide, and leaves the disc's clips alone", { skip: !haveSheet && "cmfont sheet not extracted here" }, () => {
    const ids = load();
    const before = JSON.stringify(ids["25"]);
    assert.equal(registerPausePanels(ids), 5);
    assert.equal(JSON.stringify(ids["25"]), before);
    for (const rows of [8, 9]) {
        const clip = ids[String(PAUSE_PANEL_EXTRA_BASE + rows)];
        assert.equal(clip.layers.length, 4 * rows, "four tiles per band, rows bands");
        const w = Math.max(...clip.layers.map((l) => l.dx + l.w));
        const h = Math.max(...clip.layers.map((l) => l.dy + l.h));
        assert.deepEqual([w, h], [160, 14 * rows + 14]);
    }
});

test("a sheet without the six tiles gets no clips and does not throw", () => {
    const ids = { 28: { layers: [{ frame: 56, x: 0, y: 0, w: 40, h: 22, dx: 0, dy: 0 }] } };
    assert.equal(registerPausePanels(ids), 0);
    assert.deepEqual(Object.keys(ids), ["28"]);
    assert.equal(tileFrames({}), null);
    assert.equal(tileFrames(undefined), null);
});

test("screenpack.js registers the clips when the cmfont sheet loads", () => {
    const src = readFileSync(new URL("../web/screenpack.js", import.meta.url), "utf8");
    assert.match(src, /import \{ registerPausePanels \} from "\.\/panel-kit\.js";/);
    assert.match(src, /p\.ids = j\.ids \?\? j;\s*\n\s*if \(name === "cmfont"\) registerPausePanels\(p\.ids\);/);
});

test("PANEL_FRAMES names the six frames the disc's panels use", () => {
    assert.deepEqual(Object.values(PANEL_FRAMES), [56, 57, 58, 59, 60, 61]);
});
