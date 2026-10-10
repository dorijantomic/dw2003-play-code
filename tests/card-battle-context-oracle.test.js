// Phase 4 oracle: engine/dw3/ui/card-battle-context.ts must match pro/cardgame
// F0x8009D310. The original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the resident task-object allocator
// stubbed at a fixed address, and the whole 0xF48-byte view is compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { CARD_BATTLE_STORES, createCardBattleContext } from "../engine/dw3/ui/card-battle-context.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ALLOC_STUB = 0x0fe40000;
const VIEW = 0x80180000;
const VIEW_WORDS = 0xf48 / 4;

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(ALLOC_STUB, (c) => {
        EVENTS.push(["alloc", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return VIEW;
    });
    rt.cpu.setStub(0x80014504, (c) => {
        EVENTS.push(["alloc", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return VIEW;
    });
    return rt;
}

const rt = runtime();

function seed() {
    EVENTS = [];
    for (let i = 0; i < VIEW_WORDS * 4; i += 4) rt.mem.write32(VIEW + i, 0xdeadbeef);
}

function view() {
    const out = [];
    for (let i = 0; i < VIEW_WORDS; i++) out.push(rt.mem.read32(VIEW + i * 4) >>> 0);
    return out;
}

function compare(label, parent) {
    seed();
    rt.cpu.call(0x8009d310, [parent]);
    const oEvents = EVENTS.map((e) => e.map((v) => v | 0));
    const oView = view();

    seed();
    const ret = createCardBattleContext(rt.mem, parent, {
        allocateView(handler, size, slot) {
            EVENTS.push(["alloc", handler >>> 0, size >>> 0, slot >>> 0]);
            return VIEW;
        },
    });
    assert.deepEqual(EVENTS.map((e) => e.map((v) => v | 0)), oEvents, `${label}: allocator call`);
    assert.deepEqual(view(), oView, `${label}: view`);
    assert.equal(ret >>> 0, VIEW >>> 0, `${label}: return`);
}

test("createCardBattleContext matches F0x8009D310", () => {
    compare("parent", 0x80123456);
    compare("zero parent", 0);
    compare("high parent", 0xdeadbeef);
});

test("the method table is the decoded 42-slot list", () => {
    assert.equal(CARD_BATTLE_STORES.length, 43);
    assert.equal(CARD_BATTLE_STORES.filter((s) => s.parent).length, 1);
    assert.equal(CARD_BATTLE_STORES.filter((s) => s.fn !== undefined).length, 42);
    const seen = new Set(CARD_BATTLE_STORES.map((s) => s.at));
    assert.equal(seen.size, CARD_BATTLE_STORES.length);
});
