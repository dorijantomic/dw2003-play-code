// Lane B oracle: engine/dw3/ui/native/yesno-launcher.ts must match the field
// Yes/No launcher tick wstag210 F0x800A680C and its seven homologues (s210,
// s220, s270, s280). Each original runs through engine/native on its own stage
// image (load base 0x800A5DE0) with the stage's REAL window-fold pair; the text
// and icon factories, object methods, lookup cell, pad cells, SFX cell,
// start_event and the draw context are stubbed identically on both sides, so
// the ordered calls and the controller memory compare frame by frame.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime, OVERLAY_BASE } from "../../engine/native/runtime.ts";
import { windowFoldStart, windowFoldTick } from "../../engine/dw3/ui/window-fold.ts";
import { YESNO_LAUNCHERS, yesNoLauncherTick } from "../../engine/dw3/ui/native/yesno-launcher.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native");
const image = (s) => new Uint8Array(readFileSync(join(dir, `s${s}.bin`)));

const OBJ = 0x80150000;
const EXTRA = 0x80150100;
const WIDGETS = [0x80151000, 0x80151400, 0x80151800, 0x80151c00, 0x80152000];
const ICON = 0x80152400;
const STUB = 0x0fe40000;
const PAD = 0x8004b7d0;
const SOUND_CELL = 0x80055c48;
const LOOKUP_CELL = 0x80044f5c;
const TEXT_GLOBAL = 0x8005cca8;
const METHODS = { 0x15c: 1, 0x114: 2, 0x144: 1, 0x80: 1, 0x84: 2, 0x38: 0 };
const CTX = { 0x7c: 2, 0x74: 2, 0x98: 1, 0x8c: 3, 0x94: 2, 0x84: 4 };
const CTX_HANDLE = 0x7ff00000;
const MOD = { "pro/wstag210": 210, "pro/wstag220": 220, "pro/wstag270": 270, "pro/wstag280": 280 };

const pack = (h) => (0x80700000 ^ (h & 0xfffff)) >>> 0;

function rig(launcher) {
    const img = image(MOD[launcher.module]);
    const entry = { size: img.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(img, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 });
    const LOG = [];
    const CTL = { pad: 0, alt: 0, shiftXor: 0, event: 0x80160000 };
    let next = 0;
    const st = (a, f) => rt.cpu.setStub(a, f);
    const arg = (c, i) => c.reg(4 + i) | 0;
    const slotAddr = {};
    Object.entries(METHODS).forEach(([slot, n], i) => {
        const s = Number(slot);
        slotAddr[s] = STUB + 0x100 + 4 * i;
        st(slotAddr[s], (c) => {
            const args = [];
            for (let k = 0; k < n; k++) args.push(arg(c, 1 + k));
            return hostImpl.callMethod(c.reg(4) >>> 0, s, args);
        });
    });
    const ctxAddr = {};
    Object.entries(CTX).forEach(([slot, n], i) => {
        const s = Number(slot);
        ctxAddr[s] = STUB + 0x200 + 4 * i;
        st(ctxAddr[s], (c) => {
            const args = [];
            for (let k = 0; k < n; k++) args.push(arg(c, k));
            hostImpl.drawCall(CTX_HANDLE, s, args);
            return 0;
        });
    });
    // One host serves both sides: the native stubs forward into it.
    const hostImpl = {
        callMethod(t, slot, args) {
            LOG.push([slot === 0x38 ? "base" : "method", t >>> 0, slot, ...args.map((a) => a | 0)]);
            if (slot === 0x38) { rt.mem.write32(t + 0x0c, 1); rt.mem.write32(t + 0x10, 0); }
            return 0;
        },
        createText(l, k, x, y) { LOG.push(["text", l | 0, k | 0, x | 0, y | 0]); return WIDGETS[next++ % WIDGETS.length]; },
        spawnIcon(l, k, x, y) { LOG.push(["icon", l | 0, k | 0, x | 0, y | 0]); return ICON; },
        lookup(h) { LOG.push(["lookup", h >>> 0]); return pack(h); },
        foldStart(fold, dir) {
            // The stage's own fold start (run natively, so not logged): active, SFX, value/delta.
            hostImpl.playSound((dir | 0) !== 0 ? 0x40019 : 0x4001a);
            windowFoldStart(rt.mem, fold, dir);
        },
        foldTick(fold) { return windowFoldTick(rt.mem, fold); },
        padRead(p) { LOG.push(["padRead", p | 0]); return CTL.pad; },
        padAlt(p) { LOG.push(["padAlt", p | 0]); return CTL.alt; },
        padShift(p, b) { LOG.push(["padShift", p | 0, b | 0]); return b ^ CTL.shiftXor; },
        playSound(id) { LOG.push(["sound", id >>> 0]); },
        startEvent(id) { LOG.push(["event", id | 0]); return CTL.event; },
        drawInit() { LOG.push(["ctxInit"]); return CTX_HANDLE; },
        drawCall(ctx, slot, args) { LOG.push(["ctx", ctx >>> 0, slot, ...args.map((a) => a | 0)]); },
    };
    st(0x8001ae38, (c) => hostImpl.createText(arg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
    st(0x8001b364, (c) => hostImpl.spawnIcon(arg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
    st(0x800853f8, (c) => hostImpl.startEvent(arg(c, 0)));
    st(0x8001f648, (c) => {
        const ctx = c.reg(4) >>> 0;
        LOG.push(["ctxInit"]);
        for (const s of Object.keys(CTX)) rt.mem.write32(ctx + Number(s), ctxAddr[s]);
        return 0;
    });
    st(STUB + 0x10, (c) => hostImpl.padRead(arg(c, 0)));
    st(STUB + 0x14, (c) => hostImpl.padAlt(arg(c, 0)));
    st(STUB + 0x18, (c) => hostImpl.padShift(arg(c, 0), arg(c, 1)));
    st(STUB + 0x1c, (c) => { LOG.push(["sound", c.reg(4) >>> 0]); return 0; });
    st(STUB + 0x20, (c) => hostImpl.lookup(c.reg(4) >>> 0));
    // The fold pair stays the stage's own code; only its SFX goes through the cell.
    const foldPtrs = [rt.mem.read32(launcher.foldStartCell) >>> 0, rt.mem.read32(launcher.foldTickCell) >>> 0];

    const params = { textHandle: launcher.textHandle, yesId: launcher.yesId, noId: launcher.noId };
    const portHost = { ...hostImpl };

    function reset(c = {}) {
        for (let i = 0; i < 0x200; i += 4) rt.mem.write32(OBJ + i, 0);
        for (const w of [...WIDGETS, ICON]) for (const s of Object.keys(METHODS)) rt.mem.write32(w + Number(s), slotAddr[s]);
        rt.mem.write32(OBJ + 0x38, slotAddr[0x38]);
        rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
        rt.mem.write32(OBJ + 0x10, c.step ?? 0);
        rt.mem.write32(OBJ + 0x14, c.flag ?? 0);
        rt.mem.write32(OBJ + 0x50, c.sel ?? 0);
        for (let i = 0; i < 4; i++) rt.mem.write32(OBJ + 0x54 + 4 * i, (c.fold ?? [10, 0, 0, 0])[i]);
        rt.mem.write32(EXTRA + 0x00, WIDGETS[2]);
        rt.mem.write32(EXTRA + 0x04, WIDGETS[0]);
        rt.mem.write32(EXTRA + 0x08, WIDGETS[1]);
        rt.mem.write32(EXTRA + 0x0c, ICON);
        rt.mem.write32(EXTRA + 0x10, c.child ?? 0);
        rt.mem.write32(TEXT_GLOBAL, c.global ?? 0);
        rt.mem.write32(PAD + 0x3f4, STUB + 0x10);
        rt.mem.write32(PAD + 0x3fc, STUB + 0x14);
        rt.mem.write32(PAD + 0x408, STUB + 0x18);
        rt.mem.write32(SOUND_CELL, STUB + 0x1c);
        rt.mem.write32(LOOKUP_CELL, STUB + 0x20);
        rt.mem.write32(launcher.foldStartCell, foldPtrs[0]);
        rt.mem.write32(launcher.foldTickCell, foldPtrs[1]);
        Object.assign(CTL, { pad: 0, alt: 0, shiftXor: 0, event: 0x80160000 }, c.ctl ?? {});
        next = 0;
        LOG.length = 0;
    }
    const snap = () => {
        const out = [];
        for (let i = 0; i < 0x64; i += 4) out.push(rt.mem.read32(OBJ + i) >>> 0);
        for (let i = 0; i < 0x14; i += 4) out.push(rt.mem.read32(EXTRA + i) >>> 0);
        return out;
    };
    const orig = () => rt.cpu.call(launcher.address, [OBJ, EXTRA], 20000);
    const port = () => yesNoLauncherTick(rt.mem, OBJ, EXTRA, portHost, params);

    /** Run `frames` ticks on both sides; script(frame) applies inputs before each tick. */
    function scenario(name, frames, script, c = {}) {
        const record = (fn) => {
            reset(c);
            const frameLogs = [];
            for (let f = 0; f < frames; f++) {
                script?.(f, CTL, rt.mem);
                LOG.length = 0;
                fn();
                frameLogs.push([LOG.slice(), snap()]);
            }
            return frameLogs;
        };
        const o = record(orig);
        const p = record(port);
        for (let f = 0; f < frames; f++) {
            assert.deepEqual(p[f][0], o[f][0], `${name} frame ${f}: calls`);
            assert.deepEqual(p[f][1], o[f][1], `${name} frame ${f}: memory`);
        }
        return o;
    }
    return { rt, scenario, CTL };
}

const BTN = { up: 1 << 4, down: 1 << 6, ok: 1 << 0xd };
// Frames: 0 init, 1 fold open, 2..12 fold ticks, then the input script.
function playScript(moves) {
    return (f, ctl, mem) => {
        ctl.pad = 0; ctl.alt = 0;
        const m = moves[f];
        if (m) Object.assign(ctl, m);
        if (moves.clearChildAt === f) mem.write32(EXTRA + 0x10, 0);
    };
}

const flat = (frames) => frames.flatMap(([log]) => log);

const s210 = rig(YESNO_LAUNCHERS[0]);

test("open: init frame, fold open, texts set when the fold finishes", () => {
    const o = s210.scenario("open", 16, null);
    const all = flat(o);
    assert.deepEqual(o[0][0].filter((e) => e[0] === "text" || e[0] === "icon"),
        [["text", 0x1002, 1, 0x1c, 0xbe], ["text", 0x1002, 1, 0x1c, 0xcc], ["icon", 0x1002, 1, 0x12, 0xbe], ["text", 0x1002, 1, 0x12, 0xb0]]);
    assert.ok(all.some((e) => e[0] === "lookup" && e[1] === 0x01120002));
    assert.equal(s210.rt.mem.read32(OBJ + 0x10) | 0, 2);
});

test("Yes path: move down/up with clamping, confirm, close, start event, wait for child", () => {
    const moves = { 14: { pad: BTN.up }, 15: { pad: BTN.down }, 16: { alt: BTN.down }, 17: { pad: BTN.up }, 18: { alt: BTN.up },
        19: { pad: BTN.ok }, clearChildAt: 40 };
    const o = s210.scenario("yes", 44, playScript(moves));
    const all = flat(o);
    assert.equal(all.filter((e) => e[0] === "sound" && e[1] === 0x8004513e).length, 2);
    assert.ok(all.some((e) => e[0] === "event" && e[1] === 13));
    assert.equal(s210.rt.mem.read32(OBJ + 0x0c) | 0, 3);
});

test("No path: down then confirm starts the No event", () => {
    const moves = { 13: { pad: BTN.down }, 14: { pad: BTN.down | BTN.ok }, 15: { pad: BTN.ok }, clearChildAt: 35 };
    const all = flat(s210.scenario("no", 38, playScript(moves)));
    assert.ok(all.some((e) => e[0] === "event" && e[1] === 14));
});

test("text handle carries the global high half; odd pad mappings", () => {
    s210.scenario("global", 14, null, { global: 0x12345 });
    for (const shiftXor of [1, 33, -1])
        s210.scenario(`shift ${shiftXor}`, 4, (f, ctl) => { ctl.pad = -1; ctl.alt = 0x55555555; }, { state: 1, step: 2, ctl: { shiftXor } });
});

test("seeded single frames: states, unused steps, close outcomes, draw scales", () => {
    for (const state of [-1, 2, 3, 4, 7]) s210.scenario(`state ${state}`, 1, null, { state });
    for (const step of [5, 6, 7, 8, 9, 12, 0x7fffffff, -1]) s210.scenario(`step ${step}`, 1, null, { state: 1, step });
    for (const flag of [0, 1, 2]) s210.scenario(`close flag ${flag}`, 1, null, { state: 1, step: 11, flag });
    for (const child of [0, 5]) s210.scenario(`wait ${child}`, 1, null, { state: 1, step: 4, child });
    for (const sel of [0, 1, 2, -3]) s210.scenario(`event sel ${sel}`, 1, null, { state: 1, step: 3, sel });
    for (const sel of [-2, 3]) for (const pad of [BTN.up, BTN.down]) s210.scenario(`sel ${sel} pad ${pad}`, 1, (f, ctl) => { ctl.pad = pad; }, { state: 1, step: 2, sel });
    for (const value of [0, 0x1000, 0x800, -5, 0x2000])
        s210.scenario(`draw ${value}`, 1, null, { state: 1, step: 4, child: 1, fold: [10, 0, value, 0] });
});

test("every homologue's original matches the port with its own constants", () => {
    for (const l of YESNO_LAUNCHERS) {
        const r = l === YESNO_LAUNCHERS[0] ? s210 : rig(l);
        const name = `${l.module} 0x${l.address.toString(16)}`;
        const yes = flat(r.scenario(`${name} yes`, 40, playScript({ 13: { pad: BTN.ok }, clearChildAt: 36 })));
        assert.ok(yes.some((e) => e[0] === "lookup" && e[1] === l.textHandle), `${name} handle`);
        assert.ok(yes.some((e) => e[0] === "event" && e[1] === l.yesId), `${name} yes`);
        const no = flat(r.scenario(`${name} no`, 40, playScript({ 13: { pad: BTN.down }, 14: { pad: BTN.ok }, clearChildAt: 37 })));
        assert.ok(no.some((e) => e[0] === "event" && e[1] === l.noId), `${name} no`);
        for (const step of [5, 9, 12]) r.scenario(`${name} step ${step}`, 1, null, { state: 1, step });
        r.scenario(`${name} cancel`, 1, null, { state: 1, step: 11, flag: 0 });
    }
});

test("homologues differ from s210 only in the listed constants and relocated jumps", () => {
    const ref = image(210);
    const word = (img, a, o) => new DataView(img.buffer).getUint32(a - OVERLAY_BASE + o, true);
    const lo = (v) => v & 0xffff;
    for (const l of YESNO_LAUNCHERS.slice(1)) {
        const img = image(MOD[l.module]);
        for (let o = 0; o < 0x5bc; o += 4) {
            const a = word(ref, YESNO_LAUNCHERS[0].address, o), b = word(img, l.address, o);
            if (a === b) continue;
            const op = a >>> 26;
            const ok = (op === 2 && (b >>> 26) === 2) // j: relocation
                || (o === 0x16c && b === (0x3c120000 | (l.textHandle >>> 16)))
                || (o === 0x170 && b === (0x36520000 | lo(l.textHandle)))
                || (o === 0x3f4 && b === (0x24040000 | l.noId)) || (o === 0x3f8 && b === (0x24040000 | l.yesId))
                || (o === 0x110 && b === (0x24420000 | lo(l.jumpTable)))
                || ([0x130, 0x140, 0x488, 0x4b0].includes(o) && b === (0x3c020000 | ((l.foldStartCell + 0x8000) >>> 16)))
                || ([0x134, 0x48c].includes(o) && lo(b) === lo(l.foldStartCell))
                || ([0x144, 0x4b4].includes(o) && lo(b) === lo(l.foldTickCell));
            assert.ok(ok, `${l.module} 0x${l.address.toString(16)} +0x${o.toString(16)}: ${a.toString(16)} -> ${b.toString(16)}`);
        }
        // 12-entry step table: same targets relative to the routine start.
        for (let i = 0; i < 12; i++)
            assert.equal(word(img, l.jumpTable, 4 * i) - l.address, word(ref, YESNO_LAUNCHERS[0].jumpTable, 4 * i) - YESNO_LAUNCHERS[0].address);
    }
});
