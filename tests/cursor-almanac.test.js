// The Cursor Almanac: every menu cursor the game uses, at the rate the disc
// uses it (web/cursor-almanac.js, web/cursor-almanac.html).
//
// Four screens, four decoded clocks:
//   Pause menu   F0x8001B0A4 swaps the widget's line-0 string through the five
//                glyphs at 0x8004DCE0: 32 vsyncs on frame 0, then 6 vsyncs per
//                step through frames 1..4 (entry 4 repeats entry 2) — 56 vsyncs.
//                engine/dw3/ui/cursor-handler.ts is the port; its constructor
//                presets live in engine/dw3/ui/spawn-ui-icon.ts (+0x74 = 0x20,
//                +0x78 = 6). docs/research/ui/pause-menu-chrome-decoded-2026-09-04.md §1.
//   Card album   clip 7's 6-step CLUT table (0x80085A4C) advances every 17 ticks;
//                the L1/R1 arrows blink on the same 17.
//                engine/dw3/ui/native/album-lifecycle.ts,
//                docs/research/ui/stcrdabm-decoded-2026-07-12.md §2.
//   Digimon Lab  the chart cursor and both pagers CLUT-cycle rows 0-3 every
//                8 vsyncs. engine/dw3/ui/native/lab-chart.ts,
//                docs/research/ui/stgdglab-decoded-2026-07-11.md Phase 3.
//   World map    the marker advances on a 4-frame counter.
//                engine/dw3/ui/native/pause-map.ts,
//                docs/research/systems-plain/menus.md §"The map".
//
// The test reads the pause row's rest/step out of the constructor itself, so no
// row can claim a tick count the engine does not use. The F2 switch is off by
// default and the page is only linked from behind it (web/ambience.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    CURSORS,
    GLYPH_TABLE,
    pauseCycle,
    frameOf,
} from "../web/cursor-almanac.js";
import {
    CURSOR_HANDLER_FIELDS,
    GLYPH_COUNT,
    GLYPH_TABLE as GLYPH_TABLE_ADDR,
} from "../engine/dw3/ui/cursor-handler.ts";
import { spawnUiIcon, UI_ICON_FIELDS } from "../engine/dw3/ui/spawn-ui-icon.ts";

const row = (screen) => CURSORS.find((r) => r.screen === screen);

/** A tiny little-endian memory for the constructor, which only writes words. */
function wordMemory(bytes = 0x400) {
    const data = new Uint8Array(bytes);
    return {
        data,
        read32(addr) {
            return (data[addr] | (data[addr + 1] << 8) | (data[addr + 2] << 16) | (data[addr + 3] << 24)) >>> 0;
        },
        write32(addr, value) {
            data[addr] = value & 0xff;
            data[addr + 1] = (value >>> 8) & 0xff;
            data[addr + 2] = (value >>> 16) & 0xff;
            data[addr + 3] = (value >>> 24) & 0xff;
        },
    };
}

test("the pause cursor is the disc's five-glyph pulse, and the page reads the ported table", () => {
    assert.deepEqual(pauseCycle(), {
        rest: 32,
        step: 6,
        cycle: 56,
        glyphs: 5,
        repeatIndex: 4,
        repeats: [2],
    });
    assert.equal(GLYPH_TABLE.length, 5, "the five strings at 0x8004DCE0");
    assert.equal(GLYPH_TABLE.length, GLYPH_COUNT, "the engine's GLYPH_COUNT is five");
    assert.equal(GLYPH_TABLE_ADDR, 0x8004dce0, "the table the handler reads");
    for (const name of GLYPH_TABLE) assert.ok(typeof name === "string" && name.length > 0, "each glyph is named");
    assert.equal(GLYPH_TABLE[4], GLYPH_TABLE[2], "entry 4 repeats entry 2 — the cursor comes back");
});

test("the pause row's rest and step are the constructor's own presets", () => {
    const mem = wordMemory();
    let next = 0x40;
    const obj = spawnUiIcon(mem, { alloc: (size) => { const p = next; next += size; return p; } }, 0x1002, 3, 0x1d, 0x24);
    assert.equal(mem.read32(obj + UI_ICON_FIELDS.restTicks), 32, "+0x74 = 0x20 vsyncs of rest");
    assert.equal(mem.read32(obj + UI_ICON_FIELDS.cycleTicks), 6, "+0x78 = 6 vsyncs per step");
    assert.equal(UI_ICON_FIELDS.restTicks, CURSOR_HANDLER_FIELDS.restTicks, "the same +0x74 the handler reads");
    assert.equal(UI_ICON_FIELDS.cycleTicks, CURSOR_HANDLER_FIELDS.cycleTicks, "the same +0x78 the handler reads");

    const pause = row("Pause menu");
    const cycle = pauseCycle();
    assert.deepEqual(pause.glyphs, GLYPH_TABLE, "the row carries the five-glyph table itself");
    assert.equal(pause.glyphs.length, cycle.glyphs, "its length is the cycle's glyph count");
    assert.deepEqual(
        { rest: pause.rest, step: pause.step, cycle: pause.cycle },
        { rest: cycle.rest, step: cycle.step, cycle: cycle.cycle },
        "the row is the module's own table, not a second copy of the numbers",
    );
});

test("one row per cursor, each with its decoded rate and its code and doc source", () => {
    assert.equal(CURSORS.length, 4, "the pause list, the album grid, the lab chart and the map marker");
    assert.deepEqual(CURSORS.map((r) => r.screen), ["Pause menu", "Card album", "Digimon Lab", "World map"]);

    const album = row("Card album");
    assert.equal(album.clutSteps, 6, "clip 7's CLUT table is six steps");
    assert.equal(album.period, 17, "one step every 17 ticks");

    const lab = row("Digimon Lab");
    assert.equal(lab.rows, 4, "palette rows 0-3");
    assert.equal(lab.period, 8, "one row every 8 vsyncs");

    const map = row("World map");
    assert.equal(map.period, 4, "the marker's 4-frame counter");

    for (const r of CURSORS) {
        assert.ok(typeof r.source === "string" && r.source.trim().length > 0, `${r.screen} says where it lives`);
        assert.match(r.source, /\.(ts|js)\b/, `${r.screen} names the code`);
        assert.match(r.source, /docs\/research\//, `${r.screen} names the decoded doc`);
        assert.match(r.source, /\.md\b/, `${r.screen} names the doc file`);
    }
});

test("frameOf walks the pause pulse: a rest, four steps out and back, then the rest again", () => {
    const pause = row("Pause menu");
    assert.equal(frameOf(pause, 0), 0, "frame 0 holds during the rest");
    assert.equal(frameOf(pause, 31), 0, "the rest runs to frame 31");
    for (let t = 32; t < 38; t++) assert.equal(frameOf(pause, t), 1, `frame ${t} is the first step`);
    for (let t = 38; t < 44; t++) assert.equal(frameOf(pause, t), 2, `frame ${t} is the second step`);
    for (let t = 44; t < 50; t++) assert.equal(frameOf(pause, t), 3, `frame ${t} is the third step`);
    for (let t = 50; t < 56; t++) assert.equal(frameOf(pause, t), 4, `frame ${t} is the fourth step, the repeat`);
    assert.equal(frameOf(pause, 56), frameOf(pause, 0), "the next rest is frame 0 again");
    assert.equal(frameOf(pause, 56 + 32), 1, "and the next pulse steps again");
});

test("the other three rows animate at their decoded rates", () => {
    const album = row("Card album");
    assert.equal(frameOf(album, 0), 0);
    assert.equal(frameOf(album, 16), 0, "17 ticks per step");
    assert.equal(frameOf(album, 17), 1);
    assert.equal(frameOf(album, 101), 5, "the sixth and last CLUT step");
    assert.equal(frameOf(album, 102), 0, "then the table wraps");

    const lab = row("Digimon Lab");
    assert.equal(frameOf(lab, 0), 0);
    assert.equal(frameOf(lab, 7), 0, "8 vsyncs per row");
    assert.equal(frameOf(lab, 8), 1);
    assert.equal(frameOf(lab, 31), 3, "row 3 is the last");
    assert.equal(frameOf(lab, 32), 0, "then the rows wrap");

    const map = row("World map");
    assert.equal(frameOf(map, 0), 0);
    assert.equal(frameOf(map, 3), 0, "4 frames per blink");
    assert.equal(frameOf(map, 4), 1);
    assert.equal(frameOf(map, 15), 3);
    assert.equal(frameOf(map, 16), 0);
});

test("the F2 switch is off by default and the page is only reachable behind it", () => {
    const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
    assert.match(ambience, /\["cursorbook", "Cursor almanac \(new\)"\]/, "the F2 Extras row");

    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"cursorbook"/, "off until the player switches it on");

    assert.match(ambience, /id="fx-cursorbook" hidden/, "the button row ships hidden");
    assert.match(ambience, /cursorbook\.hidden = !fx\.cursorbook/, "refreshPanel follows the switch");

    const refs = ambience.split("cursor-almanac.html").length - 1;
    assert.equal(refs, 1, "one reference to the page, no other link into it");
    assert.match(ambience, /if \(fx\.cursorbook\)[^;{}]*window\.open\("cursor-almanac\.html"/, "opened only behind the toggle's guard");
    assert.doesNotMatch(ambience, /(get|has)\("cursorbook"\)/, "never a URL flag");

    const page = readFileSync(new URL("../web/cursor-almanac.html", import.meta.url), "utf8");
    assert.match(page, /from\s+"\.\/cursor-almanac\.js"/, "the page draws from the module");
    assert.match(page, /frameOf/, "the page animates with the decoded clock");
    assert.match(page, /requestAnimationFrame/, "it animates while it is open");
});
