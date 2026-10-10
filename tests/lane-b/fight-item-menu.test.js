// Lane B oracle: engine/dw3/ui/native/battle-item-menu.ts must match the
// original pro/fightstg ITEM list family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the text-widget constructor, the resource/pack services, the
// inventory list and record services, the id-array allocator, the pad, the frame
// counter, the sound and every object method are stubbed on both sides, so the
// ordered calls, the widget fields and the screen's own memory are compared.
//
// The cases drive what a player does: Down past the last row, both page keys at
// the page edges, Circle on a row (the id is answered) and Cross.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    itemListCreateWidgets, itemListDraw, itemListTick, itemListUpdateRows,
    ITEM_LIST_CONFIG, ITEM_LIST_ROWS,
} from "../../engine/dw3/ui/native/battle-item-menu.ts";
import { FAMILY_TO_CLIP } from "../../web/itemicons-data.js";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80150000;
const SLOT = 0x80161000;
const MODEL = 0x80162000;
const OUT = 0x80163000;
const WIDGET_BASE = 0x80180000;
const RES_PTR = 0x801a0000;
const PACK_PTR = 0x801a1000;
const HELD = 0x80048db0;

const CREATE_FN = 0x8001ae38;
const ALLOC_FN = 0x80014504;
const RESOURCE_PTR = 0x80044f4c;
const PACK_PTR_CELL = 0x80044f5c;
const PAD_PTR = 0x8004bbc4;
const COUNTER_PTR = 0x8004df98;
const INVENTORY_PTR = 0x80042b98;
const LIST_FN = 0x800135e8;
const RECORD_FN = 0x8001355c;
const CEL_FN = 0x80013584;
const ALLOC_SHORTS_PTR = 0x8004b5f4;

const ALLOC_STUB = 0x0fdd0000;
const PAD_STUB = 0x0fdd000c;
const RESOURCE_STUB = 0x0fdd0014;
const PACK_STUB = 0x0fdd0018;
const COUNTER_STUB = 0x0fdd001c;
const LIST_STUB = 0x0fdd0020;
const RECORD_STUB = 0x0fdd0024;
const CEL_STUB = 0x0fdd0028;
const SHORT_ALLOC_STUB = 0x0fdd002c;
const SLOT_BASE = 0x0fdd1000;
const IDS = 0x80190000;
const RECORD_PTR = 0x801a2000;
const RECORD_FLAG_BASE = 0x801a3000;

const SLOT_ARITY = {
    0x28: 1, 0x38: 0, 0x3c: 0, 0x114: 2, 0x118: 2, 0x138: 1, 0x144: 1, 0x148: 1,
};
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
/** The ids the stubbed inventory list writes into the page, zero-terminated. */
const LIST_IDS = [];
const CONTROL = { alloc: SCREEN, pad: 0, counter: 0, listed: 0, usable: new Set(), cel: 74 };
let made = 0;

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound(id) { LOG.push(["sound", id | 0]); } };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ALLOC_FN, (c) => {
        LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        return CONTROL.alloc;
    });
    rt.cpu.setStub(CREATE_FN, (c) => {
        LOG.push(["create", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET_BASE + made * 0x100;
        made += 1;
        for (const slot of [0x114, 0x118, 0x138, 0x144, 0x148]) {
            rt.mem.write32(widget + slot, SLOT_BASE + slot);
        }
        return widget;
    });
    rt.cpu.setStub(PAD_STUB, () => { LOG.push(["pad"]); return CONTROL.pad; });
    rt.cpu.setStub(RESOURCE_STUB, (c) => { LOG.push(["resource", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(COUNTER_STUB, () => { LOG.push(["counter"]); return CONTROL.counter; });
    rt.cpu.setStub(LIST_STUB, (c) => {
        LOG.push(["list", c.reg(4) | 0, c.reg(5) | 0]);
        LIST_IDS.forEach((id, i) => rt.mem.write16(c.reg(5) + i * 2, id & 0xffff));
        rt.mem.write16(c.reg(5) + LIST_IDS.length * 2, 0);
        return LIST_IDS.length;
    });
    // The original dereferences the record service's return once and reads byte
    // 0 of that, so the stub hands back a cell holding the flag byte's address.
    rt.cpu.setStub(RECORD_STUB, (c) => {
        const id = c.reg(4) | 0;
        LOG.push(["record", id]);
        rt.mem.write32(RECORD_PTR, RECORD_FLAG_BASE + id);
        return RECORD_PTR;
    });
    rt.cpu.setStub(CEL_STUB, (c) => { LOG.push(["cel", c.reg(4) | 0]); return CONTROL.cel; });
    rt.cpu.setStub(SHORT_ALLOC_STUB, (c) => {
        LOG.push(["shortalloc", c.reg(4) | 0, c.reg(5) | 0]);
        return IDS;
    });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const args = [];
            for (let i = 0; i < SLOT_ARITY[slot]; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    rt.cpu.setStub(0x8001ecbc, (c) => { LOG.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed34, (c) => { LOG.push(["layer", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ecec, (c) => { LOG.push(["palette", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed6c, (c) => { LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });

    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB);
    rt.mem.write32(PACK_PTR_CELL, PACK_STUB);
    rt.mem.write32(PAD_PTR, PAD_STUB);
    rt.mem.write32(COUNTER_PTR, COUNTER_STUB);
    // The inventory object's three methods and the two array services the screen
    // reaches through resident pointers.
    rt.mem.write32(INVENTORY_PTR, RECORD_STUB);
    rt.mem.write32(INVENTORY_PTR + 4, CEL_STUB);
    rt.mem.write32(INVENTORY_PTR + 0xc, LIST_STUB);
    rt.mem.write32(ALLOC_SHORTS_PTR, SHORT_ALLOC_STUB);
    // [0x80055C48] (F0x8002006C) is the runtime's own SFX_PLAY hook: it logs the
    // packed id the sound service consumes, which for the cancel path is the
    // widened 0x800450BD.
    return rt;
}

/** The overlay's own data: the config block and the held-count table. */
function seedData(rt, c) {
    const config = [1, 0x0e, 0x45, 0x0e, 0xffffffff, 0, 0, 0];
    for (let i = 0; i < 8; i++) rt.mem.write32(ITEM_LIST_CONFIG + i * 4, config[i] | 0);
    for (const [id, qty] of c.held ?? []) rt.mem.write8(HELD + id, qty & 0xff);
    for (let i = 0; i < 512; i++) rt.mem.write8(RECORD_FLAG_BASE + i, 0);
    for (const id of c.usable ?? c.ids ?? []) rt.mem.write8(RECORD_FLAG_BASE + id, 2);
    CONTROL.alloc = c.alloc ?? MODEL;
    CONTROL.pad = c.pad ?? 0;
    CONTROL.counter = c.counter ?? 0;
    CONTROL.cel = c.cel ?? 74;
    LIST_IDS.length = 0;
    for (const id of c.ids ?? []) LIST_IDS.push(id);
    CONTROL.usable = new Set(c.usable ?? c.ids ?? []);
    made = 0;
}

/** The screen object: state, the input page, the filtered list, the counters. */
function seedScreen(rt, c) {
    for (let i = 0; i < 0x90; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(SCREEN + 0x0c, c.state ?? 1);
    rt.mem.write32(SCREEN + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(SCREEN + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(SCREEN + 0x50, OUT);
    rt.mem.write32(SCREEN + 0x54, c.lastCursor ?? 0);
    rt.mem.write32(SCREEN + 0x380, IDS);
    rt.mem.write32(SCREEN + 0x384, c.count ?? 0);
    rt.mem.write32(SCREEN + 0x388, c.page ?? 0);
    rt.mem.write32(SCREEN + 0x38c, c.pagesField ?? 1);
    for (let i = 0; i < 16; i += 2) rt.mem.write16(SCREEN + 0x58 + i, c.pageIds?.[i / 2] ?? 0);
    for (let i = 0; i < 32; i += 2) rt.mem.write16(IDS + i, c.filtered?.[i / 2] ?? 0);
    rt.mem.write32(SLOT, c.modelInSlot ?? (MODEL | 0));
    rt.mem.write32(MODEL + 0x50, c.cursor ?? 0);
    rt.mem.write32(MODEL + 0x54, 0);
    rt.mem.write32(MODEL + 0x58, c.rows ?? ITEM_LIST_ROWS);
    rt.mem.write32(OUT, c.outWord ?? 0xffffffff);
    for (let i = 0; i < 8; i += 4) rt.mem.write32(OUT + 4 + i, 0);
    // Thirteen pre-built widgets: the screen's widget builder is stubbed out of
    // the state-1 path, so their handles are seeded and each carries the method
    // table the original calls through.
    for (let i = 0; i < 13; i++) {
        const widget = WIDGET_BASE + i * 0x100;
        for (const slot of [0x114, 0x118, 0x138, 0x144, 0x148]) {
            rt.mem.write32(widget + slot, SLOT_BASE + slot);
        }
        rt.mem.write32(SLOT + 0x04 + i * 4, widget);
    }
}

function portHost() {
    return {
        allocateActor() { LOG.push(["alloc", 0x800959b0 | 0, 0x390, 0x34]); return CONTROL.alloc; },
        createModel(config) {
            // F0x8009B0C8 allocates the shared 0xA8 list model.
            LOG.push(["alloc", 0x8009af4c | 0, 0xa8, 0]);
            const model = CONTROL.alloc;
            for (let i = 0; i < 8; i++) {
                this.mem.write32(model + 0x58 + i * 4, this.mem.read32(config + i * 4) | 0);
            }
            return model;
        },
        mem: null,
        inventoryList(kind, dest) {
            LOG.push(["list", kind | 0, dest | 0]);
            LIST_IDS.forEach((id, i) => this.mem.write16(dest + i * 2, id | 0));
            this.mem.write16(dest + LIST_IDS.length * 2, 0);
            return LIST_IDS.length;
        },
        inventoryRecordFlag(id) { LOG.push(["record", id | 0]); return CONTROL.usable.has(id); },
        itemIconCel(id) { LOG.push(["cel", id | 0]); return CONTROL.cel; },
        allocShorts(bytes) { LOG.push(["shortalloc", bytes | 0, 2]); return IDS; },
        // Not logged: the original releases through [0x8004B5EC], which the
        // oracle runtime owns (engine/native/runtime.ts:168), so there is no
        // stubbed call to compare. The session frees the arena block instead.
        freeShorts() {},
        createTextElement(target, kind, x, y) {
            LOG.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            const widget = WIDGET_BASE + made * 0x100;
            made += 1;
            return widget;
        },
        resourceBase(bank) { LOG.push(["resource", bank | 0]); return RES_PTR; },
        packResolve(handle) { LOG.push(["pack", handle | 0]); return PACK_PTR; },
        padRead(port) { LOG.push(["pad"]); return CONTROL.pad; },
        padReadA(port) { LOG.push(["padA", port | 0]); return CONTROL.pad; },
        padReadB(port) { LOG.push(["padB", port | 0]); return 0; },
        playSound(id) { LOG.push(["sound", id | 0]); },
        frameCounter() { LOG.push(["counter"]); return CONTROL.counter; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

const SCREEN_FIELDS = [0x0c, 0x50, 0x54, 0x58, 0x380, 0x384, 0x388, 0x38c];
const MODEL_FIELDS = [0x50, 0x54, 0x58];

function snapshot(rt) {
    const out = [];
    for (const off of SCREEN_FIELDS) out.push(`s+${off.toString(16)}=${rt.mem.read32(SCREEN + off) >>> 0}`);
    for (let i = 0; i < 8; i++) out.push(`cfg${i}=${rt.mem.read32(ITEM_LIST_CONFIG + i * 4) >>> 0}`);
    for (let i = 0; i < 16; i++) out.push(`id${i}=${rt.mem.read16(IDS + i * 2)}`);
    for (const off of MODEL_FIELDS) out.push(`m+${off.toString(16)}=${rt.mem.read32(MODEL + off) >>> 0}`);
    out.push(`out=${rt.mem.read32(OUT) >>> 0}`);
    return out;
}

function runBoth(rt, addr, c, run) {
    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    rt.cpu.call(addr, [SCREEN, SLOT], 40000);
    const olog = LOG.slice();
    const ofields = snapshot(rt);

    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    const host = portHost();
    host.mem = rt.mem;
    run(rt.mem, host);
    if (JSON.stringify(LOG) !== JSON.stringify(olog)) {
        const n = Math.max(LOG.length, olog.length);
        for (let i = 0; i < n; i++) {
            if (JSON.stringify(LOG[i]) !== JSON.stringify(olog[i])) {
                console.error(`DIFF ${c.name} at ${i}: port=${JSON.stringify(LOG[i])} orig=${JSON.stringify(olog[i])}`);
            }
        }
    }
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
    assert.deepEqual(snapshot(rt), ofields, `${c.name}: fields`);
}

test("the exe's item icon cel table is the browser's clip table", () => {
    // The original resolves the row icon through the 32-byte table at 0x80042BA8,
    // indexed by the item record's icon class; web/itemicons-data.js ships the
    // rig-verified copy of the same mapping. If they drift the browser would
    // draw the wrong icon while the port stayed oracle-proven.
    const exe = Array.from({ length: 30 }, (_, family) => resident[HELD - 0x80010000 + (0x80042ba8 - HELD) + family]);
    for (let family = 2; family <= 29; family++) {
        assert.equal(exe[family], FAMILY_TO_CLIP[family], `family ${family}`);
    }
});

test("the shipped battle table carries the ITEM config block", () => {
    // The adapter loads the first 40 bytes of the battle command data table as
    // the ITEM screen's own config block and blit rectangle. Its eight words
    // must be the ones at 0x800A3534 in the overlay.
    const table = new Uint8Array(readFileSync(join(dir, "../../data/battlecmd/tech-tables.bin")));
    const words = Array.from({ length: 8 }, (_, i) => table[i * 4] | (table[i * 4 + 1] << 8)
        | (table[i * 4 + 2] << 16) | (table[i * 4 + 3] << 24));
    assert.deepEqual(words, [1, 0x0e, 0x45, 0x0e, -1, 0, 0, 0]);
});

test("itemListTick state 1 matches F0x800959B0", () => {
    const rt = runtime();
    const base = {
        state: 1, count: 12, rows: 7, cursor: 0, pagesField: 2,
        filtered: [43, 44, 45, 46, 66, 67, 68, 69, 70, 71, 72, 73],
        held: [[43, 5], [44, 1], [45, 2], [46, 1], [66, 9], [67, 1], [68, 1], [69, 1],
            [70, 1], [71, 1], [72, 1], [73, 1]],
    };
    const cases = [
        { name: "idle", ...base },
        // Down seven times reaches the last row of the page and stops (rows = 7).
        { name: "down to last row", ...base, pad: 0x40, cursor: 6 },
        { name: "down past last row", ...base, pad: 0x40, cursor: 12 },
        { name: "up at top", ...base, pad: 0x10, cursor: 0 },
        // The page keys: R1 reaches the last page and stays; L1 clamps at 0.
        { name: "page right", ...base, pad: 0x800 },
        { name: "page right at last", ...base, pad: 0x800, page: 1 },
        { name: "page left", ...base, pad: 0x400, page: 1 },
        { name: "page left off front", ...base, pad: 0x400, page: 0 },
        { name: "page keys with no pages", ...base, pad: 0x800, pagesField: 0 },
        { name: "confirm", ...base, pad: 0x2000, cursor: 3 },
        { name: "confirm second page", ...base, pad: 0x2000, cursor: 2, page: 1 },
        { name: "confirm empty list", ...base, pad: 0x2000, count: 0 },
        { name: "cancel", ...base, pad: 0x4000 },
        { name: "cancel past the out word", ...base, pad: 0x4000, outWord: 7 },
    ];
    for (const c of cases) {
        runBoth(rt, 0x800959b0, c, (mem, host) => itemListTick(mem, SCREEN, SLOT, host));
    }
});

test("itemListDraw matches F0x8009543C", () => {
    const rt = runtime();
    const base = { state: 1, count: 12, pagesField: 2, filtered: [43, 44, 45, 46, 66, 67, 68, 69, 70, 71, 72, 73] };
    for (const c of [
        { name: "draw first page", ...base },
        { name: "draw last page", ...base, page: 1 },
        { name: "arrows gate set", ...base, counter: 0x10, page: 1 },
        { name: "arrows gate clear", ...base, counter: 0x00, page: 1 },
        { name: "arrows gate set page 0", ...base, counter: 0x30 },
        { name: "one page no arrows", ...base, counter: 0x10 },
        { name: "short page", ...base, count: 3 },
        { name: "empty list", ...base, count: 0 },
    ]) {
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x8009543c, [SCREEN], 40000);
        const olog = LOG.slice();
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        itemListDraw(rt.mem, SCREEN, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
    }
});

test("itemListCreateWidgets matches F0x8009563C", () => {
    const rt = runtime();
    for (const c of [
        { name: "widgets", state: 0 },
        { name: "widgets empty", state: 0, count: 0 },
    ]) {
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x8009563c, [SCREEN, SLOT], 40000);
        const olog = LOG.slice();
        const owidgets = Array.from({ length: 13 }, (_, i) => rt.mem.read32(SLOT + 0x04 + i * 4) >>> 0);

        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        itemListCreateWidgets(rt.mem, SCREEN, SLOT, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(
            Array.from({ length: 13 }, (_, i) => rt.mem.read32(SLOT + 0x04 + i * 4) >>> 0),
            owidgets, `${c.name}: widget slots`,
        );
    }
});

test("itemListUpdateRows matches F0x800957B4", () => {
    const rt = runtime();
    const base = {
        state: 1, count: 12, rows: 7, cursor: 2, pagesField: 2,
        filtered: [43, 44, 45, 46, 66, 67, 68, 69, 70, 71, 72, 73],
        held: [[43, 5], [44, 1], [45, 2], [46, 1], [66, 9], [67, 1], [68, 1], [69, 1],
            [70, 1], [71, 1], [72, 1], [73, 1]],
    };
    for (const c of [
        { name: "rows first page", ...base },
        { name: "rows second page", ...base, page: 1 },
        { name: "rows short page", ...base, count: 3 },
        { name: "rows empty list", ...base, count: 0 },
        { name: "rows last row", ...base, cursor: 6 },
    ]) {
        runBoth(rt, 0x800957b4, c, (mem, host) => itemListUpdateRows(mem, SCREEN, SLOT, host));
    }
});

test("itemListTick state 0 matches F0x800959B0", () => {
    const rt = runtime();
    const listed = [43, 44, 45, 46, 66, 67, 68, 69, 70];
    const cases = [
        { name: "build all kept", state: 0, ids: listed, usable: listed, held: [[43, 3], [66, 1]] },
        // The record flag drops the field-only chips; the count, the pages and the
        // config block all follow.
        { name: "build some dropped", state: 0, ids: listed, usable: [43, 46, 66, 67],
            held: [[43, 3], [44, 1], [45, 2], [46, 1], [66, 9], [67, 1]] },
        { name: "build one page", state: 0, ids: listed, usable: listed.slice(0, 7),
            held: [[43, 3], [66, 1]] },
        { name: "build empty", state: 0, ids: [], usable: [], held: [] },
        { name: "build none usable", state: 0, ids: listed, usable: [], held: [[43, 3]] },
        { name: "build fourteen rows", state: 0, ids: listed, usable: listed,
            held: [[43, 3], [44, 1], [45, 1], [46, 1], [66, 1], [67, 1], [68, 1], [69, 1], [70, 1]] },
        { name: "build states 2 and 3", state: 2, ids: listed, usable: listed, held: [[43, 1]] },
        { name: "build state 3", state: 3, ids: listed, usable: listed, held: [[43, 1]] },
    ];
    for (const c of cases) {
        c.pageIds = c.ids;
        c.filtered = c.usable;
        runBoth(rt, 0x800959b0, c, (mem, host) => itemListTick(mem, SCREEN, SLOT, host));
    }
});

test("itemListTick state 0 pages and rows hold for a real inventory", () => {
    // The seed the battle hands the list: the four HP charges and the 25 battle
    // disks, the ids the original's own filter keeps out of its 83-id list.
    const rt = runtime();
    const offered = [43, 44, 45, 46, ...Array.from({ length: 25 }, (_, i) => 66 + i)];
    const fieldOnly = [...Array.from({ length: 19 }, (_, i) => 47 + i), 91];
    const c = {
        name: "real inventory", state: 0,
        ids: [...offered, ...fieldOnly], usable: offered,
        held: offered.map((id, i) => [id, (i % 4) + 1]),
    };
    c.pageIds = c.ids;
    c.filtered = c.usable;
    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    rt.cpu.call(0x800959b0, [SCREEN, SLOT], 40000);
    assert.equal(rt.mem.read32(SCREEN + 0x384) >>> 0, 29, "29 items are offered");
    assert.equal(rt.mem.read32(SCREEN + 0x38c) >>> 0, 5, "29 items fill five pages of seven");
    assert.equal(rt.mem.read32(ITEM_LIST_CONFIG) >>> 0, 7, "the config block holds min(29, 7)");
});