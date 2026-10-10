// Lane B oracle: engine/dw3/ui/native/battle-tech-menu.ts must match the
// original pro/fightstg TECH list family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the text-widget constructor, the resource/pack services, the three
// technique-list helpers at 0x8005B44C/0x8005B46C/0x8005B47C, the MP price table
// at 0x800A466C, the pad, the frame counter, the sound and every object method
// are stubbed on both sides, so the ordered calls, the widget fields and the
// screen's own memory are compared.
//
// The cases drive what a player does: Down past the last row, both page keys at
// the page edges, a technique the party cannot pay for, Circle on an affordable
// row (MP is debited and the id is answered) and Cross.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    techListCreateWidgets, techListDraw, techListTick, techListUpdateRows,
    TECH_LIST_CONFIG, TECH_PARTY_BASE, TECH_PARTY_INDEX, TECH_PARTY_STRIDE,
} from "../../engine/dw3/ui/native/battle-tech-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80150000;
const SLOT = 0x80161000;
const MODEL = 0x80162000;
const OUT = 0x80163000;
const WIDGET_BASE = 0x80180000;
const MEMBER_BLOCK = 0x80190000;
const RES_PTR = 0x801a0000;
const PACK_PTR = 0x801a1000;
const PRESELECT = 0x801a2000;

const TIME_OBJECT = 0x8004de10;

const CREATE_FN = 0x8001ae38;
const ALLOC_FN = 0x80014504;
const RESOURCE_PTR = 0x80044f4c;
const PACK_PTR_CELL = 0x80044f5c;
const PAD_PTR = 0x8004bbc4;
const COUNTER_PTR = 0x8004df98;
const SOUND_FN = 0x80055c48;

const ALLOC_STUB = 0x0fdd0000;
const PAD_STUB = 0x0fdd000c;
const RESOURCE_STUB = 0x0fdd0014;
const PACK_STUB = 0x0fdd0018;
const COUNTER_STUB = 0x0fdd001c;
const MEMBER_STUB = 0x0fdd0020;
const LIST_BEGIN_STUB = 0x0fdd0024;
const PAGE_STUB = 0x0fdd0028;
const COST_STUB = 0x0fdd002c;
const PREREC_STUB = 0x0fdd0030;
const SLOT_BASE = 0x0fdd1000;

const SLOT_ARITY = {
    0x28: 1, 0x38: 0, 0x3c: 0, 0x114: 2, 0x118: 2, 0x138: 1, 0x144: 1, 0x148: 1,
};
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
/** The six technique words the page-fill stub writes into every page. */
const PAGE_WORDS = [];
const CONTROL = {
    alloc: SCREEN, pad: 0, counter: 0, member: 0, pages: 0, cost: 0, preselect: 0,
};
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
    rt.cpu.setStub(MEMBER_STUB, (c) => { LOG.push(["member", c.reg(4) | 0]); return CONTROL.member; });
    rt.cpu.setStub(LIST_BEGIN_STUB, (c) => {
        LOG.push(["begin", c.reg(4) | 0, c.reg(5) | 0]);
        return CONTROL.pages;
    });
    rt.cpu.setStub(PAGE_STUB, (c) => {
        LOG.push(["page", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        return 0;
    });
    rt.cpu.setStub(COST_STUB, (c) => { LOG.push(["cost", c.reg(5) | 0]); return CONTROL.cost; });
    rt.cpu.setStub(PREREC_STUB, (c) => { LOG.push(["prerec", c.reg(4) | 0, c.reg(5) | 0]); return CONTROL.preselect ? PRESELECT : 0; });
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
    rt.mem.write32(0x8004b44c, MEMBER_STUB);
    rt.mem.write32(0x8004b46c, LIST_BEGIN_STUB);
    rt.mem.write32(0x8004b47c, PAGE_STUB);
    rt.mem.write32(0x800a466c, COST_STUB);
    rt.mem.write32(0x8005cca0, PREREC_STUB);
    // [0x80055C48] (F0x8002006C) is the runtime's own SFX_PLAY hook: it logs the
    // packed id the sound service consumes, which for the cancel path is the
    // widened 0x800450BD.
    void SOUND_FN;
    return rt;
}

/** The overlay's own data: the config block, the party record and the member block. */
function seedData(rt, c) {
    const config = [1, 0x0e, 0x45, 0x0e, 0xffffffff, 0, 0, 0];
    for (let i = 0; i < 8; i++) rt.mem.write32(TECH_LIST_CONFIG + i * 4, config[i] | 0);
    rt.mem.write32(TECH_PARTY_INDEX, c.partyIndex ?? 0);
    const party = TECH_PARTY_BASE + (c.partyIndex ?? 0) * TECH_PARTY_STRIDE;
    rt.mem.write16(party + 0x00, c.techCount ?? 0);
    rt.mem.write16(party + 0x0a, c.maxMp ?? 100);
    rt.mem.write16(party + 0x0c, c.mp ?? 100);
    rt.mem.write8(party + 0x1a, c.noCharge ?? 0);
    for (let i = 0; i < 8; i++) rt.mem.write16(MEMBER_BLOCK + i * 2, (c.block?.[i] ?? i + 1) | 0);
    rt.mem.write16(MEMBER_BLOCK + 0x28, (c.block28 ?? 1) | 0);
    rt.mem.write16(PRESELECT + 0x28, (c.preselectId ?? 1) | 0);
    for (let i = 0; i < 4; i++) rt.mem.write32(MODEL + 0x58 + i * 4, 0);
    CONTROL.alloc = c.alloc ?? MODEL;
    CONTROL.pad = c.pad ?? 0;
    CONTROL.counter = c.counter ?? 0;
    CONTROL.member = c.member ?? 0;
    CONTROL.pages = c.pages ?? 0;
    CONTROL.cost = c.cost ?? 0;
    CONTROL.preselect = c.preselect ?? 0;
    PAGE_WORDS.length = 0;
    for (const word of c.pageWords ?? []) PAGE_WORDS.push(word);
    made = 0;
}

/** The screen object: state, the page blocks, the list, the page counters, the out word. */
function seedScreen(rt, c) {
    for (let i = 0; i < 0xe0; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(SCREEN + 0x0c, c.state ?? 1);
    rt.mem.write32(SCREEN + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(SCREEN + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(SCREEN + 0x50, OUT);
    rt.mem.write32(SCREEN + 0x54, c.lastCursor ?? 0);
    rt.mem.write32(SCREEN + 0xcc, c.count ?? 0);
    rt.mem.write32(SCREEN + 0xd0, c.page ?? 0);
    rt.mem.write32(SCREEN + 0xd4, c.pagesField ?? 1);
    for (let i = 0; i < 0x14 * 3; i += 2) {
        rt.mem.write16(SCREEN + 0x58 + i, c.headers?.[i / 2] ?? 0);
        rt.mem.write16(SCREEN + 0x60 + i, c.status?.[i / 2] ?? 0);
    }
    for (let i = 0; i < 6; i++) {
        rt.mem.write32(SCREEN + 0x9c + i * 4, c.entries?.[i] ?? 0);
    }
    rt.mem.write32(SLOT, c.modelInSlot ?? (MODEL | 0));
    rt.mem.write32(MODEL + 0x50, c.cursor ?? 0);
    rt.mem.write32(MODEL + 0x54, 0);
    rt.mem.write32(MODEL + 0x58, c.rows ?? 6);
    rt.mem.write32(OUT, c.outWord ?? 0xffffffff);
    for (let i = 0; i < 8; i += 4) rt.mem.write32(OUT + 4 + i, 0);
    // Fifteen pre-built widgets: the screen's widget builder is stubbed out of
    // the state-1 path, so their handles are seeded and each carries the method
    // table the original calls through.
    for (let i = 0; i < 15; i++) {
        const widget = WIDGET_BASE + i * 0x100;
        for (const slot of [0x114, 0x118, 0x138, 0x144, 0x148]) {
            rt.mem.write32(widget + slot, SLOT_BASE + slot);
        }
        rt.mem.write32(SLOT + 0x04 + i * 4, widget);
    }
}

function portHost() {
    return {
        allocateActor() { LOG.push(["alloc", 0x8009af4c | 0, 0xa8, 0]); return CONTROL.alloc; },
        createModel(config) {
            const model = this.allocateActor();
            for (let i = 0; i < 8; i++) {
                this.mem.write32(model + 0x58 + i * 4, this.mem.read32(config + i * 4) | 0);
            }
            return model;
        },
        mem: null,
        activeMember() { LOG.push(["member", CONTROL.member]); return CONTROL.member; },
        techListBegin(member, headerBase) { LOG.push(["begin", member | 0, headerBase | 0]); return CONTROL.pages; },
        techListPage(member, header, dest) {
            LOG.push(["page", member | 0, header | 0, dest | 0]);
            const mem = this.mem;
            for (let i = 0; i < 6; i++) mem.write16(dest + 8 + i * 2, PAGE_WORDS[i] | 0);
        },
        preselectRecord(word) { LOG.push(["prerec", word | 0, 9]); return CONTROL.preselect ? PRESELECT : null; },
        techCost(entry) { LOG.push(["cost", entry | 0]); return CONTROL.cost; },
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

const SCREEN_FIELDS = [0x0c, 0x50, 0x54, 0x58, 0x9c, 0xa0, 0xa4, 0xa8, 0xac, 0xb0, 0xcc, 0xd0, 0xd4];
const PARTY_OFFSETS = [0x00, 0x0a, 0x0c, 0x1a];
const MODEL_FIELDS = [0x50, 0x54, 0x58];

function snapshot(rt) {
    const out = [];
    for (const off of SCREEN_FIELDS) out.push(`s+${off.toString(16)}=${rt.mem.read32(SCREEN + off) >>> 0}`);
    for (let i = 0; i < 8; i++) out.push(`cfg${i}=${rt.mem.read32(TECH_LIST_CONFIG + i * 4) >>> 0}`);
    const party = TECH_PARTY_BASE + (rt.mem.read32(TECH_PARTY_INDEX) >>> 0) * TECH_PARTY_STRIDE;
    for (const off of PARTY_OFFSETS) {
        out.push(`p+${off.toString(16)}=${off === 0x1a ? rt.mem.read8(party + off) : rt.mem.read16(party + off)}`);
    }
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
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
    assert.deepEqual(snapshot(rt), ofields, `${c.name}: fields`);
}

test("techListTick state 1 matches F0x800967A0", () => {
    const rt = runtime();
    const base = {
        state: 1, count: 8, rows: 6, cursor: 0, pagesField: 2,
        entries: [11, 12, 0x4000 | 13, 14, 15, 16, 17, 18],
        status: [8, 8, 8, 8, 8, 8], techCount: 8, mp: 100, cost: 5,
    };
    const cases = [
        { name: "idle", ...base },
        // Down five times reaches the last row and stops there (rows = 6).
        { name: "down to last row", ...base, pad: 0x40, cursor: 5 },
        { name: "down past last row", ...base, pad: 0x40, cursor: 9 },
        { name: "up at top", ...base, pad: 0x10, cursor: 0 },
        // The page keys: R1 twice reaches the last page, R1 again stays; L1 once
        // leaves the first page (the original stores page - 1 without clamping).
        { name: "page right", ...base, pad: 0x800 },
        { name: "page right at last", ...base, pad: 0x800, page: 1 },
        { name: "page left", ...base, pad: 0x400, page: 1 },
        { name: "page left off front", ...base, pad: 0x400, page: 0 },
        // A row costing more than the party's MP is greyed and swallows Circle.
        { name: "confirm short of mp", ...base, pad: 0x2000, mp: 3, cost: 40 },
        { name: "confirm pays", ...base, pad: 0x2000, mp: 40, cost: 12, cursor: 2 },
        { name: "confirm empty list", ...base, pad: 0x2000, count: 0, cost: 12 },
        { name: "confirm while blast", ...base, pad: 0x2000, noCharge: 1, mp: 1, cost: 99, cursor: 1 },
        { name: "cancel", ...base, pad: 0x4000 },
    ];
    for (const c of cases) {
        runBoth(rt, 0x800967a0, c, (mem, host) => techListTick(mem, SCREEN, SLOT, host));
    }
});

test("techListDraw matches F0x80095E40", () => {
    const rt = runtime();
    const base = { state: 1, count: 8, entries: [11, 12, 13, 14, 15, 16, 17, 18], pagesField: 2 };
    for (const c of [
        { name: "draw first page", ...base },
        { name: "draw last page", ...base, page: 1 },
        { name: "arrows gate set", ...base, counter: 0x10, page: 1 },
        { name: "arrows gate clear", ...base, counter: 0x00, page: 1 },
        { name: "arrows gate set page 0", ...base, counter: 0x30 },
        { name: "empty rows hidden", ...base, count: 2 },
        { name: "empty list", ...base, count: 0 },
    ]) {
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80095e40, [SCREEN], 40000);
        const olog = LOG.slice();
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        techListDraw(rt.mem, SCREEN, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
    }
});

test("techListCreateWidgets matches F0x80096048", () => {
    const rt = runtime();
    for (const c of [
        { name: "widgets", techCount: 8, mp: 100 },
        { name: "widgets low mp", techCount: 8, mp: 50 },
        { name: "widgets mid mp", techCount: 8, mp: 500 },
        { name: "widgets high mp", techCount: 8, mp: 5000 },
        { name: "widgets blast", techCount: 8, mp: 5000, noCharge: 1 },
        { name: "widgets slot 2", techCount: 8, mp: 100, partyIndex: 2 },
    ]) {
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80096048, [SCREEN, SLOT], 40000);
        const olog = LOG.slice();
        const owidgets = Array.from({ length: 15 }, (_, i) => rt.mem.read32(SLOT + 0x04 + i * 4) >>> 0);

        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        techListCreateWidgets(rt.mem, SCREEN, SLOT, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(
            Array.from({ length: 15 }, (_, i) => rt.mem.read32(SLOT + 0x04 + i * 4) >>> 0),
            owidgets, `${c.name}: widget slots`,
        );
    }
});

test("techListUpdateRows matches F0x80096314", () => {
    const rt = runtime();
    const base = {
        state: 1, count: 8, rows: 6, cursor: 1, pagesField: 2, mp: 100, cost: 5,
        entries: [11, 12, 13, 0x4000 | 14, 15, 16, 17, 18],
    };
    for (const c of [
        { name: "rows normal", ...base },
        { name: "rows short of mp", ...base, mp: 3, cost: 40 },
        { name: "rows preselected", ...base, entries: [11, 0x8000 | 12, 13, 14, 15, 16, 17, 18] },
        { name: "rows moved back", ...base, cursor: 3 },
        { name: "rows second page", ...base, page: 1 },
        { name: "rows past the end", ...base, page: 2 },
        { name: "rows empty list", ...base, count: 0 },
        { name: "rows blast", ...base, noCharge: 1, mp: 1, cost: 99 },
    ]) {
        runBoth(rt, 0x80096314, c, (mem, host) => techListUpdateRows(mem, SCREEN, SLOT, host));
    }
});

test("techListTick state 0 matches F0x800967A0", () => {
    const rt = runtime();
    for (const c of [
        { name: "build six", state: 0, pages: 1, techCount: 6, mp: 100, cost: 5, cursor: 0 },
        { name: "build two pages", state: 0, pages: 2, techCount: 9, mp: 100, cost: 5, cursor: 0 },
        { name: "build empty", state: 0, pages: 0, techCount: 0, mp: 100, cost: 5, cursor: 0 },
        { name: "build seven", state: 0, pages: 2, techCount: 7, mp: 100, cost: 5, cursor: 0 },
        { name: "build with preselect", state: 0, pages: 1, techCount: 3, noCharge: 1, preselect: 1, preselectId: 3, mp: 100, cost: 5, cursor: 0 },
        { name: "build states 2 and 3", state: 2, pages: 1, techCount: 3, mp: 100, cost: 5, cursor: 0 },
        { name: "build state 3", state: 3, pages: 1, techCount: 3, mp: 100, cost: 5, cursor: 0 },
    ]) {
        runBoth(rt, 0x800967a0, c, (mem, host) => techListTick(mem, SCREEN, SLOT, host));
    }
});