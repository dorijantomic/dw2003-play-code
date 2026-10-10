// Phase 6 oracle: engine/dw3/ui/shop-root.ts must reproduce the item shop
// root's constructor F0x8008C118, its labels/cursor builder F0x8008B524 and its
// BIT refresh F0x8008C0C4. Each original runs through engine/native; the port
// runs against an equivalent allocator with the same callee stream.
//
// F0x8008C118's only call is [0x8004B43C] = F0x80016B78 (getCurrentShopId); the
// resident image supplies that pointer, so the original runs untouched.
// F0x8008B524's two callees and the cursor's +0x80 slot are stubbed to record
// the ordered call stream and to return the same synthetic pointers the port's
// host returns. F0x8008C0C4's two widget methods are stubbed the same way, and
// the second one re-reads the widget pointer to prove the reload.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { CURRENT_SHOP_ID } from "../engine/dw3/party-context.ts";
import {
    SHOP_ROOT_BIT_CELL,
    SHOP_ROOT_CURSOR_SLOT,
    SHOP_ROOT_EXTRA,
    SHOP_ROOT_BIT_WIDGET,
    SHOP_ROOT_SIZE,
    shopRootBitRefresh,
    shopRootCreate,
    shopRootLabels,
} from "../engine/dw3/ui/shop-root.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
let PORT_HEAP = 0x80190000;
let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function portHost(rt) {
    return {
        alloc(size) {
            const n = ((size >>> 0) + 0xf) & ~0xf;
            const p = PORT_HEAP;
            PORT_HEAP += n;
            for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
            return p;
        },
    };
}

test("shopRootCreate matches F0x8008C118", () => {
    const rt = runtime();
    for (const shopId of [0, 2, -1, 0x1234]) {
        rt.mem.write32(CURRENT_SHOP_ID, shopId);
        assert.equal(rt.mem.read32(0x8004b43c) >>> 0, 0x80016b78, "shop-id thunk pointer");
        const objA = rt.cpu.call(0x8008c118, []) >>> 0;
        PORT_HEAP = 0x80190000;
        const objB = shopRootCreate(rt.mem, portHost(rt)) >>> 0;

        const extraA = rt.mem.read32(objA + 0x24) >>> 0;
        const extraB = rt.mem.read32(objB + 0x24) >>> 0;
        assert.notEqual(extraA, 0, `shop ${shopId}: original extra block`);
        assert.notEqual(extraB, 0, `shop ${shopId}: port extra block`);
        for (let i = 0; i < SHOP_ROOT_EXTRA; i++) {
            assert.equal(rt.mem.read8(extraA + i), 0, `shop ${shopId}: original extra byte ${i}`);
            assert.equal(rt.mem.read8(extraB + i), 0, `shop ${shopId}: port extra byte ${i}`);
        }
        for (let off = 0; off < SHOP_ROOT_SIZE; off += 4) {
            if (off === 0x24) continue;
            assert.equal(
                rt.mem.read32(objB + off) >>> 0,
                rt.mem.read32(objA + off) >>> 0,
                `shop ${shopId} +0x${off.toString(16)}`,
            );
        }
        assert.equal(rt.mem.read32(objB + 0x60) | 0, shopId | 0, `shop ${shopId}: +0x60`);
    }

    // Sanity: the fields the constructor installs.
    const rt2 = runtime();
    rt2.mem.write32(CURRENT_SHOP_ID, 7);
    const obj = rt2.cpu.call(0x8008c118, []) >>> 0;
    assert.equal(rt2.mem.read32(obj + 0x48) >>> 0, 0x8008bfb0, "root handler");
    assert.equal(rt2.mem.read32(obj + 0xa8) >>> 0, 0x8008c0c4, "BIT refresh");
    assert.equal(rt2.mem.read32(obj + 0x50) >>> 0, 0x1000, "layer");
    assert.equal(rt2.mem.read32(obj + 0x60) >>> 0, 7, "shop id");
    assert.equal(rt2.mem.read32(obj + 0x20) >>> 0, SHOP_ROOT_EXTRA >> 2, "extra count");
});

test("shopRootLabels matches F0x8008B524", () => {
    const rt = runtime();
    const OWNER = 0x8018a000;
    const LABELS_A = 0x8018b000;
    const LABELS_B = 0x8018c000;

    // The original's callees: record the call stream, return synthetic pointers.
    let textNext = 0;
    rt.cpu.setStub(0x8001ae38, (c) => {
        EVENTS.push(["text", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return (0x80191000 + textNext++ * 0x200) >>> 0;
    });
    rt.cpu.setStub(0x8001b364, (c) => {
        EVENTS.push(["icon", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
        return 0x80199000;
    });
    const iconMethod = 0x80199080;
    rt.cpu.setStub(iconMethod, (c) => {
        EVENTS.push(["visible", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        // The real slot F0x8001B04C ends `li v0,1`; the stub models its return
        // so the original's v0 pins the bridge entry's `num(1)`.
        return 1;
    });

    const cases = [0x00001005, 0x0000abcd, 0x00008001, 0xffffffff];
    for (const targetWord of cases) {
        rt.mem.write32(OWNER + 0x50, targetWord);
        rt.mem.write32(0x80199000 + 0x80, iconMethod);
        for (const block of [LABELS_A, LABELS_B]) {
            for (let o = 0; o < 0x20; o += 4) rt.mem.write32(block + o, 0xdeaddead);
        }

        EVENTS = [];
        const oracleV0 = rt.cpu.call(0x8008b524, [OWNER, LABELS_A]) | 0;
        const oracleEvents = EVENTS.slice();

        EVENTS = [];
        textNext = 0;
        const sameIcon = 0x80199000;
        let portText = 0;
        shopRootLabels(
            rt.mem,
            {
                createTextElement(target, kind, x, y) {
                    EVENTS.push(["text", target >>> 0, kind >>> 0, x >>> 0, y >>> 0]);
                    return (0x80191000 + portText++ * 0x200) >>> 0;
                },
                spawnUiIcon(target, order, x, y) {
                    EVENTS.push(["icon", target >>> 0, order >>> 0, x >>> 0, y >>> 0]);
                    return sameIcon;
                },
                uiIconSetVisible(icon, visible) { EVENTS.push(["visible", icon >>> 0, visible >>> 0]); },
            },
            OWNER,
            LABELS_B,
        );
        const portEvents = EVENTS.slice();

        assert.equal(oracleV0, 1, `target=0x${(targetWord >>> 0).toString(16)}: original v0`);
        assert.deepEqual(portEvents, oracleEvents, `target=0x${(targetWord >>> 0).toString(16)}: events`);
        for (let o = 0; o < 0x20; o += 4) {
            assert.equal(
                rt.mem.read32(LABELS_B + o) >>> 0,
                rt.mem.read32(LABELS_A + o) >>> 0,
                `target=0x${(targetWord >>> 0).toString(16)} labels +0x${o.toString(16)}`,
            );
        }
    }

    // Sanity: the cursor was hidden and the slot order is the decoded one.
    rt.mem.write32(OWNER + 0x50, 0x00000010);
    for (let o = 0; o < 0x20; o += 4) rt.mem.write32(LABELS_A + o, 0xdeaddead);
    EVENTS = [];
    textNext = 0;
    rt.cpu.call(0x8008b524, [OWNER, LABELS_A]);
    assert.equal(rt.mem.read32(LABELS_A + SHOP_ROOT_CURSOR_SLOT) >>> 0, 0x80199000, "cursor slot");
    assert.deepEqual(EVENTS[6], ["icon", 0x10, 0, 0xb0, 0x2f], "icon call");
    assert.deepEqual(EVENTS[7], ["visible", 0x80199000, 0], "icon hidden");
});

test("shopRootBitRefresh matches F0x8008C0C4", () => {
    const rt = runtime();
    const OWNER = 0x8018a000;
    const CTX = 0x8018b000;
    const W1 = 0x8018c000;
    const W2 = 0x8018d000;
    const SET_LINE = 0x80199000;
    const MEASURE = 0x80199040;

    rt.mem.write32(OWNER + 0x24, CTX);
    rt.mem.write32(W1 + 0x118, SET_LINE);
    rt.mem.write32(W1 + 0x148, MEASURE);
    rt.mem.write32(W2 + 0x148, MEASURE);
    rt.cpu.setStub(SET_LINE, (c) => {
        EVENTS.push(["setLine", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        // Prove the original re-reads ctx+0x8 for the second call: move it.
        rt.mem.write32(CTX + SHOP_ROOT_BIT_WIDGET, W2);
        return 0;
    });
    rt.cpu.setStub(MEASURE, (c) => {
        EVENTS.push(["measure", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });

    for (const bit of [0, 1234, -5678, 0x7fffffff]) {
        rt.mem.write32(CTX + SHOP_ROOT_BIT_WIDGET, W1);
        rt.mem.write32(SHOP_ROOT_BIT_CELL, bit | 0);

        EVENTS = [];
        rt.cpu.call(0x8008c0c4, [OWNER]);
        const oracleEvents = EVENTS.slice();

        rt.mem.write32(CTX + SHOP_ROOT_BIT_WIDGET, W1);
        EVENTS = [];
        shopRootBitRefresh(rt.mem, {
            widgetSetLineNumber(widget, line, value) {
                EVENTS.push(["setLine", widget >>> 0, line >>> 0, value >>> 0]);
                rt.mem.write32(CTX + SHOP_ROOT_BIT_WIDGET, W2);
            },
            measureTextWidth(widget, enable) { EVENTS.push(["measure", widget >>> 0, enable >>> 0]); },
        }, OWNER);
        const portEvents = EVENTS.slice();

        assert.deepEqual(portEvents, oracleEvents, `bit=${bit}: events`);
    }

    // Sanity: the first call reads the BIT cell and line 0.
    rt.mem.write32(CTX + SHOP_ROOT_BIT_WIDGET, W1);
    rt.mem.write32(SHOP_ROOT_BIT_CELL, 4242);
    EVENTS = [];
    rt.cpu.call(0x8008c0c4, [OWNER]);
    assert.deepEqual(EVENTS[0], ["setLine", W1, 0, 4242], "setLine call");
    assert.deepEqual(EVENTS[1], ["measure", W2, 1], "measure call after reload");
});
