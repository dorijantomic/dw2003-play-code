// Phase 4 oracle: engine/dw3/ui/party-card-fill.ts's partyCardFillItems must match
// pro/ststatus F0x8008ED04 (party_card_fill_items). The original runs through
// engine/native on the shipped pro_ststatus.bin + resident.bin with the three
// card services, the text resolver and every widget method stubbed; the port runs
// against the same memory and a host that logs the identical call stream.
//
// This test also pins the corrected loop count: the assembly's delay-slot
// increment makes the label loop run five times (string ids 1,2,4,3,4), not the
// four the m2c decompilation prints.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    PARTY_CARD_FIELDS, PARTY_CARD_LABEL_HOLDER, PARTY_CARD_STAT_INDEX_TABLE,
    PARTY_CARD_TEXT_OFFSET, partyCardFillItems,
} from "../engine/dw3/ui/party-card-fill.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_ststatus.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const FN = 0x8008ed04;
const ROWS = 0x80155000;
const REC = 0x80120000;
const TEXT = 0x80121000;
const STATS = 0x80190000;
const WIDGET_BASE = 0x80130000;
const LANG_BASE = 0x801c0000;

const S = {
    slot2718: 0x0fe00000,
    stats2734: 0x0fe00004,
    rec2750: 0x0fe00008,
    text: 0x0fe0000c,
    m114: 0x0fe00010,
    m118: 0x0fe00014,
    m144: 0x0fe00018,
    m148: 0x0fe0001c,
};

let EVENTS = [];

const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
    image: resident,
    base: 0x80010000,
});

const STAT_SEEDS = [0x0010, 0x0030, 0x8000, 0xffff, 0x0060, 0x0010, 0x0010, 0x0010, 0x0010, 0x0010];
function seedStats(addr) {
    // Indices 0..5 are the ones the stat table reads (0,2,3,4,5); index 2/3 hold
    // 0x8000/0xFFFF so an unsigned read of the numbers would not match.
    for (let i = 0; i < 19; i++) {
        const v = i < STAT_SEEDS.length ? STAT_SEEDS[i] : 0x10 + i * 0x10;
        rt.mem.write16(addr + i * 2, v & 0xffff);
    }
}

rt.cpu.setStub(S.slot2718, (c) => { EVENTS.push(["slot2718", c.reg(4) | 0]); return 7; });
rt.cpu.setStub(S.stats2734, (c) => {
    seedStats(c.reg(5) | 0);
    EVENTS.push(["stats2734", c.reg(4) | 0]);
    return 0;
});
rt.cpu.setStub(S.rec2750, (c) => { EVENTS.push(["rec2750", c.reg(4) | 0]); return REC; });
rt.cpu.setStub(S.text, (c) => { EVENTS.push(["text", c.reg(4) | 0]); return TEXT; });
rt.cpu.setStub(S.m114, (c) => { EVENTS.push(["m114", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
rt.cpu.setStub(S.m118, (c) => { EVENTS.push(["m118", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
rt.cpu.setStub(S.m144, (c) => { EVENTS.push(["m144", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
rt.cpu.setStub(S.m148, (c) => { EVENTS.push(["m148", c.reg(4) | 0, c.reg(5) | 0]); return 0; });

rt.mem.write32(0x80048d34 + 0x2718, S.slot2718);
rt.mem.write32(0x80048d34 + 0x2734, S.stats2734);
rt.mem.write32(0x80048d34 + 0x2750, S.rec2750);
rt.mem.write32(0x80044b38 + 0x414, S.text);
rt.mem.write32(0x8005cca8, LANG_BASE);

let w = WIDGET_BASE;
for (let row = 0; row < 3; row++) {
    for (const off of [0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c]) {
        rt.mem.write32(ROWS + row * 0x2c + off, w);
        rt.mem.write32(w + 0x114, S.m114);
        rt.mem.write32(w + 0x118, S.m118);
        rt.mem.write32(w + 0x144, S.m144);
        rt.mem.write32(w + 0x148, S.m148);
        w += 0x100;
    }
}

// The port's host: the text resolver is addressed by the language-object offset
// the original adds to [0x8005CCA8], so the log carries the same absolute arg.
const portHost = {
    rosterSlot(row) { EVENTS.push(["slot2718", row | 0]); return 7; },
    copyStats(slot, dest) { seedStats(dest); EVENTS.push(["stats2734", slot | 0]); },
    cardRecord(slot) { EVENTS.push(["rec2750", slot | 0]); return REC; },
    resolveText(offset) {
        EVENTS.push(["text", (rt.mem.read32(0x8005cca8) + offset) | 0]);
        return TEXT;
    },
    widgetSetLine0(widget, source, index) { EVENTS.push(["m114", widget >>> 0, source | 0, index | 0]); },
    widgetSetLineNumber(widget, line, value) { EVENTS.push(["m118", widget >>> 0, line | 0, value | 0]); },
    widgetSetFlagC1(widget, value) { EVENTS.push(["m144", widget >>> 0, value | 0]); },
    widgetMeasure(widget, value) { EVENTS.push(["m148", widget >>> 0, value | 0]); },
};

const CASES = [
    { show: 1, row: 0 },
    { show: 1, row: 1 },
    { show: 1, row: 2 },
    { show: 0, row: 0 },
    { show: 0, row: 2 },
];

test("partyCardFillItems matches F0x8008ED04", () => {
    for (const { show, row } of CASES) {
        EVENTS = [];
        rt.cpu.call(FN, [0, ROWS, row, show], 200000);
        const oracle = EVENTS.map((e) => e.map((v) => v | 0));

        EVENTS = [];
        partyCardFillItems(rt.mem, ROWS, row, show, STATS, portHost);
        const ported = EVENTS.map((e) => e.map((v) => v | 0));

        assert.deepEqual(ported, oracle, `show=${show} row=${row}`);
    }
});

test("the label loop runs five times with the table's string ids", () => {
    EVENTS = [];
    rt.cpu.call(FN, [0, ROWS, 0, 1], 200000);
    const labels = EVENTS.filter((e) => e[0] === "m114" && (e[2] >>> 0) !== REC);
    assert.equal(labels.length, PARTY_CARD_FIELDS, "five labels");
    assert.deepEqual(labels.map((e) => e[3]), [1, 2, 4, 3, 4], "string ids from the shipped table");
    const table = rt.mem.read32(PARTY_CARD_LABEL_HOLDER) >>> 0;
    assert.notEqual(table, 0, "the label holder points at a table");
    const numbers = EVENTS.filter((e) => e[0] === "m118");
    assert.deepEqual(numbers.map((e) => e[3]), [0x10, 0x8000 - 0x10000, 0xffff - 0x10000, 0x60, 0x10],
        "signed halfword values indexed through the stat table");
    const statIds = [];
    for (let i = 0; i < PARTY_CARD_FIELDS; i++) statIds.push(rt.mem.read32(PARTY_CARD_STAT_INDEX_TABLE + i * 4) | 0);
    assert.deepEqual(statIds, [0, 2, 3, 4, 5], "stat index table");
    assert.equal(EVENTS[3][0], "m114", "the name widget is the first text call");
    assert.equal(EVENTS[3][3], -1, "the name is set with index -1");
    assert.equal(EVENTS[3][2] >>> 0, REC, "the name source is the member record");
    assert.equal(PARTY_CARD_TEXT_OFFSET, 0xb0);
});

test("hide switches off all eleven row widgets", () => {
    EVENTS = [];
    rt.cpu.call(FN, [0, ROWS, 0, 0], 200000);
    const hides = EVENTS.filter((e) => e[0] === "m144");
    assert.equal(hides.length, 2 * PARTY_CARD_FIELDS + 1, "name + five labels + five numbers");
    assert.deepEqual(hides.map((e) => e[2]), new Array(11).fill(0));
    EVENTS = [];
    rt.cpu.call(FN, [0, ROWS, 0, 1], 200000);
    assert.equal(EVENTS.filter((e) => e[0] === "m144").length, 0, "show issues no hide");
});
