// Phase 4 oracle: engine/dw3/ui/duel-scene-handler.ts must reproduce pro/cardgame's
// cardDuelSceneHandler. The original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with every far call and device boundary stubbed
// on both sides; the duel/scene/view/fade state, the ordered calls and the
// outcome counters are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { CARD_HELPER_CELL } from "../engine/dw3/ui/card-view.ts";
import {
    DUEL_OUTCOME_CELL,
    DUEL_SCENE_DONE,
    DUEL_SCENE_HANDLER_ENTRY,
    DUEL_SCENE_STATE,
    SAVE_BLOCK_BASE,
    cardDuelSceneHandler,
} from "../engine/dw3/ui/duel-scene-handler.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80194000;
const CTX = 0x80195000;
const HELPER = 0x80192000;
const SCRATCH = 0x80193000;
const PACK = 0x8019a000;
const INTRO = 0x8019b000;
const VIEW_HANDLER = 0x8009bba8;
const VIEW_SIZE = 0x0f48;
const VIEW_SLOT = 0x38;
const SET_STATE = 0x80014274;
const DRAWSYNC = 0x80025868;
const LOAD_IMAGE = 0x80025b14;
const ALLOC_CELL = 0x8004b5f4;
const FREE_CELL = 0x8004b5ec;
const ALLOC_STUB = 0x800190a0;
const FREE_STUB = 0x800190b0;
// the resident data pointers the handler calls through
const PTR_LOADER_BUSY = 0x8002043c;
const PTR_RESOURCE_GET_BASE = 0x80013e5c;
const PTR_RESOLVE_PACK = 0x800140d8;
const PTR_SFX = 0x8002006c;
const PTR_VOICE = 0x800202d4;
const PTR_LOAD_DECK = 0x8009d6e0;
const PTR_INTRO_THUNK = 0x8009d6b4;
const PTR_VIEW_SETUP = 0x8009c264;
const FADE_SPAN = 0x78;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** A one-record pack the uploader can walk: table[0] -> record, table[1] = 0. */
function seedPack(rt) {
    rt.mem.write32(PACK + 0x00, 0x10);
    rt.mem.write32(PACK + 0x04, 0x0);
    const record = PACK + 0x10;
    rt.mem.write32(record + 0x04, 0); // no CLUT
    const block = record + 0x08;
    rt.mem.write16(block + 0x08, 4);
    rt.mem.write16(block + 0x0a, 2);
    for (let i = 0; i < 8; i++) rt.mem.write8(block + 0x0c + i, 0x40 + i);
}

/** The far calls and device edges, stubbed on the original side. */
function stubOriginal(rt, events, rets) {
    rt.cpu.setStub(PTR_LOADER_BUSY, () => { events.push(["loaderBusy"]); return rets.busy | 0; });
    rt.cpu.setStub(PTR_RESOURCE_GET_BASE, (c) => {
        events.push(["resourceGetBase", c.reg(4) | 0]);
        return rets.resourceBase | 0;
    });
    rt.cpu.setStub(PTR_RESOLVE_PACK, (c) => {
        events.push(["resolvePack", c.reg(4) >>> 0]);
        return PACK;
    });
    rt.cpu.setStub(PTR_LOAD_DECK, (c) => {
        events.push(["loadOpponentDeck", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.cpu.setStub(PTR_INTRO_THUNK, () => { events.push(["createIntroVoice"]); return INTRO; });
    rt.cpu.setStub(PTR_VIEW_SETUP, (c) => { events.push(["setupView", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(PTR_SFX, (c) => { events.push(["playPackedSound", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(0x8009f910, (c) => { events.push(["updateFour", c.reg(4) >>> 0, c.reg(5) >>> 0]); return rets.four | 0; });
    rt.cpu.setStub(PTR_VOICE, (c) => { events.push(["voiceCommand", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(DRAWSYNC, (c) => { events.push(["drawSync", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(ALLOC_STUB, (c) => {
        events.push(["allocScratch", c.reg(4) | 0, c.reg(5) | 0]);
        return SCRATCH;
    });
    rt.cpu.setStub(FREE_STUB, (c) => { events.push(["free", c.reg(4) >>> 0]); return 0; });
    rt.cpu.setStub(LOAD_IMAGE, (c) => {
        const r = c.reg(4) >>> 0;
        events.push(["loadImage", rt.mem.read16(r) | 0, rt.mem.read16(r + 2) | 0,
            rt.mem.read16(r + 4) | 0, rt.mem.read16(r + 6) | 0, c.reg(5) >>> 0]);
        return 0;
    });
    rt.mem.write32(ALLOC_CELL, ALLOC_STUB);
    rt.mem.write32(FREE_CELL, FREE_STUB);
}

/** The same edges as the port's host. */
function portHost(rt, events, rets) {
    const core = (obj, state) => {
        rt.mem.write32(obj + 0xc, state | 0);
        rt.mem.write32(obj + 0x10, 0);
        rt.mem.write32(obj + 0x14, 0);
        rt.mem.write32(obj + 0x18, 0);
    };
    const unused = () => { throw new Error("scene handler reached an unexpected host edge"); };
    return {
        loaderBusy: () => { events.push(["loaderBusy"]); return rets.busy | 0; },
        resourceGetBase: (id) => { events.push(["resourceGetBase", id | 0]); return rets.resourceBase | 0; },
        resolvePack: (handle) => { events.push(["resolvePack", handle >>> 0]); return PACK; },
        loadOpponentDeck: (duel, ctx) => { events.push(["loadOpponentDeck", duel >>> 0, ctx >>> 0]); },
        createIntroVoice: () => { events.push(["createIntroVoice"]); return INTRO; },
        setupView: (view) => { events.push(["setupView", view >>> 0]); },
        playPackedSound: (value) => { events.push(["playPackedSound", value >>> 0]); },
        voiceCommand: (value) => { events.push(["voiceCommand", value >>> 0]); },
        drawSync: (v) => { events.push(["drawSync", v | 0]); },
        loadImage: (x, y, w, h, data) => { events.push(["loadImage", x | 0, y | 0, w | 0, h | 0, data >>> 0]); },
        allocScratch: (size, tag) => { events.push(["allocScratch", size | 0, tag | 0]); return SCRATCH; },
        free: (ptr) => { events.push(["free", ptr >>> 0]); },
        allocate: (handler, size, extra) => rt.world.alloc(handler >>> 0, size, extra, 0),
        allocateView: (handler, size, slot) => rt.world.alloc(handler >>> 0, size, slot, 0),
        helperBuffer: () => HELPER,
        setState: core,
        // the tick's six edges and the mode machine's nine are only reached in
        // state 1; the state-1 test seeds a mode that calls none of them
        applyQueuedGreyFlags: () => {},
        dispatchDuelViewQueue: () => {},
        runQueuedAnnounce: () => {},
        runEffectOpcode: () => {},
        fetchNextEffectOpcode: () => 0,
        saveRestoreEffectStepBlock: () => 0,
        enterFive: unused, enterEight: unused, enterNine: unused,
        updateTwo: unused, updateThree: unused,
        updateFour: (duel, ctx) => { events.push(["updateFour", duel >>> 0, ctx >>> 0]); return rets.four | 0; },
        updateFive: unused, updateSix: unused, updateEight: unused,
    };
}

function seed(rt, o = {}) {
    const obj = rt.world.alloc(DUEL_SCENE_HANDLER_ENTRY, 0x824, 0x1c, 0);
    for (let i = 0; i < 0x824; i++) rt.mem.write8(obj + i, 0);
    rt.mem.write32(obj + 0x28, SET_STATE);
    rt.mem.write32(obj + DUEL_SCENE_STATE, o.state ?? 0);
    rt.mem.write32(obj + DUEL_SCENE_DONE, o.done ?? 0);
    rt.mem.write8(obj + 0x2e8, o.byte2e8 ?? 7);
    rt.mem.write8(obj + 0x2e9, o.byte2e9 ?? 9);
    rt.mem.write32(obj + 0x2ec, o.index ?? 4);
    rt.mem.write8(obj + 0x302, o.flag302 ?? 0);
    rt.mem.write8(obj + 0x2f8, o.current ?? 0);
    rt.mem.write8(obj + 0x303, o.marker303 ?? 0);
    for (let i = 0; i < 0x20; i++) rt.mem.write8(CTX + i, 0);
    rt.mem.write32(SAVE_BLOCK_BASE + (o.index ?? 4) + DUEL_OUTCOME_CELL, o.counter ?? 0);
    rt.mem.write32(0x80048ac0, o.noDraw ?? 0xffffffff);
    seedPack(rt);
    return obj;
}

function sceneState(rt, obj, ctx) {
    const view = rt.mem.read32(ctx + 0x18) >>> 0;
    const fade = rt.mem.read32(ctx + 4) >>> 0;
    const out = {
        obj: [],
        ctx: [],
        // the view's parent slot (+0x50) and the two bytes the setup writes
        viewHead: [0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x5c, 0x5d, 0x5e, 0x5f]
            .map((off) => rt.mem.read8(view + off)),
        fade: [],
        noDraw: rt.mem.read32(0x80048ac0) >>> 0,
        counter: rt.mem.read8(SAVE_BLOCK_BASE + 4 + DUEL_OUTCOME_CELL),
        // the card-view helper's address is deliberately not compared: the
        // original uses its own stack buffer, the port a host-provided one; the
        // upload events and the helper's driven fields are compared instead
        helperCellSet: rt.mem.read32(CARD_HELPER_CELL) !== 0,
    };
    // the object's state head (the dispatch word, the done flag, the sub-steps)
    // and everything the state bodies touch
    for (let i = 0x0; i < 0x1c; i++) out.obj.push(rt.mem.read8(obj + i));
    for (let i = 0x2e0; i <= 0x310; i++) out.obj.push(rt.mem.read8(obj + i));
    for (let i = 0; i < 0x1c; i++) out.ctx.push(rt.mem.read8(ctx + i));
    for (let i = 0; i < FADE_SPAN; i++) out.fade.push(rt.mem.read8(fade + i));
    return out;
}

test("state 0 matches F0x800A2F00", () => {
    for (const o of [{ state: 0 }, { state: 4 }, { state: 0, busy: 0 }, { state: 0, byte2e8: 0, byte2e9: 0xff }]) {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, o);
        const objA = seed(a, o);
        a.cpu.call(DUEL_SCENE_HANDLER_ENTRY, [objA, CTX]);

        const evB = [];
        const b = runtime();
        const objB = seed(b, o);
        cardDuelSceneHandler(b.mem, portHost(b, evB, o), objB, CTX);

        assert.deepEqual(sceneState(b, objB, CTX), sceneState(a, objA, CTX), JSON.stringify(o));
        assert.deepEqual(evB, evA, JSON.stringify(o));
        // the outcome the state-0 path must produce
        assert.equal(a.mem.read32(objA + DUEL_SCENE_STATE) | 0, 2, "the object advanced to state 2");
        assert.equal(a.mem.read8(VIEW_LOCAL(a, CTX) + 0x5e), o.byte2e9 ?? 9);
        assert.equal(a.mem.read8(VIEW_LOCAL(a, CTX) + 0x5c), o.byte2e8 ?? 7);
    }
    // the loader gate stops the whole path
    for (const busy of [1, 2, 0xffffffff]) {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, { busy });
        const objA = seed(a, {});
        a.cpu.call(DUEL_SCENE_HANDLER_ENTRY, [objA, CTX]);
        const b = runtime();
        const objB = seed(b, {});
        cardDuelSceneHandler(b.mem, portHost(b, [], { busy }), objB, CTX);
        assert.deepEqual(sceneState(b, objB, CTX), sceneState(a, objA, CTX), `busy ${busy}`);
        assert.deepEqual(evA, [["loaderBusy"]], "only the gate ran");
    }
});

function VIEW_LOCAL(rt, ctx) {
    return rt.mem.read32(ctx + 0x18) >>> 0;
}

test("state 1 matches F0x800A2F00", () => {
    // the tick returns 0 (nothing to do), so the reverse fade is not built
    const evA = [];
    const a = runtime();
    stubOriginal(a, evA, {});
    const objA = seed(a, { state: 1 });
    a.cpu.call(DUEL_SCENE_HANDLER_ENTRY, [objA, CTX]);
    const evB = [];
    const b = runtime();
    const objB = seed(b, { state: 1 });
    cardDuelSceneHandler(b.mem, portHost(b, evB, {}), objB, CTX);
    assert.deepEqual(sceneState(b, objB, CTX), sceneState(a, objA, CTX));
    assert.equal(a.mem.read8(objA + 0x303), 0, "the marker is untouched when the tick is not finished");

    // the finished path: mode 4's update returns 2, so the shipped mode machine
    // reports 1 and this handler builds the reverse fade and marks +0x303
    for (const ret of [2, 3]) {
        const evA2 = [];
        const a2 = runtime();
        stubOriginal(a2, evA2, { four: ret });
        const objA2 = seed(a2, { state: 1, current: 4 });
        const fadeA2 = createFade(a2, objA2);
        a2.cpu.call(DUEL_SCENE_HANDLER_ENTRY, [objA2, CTX]);

        const evB2 = [];
        const b2 = runtime();
        const objB2 = seed(b2, { state: 1, current: 4 });
        createFade(b2, objB2);
        cardDuelSceneHandler(b2.mem, portHost(b2, evB2, { four: ret }), objB2, CTX);

        assert.deepEqual(sceneState(b2, objB2, CTX), sceneState(a2, objA2, CTX), `state 1 finished ret ${ret}`);
        assert.equal(a2.mem.read8(objA2 + 0x303), 1, "the marker is set on the finished path");
        assert.equal(a2.mem.read32(objA2 + 0x10) | 0, 0, "the done flag stays clear on the tick path");
        assert.notEqual(a2.mem.read32(CTX + 4) >>> 0, fadeA2 >>> 0, "a new fade object replaced the old one");
    }
});

test("states 2 and 3 match F0x800A2F00", () => {
    // state 2 needs a fade object at ctx+4; build one the same way both sides do
    const CASES = [
        { marker303: 0 },
        { marker303: 1 },
        { marker303: 2, flag302: 0, counter: 0 },
        // markers other than 0 and the object's own state word take the outcome
        // path: the save-block counter increments up to its cap
        { marker303: 1, flag302: 0, counter: 0 },
        { marker303: 1, flag302: 0, counter: 0x62 },
        { marker303: 1, flag302: 0, counter: 0x63 },
        { marker303: 1, flag302: 1, counter: 5 },
        { marker303: 3, flag302: 1, counter: 5 },
    ];
    for (const tc of CASES) {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, tc);
        const objA = seed(a, { ...tc, state: 2 });
        const fadeA = createFade(a, objA);
        assert.equal(a.mem.read32(fadeA + 0x50) | 0, 0, "the fresh wash is idle");
        a.cpu.call(DUEL_SCENE_HANDLER_ENTRY, [objA, CTX]);

        const evB = [];
        const b = runtime();
        const objB = seed(b, { ...tc, state: 2 });
        createFade(b, objB);
        cardDuelSceneHandler(b.mem, portHost(b, evB, tc), objB, CTX);

        assert.deepEqual(sceneState(b, objB, CTX), sceneState(a, objA, CTX), `state 2 ${JSON.stringify(tc)}`);
        assert.deepEqual(evB, evA, `state 2 ${JSON.stringify(tc)} calls`);
        // and the done flag / marker the case implies
        if (tc.marker303 === 0) assert.equal(a.mem.read32(objA + DUEL_SCENE_DONE) | 0, 1, "done after the restart arm");
        else assert.equal(a.mem.read8(objA + 0x303), 2, "the marker reached 2");
    }
    // state 3: the voice command depends on +0x302
    for (const flag302 of [0, 1]) {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, { flag302 });
        const objA = seed(a, { state: 3, flag302 });
        a.cpu.call(DUEL_SCENE_HANDLER_ENTRY, [objA, CTX]);
        const evB = [];
        const b = runtime();
        const objB = seed(b, { state: 3, flag302 });
        cardDuelSceneHandler(b.mem, portHost(b, evB, { flag302 }), objB, CTX);
        assert.deepEqual(evB, evA, `state 3 flag ${flag302}`);
        assert.deepEqual(sceneState(b, objB, CTX), sceneState(a, objA, CTX));
    }
});

/**
 * Builds the ctx+4 fade the state-2 path reads, using the shipped creator so
 * both sides get an identical object.
 */
function createFade(rt, obj) {
    const fade = rt.world.alloc(0x800a35bc, 0x78, 4, 0);
    for (let i = 0; i < 0x78; i++) rt.mem.write8(fade + i, 0);
    rt.mem.write32(fade + 0x68, 0x800a3548);
    rt.mem.write32(fade + 0x6c, 0x800a3558);
    rt.mem.write32(fade + 0x70, 0x800a35a4);
    rt.mem.write32(fade + 0x74, 0x800a35b0);
    rt.mem.write32(CTX + 4, fade);
    void obj;
    return fade;
}
