// The battle report's partner picture (pro/stfgtrep F0x80083744): the row, the
// table, the anchor, the pitch and the step cadence.
//
// F0x80083744 draws one turning picture per partner on the report's pedestal:
//   `*(0x8004B44C)(arg0->unk5C)`            pro/stfgtrep.s:10074 region — the SAME
//                                           resident party-position service the pause
//                                           STATUS cards ask (F0x80016D94), so the
//                                           row is the roster slot
//   `lui $v1,0x8009 / addiu $v1,-0x6fa4`    pro/stfgtrep.s:914-916 — 0x8008905C, this
//                                           overlay's copy of the disc's one eight-row
//                                           picture table
//   `sll 3 / subu` then `sll 2`             pro/stfgtrep.s:914-925 — row × 7 words
//   `slti $v0,0xd` on vsync − timer         13 frames a step
//   `((next < 8) == 0)` or the row's `-1`   the row restarts
//   `sp94(pack, tile, 0x14, base+0x28)`      pack 0x079F0000, anchor (20, slot×50+40),
//                                           base = unk5C × 0x32 (the party slot)
//
// Ledger claim: digimon-picture-row-is-the-roster-slot-2026-10-03.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FightReportSession, REPORT_TABLES_BASE } from "../engine/dw3/ui/fight-report-session.ts";
import {
    DIGIMON_PICTURE_TABLE,
    DIGIMON_PICTURE_ROW_WORDS,
    advanceDigimonPictures,
    digimonPictureAtBase,
} from "../engine/dw3/ui/digimon-picture.ts";
import {
    REPORT_PACK,
    REPORT_PICTURE_STEP_FRAMES,
    REPORT_PICTURE_TABLE,
    REPORT_PICTURE_WRAP,
    REPORT_PITCH,
    REPORT_X_PICTURE,
    REPORT_Y_PICTURE,
} from "../engine/dw3/ui/report-row.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const D = join(root, "web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const manifest = JSON.parse(readFileSync(join(D, "report/manifest.json"), "utf8"));

function resources(language = 2) {
    const banks = new Map();
    for (const [offset, dir] of [[0x55, "report"], [0x4e, "wizard"], [0x6a, "shop-banks"], [0xa2, "pause"]]) {
        banks.set(offset + language, bytes(`${dir}/${offset + language}.bin`));
    }
    return {
        tables: bytes("report/tables.bin"), profiles: bytes("digimon_profiles.bin"),
        textButtons: Uint8Array.from(manifest.textButtons.bytes), font: bytes("shop_font.bin"), banks,
    };
}

const name = (text) => [...text].map((c) => (c >= "a" ? 40 + c.charCodeAt(0) - 97 : 14 + c.charCodeAt(0) - 65));
let rng = 12345;
const host = () => ({ playSound() {}, rand: () => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) >>> 8) & 0xffff });
const member = (position, rosterSlot) => ({
    position, rosterSlot, nameBytes: name(`Digi${position}`), exp: 8188, level: 20, tp: 10, participated: true,
});
const seedOf = (members) => ({
    language: 2, battleId: 5, dropItemId: 0, activePosition: 0, bits: 4321, held: [], members,
});

/** One draw call per frame that is a partner picture: (clip, x, y). */
function pictures(session) {
    return session.draw.calls
        .filter((c) => c.method === "drawSprite"
            && c.args[2] === REPORT_X_PICTURE
            && c.args[3] >= REPORT_Y_PICTURE
            && (c.args[3] - REPORT_Y_PICTURE) < REPORT_PITCH * 3
            && (c.args[3] - REPORT_Y_PICTURE) % REPORT_PITCH === 0)
        .map((c) => c.args.slice(1));
}

test("the overlay's own copy of the picture table is the shared table, word for word", () => {
    const data = bytes("report/tables.bin");
    assert.ok(REPORT_PICTURE_TABLE - REPORT_TABLES_BASE + DIGIMON_PICTURE_ROW_WORDS * 8 * 4 <= data.length,
        "the shipped report tables must still cover the whole picture table");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const at = REPORT_PICTURE_TABLE - REPORT_TABLES_BASE;
    for (let row = 0; row < 8; row++) {
        for (let word = 0; word < DIGIMON_PICTURE_ROW_WORDS; word++) {
            assert.equal(view.getInt32(at + (row * DIGIMON_PICTURE_ROW_WORDS + word) * 4, true),
                DIGIMON_PICTURE_TABLE[row][word], `row ${row} word ${word}`);
        }
    }
});

test("each partner's report picture is that partner's roster row, on the disc's anchor", () => {
    // Renamon (slot 6), Kotemon (slot 0), Agumon (slot 3): not slot order, not id
    // order, so a screen that guessed from position or from name cannot pass.
    const slots = [6, 0, 3];
    const s = new FightReportSession(seedOf(slots.map((slot, position) => member(position, slot))), resources(), host());
    const seen = [];
    for (let f = 0; f < 400 && !s.finished(); f++) {
        s.tick(f % 4 < 2 ? ["circle"] : [], f + 1, 1);
        const drawn = pictures(s);
        if (drawn.length === 0) continue;
        assert.equal(drawn.length, slots.length, `frame ${f} drew ${drawn.length} pictures`);
        drawn.forEach(([clip, x, y], i) => {
            assert.equal(x, REPORT_X_PICTURE, `partner ${i} x`);
            assert.equal(y, REPORT_Y_PICTURE + i * REPORT_PITCH, `partner ${i} y (base = slot x 0x32)`);
            assert.ok(DIGIMON_PICTURE_TABLE[slots[i]].includes(clip), true);
        });
        seen.push(drawn.map(([clip]) => clip));
    }
    assert.ok(seen.length > 20, `the report must keep turning, saw ${seen.length} frames`);
    // The three rows are three different creatures, and each one turns.
    const clipsOf = (i) => [...new Set(seen.map((row) => row[i]))];
    for (let i = 0; i < 3; i++) {
        assert.ok(clipsOf(i).length >= 3, `partner ${i} turned through ${clipsOf(i).length} figures`);
    }
    assert.notDeepEqual(clipsOf(0), clipsOf(1), "two partners must not share one row");
    assert.notDeepEqual(clipsOf(1), clipsOf(2), "two partners must not share one row");
});

test("the report steps the picture every thirteen frames and restarts the row", () => {
    // The shared walk, driven here so the cadence and the restart are pinned
    // independently of the screen: 13 frames a step, on at eight or at the `-1`.
    const words = new Map();
    const mem = {
        read32: (addr) => words.get(addr >>> 0) ?? 0,
        write32: (addr, value) => words.set(addr >>> 0, value >>> 0),
    };
    for (let row = 0; row < 8; row++) {
        for (let word = 0; word < DIGIMON_PICTURE_ROW_WORDS; word++) {
            mem.write32(REPORT_PICTURE_TABLE + (row * DIGIMON_PICTURE_ROW_WORDS + word) * 4, DIGIMON_PICTURE_TABLE[row][word]);
        }
    }
    const timer = 0x8008a000;
    const counter = 0x8008a004;
    const row = 6; // Renamon: 17 18 19 20 19 18
    let frame = 0;
    const advance = () => advanceDigimonPictures({
        mem,
        tableBase: REPORT_PICTURE_TABLE,
        timer,
        cadence: REPORT_PICTURE_STEP_FRAMES,
        frame: () => frame,
        groups: [{
            counterBase: counter,
            count: 1,
            rowAt: () => row,
            skipNegativeRow: false,
            wrapAt: REPORT_PICTURE_WRAP,
        }],
    });
    // Twelve frames is not enough; the thirteenth is.
    for (let i = 0; i < 12; i++) { frame += 1; advance(); }
    assert.equal(mem.read32(counter), 0, "the counter must not move inside the cadence");
    const drawn = [];
    for (let step = 0; step < 7; step++) {
        frame += REPORT_PICTURE_STEP_FRAMES;
        advance();
        drawn.push(digimonPictureAtBase(mem, REPORT_PICTURE_TABLE, row, mem.read32(counter)));
    }
    assert.deepEqual(drawn, [18, 19, 20, 19, 18, 17, 18]);
});

test("the report's picture comes out of the disc's own sheet", () => {
    // The pack the original passes to the picture draw is the overlay's own sheet,
    // 0x079F0000 (disc index 1951, STFRPT) — the same handle its chrome uses.
    const s = new FightReportSession(seedOf([member(0, 0)]), resources(), host());
    const packIndex = 0x079f0000 >>> 16;
    let sawPicture = false;
    for (let f = 0; f < 200 && !s.finished(); f++) {
        s.tick(f % 4 < 2 ? ["circle"] : [], f + 1, 1);
        for (const c of s.draw.calls) {
            if (c.method !== "drawSprite") continue;
            if (c.args[2] !== REPORT_X_PICTURE) continue;
            assert.equal(c.args[0] >>> 16, packIndex, `frame ${f}: picture pack`);
            sawPicture = true;
        }
    }
    assert.ok(sawPicture, "the report must draw a partner picture");
    assert.equal(REPORT_PACK >>> 16, packIndex);
});