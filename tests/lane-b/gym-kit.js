// Shared oracle kit for the training gym ports (pro/stgtrain).
//
// A lane-b oracle runs the ORIGINAL routine from the shipped overlay image
// through engine/native and the translated port against the same seeded memory,
// then compares the ordered boundary calls, the return value and every byte of
// the memory windows the test names. Everything the routine calls through a
// pointer (a resident service cell, an object method slot, a fixed overlay
// address) is replaced by a recording stub on the original side and by a
// recording host function on the port side; the test writes the two sides with
// the same event names, so one `assert.deepEqual` proves the call order, the
// arguments and the side effects.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
export const RESIDENT = new Uint8Array(readFileSync(join(dir, "resident.bin")));
export const STGTRAIN = new Uint8Array(readFileSync(join(dir, "pro_stgtrain.bin")));
/** Any overlay of the shipped disc can be the oracle's original; the gym's is the default. */
export function overlayImage(file) { return new Uint8Array(readFileSync(join(dir, file))); }

/** Small deterministic generator so every oracle run is reproducible. */
export function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function createKit(overlay = STGTRAIN) {
    const ENTRY = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(overlay, ENTRY, { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 },
        undefined, undefined, 0x80082cb0, { image: RESIDENT, base: 0x80010000 });
    rt.cpu.gp = 0x8005cb50;
    const kit = {
        rt,
        mem: rt.mem,
        log: [],
        _next: 0x0fe00000,
        /** Reset the event log. */
        reset() { kit.log.length = 0; },
        push(...ev) { kit.log.push(ev.map((v) => (typeof v === "number" ? v >>> 0 : v))); },
        /** A recording stub at a fresh fake address; returns the address. */
        stub(name, ret = 0, { args = 4, before, silent = false } = {}) {
            const addr = kit._next; kit._next += 0x10;
            rt.cpu.setStub(addr, (c) => {
                const a = [c.reg(4), c.reg(5), c.reg(6), c.reg(7)].slice(0, args);
                if (!silent) kit.push(name, ...a);
                before?.(c, a);
                return typeof ret === "function" ? ret(...a) : ret;
            });
            return addr;
        },
        /** Install a stub as the pointer stored in a cell (resident service). */
        cell(addr, name, ret, opts) { rt.mem.write32(addr, kit.stub(name, ret, opts)); },
        /** Install a stub directly at an original function address. */
        at(addr, name, ret, opts) {
            const { args = 4, before, silent = false } = opts ?? {};
            rt.cpu.setStub(addr, (c) => {
                const a = [c.reg(4), c.reg(5), c.reg(6), c.reg(7)].slice(0, args);
                if (!silent) kit.push(name, ...a);
                before?.(c, a);
                return typeof ret === "function" ? ret(...a) : ret;
            });
        },
        call(addr, args, budget = 400000) { return rt.cpu.call(addr, args, budget) | 0; },
        words(ranges) {
            const out = [];
            for (const [base, len] of ranges) for (let i = 0; i < len; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
            return out;
        },
        fill(base, len, next) {
            for (let i = 0; i < len; i += 4) rt.mem.write32(base + i, next());
        },
        /**
         * Run `seed`, the original, then `seed` again and the port; assert equal events,
         * return value and memory windows.
         */
        compare(label, { seed, original, port, ranges, ret = true }) {
            seed(); kit.reset();
            const o = original();
            const oLog = kit.log.map((e) => e.slice());
            const oMem = kit.words(ranges);
            seed(); kit.reset();
            const p = port();
            const n = Math.max(kit.log.length, oLog.length);
            for (let i = 0; i < n; i++) {
                if (JSON.stringify(kit.log[i]) !== JSON.stringify(oLog[i])) {
                    if (process.env.KIT_DEBUG) console.error("original", JSON.stringify(oLog), "\nport", JSON.stringify(kit.log));
                    assert.fail(`${label}: call ${i} differs: port ${JSON.stringify(kit.log[i])} original ${JSON.stringify(oLog[i])} (port ${kit.log.length} calls, original ${oLog.length})`);
                }
            }
            if (ret) assert.equal(p | 0, o | 0, `${label}: return`);
            assert.deepEqual(kit.words(ranges), oMem, `${label}: memory`);
        },
    };
    return kit;
}

// ── the gym screen objects' shared services ─────────────────────────────────────────────────────

export const UI = {
    source: 0x80190100,      // the text source the resolver returns
    block: 0x80191000,       // the partner's stats block (record + 8)
    widget: 0x801b0000,      // widget objects, 0x200 apart
    cursor: 0x801b8000,
    scratch: 0x801b9000,
};
/** The text widget methods by slot: name, slot, arity (receiver included). */
export const WIDGET_METHODS = [
    ["set", 0x114, 3], ["number", 0x118, 3], ["fmt", 0x120, 4], ["rescan", 0x128, 1], ["scroll", 0x130, 2],
    ["colour", 0x138, 2], ["origin", 0x134, 3], ["show", 0x144, 2], ["flag", 0x160, 2], ["done", 0x168, 1], ["waiting", 0x170, 1],
];
export const CURSOR_METHODS = [["cursorShow", 0x80, 2], ["cursorPlace", 0x84, 3]];

/**
 * Install the gym's services as recording stubs for the ORIGINAL and return the matching host for
 * the PORT. `cfg` is read at call time so a test can change answers between cases:
 *   cfg.pressed / held / repeat  pad words       cfg.done(widget) / waiting(widget)   text answers
 *   cfg.fold(obj)                 fold tick      cfg.channel  the sound channel       cfg.created[]  widget queue
 */
export function installUi(kit, cfg) {
    const mem = kit.mem;
    const widgets = {};
    const widgetAt = (k) => UI.widget + k * 0x200;
    for (let k = 0; k < 24; k++) {
        for (const [name, slot, args] of WIDGET_METHODS) {
            mem.write32(widgetAt(k) + slot, kit.stub(name, name === "done" ? (w) => cfg.done(w) : name === "waiting" ? (w) => cfg.waiting(w) : 0, { args }));
        }
    }
    for (let k = 0; k < 4; k++) {
        for (const [name, slot, args] of CURSOR_METHODS) mem.write32(UI.cursor + k * 0x100 + slot, kit.stub(name, 0, { args }));
    }
    kit.cell(0x80044f4c, "source", () => UI.source, { args: 1 });
    kit.cell(0x8004b7d0 + 0x3f4, "pressed", () => cfg.pressed, { args: 0 });
    kit.cell(0x8004b7d0 + 0x3f8, "held", () => cfg.held, { args: 0 });
    kit.cell(0x8004b7d0 + 0x3fc, "repeat", () => cfg.repeat, { args: 0 });
    kit.cell(0x8004b7d0 + 0x408, "bit", (_p, logical) => logical, { args: 2, silent: true, before: (_c, a) => kit.push("bit", a[1]) });
    kit.cell(0x80055c48, "play", () => cfg.channel, { args: 1 });
    kit.cell(0x80055c50, "stop", 0, { args: 2 });
    kit.cell(0x8008d2b0, "foldStart", 0, { args: 2 });
    kit.cell(0x8008d2b4, "foldTick", (o) => cfg.fold(o), { args: 1 });
    kit.cell(0x8004b484, "block", () => UI.block, { args: 1 });
    kit.cell(0x8004b44c, "roster", (pos) => (cfg.roster ? cfg.roster(pos) : pos), { args: 1 });
    kit.cell(0x8004b468, "projection", 0, { args: 2, silent: true, before: (_c, a) => {
        kit.push("projection", a[0], a[1]);
        for (let i = 0; i < 0x2c; i++) mem.write8(a[1] + i, (cfg.projection ?? [])[i] ?? 0);
    } });
    kit.cell(0x8004b43c, "rankGroup", () => cfg.group ?? 0, { args: 0 });
    let created = 0;
    kit.at(0x8001ae38, "createText", () => cfg.created[created++] ?? widgetAt(0), { args: 4 });
    kit.at(0x8001b364, "createCursor", () => UI.cursor, { args: 4 });
    const host = {
        textSource() { kit.push("source", mem.read32(0x8005cca8) + 0x10b); return UI.source; },
        createText(t, k, x, y) { kit.push("createText", t, k, x, y); return cfg.created[created++] ?? widgetAt(0); },
        createCursor(t, o, x, y) { kit.push("createCursor", t, o, x, y); return UI.cursor; },
        textSet(w, s, i) { kit.push("set", w, s, i); },
        textNumber(w, l, v) { kit.push("number", w, l, v); },
        textFormat(w, s, i, l) { kit.push("fmt", w, s, i, l); },
        textRescan(w) { kit.push("rescan", w); return 0; },
        textOrigin(w, x, y) { kit.push("origin", w, x, y); },
        textScroll(w, m) { kit.push("scroll", w, m); },
        textColour(w, c) { kit.push("colour", w, c); },
        textShow(w, v) { kit.push("show", w, v); },
        textFlag(w, v) { kit.push("flag", w, v); },
        textDone(w) { kit.push("done", w); return cfg.done(w); },
        textWaiting(w) { kit.push("waiting", w); return cfg.waiting(w); },
        cursorShow(c, v) { kit.push("cursorShow", c, v); },
        cursorPlace(c, x, y) { kit.push("cursorPlace", c, x, y); },
        padPressed() { kit.push("pressed"); return cfg.pressed; },
        padHeld() { kit.push("held"); return cfg.held; },
        padRepeat() { kit.push("repeat"); return cfg.repeat; },
        padBit(logical) { kit.push("bit", logical); return logical; },
        playSound(id) { kit.push("play", id); return cfg.channel; },
        stopSound(id, ch) { kit.push("stop", id, ch); },
        foldStart(f, open) { kit.push("foldStart", f, open); },
        foldTick(f) { kit.push("foldTick", f); return cfg.fold(f); },
        rosterSlot(pos) { kit.push("roster", pos); return cfg.roster ? cfg.roster(pos) : pos; },
        projectionScratch() { return UI.scratch; },
        recordBlock(slot) { kit.push("block", slot); return UI.block; },
        copyProjection(slot, dest) {
            kit.push("projection", slot, dest);
            for (let i = 0; i < 0x2c; i++) mem.write8(dest + i, (cfg.projection ?? [])[i] ?? 0);
        },
        rankGroup() { kit.push("rankGroup"); return cfg.group ?? 0; },
        setState0(t, v) { kit.push("setState0", t, v); },
        rand() { kit.push("rand"); return cfg.rand(); },
    };
    kit.cell(0x8004dc0c, "rand", () => cfg.rand(), { args: 0 });
    return { host, widgetAt, resetCreated() { created = 0; } };
}
