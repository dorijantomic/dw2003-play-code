// Phase 4 oracle: engine/dw3/ui/duel-tick.ts must reproduce pro/cardgame's
// cardDuelTick. The original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with its six far calls stubbed; the default
// arm runs the shipped mode machine, so the whole dispatch chain is compared.
// The duel/scene/view fields, the ordered call log and the return value are
// compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { DUEL_MODE } from "../engine/dw3/ui/duel-mode-machine.ts";
import { DUEL_TICK, DUEL_TICK_ARM, cardDuelTick } from "../engine/dw3/ui/duel-tick.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const DUEL = 0x80194000;
const SCENE = 0x80195000;
const VIEW = 0x80190000;

// the tick's six boundaries
const APPLY_GREY = 0x8009e62c;
const DISPATCH_QUEUE = 0x8009e668;
const RUN_ANNOUNCE = 0x8009e560;
const RUN_EFFECT = 0x80084320;
const FETCH_OPCODE = 0x800a2180;
const STEP_BLOCK = 0x800a2608;
// the mode machine's far calls, reached through the default arm
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

/** The original's boundaries, recorded with the same shapes the port logs. */
function stubOriginal(rt, events, rets) {
    rt.cpu.setStub(APPLY_GREY, (c) => { events.push(["applyQueuedGreyFlags", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(DISPATCH_QUEUE, (c) => { events.push(["dispatchDuelViewQueue", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(RUN_ANNOUNCE, (c) => { events.push(["runQueuedAnnounce", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(RUN_EFFECT, (c) => { events.push(["runEffectOpcode", c.reg(4) >>> 0, c.reg(5) >>> 0]); return 0; });
    rt.cpu.setStub(FETCH_OPCODE, (c) => {
        events.push(["fetchNextEffectOpcode", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return rets.fetch | 0;
    });
    rt.cpu.setStub(STEP_BLOCK, (c) => {
        events.push(["saveRestoreEffectStepBlock", c.reg(4) >>> 0, c.reg(5) >>> 0]);
        return rets.step | 0;
    });
    // the mode machine's own far calls (the default arm reaches them natively);
    // recorded under the same names the port's host logs, so the two ordered
    // logs are comparable
    const rec = (name) => (c) => { events.push([name, c.reg(4) >>> 0, c.reg(5) >>> 0]); };
    rt.cpu.setStub(ENTER_FIVE, (c) => { rec("enterFive")(c); return 0; });
    rt.cpu.setStub(ENTER_EIGHT, (c) => { rec("enterEight")(c); return 0; });
    rt.cpu.setStub(ENTER_NINE, (c) => { rec("enterNine")(c); return 0; });
    rt.cpu.setStub(UPDATE_TWO, (c) => { rec("updateTwo")(c); return rets.two | 0; });
    rt.cpu.setStub(UPDATE_THREE, (c) => { rec("updateThree")(c); return rets.three | 0; });
    rt.cpu.setStub(UPDATE_FOUR, (c) => { rec("updateFour")(c); return rets.four | 0; });
    rt.cpu.setStub(UPDATE_FIVE, (c) => { rec("updateFive")(c); return rets.five | 0; });
    rt.cpu.setStub(UPDATE_SIX, (c) => { rec("updateSix")(c); return rets.six | 0; });
    rt.cpu.setStub(UPDATE_EIGHT, (c) => { rec("updateEight")(c); return rets.eight | 0; });
}

/** The same host for the port. */
function portHost(events, rets) {
    const rec = (name) => (duel, scene) => { events.push([name, duel >>> 0, scene >>> 0]); };
    return {
        applyQueuedGreyFlags: rec("applyQueuedGreyFlags"),
        dispatchDuelViewQueue: rec("dispatchDuelViewQueue"),
        runQueuedAnnounce: rec("runQueuedAnnounce"),
        runEffectOpcode: rec("runEffectOpcode"),
        fetchNextEffectOpcode: (duel, scene) => { rec("fetchNextEffectOpcode")(duel, scene); return rets.fetch | 0; },
        saveRestoreEffectStepBlock: (duel, scene) => { rec("saveRestoreEffectStepBlock")(duel, scene); return rets.step | 0; },
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
    rt.mem.write8(DUEL + DUEL_TICK_ARM, o.arm ?? 0);
    rt.mem.write8(DUEL + DUEL_MODE.pending, o.pending ?? 0);
    rt.mem.write8(DUEL + DUEL_MODE.current, o.current ?? 0);
    rt.mem.write8(DUEL + DUEL_MODE.previous, o.previous ?? 0);
    rt.mem.write8(DUEL + DUEL_MODE.subStep, o.sub ?? 0);
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

function both(o, rets = {}) {
    const evA = [];
    const a = runtime();
    stubOriginal(a, evA, rets);
    seed(a, o);
    const av = a.cpu.call(DUEL_TICK, [DUEL, SCENE]);

    const evB = [];
    const b = runtime();
    seed(b, o);
    const bv = cardDuelTick(b.mem, portHost(evB, rets), DUEL, SCENE);
    return { a, b, av, bv, evA, evB };
}

test("cardDuelTick matches F0x800A2DF8 for every arm", () => {
    for (const arm of [0, 1, 2, 3, 4, 0xff]) {
        // 0x100 / 0x102 pin the &0xFF the original's `andi` applies to both
        for (const fetch of [0, 1, 0x80, 0xff, 0x100]) {
            for (const step of [0, 1, 2, 3, 0x102]) {
                const { a, b, av, bv, evA, evB } = both({ arm }, { fetch, step });
                assert.equal(bv | 0, av | 0, `arm ${arm} fetch ${fetch} step ${step} return`);
                assert.deepEqual(fields(b), fields(a), `arm ${arm} fetch ${fetch} step ${step}`);
                assert.deepEqual(evB, evA, `arm ${arm} fetch ${fetch} step ${step} calls`);
            }
        }
    }
});

test("the three queue services always run first, in order", () => {
    for (const arm of [0, 1, 2, 3]) {
        const { evA, evB } = both({ arm }, {});
        assert.deepEqual(evA.slice(0, 3),
            [["applyQueuedGreyFlags", DUEL, SCENE], ["dispatchDuelViewQueue", DUEL, SCENE], ["runQueuedAnnounce", DUEL, SCENE]],
            `arm ${arm} service order`);
        assert.deepEqual(evB, evA, `arm ${arm}`);
    }
});

test("the arm-1 call receives the view pointer from scene+0x18", () => {
    const { a, evA } = both({ arm: 1 }, {});
    assert.deepEqual(evA[3], ["runEffectOpcode", DUEL, VIEW]);
    assert.equal(a.mem.read8(DUEL + DUEL_TICK_ARM), 1, "the arm byte is not touched");
    // and a different view pointer travels through
    const other = both({ arm: 1 }, {});
    assert.equal(other.evA[3][2], VIEW);
});

test("the default arm's mode machine is the shipped one", () => {
    // mode 4 update code 2 -> the machine reports finished -> the tick returns 1
    {
        const { a, b, av, bv, evA, evB } = both({ arm: 0, current: 4, pending: 0 }, { four: 2 });
        assert.equal(av | 0, 1);
        assert.equal(bv | 0, 1);
        assert.deepEqual(fields(b), fields(a));
        assert.deepEqual(evB, evA);
        assert.equal(a.mem.read8(DUEL + DUEL_MODE.outcome302), 1, "the outcome byte was set");
    }
    // a pending mode rotates before the update, exactly as the machine does
    {
        const { a, b, av, bv, evA, evB } = both({ arm: 4, current: 0, pending: 5 }, {});
        assert.equal(bv | 0, av | 0);
        assert.deepEqual(fields(b), fields(a));
        assert.deepEqual(evB, evA);
        assert.equal(a.mem.read8(DUEL + DUEL_MODE.current), 5);
        assert.ok(evA.some((e) => e[0] === "enterFive"));
    }
    // mode 1's two-step wait runs inside the tick too
    {
        const { a, b, av, bv, evA, evB } = both({ arm: 0, current: 1, sub: 0, widget: 0 });
        assert.equal(bv | 0, av | 0);
        assert.deepEqual(fields(b), fields(a));
        assert.deepEqual(evB, evA);
        assert.equal(a.mem.read8(VIEW + 0xe9e), 1, "the widget was armed");
        assert.equal(a.mem.read8(DUEL + DUEL_MODE.subStep), 1);
    }
});
