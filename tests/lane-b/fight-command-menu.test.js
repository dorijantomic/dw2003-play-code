// Lane B Phase 4 oracle: engine/dw3/ui/native/fight-command-menu.ts must match
// the original pro/fightstg battle command menu family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the text-widget constructor, the resource/pack services, the pad,
// the sound, the frame delta, the draw context and every object method are
// stubbed on both sides so the ordered calls and fields can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    commandMenuActorConstruct,
    commandMenuActorTick,
    commandMenuBuildNames,
    commandMenuCreate,
    commandMenuDraw,
    commandMenuStateMachine,
    jokeMenuActorConstruct,
    jokeMenuBuildNames,
} from "../../engine/dw3/ui/native/fight-command-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const ARGSLOT = 0x80161000;
const LIST = 0x80162000;
const ACTOR = 0x80170000;
const MENU = 0x80172000;
const WIDGET_BASE = 0x80180000;
const RES_PTR = 0x80190000;
const PACK_PTR = 0x80191000;

const CONFIG = 0x800a34cc;
const JOKE_CONFIG = 0x800a3634;
const JOKE_PERM = 0x800a3624;
const STRING_BASE = 0x8005cca8;
const FLAGS_BASE = 0x800a4460;
const FLAGS_INDEX = 0x800a4468;
const TIME_OBJECT = 0x8004de10;
const FRAME_PTR = 0x8004de10 + 0x18c;

const CREATE_FN = 0x8001ae38;
const PAD_A_PTR = 0x8004b7d0 + 0x3f4;
const PAD_B_PTR = 0x8004b7d0 + 0x3fc;
const RESOURCE_PTR = 0x80044f4c;
const PACK_PTR_CELL = 0x80044f5c;
const ALLOC_FN = 0x80014504;

const ALLOC_STUB = 0x0fdd0000;
const CREATE_STUB = 0x0fdd0004;
const PAD_A_STUB = 0x0fdd000c;
const PAD_B_STUB = 0x0fdd0010;
const RESOURCE_STUB = 0x0fdd0014;
const PACK_STUB = 0x0fdd0018;
const FRAME_STUB = 0x0fdd001c;
const SLOT_BASE = 0x0fdd1000;

const SLOT_ARITY = { 0x28: 1, 0x38: 0, 0x3c: 0, 0x114: 2, 0x138: 1 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
const CONTROL = { alloc: ACTOR, padConfirm: 0, padA: 0, padB: 0, frame: 3 };
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
        rt.mem.write32(widget + 0x114, SLOT_BASE + 0x114);
        rt.mem.write32(widget + 0x138, SLOT_BASE + 0x138);
        return widget;
    });
    rt.cpu.setStub(PAD_A_STUB, (c) => { LOG.push(["padA", c.reg(4) | 0]); return CONTROL.padA; });
    rt.cpu.setStub(PAD_B_STUB, (c) => { LOG.push(["padB", c.reg(4) | 0]); return CONTROL.padB; });
    rt.cpu.setStub(RESOURCE_STUB, (c) => { LOG.push(["resource", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(FRAME_STUB, () => { LOG.push(["frame"]); return CONTROL.frame; });
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

    rt.mem.write32(PAD_A_PTR, PAD_A_STUB);
    rt.mem.write32(PAD_B_PTR, PAD_B_STUB);
    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB);
    rt.mem.write32(PACK_PTR_CELL, PACK_STUB);
    rt.mem.write32(FRAME_PTR, FRAME_STUB);
    return rt;
}

function seedObj(rt, c) {
    for (let i = 0; i < 0x500; i += 4) rt.mem.write32(OBJ + i, 0);
    rt.mem.write32(OBJ + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(OBJ + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(OBJ + 0x3c, SLOT_BASE + 0x3c);
    rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
    rt.mem.write32(OBJ + 0x10, c.sub ?? 0);
    rt.mem.write32(OBJ + 0x24, LIST);
    rt.mem.write32(OBJ + 0x50, c.selection ?? 0);
    rt.mem.write32(OBJ + 0x54, c.obj54 ?? 0);
    rt.mem.write32(OBJ + 0x58, c.count ?? 0);
    rt.mem.write32(OBJ + 0x68, c.sprite ?? 0xffffffff);
    rt.mem.write32(OBJ + 0x6c, c.x ?? 0);
    rt.mem.write32(OBJ + 0x70, c.y ?? 0);
    rt.mem.write32(OBJ + 0x74, c.step ?? 0);
    for (let i = 0; i < 0xc0; i += 4) rt.mem.write32(OBJ + 0x80 + i, c.counters?.[i / 4] ?? 0);
}

function seedWorld(rt, c) {
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(LIST + i, 0);
    rt.mem.write32(LIST + 0x0c, WIDGET_BASE + 2 * 0x100);
    rt.mem.write32(ARGSLOT, c.argSlot ?? 0);
    rt.mem.write32(STRING_BASE, 0x1000);
    rt.mem.write32(FLAGS_INDEX, c.flagsIndex ?? 0);
    for (let i = 0; i < 8; i++) rt.mem.write32(CONFIG + i * 4, (c.config?.[i] ?? 0x100 + i));
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(FLAGS_BASE + i, 0);
    // The active member's ailment byte is record +0x1c = workspace +0x10 +
    // idx*0x20 + 0x1c. A decoy in the neighbouring +0x1c byte (record +0x0C,
    // current MP) catches a port that reads the wrong offset.
    const idx = c.flagsIndex ?? 0;
    rt.mem.write8(FLAGS_BASE + idx * 0x20 + 0x1c, (c.flags ?? 0) ^ 0x28);
    rt.mem.write8(FLAGS_BASE + idx * 0x20 + 0x2c, c.flags ?? 0);
    rt.mem.write32(OBJ + 0x80, c.ctr0 ?? 0);
    rt.mem.write32(OBJ + 0x84, c.ctr1 ?? 0);
    CONTROL.alloc = c.alloc ?? ACTOR;
    CONTROL.padConfirm = c.padConfirm ?? 0;
    CONTROL.padA = c.padA ?? c.padConfirm ?? 0;
    CONTROL.padB = c.padB ?? 0;
    CONTROL.frame = c.frame ?? 3;
    made = 0;
}

function portHost() {
    return {
        allocateActor() { LOG.push(["alloc", 0x80093e44 | 0, 0x58, 0x1c]); return CONTROL.alloc; },
        allocateJokeActor() { LOG.push(["alloc", 0x8009a898 | 0, 0xc4, 0x1c]); return CONTROL.alloc; },
        allocateMenu() { LOG.push(["alloc", 0x8009af4c | 0, 0xa8, 0]); return CONTROL.alloc; },
        createTextElement(target, kind, x, y) {
            LOG.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            const widget = WIDGET_BASE + made * 0x100;
            made += 1;
            return widget;
        },
        resourceBase(id) { LOG.push(["resource", id | 0]); return RES_PTR; },
        packResolve(h) { LOG.push(["pack", h | 0]); return PACK_PTR; },
        padReadA(port) { LOG.push(["padA", port | 0]); return CONTROL.padA; },
        padReadB(port) { LOG.push(["padB", port | 0]); return CONTROL.padB; },
        playSound(id) { LOG.push(["sound", id | 0]); },
        frameDelta() { LOG.push(["frame"]); return CONTROL.frame; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        setPaletteRow(n) { LOG.push(["palette", n | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

function fieldsObj(rt, obj = OBJ) {
    const out = [];
    for (const off of [0x50, 0x54, 0x68]) out.push(`${off.toString(16)}=${rt.mem.read32(obj + off) >>> 0}`);
    out.push(`t0=${rt.mem.read32(TIME_OBJECT) >>> 0}`);
    out.push(`t4=${rt.mem.read32(TIME_OBJECT + 4) >>> 0}`);
    return out;
}

function runBoth(rt, addr, fn, c, name) {
    seedObj(rt, c);
    seedWorld(rt, c);
    LOG.length = 0;
    const ret = rt.cpu.call(addr, [OBJ, ARGSLOT], 40000);
    const olog = LOG.slice();
    const ofields = fieldsObj(rt);

    seedObj(rt, c);
    seedWorld(rt, c);
    LOG.length = 0;
    const pret = fn(rt.mem, OBJ, ARGSLOT, portHost());
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(fieldsObj(rt), ofields, `${name}: fields`);
    return { pret, ret };
}

test("commandMenuActorConstruct matches F0x80093F9C", () => {
    const rt = runtime();
    for (const c of [{ alloc: ACTOR }, { alloc: MENU }]) {
        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        rt.mem.write32(ARGSLOT, 0x1234);
        CONTROL.alloc = c.alloc;
        rt.cpu.call(0x80093f9c, [OBJ, ARGSLOT], 40000);
        const olog = LOG.slice();
        const objFields = [rt.mem.read32(c.alloc + 0x50) >>> 0, rt.mem.read32(c.alloc + 0x54) >>> 0, rt.mem.read32(ARGSLOT) >>> 0];

        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        rt.mem.write32(ARGSLOT, 0x1234);
        CONTROL.alloc = c.alloc;
        const port = commandMenuActorConstruct(rt.mem, OBJ, ARGSLOT, portHost()) >>> 0;
        assert.equal(port, c.alloc, "actor address");
        assert.deepEqual([rt.mem.read32(c.alloc + 0x50) >>> 0, rt.mem.read32(c.alloc + 0x54) >>> 0, rt.mem.read32(ARGSLOT) >>> 0], objFields, "actor fields");
        assert.deepEqual(LOG, olog, "calls");
    }
});

test("commandMenuCreate matches F0x8009B0C8", () => {
    const rt = runtime();
    const c = { alloc: MENU, config: [10, 20, 30, 40, 50, 60, 70, 80] };
    seedWorld(rt, c);
    CONTROL.alloc = MENU;
    LOG.length = 0;
    rt.cpu.call(0x8009b0c8, [CONFIG], 40000);
    const olog = LOG.slice();
    const ofields = Array.from({ length: 8 }, (_, i) => rt.mem.read32(MENU + 0x58 + i * 4) >>> 0);

    seedWorld(rt, c);
    CONTROL.alloc = MENU;
    LOG.length = 0;
    commandMenuCreate(rt.mem, CONFIG, portHost());
    assert.deepEqual(LOG, olog, "calls");
    assert.deepEqual(Array.from({ length: 8 }, (_, i) => rt.mem.read32(MENU + 0x58 + i * 4) >>> 0), ofields, "menu config");
});

test("commandMenuBuildNames matches F0x80093CF4", () => {
    const rt = runtime();
    const cases = [
        { name: "no flags", flags: 0 },
        { name: "flag 8", flags: 8 },
        { name: "flag 0x20", flags: 0x20 },
        { name: "both", flags: 0x28 },
        { name: "slot 2 flag 8", flags: 8, flagsIndex: 2 },
        { name: "slot 1 flag 0x20", flags: 0x20, flagsIndex: 1 },
    ];
    for (const c of cases) {
        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80093cf4, [OBJ], 40000);
        const olog = LOG.slice();
        const ofields = Array.from({ length: 8 }, (_, i) => rt.mem.read32(LIST + 0x4 + i * 4) >>> 0);

        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        commandMenuBuildNames(rt.mem, OBJ, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(Array.from({ length: 8 }, (_, i) => rt.mem.read32(LIST + 0x4 + i * 4) >>> 0), ofields, `${c.name}: widgets`);
    }
});

test("commandMenuActorTick matches F0x80093E44", () => {
    const rt = runtime();
    const cases = [
        { name: "state 0 builds", state: 0, alloc: MENU, obj54: ARGSLOT },
        { name: "state 4 builds", state: 4, alloc: MENU, obj54: ARGSLOT },
        { name: "state 2 idle", state: 2, obj54: ARGSLOT },
        { name: "state 3 idle", state: 3, obj54: ARGSLOT },
        { name: "state 1 no pad", state: 1, padConfirm: 0, selection: 1, obj54: ARGSLOT },
        { name: "state 1 confirm low", state: 1, padConfirm: 0x2000, flags: 8, selection: 1, obj54: ARGSLOT },
        { name: "state 1 confirm high", state: 1, padConfirm: 0x2000, flags: 8, selection: 3, obj54: ARGSLOT },
        { name: "state 1 confirm 0x20 ok", state: 1, padConfirm: 0x2000, flags: 0x20, selection: 1, obj54: ARGSLOT },
        { name: "state 1 confirm 0x20 block", state: 1, padConfirm: 0x2000, flags: 0x20, selection: 2, obj54: ARGSLOT },
        { name: "state 1 slot 1 sleep blocks", state: 1, padConfirm: 0x2000, flags: 8, flagsIndex: 1, selection: 0, obj54: ARGSLOT },
        { name: "state 1 slot 2 no ailment", state: 1, padConfirm: 0x2000, flags: 0, flagsIndex: 2, selection: 0, obj54: ARGSLOT },
    ];
    for (const c of cases) {
        const r = runBoth(rt, 0x80093e44, commandMenuActorTick, c, c.name);
        void r;
    }
});

test("commandMenuStateMachine matches F0x8009AF4C", () => {
    const rt = runtime();
    const cases = [
        { name: "default updates", state: 0 },
        { name: "state 2 idle", state: 2 },
        { name: "state 3 clears", state: 3 },
        { name: "sub 0 to 3c", state: 1, sub: 0, sprite: 0xffffffff },
        { name: "sub 1 to 3c", state: 1, sub: 1, sprite: 0xffffffff },
        { name: "sub 2 block", state: 1, sub: 2, sprite: 0xffffffff },
        { name: "sub 3 skip 3c", state: 1, sub: 3, sprite: 0xffffffff },
        { name: "sub 4 block", state: 1, sub: 4, sprite: 0xffffffff },
        { name: "negative sub", state: 1, sub: -1, sprite: 0xffffffff },
        { name: "up pressed", state: 1, sub: 3, sprite: 0xffffffff, padA: 0x10, selection: 2 },
        { name: "up at top", state: 1, sub: 3, sprite: 0xffffffff, padA: 0x10, selection: 0 },
        { name: "down pressed", state: 1, sub: 3, sprite: 0xffffffff, padA: 0x40, selection: 0, count: 3 },
        { name: "down at bottom", state: 1, sub: 3, sprite: 0xffffffff, padA: 0x40, selection: 2, count: 3 },
        { name: "pad B down", state: 1, sub: 3, sprite: 0xffffffff, padB: 0x40, selection: 0, count: 3 },
        { name: "draws when sprite set", state: 1, sub: 3, sprite: 5, count: 1, selection: 0, ctr0: 0, step: 0x2e, y: 0x13 },
        { name: "busy skips pad", state: 1, sub: 3, sprite: 0xffffffff, selection: 0, obj54: 1 },
    ];
    for (const c of cases) {
        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x8009af4c, [OBJ], 40000);
        const olog = LOG.slice();
        const ofields = fieldsObj(rt);

        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        commandMenuStateMachine(rt.mem, OBJ, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fieldsObj(rt), ofields, `${c.name}: fields`);
    }
});

test("commandMenuDraw matches F0x8009ADD4", () => {
    const rt = runtime();
    const cases = [
        { name: "empty", count: 0 },
        { name: "one row idle", count: 1, selection: 5, ctr0: 0, step: 0x2e, y: 0x13 },
        { name: "selected increments", count: 1, selection: 0, ctr0: 0, step: 0x2e, y: 0x13 },
        { name: "selected wraps", count: 1, selection: 0, ctr0: 0x13, step: 0x2e, y: 0x13 },
        { name: "row wraps unselected", count: 2, selection: 1, ctr0: 0x13, ctr1: 0, step: 0x2e, y: 0x13 },
    ];
    for (const c of cases) {
        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x8009add4, [OBJ], 40000);
        const olog = LOG.slice();
        const ofields = fieldsObj(rt);

        seedObj(rt, c);
        seedWorld(rt, c);
        LOG.length = 0;
        commandMenuDraw(rt.mem, OBJ, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(fieldsObj(rt), ofields, `${c.name}: fields`);
    }
});

// The joke list a confused acting Digimon is shown: the sequencer's sub-state 3
// spawns a different owner (FIGHTSTG_F0x8009AB74, tick 0x8009a898) which builds the
// SAME F0x8009B0C8 widget from its own config at 0x800A3634 and its rows with
// FIGHTSTG_F0x8009A2DC. The two routines compared here are the ones that differ
// from the command list: the object's identity (the tick handed to F0x80014504) and
// the six row text boxes.

const JOKE_OUT = 0x80163000;
const JOKE_SIB_A = 0x80164000;
const JOKE_SIB_B = 0x80165000;

/** The overlay's own shuffle table (fightstg.s:34005-34008): the ROM order. */
const JOKE_PERM_ROM = [7, 1, 0, 3, 2, 5, 4, 6];

function seedJokePerm(rt, entries) {
    for (let i = 0; i < 8; i++) rt.mem.write16(JOKE_PERM + i * 2, entries[i] ?? JOKE_PERM_ROM[i]);
}

test("jokeMenuActorConstruct matches FIGHTSTG_F0x8009AB74", () => {
    const rt = runtime();
    for (const alloc of [ACTOR, MENU]) {
        const c = { alloc };
        seedObj(rt, c);
        seedWorld(rt, c);
        for (let i = 0; i < 0x40; i += 4) rt.mem.write32(c.alloc + i, 0);
        rt.mem.write32(JOKE_OUT, 0x1234);
        CONTROL.alloc = c.alloc;
        LOG.length = 0;
        rt.cpu.call(0x8009ab74, [JOKE_OUT, JOKE_SIB_A, JOKE_SIB_B], 40000);
        const olog = LOG.slice();
        const ofields = [0x50, 0x54, 0x58, 0x5c, 0x60].map((o) => rt.mem.read32(c.alloc + o) >>> 0);
        ofields.push(rt.mem.read32(JOKE_OUT) >>> 0);

        seedObj(rt, c);
        seedWorld(rt, c);
        for (let i = 0; i < 0x40; i += 4) rt.mem.write32(c.alloc + i, 0);
        rt.mem.write32(JOKE_OUT, 0x1234);
        CONTROL.alloc = c.alloc;
        LOG.length = 0;
        const port = jokeMenuActorConstruct(rt.mem, JOKE_OUT, JOKE_SIB_A, JOKE_SIB_B, portHost()) >>> 0;
        assert.equal(port, c.alloc, "owner address");
        assert.deepEqual(LOG, olog, "calls");
        assert.deepEqual(
            [0x50, 0x54, 0x58, 0x5c, 0x60].map((o) => rt.mem.read32(c.alloc + o) >>> 0)
                .concat([rt.mem.read32(JOKE_OUT) >>> 0]),
            ofields, "owner fields");
    }
});

test("jokeMenuBuildNames matches FIGHTSTG_F0x8009A2DC", () => {
    const rt = runtime();
    const cases = [
        { name: "ROM order", perm: JOKE_PERM_ROM },
        { name: "identity order", perm: [0, 1, 2, 3, 4, 5, 6, 7] },
        { name: "one shuffle", perm: [4, 7, 0, 2, 6, 1, 3, 5] },
        { name: "reverse", perm: [6, 4, 5, 2, 3, 0, 1, 7] },
        // The ailment byte the command list greys on is set here: the joke rows
        // must still be plain, because F0x8009A2DC never reads it.
        { name: "ailment byte set", perm: [3, 2, 1, 0, 7, 6, 5, 4], flags: 0x28 },
    ];
    for (const c of cases) {
        seedObj(rt, c);
        seedWorld(rt, c);
        seedJokePerm(rt, c.perm);
        LOG.length = 0;
        rt.cpu.call(0x8009a2dc, [OBJ], 40000);
        const olog = LOG.slice();
        const ofields = Array.from({ length: 8 }, (_, i) => rt.mem.read32(LIST + 0x4 + i * 4) >>> 0);

        seedObj(rt, c);
        seedWorld(rt, c);
        seedJokePerm(rt, c.perm);
        LOG.length = 0;
        jokeMenuBuildNames(rt.mem, OBJ, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual(Array.from({ length: 8 }, (_, i) => rt.mem.read32(LIST + 0x4 + i * 4) >>> 0),
            ofields, `${c.name}: widgets`);
    }
});

test("jokeMenuBuildNames stops once the rows exist, like F0x8009A2DC", () => {
    const rt = runtime();
    const c = { perm: JOKE_PERM_ROM, built: true };
    seedObj(rt, c);
    seedWorld(rt, c);
    seedJokePerm(rt, c.perm);
    rt.mem.write32(LIST + 0x4, WIDGET_BASE);
    LOG.length = 0;
    rt.cpu.call(0x8009a2dc, [OBJ], 40000);
    const olog = LOG.slice();
    seedObj(rt, c);
    seedWorld(rt, c);
    seedJokePerm(rt, c.perm);
    rt.mem.write32(LIST + 0x4, WIDGET_BASE);
    LOG.length = 0;
    jokeMenuBuildNames(rt.mem, OBJ, portHost());
    assert.deepEqual(LOG, olog, "calls");
    assert.deepEqual(LOG, [], "no rows are rebuilt");
});
