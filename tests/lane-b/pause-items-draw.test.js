// Lane B Phase 4 oracle: engine/dw3/ui/native/pause-items.ts pauseItemsDraw must
// match the original pro/ststatus F0x8008F8F0 item-grid draw.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// frame counter, card-index service, resource/pack services and every draw
// context method are stubbed on both sides so the ordered draw intents and the
// counter fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { pauseItemsDraw } from "../../engine/dw3/ui/native/pause-items.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const status = new Uint8Array(readFileSync(join(dir, "pro_ststatus.bin")));
const entry = { size: status.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const TABLE = 0x80160000;
const RES_PTR = 0x80190000;
const PACK_PTR = 0x80191000;
const FRAME_CELL = 0x8004de20;
const TABLE_PTR = 0x8009af68;

const PACK_PTR_CELL = 0x80044b38 + 0x424;
const NAME_PTR_CELL = 0x80042b9c;
const CARD_INDEX_SLOT = 0x80048d34 + 0x2718;

const PACK_STUB = 0x0fe00000;
const NAME_STUB = 0x0fe00004;
const CARD_IDX_STUB = 0x0fe00008;

const LOG = [];
const CONTROL = { cards: [0, 1, 2], frame: 0x100 };

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(status, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(NAME_STUB, (c) => { LOG.push(["name", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(CARD_IDX_STUB, (c) => { LOG.push(["cardIndex", c.reg(4) | 0]); return CONTROL.cards[c.reg(4) | 0] ?? -1; });
    rt.cpu.setStub(0x8001ecbc, (c) => { LOG.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed34, (c) => { LOG.push(["layer", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001f5d0, (c) => { LOG.push(["scale", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return 0; });
    rt.cpu.setStub(0x8001f608, (c) => { LOG.push(["pos", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ecec, (c) => { LOG.push(["palette", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed6c, (c) => { LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });

    rt.mem.write32(PACK_PTR_CELL, PACK_STUB);
    rt.mem.write32(NAME_PTR_CELL, NAME_STUB);
    rt.mem.write32(CARD_INDEX_SLOT, CARD_IDX_STUB);
    return rt;
}

function seed(rt, c) {
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x54, c.layer ?? 0x1000);
    rt.mem.write32(OBJ + 0x58, c.rows ?? 6);
    rt.mem.write32(OBJ + 0x5c, c.count ?? 0);
    rt.mem.write32(OBJ + 0x78, c.nameIndex ?? 3);
    rt.mem.write32(OBJ + 0x3b0, c.badgeRow ?? 1);
    rt.mem.write32(OBJ + 0x3b4, c.badgeOn ?? 0);
    rt.mem.write32(OBJ + 0x3b8, c.badgeFrame ?? 0);
    rt.mem.write32(OBJ + 0x3bc, c.badgeTick ?? 0);
    rt.mem.write32(OBJ + 0x3c0, c.animOn ?? 0);
    rt.mem.write32(OBJ + 0x3c4, c.animFrame ?? 0);
    rt.mem.write32(OBJ + 0x3c8, c.animTick ?? 0);
    for (let i = 0; i < 6; i++) {
        rt.mem.write32(OBJ + i * 0x10 + 0x3d4, c.scales?.[i] ?? 0);
        rt.mem.write32(OBJ + i * 4 + 0x60, c.cells?.[i] ?? 0);
    }
    rt.mem.write32(OBJ + 0x6c, c.lastTick ?? 0);
    rt.mem.write32(OBJ + 0x404, c.fixed404 ?? 0);
    rt.mem.write32(OBJ + 0x414, c.fixed414 ?? 0);
    rt.mem.write32(OBJ + 0x424, c.fixed424 ?? 0);
    rt.mem.write32(OBJ + 0x434, c.fixed434 ?? 0);
    rt.mem.write32(OBJ + 0x444, c.fixed444 ?? 0);

    for (let i = 0; i < 0x200; i += 4) rt.mem.write32(TABLE + i, 0);
    for (const [addr, value] of c.table ?? []) rt.mem.write32(TABLE + addr, value);
    rt.mem.write32(TABLE_PTR, TABLE);
    rt.mem.write32(FRAME_CELL, c.frame ?? 0x100);
    CONTROL.cards = c.cards ?? [0, 1, 2];
}

function portHost(rt) {
    return {
        frameCounter() { return rt.mem.read32(FRAME_CELL) | 0; },
        cardIndexOf(i) { LOG.push(["cardIndex", i | 0]); return CONTROL.cards[i] ?? -1; },
        cardName(index) { LOG.push(["name", index | 0]); return RES_PTR; },
        packResolve(h) { LOG.push(["pack", h | 0]); return PACK_PTR; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        setScale(x, y, z) { LOG.push(["scale", x | 0, y | 0, z | 0]); },
        setPos(x, y) { LOG.push(["pos", x | 0, y | 0]); },
        setPaletteRow(n) { LOG.push(["palette", n | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
    };
}

function fields(rt) {
    const out = [];
    for (const off of [0x3b8, 0x3bc, 0x3c4, 0x3c8, 0x6c]) out.push(`${off.toString(16)}=${rt.mem.read32(OBJ + off) >>> 0}`);
    for (let i = 0; i < 6; i++) out.push(`c${i}=${rt.mem.read32(OBJ + i * 4 + 0x60) >>> 0}`);
    return out;
}

test("pauseItemsDraw matches F0x8008F8F0", () => {
    const rt = runtime();
    const cases = [
        { name: "empty", count: 0 },
        {
            name: "one row scaled", count: 1, scales: [0x1000, 0, 0], cards: [2, -1, -1],
            frame: 0x40, lastTick: 0x10, table: [[2 * 0x1c + 0, 5]],
        },
        {
            name: "one row unscaled", count: 1, scales: [0x800, 0, 0], cards: [1, -1, -1],
            frame: 0x100, lastTick: 0, table: [[1 * 0x1c + 4, 0x11]],
        },
        { name: "row zero", count: 1, scales: [0, 0, 0], cards: [0, -1, -1], frame: 0x100, lastTick: 0x100 },
        {
            name: "three rows", count: 3, scales: [0x1000, 0x800, 0x2000], cards: [0, 1, 2],
            frame: 0x100, lastTick: 0x100, rows: 4, cells: [1, 2, 3],
        },
        { name: "fixed blocks", count: 0, fixed404: 0x800, fixed424: 0x1000, fixed434: 0x400, fixed444: 0x900 },
        { name: "fixed at unity", count: 0, fixed404: 0x1000, fixed424: 0x1000, fixed434: 0x1000, fixed444: 0x1000, nameIndex: 2 },
        { name: "anim active", count: 0, fixed414: 0x800, animOn: 1, animFrame: 2, animTick: 0, frame: 0x10 },
        { name: "anim idle", count: 0, fixed414: 0x1000, animOn: 0 },
        { name: "badge active", count: 0, badgeOn: 0x800, badgeFrame: 5, badgeTick: 0, frame: 0x20, badgeRow: 2 },
        { name: "reseed resets on sentinel", count: 2, scales: [0x1000, 0x1000, 0], cards: [0, 1, -1], cells: [6, 2, 0], lastTick: 0, frame: 0x20, table: [[0 * 0x1c + 7 * 4, 0xffffffff]] },
        { name: "reseed boundary 13", count: 1, scales: [0x1000, 0, 0], cards: [0, -1, -1], cells: [1, 0, 0], frame: 0x20, lastTick: 0x13 },
        { name: "reseed boundary 12", count: 1, scales: [0x1000, 0, 0], cards: [0, -1, -1], cells: [1, 0, 0], frame: 0x20, lastTick: 0x14 },
        { name: "anim boundary 4", count: 0, fixed414: 1, animOn: 1, animFrame: 2, animTick: 0x0c, frame: 0x10 },
        { name: "anim boundary 3", count: 0, fixed414: 1, animOn: 1, animFrame: 2, animTick: 0x0d, frame: 0x10 },
        { name: "badge boundary 9", count: 0, badgeOn: 1, badgeFrame: 5, badgeTick: 0x07, frame: 0x10 },
        { name: "badge boundary 8", count: 0, badgeOn: 1, badgeFrame: 5, badgeTick: 0x08, frame: 0x10 },
    ];
    for (const c of cases) {
        seed(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x8008f8f0, [OBJ], 40000);
        const olog = LOG.slice();
        const ofields = fields(rt);

        seed(rt, c);
        LOG.length = 0;
        pauseItemsDraw(rt.mem, OBJ, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fields(rt), ofields, `${c.name}: fields`);
    }
});
