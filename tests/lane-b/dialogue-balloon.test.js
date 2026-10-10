// Lane B oracle: engine/dw3/ui/native/dialogue-balloon.ts must match the
// resident EXE F0x8001CE44 (balloon build), F0x8001CAB0 (tick) and F0x8001C948
// (reposition). The originals run through engine/native on resident.bin; the
// task factory, text factory, tail and marker spawners, fetcher entries, widget
// methods, pad service and SFX entry are stubbed on both sides. F0x8002529C is
// run natively on both sides (it is unported).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    dialogueBalloonBuild,
    dialogueBalloonTick,
    dialogueBalloonReposition,
    BALLOON_LAYOUT_TABLE,
} from "../../engine/dw3/ui/native/dialogue-balloon.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TASK = 0x80150000, STATE = 0x80152000, TAB = 0x80150200, BODY = 0x80150400;
const TAIL = [0x80151000, 0x80151200, 0x80151400], MARKER = 0x80151600, NEWTAIL = 0x80151800;
const SCR = 0x80150a00, TEXT = 0x80150c00;
const STUB = 0x0fe40000;
const PAD_READ_CELL = 0x8004b7d0 + 0x3f4, PAD_SHIFT_CELL = 0x8004b7d0 + 0x408, SOUND_CELL = 0x80055c48;
const M = { 0x160: 1, 0x114: 2, 0x130: 1, 0x14c: 0, 0x134: 2, 0x138: 1, 0x144: 1, 0x168: 0, 0x170: 0, 0x128: 0 };
const BASE = { 0x28: 1, 0x2c: 1, 0x40: 0 };
const ALL = { ...M, ...BASE };

const LOG = [];
const CTL = { m168: 0, m170: 0, pad: 0, shift: 0, width: 0x70 };
let BUFADDR = null; // normalises the stack/scratch name buffer address

const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
const norm = (v) => (v >>> 0 === BUFADDR ? "BUF" : v | 0);
const str = (a) => { const o = []; for (let i = 0; i < 0x40; i++) { const b = rt.mem.read8((a + i) >>> 0); o.push(b); if (b === 0) break; } return o.join(","); };
const result = (slot) => (slot === 0x168 ? CTL.m168 : slot === 0x170 ? CTL.m170 : 0);

const slotAddr = {};
let idx = 0;
for (const [slot, n] of Object.entries(ALL)) {
    const s = Number(slot), addr = STUB + 0x100 + 4 * idx++;
    slotAddr[s] = addr;
    st(addr, (c) => {
        const args = [];
        for (let i = 0; i < n; i++) args.push(norm(c.reg(5 + i)));
        const extra = s === 0x114 ? [str(c.reg(5) >>> 0)] : [];
        LOG.push(["method", c.reg(4) >>> 0, s, ...args, ...extra]);
        return result(s);
    });
}
const vt = (o) => { for (const s of Object.keys(ALL)) rt.mem.write32(o + Number(s), slotAddr[s]); };

st(0x80014504, (c) => { LOG.push(["task", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return TASK; });
st(0x8001ae38, (c) => { LOG.push(["text", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return c.reg(5) === 2 ? TAB : BODY; });
st(0x8001c85c, (c) => {
    const sp = c.reg(29) >>> 0;
    LOG.push(["tail", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0, rt.mem.read32(sp + 0x10) | 0, rt.mem.read32(sp + 0x14) | 0]);
    return NEWTAIL;
});
st(0x8001c4b4, (c) => { LOG.push(["marker", c.reg(4) >>> 0]); return MARKER; });
st(0x8001f744, (c) => { LOG.push(["fetch", c.reg(4) >>> 0, c.reg(5) | 0]); return TEXT; });
st(0x8001f770, (c) => {
    BUFADDR = null;
    LOG.push(["measure", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]);
    return CTL.width;
});
st(STUB + 0x10, (c) => { LOG.push(["padRead", c.reg(4) | 0]); return CTL.pad; });
st(STUB + 0x14, (c) => { LOG.push(["padShift", c.reg(4) | 0, c.reg(5) | 0]); return CTL.shift; });
st(STUB + 0x18, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
rt.mem.write32(PAD_READ_CELL, STUB + 0x10);
rt.mem.write32(PAD_SHIFT_CELL, STUB + 0x14);
rt.mem.write32(SOUND_CELL, STUB + 0x18);

const portHost = () => ({
    createTask(t, s, a) { LOG.push(["task", t, s, a]); return TASK; },
    createText(k, f, x, y) { LOG.push(["text", k, f, x, y]); return f === 2 ? TAB : BODY; },
    createTail(...a) { LOG.push(["tail", ...a]); return NEWTAIL; },
    createMarker(t) { LOG.push(["marker", t]); return MARKER; },
    copyBounded(d, s, n) { rt.cpu.call(0x8002529c, [d, s, n]); },
    callMethod(t, slot, args) {
        const extra = slot === 0x114 ? [str(args[0])] : [];
        LOG.push(["method", t >>> 0, slot, ...args.map(norm), ...extra]);
        return result(slot);
    },
    callFetcher(fn, args) {
        if (fn === 0x8001f744) { LOG.push(["fetch", args[0] >>> 0, args[1] | 0]); return TEXT; }
        assert.equal(fn, 0x8001f770);
        LOG.push(["measure", args[0] >>> 0, args[1] | 0, args[2] | 0]);
        return CTL.width;
    },
    padRead(p) { LOG.push(["padRead", p | 0]); return CTL.pad; },
    padShift(p, b) { LOG.push(["padShift", p | 0, b | 0]); return CTL.shift; },
    playSound(id) { LOG.push(["sound", id >>> 0]); },
});

const OBJS = [TASK, STATE, TAB, BODY, ...TAIL, MARKER, NEWTAIL];
const snap = () => { const o = []; for (const b of OBJS) for (let i = 0; i < 0xd0; i += 4) o.push(rt.mem.read32(b + i) >>> 0); return o; };
function seed(c = {}) {
    for (const b of OBJS) for (let i = 0; i < 0xd0; i += 4) rt.mem.write32(b + i, 0);
    for (let i = 0; i < 0x60; i++) rt.mem.write8(TEXT + i, 0);
    (c.text ?? []).forEach((b, i) => rt.mem.write8(TEXT + i, b));
    for (const o of [TASK, TAB, BODY, MARKER, ...TAIL, NEWTAIL]) vt(o);
    rt.mem.write32(TASK + 0x24, STATE);
    rt.mem.write32(TASK + 0x0c, c.state ?? 2);
    rt.mem.write32(TASK + 0x10, c.phase ?? 0);
    rt.mem.write32(TASK + 0x14, c.step ?? 0);
    rt.mem.write32(TASK + 0x5c, c.counter ?? 0);
    rt.mem.write32(TASK + 0x54, 0x1004);
    rt.mem.write16(TASK + 0x60, c.ax ?? 0x1234);
    rt.mem.write16(TASK + 0x62, c.ay ?? 0xfff0);
    rt.mem.write16(TASK + 0x64, c.w ?? 0x70);
    rt.mem.write16(TASK + 0x66, 0x3e);
    rt.mem.write32(TASK + 0x58, c.mode ?? 0);
    rt.mem.write32(STATE + 0x0, c.tail0 ?? 0);
    rt.mem.write32(STATE + 0x4, c.tail1 ?? 0);
    rt.mem.write32(STATE + 0x8, c.tail2 ?? 0);
    rt.mem.write32(STATE + 0xc, c.noTab ? 0 : TAB);
    rt.mem.write32(STATE + 0x10, c.noBody ? 0 : BODY);
    rt.mem.write32(STATE + 0x14, MARKER);
    for (const w of [TAB, BODY]) { rt.mem.write16(w + 0xb0, 0x40); rt.mem.write16(w + 0xb2, 0x20); rt.mem.write32(w + 0x50, 0x777); }
    for (const t of TAIL) { rt.mem.write32(t + 0xc, c.tailState ?? 1); rt.mem.write16(t + 0x6c, 5); rt.mem.write16(t + 0x6e, 0xfffb); }
    rt.mem.write32(TAIL[2] + 0xbc, c.bc ?? 0);
    rt.mem.write32(MARKER + 0x5c, 0x55555555);
    Object.assign(CTL, { m168: 0, m170: 0, pad: 0, shift: 0, width: 0x70 }, c.ctl ?? {});
}
function compare(name, c, orig, port) {
    seed(c); LOG.length = 0; orig();
    const olog = LOG.slice(), osnap = snap();
    seed(c); LOG.length = 0; port();
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
    return olog;
}

const buildOrig = (mode, x, y, pack, line) => () => {
    const sp = rt.cpu.sp | 0;
    rt.mem.write32(sp + 0x10, line); rt.mem.write32(sp + 0x14, mode);
    BUFADDR = (sp - 0x68 + 0x20) >>> 0;
    assert.equal(rt.cpu.call(0x8001ce44, [0x1004, x, y, pack], 20000) >>> 0, TASK);
};
const buildPort = (mode, x, y, pack, line) => () => {
    BUFADDR = SCR + 0x10;
    assert.equal(dialogueBalloonBuild(rt.mem, portHost(), SCR, 0x1004, x, y, pack, line, mode), TASK);
};

const H = (...b) => b;
const TEXTS = {
    plain: [0x41, 0x42, 0x43, 0],
    emptyName: [2, 7, 2, 0x41, 0x42, 0],
    unknownName: [2, 7, 2, 9, 0x41, 0x42, 0],
    shortName: [2, 7, 0x4e, 0x61, 0x6d, 0x65, 0xff, 7, 0x42, 0x6f, 0x64, 0x79, 0],
    stopAt2: [2, 7, 0x4e, 0x61, 2, 0x65, 0xff, 7, 0x42, 0],
    longName: [2, 7, ...Array.from({ length: 28 }, (_, i) => 0x41 + (i % 20)), 0xff, 7, 0x43, 0x44, 0],
    noSeven: [2, 5, 0x41, 0],
};

test("balloon build matches F0x8001CE44: modes, texts, width clamp", () => {
    let n = 0;
    for (const [tn, text] of Object.entries(TEXTS))
        for (const mode of [0, 1, 2, 3])
            for (const width of tn === "shortName" ? [-9, 0x5e, 0x5f, 0x60, 0x8a, 0x8b, 0x8c, 0x8d, 0x400] : [0x70, 0x5f, 0x8b]) {
                const log = compare(`${tn} mode ${mode} width ${width}`, { text, ctl: { width } },
                    buildOrig(mode, 0x0a0 + mode, -0x20 + 7 * mode, 0x80771000, 5 + mode),
                    buildPort(mode, 0x0a0 + mode, -0x20 + 7 * mode, 0x80771000, 5 + mode));
                const w = Math.min(Math.max(width, 0x5f), 0x8b);
                assert.equal(rt.mem.read16(TASK + 0x64), w);
                assert.equal(rt.mem.read16(TASK + 0x66), 0x3e);
                assert.equal(rt.mem.read32(STATE + 0x14) >>> 0, MARKER);
                assert.ok(log.some((e) => e[0] === "marker"));
                n++;
            }
    assert.equal(n, 4 * (9 + 6 * 3));
});

test("balloon build: negative anchor and wrapped halfwords", () => {
    for (const mode of [0, 3])
        compare(`neg ${mode}`, { text: TEXTS.shortName },
            buildOrig(mode, -300, 0x7fff, 0x80123456, -1), buildPort(mode, -300, 0x7fff, 0x80123456, -1));
});

const tickOrig = () => rt.cpu.call(0x8001cab0, [TASK, STATE], 20000);
const tickPort = () => dialogueBalloonTick(rt.mem, portHost(), TASK, STATE);

test("tick state 1: typewriter, advance button, marker flag", () => {
    for (const m168 of [0, 1, -3])
        for (const pad of [0, 0x2000, -1])
            for (const shift of [0, 13])
                for (const m170 of [0, 2])
                    compare(`s1 ${m168} ${pad} ${shift} ${m170}`, { state: 1, ctl: { m168, pad, shift, m170 } }, tickOrig, tickPort);
    const log = compare("s1 done", { state: 1, ctl: { m168: 1 } }, tickOrig, tickPort);
    assert.ok(log.some((e) => e[0] === "method" && e[2] === 0x2c && e[3] === 1));
});

test("tick other task states", () => {
    for (const state of [-1, 0, 3, 4, 9]) compare(`state ${state}`, { state }, tickOrig, tickPort);
});

test("tick state 2: open/close sequence, delays, tail spawn, hand-over", () => {
    for (const phase of [0, 1])
        for (const step of [0, 1, 2])
            for (let counter = 0; counter < 6; counter++)
                compare(`ph ${phase} step ${step} c ${counter}`, { phase, step, counter, mode: step + 1 }, tickOrig, tickPort);
    for (const step of [4, 7])
        compare(`step ${step}`, { phase: 0, step, counter: 9 }, tickOrig, tickPort);
    for (const phase of [0, 1, 2])
        for (const bc of [0, 1])
            for (const tail2 of [0, TAIL[2]])
                compare(`step3 ph ${phase} bc ${bc} t2 ${tail2}`, { phase, step: 3, bc, tail2 }, tickOrig, tickPort);
    const log = compare("open sfx", { phase: 0, step: 0, counter: 0 }, tickOrig, tickPort);
    assert.ok(log.some((e) => e[0] === "sound" && e[1] === 0x40019));
    const log2 = compare("close sfx", { phase: 1, step: 0, counter: 0 }, tickOrig, tickPort);
    assert.ok(log2.some((e) => e[0] === "sound" && e[1] === 0x4001a));
    const log3 = compare("spawn", { phase: 1, step: 1, counter: 2 }, tickOrig, tickPort);
    assert.equal(rt.mem.read32(STATE + 4) >>> 0, NEWTAIL);
    assert.equal(rt.mem.read16(NEWTAIL + 0x5c), 0x333);
    assert.ok(log3.some((e) => e[0] === "tail"));
});

test("reposition matches F0x8001C948 for all modes", () => {
    for (const mode of [0, 1, 2, 3, 4])
        for (const tailState of [0, 1])
            for (const [x, y] of [[0xa0, 0x50], [-30, -4], [0x7fff, 0x7fff]])
                for (const noBody of [false, true])
                    compare(`repos ${mode} ${tailState} ${x} ${y} ${noBody}`,
                        { mode, tailState, noBody, noTab: !noBody && mode === 3, tail0: TAIL[0], tail1: TAIL[1], tail2: TAIL[2] },
                        () => rt.cpu.call(0x8001c948, [TASK, x, y], 20000),
                        () => dialogueBalloonReposition(rt.mem, portHost(), TASK, x, y));
});

test("layout table: tab/body offsets per mode", () => {
    const h = (m, o) => rt.mem.read16(BALLOON_LAYOUT_TABLE + m * 0x20 + o) << 16 >> 16;
    const got = [0, 1, 2, 3].map((m) => [h(m, 0x14), h(m, 0x16), h(m, 0x18), h(m, 0x1a)]);
    assert.deepEqual(got, [[6, -71, 6, -58], [6, 15, 6, 28], [-20, -71, -20, -58], [-20, 15, -20, 28]]);
});
