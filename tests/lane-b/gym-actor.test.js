// Oracle: engine/dw3/ui/native/gym-actor.ts must match the original pro/stgtrain animated
// sprite actor: the class constructor F0x80083880, the eleven methods F0x80083058..F0x80083120
// and the handler F0x80083150. The original runs through engine/native with the display
// services stubbed; the GPU packets it writes are decoded back into the primitives the port
// records, so every sprite, quad and draw-mode packet is compared field by field. Real TRANIN
// clip directories and scripts are used besides a synthetic set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createKit, rng } from "./gym-kit.js";
import * as A from "../../engine/dw3/ui/native/gym-actor.ts";
import * as P from "../../engine/dw3/ui/native/gym-packs.ts";
import { rotMatrixZero, scaleMatrix, applyMatrixXY } from "../../engine/dw3/ui/native/gym-gte.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/gym");
const TRANIN = new Uint8Array(readFileSync(join(data, "tranin/606.bin")));
const kit = createKit();
const mem = kit.mem;
const ACTOR = 0x80150000;
const NEW = 0x80150400;
const DATA = 0x80160000;
const SCRIPT = 0x80170000;
const PKT = 0x80180000;
const FILE = 0x80110000;
const OT = 0x80190000;
const VIEW = 0x801a0000;
const SVC = 0x8004de10;
let ticks = [];
let tickAt = 0;
const nextTick = () => ticks[Math.min(tickAt++, ticks.length - 1)];

// Decode the packets between the cursor and its end into the port's primitive events.
function decode(end) {
    const out = [];
    let p = PKT;
    while (p < end) {
        const len = mem.read8(p + 3);
        const code = mem.read8(p + 7);
        if (len === 1) { out.push(["drawMode", mem.read32(p + 4) & 0xffff]); p += 8; continue; }
        const h = (o) => mem.read16(p + o);
        const b = (o) => mem.read8(p + o);
        if (code === 0x64 || code === 0x66) {
            out.push(["sprite", h(8), h(10), b(12), b(13), h(0x10), h(0x12), h(14), code]);
            assert.equal(len, 4); assert.deepEqual([b(4), b(5), b(6)], [0x80, 0x80, 0x80]);
            p += 0x14;
        } else {
            assert.equal(len, 9);
            out.push(["quad", h(8), h(10), h(0x10), h(0x12), h(0x18), h(0x1a), h(0x20), h(0x22),
                b(12), b(13), b(0x14), b(0x15), b(0x1c), b(0x1d), b(0x24), b(0x25), h(14), h(0x16), code]);
            p += 0x28;
        }
    }
    return out;
}

kit.cell(SVC + 0x188, "frameTick", () => nextTick(), { args: 0, silent: true });
kit.mem.write32(0x8004df98, mem.read32(SVC + 0x188));   // the same cell: [0x8004DE10 + 0x188]
kit.cell(SVC + 0x17c, "view", () => VIEW, { args: 1 });
kit.mem.write32(VIEW + 0x138, kit.stub("slot", () => OT, { args: 2 }));
kit.cell(SVC + 0x158, "cursor", () => PKT, { args: 0, silent: true });
kit.cell(0x8004df6c, "flush", 0, { args: 1, silent: true,
    before: (_c, a) => { for (const e of decode(a[0] >>> 0)) kit.push(...e); kit.push("flush"); } });
kit.at(0x8002915c, "drawMode", 0, { args: 4, silent: true,
    before: (_c, a) => { mem.write32(a[0], 0x01000000); mem.write32(a[0] + 4, 0xe1000000 | (a[3] & 0xffff)); } });
kit.at(0x8002b65c, "rot", 0, { args: 2, before: (_c, a) => rotMatrixZero(mem, a[0], a[1]) });
kit.at(0x8002b23c, "scale", 0, { args: 2, before: (_c, a) => scaleMatrix(mem, a[0], a[1]) });
kit.at(0x8002b1dc, "apply", 0, { args: 3, silent: true, before: (_c, a) => {
    const [x, y] = applyMatrixXY(mem, a[0], mem.read16(a[1]), mem.read16(a[1] + 2));
    kit.push("apply", a[0], mem.read16(a[1]), mem.read16(a[1] + 2));
    mem.write16(a[2], x & 0xffff); mem.write16(a[2] + 2, y & 0xffff); mem.write16(a[2] + 4, 0);
} });
const M38 = kit.stub("advance", 0, { args: 1 });
kit.at(0x80014504, "alloc", () => NEW, { args: 3 });

const held = [];
const host = {
    frameTick() { return nextTick(); },
    advance(a) { kit.push("advance", a); },
    orderingSlot(target, bucket) { kit.push("view", target); kit.push("slot", VIEW, bucket); return { view: VIEW, slot: OT }; },
    // The original's packets are decoded when the run closes, so the port's primitives are held to it.
    drawMode(t) { held.push(["drawMode", t]); },
    sprite(p) { held.push(["sprite", p.x, p.y, p.u, p.v, p.w, p.h, p.clut, p.code]); },
    quad(q) { held.push(["quad", q.x[0], q.y[0], q.x[1], q.y[1], q.x[2], q.y[2], q.x[3], q.y[3],
        q.u[0], q.v[0], q.u[1], q.v[1], q.u[2], q.v[2], q.u[3], q.v[3], q.clut, q.tpage, q.code]); },
    flush() { for (const e of held.splice(0)) kit.push(...e); kit.push("flush"); },
    rotMatrix(angles, matrix) { kit.push("rot", angles, matrix); rotMatrixZero(mem, angles, matrix); },
    scaleMatrix(matrix, scale) { kit.push("scale", matrix, scale); scaleMatrix(mem, matrix, scale); },
    applyMatrix(m, x, y) { kit.push("apply", m, x & 0xffff, y & 0xffff); return applyMatrixXY(mem, m, x, y); },
};
// The port's view lookup event must equal the original's two calls: [0x17C](target) and the slot.
const ranges = [[ACTOR, 0x110], [NEW, 0x110]];

function synthetic(r) {
    // Clip directory: 4 clips of 0..4 layers; script: 6 rows.
    let p = DATA;
    const clips = [];
    for (let k = 0; k < 4; k++) {
        const n = Math.floor(r() * 5);
        mem.write32(p, n); p += 4;
        for (let l = 0; l < n; l++) {
            for (let i = 0; i < 0x14; i += 2) mem.write16(p + i, (r() * 0x10000) | 0);
            mem.write16(p + 6, ((r() * 4) | 0) | (((r() * 4) | 0) << 5));   // page offset and mode
            if (r() < 0.5) mem.write16(p + 4, mem.read16(p + 4) | 0x8000); else mem.write16(p + 4, mem.read16(p + 4) & 0x7fff);
            mem.write16(p + 8, 1 + ((r() * 60) | 0)); mem.write16(p + 10, 1 + ((r() * 60) | 0));
            p += 0x14;
        }
        clips.push(n);
    }
    mem.write16(SCRIPT, 0x124); mem.write16(SCRIPT + 2, 6);
    for (let i = 0; i < 6; i++) {
        mem.write16(SCRIPT + 4 + i * 8, (r() * 4) | 0);
        mem.write16(SCRIPT + 6 + i * 8, (r() * 12) | 0);
        mem.write16(SCRIPT + 8 + i * 8, ((r() * 60) | 0) - 30);
        mem.write16(SCRIPT + 10 + i * 8, ((r() * 60) | 0) - 30);
    }
}

function setup(c) {
    return () => {
        kit.fill(ACTOR, 0x110, () => 0); kit.fill(NEW, 0x110, () => 0);
        const r = rng(c.seed);
        if (c.real) {
            mem.load(TRANIN, FILE);
            mem.write32(P.GYM_PACKS + 4, FILE);
            P.gymPackParse(mem, c.real.slot);
            mem.write32(ACTOR + 0x80, P.gymPackClips(mem, c.real.slot));
            mem.write32(ACTOR + 0x88, P.gymPackDataOffset(mem, c.real.slot));
            mem.write32(ACTOR + 0x8c, P.gymPackScript(mem, c.real.slot, c.real.script));
            mem.write32(ACTOR + 0x94, mem.read16(mem.read32(ACTOR + 0x8c) + 2));
        } else {
            synthetic(r);
            mem.write32(ACTOR + 0x80, DATA); mem.write32(ACTOR + 0x88, 0); mem.write32(ACTOR + 0x8c, SCRIPT);
            mem.write32(ACTOR + 0x94, 6);
        }
        mem.write32(ACTOR + 0x38, M38);
        mem.write32(ACTOR + 0x0c, c.state ?? 1);
        mem.write32(ACTOR + 0x78, c.flag ?? 0);
        mem.write32(ACTOR + 0x90, Math.min(c.step ?? 0, Math.max(0, (mem.read32(ACTOR + 0x94) | 0) - 1)));
        mem.write32(ACTOR + 0x98, c.stamp ?? 0);
        mem.write32(ACTOR + 0x58, 0x1000); mem.write32(ACTOR + 0x5c, 3);
        mem.write32(ACTOR + 0x60, 82); mem.write32(ACTOR + 0x64, 31);
        mem.write32(ACTOR + 0x68, 0x300); mem.write32(ACTOR + 0x6c, (c.pageY ?? 0));
        mem.write32(ACTOR + 0x70, 0x2c0); mem.write32(ACTOR + 0x74, 0);
        mem.write32(ACTOR + 0x9c, c.scale ? 1 : 0);
        mem.write32(ACTOR + 0xa0, 0xcf); mem.write32(ACTOR + 0xa4, 0x7f);
        mem.write32(ACTOR + 0xa8, c.scale?.[0] ?? 0x1000); mem.write32(ACTOR + 0xac, c.scale?.[1] ?? 0x1000); mem.write32(ACTOR + 0xb0, 0x1000);
        ticks = c.ticks ?? [100, 100, 100, 100]; tickAt = 0;
    };
}

function run(label, c) {
    kit.compare(label, {
        seed: setup(c), ranges, ret: false,
        original: () => kit.call(0x80083150, [ACTOR], 4000000),
        port: () => A.gymActorTick(mem, ACTOR, host),
    });
}

test("gymActorTick matches F0x80083150 on synthetic clips", () => {
    for (let seed = 1; seed <= 60; seed++) {
        for (const state of [1, 0, 2, 3, 4, -1]) run(`state ${state} seed ${seed}`, { seed, state, stamp: 100 - (seed % 9), step: seed % 6, pageY: seed % 2 ? 0x100 : 0x200 });
    }
    for (let seed = 100; seed < 140; seed++) {
        for (const flag of [0, 1, 0x80000000 | 0]) for (const step of [0, 4, 5, 6]) {
            run(`flag ${flag} step ${step} seed ${seed}`, { seed, flag, step, stamp: 90, ticks: [100, 101, 101] });
        }
    }
});

test("gymActorTick matches F0x80083150 with the scale flag", () => {
    for (let seed = 200; seed < 240; seed++) {
        for (const scale of [[0x800, 0x800], [0x199, 0x199], [0, 0], [0, 0x700], [0x1000, 0x1000], [0x1000, 0x800], [0xffff, 0xffff]]) {
            run(`scale ${scale} seed ${seed}`, { seed, scale, stamp: 100 });
        }
    }
});

test("gymActorTick matches F0x80083150 on the shipped TRANIN00 scripts", () => {
    for (const slot of [0, 3, 7, 8]) for (let script = 0; script < 6; script++) {
        for (const step of [0, 1, 2, 5, 9, 14]) for (const stamp of [0, 100]) {
            run(`real ${slot} ${script} ${step} ${stamp}`, { seed: 1, real: { slot, script }, step, stamp, ticks: [100, 105, 105] });
        }
        run(`real scaled ${slot} ${script}`, { seed: 1, real: { slot, script }, scale: [0x333, 0x333], ticks: [100, 100] });
    }
});

test("the actor's methods and constructor match F0x80083058..F0x80083120 and F0x80083880", () => {
    const setup2 = (seed) => () => {
        const r = rng(seed);
        kit.fill(ACTOR, 0x110, () => (r() * 0x100000000) >>> 0); kit.fill(NEW, 0x110, () => 0);
        mem.load(TRANIN.subarray(0, 0x40), DATA); mem.load(TRANIN.subarray(0x100, 0x140), SCRIPT);
    };
    const arg = (n) => [0, 1, 0x1000, 0x7fff, 0xffff, 0x12345, -1, -0x8000][n % 8];
    for (let s = 0; s < 40; s++) {
        const [a, b, c2] = [arg(s), arg(s * 3 + 1), arg(s * 5 + 2)];
        const cases = [
            ["setData", 0x80083058, () => A.gymActorSetData(mem, ACTOR, DATA, b), [ACTOR, DATA, b]],
            ["setScript", 0x80083078, () => A.gymActorSetScript(mem, ACTOR, s % 5 ? SCRIPT : 0), [ACTOR, s % 5 ? SCRIPT : 0]],
            ["setLayer", 0x800830a0, () => A.gymActorSetLayer(mem, ACTOR, a, b), [ACTOR, a, b]],
            ["setOrigin", 0x800830ac, () => A.gymActorSetOrigin(mem, ACTOR, a, b), [ACTOR, a, b]],
            ["setPage", 0x800830b8, () => A.gymActorSetPage(mem, ACTOR, a, b), [ACTOR, a, b]],
            ["setClut", 0x800830c4, () => A.gymActorSetClut(mem, ACTOR, a, b), [ACTOR, a, b]],
            ["setScale", 0x800830d0, () => A.gymActorSetScale(mem, ACTOR, a, b, c2), [ACTOR, a, b, c2]],
            ["setPivot", 0x800830e8, () => A.gymActorSetPivot(mem, ACTOR, a, b), [ACTOR, a, b]],
            ["setRotation", 0x800830f4, () => A.gymActorSetRotation(mem, ACTOR, a, b, c2), [ACTOR, a, b, c2]],
            ["isDone", 0x8008310c, () => A.gymActorIsDone(mem, ACTOR), [ACTOR]],
            ["hold", 0x80083120, () => A.gymActorHold(mem, ACTOR, a), [ACTOR, a]],
        ];
        for (const [name, addr, port, args] of cases) {
            kit.compare(`${name} ${s}`, { seed: setup2(s), ranges, ret: name === "setData" || name === "isDone" || name === "hold",
                original: () => kit.call(addr, args), port });
        }
    }
    kit.compare("create", { seed: setup2(1), ranges,
        original: () => kit.call(0x80083880, []),
        port: () => A.gymActorCreate(mem, { alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; } }) });
});
