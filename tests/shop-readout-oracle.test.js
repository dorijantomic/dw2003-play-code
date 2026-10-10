// Phase 4 oracle: engine/dw3/ui/shop-readout.ts shopReadout (F0x800875E0, the
// item shop's list-label readout) must match the original. The original runs
// through engine/native with the shared text-service block F0x8001FCC0, the
// 0x80044F4C resource service and the +0x148 justification toggle stubbed; the
// port gets matching callbacks. widgetSetLine0FromSource (F0x800194E8),
// widgetSetLineNumber (F0x800195B0) and setTextElementFlagC1 (F0x8001A23C) run
// as the real translated callees on the port side and as the real resident code
// on the oracle side.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    LINE_BUFFER,
    LINE_CAPACITY,
    LINE_FLAG,
    LINE_LENGTH,
    LINE_RECORD_BASE,
    LINE_RECORD_STRIDE,
} from "../engine/dw3/ui/text-widget-line.ts";
import { shopReadout } from "../engine/dw3/ui/shop-readout.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const STOCK = 0x80180800;
const SLOTS_A = 0x80181000;
const SLOTS_B = 0x80181100;
const WIDGETS_A = 0x80182000;
const WIDGETS_B = 0x80184000;
const STR_ITEMS = 0x80186000;
const STR_LABELS = 0x80186400;
const GETTER_STUB = 0x0fd40000;
const SERVICE_STUB = 0x0fd50000;
const STRIDE = 0x100;
const WIDGET_STRIDE = 0x200;
const ROWS = 8;
const FIXED = [8, 9, 10, 11, 12];
const TOTAL = 8;
const LABEL = 9;
const COUNT = 10;
const PREV = 11;
const NEXT = 12;
const ITEM_HANDLE = 0x1111;
const LABEL_HANDLE = 0x2222;
let PORT_HEAP = 0x80188000;

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function writeString(rt, addr, s) {
    for (let i = 0; i < 0x40; i++) rt.mem.write8(addr + i, 0);
    for (let i = 0; i < s.length; i++) rt.mem.write8(addr + i, s.charCodeAt(i));
}

function seedStrings(rt) {
    const items = ["Potion", "DigiEgg", "Omnimon", "miss", "Gabumon", "Patamon",
        "Gatomon", "Palmon", "Biyomon", "Tentomon"];
    for (let i = 0; i < items.length; i++) writeString(rt, STR_ITEMS + i * STRIDE, items[i]);
    writeString(rt, STR_LABELS + 0 * STRIDE, "BUY");
    writeString(rt, STR_LABELS + 1 * STRIDE, "<<");
    writeString(rt, STR_LABELS + 2 * STRIDE, ">>");
    writeString(rt, STR_LABELS + 3 * STRIDE, "X");
}

/** Shared lookup: item index 3 misses; label indices 0x18..0x1a resolve. */
function stringById(source, index) {
    if (source === ITEM_HANDLE) {
        if (index < 0 || index > 9) return 0;
        if (index === 3) return 0;
        return STR_ITEMS + index * STRIDE;
    }
    if (source === LABEL_HANDLE) {
        if (index === 0x18) return STR_LABELS + 0 * STRIDE;
        if (index === 0x19) return STR_LABELS + 1 * STRIDE;
        if (index === 0x1a) return STR_LABELS + 2 * STRIDE;
        return 0;
    }
    return 0;
}

function handleFor(bankId) {
    if (bankId === 0x6a) return ITEM_HANDLE;
    if (bankId === 0x71) return LABEL_HANDLE;
    return 0;
}

function fixtureObj(rt, opts) {
    for (let i = 0; i < 0x720; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x5c, opts.mode ?? 0);
    rt.mem.write32(OBJ + 0x6b4, STOCK);
    rt.mem.write32(OBJ + 0x6c0, opts.count ?? 6);
    rt.mem.write32(OBJ + 0x6c4, opts.page ?? 0);
    rt.mem.write32(OBJ + 0x6c8, opts.pageCount ?? 2);
    rt.mem.write32(OBJ + 0x6d4, opts.pageSize ?? 4);
    for (let i = 0; i < 12; i++) {
        rt.mem.write16(STOCK + i * 2, opts.ids[i] ?? 0);
        rt.mem.write16(OBJ + 0x64 + i * 2, opts.ids[i] ?? 0);
    }
}

function waddr(base, k) {
    return (base + k * WIDGET_STRIDE) >>> 0;
}

function slotOffset(k) {
    if (k < ROWS) return k * 4;
    if (k === TOTAL) return 0x38;
    if (k === LABEL) return 0x3c;
    if (k === COUNT) return 0x40;
    if (k === PREV) return 0x44;
    return 0x48;
}

function initWidget(rt, addr, preLen) {
    for (let i = 0; i < 0x180; i += 4) rt.mem.write32(addr + i, 0);
    rt.mem.write32(addr + 0x114, 0x800194e8);
    rt.mem.write32(addr + 0x118, 0x800195b0);
    rt.mem.write32(addr + 0x144, 0x8001a23c);
    rt.mem.write32(addr + 0x148, 0x8001a25c);
    rt.mem.write8(addr + 0xc1, 0xee);
    if (preLen) rt.mem.write16(addr + 0x62, preLen);
}

function initSide(rt, widgetsBase, slotsBase, preLen) {
    for (const k of [0, 1, 2, 3, 4, 5, 6, 7, TOTAL, LABEL, COUNT, PREV, NEXT]) {
        initWidget(rt, waddr(widgetsBase, k), preLen);
    }
    for (let i = 0; i < 0x4c / 4; i++) rt.mem.write32(slotsBase + i * 4, 0);
    for (const k of [0, 1, 2, 3, 4, 5, 6, 7, TOTAL, LABEL, COUNT, PREV, NEXT]) {
        rt.mem.write32(slotsBase + slotOffset(k), waddr(widgetsBase, k));
    }
}

function slotName(k) {
    if (k < ROWS) return `row${k}`;
    if (k === TOTAL) return "total";
    if (k === LABEL) return "label";
    if (k === COUNT) return "count";
    if (k === PREV) return "prev";
    return "next";
}

function bytes(rt, addr, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(rt.mem.read8(addr + i));
    return out;
}

function state(rt, self) {
    const out = {
        c1: rt.mem.read8(self + 0xc1),
        a4: rt.mem.read16(self + 0xa4),
        a6: rt.mem.read16(self + 0xa6),
        a8: rt.mem.read16(self + 0xa8),
        aa: rt.mem.read16(self + 0xaa),
    };
    for (let line = 0; line < 6; line++) {
        const rec = self + LINE_RECORD_BASE + line * LINE_RECORD_STRIDE;
        const buf = rt.mem.read32(rec + LINE_BUFFER) >>> 0;
        const cap = rt.mem.read16(rec + LINE_CAPACITY) & 0xffff;
        out[`len${line}`] = rt.mem.read16(rec + LINE_LENGTH) & 0xffff;
        out[`flag${line}`] = rt.mem.read16(rec + LINE_FLAG) & 0xffff;
        out[`cap${line}`] = cap;
        out[`word${line}`] = rt.mem.read16(self + line * LINE_RECORD_STRIDE + 0x66) & 0xffff;
        out[`null${line}`] = buf === 0;
        out[`bytes${line}`] = buf === 0 ? null : bytes(rt, buf, cap);
    }
    return out;
}

function portHost(events) {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            return p;
        },
        free() {},
        stringById(source, index) {
            events.push(["lookup", source >>> 0, index | 0]);
            return stringById(source >>> 0, index | 0);
        },
        resourceSource(bankId) {
            events.push(["svc", bankId >>> 0]);
            return handleFor(bankId >>> 0);
        },
        measureTextWidth(widget, enable) {
            events.push(["mwt", namesB.get(widget >>> 0), enable | 0]);
        },
        scratch() {
            return 0x80187000;
        },
    };
}

// Slot-name maps: the original and the port address different widget regions,
// so events normalise widget pointers to their logical slot name.
const namesA = new Map();
const namesB = new Map();
for (const k of [0, 1, 2, 3, 4, 5, 6, 7, TOTAL, LABEL, COUNT, PREV, NEXT]) {
    namesA.set(waddr(WIDGETS_A, k), slotName(k));
    namesB.set(waddr(WIDGETS_B, k), slotName(k));
}

function installOriginalStubs(rt, events) {
    rt.cpu.setStub(0x8001fcc0, (c) => {
        rt.mem.write32(c.reg(4) >>> 0, GETTER_STUB);
        return 0;
    });
    rt.cpu.setStub(GETTER_STUB, (c) => {
        const source = c.reg(4) >>> 0;
        const index = c.reg(5) | 0;
        events.push(["lookup", source, index]);
        return stringById(source, index);
    });
    rt.cpu.setStub(0x8001a25c, (c) => {
        events.push(["mwt", namesA.get(c.reg(4) >>> 0), c.reg(5) | 0]);
        return 0;
    });
    rt.mem.write32(0x80044f4c, SERVICE_STUB);
    rt.cpu.setStub(SERVICE_STUB, (c) => {
        const bankId = c.reg(4) >>> 0;
        events.push(["svc", bankId]);
        return handleFor(bankId);
    });
    rt.mem.write32(0x8005cca8, 0);
}

function runCase(label, opts) {
    const rt = runtime();
    seedStrings(rt);
    fixtureObj(rt, opts);
    const preLen = opts.preLen ?? 0;

    const oracleEvents = [];
    installOriginalStubs(rt, oracleEvents);
    initSide(rt, WIDGETS_A, SLOTS_A, preLen);
    rt.cpu.call(0x800875e0, [OBJ, SLOTS_A, opts.visible ?? 1]);

    PORT_HEAP = 0x80188000;
    const portEvents = [];
    initSide(rt, WIDGETS_B, SLOTS_B, preLen);
    shopReadout(rt.mem, OBJ, SLOTS_B, opts.visible ?? 1, portHost(portEvents));

    assert.deepEqual(portEvents, oracleEvents, `${label}: boundary event stream`);
    for (const k of [0, 1, 2, 3, 4, 5, 6, 7, TOTAL, LABEL, COUNT, PREV, NEXT]) {
        assert.deepEqual(
            state(rt, waddr(WIDGETS_B, k)),
            state(rt, waddr(WIDGETS_A, k)),
            `${label}: widget ${slotName(k)}`,
        );
    }
}

test("shopReadout matches F0x800875E0", () => {
    runCase("page 0 of 2, one hidden row and one miss", {
        mode: 0, pageSize: 4, ids: [1, 2, 0, 5], count: 6, page: 0, pageCount: 2,
    });
    runCase("page 1 of 2 (tail rows past count)", {
        mode: 0, pageSize: 4, ids: [4, 6, 7, 8], count: 6, page: 1, pageCount: 2,
    });
    runCase("single page (no prev/next handling)", {
        mode: 0, pageSize: 4, ids: [1, 2, 3, 5], count: 6, page: 0, pageCount: 1,
    });
    runCase("BUY page of 8", {
        mode: 0, pageSize: 8, ids: [1, 2, 0, 5, 6, 7, 8, 9], count: 10, page: 0, pageCount: 2,
    });
    runCase("SELL inline ids", {
        mode: 1, pageSize: 8, ids: [2, 4, 3, 6, 7, 8, 9, 1], count: 10, page: 0, pageCount: 2,
    });
    runCase("hide with pre-existing line text", {
        mode: 0, pageSize: 4, ids: [1, 2, 0, 5], count: 6, page: 0, pageCount: 2,
        visible: 0, preLen: 3,
    });
    runCase("hide with an empty page", {
        mode: 0, pageSize: 0, ids: [], count: 0, page: 0, pageCount: 0, visible: 0,
    });
    runCase("populate with an empty page", {
        mode: 0, pageSize: 0, ids: [], count: 0, page: 0, pageCount: 0,
    });
});

test("sanity: the readout actually fills a row label", () => {
    const rt = runtime();
    seedStrings(rt);
    fixtureObj(rt, { mode: 0, pageSize: 4, ids: [1, 2, 0, 5], count: 6, page: 0, pageCount: 2 });
    const events = [];
    installOriginalStubs(rt, events);
    initSide(rt, WIDGETS_A, SLOTS_A, 0);
    rt.cpu.call(0x800875e0, [OBJ, SLOTS_A, 1]);
    const rec = waddr(WIDGETS_A, 0) + LINE_RECORD_BASE;
    assert.equal(rt.mem.read16(rec + LINE_LENGTH) & 0xffff, 7, "row 0 length (item id 1 -> DigiEgg)");
    const buf = rt.mem.read32(rec + LINE_BUFFER) >>> 0;
    assert.notEqual(buf, 0);
    assert.equal(rt.mem.read8(buf), "D".charCodeAt(0), "row 0 first byte");
    const totalRec = waddr(WIDGETS_A, TOTAL) + LINE_RECORD_BASE;
    assert.equal(rt.mem.read16(totalRec + LINE_LENGTH) & 0xffff, 1, "page counter length");
});
