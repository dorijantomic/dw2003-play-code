// Oracle: engine/dw3/ui/shop-fade-task.ts must match the original pro/stitshop
// fade object — F0x800835C4 create, F0x80083344 start, F0x80083510 tick and
// F0x800833CC draw. The original runs through engine/native; the task
// allocator, the object methods (+0x28/+0x38), the display service cells and
// the prim painter are stubbed on both sides so the ordered calls, the fields
// and the prim words can be compared.
//
// Claims: stitshop-scene-and-fader-2026-10-10 (ledger; review accepted
// 2026-10-10). Assembly: ~/ddw3/asm/dw2003/pro/stitshop.s L428-461 (start),
// L462-542 (draw), L543-587 (tick), L588-605 (create).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    SHOP_FADE_DRAW_MODE, SHOP_FADE_HANDLER, SHOP_FADE_SIZE, SHOP_FADE_START_ENTRY,
    SHOP_FADE_START_SLOT, createShopFade, shopFadeTick, startShopFade,
} from "../engine/dw3/ui/shop-fade-task.ts";

const screens = "web/assets/native/screens/";
const resident = new Uint8Array(readFileSync(`${screens}resident.bin`));
const shop = new Uint8Array(readFileSync(`${screens}pro_stitshop.bin`));
const entry = { size: shop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };

const FADE = 0x80150000;
const NEW_FADE = 0x80154000;
const M28 = 0x0fe30028;
const M38 = 0x0fe30038;
const S17C = 0x0fe317c0;
const S138 = 0x0fe31380;
const S158 = 0x0fe31580;
const S15C = 0x0fe315c0;
const LAYER = 0x80160000;
const PRIM_A = 0x80161000;
const PRIM_B = 0x80162000;
const LOG = [];

const rt = new NativeStageRuntime(shop, entry, host, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
});
rt.cpu.gp = 0x8005cb50;
const st = (a, f) => rt.cpu.setStub(a, f);
st(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return NEW_FADE; });
st(0x800833cc, (c) => { LOG.push(["draw", c.reg(4) | 0]); return 0; });
st(M28, (c) => { LOG.push(["method", c.reg(4) | 0, 0x28, c.reg(5) | 0]); return 0; });
st(M38, (c) => { LOG.push(["method", c.reg(4) | 0, 0x38, c.reg(4) | 0]); return 0; });

/** The port side's tree boundary: the same call stream the stubs record. */
const tree = () => ({
    allocate(h, s, e) { LOG.push(["alloc", h | 0, s, e]); return NEW_FADE; },
    callMethod(t, slot, args) {
        LOG.push(["method", t | 0, slot, ...(slot === 0x38 ? [t | 0] : args.map((a) => a | 0))]);
    },
});
/** The port side's dim painter: the tick comparison only needs the call. */
const onDraw = () => { LOG.push(["draw", FADE | 0]); };

function seed(c) {
    for (let i = 0; i < 0x80; i += 4) { rt.mem.write32(FADE + i, 0); rt.mem.write32(NEW_FADE + i, 0); }
    rt.mem.write32(FADE + 0x28, M28);
    rt.mem.write32(FADE + 0x38, M38);
    rt.mem.write32(FADE + 0x0c, c.state ?? 0);
    rt.mem.write32(FADE + 0x10, c.armed ?? 0);
    rt.mem.write32(FADE + 0x58, c.dir ?? 0);
    rt.mem.write32(FADE + 0x5c, c.level ?? 0);
    rt.mem.write32(FADE + 0x60, c.step ?? 0);
    rt.mem.write32(NEW_FADE + 0x28, M28);
    rt.mem.write32(NEW_FADE + 0x38, M38);
}
const snap = () => {
    const out = [];
    for (const base of [FADE, NEW_FADE]) for (let i = 0; i < 0x80; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
    return out;
};
function compare(name, c, orig, port) {
    seed(c); LOG.length = 0; orig();
    const olog = LOG.slice(); const osnap = snap();
    seed(c); LOG.length = 0; port();
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
}

test("createShopFade matches F0x800835C4 (task, +0x64 start, layer, bucket)", () => {
    compare("create", {},
        () => rt.cpu.call(0x800835c4, [0x80170000]),
        () => createShopFade(rt.mem, tree()));
    // The claim's literals, asserted directly as well.
    assert.equal(SHOP_FADE_HANDLER, 0x80083510);
    assert.equal(SHOP_FADE_SIZE, 0x68);
    assert.equal(SHOP_FADE_START_ENTRY, 0x80083344);
    assert.equal(SHOP_FADE_START_SLOT, 0x64);
    assert.equal(rt.mem.read32(NEW_FADE + 0x64) >>> 0, 0x80083344);
    assert.equal(rt.mem.read32(NEW_FADE + 0x50), 0x1000);
    assert.equal(rt.mem.read32(NEW_FADE + 0x54), 6);
});

test("startShopFade matches F0x80083344 across directions and durations", () => {
    for (const dirn of [0, 1, 2, -1]) {
        for (const frames of [1, 7, 30, 255, 0x100, 0xff00, 0x10000, 0]) {
            compare(`start dir${dirn} frames${frames}`, {},
                () => rt.cpu.call(0x80083344, [FADE, dirn, frames], 20000),
                () => startShopFade(rt.mem, tree(), FADE, dirn, frames));
        }
    }
});

test("shopFadeTick matches F0x80083510 across states (draws on 1/2, +0x38 otherwise)", () => {
    for (const state of [0, 1, 2, 3, 4, 9, -1]) {
        for (const armed of [0, 1]) {
            for (const dirn of [0, 1]) {
                for (const level of [0, 0x100, 0xfe00, 0xff00, 0xffff]) {
                    for (const step of [0x888, -0x888, 0x2000, -0x2000]) {
                        const c = { state, armed, dir: dirn, level, step };
                        compare(`tick ${JSON.stringify(c)}`, c,
                            () => rt.cpu.call(0x80083510, [FADE], 40000),
                            () => shopFadeTick(rt.mem, tree(), FADE, onDraw));
                    }
                }
            }
        }
    }
});

test("drawFader prim fields match F0x800833CC and the port's draw descriptor", () => {
    // The tick comparison above stubs the draw entry; run the shipped body here.
    rt.cpu.clearStub(0x800833cc);
    // The display service cells: [0x8004DE10+0x17C](0x1000) -> the layer;
    // layer+0x138(layer, 6) -> the first prim; [0x8004DE10+0x158]() -> the prim
    // the quad is written into; [0x8004DE10+0x15C](prim+0x20) submits.
    rt.mem.write32(0x8004de10 + 0x17c, S17C);
    rt.mem.write32(0x8004de10 + 0x158, S158);
    rt.mem.write32(0x8004de10 + 0x15c, S15C);
    rt.mem.write32(LAYER + 0x138, S138);
    st(S17C, (c) => { LOG.push(["view", c.reg(4) >>> 0]); return LAYER; });
    st(S138, (c) => { LOG.push(["primList", c.reg(4) >>> 0, c.reg(5) | 0]); return PRIM_A; });
    st(S158, () => { LOG.push(["primNext"]); return PRIM_B; });
    st(S15C, (c) => { LOG.push(["submit", c.reg(4) >>> 0]); return 0; });
    for (let i = 0; i < 0x60; i += 4) { rt.mem.write32(PRIM_A + i, 0); rt.mem.write32(PRIM_B + i, 0); }
    rt.mem.write32(FADE + 0x50, 0x1000);
    rt.mem.write32(FADE + 0x54, 6);
    rt.mem.write32(FADE + 0x5c, 0x5a00);

    LOG.length = 0;
    rt.cpu.call(0x800833cc, [FADE], 20000);
    assert.deepEqual(LOG, [
        ["view", 0x1000], ["primList", LAYER, 6], ["primNext"], ["submit", PRIM_B + 0x20],
    ], "drawFader's service call order");
    // The fill primitive (claim: type byte3 = 5, byte7 = 0x2A, 0x140 x 0x100,
    // colour = +0x5C >> 8 in bytes 4-6).
    assert.equal(rt.mem.read8(PRIM_B + 3), 5);
    assert.equal(rt.mem.read8(PRIM_B + 7), 0x2a);
    assert.deepEqual(
        [rt.mem.read16(PRIM_B + 8), rt.mem.read16(PRIM_B + 0xa), rt.mem.read16(PRIM_B + 0xc),
         rt.mem.read16(PRIM_B + 0xe), rt.mem.read16(PRIM_B + 0x10), rt.mem.read16(PRIM_B + 0x12),
         rt.mem.read16(PRIM_B + 0x14), rt.mem.read16(PRIM_B + 0x16)],
        [0, 0, 0x140, 0, 0, 0x100, 0x140, 0x100], "quad corners");
    assert.deepEqual(
        [rt.mem.read8(PRIM_B + 4), rt.mem.read8(PRIM_B + 5), rt.mem.read8(PRIM_B + 6)],
        [0x5a, 0x5a, 0x5a], "colour = +0x5C >> 8");
    // The linked draw-mode primitive (type 1, 0xE1000245) and the OT link.
    assert.equal(rt.mem.read8(PRIM_B + 0x18 + 3), 1);
    assert.equal(rt.mem.read32(PRIM_B + 0x18 + 4) >>> 0, 0xe1000245);
    // The OT link: a PS1 tag address is the low 24 bits (mask 0x00FFFFFF).
    assert.equal(rt.mem.read32(PRIM_A) >>> 0, (PRIM_B + 0x18) & 0xffffff,
        "first prim links to the draw-mode prim");

    // The translated draw event carries the same fields (state 2 paints).
    rt.mem.write32(FADE + 0x0c, 2);
    rt.mem.write32(FADE + 0x5c, 0x5a00);
    let draw = null;
    shopFadeTick(rt.mem, tree(), FADE, (d) => { draw = d; });
    assert.deepEqual(draw, {
        level: 0x5a, layer: 0x1000, depth: 6, x: 0, y: 0, width: 0x140, height: 0x100,
        blend: (SHOP_FADE_DRAW_MODE >>> 5) & 3,
    });
    assert.equal((SHOP_FADE_DRAW_MODE >>> 5) & 3, 2);
});
