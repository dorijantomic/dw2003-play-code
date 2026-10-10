// Phase 4 oracle: engine/dw3/ui/duel-mode-updates.ts must reproduce pro/cardgame's
// two self-contained mode updates — mode 3 (F0x8009F8C0, Load Phase) and mode 4
// (F0x8009F910, Compile/Battle Phase). The originals run through engine/native on
// the shipped pro_cardgame.bin + resident.bin; the return value and the whole
// touched field window are compared over every sub-step and selection value, and
// a discriminating mutation makes the oracle fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    DUEL_UPDATE_FIELDS,
    UPDATE_MODE_FOUR,
    UPDATE_MODE_THREE,
    updateDuelModeFour,
    updateDuelModeThree,
} from "../engine/dw3/ui/duel-mode-updates.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const DUEL = 0x80194000;
const SCENE = 0x80195000;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(rt, o = {}) {
    rt.mem.write8(DUEL + DUEL_UPDATE_FIELDS.subStep, o.sub ?? 0);
    rt.mem.write32(DUEL + DUEL_UPDATE_FIELDS.selected, o.selected ?? 0);
    rt.mem.write8(DUEL + DUEL_UPDATE_FIELDS.pendingOpcode, o.pending ?? 0x11);
    rt.mem.write8(DUEL + DUEL_UPDATE_FIELDS.tickArm, o.arm ?? 0x22);
    rt.mem.write8(DUEL + DUEL_UPDATE_FIELDS.sub3Carry, o.carry ?? 0x33);
    rt.mem.write32(SCENE + 0x18, 0x80190000);
}

/** The whole field window either body can touch. */
function window(rt) {
    return [
        rt.mem.read8(DUEL + DUEL_UPDATE_FIELDS.pendingOpcode),
        rt.mem.read8(DUEL + DUEL_UPDATE_FIELDS.tickArm),
        rt.mem.read8(DUEL + DUEL_UPDATE_FIELDS.subStep),
        rt.mem.read8(DUEL + DUEL_UPDATE_FIELDS.sub3Carry),
    ];
}

const SUBSTEPS = [0, 1, 2, 0xff];
const SELECTIONS = [0, 1, 2, 3, 0xffffffff];

test("updateDuelModeThree matches F0x8009F8C0 over every sub-step and selection", () => {
    for (const sub of SUBSTEPS) {
        for (const selected of SELECTIONS) {
            const a = runtime();
            seed(a, { sub, selected });
            const av = a.cpu.call(UPDATE_MODE_THREE, [DUEL, SCENE]) | 0;
            const b = runtime();
            seed(b, { sub, selected });
            const bv = updateDuelModeThree(b.mem, DUEL);
            assert.equal(bv | 0, av | 0, `sub ${sub} sel ${selected} return`);
            assert.deepEqual(window(b), window(a), `sub ${sub} sel ${selected} fields`);
        }
    }
    // sub-step 0 arms the coin toss and the effect VM; any other sub-step only
    // carries the selection bit and reports the advance.
    const a = runtime();
    seed(a, { sub: 0 });
    updateDuelModeThree(a.mem, DUEL);
    assert.equal(a.mem.read8(DUEL + DUEL_UPDATE_FIELDS.pendingOpcode), 0xa7);
    assert.equal(a.mem.read8(DUEL + DUEL_UPDATE_FIELDS.tickArm), 1);
    assert.equal(a.mem.read8(DUEL + DUEL_UPDATE_FIELDS.subStep), 1);
    const b = runtime();
    seed(b, { sub: 1, selected: 0 });
    assert.equal(updateDuelModeThree(b.mem, DUEL), 1);
    assert.equal(b.mem.read8(DUEL + DUEL_UPDATE_FIELDS.sub3Carry), 0);
    const c = runtime();
    seed(c, { sub: 1, selected: 9 });
    assert.equal(updateDuelModeThree(c.mem, DUEL), 1);
    assert.equal(c.mem.read8(DUEL + DUEL_UPDATE_FIELDS.sub3Carry), 1);
});

test("updateDuelModeFour matches F0x8009F910 over every sub-step and selection", () => {
    for (const sub of SUBSTEPS) {
        for (const selected of SELECTIONS) {
            const a = runtime();
            seed(a, { sub, selected });
            const av = a.cpu.call(UPDATE_MODE_FOUR, [DUEL, SCENE]) | 0;
            const b = runtime();
            seed(b, { sub, selected });
            const bv = updateDuelModeFour(b.mem, DUEL);
            assert.equal(bv | 0, av | 0, `sub ${sub} sel ${selected} return`);
            assert.deepEqual(window(b), window(a), `sub ${sub} sel ${selected} fields`);
        }
    }
    // the selection maps to the phase outcome; nothing is written on that path
    const cases = [[0, 1], [1, 2], [2, 3], [3, 0], [0xffffffff, 0]];
    for (const [selected, expected] of cases) {
        const rt = runtime();
        seed(rt, { sub: 1, selected });
        assert.equal(updateDuelModeFour(rt.mem, DUEL), expected, `selection ${selected}`);
    }
});

// A discriminating mutation: mode 4's selection->outcome map swapped 1<->2 would
// pass the sub-step-0 case and the memory window, and only the return-value case
// above catches it. Here the mutation is applied to the shipped original's own
// input so the ORACLE is seen to fail when the port is wrong.
test("a mutated port makes the oracle fail", () => {
    const mutated = (mem, duel) => {
        const sub = mem.read8(duel + DUEL_UPDATE_FIELDS.subStep) & 0xff;
        if (sub === 0) {
            mem.write8(duel + DUEL_UPDATE_FIELDS.pendingOpcode, 0x14);
            mem.write8(duel + DUEL_UPDATE_FIELDS.tickArm, 1);
            mem.write8(duel + DUEL_UPDATE_FIELDS.subStep, 1);
            return 0;
        }
        const selected = mem.read32(duel + DUEL_UPDATE_FIELDS.selected) | 0;
        if (selected === 0) return 2; // wrong on purpose
        if (selected === 1) return 1;
        if (selected === 2) return 3;
        return 0;
    };
    const a = runtime();
    seed(a, { sub: 1, selected: 0 });
    const av = a.cpu.call(UPDATE_MODE_FOUR, [DUEL, SCENE]) | 0;
    const b = runtime();
    seed(b, { sub: 1, selected: 0 });
    assert.notEqual(mutated(b.mem, DUEL) | 0, av | 0, "the mutated port disagrees with the original");
});
