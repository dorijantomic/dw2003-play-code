// Lane B Phase 4 oracle: engine/dw3/ui/native/pause-items.ts must match the
// original pro/ststatus items-rooot construction/lifecycle family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the text/frame widget constructors, the card-index service and the
// item tick/draw sub-screens are stubbed on both sides so the ordered calls and
// the widget fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    pauseItemsCtor,
    pauseItemsRootFactory,
    pauseItemsRootTick,
} from "../../engine/dw3/ui/native/pause-items.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const status = new Uint8Array(readFileSync(join(dir, "pro_ststatus.bin")));
const entry = { size: status.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARG1 = 0x80155000;
const ROOT = 0x80170000;
const LAYOUT = 0x80160000;
const WIDGET_BASE = 0x80180000;
const FRAME_BASE = 0x80190000;

const CREATE_TEXT_FN = 0x8001ae38;
const CREATE_FRAME_FN = 0x8001b364;
const ALLOC_FN = 0x80014504;
const ITEMS_TICK_FN = 0x80090264;
const ITEMS_DRAW_FN = 0x8008f8f0;
const CARD_INDEX_SLOT = 0x80048d34 + 0x2718;
const LAYOUT_PTR = 0x8009af6c;

const ALLOC_STUB = 0x0fdf0000;
const CARD_IDX_STUB = 0x0fdf0004;
const FRAME80_STUB = 0x0fdf0008;
const METHOD38_STUB = 0x0fdf000c;

const LOG = [];
const CONTROL = { alloc: ROOT, cards: [0, -1, 2] };
let made = 0;

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(status, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ALLOC_FN, (c) => { LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return CONTROL.alloc; });
    rt.cpu.setStub(CREATE_TEXT_FN, (c) => {
        LOG.push(["text", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const w = WIDGET_BASE + made * 0x100;
        made += 1;
        return w;
    });
    rt.cpu.setStub(CREATE_FRAME_FN, (c) => {
        LOG.push(["frame", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const w = FRAME_BASE + made * 0x100;
        made += 1;
        rt.mem.write32(w + 0x80, FRAME80_STUB);
        return w;
    });
    rt.cpu.setStub(CARD_IDX_STUB, (c) => { LOG.push(["cardIndex", c.reg(4) | 0]); return CONTROL.cards[c.reg(4) | 0] ?? -1; });
    rt.cpu.setStub(FRAME80_STUB, (c) => { LOG.push(["method", c.reg(4) | 0, 0x80, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(METHOD38_STUB, (c) => { LOG.push(["method", c.reg(4) | 0, 0x38]); return 0; });
    rt.cpu.setStub(ITEMS_TICK_FN, (c) => { LOG.push(["itemsTick", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(ITEMS_DRAW_FN, (c) => { LOG.push(["itemsDraw", c.reg(4) | 0]); return 0; });
    rt.mem.write32(CARD_INDEX_SLOT, CARD_IDX_STUB);
    rt.mem.write32(LAYOUT_PTR, LAYOUT);
    return rt;
}

function seedLayout(rt) {
    for (let i = 0; i < 0x200; i += 2) rt.mem.write16(LAYOUT + i, (0x10 + (i >> 1)) & 0xffff);
    rt.mem.write32(LAYOUT_PTR, LAYOUT);
}

function seedObj(rt, c) {
    for (let i = 0; i < 0x500; i += 4) rt.mem.write32(OBJ + i, 0);
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(ARG1 + i, 0);
    rt.mem.write32(OBJ + 0x38, METHOD38_STUB);
    rt.mem.write16(OBJ + 0x54, c.target ?? 0x1005);
    rt.mem.write32(OBJ + 0x58, c.columns ?? 6);
    rt.mem.write32(OBJ + 0x70, c.page ?? 2);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x5c, 0);
    rt.mem.write32(0x8005cca8, 0x801a0000);
    CONTROL.cards = c.cards ?? [0, -1, 2];
    made = 0;
}

function portHost() {
    return {
        allocateRoot() { LOG.push(["alloc", 0x80091d18 | 0, 0x45c, 0xd4]); return CONTROL.alloc; },
        cardIndexOf(i) { LOG.push(["cardIndex", i | 0]); return CONTROL.cards[i] ?? -1; },
        createTextElement(target, kind, x, y) {
            LOG.push(["text", target | 0, kind | 0, x | 0, y | 0]);
            const w = WIDGET_BASE + made * 0x100;
            made += 1;
            return w;
        },
        createFrameElement(target, frame, x, y) {
            LOG.push(["frame", target | 0, frame | 0, x | 0, y | 0]);
            const w = FRAME_BASE + made * 0x100;
            made += 1;
            return w;
        },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
        itemsTick(obj, arg1) { LOG.push(["itemsTick", obj | 0, arg1 | 0]); },
        itemsDraw(obj) { LOG.push(["itemsDraw", obj | 0]); },
    };
}

function words(rt, base, size) {
    const out = [];
    for (let i = 0; i < size; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
    return out;
}

test("pauseItemsRootFactory matches F0x80091E4C", () => {
    const rt = runtime();
    seedObj(rt, {});
    CONTROL.alloc = ROOT;
    LOG.length = 0;
    rt.cpu.call(0x80091e4c, [0x1234], 40000);
    const olog = LOG.slice();
    const ofields = [rt.mem.read32(ROOT + 0x50) >>> 0, rt.mem.read32(ROOT + 0x54) >>> 0, rt.mem.read32(ROOT + 0x58) >>> 0];

    seedObj(rt, {});
    CONTROL.alloc = ROOT;
    LOG.length = 0;
    const port = pauseItemsRootFactory(rt.mem, 0x1234, portHost());
    assert.deepEqual(LOG, olog, "calls");
    assert.equal(port, ROOT, "root address");
    assert.deepEqual([rt.mem.read32(ROOT + 0x50) >>> 0, rt.mem.read32(ROOT + 0x54) >>> 0, rt.mem.read32(ROOT + 0x58) >>> 0], ofields, "fields");
});

test("pauseItemsCtor matches F0x8008E94C", () => {
    const rt = runtime();
    const cases = [
        { name: "default", target: 0x1005, columns: 6, page: 2 },
        { name: "other target", target: 0x1007, columns: 4, page: 0 },
    ];
    for (const c of cases) {
        seedObj(rt, c);
        seedLayout(rt);
        LOG.length = 0;
        rt.cpu.call(0x8008e94c, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = words(rt, ARG1, 0xd0);

        seedObj(rt, c);
        seedLayout(rt);
        LOG.length = 0;
        pauseItemsCtor(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(words(rt, ARG1, 0xd0), ofields, `${c.name}: widgets`);
    }
});

test("pauseItemsRootTick matches F0x80091D18", () => {
    const rt = runtime();
    const cases = [
        { name: "state 0 two cards", state: 0, cards: [0, -1, 2] },
        { name: "state 0 no cards", state: 0, cards: [-1, -1, -1] },
        { name: "state 4 builds", state: 4, cards: [1, 2, 3] },
        { name: "state 1 runs", state: 1 },
        { name: "state 2 idle", state: 2 },
        { name: "state 3 idle", state: 3 },
    ];
    for (const c of cases) {
        seedObj(rt, c);
        seedLayout(rt);
        LOG.length = 0;
        rt.cpu.call(0x80091d18, [OBJ, ARG1], 40000);
        const olog = LOG.slice();
        const ofields = [rt.mem.read32(OBJ + 0x5c) >>> 0, ...words(rt, OBJ + 0x3c0, 0x80)];

        seedObj(rt, c);
        seedLayout(rt);
        LOG.length = 0;
        pauseItemsRootTick(rt.mem, OBJ, ARG1, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual([rt.mem.read32(OBJ + 0x5c) >>> 0, ...words(rt, OBJ + 0x3c0, 0x80)], ofields, `${c.name}: fields`);
    }
});
