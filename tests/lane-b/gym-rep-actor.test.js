// Oracle: engine/dw3/ui/native/gym-rep-actor.ts must match the original pro/stgtrain rep actor:
// handler F0x800897B8, constructor F0x8008A274 and the methods F0x8008A0F4..F0x8008A264. The
// original runs through engine/native with the TRANIN pack services (the service table cells),
// the two sprite actors' class tables, the file-pending service, the task methods and the
// random cell replaced by recording stubs; the port gets the same calls from a recording host.
import { test } from "node:test";
import { createKit, rng } from "./gym-kit.js";
import * as R from "../../engine/dw3/ui/native/gym-rep-actor.ts";

const kit = createKit();
const mem = kit.mem;
const ACTOR = 0x80150000;
const CHILDREN = 0x80150200;
const C0 = 0x80151000;
const C1 = 0x80151400;
const NEWC = 0x80152000;
const NEW = 0x80153000;
let rands = [];
let randAt = 0;
let pending = 0;
const nextRand = () => rands[randAt++ % rands.length] & 0xffff;
const SVC = 0x8008cfcc;
const cellOf = (off) => SVC + off;

kit.cell(0x8004dc0c, "rand", () => nextRand(), { args: 0 });
kit.cell(0x80044f3c, "filePending", () => pending, { args: 1 });
const packs = {
    packParse: [0x300, (c) => (c === 8 ? parseEight : 1)],
    packUpload: [0x304, () => 1],
    packFile: [0x308, (d) => 0x25e + d],
    packOrigin: [0x30c, (d) => ((0x1f + d) << 16) | (0x52 + d)],
    packPropsFlag: [0x310, (d) => d & 1],
    packClips: [0x314, (c) => 0x100 + c],
    packDataOffset: [0x318, (c) => 8 + c],
    packScript: [0x320, (c, i) => (c === 8 && i === 5 ? 0 : 0x1000 + c * 0x10 + i)],
};
let parseEight = 1;
for (const [name, [off, fn]] of Object.entries(packs)) {
    const args = name === "packScript" || name === "packUpload" ? 2 : 1;
    kit.cell(cellOf(off), name, (...a) => fn(...a), { args });
}
// Every method the tick calls through an object: the sprite actors' class slots and the task methods.
const SLOTS = { setData: 0xe0, setScript: 0xe4, setOrigin: 0xe8, setPage: 0xec, setLayer: 0xf0, setClut: 0xf4,
    setScale: 0xf8, setPivot: 0xfc, isDone: 0x104, hold: 0x108 };
const ARITY = { setData: 3, setScript: 2, setOrigin: 3, setPage: 3, setLayer: 3, setClut: 3, setScale: 4, setPivot: 3, isDone: 1, hold: 2 };
let doneA = 1, doneB = 1;
for (const c of [C0, C1, NEWC]) {
    for (const [name, slot] of Object.entries(SLOTS)) {
        mem.write32(c + slot, kit.stub(name, name === "isDone" ? () => (c === C0 ? doneA : doneB) : 0, { args: ARITY[name] }));
    }
    mem.write32(c + 0x28, kit.stub("setState0", 0, { args: 2 }));
}
const TASK = { 0x2c: kit.stub("setState1", 0, { args: 2 }), 0x38: kit.stub("advance", 0, { args: 1 }), 0x3c: kit.stub("advanceState1", 0, { args: 1 }) };
kit.at(0x80083880, "createActor", () => NEWC, { args: 0 });
kit.at(0x80014504, "alloc", () => NEW, { args: 3 });

const ACTOR_NAMES = Object.fromEntries(Object.entries(SLOTS).map(([n, s]) => [s, n]));
const host = {
    rand() { kit.push("rand"); return nextRand(); },
    filePending(f) { kit.push("filePending", f); return pending; },
    createActor() { kit.push("createActor"); return NEWC; },
    actor(a, slot, args) {
        const name = ACTOR_NAMES[slot];
        kit.push(name, a, ...args.slice(0, ARITY[name] - 1));
        return name === "isDone" ? (a === C0 ? doneA : doneB) : 0;
    },
    advance(self) { kit.push("advance", self); },
    advanceState1(self) { kit.push("advanceState1", self); },
    setState1(self, v) { kit.push("setState1", self, v); },
    setState0(t, v) { kit.push("setState0", t, v); },
    packFile(d) { kit.push("packFile", d); return packs.packFile[1](d); },
    packOrigin(d) { kit.push("packOrigin", d); return packs.packOrigin[1](d); },
    packPropsFlag(d) { kit.push("packPropsFlag", d); return packs.packPropsFlag[1](d); },
    packParse(c) { kit.push("packParse", c); return packs.packParse[1](c); },
    packUpload(c, p) { kit.push("packUpload", c, p); return 1; },
    packClips(c) { kit.push("packClips", c); return packs.packClips[1](c); },
    packDataOffset(c) { kit.push("packDataOffset", c); return packs.packDataOffset[1](c); },
    packScript(c, i) { kit.push("packScript", c, i); return packs.packScript[1](c, i); },
};
const ranges = [[ACTOR, 0xd8], [CHILDREN, 0x10], [NEW, 0xd8]];

function seed(c) {
    return () => {
        const r = rng(c.seed ?? 1);
        kit.fill(ACTOR, 0xd8, () => 0); kit.fill(CHILDREN, 0x10, () => 0); kit.fill(NEW, 0xd8, () => 0);
        mem.write32(ACTOR + 0x0c, c.state ?? 1);
        mem.write32(ACTOR + 0x10, c.s1 ?? 0);
        mem.write32(ACTOR + 0x24, CHILDREN);
        for (const [off, fn] of Object.entries(TASK)) mem.write32(ACTOR + Number(off), fn);
        mem.write32(CHILDREN, c.c0 === 0 ? 0 : C0);
        mem.write32(CHILDREN + 4, c.c1 === 0 ? 0 : C1);
        mem.write32(ACTOR + 0x50, c.play ?? 1);
        mem.write32(ACTOR + 0x54, c.cat ?? 3);
        mem.write32(ACTOR + 0x58, c.drill ?? 2);
        mem.write32(ACTOR + 0x5c, c.script ?? 0);
        mem.write32(ACTOR + 0x60, c.result ?? 7);
        mem.write32(ACTOR + 0x64, c.scale ?? 0x800);
        mem.write32(ACTOR + 0x68, c.step ?? 0x199);
        mem.write32(ACTOR + 0x70, c.apply ?? 0);
        mem.write32(ACTOR + 0x74, 0x1000); mem.write32(ACTOR + 0x78, 3);
        mem.write32(ACTOR + 0x80, 0x300); mem.write32(ACTOR + 0x84, 0);
        mem.write32(ACTOR + 0x88, 0x2c0); mem.write32(ACTOR + 0x8c, 0);
        mem.write32(ACTOR + 0x94, c.o1 ?? 1); mem.write32(ACTOR + 0x98, c.o2 ?? 1);
        mem.write32(ACTOR + 0x9c, c.pct ?? 75);
        rands = c.rands ?? [0]; randAt = 0; pending = c.pending ?? 0;
        doneA = c.doneA ?? 1; doneB = c.doneB ?? 1; parseEight = c.parseEight ?? 1;
        void r;
    };
}

function run(label, c) {
    kit.compare(label, {
        seed: seed(c), ranges, ret: false,
        original: () => kit.call(0x800897b8, [ACTOR, CHILDREN], 400000),
        port: () => R.gymRepTick(mem, ACTOR, CHILDREN, host),
    });
}

test("gymRepTick matches F0x800897B8 (building the scene)", () => {
    for (const state of [0, 4, 5, -1, 2, 3]) for (const pending_ of [0, 1]) for (const o1 of [0, 1]) for (const o2 of [0, 1]) {
        for (const c0 of [0, 1]) for (const c1 of [0, 1]) for (const parseEight_ of [0, 1]) {
            run(`default ${state} ${pending_} ${o1} ${o2} ${c0} ${c1} ${parseEight_}`,
                { state, pending: pending_, o1, o2, c0, c1, parseEight: parseEight_, drill: 2 + (c0 + c1) % 2, script: 0 });
        }
    }
});

test("gymRepTick matches F0x800897B8 (the ready states)", () => {
    for (const play of [0, 1, 2, 3, 4, 8, 9]) for (const s1 of [0, 1]) for (const script of [0, 1, 2]) {
        for (const doneA_ of [0, 1]) for (const doneB_ of [0, 1]) for (const c1 of [0, 1]) {
            for (const rands_ of [[0], [74], [75], [76], [99], [175]]) for (const pct of [75, 78, 81, 0, 99]) {
                run(`play ${play} s1 ${s1} script ${script} done ${doneA_}${doneB_} c1 ${c1} rand ${rands_} pct ${pct}`,
                    { play, s1, script, doneA: doneA_, doneB: doneB_, c1, rands: rands_, pct, result: script });
            }
        }
    }
    for (const scale of [0, 0x800, 0xf00, 0xfff, 0x1000, 0x1001, 0x7ff, -1]) for (const step of [0x199, -0x333, 0, 0x1000]) {
        for (const apply of [0, 1]) run(`scale ${scale} ${step} ${apply}`, { play: 2, scale, step, apply });
    }
});

test("the rep actor's methods and constructor match F0x8008A0F4..F0x8008A274", () => {
    const vals = [0, 1, 0x300, 0x2c0, -1, 0x199, 75];
    for (let i = 0; i < vals.length; i++) {
        const a = vals[i], b = vals[(i * 3 + 1) % vals.length];
        for (const [name, addr, args, port] of [
            ["pageOrigin", 0x8008a1d0, [ACTOR, a, b], () => R.gymRepSetPageOrigin(mem, ACTOR, a, b)],
            ["clutOrigin", 0x8008a1e4, [ACTOR, a, b], () => R.gymRepSetClutOrigin(mem, ACTOR, a, b)],
            ["hitPercent", 0x8008a1f8, [ACTOR, a], () => R.gymRepSetHitPercent(mem, ACTOR, a)],
            ["growIn", 0x8008a200, [ACTOR], () => R.gymRepGrowIn(mem, ACTOR)],
            ["shrinkOut", 0x8008a218, [ACTOR], () => R.gymRepShrinkOut(mem, ACTOR)],
            ["setScale", 0x8008a234, [ACTOR, a], () => R.gymRepSetScale(mem, ACTOR, a)],
            ["result", 0x8008a244, [ACTOR], () => R.gymRepResult(mem, ACTOR)],
            ["closingPose", 0x8008a264, [ACTOR], () => R.gymRepClosingPose(mem, ACTOR)],
            ["resume", 0x8008a158, [ACTOR], () => R.gymRepResume(mem, ACTOR, host)],
            ["holdBoth", 0x8008a0f4, [ACTOR], () => R.gymRepHoldBoth(mem, ACTOR, host)],
        ]) {
            for (const c1 of [0, 1]) for (const c0 of [0, 1]) for (const play of [0, 1, 4]) {
                kit.compare(`${name} ${i} ${c0}${c1} ${play}`, {
                    seed: seed({ play, c0, c1, seed: i }), ranges, ret: name === "result",
                    original: () => kit.call(addr, args), port,
                });
            }
        }
    }
    kit.compare("create", { seed: seed({}), ranges,
        original: () => kit.call(0x8008a274, [3, 12, 0x1000, 3]),
        port: () => R.gymRepCreate(mem, { alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; } }, 3, 12, 0x1000, 3) });
});
