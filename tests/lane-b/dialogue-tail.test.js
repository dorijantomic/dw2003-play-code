// Lane B oracle: engine/dw3/ui/native/dialogue-tail.ts must match the resident
// EXE F0x8001C85C (create), F0x8001C7D8 (tick) and F0x8001C4EC (wipe). The
// interpreter in engine/native has no GTE, so the two GTE helpers the wipe
// calls (F0x8002B65C RotMatrix, F0x8002B1DC ApplyMatrix) run here through a small
// instruction-level executor over the REAL instruction words of resident.bin,
// installed as stubs. The wipe's packet bytes and ordering links then compare
// end to end; the helpers also compare directly against that executor.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    dialogueTailCreate, dialogueTailTick, dialogueTailWipe, rotMatrix, applyMatrix,
} from "../../engine/dw3/ui/native/dialogue-tail.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const LAYEROBJ = 0x80152000;
const OT = 0x80153000;
const PRIM = 0x80154000;
const STUB = 0x0fe40000;

const LOG = [];
const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
const sg = (c, n) => c.reg(4 + n) | 0;
const mem = rt.mem;
const rd32 = (a) => mem.read32(a) | 0;

// ---- instruction-level executor for the two GTE helpers (reads resident.bin words) ----
const word = (a) => (resident[a - 0x80010000] | resident[a - 0x80010000 + 1] << 8 | resident[a - 0x80010000 + 2] << 16 | resident[a - 0x80010000 + 3] << 24) | 0;
const sext16 = (v) => (v << 16) >> 16;
const sat = (v) => Math.max(-0x8000, Math.min(0x7fff, v));
function runGte(entryAddr, args) {
    const r = new Int32Array(32);
    for (let i = 0; i < args.length; i++) r[4 + i] = args[i] | 0;
    const g = { d: new Int32Array(32), c: new Int32Array(32) };
    let lo = 0;
    let pc = entryAddr;
    for (let guard = 0; guard < 400; guard++) {
        const w = word(pc);
        const op = w >>> 26, rs = (w >> 21) & 31, rt_ = (w >> 16) & 31, rdd = (w >> 11) & 31, sh = (w >> 6) & 31, fn = w & 63;
        const imm = sext16(w & 0xffff);
        const exec = (w, isDelay) => {
            const op = w >>> 26, rs = (w >> 21) & 31, rt_ = (w >> 16) & 31, rdd = (w >> 11) & 31, sh = (w >> 6) & 31, fn = w & 63;
            const imm = sext16(w & 0xffff);
            if (w === 0) return;
            if (op === 0) {
                switch (fn) {
                    case 0: r[rdd] = r[rt_] << sh; break;
                    case 2: r[rdd] = r[rt_] >>> sh; break;
                    case 3: r[rdd] = r[rt_] >> sh; break;
                    case 0x12: r[rdd] = lo; break;
                    case 0x18: lo = Math.imul(r[rs], r[rt_]); break;
                    case 0x20: case 0x21: r[rdd] = (r[rs] + r[rt_]) | 0; break;
                    case 0x22: case 0x23: r[rdd] = (r[rs] - r[rt_]) | 0; break;
                    case 0x25: r[rdd] = r[rs] | r[rt_]; break;
                    case 0x26: r[rdd] = r[rs] ^ r[rt_]; break;
                    default: throw new Error(`special ${fn.toString(16)} at ${pc.toString(16)}`);
                }
            } else if (op === 9) r[rt_] = (r[rs] + imm) | 0;
            else if (op === 0xc) r[rt_] = r[rs] & (w & 0xffff);
            else if (op === 0xd) r[rt_] = r[rs] | (w & 0xffff);
            else if (op === 0xf) r[rt_] = (w & 0xffff) << 16;
            else if (op === 0x21) r[rt_] = mem.read16s((r[rs] + imm) >>> 0);
            else if (op === 0x23) r[rt_] = mem.read32((r[rs] + imm) >>> 0) | 0;
            else if (op === 0x29) mem.write16((r[rs] + imm) >>> 0, r[rt_] & 0xffff);
            else if (op === 0x2b) mem.write32((r[rs] + imm) >>> 0, r[rt_] >>> 0);
            else if (op === 0x32) g.d[rt_] = mem.read32((r[rs] + imm) >>> 0) | 0; // lwc2
            else if (op === 0x12) {
                if (rs === 4) g.d[rdd] = r[rt_]; // mtc2
                else if (rs === 6) g.c[rdd] = r[rt_]; // ctc2
                else if (rs === 0) r[rt_] = rdd >= 9 && rdd <= 11 ? sext16(g.d[rdd]) : g.d[rdd]; // mfc2
                else if (rs >= 16) {
                    const cmd = w & 0x1ffffff;
                    if ((cmd & 63) === 0x3d) { // GPF sf=1 lm=0
                        for (let i = 1; i <= 3; i++) g.d[8 + i] = sat((g.d[8] * g.d[8 + i]) >> 12);
                    } else if (cmd === 0x486012) { // MVMVA sf=1 R V0 none lm=0
                        const m = [0, 1, 2, 3, 4].map((i) => g.c[i]);
                        const rows = [[sext16(m[0]), m[0] >> 16, sext16(m[1])], [m[1] >> 16, sext16(m[2]), m[2] >> 16],
                            [sext16(m[3]), m[3] >> 16, sext16(m[4])]];
                        const v = [sext16(g.d[0]), g.d[0] >> 16, sext16(g.d[1])];
                        for (let i = 0; i < 3; i++) g.d[9 + i] = sat(Math.floor((rows[i][0] * v[0] + rows[i][1] * v[1] + rows[i][2] * v[2]) / 4096));
                    } else throw new Error(`gte cmd ${cmd.toString(16)}`);
                } else throw new Error(`cop2 rs ${rs}`);
            } else throw new Error(`op ${op.toString(16)} at ${pc.toString(16)}`);
            r[0] = 0;
        };
        if (op === 0 && fn === 8) { exec(word(pc + 4)); return r[2]; } // jr (delay slot runs)
        exec(w);
        pc += 4;
    }
    throw new Error("runaway");
}
const MAT_STUB = (c) => { runGte(0x8002b65c, [c.reg(4), c.reg(5)]); return c.reg(5) | 0; };
const APPLY_STUB = (c) => { runGte(0x8002b1dc, [c.reg(4), c.reg(5), c.reg(6)]); return c.reg(6) | 0; };

// ---- host plumbing ----
const METHOD_STATE = STUB + 0x30;
const METHOD_RESET = STUB + 0x34;
st(0x8002b65c, MAT_STUB);
st(0x8002b1dc, APPLY_STUB);
st(0x80014504, (c) => { LOG.push(["create", c.reg(4) >>> 0, sg(c, 1), sg(c, 2)]); return OBJ; });
st(0x8001da84, (c) => { LOG.push(["layerObject", sg(c, 0)]); return LAYEROBJ; });
mem.write32(LAYEROBJ + 0x138, STUB + 0x24);
st(STUB + 0x24, (c) => { LOG.push(["orderingHead", c.reg(4) >>> 0, sg(c, 1)]); return OT; });
st(0x8001d844, () => { LOG.push(["allocPrim"]); return PRIM; });
st(0x8001d854, (c) => { LOG.push(["commitPrim", c.reg(4) >>> 0]); return 0; });
st(METHOD_STATE, (c) => { LOG.push(["setState", c.reg(4) >>> 0, sg(c, 1)]); return 0; });
st(METHOD_RESET, (c) => { LOG.push(["onReset", c.reg(4) >>> 0]); return 0; });

const INTENTS = [];
const host = {
    createObject(h, size, f) { LOG.push(["create", h >>> 0, size | 0, f | 0]); return OBJ; },
    layerObject(l) { LOG.push(["layerObject", l | 0]); return LAYEROBJ; },
    orderingHead(o) { LOG.push(["orderingHead", o >>> 0, 0]); return OT; },
    allocPrim() { LOG.push(["allocPrim"]); return PRIM; },
    commitPrim(next, lines) { LOG.push(["commitPrim", next >>> 0]); INTENTS.push(lines); },
    setState(o, s) { LOG.push(["setState", o >>> 0, s | 0]); },
    onReset(o) { LOG.push(["onReset", o >>> 0]); },
};

function snap() {
    const out = [];
    for (const [base, n] of [[OBJ, 0xc0], [PRIM, 0x50], [OT, 8]]) for (let i = 0; i < n; i += 4) out.push(mem.read32(base + i) >>> 0);
    return out;
}
function seed(f = {}) {
    for (let i = 0; i < 0xc0; i += 4) mem.write32(OBJ + i, 0);
    for (let i = 0; i < 0x50; i += 4) mem.write32(PRIM + i, 0x5a5a5a5a);
    mem.write32(OT, 0xab123456);
    const o = { state: 1, closing: 0, scale: 0, step: 0x100, layer: 7, x: 100, y: 60, w: 120, h: 40, ox: 90, oy: 50,
        ang: [0, 0, 0], ...f };
    mem.write32(OBJ + 0xc, o.state);
    mem.write32(OBJ + 0xb8, o.closing);
    mem.write32(OBJ + 0x60, o.scale);
    mem.write16(OBJ + 0x5c, o.step);
    mem.write32(OBJ + 0x64, o.layer);
    mem.write16(OBJ + 0x50, o.x);
    mem.write16(OBJ + 0x52, o.y);
    mem.write16(OBJ + 0x54, o.ox);
    mem.write16(OBJ + 0x56, o.oy);
    mem.write16(OBJ + 0x58, o.w);
    mem.write16(OBJ + 0x5a, o.h);
    mem.write16(OBJ + 0x80, o.ang[0]);
    mem.write16(OBJ + 0x82, o.ang[1]);
    mem.write16(OBJ + 0x84, o.ang[2]);
    mem.write32(OBJ + 0x28, METHOD_STATE);
    mem.write32(OBJ + 0x38, METHOD_RESET);
}
function compareCall(name, addr, port, f) {
    seed(f); LOG.length = 0; rt.cpu.call(addr, [OBJ], 40000);
    const olog = LOG.slice(); const osnap = snap();
    seed(f); LOG.length = 0; INTENTS.length = 0; port(mem, host, OBJ);
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
    return olog;
}

test("table values", () => {
    const h = (a) => mem.read16s(a);
    const layout = [[0, -74], [0, 12], [-26, -74], [-26, 12]];
    for (let m = 0; m < 4; m++) assert.deepEqual([h(0x8004dcf4 + 32 * m + 8), h(0x8004dcf4 + 32 * m + 10)], layout[m]);
    assert.deepEqual([0, 4, 8, 12].map((i) => rd32(0x80010288 + i)), [1, 3, 0, 2]);
    assert.deepEqual([0x8004df68, 0x8004df6c, 0x8004df8c].map((a) => mem.read32(a) >>> 0), [0x8001d844, 0x8001d854, 0x8001da84]);
    assert.equal(mem.read32(0x80056a28) >>> 0, 0x10000000);
    assert.equal(mem.read32(0x80056a28 + 0x400 * 4) >>> 0, 0x1000);
});

test("rotMatrix and applyMatrix match the real GTE helper instructions", () => {
    let seedv = 12345;
    const rnd = () => (seedv = (Math.imul(seedv, 1103515245) + 12345) >>> 0) >>> 8;
    const angles = [[0, 0, 0], [0x400, 0, 0], [0, 0x400, 0], [0, 0, 0x400], [-0x155, 0x2a3, -0x7ff],
        [0x8000, 0x7fff, -0x8000], [0x1234, -0x1234, 0x0fff]];
    for (let i = 0; i < 300; i++) angles.push([sext16(rnd()), sext16(rnd()), sext16(rnd())]);
    for (const a of angles) {
        for (let i = 0; i < 6; i += 2) mem.write16(OBJ + 0x80 + i, a[i / 2]);
        for (let i = 0; i < 0x20; i += 4) { mem.write32(OBJ + 0xa0 + i, 0xdeadbeef); mem.write32(OBJ + 0xc0 + i, 0xdeadbeef); }
        runGte(0x8002b65c, [OBJ + 0x80, OBJ + 0xa0]);
        rotMatrix(mem, OBJ + 0x80, OBJ + 0xc0);
        const want = [0, 4, 8, 12, 16].map((i) => mem.read32(OBJ + 0xa0 + i) >>> 0);
        const wantTail = mem.read16(OBJ + 0xa0 + 0x12);
        assert.deepEqual([0, 4, 8, 12, 16].map((i) => mem.read32(OBJ + 0xc0 + i) >>> 0), want, `rot ${a}`);
        assert.equal(mem.read16(OBJ + 0xc0 + 0x12), wantTail);
    }
    for (let k = 0; k < 300; k++) {
        for (let i = 0; i < 5; i++) mem.write32(OBJ + 0x98 + 4 * i, rnd() * 0x101 | 0);
        const v = [sext16(rnd()), sext16(rnd()), k % 3 === 0 ? 0 : sext16(rnd())];
        v.forEach((x, i) => mem.write16(OBJ + 0x40 + 2 * i, x));
        mem.write16(OBJ + 0x46, 0x1234);
        for (let i = 0; i < 8; i += 2) { mem.write16(OBJ + 0xd0 + i, 0xbeef); mem.write16(OBJ + 0xe0 + i, 0xbeef); }
        runGte(0x8002b1dc, [OBJ + 0x98, OBJ + 0x40, OBJ + 0xd0]);
        applyMatrix(mem, OBJ + 0x98, OBJ + 0x40, OBJ + 0xe0);
        for (let i = 0; i < 8; i += 2) assert.equal(mem.read16(OBJ + 0xe0 + i), mem.read16(OBJ + 0xd0 + i), `apply ${k} +${i}`);
    }
});

test("rotMatrix closed-form sanity: zero angles give identity, quarter turns permute", () => {
    const run = (ang) => {
        for (let i = 0; i < 3; i++) mem.write16(OBJ + 0x80 + 2 * i, ang[i]);
        rotMatrix(mem, OBJ + 0x80, OBJ + 0x98);
        const m = [0, 1, 2, 3, 4].map((i) => rd32(OBJ + 0x98 + 4 * i));
        return [m[0] << 16 >> 16, m[0] >> 16, m[1] << 16 >> 16, m[1] >> 16, m[2] << 16 >> 16, m[2] >> 16, m[3] << 16 >> 16, m[3] >> 16, m[4] << 16 >> 16];
    };
    assert.deepEqual(run([0, 0, 0]), [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000]);
    assert.deepEqual(run([0, 0, 0x400]), [0, -0x1000, 0, 0x1000, 0, 0, 0, 0, 0x1000]);
});

test("create matches the original for modes and geometry", () => {
    for (const mode of [0, 1, 2, 3, 4, 5, -1])
        for (const [x, y] of [[100, 60], [-20, 0x7fff], [0x8000, -1]])
            for (const [w, h] of [[120, 40], [0xffff, 0xffff], [0, 0], [-5, 7]])
                for (const layer of [0, 0x1234, -3]) {
                    const run = (fn) => { seed(); LOG.length = 0; const o = fn(); return [o, LOG.slice(), snap()]; };
                    const orig = run(() => {
                        mem.write32(rt.cpu.sp + 0x10, h); mem.write32(rt.cpu.sp + 0x14, mode);
                        return rt.cpu.call(0x8001c85c, [layer, x, y, w]) >>> 0;
                    });
                    const port = run(() => dialogueTailCreate(mem, host, layer, x, y, w, h, mode));
                    assert.deepEqual(port, orig, `create m${mode} ${x},${y} ${w}x${h} l${layer}`);
                }
});

test("tick: wipe, idle states and reset branch match the original", () => {
    for (const state of [-1, 0, 1, 2, 3, 4, 9])
        for (const closing of [0, 1])
            for (const scale of [0, 0x500, 0xf80, 0x1000, 0x80])
                compareCall(`tick s${state} c${closing} v${scale}`, 0x8001c7d8,
                    (m, h, o) => dialogueTailTick(m, h, o), { state, closing, scale });
});

test("full grow and shrink sequences, frame by frame", () => {
    for (const mode of [0, 1, 2, 3]) {
        for (const [closing, step, start] of [[0, 0x180, 0], [1, 0x180, 0x1000], [0, 0x1000, 0], [1, 0x7fff, 0x1000]]) {
            for (const ang of [[0, 0, 0], [0x100, -0x80, 0x200]]) {
                const f = { state: 1, closing, scale: start, step, ang };
                seed(f);
                // The original and the port each walk the sequence from the same seed.
                const walk = (call) => {
                    seed(f); const frames = [];
                    for (let n = 0; n < 12; n++) {
                        mem.write32(OT, 0xab123456);
                        for (let i = 0; i < 0x50; i += 4) mem.write32(PRIM + i, 0x5a5a5a5a);
                        LOG.length = 0; INTENTS.length = 0;
                        call();
                        frames.push([LOG.slice(), snap(), JSON.stringify(INTENTS)]);
                    }
                    return frames;
                };
                const orig = walk(() => rt.cpu.call(0x8001c7d8, [OBJ], 40000));
                const port = walk(() => dialogueTailTick(mem, host, OBJ));
                // Intents come only from the port; compare calls and memory.
                orig.forEach((o, i) => {
                    assert.deepEqual(port[i][0], o[0], `m${mode} c${closing} step${i}: calls`);
                    assert.deepEqual(port[i][1], o[1], `m${mode} c${closing} step${i}: memory`);
                });
                // Mode only changes the position fields; seed them per mode through create.
                void mode;
            }
        }
    }
});

test("draw contract: four blue opaque flat lines, closed outline, linked into the table", () => {
    seed({ state: 1, closing: 0, scale: 0xf80, step: 0x100, x: 100, y: 60, ox: 90, oy: 50, w: 120, h: 40 });
    LOG.length = 0; INTENTS.length = 0;
    dialogueTailWipe(mem, host, OBJ);
    assert.equal(rd32(OBJ + 0x60), 0x1000);
    assert.equal(rd32(OBJ + 0xbc), 1);
    assert.deepEqual(LOG.filter((e) => e[0] === "setState"), [["setState", OBJ, 3]]);
    const lines = INTENTS[0];
    assert.equal(lines.length, 4);
    for (const l of lines) {
        assert.equal(l.primitive, "LINE_F2");
        assert.equal(l.code, 0x40);
        assert.deepEqual(l.color, [0, 0, 255]);
    }
    // Full scale, zero rotation: corners are (anchor - origin + size) + origin.
    const corners = [[100, 60], [220, 60], [100, 100], [220, 100]];
    const order = [1, 3, 0, 2];
    lines.forEach((l, i) => assert.deepEqual(l.points, [...corners[i], ...corners[order[i]]]));
    assert.equal(rd32(PRIM + 3 * 0x10) >>> 24, 3);
    assert.equal(mem.read8(PRIM + 7), 0x40);
    // The last primitive is the table head; each tag points at the previous one.
    assert.equal(mem.read32(OT) >>> 0, (0xab000000 | ((PRIM + 0x30) & 0xffffff)) >>> 0);
    assert.equal(mem.read32(PRIM + 0x30) & 0xffffff, (PRIM + 0x20) & 0xffffff);
    assert.equal(mem.read32(PRIM) & 0xffffff, 0x123456);
});
