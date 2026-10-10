// Phase 4 oracle: engine/dw3/ui/duel-mode-machine.ts must reproduce pro/cardgame's
// mode machine and its jump-table arms. The originals run through engine/native
// on the shipped pro_cardgame.bin + resident.bin with the nine far duel calls
// stubbed on both sides; the duel/scene/view fields, the ordered call log and
// the return values are compared, and the two dispatch tables are read from the
// shipped image to pin the arm mapping.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    DUEL_ENTER_ARM_1_2,
    DUEL_ENTER_ARM_3_4_6,
    DUEL_ENTER_ARM_5_7,
    DUEL_ENTER_ARM_8,
    DUEL_ENTER_ARM_9,
    DUEL_ENTER_TABLE,
    DUEL_INIT_MODE_STATE,
    DUEL_MODE,
    DUEL_RUN_MODE_MACHINE,
    DUEL_UPDATE_ARM_1,
    DUEL_UPDATE_ARM_10,
    DUEL_UPDATE_ARM_2,
    DUEL_UPDATE_ARM_3,
    DUEL_UPDATE_ARM_4,
    DUEL_UPDATE_ARM_5_7,
    DUEL_UPDATE_ARM_6,
    DUEL_UPDATE_ARM_8,
    DUEL_UPDATE_ARM_9,
    DUEL_UPDATE_TABLE,
    initDuelModeState,
    runModeMachine,
} from "../engine/dw3/ui/duel-mode-machine.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;

const ENTER_FIVE = 0x800a0548;
const ENTER_EIGHT = 0x800a0f4c;
const ENTER_NINE = 0x800a1a5c;
const UPDATE_TWO = 0x8009f110;
const UPDATE_THREE = 0x8009f8c0;
const UPDATE_FOUR = 0x8009f910;
const UPDATE_FIVE = 0x8009fdd8;
const UPDATE_SIX = 0x800a0b80;
const UPDATE_EIGHT = 0x800a0f94;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** The nine far duel calls, stubbed with the case's return values. */
function stubBoundaries(rt, events, rets) {
    const record = (name) => (c) => {
        events.push([name, c.reg(4) >>> 0, c.reg(5) >>> 0]);
    };
    rt.cpu.setStub(ENTER_FIVE, (c) => { record("enterFive")(c); return 0; });
    rt.cpu.setStub(ENTER_EIGHT, (c) => { record("enterEight")(c); return 0; });
    rt.cpu.setStub(ENTER_NINE, (c) => { record("enterNine")(c); return 0; });
    rt.cpu.setStub(UPDATE_TWO, (c) => { record("updateTwo")(c); return rets.two | 0; });
    rt.cpu.setStub(UPDATE_THREE, (c) => { record("updateThree")(c); return rets.three | 0; });
    rt.cpu.setStub(UPDATE_FOUR, (c) => { record("updateFour")(c); return rets.four | 0; });
    rt.cpu.setStub(UPDATE_FIVE, (c) => { record("updateFive")(c); return rets.five | 0; });
    rt.cpu.setStub(UPDATE_SIX, (c) => { record("updateSix")(c); return rets.six | 0; });
    rt.cpu.setStub(UPDATE_EIGHT, (c) => { record("updateEight")(c); return rets.eight | 0; });
}

/** The same nine calls, as the port's host receives them. */
function portHost(events, rets) {
    const rec = (name) => (duel, scene) => {
        events.push([name, duel >>> 0, scene >>> 0]);
    };
    return {
        enterFive: rec("enterFive"),
        enterEight: rec("enterEight"),
        enterNine: rec("enterNine"),
        updateTwo: (duel, scene) => { rec("updateTwo")(duel, scene); return rets.two | 0; },
        updateThree: (duel, scene) => { rec("updateThree")(duel, scene); return rets.three | 0; },
        updateFour: (duel, scene) => { rec("updateFour")(duel, scene); return rets.four | 0; },
        updateFive: (duel, scene) => { rec("updateFive")(duel, scene); return rets.five | 0; },
        updateSix: (duel, scene) => { rec("updateSix")(duel, scene); return rets.six | 0; },
        updateEight: (duel, scene) => { rec("updateEight")(duel, scene); return rets.eight | 0; },
    };
}

function seed(rt, o = {}) {
    for (let i = 0x2f0; i <= 0x304; i++) rt.mem.write8(DUEL + i, 0);
    rt.mem.write8(DUEL + DUEL_MODE.previous, o.previous ?? 0);
    rt.mem.write8(DUEL + DUEL_MODE.pending, o.pending ?? 0);
    rt.mem.write8(DUEL + DUEL_MODE.current, o.current ?? 0);
    rt.mem.write8(DUEL + DUEL_MODE.subStep, o.sub ?? 0);
    rt.mem.write32(DUEL + DUEL_MODE.enterWord, o.enterWord ?? 0x12345678);
    rt.mem.write8(DUEL + DUEL_MODE.outcome302, o.outcome ?? 0);
    rt.mem.write32(SCENE + 0x18, VIEW);
    rt.mem.write8(VIEW + 0xe9e, o.widget ?? 0);
}

function fields(rt) {
    const out = [];
    for (let i = 0x2f0; i <= 0x304; i++) out.push(rt.mem.read8(DUEL + i));
    out.push(rt.mem.read8(VIEW + 0xe9e));
    return out;
}

/** initDuelModeState's own bytes live outside the machine's window. */
function initFields(rt) {
    const out = [];
    for (const [base, len] of [[0x2f0, 0x20], [0x5a0, 0x10], [0x670, 0x10]]) {
        for (let i = 0; i < len; i++) out.push(rt.mem.read8(DUEL + base + i));
    }
    return out;
}

function both(o, rets = {}) {
    const evA = [];
    const a = runtime();
    stubBoundaries(a, evA, rets);
    seed(a, o);
    const av = a.cpu.call(DUEL_RUN_MODE_MACHINE, [DUEL, SCENE]);

    const evB = [];
    const b = runtime();
    seed(b, o);
    const bv = runModeMachine(b.mem, portHost(evB, rets), DUEL, SCENE);
    return { a, b, av, bv, evA, evB };
}

test("the shipped mode tables match the port's arm mapping", () => {
    const tableWord = (base, i) => {
        const off = base - 0x80082cb0 + i * 4;
        return (overlay[off] | (overlay[off + 1] << 8) | (overlay[off + 2] << 16) | (overlay[off + 3] << 24)) >>> 0;
    };
    const enter = [1, 1, 0x800a1bac, 0x800a1bac, 0x800a1bb4, 0x800a1bac, 0x800a1bb4, 0x800a1bc8, 0x800a1bdc];
    for (let i = 0; i < enter.length; i++) {
        assert.equal(tableWord(DUEL_ENTER_TABLE, i) >>> 0,
            (enter[i] === 1 ? DUEL_ENTER_ARM_1_2 : enter[i]) >>> 0, `enter slot ${i + 1}`);
    }
    assert.equal(tableWord(DUEL_ENTER_TABLE, 9), 0, "enter slot 10 is the null word");
    const update = [DUEL_UPDATE_ARM_1, DUEL_UPDATE_ARM_2, DUEL_UPDATE_ARM_3, DUEL_UPDATE_ARM_4,
        DUEL_UPDATE_ARM_5_7, DUEL_UPDATE_ARM_6, DUEL_UPDATE_ARM_5_7, DUEL_UPDATE_ARM_8,
        DUEL_UPDATE_ARM_9, DUEL_UPDATE_ARM_10];
    for (let i = 0; i < update.length; i++) {
        assert.equal(tableWord(DUEL_UPDATE_TABLE, i) >>> 0, update[i] >>> 0, `update slot ${i + 1}`);
    }
    void DUEL_ENTER_ARM_3_4_6; void DUEL_ENTER_ARM_5_7; void DUEL_ENTER_ARM_8; void DUEL_ENTER_ARM_9;
});

test("initDuelModeState matches F0x800A1B2C", () => {
    for (const start of [{}, { outcome: 0xff, current: 0x5a, previous: 3, pending: 4, sub: 2 }]) {
        const a = runtime();
        seed(a, start);
        a.cpu.call(DUEL_INIT_MODE_STATE, [DUEL]);
        const b = runtime();
        seed(b, start);
        initDuelModeState(b.mem, DUEL);
        assert.deepEqual(initFields(b), initFields(a));
    }
    const a = runtime();
    seed(a, {});
    a.cpu.call(DUEL_INIT_MODE_STATE, [DUEL]);
    assert.equal(a.mem.read8(DUEL + DUEL_MODE.init5ad), 0);
    assert.equal(a.mem.read8(DUEL + DUEL_MODE.init675), 1);
    assert.equal(a.mem.read8(DUEL + DUEL_MODE.init303), 0);
    assert.equal(a.mem.read8(DUEL + DUEL_MODE.outcome302), 1);
    assert.equal(a.mem.read8(DUEL + DUEL_MODE.current), 1);
});

// One mutation is provably equivalent in-domain and the sweep cannot see it:
// widening the mode range check to >= 11 only matters for mode 11/12, where the
// shipped table's extra entries are never dispatched (the original's own check
// is `(mode-1) < 10`) and no arm runs either way.
// The sweep seeds `previous` DISTINCT from `current`: the rotate writes the old
// current into duel+0x2F6, so a port that leaves that byte unchanged (or copies
// the incoming previous) differs from F0x800A1B48 here. Seeding previous==current
// would mask exactly that.
test("runModeMachine matches F0x800A1B48 across the pending and mode ranges", () => {
    for (let pending = 0; pending <= 11; pending++) {
        for (let current = 0; current <= 11; current++) {
            const { a, b, av, bv, evA, evB } = both({ pending, current, previous: (current + 7) & 0xff });
            assert.equal(bv | 0, av | 0, `pending ${pending} current ${current} return`);
            assert.deepEqual(fields(b), fields(a), `pending ${pending} current ${current}`);
            assert.deepEqual(evB, evA, `pending ${pending} current ${current} calls`);
        }
    }
    // every pending 1..9 dispatches its own enter arm and then rotates the OLD
    // current into duel+0x2F6
    for (let pending = 1; pending <= 9; pending++) {
        for (const startCurrent of [0, 4, 0x2a]) {
            const { a, b, evA } = both({ pending, current: startCurrent, previous: 0x77 });
            assert.equal(a.mem.read8(DUEL + DUEL_MODE.current), pending, `pending ${pending} becomes current`);
            assert.equal(a.mem.read8(DUEL + DUEL_MODE.previous), startCurrent,
                `pending ${pending} rotates old current ${startCurrent} into previous`);
            assert.equal(b.mem.read8(DUEL + DUEL_MODE.previous), startCurrent,
                `pending ${pending} port previous matches`);
            // the rotate clears the pending byte, but the new current mode's own
            // update can immediately queue the next one (mode 9 queues mode 10)
            assert.equal(a.mem.read8(DUEL + DUEL_MODE.pending), pending === 9 ? 10 : 0,
                `pending ${pending} cleared or re-queued`);
        }
    }
    // pending 10 and 11 are out of the table: they still rotate, no arm runs
    for (const pending of [10, 11, 0xff]) {
        const { a, evA } = both({ pending, current: 2 });
        assert.deepEqual(evA, [], `pending ${pending} runs no enter arm`);
        assert.equal(a.mem.read8(DUEL + DUEL_MODE.current), pending);
    }
});

test("runModeMachine matches the update arms' return values", () => {
    // modes 2, 3, 5, 6, 7 advance on a non-zero result
    for (const mode of [2, 3, 5, 6, 7]) {
        for (const value of [0, 1, 0xffffffff]) {
            const rets = { two: value, three: value, five: value, six: value, eight: value };
            const { a, b, av, bv, evA, evB } = both({ current: mode }, rets);
            assert.equal(bv | 0, av | 0, `mode ${mode} value ${value}`);
            assert.deepEqual(fields(b), fields(a), `mode ${mode} value ${value}`);
            assert.deepEqual(evB, evA, `mode ${mode} value ${value} calls`);
        }
    }
    // mode 4: 1 queues mode 10, 2 and 3 report finished
    for (const value of [0, 1, 2, 3, 4]) {
        const { a, b, av, bv, evA, evB } = both({ current: 4 }, { four: value });
        assert.equal(bv | 0, av | 0, `mode 4 value ${value}`);
        assert.deepEqual(fields(b), fields(a), `mode 4 value ${value}`);
        assert.deepEqual(evB, evA, `mode 4 value ${value} calls`);
    }
    // mode 8: 1 queues mode 9, 2 reports finished
    for (const value of [0, 1, 2, 3]) {
        const { a, b, av, bv, evA, evB } = both({ current: 8 }, { eight: value });
        assert.equal(bv | 0, av | 0, `mode 8 value ${value}`);
        assert.deepEqual(fields(b), fields(a), `mode 8 value ${value}`);
        assert.deepEqual(evB, evA, `mode 8 value ${value} calls`);
    }
    // mode 9 queues mode 10 without a call; mode 10 arms the banner, whose own
    // table row is read by the shipped body on both sides
    for (const mode of [9, 10]) {
        const { a, b, av, bv, evA, evB } = both({ current: mode, pending: 0 });
        assert.equal(bv | 0, av | 0, `mode ${mode}`);
        assert.deepEqual(fields(b), fields(a), `mode ${mode}`);
        assert.deepEqual(evB, evA, `mode ${mode} calls`);
    }
    // mode 1's two sub-steps
    for (const sub of [0, 1, 2, 0xff]) {
        for (const widget of [0, 1, 2]) {
            const { a, b, av, bv, evA, evB } = both({ current: 1, sub, widget });
            assert.equal(bv | 0, av | 0, `mode 1 sub ${sub} widget ${widget}`);
            assert.deepEqual(fields(b), fields(a), `mode 1 sub ${sub} widget ${widget}`);
            assert.deepEqual(evB, evA, `mode 1 sub ${sub} widget ${widget} calls`);
        }
    }
});

// A discriminating mutation: the rotate leaves duel+0x2F6 unchanged (the former
// port bug). Seeded with previous != current, only the previous-byte check bites.
test("a mutated rotate makes the oracle fail", () => {
    const mutRotate = (mem, duel) => {
        const previous = mem.read8(duel + DUEL_MODE.previous) & 0xff;
        mem.write8(duel + DUEL_MODE.pending, 0);
        mem.write8(duel + DUEL_MODE.previous, previous); // wrong: should be old current
        mem.write8(duel + DUEL_MODE.current, 2);
    };
    const a = runtime();
    seed(a, { pending: 2, current: 5, previous: 9 });
    a.cpu.call(DUEL_RUN_MODE_MACHINE, [DUEL, SCENE]);
    const b = runtime();
    seed(b, { pending: 2, current: 5, previous: 9 });
    mutRotate(b.mem, DUEL);
    assert.equal(a.mem.read8(DUEL + DUEL_MODE.previous), 5, "the original rotates old current into previous");
    assert.notEqual(b.mem.read8(DUEL + DUEL_MODE.previous), a.mem.read8(DUEL + DUEL_MODE.previous), "mutation detected");
});
