// Phase 4 oracle: engine/dw3/ui/shop-effects-draw.ts shopEffectsCardDraw must
// emit the same ordered draw intents and make the same roster/can-equip calls as
// the original F0x8008A450. The original runs through engine/native's draw-intent
// recorder; the port through an equivalent recorder. packGetEntry, the roster
// accessor and the can-equip predicate are shared stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopEffectsCardDraw } from "../engine/dw3/ui/shop-effects-draw.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stitshop = new Uint8Array(readFileSync(join(dir, "pro_stitshop.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stitshop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const BAND_A = 0x80180000;
const BAND_B = 0x80181000;
const PACK_STUB = 0x0fd40000;
const ROSTER_STUB = 0x0fd40010;
const CANEQUIP_STUB = 0x0fd40020;
const PACK_PTR = new Map([[0x04020000, 0x80190000], [0x02860000, 0x80190010]]);
const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };

function runtime() {
    const rt = new NativeStageRuntime(stitshop, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(PACK_STUB, (c) => PACK_PTR.get(c.reg(4) >>> 0) ?? 0);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(ROSTER_STUB, (c) => { CALLS.push(["roster", c.reg(4) | 0]); return ROSTER(c.reg(4) | 0); });
    rt.mem.write32(0x8004b44c, ROSTER_STUB);
    rt.cpu.setStub(CANEQUIP_STUB, (c) => {
        CALLS.push(["canEquip", c.reg(4) | 0, c.reg(5) | 0]);
        return CANEQUIP(c.reg(4) | 0, c.reg(5) | 0);
    });
    rt.mem.write32(0x8008d1cc, CANEQUIP_STUB);
    return rt;
}

let CALLS = [];
let ROSTER = () => 0;
let CANEQUIP = () => 0;

function norm(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function fixture(band, o) {
    for (let i = 0; i < 0x300; i += 4) rt.mem.write32(band + i, 0);
    rt.mem.write32(band + 0x50, o.layer ?? 0x1000);
    rt.mem.write32(band + 0x54, o.bucket ?? 4);
    rt.mem.write32(band + 0x60, o.members ?? 0);
    rt.mem.write32(band + 0x1e4, o.itemId ?? 0x1005);
    rt.mem.write32(band + 0x20c, o.foldLeft ?? 0);
    rt.mem.write32(band + 0x22c, o.foldCards ?? 0);
    const records = o.records ?? [];
    for (let m = 0; m < records.length; m++) {
        const rec = band + 0xc0 + 0x80 * m;
        rt.mem.write32(rec, records[m].length);
        for (let i = 0; i < records[m].length; i++) rt.mem.write32(rec + 4 + 4 * i, records[m][i]);
    }
}

const rt = runtime();

function runCase(label, o) {
    ROSTER = (i) => (o.roster ?? [0, 1, 2])[i] ?? 0;
    CANEQUIP = (slot) => (o.canEquip ?? (() => 1))(slot);
    fixture(BAND_A, o);
    fixture(BAND_B, o);
    const before = rt.drawCalls.length;
    CALLS = [];
    rt.cpu.call(0x8008a450, [BAND_A, 0]);
    const oracleIntents = norm(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleCalls = CALLS.slice();

    CALLS = [];
    const portIntents = [];
    const portHost = {
        initDrawContext() {},
        setLayer(t, b) { portIntents.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { portIntents.push(["setOrigin", [x, y, 0, 0]]); },
        setScale(x, y, z) { portIntents.push(["setScale", [x, y, z, 0]]); },
        setPos(x, y) { portIntents.push(["setPos", [x, y, 0, 0]]); },
        drawSprite(p, c, x, y) { portIntents.push(["drawSprite", [p, c, x, y]]); },
        packResolve(h) { return PACK_PTR.get(h >>> 0) ?? 0; },
        rosterSlot(position) { CALLS.push(["roster", position | 0]); return ROSTER(position | 0); },
        canEquip(slot, itemId) { CALLS.push(["canEquip", slot | 0, itemId | 0]); return CANEQUIP(slot | 0); },
    };
    shopEffectsCardDraw(rt.mem, BAND_B, portHost);

    assert.deepEqual(norm(portIntents), oracleIntents, `${label}: intents`);
    assert.deepEqual(CALLS, oracleCalls, `${label}: roster/can-equip calls`);
}

test("shopEffectsCardDraw matches F0x8008A450", () => {
    runCase("no folds", {});
    runCase("prompt open", { foldLeft: 0x1000 });
    runCase("prompt partial", { foldLeft: 0x800 });
    runCase("cards open no members", { foldCards: 0x1000, members: 0 });
    runCase("cards open two members", {
        foldCards: 0x1000, members: 2,
        records: [[5, 0, 7], [0, 9]],
        canEquip: (slot) => (slot === 1 ? 1 : 0),
    });
    runCase("cards partial", { foldCards: 0x800, members: 2, records: [[5], [9]] });
    runCase("cards open zero icons", { foldCards: 0x1000, members: 1, records: [[]], canEquip: () => 1 });
    runCase("both folds open", {
        foldLeft: 0x1000, foldCards: 0x1000, members: 3,
        records: [[5, 6], [7], [0, 0, 8]],
        canEquip: (slot) => (slot === 0 ? 1 : 0),
    });
});
