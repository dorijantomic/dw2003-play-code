// Oracle: engine/dw3/ui/native/gym-rolls.ts must match the original pro/stgtrain
// stat rolls F0x800861BC / F0x800862D0 / F0x800863D4 / F0x800865A0 and the rep
// bonus F0x80086ABC. The original runs through engine/native with the roster
// accessor cell [0x8004B484] and the random cell [0x8004DC0C] stubbed; the port
// gets the same two services from recording host functions.
import { test } from "node:test";
import { createKit, rng } from "./gym-kit.js";
import {
    gymRollCoreGain, gymRollCoreLoss, gymRollElementGain, gymRollHpMpGain, gymRepBonus,
} from "../../engine/dw3/ui/native/gym-rolls.ts";

const kit = createKit();
const SESSION = 0x80180000;
const SCREEN = 0x80180400;
const BLOCK = 0x80190000;
let randQueue = [];
let randAt = 0;
const nextRand = () => randQueue[randAt++ % randQueue.length] & 0xffff;

kit.cell(0x8004b484, "handle", (slot) => { return BLOCK; }, { args: 1 });
kit.cell(0x8004dc0c, "rand", () => nextRand(), { args: 0 });

const host = {
    recordBlock(slot) { kit.push("handle", slot); return BLOCK; },
    rand() { kit.push("rand"); return nextRand(); },
};

function seed(c) {
    return () => {
        randAt = 0;
        randQueue = c.rands;
        kit.fill(SESSION, 0x100, () => 0);
        kit.fill(SCREEN, 0x100, () => 0);
        const r = rng(c.seed);
        kit.fill(BLOCK, 0x400, () => (r() * 0x100000000) >>> 0);
        kit.mem.write32(SESSION + 0x50, SCREEN);
        kit.mem.write32(SESSION + 0x5c, c.slot);
        kit.mem.write32(SESSION + 0x60, c.drill);
        kit.mem.write32(SESSION + 0xd8, c.ultra);
        kit.mem.write32(SCREEN + 0x7c, c.tp);
        for (const [off, v] of Object.entries(c.poke ?? {})) kit.mem.write16(BLOCK + Number(off), v);
    };
}

const RANGES = [[SESSION, 0x100], [SCREEN, 0x100], [BLOCK, 0x400]];
const cases = [];
for (const tp of [0, 1, 2]) for (const ultra of [0, 1]) for (const drill of [1, 12, 13, 24]) {
    for (const rands of [[0], [1], [0x1234, 0x3333], [0xffff, 0xfffe], [7, 2]]) {
        cases.push({ tp, ultra, drill, rands, slot: 3, seed: tp * 31 + drill });
    }
}

test("gymRollCoreGain matches F0x800861BC", () => {
    for (const c of cases) for (const stat of [0, 1, 3, 5, 6, 9]) {
        for (const base of [0, 0x3e0, 0x7fff]) {
            const cc = { ...c, poke: { [stat * 2 + 0x26]: base } };
            kit.compare(`gain ${JSON.stringify([c.tp, c.ultra, c.drill, stat, base, c.rands])}`, {
                seed: seed(cc), ranges: RANGES,
                original: () => kit.call(0x800861bc, [SESSION, stat]),
                port: () => gymRollCoreGain(kit.mem, SESSION, stat, host),
            });
        }
    }
});

test("gymRollCoreLoss matches F0x800862D0", () => {
    for (const c of cases) for (const stat of [0, 1, 4, 5, 6]) {
        for (const base of [0, 1, 5, 400]) {
            const cc = { ...c, poke: { [stat * 2 + 0x26]: base } };
            kit.compare(`loss ${JSON.stringify([c.tp, stat, base, c.rands])}`, {
                seed: seed(cc), ranges: RANGES,
                original: () => kit.call(0x800862d0, [SESSION, stat]),
                port: () => gymRollCoreLoss(kit.mem, SESSION, stat, host),
            });
        }
    }
});

test("gymRollElementGain matches F0x800863D4", () => {
    for (const c of cases) for (const stat of [7, 8, 10, 14, 15]) {
        for (const base of [0, 99, 100, 299, 300, 1000]) {
            for (const slot of [0, 3, 7]) {
                const cc = { ...c, slot, poke: { [stat * 2 + 0x24]: base } };
                kit.compare(`element ${JSON.stringify([c.tp, c.ultra, c.drill, stat, base, slot, c.rands])}`, {
                    seed: seed(cc), ranges: RANGES,
                    original: () => kit.call(0x800863d4, [SESSION, stat]),
                    port: () => gymRollElementGain(kit.mem, SESSION, stat, host),
                });
            }
        }
    }
});

test("gymRollHpMpGain matches F0x800865A0", () => {
    for (const c of cases) for (const stat of [0xe, 0xf, 0x10, 0x11]) {
        for (const base of [0, 5000, 0x270f - 2, 0x2710]) {
            const cc = { ...c, poke: { 0x22: base, 0x26: base } };
            kit.compare(`hpmp ${JSON.stringify([c.tp, c.ultra, c.drill, stat, base, c.rands])}`, {
                seed: seed(cc), ranges: RANGES,
                original: () => kit.call(0x800865a0, [SESSION, stat]),
                port: () => gymRollHpMpGain(kit.mem, SESSION, stat, host),
            });
        }
    }
});

test("gymRepBonus matches F0x80086ABC", () => {
    for (const a of [0, 0x151, 0x152, 7]) for (const b of [0, 0x151, 0x152, 9]) {
        const cc = { tp: 0, ultra: 0, drill: 1, rands: [0], slot: 1, seed: 5, poke: { 0x3c8: a, 0x3ca: b } };
        kit.compare(`bonus ${a.toString(16)} ${b.toString(16)}`, {
            seed: seed(cc), ranges: RANGES,
            original: () => kit.call(0x80086abc, [SESSION]),
            port: () => gymRepBonus(kit.mem, SESSION, host),
        });
    }
});
