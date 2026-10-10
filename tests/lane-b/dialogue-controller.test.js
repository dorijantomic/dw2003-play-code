// Lane B oracle: engine/dw3/ui/native/dialogue-controller.ts must match the
// fieldstg overlay (load base 0x80082CB0) F0x80088CA0 (SAY creator), F0x80088D38
// (talk creator), F0x80088B84 (tick) and F0x80088A84 (anchor). The originals run
// through engine/native on resident.bin + fieldstg.bin; task create, projector,
// pack getters, window builders and the vtable methods are stubbed on both sides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    dialogueAnchor,
    dialogueControllerTick,
    dialogueSayCreate,
    dialogueTalkCreate,
} from "../../engine/dw3/ui/native/dialogue-controller.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native");
const resident = new Uint8Array(readFileSync(join(root, "screens/resident.bin")));
const fieldstg = new Uint8Array(readFileSync(join(root, "fieldstg.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TASK = 0x80150000;
const ACTOR = 0x80150200;
const NPC = 0x80150300;
const CELL = 0x80150400;
const OUT = 0x80150500;
const CHILD = 0x80150600;
const STUB = 0x0fe40000;
const PROJ_CELL = 0x8009b3d4;
const SAY_PACK_CELL = 0x80044f5c, TALK_PACK_CELL = 0x80044f4c;
const SAY_H = 0x80099dc8, TALK_H = 0x80099dc4;
const PACK_SAY = 0x80771000, PACK_TALK = 0x80772000;

const LOG = [];
const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, fieldstg, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
const sg = (c, n) => c.reg(4 + n) | 0;
const sw = (a) => rt.mem.read32(a) | 0;

// Deterministic non-linear "projector" so wrong inputs cannot cancel.
const PROJ = { dx: 0, dy: 0, fixed: null };
const projFn = (x, y) => PROJ.fixed ?? [x + PROJ.dx, y + PROJ.dy];
st(STUB + 0x00, (c) => {
    const p = c.reg(4) >>> 0;
    const x = sw(p), y = sw(p + 4);
    LOG.push(["project", x, y]);
    const [ox, oy] = projFn(x, y);
    rt.mem.write32(p, ox); rt.mem.write32(p + 4, oy);
    return 0;
});
rt.mem.write32(PROJ_CELL, STUB + 0x00);
st(STUB + 0x04, (c) => { LOG.push(["sayPack", sg(c, 0)]); return PACK_SAY; });
st(STUB + 0x08, (c) => { LOG.push(["talkPack", sg(c, 0)]); return PACK_TALK; });
rt.mem.write32(SAY_PACK_CELL, STUB + 0x04);
rt.mem.write32(TALK_PACK_CELL, STUB + 0x08);
st(0x80014504, (c) => { LOG.push(["task", c.reg(4) >>> 0, sg(c, 1), sg(c, 2)]); return TASK; });
st(0x8001ce44, (c) => {
    const sp = c.reg(29) >>> 0;
    LOG.push(["balloon", sg(c, 0), sg(c, 1), sg(c, 2), sg(c, 3), sw(sp + 0x10), sw(sp + 0x14)]);
    return CHILD;
});
st(0x8001be00, (c) => { LOG.push(["plain", sg(c, 0), sg(c, 1), sg(c, 2)]); return CHILD; });
const METH = { 0x28: 1, 0x38: 0 };
const slotAddr = {};
for (const [slot, argc] of Object.entries(METH)) {
    const addr = STUB + 0x100 + Number(slot);
    slotAddr[slot] = addr;
    st(addr, (c) => { LOG.push(["method", c.reg(4) >>> 0, Number(slot), ...Array.from({ length: argc }, (_, i) => sg(c, 1 + i))]); return 0; });
}
st(STUB + 0x168, (c) => { LOG.push(["method", c.reg(4) >>> 0, 0x68, sg(c, 1), sg(c, 2)]); return 0; });

const host = {
    createTask(tick, size, align) { LOG.push(["task", tick, size, align]); return TASK; },
    sayPack(h) { LOG.push(["sayPack", h | 0]); return PACK_SAY; },
    talkPack(h) { LOG.push(["talkPack", h | 0]); return PACK_TALK; },
    project(x, y) {
        LOG.push(["project", x | 0, y | 0]);
        const [ox, oy] = projFn(x | 0, y | 0);
        return [ox | 0, oy | 0];
    },
    buildBalloon(k, x, y, p, l, m) { LOG.push(["balloon", k | 0, x | 0, y | 0, p | 0, l | 0, m | 0]); return CHILD; },
    buildPlain(k, p, l) { LOG.push(["plain", k | 0, p | 0, l | 0]); return CHILD; },
    callMethod(o, slot, args) { LOG.push(["method", o >>> 0, slot, ...args.map((a) => a | 0)]); },
};

function snap() {
    const out = [];
    for (const base of [TASK, ACTOR, NPC, CELL, OUT])
        for (let i = 0; i < 0x80; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
    return out;
}
function seed(c = {}) {
    for (const base of [TASK, ACTOR, NPC, CELL, OUT, CHILD])
        for (let i = 0; i < 0x80; i += 4) rt.mem.write32(base + i, 0);
    const f = { state: 1, mode: 0, plain: 0, line: 0x77, pack: 0x555, actorId: 1, ax: 100, ay: 130, facing: 0, child: CHILD, ...c };
    rt.mem.write32(TASK + 0x0c, f.state);
    rt.mem.write32(TASK + 0x28, slotAddr[0x28]);
    rt.mem.write32(TASK + 0x38, slotAddr[0x38]);
    rt.mem.write32(TASK + 0x50, c.npc ? NPC : ACTOR);
    rt.mem.write32(TASK + 0x54, f.line);
    rt.mem.write32(TASK + 0x58, f.mode);
    rt.mem.write32(TASK + 0x5c, f.plain);
    rt.mem.write32(TASK + 0x60, f.pack);
    for (const a of [ACTOR, NPC]) {
        rt.mem.write32(a + 4, f.actorId);
        rt.mem.write32(a + 0x58, f.ax);
        rt.mem.write32(a + 0x5c, f.ay);
        rt.mem.write32(a + 0x60, f.facing);
    }
    rt.mem.write32(CHILD + 0x68, STUB + 0x168);
    rt.mem.write32(CELL, f.child);
    rt.mem.write32(SAY_H, 0x1111);
    rt.mem.write32(TALK_H, -0x2222);
    PROJ.dx = f.dx ?? 3; PROJ.dy = f.dy ?? -5; PROJ.fixed = f.fixed ?? null;
}
function compare(name, c, orig, port) {
    seed(c); LOG.length = 0; orig();
    const olog = LOG.slice(); const osnap = snap();
    seed(c); LOG.length = 0; port();
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
    return olog;
}

test("SAY creator matches F0x80088CA0", () => {
    for (const [a, l, m, p] of [[ACTOR, 5, 0, 0], [0, 9, 4, 1], [ACTOR, -1, 3, 0], [ACTOR, 0x1234, 2, 7]]) {
        const log = compare(`say ${a} ${l} ${m} ${p}`, {},
            () => { assert.equal(rt.cpu.call(0x80088ca0, [a, l, m, p], 5000) >>> 0, TASK); },
            () => { assert.equal(dialogueSayCreate(rt.mem, host, a, l, m, p), TASK); });
        assert.deepEqual(log[0], ["task", 0x80088b84, 0x64, 4]);
        assert.deepEqual(log[1], ["sayPack", 0x1111]);
        assert.equal(sw(TASK + 0x58), m);
        assert.equal(sw(TASK + 0x5c), p);
        assert.equal(sw(TASK + 0x60), PACK_SAY | 0);
    }
});

test("talk creator: every facing and a screen sweep across the flip thresholds", () => {
    const xs = [-1, 0, 100, 159, 160, 161, 300, 0x7fffffff, -0x80000000];
    const ys = [-1, 0, 120, 121, 122, 171, 172, 173, 400, 0x7fffffff, -0x80000000];
    const seen = new Map();
    for (const facing of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x80000000, -1])
        for (const x of xs)
            for (const y of ys) {
                compare(`talk f${facing} ${x},${y}`, { facing, fixed: [x, y], npc: true },
                    () => { assert.equal(rt.cpu.call(0x80088d38, [NPC, 0x31], 5000) >>> 0, TASK); },
                    () => { assert.equal(dialogueTalkCreate(rt.mem, host, NPC, 0x31), TASK); });
                assert.equal(sw(TASK + 0x5c), 0);
                seen.set(`${facing}:${x >= 160 ? "R" : "L"}:${y < 121 ? "top" : y >= 172 ? "bot" : "mid"}`, sw(TASK + 0x58));
            }
    // Measured table (facing group, side, vertical band -> mode).
    for (const f of [0, 1, 2, 6, 7, 8, -1]) {
        assert.equal(seen.get(`${f}:R:mid`), 0); assert.equal(seen.get(`${f}:L:mid`), 2);
        assert.equal(seen.get(`${f}:R:top`), 1); assert.equal(seen.get(`${f}:L:top`), 3);
        assert.equal(seen.get(`${f}:R:bot`), 0); assert.equal(seen.get(`${f}:L:bot`), 2);
    }
    for (const f of [3, 4, 5]) {
        assert.equal(seen.get(`${f}:R:mid`), 1); assert.equal(seen.get(`${f}:L:mid`), 3);
        assert.equal(seen.get(`${f}:R:top`), 1); assert.equal(seen.get(`${f}:L:top`), 3);
        assert.equal(seen.get(`${f}:R:bot`), 0); assert.equal(seen.get(`${f}:L:bot`), 2);
    }
});

test("anchor: modes, the 0xD6 quirk and signed positions", () => {
    for (const mode of [0, 1, 2, 3, 4, -1, 0x80000000])
        for (const actorId of [1, 0xd6, 0xd7, 0x1d6])
            for (const [ax, ay] of [[0, 0], [100, 130], [-7, -300], [0x7fffffff, 0x7fffffff]]) {
                compare(`anchor m${mode} id${actorId} ${ax},${ay}`, { mode, actorId, ax, ay },
                    () => { rt.cpu.call(0x80088a84, [TASK, OUT], 5000); },
                    () => { const [x, y] = dialogueAnchor(rt.mem, host, TASK); rt.mem.write32(OUT, x); rt.mem.write32(OUT + 4, y); });
            }
    seed({ mode: 3, ax: 100, ay: 130, dx: 0, dy: 0 });
    rt.cpu.call(0x80088a84, [TASK, OUT], 5000);
    assert.deepEqual([sw(OUT), sw(OUT + 4)], [89, 123]);
    seed({ mode: 0, ax: 100, ay: 130, dx: 0, dy: 0, actorId: 0xd6 });
    rt.cpu.call(0x80088a84, [TASK, OUT], 5000);
    assert.deepEqual([sw(OUT), sw(OUT + 4)], [111, 130 - 21 - 19]);
});

const tickOrig = () => rt.cpu.call(0x80088b84, [TASK, CELL], 5000);
const tickPort = () => dialogueControllerTick(rt.mem, host, TASK, CELL);

test("tick state 0 / other: builds the balloon or plain window then advances", () => {
    for (const state of [-1, 0, 2, 3, 4, 9])
        for (const plain of [0, 1, -1])
            for (const mode of [0, 2, 3])
                for (const [ax, ay] of [[100, 130], [0x7fff0000, -0x7fff0000]])
                    compare(`state ${state} plain ${plain} m${mode}`, { state, plain, mode, ax, ay, child: 0 }, tickOrig, tickPort);
    seed({ state: 0, plain: 0, mode: 2, child: 0 }); LOG.length = 0; tickOrig();
    assert.equal(sw(CELL), CHILD | 0);
    assert.deepEqual(LOG.map((e) => e[0]), ["project", "balloon", "method"]);
    seed({ state: 0, plain: 1, child: 0 }); LOG.length = 0; tickOrig();
    assert.deepEqual(LOG.map((e) => e[0]), ["plain", "method"]);
});

test("tick state 1: re-anchor, plain skips, NULL child closes", () => {
    for (const plain of [0, 1, -1])
        for (const child of [CHILD, 0])
            for (const mode of [0, 1, 2, 3])
                compare(`s1 plain ${plain} child ${child} m${mode}`, { state: 1, plain, child, mode, actorId: 0xd6 }, tickOrig, tickPort);
    seed({ state: 1, child: 0 }); LOG.length = 0; tickOrig();
    assert.deepEqual(LOG, [["method", TASK, 0x28, 3]]);
    seed({ state: 1, plain: 0, mode: 2 }); LOG.length = 0; tickOrig();
    assert.deepEqual(LOG.map((e) => e[0]), ["project", "method"]);
});
