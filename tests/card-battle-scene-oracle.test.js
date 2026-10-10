// Phase 4 oracle: engine/dw3/ui/card-battle-scene.ts must reproduce pro/cardgame's
// card-battle screen object (F0x80095BFC) and its factory thunk (F0x80095E2C).
//
// The originals run through engine/native on the shipped pro_cardgame.bin +
// resident.bin with the device and service edges stubbed on both sides, and the
// display service, the upload helper, the two artwork packs, the created duel
// object and the ordered boundary calls are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    DISPLAY_ALLOC_ZEROED,
    DISPLAY_HEAP_ALLOC,
    DISPLAY_SERVICE,
    DISPLAY_SERVICE_INIT_FLAG,
} from "../engine/dw3/display-service.ts";
import {
    AUDIO_ARCHIVE_TABLE,
    AUDIO_CHANNEL_BASE,
    AUDIO_CHANNEL_STRIDE,
    AUDIO_REQUEST_CHANNEL,
    AUDIO_REQUEST_DESCRIPTOR,
    AUDIO_REQUEST_PENDING,
    AUDIO_TOGGLE,
} from "../engine/dw3/audio-archive.ts";
import {
    CARD_BATTLE_SCENE_CTOR,
    CARD_BATTLE_SCENE_ENTRY,
    CARD_BATTLE_SCENE_EXTRA,
    CARD_BATTLE_SCENE_SIZE,
    CARD_BATTLE_SCENE_STATE,
    CARD_BATTLE_SCENE_SUB,
    createCardBattleScene,
    cardBattleSceneTick,
} from "../engine/dw3/ui/card-battle-scene.ts";
import { DUEL_OUTCOME_STATE } from "../engine/dw3/ui/duel-scene-handler.ts";
import { DUEL_SELECTOR } from "../engine/dw3/ui/duel-create.ts";
import { CARD_HELPER_CELL } from "../engine/dw3/ui/card-view.ts";
import { CARD_BATTLE_RECT } from "../engine/dw3/ui/card-battle-scene.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TICK = CARD_BATTLE_SCENE_ENTRY;
const CTOR = CARD_BATTLE_SCENE_CTOR;
const OBJ = 0x80194000;
const OUT = 0x80194500;
const HELPER = 0x80192000;
const ENV_SCRATCH = 0x80192100;
const ARENA = 0x80100000;
const ARENA_END = 0x80190000;
const CONTROLLER = 0x80191800;
const DUEL_BYTES = 0x40;

// boundary stubs shared by both sides
const ALLOC = 0x80014504;
const RESOLVE_CELL = 0x80044f5c;
const SHOP_CELL = 0x8004b43c;
const ACQUIRE_CELL = 0x80044f44;
const HEAP_ALLOC = DISPLAY_HEAP_ALLOC;
const HEAP_ALLOC_HIGH = DISPLAY_HEAP_ALLOC + 4;
const HEAP_ALLOC_STUB = 0x0fe50400;
const HEAP_ZEROED_STUB = 0x0fe50410;
const FREE_CELL = 0x8004b5ec;
const CLEAR_OT = 0x80025d54;
const GS_INIT = 0x8002990c;
const SET_GEOM = 0x8002b3ec;
const LOAD_IMAGE = 0x80025b14;
const DRAW_SYNC = 0x80025868;
const VOICE_DEV = 0x800335b4;
const PROGRAM_DEV = 0x8003058c;
const SLOT_DEV = 0x80037dcc;
const RESOLVE_STUB = 0x0fe50300;
const SHOP_STUB = 0x0fe50310;
const ACQUIRE_STUB = 0x0fe50320;
const FREE_STUB = 0x0fe50330;
const OBJ_METHODS = [0x28, 0x38, 0x3c];
const OBJ_STUB = [0x0fe50340, 0x0fe50350, 0x0fe50360];
const ORDINAL_QUERY_CELL = 0x80048d34 + 0x2704;
const ORDINAL_SET_CELL = 0x80048d34 + 0x270c;
const ORDINAL_QUERY_STUB = 0x0fe50370;
const ORDINAL_SET_STUB = 0x0fe50380;
const SAVED_SELECTOR_CELL = 0x80048d34 + 0x34;
const PACK_A = 0x8019a000;
const PACK_B = 0x8019b000;
const DESCRIPTORS = 0x80172000;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** One record the pack uploader can walk: no CLUT, a 4x2 block. */
function seedPack(mem, pack, tag) {
    mem.write32(pack + 0x00, 0x10);
    mem.write32(pack + 0x04, 0x0);
    const record = pack + 0x10;
    mem.write32(record + 0x04, tag);
    const block = record + 0x08;
    mem.write16(block + 0x08, 4);
    mem.write16(block + 0x0a, 2);
    for (let i = 0; i < 8; i++) mem.write8(block + 0x0c + i, 0x40 + i);
}

/**
 * Every edge both sides need: a deterministic arena for the two allocators, a
 * device log, the pack/shop/ordinal cells, and the archive the duel constructor
 * asks for.
 */
function scenario(rt, events, o = {}) {
    let arena = ARENA;
    const bump = (size, zero) => {
        const n = size >>> 0;
        const p = arena;
        arena += (n + 0xf) & ~0xf;
        assert.ok(arena < ARENA_END, "the scenario arena ran out");
        if (zero) for (let a = p; a < p + n; a += 4) rt.mem.write32(a, 0);
        return p;
    };
    rt.cpu.setStub(ALLOC, (c) => {
        events.push(["alloc", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return rt.world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0);
    });
    // The original reaches two different allocator cells: 0x8004B5F8 (the packet
    // buffers, F0x80017EEC) and 0x8004B5F4 (the ordering tables, F0x80017E84).
    // Both take the same arena here so the two sides allocate identically.
    const heapAlloc = (c) => bump(c.reg(4), false);
    rt.cpu.setStub(HEAP_ALLOC_STUB, heapAlloc);
    rt.mem.write32(HEAP_ALLOC, HEAP_ALLOC_STUB);
    rt.mem.write32(HEAP_ALLOC_HIGH, HEAP_ALLOC_STUB);
    rt.cpu.setStub(HEAP_ZEROED_STUB, (c) => bump(c.reg(4), true));
    rt.mem.write32(DISPLAY_ALLOC_ZEROED, HEAP_ZEROED_STUB);
    rt.cpu.setStub(FREE_STUB, (c) => { events.push(["free", c.reg(4) >>> 0]); return 0; });
    rt.mem.write32(FREE_CELL, FREE_STUB);
    rt.cpu.setStub(CLEAR_OT, (c) => {
        events.push(["clearOTag", c.reg(4) >>> 0, c.reg(5) | 0]);
        return 0;
    });
    rt.cpu.setStub(GS_INIT, () => { events.push(["gsInit3D"]); return 0; });
    rt.cpu.setStub(SET_GEOM, (c) => { events.push(["setGeomOffset", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(LOAD_IMAGE, (c) => {
        const r = c.reg(4) >>> 0;
        events.push(["loadImage", rt.mem.read16(r) | 0, rt.mem.read16(r + 2) | 0,
            rt.mem.read16(r + 4) | 0, rt.mem.read16(r + 6) | 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(DRAW_SYNC, (c) => { events.push(["drawSync", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(RESOLVE_STUB, (c) => {
        events.push(["resolvePack", c.reg(4) >>> 0]);
        return (c.reg(4) >>> 0) === 0x025d0001 ? PACK_B : PACK_A;
    });
    rt.mem.write32(RESOLVE_CELL, RESOLVE_STUB);
    rt.cpu.setStub(SHOP_STUB, () => { events.push(["getCurrentShopId"]); return o.shopId ?? 7; });
    rt.mem.write32(SHOP_CELL, SHOP_STUB);
    for (let i = 0; i < OBJ_METHODS.length; i++) {
        rt.cpu.setStub(OBJ_STUB[i], (c) => {
            // the factory's advance/sub-advance take no argument: the original
            // never sets a1 for them, so only the set-state call carries one
            const args = ["objMethod", OBJ_METHODS[i], c.reg(4) >>> 0];
            if (OBJ_METHODS[i] === 0x28) args.push(c.reg(5) | 0);
            events.push(args);
            if (OBJ_METHODS[i] === 0x38) rt.mem.write32(OBJ + CARD_BATTLE_SCENE_STATE, 1);
            return 0;
        });
        rt.mem.write32(OBJ + OBJ_METHODS[i], OBJ_STUB[i]);
        // the duel the state-1 arm reaches through its own +0x28 carries the
        // same factory method table
        rt.mem.write32(CONTROLLER + OBJ_METHODS[i], OBJ_STUB[i]);
    }
    rt.cpu.setStub(ORDINAL_QUERY_STUB, (c) => { events.push(["ordinalQuery", c.reg(4) | 0]); return o.ordinal ?? 0; });
    rt.mem.write32(ORDINAL_QUERY_CELL, ORDINAL_QUERY_STUB);
    rt.cpu.setStub(ORDINAL_SET_STUB, (c) => {
        events.push(["requestTransition", c.reg(4) | 0, c.reg(5) | 0]);
        return 0;
    });
    rt.mem.write32(ORDINAL_SET_CELL, ORDINAL_SET_STUB);
    rt.mem.write32(SAVED_SELECTOR_CELL, o.savedSelector ?? 0x0e5);
    // the archive createCardDuel's last step asks for
    rt.cpu.setStub(ACQUIRE_STUB, (c) => { events.push(["acquire", c.reg(4) | 0]); return 0; });
    rt.mem.write32(ACQUIRE_CELL, ACQUIRE_STUB);
    rt.cpu.setStub(VOICE_DEV, (c) => { events.push(["voice", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(PROGRAM_DEV, (c) => { events.push(["program", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(SLOT_DEV, (c) => { events.push(["slot", c.reg(4) | 0]); return 0; });
    const desc = DESCRIPTORS + 0x40;
    rt.mem.write32(desc + 0x4, 0x250d);
    rt.mem.write32(AUDIO_ARCHIVE_TABLE + 0x27 * 4, desc);
    for (let i = 0; i < 2; i++) {
        const rec = AUDIO_CHANNEL_BASE + i * AUDIO_CHANNEL_STRIDE;
        for (let j = 0; j < AUDIO_CHANNEL_STRIDE; j += 4) rt.mem.write32(rec + j, 0);
    }
    rt.mem.write32(AUDIO_TOGGLE, 0);
    rt.mem.write32(AUDIO_REQUEST_DESCRIPTOR, 0);
    rt.mem.write32(AUDIO_REQUEST_PENDING, 0);
    rt.mem.write16(AUDIO_REQUEST_CHANNEL, 0);
    seedPack(rt.mem, PACK_A, 0x11111111);
    seedPack(rt.mem, PACK_B, 0x22222222);
    return {
        releaseView: (handle) => events.push(["releaseView", handle >>> 0]),
        alloc: (size) => bump(size, false),
        allocZeroed: (size) => bump(size, true),
        clearOTag: (base, n) => { events.push(["clearOTag", base >>> 0, n | 0]); },
        gsInit3D: () => { events.push(["gsInit3D"]); },
        setGeomOffset: (x, y) => { events.push(["setGeomOffset", x | 0, y | 0]); },
        loadImage: (x, y, w, h, data) => { events.push(["loadImage", x | 0, y | 0, w | 0, h | 0, data >>> 0]); },
        allocScratch: (size, tag) => bump(size, false),
        free: (ptr) => { events.push(["free", ptr >>> 0]); },
        drawSync: () => { events.push(["drawSync", 0]); },
        allocate: (h, size, extra) => {
            events.push(["alloc", h >>> 0, size | 0, extra | 0]);
            return rt.world.alloc(h >>> 0, size, extra, 0);
        },
        releaseVoice: (e, i) => events.push(["voice", e | 0, i | 0]),
        closeProgram: (e) => events.push(["program", e | 0]),
        releaseVabSlot: (s) => events.push(["slot", s | 0]),
        acquire: (fileId) => events.push(["acquire", fileId | 0]),
        resolvePack: (handle) => { events.push(["resolvePack", handle >>> 0]); return handle >>> 0 === 0x025d0001 ? PACK_B : PACK_A; },
        getCurrentShopId: () => { events.push(["getCurrentShopId"]); return o.shopId ?? 7; },
        helperBuffer: () => HELPER,
        drawEnvScratch: () => ENV_SCRATCH,
        setState: (obj, state) => events.push(["objMethod", 0x28, obj >>> 0, state | 0]),
        advancePhase: (obj) => {
            events.push(["objMethod", 0x38, obj >>> 0]);
            rt.mem.write32(obj + CARD_BATTLE_SCENE_STATE, 1);
        },
        advanceSub: (obj) => events.push(["objMethod", 0x3c, obj >>> 0]),
        ordinalQuery: (what) => { events.push(["ordinalQuery", what | 0]); return o.ordinal ?? 0; },
        requestTransition: (value, arg) => events.push(["requestTransition", value | 0, arg | 0]),
        // the two CardViewHost members the uploader never reaches
        resourceGetBase: () => { throw new Error("resourceGetBase reached"); },
        findRegisteredHandleByKey: () => { throw new Error("findRegisteredHandleByKey reached"); },
        callViewMethod: () => { throw new Error("callViewMethod reached"); },
    };
}

function bytes(mem, base, len) {
    const out = [];
    for (let i = 0; i < len; i++) out.push(mem.read8(base + i));
    return out;
}

/** Everything the setup may write: the object, the out slot, the helper, the
 *  display service, the registered view, the duel's head and the arena. */
function state(rt, events) {
    const viewSlot = rt.mem.read32(DISPLAY_SERVICE + 0x60) >>> 0;
    return {
        obj: bytes(rt.mem, OBJ, 0x60),
        out: rt.mem.read32(OUT) >>> 0,
        // the helper's address is not compared on purpose: the original builds it
        // on its own stack, the port on a host-provided buffer. Its driven fields
        // and every upload are compared instead (the cell plus the events below).
        helperCell: rt.mem.read32(CARD_HELPER_CELL) !== 0,
        service: bytes(rt.mem, DISPLAY_SERVICE, 0x1d8),
        // the view: its 0x1C-byte DRAWENV (every byte setDefDrawEnv writes) and
        // everything from +0x5C up (the constructor's own fields). The bytes
        // between are initDisplayView's copy of the caller's scratch *beyond* the
        // env — uninitialised stack in the original, so they are not compared.
        view: viewSlot === 0 ? [] : [...bytes(rt.mem, viewSlot, 0x1c), ...bytes(rt.mem, viewSlot + 0x5c, 0x16c - 0x5c)],
        duel: rt.mem.read32(OUT) === 0 ? [] : bytes(rt.mem, rt.mem.read32(OUT) >>> 0, DUEL_BYTES),
        events,
    };
}

function seedCommon(rt, o = {}) {
    // the object's head only: +0x28/+0x38/+0x3C hold the scenario's method stubs
    for (let i = 0; i < 0x28; i++) rt.mem.write8(OBJ + i, 0);
    rt.mem.write32(OBJ + CARD_BATTLE_SCENE_STATE, o.state ?? 0);
    rt.mem.write32(OBJ + CARD_BATTLE_SCENE_SUB, o.sub ?? 0);
    rt.mem.write32(OUT, o.duel ?? 0);
    for (let i = 0; i < 0x34; i++) rt.mem.write8(HELPER + i, 0x5a);
    for (let i = 0; i < 0x5c; i++) rt.mem.write8(ENV_SCRATCH + i, 0);
    // the original builds its 0x5C DRAWENV on its own stack, and the port on
    // ENV_SCRATCH; zero both so the bytes setDefDrawEnv does not write agree
    for (let a = 0x801ff000; a < 0x801ffffc; a += 4) rt.mem.write32(a, 0);
    // the service's state and view slots, but NOT its method cells: +0x150.. hold
    // the shipped function pointers the original calls through
    for (let i = 0; i < 0x150; i++) rt.mem.write8(DISPLAY_SERVICE + i, 0);
    for (let i = 0; i < 0x18; i++) rt.mem.write8(DISPLAY_SERVICE + 0x20 + i, 0x7e);
    rt.mem.write32(DISPLAY_SERVICE_INIT_FLAG, 1);
    rt.mem.write32(CONTROLLER, o.controller ?? 0);
    // the duel the state-1 arm looks at: its head is cleared but its own
    // method cells (+0x28/+0x38/+0x3C) keep the scenario's stubs
    const duel = CONTROLLER;
    for (let i = 0; i < 0x28; i++) rt.mem.write8(duel + i, 0);
    rt.mem.write8(duel + DUEL_OUTCOME_STATE, o.duelState ?? 0);
    rt.mem.write32(OBJECT_DUEL_SLOT, duel);
}
const OBJECT_DUEL_SLOT = OUT;

test("the setup (state 0) matches F0x80095BFC", () => {
    for (const tc of [{}, { shopId: 0 }, { shopId: 0xff }]) {
        const evA = [];
        const a = runtime();
        const aHooks = scenario(a, evA, tc);
        seedCommon(a, { duel: CONTROLLER });
        a.cpu.call(TICK, [OBJ, OUT]);

        const evB = [];
        const b = runtime();
        const bHooks = scenario(b, evB, tc);
        seedCommon(b, { duel: CONTROLLER });
        cardBattleSceneTick(b.mem, bHooks, OBJ, OUT);

        assert.deepEqual(state(b, evB), state(a, evA), JSON.stringify(tc));
        assert.notEqual(a.mem.read32(OUT) >>> 0, CONTROLLER, "the caller's slot now holds the created duel");
        assert.equal(a.mem.read8((a.mem.read32(OUT) >>> 0) + DUEL_SELECTOR), (tc.shopId ?? 7) & 0xff,
            "the created duel carries the shop id");
        // the port's helper carries the fields the original's would: the last
        // destination pair, the last uploaded block's size and the scratch size
        // the second pack's pair starts at 0x340 and the uploader advances it by
        // 0x40 for the one record the seeded pack holds
        assert.equal(b.mem.read32(HELPER + 0x08) >>> 0, 0x380, "pair x");
        assert.equal(b.mem.read32(HELPER + 0x0c) >>> 0, 0, "pair y");
        assert.equal(b.mem.read16(HELPER + 0x00), 4, "the last block's width");
        assert.equal(b.mem.read16(HELPER + 0x02), 2, "the last block's height");
        assert.equal(b.mem.read32(HELPER + 0x18) >>> 0, 0xa800, "the helper's scratch size");
        void aHooks;
    }
});

test("the handover states match F0x80095BFC", () => {
    const CASES = [
        { state: 1, duelState: 0 },
        { state: 1, duelState: 1 },
        { state: 1, duelState: 2 },
        { state: 1, duelState: 2, controller: 0xdeadbeef },
        { state: 2, sub: 0, ordinal: 0 },
        { state: 2, sub: 0, ordinal: 0xf },
        { state: 2, sub: 1, ordinal: 0 },
        { state: 2, sub: 1, ordinal: 1 },
        { state: 3 },
        { state: 4 },
    ];
    for (const tc of CASES) {
        const evA = [];
        const a = runtime();
        scenario(a, evA, tc);
        seedCommon(a, tc);
        a.cpu.call(TICK, [OBJ, OUT]);

        const evB = [];
        const b = runtime();
        const bHooks = scenario(b, evB, tc);
        seedCommon(b, tc);
        cardBattleSceneTick(b.mem, bHooks, OBJ, OUT);

        assert.deepEqual(state(b, evB), state(a, evA), JSON.stringify(tc));
    }
});

test("createCardBattleScene matches F0x80095E2C", () => {
    const evA = [];
    const a = runtime();
    const allocs = [];
    a.cpu.setStub(ALLOC, (c) => {
        allocs.push([c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
        return a.world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0);
    });
    const objA = a.cpu.call(CTOR, []) >>> 0;

    const evB = [];
    const b = runtime();
    const objB = createCardBattleScene({
        allocate: (h, size, extra) => b.world.alloc(h >>> 0, size, extra, 0),
    }) >>> 0;

    assert.equal(objB, objA, "the same object address");
    assert.deepEqual(allocs, [[CARD_BATTLE_SCENE_ENTRY, CARD_BATTLE_SCENE_SIZE, CARD_BATTLE_SCENE_EXTRA]]);
    void evA; void evB;
});
