// Lane B oracle: engine/dw3/ui/native/help-menu-launcher.ts must match the field eight-topic help
// menu tick wstag210 F0x800A5E74 and its four copies (s210 event 8; s924 events 1602/1604; s935
// events 1616/1618). Each original runs through engine/native on its own stage image (load base
// 0x800A5DE0) with the stage's REAL window-fold pair; the text and icon factories, object methods,
// pack cell, the pad cells, the SFX cell and the draw context are
// stubbed identically on both sides, so the ordered calls and the whole controller memory compare
// frame by frame over the player's route and over seeded single frames.
//
// The two copies the s924 and s935 overlays add differ only in the listed constants and relocated
// jumps, and s935/1616's task-state dispatch is one compare shorter (no state-2 fold release); both
// shapes are checked here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime, OVERLAY_BASE } from "../../engine/native/runtime.ts";
import { windowFoldStart, windowFoldTick } from "../../engine/dw3/ui/window-fold.ts";
import { HELP_MENUS, helpMenuTick } from "../../engine/dw3/ui/native/help-menu-launcher.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native");
const image = (s) => new Uint8Array(readFileSync(join(dir, `s${s}.bin`)));

const OBJ = 0x80150000;
const EXTRA = 0x80150100;
const ROWS = Array.from({ length: 8 }, (_, i) => 0x80151000 + 0x200 * i);
const PAGE = 0x80152000;
const ICON = 0x80152400;
const STUB = 0x0fe40000;
const PAD = 0x8004b7d0;
const SOUND_CELL = 0x80055c48;
const LOOKUP_CELL = 0x80044f5c; // == 0x80044B38 + 0x424: one pack cell for rows and page
// The prompt blinks against the free-running tick counter the resident cursor handler uses too:
// cell 0x8004DE10 + 0x188, whose service F0x8001D6F4 returns [0x8004DE20]. The runtime seeds that
// cell itself, so both sides read the same word instead of a stub.
const TICK_COUNT_VALUE = 0x8004de20;
const TEXT_GLOBAL = 0x8005cca8;
const METHODS = {
    0x38: 0, 0x80: 1, 0x84: 2, 0x88: 1, 0x94: 1, 0x114: 2, 0x128: 0, 0x130: 1, 0x144: 1,
    0x15c: 1, 0x160: 1, 0x168: 0, 0x170: 0,
};
// The draw context is F0x8001F648's stack frame at sp+0x10, so the routine reads the method table
// at (context field + 0x10). The rig keys the stubs by the CONTEXT FIELD, which is what the port
// passes to drawCall, and writes them at ctx + field: the two sides' vocabularies line up.
const CTX = { 0x7c: 2, 0x74: 2, 0x98: 1, 0x88: 1, 0x84: 4, 0x8c: 3, 0x94: 2 };
const CTX_HANDLE = 0x7ff00000;
const MOD = { "pro/wstag210": 210, "pro/wstag924": 924, "pro/wstag935": 935 };
const ALL = [...ROWS, PAGE];

const pack = (h) => (0x80700000 ^ (h & 0xfffff)) >>> 0;

function rig(menu) {
    const img = image(MOD[menu.module]);
    const entry = { size: img.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(img, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 });
    const LOG = [];
    const CTL = {
        pad: 0, alt: 0, shiftXor: 0, typing: 0, waiting: 0, tick: 0,
    };
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
            if (slot === 0x38) { rt.mem.write32(t + 0x0c, 1); rt.mem.write32(t + 0x10, 0); return 0; }
            if (slot === 0x168) return CTL.typing;
            if (slot === 0x170) return CTL.waiting;
            return 0;
        },
        createText(l, k, x, y) { LOG.push(["text", l | 0, k | 0, x | 0, y | 0]); return ALL[next++ % ALL.length]; },
        spawnIcon(l, k, x, y) { LOG.push(["icon", l | 0, k | 0, x | 0, y | 0]); return ICON; },
        lookup(h) { LOG.push(["lookup", h >>> 0]); return pack(h); },
        foldStart(fold, dir) {
            // The stage's own fold start (run natively, so not logged): value/delta/active.
            hostImpl.playSound((dir | 0) !== 0 ? 0x40019 : 0x4001a);
            windowFoldStart(rt.mem, fold, dir);
        },
        foldTick(fold) { return windowFoldTick(rt.mem, fold); },
        padRead(p) { LOG.push(["padRead", p | 0]); return CTL.pad; },
        padAlt(p) { LOG.push(["padAlt", p | 0]); return CTL.alt; },
        padShift(p, b) { LOG.push(["padShift", p | 0, b | 0]); return b ^ CTL.shiftXor; },
        playSound(id) { LOG.push(["sound", id >>> 0]); },
        tickCount() { return rt.mem.read32(TICK_COUNT_VALUE) | 0; },
        drawInit() { LOG.push(["ctxInit"]); return CTX_HANDLE; },
        drawCall(ctx, slot, args) { LOG.push(["ctx", ctx >>> 0, slot, ...args.map((a) => a | 0)]); },
    };
    st(0x8001ae38, (c) => hostImpl.createText(arg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
    st(0x8001b364, (c) => hostImpl.spawnIcon(arg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
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
    const foldPtrs = [rt.mem.read32(menu.foldStartCell) >>> 0, rt.mem.read32(menu.foldTickCell) >>> 0];

    const params = {
        textHandle: menu.textHandle,
        markerGlyphs: menu.markerGlyphs,
        stateTwoReleasesFold: menu.stateTwoReleasesFold,
    };
    const portHost = { ...hostImpl };

    function reset(c = {}) {
        for (let i = 0; i < 0x84; i += 4) rt.mem.write32(OBJ + i, 0);
        for (const w of [...ALL, ICON]) for (const s of Object.keys(METHODS)) rt.mem.write32(w + Number(s), slotAddr[s]);
        rt.mem.write32(OBJ + 0x38, slotAddr[0x38]);
        rt.mem.write32(OBJ + 0x0c, c.state ?? 0);
        rt.mem.write32(OBJ + 0x10, c.step ?? 0);
        rt.mem.write32(OBJ + 0x50, c.rows ?? 8);
        rt.mem.write32(OBJ + 0x54, c.sel ?? 0);
        rt.mem.write32(OBJ + 0x58, c.pending ?? 0);
        rt.mem.write32(OBJ + 0x5c, c.phase ?? 0);
        rt.mem.write32(OBJ + 0x60, c.stamp ?? 0);
        for (let i = 0; i < 4; i++) rt.mem.write32(OBJ + 0x64 + 4 * i, (c.fold ?? [10, 0, 0, 0])[i]);
        for (let i = 0; i < 4; i++) rt.mem.write32(OBJ + 0x74 + 4 * i, (c.pageFold ?? [10, 0, 0, 0])[i]);
        for (let i = 0; i < 8; i++) rt.mem.write32(EXTRA + 4 * i, ROWS[i]);
        rt.mem.write32(EXTRA + 0x20, ICON);
        rt.mem.write32(EXTRA + 0x24, PAGE);
        rt.mem.write32(TEXT_GLOBAL, c.global ?? 0);
        rt.mem.write32(PAD + 0x3f4, STUB + 0x10);
        rt.mem.write32(PAD + 0x3fc, STUB + 0x14);
        rt.mem.write32(PAD + 0x408, STUB + 0x18);
        rt.mem.write32(SOUND_CELL, STUB + 0x1c);
        rt.mem.write32(LOOKUP_CELL, STUB + 0x20);
        rt.mem.write32(TICK_COUNT_VALUE, 0);
        rt.mem.write32(menu.foldStartCell, foldPtrs[0]);
        rt.mem.write32(menu.foldTickCell, foldPtrs[1]);
        Object.assign(CTL, { pad: 0, alt: 0, shiftXor: 0, typing: 0, waiting: 0, tick: 0 }, c.ctl ?? {});
        rt.mem.write32(TICK_COUNT_VALUE, c.tick ?? 0);
        next = 0;
        LOG.length = 0;
    }
    const snap = () => {
        const out = [];
        for (let i = 0; i < 0x84; i += 4) out.push(rt.mem.read32(OBJ + i) >>> 0);
        for (let i = 0; i < 0x28; i += 4) out.push(rt.mem.read32(EXTRA + i) >>> 0);
        return out;
    };
    const orig = () => rt.cpu.call(menu.address, [OBJ, EXTRA], 20000);
    const port = () => helpMenuTick(rt.mem, OBJ, EXTRA, portHost, params);

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
    return { rt, scenario, CTL, menu };
}

const BTN = { up: 1 << 4, down: 1 << 6, ok: 1 << 0xd, cancel: 1 << 0xe };
const flat = (frames) => frames.flatMap(([log]) => log);
const at = (frames, frame) => frames[frame][0];

const s210 = rig(HELP_MENUS[0]);

test("open: eight rows down the right, a hidden cursor, the page widget, then the fold", () => {
    const o = s210.scenario("open", 20, null);
    assert.deepEqual(o[0][0].filter((e) => e[0] === "text" || e[0] === "icon"), [
        ["text", 0x1002, 1, 0xbd, 0x21], ["text", 0x1002, 1, 0xbd, 0x2f], ["text", 0x1002, 1, 0xbd, 0x3d],
        ["text", 0x1002, 1, 0xbd, 0x4b], ["text", 0x1002, 1, 0xbd, 0x59], ["text", 0x1002, 1, 0xbd, 0x67],
        ["text", 0x1002, 1, 0xbd, 0x75], ["text", 0x1002, 1, 0xbd, 0x83],
        ["icon", 0x1002, 1, 0xaf, 0x21], ["text", 0x1002, 1, 0x12, 0xb0],
    ]);
    // The first fold opens (SFX 0x40019), the list's titles land 1-based, the cursor appears.
    const all = flat(o);
    assert.ok(all.some((e) => e[0] === "sound" && e[1] === 0x40019), "the window must open with its SFX");
    const titles = all.filter((e) => e[0] === "method" && e[2] === 0x114);
    assert.deepEqual(titles.map((e) => [e[1], e[4]]), ROWS.map((r, i) => [r, i + 1]));
    assert.ok(all.some((e) => e[0] === "lookup" && e[1] === 0x01120001), "rows resolve the pack cell");
    assert.deepEqual(at(o, 1).filter((e) => e[0] === "method" && e[2] === 0x84).length, 0, "no cursor move yet");
    assert.equal(s210.rt.mem.read32(OBJ + 0x10) | 0, 2, "the list waits for input");
    assert.equal(s210.rt.mem.read32(OBJ + 0x50) | 0, 8, "eight rows");
    // The scroll marker is drawn from the per-overlay glyph table while the list folds in.
    assert.ok(all.some((e) => e[0] === "ctx" && e[2] === 0x84 && e[4] === 0x24), "marker glyph 0x24");
});

/**
 * The player's route, driven off the routine's own step word so the fold timings come from the
 * code rather than from constants: on the first visit to the list move down three, up past the
 * first row and confirm row 2; read the page (typewriter, a page turn, the blinking prompt);
 * back on the list move to "Return" (row 7) and confirm it, or press Cancel instead.
 */
function route(r, name, close) {
    const D = BTN.down, U = BTN.up, K = BTN.ok, X = BTN.cancel;
    // Frames spent on each visit to the list, counted from the frame its step becomes 2.
    const listPad = [
        { 1: D, 2: D, 3: D, 4: U, 5: U, 6: U, 7: U, 8: D, 9: D, 10: K },
        { 1: D, 2: D, 3: D, 4: D, 5: D, 6: close === "row" ? K : X },
    ];
    // Frames spent reading the page: typing, then the page-turn wait, then the rescan, then done.
    const pagePad = { 3: K, 4: K };
    let lastStep = -1, listFrame = -1, listVisit = -1;
    return r.scenario(name, 150, (f, ctl, mem) => {
        if (f === 0) { listFrame = -1; listVisit = -1; lastStep = -1; }
        const step = mem.read32(OBJ + 0x10) | 0;
        ctl.pad = 0;
        ctl.typing = 1;
        ctl.waiting = 0;
        mem.write32(TICK_COUNT_VALUE, f); // the free-running counter both sides read
        if (step === 2) {
            if (lastStep !== 2) { listVisit++; listFrame = f; }
            ctl.pad = listPad[listVisit]?.[f - listFrame] ?? 0;
        } else if (step === 5) {
            if (lastStep !== 5) listFrame = f;
            const k = f - listFrame;
            ctl.typing = k < 6 ? 0 : 1; // the widget's +0xC3: set once its glyphs are all drawn
            ctl.waiting = k >= 2 && k < 4 ? 1 : 0; // the widget's state 2 waiting for a page turn
            ctl.pad = pagePad[k] ?? 0;
        }
        lastStep = step;
    });
}

test("the player's route: down 3, up past row 0, open row 2, page through, back, Return closes", () => {
    const o = route(s210, "route", "row");
    const all = flat(o);
    // Row 2 after three downs, four ups (the fourth clamped at 0, so it moves nothing) and two
    // more downs; then, back on the list, five downs to "Return".
    const moves = all.filter((e) => e[0] === "method" && e[2] === 0x84 && e[1] === ICON);
    assert.deepEqual(moves.map((e) => e[4]),
        [47, 61, 75, 61, 47, 33, 47, 61, 75, 89, 103, 117, 131], "cursor y per move");
    assert.ok(all.some((e) => e[0] === "sound" && e[1] === 0x8004503c), "the confirm SFX");
    // The page is strings[sel + 9] = 11 (row 2), shown with the typewriter at 6 ticks a glyph.
    const page = all.filter((e) => e[0] === "method" && e[1] === PAGE);
    assert.deepEqual(page.filter((e) => e[2] === 0x114).map((e) => e[4]), [11]);
    assert.deepEqual(page.filter((e) => e[2] === 0x130).map((e) => e[3]), [6]);
    assert.ok(page.some((e) => e[2] === 0x128), "a page turn rescans the visible window");
    assert.ok(all.some((e) => e[0] === "sound" && e[1] === 0x4001c), "the page-turn SFX");
    // The cursor's window mode: shown for the list, 1/7 for the page, 0/0 back, hidden at the close.
    assert.deepEqual(all.filter((e) => e[0] === "method" && e[1] === ICON && e[2] !== 0x84)
        .map((e) => [e[2], e[3]]),
    [[0x80, 0], [0x80, 1], [0x94, 1], [0x88, 7], [0x94, 0], [0x88, 0], [0x80, 0]]);
    // Return is row 7: the page was hidden when it closed, then the eight rows, and the task ends.
    const hidden = all.filter((e) => e[0] === "method" && e[2] === 0x144);
    assert.equal(hidden.length, 9, "the page plus the eight rows are hidden");
    assert.equal(hidden[0][1], PAGE);
    assert.equal(s210.rt.mem.read32(OBJ + 0x0c) | 0, 3, "the task finished");
    assert.ok(all.filter((e) => e[0] === "ctx" && e[2] === 0x84 && e[4] === 0x45).length > 0, "end-of-text glyph");
    assert.ok(all.filter((e) => e[0] === "ctx" && e[2] === 0x88).length > 0, "the prompt's CLUT row");
});

test("Cancel closes the menu from the list instead of opening anything", () => {
    const all = flat(route(s210, "cancel", "cancel"));
    const sounds = all.filter((e) => e[0] === "sound").map((e) => e[1]);
    assert.ok(sounds.includes(0x800450bd), "the cancel SFX");
    assert.ok(sounds.lastIndexOf(0x800450bd) > sounds.lastIndexOf(0x8004503c),
        "Cancel closes it after the page, not a row confirm");
    assert.equal(all.filter((e) => e[0] === "method" && e[2] === 0x144).length, 9, "page + eight rows");
    assert.equal(s210.rt.mem.read32(OBJ + 0x0c) | 0, 3);
});

test("every homologue's original matches the port with its own constants", () => {
    for (const m of HELP_MENUS) {
        const r = m === HELP_MENUS[0] ? s210 : rig(m);
        const name = `${m.module} 0x${m.address.toString(16)}`;
        const all = flat(r.scenario(`${name} row`, 16, null));
        assert.ok(all.some((e) => e[0] === "lookup" && e[1] === m.textHandle), `${name} handle`);
        // Task state 2: one more fold open + tick on +0x64, except the s935/1616 copy.
        const two = r.scenario(`${name} state2`, 2, null, { state: 2, fold: [10, 0, 0x1000, 0] });
        assert.deepEqual(at(two, 0).filter((e) => e[0] === "sound").map((e) => e[1]),
            m.stateTwoReleasesFold ? [0x40019] : [], `${name} state-2 fold`);
        r.scenario(`${name} state3`, 1, null, { state: 3 });
        r.scenario(`${name} create-again`, 1, null, { state: 7 });
    }
});

test("the full route also closes every other copy", () => {
    for (const m of HELP_MENUS.slice(1)) {
        const r = rig(m);
        const name = `${m.module} 0x${m.address.toString(16)}`;
        route(r, `${name} route`, "row");
        assert.equal(r.rt.mem.read32(OBJ + 0x0c) | 0, 3, `${name} must finish`);
        route(r, `${name} cancel`, "cancel");
        assert.equal(r.rt.mem.read32(OBJ + 0x0c) | 0, 3, `${name} must finish on Cancel`);
    }
});

test("seeded single frames: every step, every task state, both closes", () => {
    for (const state of [-1, 0, 2, 3, 4, 7]) s210.scenario(`state ${state}`, 1, null, { state });
    for (const step of [0, 3, 4, 5, 6, 7, 8, 9, 11, 12, 0x7fffffff, -1])
        s210.scenario(`step ${step}`, 1, null, { state: 1, step });
    for (const sel of [-3, 0, 7, 9])
        for (const pad of [0, BTN.up, BTN.down, BTN.ok, BTN.cancel])
            s210.scenario(`sel ${sel} pad ${pad}`, 1, (f, ctl) => { ctl.pad = pad; }, { state: 1, step: 2, sel });
    for (const rows of [0, 1, 5, 8, -1]) s210.scenario(`rows ${rows} list`, 1, null, { state: 1, step: 2, rows });
    for (const rows of [5, 6, 7, 8]) s210.scenario(`rows ${rows} close`, 1, null, { state: 1, step: 10, rows });
    // The scroll marker's glyph comes from the overlay's table at (rowCount - 5), so the seeded
    // draw frames stay inside it; the game only ever runs with eight rows.
    for (const rows of [5, 6, 7, 8])
        s210.scenario(`rows ${rows} draw`, 1, null,
            { state: 1, step: 11, fold: [10, 0, 0x800, 1], pageFold: [10, 0, 0x1000, 0], rows });
    for (const fold of [0, 0x1000, 0x800, -5, 0x2000])
        for (const pageFold of [0, 0x1000, -1])
            s210.scenario(`draw ${fold} ${pageFold}`, 1, null,
                { state: 1, step: 4, fold: [10, 0, fold, 1], pageFold: [10, 0, pageFold, 1] });
    // The page text: typing (0x168 == 0), waiting for a page turn (0x170), confirm on each.
    for (const [typing, waiting, pad] of [[0, 0, 0], [0, 0, BTN.ok], [0, 1, 0], [0, 1, BTN.ok], [1, 0, 0], [1, 1, BTN.ok]])
        s210.scenario(`page ${typing} ${waiting} ${pad}`, 1, (f, ctl) => {
            ctl.typing = typing; ctl.waiting = waiting; ctl.pad = pad;
        }, { state: 1, step: 5, pending: 1 });
    // The blinking prompt: the tick counter is read twice on a trigger frame and only every 4 ticks.
    for (const [tick, stamp, phase] of [[10, 0, 0], [3, 0, 0], [4, 0, 3], [10, 6, 4], [10, 6, 9], [-2, 0, 0]])
        s210.scenario(`blink ${tick} ${stamp} ${phase}`, 1, null,
            { state: 1, step: 2, pending: 1, stamp, phase, ctl: { tick } });
    for (const phase of [0, 1, 4]) s210.scenario(`no blink ${phase}`, 1, null,
        { state: 1, step: 2, phase, ctl: { tick: 99 } });
    s210.scenario("global", 14, null, { global: 0x12345 });
    for (const shiftXor of [1, 33, -1])
        s210.scenario(`shift ${shiftXor}`, 2, (f, ctl) => { ctl.pad = -1; ctl.alt = 0x55555555; },
            { state: 1, step: 2, ctl: { shiftXor } });
});

test("the five copies carry s210's constants, and only the overlay-local ones differ", () => {
    const refImg = image(210);
    const ref = HELP_MENUS[0];
    const word = (img, a, o) => new DataView(img.buffer).getUint32(a - OVERLAY_BASE + o, true);
    /** The routine ends at its epilogue's `lw $ra, 0xc4($sp)`. */
    const bodySpan = (img, a) => {
        for (let o = 0; o < 0xa00; o += 4) if (word(img, a, o) === 0x8fbf00c4) return o + 8;
        throw new Error(`no epilogue at 0x${a.toString(16)}`);
    };
    /** Every lui / ori / addiu immediate in the body, counted. */
    const immediates = (img, a, span) => {
        const out = new Map();
        for (let o = 0; o < span; o += 4) {
            const v = word(img, a, o);
            if ((v >>> 26) === 0x09 || (v >>> 26) === 0x0d || (v >>> 26) === 0x0f) {
                const key = `${(v >>> 26).toString(16)}:${(v & 0xffff).toString(16)}`;
                out.set(key, (out.get(key) ?? 0) + 1);
            }
        }
        return out;
    };
    // The five cells each overlay renames: its own step table, scroll-glyph table, fold-release
    // object, its fold cells' base and the text handle's two halves.
    const overlayOnly = (m, span) => {
        const cells = [m.jumpTable, m.markerCell, m.releaseCell, m.foldStartCell, m.foldTickCell];
        return [...cells.map((c) => `9:${(c & 0xffff).toString(16)}`),
            `f:${((m.textHandle >>> 16) & 0xffff).toString(16)}`, `d:${(m.textHandle & 0xffff).toString(16)}`,
            "f:800a", "f:800b"];
    };
    /** Drop the overlay-local immediates; `missing` drops one occurrence of each. */
    const strip = (counts, keys, missing = []) => {
        const out = new Map(counts);
        for (const key of keys) out.delete(key);
        for (const key of missing) out.set(key, (out.get(key) ?? 0) - 1);
        return out;
    };
    for (const m of HELP_MENUS.slice(1)) {
        const img = image(MOD[m.module]);
        const name = `${m.module} 0x${m.address.toString(16)}`;
        // s935/1616's dispatch is one compare shorter: it has no task-state-2/3 immediates
        // (li 1, li 2, li 3 and the addiu that pairs with them), which is the whole difference.
        const shorter = !m.stateTwoReleasesFold;
        const refCounts = strip(immediates(refImg, ref.address, bodySpan(refImg, ref.address)),
            overlayOnly(ref), shorter ? ["9:1", "9:2", "9:3", "9:64"] : []);
        const counts = strip(immediates(img, m.address, bodySpan(img, m.address)), overlayOnly(m));
        assert.deepEqual([...counts.entries()].sort(), [...refCounts.entries()].sort(),
            `${name}: same immediates`);
        // 12-entry step table: the same targets relative to the routine start.
        for (let i = 0; i < 12; i++) {
            const mine = word(img, m.jumpTable, 4 * i) - m.address;
            const refT = word(refImg, ref.jumpTable, 4 * i) - ref.address;
            assert.equal(mine, shorter ? refT - 8 : refT, `${name} step ${i}`);
        }
        // Its fold pair points at that overlay's own window-fold code, which the oracle ran.
        const start = word(img, m.foldStartCell, 0), tick = word(img, m.foldTickCell, 0);
        assert.ok(start !== 0 && tick !== 0 && start !== tick, `${name} fold pair`);
    }
});
