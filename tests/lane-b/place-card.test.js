// Lane B oracle: engine/dw3/ui/native/place-card.ts must match the fieldstg
// stage-entry location title card — F0x80087D68 (create), F0x80087974 (frame
// callback), F0x800875AC (name lookup), F0x80087704 (bar animator) and
// F0x80087854 (bar draw). The originals run through engine/native on
// resident.bin + fieldstg.bin (load base 0x80082CB0) with the real name table
// and bar templates. The shared resident services are the EXISTING translated
// ones on both sides: the task factory and its state methods go to
// TranslatedTaskTree, F0x8001AE38 and widget +0x114 to ShopWidgetServices,
// +0x130 / +0x168 to setTextScroll / getUnkC3, and every widget is ticked by
// textRevealTick (drawing through drawTextElement) after the card each frame,
// so the typewriter runs to the end for real. Calls and memory compare frame
// by frame.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { TranslatedTaskTree } from "../../engine/dw3/ui/translated-task-tree.ts";
import { ShopWidgetServices } from "../../engine/dw3/ui/shop-widget-services.ts";
import { installShopFont } from "../../engine/dw3/ui/shop-font.ts";
import { fetchTableEntry } from "../../engine/dw3/ui/fetch-table.ts";
import { textRevealTick } from "../../engine/dw3/ui/text-window.ts";
import { drawTextElement } from "../../engine/dw3/ui/text-drawer.ts";
import { setTextScroll, getUnkC3 } from "../../engine/dw3/ui/text-element-setters.ts";
import { BASE_TABLE, TEXT_ELEMENT_SIZE } from "../../engine/dw3/ui/create-text-element.ts";
import {
    PLACE_CARD_CREATE, PLACE_CARD_TICK, PLACE_CARD_BUSY, PLACE_CARD_NAME_TABLE, PLACE_CARD_BAR_TEMPLATES,
    placeCardCreate, placeCardTick,
} from "../../engine/dw3/ui/native/place-card.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../web/assets/native");
const resident = new Uint8Array(readFileSync(join(root, "screens/resident.bin")));
const fieldstg = new Uint8Array(readFileSync(join(root, "fieldstg.bin")));
const font = new Uint8Array(readFileSync(resolve(here, "../../web/assets/data/shop_font.bin")));
const innBank = new Uint8Array(readFileSync(resolve(here, "../../web/assets/data/inn-banks/94.bin")));
const placeCardJson = JSON.parse(readFileSync(resolve(here, "../../web/assets/data/place_card.json"), "utf8"));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const FIELDSTG_BASE = 0x80082cb0;

const rt = new NativeStageRuntime(new Uint8Array(8), entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, fieldstg, FIELDSTG_BASE, { image: resident, base: 0x80010000 });
const mem = rt.mem;
const STUB = 0x0fe40000;
const VIEW = 0x80170000;
const OT = 0x80170400;
const PKT = 0x80170800;
const AREA_BANK = 0x801e0000;
const PLACE_BANK = 0x801e8000;
const TEXT_GLOBAL = 0x8005cca8;
const CELLS = { scene: 0x8004b438, bank: 0x80044f4c, view: 0x8004df8c, delta: 0x8004df9c, cursor: 0x8004df68, flush: 0x8004df6c };
const TASK_METHODS = { 0x28: [0x80014274, 1], 0x2c: [0x80014288, 1], 0x38: [0x800142ac, 0], 0x3c: [0x800142c8, 0] };
const WIDGET_METHODS = { 0x114: [0x800194e8, 2], 0x130: [0x8001a1b8, 1], 0x168: [0x8001a460, 0] };
const VIEW_METHODS = { 0x110: [0x8001e0b0, 2], 0x114: [0x8001e0bc, 2], 0x138: [0x8001dfa8, 1] };

// Two text banks in the shipped layout (u32 count, u32 offsets, NUL-terminated
// strings), each entry a real inn name from eshtlnam so every glyph is a real
// font code; the place bank is rotated so the two names differ in length.
function makeBank(count, shift) {
    const dv = new DataView(innBank.buffer, innBank.byteOffset, innBank.byteLength);
    const n = dv.getUint32(0, true);
    const strings = [];
    for (let i = 0; i < count; i++) {
        const off = dv.getUint32(4 + ((i + shift) % n) * 4, true);
        strings.push(innBank.subarray(off, innBank.indexOf(0, off) + 1));
    }
    const head = 4 + count * 4;
    const out = new Uint8Array(head + strings.reduce((a, s) => a + s.length, 0));
    const ov = new DataView(out.buffer);
    ov.setUint32(0, count, true);
    let p = head;
    strings.forEach((s, i) => { ov.setUint32(4 + i * 4, p, true); out.set(s, p); p += s.length; });
    return out;
}
const areaBank = makeBank(160, 0);
const placeBank = makeBank(160, 7);

const LOG = [];
const CTL = {};
let S = null; // the fresh translated services of one run

// The runtime hooks fieldstg's render-layer method targets, three of which are
// jump-table targets inside the card's own callback; the card must run as shipped.
for (const a of rt.cpu.stubAddresses()) if (a >= 0x800875ac && a < 0x80087dbc) rt.cpu.clearStub(a);
const st = (a, f) => rt.cpu.setStub(a, f);
const arg = (c, i) => c.reg(4 + i) | 0;
const methodStub = (slot, [addr, n]) => st(addr, (c) =>
    hostImpl.callMethod(c.reg(4) >>> 0, slot, Array.from({ length: n }, (_, k) => arg(c, 1 + k))));
for (const [slot, def] of Object.entries(TASK_METHODS)) methodStub(Number(slot), def);
for (const [slot, def] of Object.entries(WIDGET_METHODS)) methodStub(Number(slot), def);
for (const [slot, def] of Object.entries(VIEW_METHODS)) methodStub(Number(slot), def);

const hostImpl = {
    callMethod(t, slot, args) {
        t >>>= 0;
        LOG.push(["method", t, slot, ...args.map((a) => a | 0)]);
        if (S.tree.tasks.has(t)) { S.tree.callMethod(t, slot, args); return 0; }
        if (t === VIEW) {
            switch (slot) {
                case 0x110: mem.write16(VIEW, args[0] & 0xffff); mem.write16(VIEW + 2, args[1] & 0xffff); return 0;
                case 0x114: mem.write16(VIEW + 4, args[0] & 0xffff); mem.write16(VIEW + 6, args[1] & 0xffff); return 0;
                case 0x138: return (mem.read32(VIEW + 0x5c) + args[0] * 4) >>> 0; // F0x8001DFA8, buffer 0
            }
        }
        if (t === 0) return CTL.nullFlag; // a missing name: the card reads +0x168 through a null widget
        switch (slot) {
            case 0x114: S.widgets.textSet(t, args[0] >>> 0, args[1] | 0); return 0;
            case 0x130: setTextScroll(mem, t, args[0] | 0); return 0;
            case 0x168: return getUnkC3(mem, t);
        }
        throw new Error(`untranslated method ${slot.toString(16)} on ${t.toString(16)}`);
    },
    createTask(handler, size, extra, key) {
        LOG.push(["task", handler >>> 0, size | 0, extra | 0, key | 0]);
        const obj = S.tree.allocate(handler >>> 0, size, extra);
        // F0x800143DC: the base state-method table, the handler, the scheduler key.
        for (const [off, value] of BASE_TABLE) if (off !== 0x48) mem.write32(obj + off, value);
        mem.write32(obj, key);
        return obj;
    },
    createText(l, k, x, y) { LOG.push(["text", l | 0, k | 0, x | 0, y | 0]); return S.widgets.createTextElement(l, k, x, y); },
    sceneId() { LOG.push(["scene"]); return CTL.scene; },
    textBank(b) {
        LOG.push(["bank", b >>> 0]);
        const lang = mem.read32(TEXT_GLOBAL);
        if ((b >>> 0) === lang + 0xa9) return AREA_BANK;
        if ((b >>> 0) === lang + 0xb7) return PLACE_BANK;
        throw new Error(`unloaded bank ${b}`);
    },
    viewForKey(k) { LOG.push(["view", k | 0]); return VIEW; },
    frameDelta() { LOG.push(["delta"]); return CTL.delta; },
    packetCursor() { LOG.push(["cursor"]); return CTL.cursor; },
    flushPacketCursor(c) { LOG.push(["flush", c >>> 0]); CTL.cursor = c >>> 0; },
};
st(0x800143dc, (c) => hostImpl.createTask(c.reg(4), arg(c, 1), arg(c, 2), arg(c, 3)));
st(0x8001ae38, (c) => hostImpl.createText(arg(c, 0), arg(c, 1), arg(c, 2), arg(c, 3)));
st(STUB + 0x00, () => hostImpl.sceneId());
st(STUB + 0x04, (c) => hostImpl.textBank(c.reg(4)));
st(STUB + 0x08, (c) => hostImpl.viewForKey(arg(c, 0)));
st(STUB + 0x0c, () => hostImpl.frameDelta());
st(STUB + 0x10, () => hostImpl.packetCursor());
st(STUB + 0x14, (c) => { hostImpl.flushPacketCursor(c.reg(4)); return 0; });
st(STUB + 0x18, () => hostImpl.callMethod(0, 0x168, []));

const zero = (a, n) => mem.bytes.fill(0, a & 0x1fffff, (a & 0x1fffff) + n);

function freshServices() {
    zero(0x800a0000, 0x70000);  // widget arena + task storage
    const widgets = new ShopWidgetServices(mem, { stringById: (m, s, i) => fetchTableEntry(m, s, i) });
    const classes = new Map([[PLACE_CARD_TICK, { name: "place card", childSlots: [], tick() {} }]]);
    const tree = new TranslatedTaskTree(mem, classes, (task) => widgets.retireTask(task));
    const drawScratch = widgets.arena.alloc(0x48, 4);
    const textOt = widgets.arena.alloc(8, 4);
    const textPackets = widgets.arena.alloc(0x4000, 4);
    const drawerHost = {
        viewForKey: () => 1, bucketFor: () => textOt, packetCursor: () => textPackets, flushPacketCursor: () => {},
        rotMatrixYXZ: () => { throw new Error("rotated text"); }, scaleMatrix: () => { throw new Error("scaled text"); },
        applyMatrixSV: () => { throw new Error("transformed text"); },
        alloc: widgets.arena.alloc, free: widgets.arena.free,
        stringById: (bank, id) => fetchTableEntry(mem, bank, id),
    };
    const revealHost = {
        draw: (self) => drawTextElement(mem, drawerHost, self, drawScratch),
        playPackedSound: (id) => LOG.push(["sound", id >>> 0]),
        padButtonWord: () => 0, logicalButtonBit: (code) => code,
        free: (ptr) => { if (widgets.arena.has(ptr)) widgets.arena.free(ptr); },
    };
    return { widgets, tree, reveal: () => widgets.forEachText((w) => textRevealTick(mem, revealHost, w)) };
}

const DEFAULT = { scene: 512, delta: 1, nullFlag: 0, lang: 2 };

function reset(c) {
    Object.assign(CTL, DEFAULT, c.ctl ?? {});
    installShopFont(mem, font);
    zero(AREA_BANK, 0x10000);
    mem.load(areaBank, AREA_BANK);
    mem.load(placeBank, PLACE_BANK);
    mem.write32(TEXT_GLOBAL, CTL.lang);
    mem.write32(PLACE_CARD_BUSY, c.busy ?? 0);
    zero(VIEW, 0x1000);
    mem.write32(VIEW + 0x5c, OT);
    for (const [slot, [addr]] of Object.entries(VIEW_METHODS)) mem.write32(VIEW + Number(slot), addr);
    mem.write32(CELLS.scene, STUB + 0x00);
    mem.write32(CELLS.bank, STUB + 0x04);
    mem.write32(CELLS.view, STUB + 0x08);
    mem.write32(CELLS.delta, STUB + 0x0c);
    mem.write32(CELLS.cursor, STUB + 0x10);
    mem.write32(CELLS.flush, STUB + 0x14);
    mem.write32(0x168, STUB + 0x18);
    S = freshServices();
    LOG.length = 0;
}

function snap(task) {
    const out = [];
    const words = (a, n) => { for (let i = 0; i < n; i += 4) out.push(mem.read32(a + i) >>> 0); };
    words(task, 0x1c0);
    const extra = mem.read32(task + 0x24) >>> 0;
    words(extra, 8);
    for (const k of [0, 4]) {
        const w = mem.read32(extra + k) >>> 0;
        if (w >= 0x800a0000 && w < 0x80100000) words(w, TEXT_ELEMENT_SIZE & ~3);
    }
    out.push(mem.read32(PLACE_CARD_BUSY) >>> 0);
    words(VIEW, 8);
    words(OT, 12);
    words(PKT, 0x18 * 10);
    return out;
}

const origCreate = (show) => rt.cpu.call(PLACE_CARD_CREATE, [show], 5000) >>> 0;
const portCreate = (show) => placeCardCreate(mem, hostImpl, show);
const origTick = (t, x) => rt.cpu.call(PLACE_CARD_TICK, [t, x], 200000);
const portTick = (t, x) => placeCardTick(mem, hostImpl, t, x);

/**
 * Create the card, optionally seed it, then run `frames` callbacks, each
 * followed by the widgets' own reveal tick. script(f, ctl, task) runs first
 * each frame (it plays the field: release, delta changes).
 */
function scenario(name, frames, script, c = {}) {
    const record = (create, tick) => {
        reset(c);
        const task = create(c.show ?? 1);
        const out = [[LOG.slice(), snap(task)]];
        c.seed?.(task, mem.read32(task + 0x24) >>> 0);
        const extra = mem.read32(task + 0x24) >>> 0;
        for (let f = 0; f < frames; f++) {
            script?.(f, CTL, task);
            CTL.cursor = PKT;
            zero(PKT, 0x18 * 10);
            mem.write32(OT, 0x00ffffff);
            LOG.length = 0;
            tick(task, extra);
            S.reveal();
            out.push([LOG.slice(), snap(task)]);
        }
        return { out, task, extra };
    };
    const o = record(origCreate, origTick);
    const p = record(portCreate, portTick);
    assert.equal(p.task, o.task, `${name}: task address`);
    for (let f = 0; f < o.out.length; f++) {
        assert.deepEqual(p.out[f][0], o.out[f][0], `${name} frame ${f - 1}: calls`);
        const d = p.out[f][1].findIndex((v, i) => v !== o.out[f][1][i]);
        assert.deepEqual(p.out[f][1], o.out[f][1], `${name} frame ${f - 1}: memory word ${d} (${p.out[f][1][d]} vs ${o.out[f][1][d]})`);
    }
    return o;
}

const state = (task) => [mem.read32(task + 0x0c) | 0, mem.read32(task + 0x10) | 0];
const release = (at) => (f, ctl, task) => {
    if (f >= at && state(task)[0] === 2 && state(task)[1] === 0) S.tree.callMethod(task, 0x2c, [1]);
};
const nameTable = (() => {
    const out = [];
    for (let a = PLACE_CARD_NAME_TABLE; mem.read16(a + 2) !== 0; a += 4)
        out.push({ area: mem.read8(a), place: mem.read8(a + 1), scene: (mem.read16(a + 2) << 16) >> 16 });
    return out;
})();

test("the image carries the jump table, name table and bar templates the port assumes", () => {
    const targets = [0x4dcc, 0x4df0, 0x4e28, 0x4e38, 0x4e60];
    targets.forEach((t, i) => assert.equal((mem.read32(0x80082e34 + 4 * i) >>> 0) - FIELDSTG_BASE, t));
    assert.equal(nameTable.length, 239);
    placeCardJson.bars.forEach((b, i) => {
        const r = PLACE_CARD_BAR_TEMPLATES + 0x24 * i;
        const s = (o) => (mem.read16(r + o) << 16) >> 16;
        assert.deepEqual([mem.read32(r), s(4), s(6), s(8), s(10), mem.read32(r + 0xc) & 0xffffff, mem.read32(r + 0x10),
            mem.read32(r + 0x14) | 0, mem.read32(r + 0x18) | 0, mem.read32(r + 0x1c) | 0],
            [0, b.x, b.y, b.w, b.h, b.color[0] | b.color[1] << 8 | b.color[2] << 16, b.axis, b.near, b.far, b.step]);
    });
});

test("create F0x80087D68: task, argument, busy flag", () => {
    for (const show of [1, 0, -1, 0x12345]) {
        const o = scenario(`create ${show}`, 0, null, { show });
        assert.deepEqual(o.out[0][0], [["task", PLACE_CARD_TICK, 0x1c0, 8, 9]]);
        assert.equal(mem.read32(o.task + 4) | 0, show);
        assert.equal(mem.read32(PLACE_CARD_BUSY), 1);
    }
});

test("full card: build, bars, typewriter to the end, park, release, hold, slit, busy clear", () => {
    const trace = [];
    const watch = (f, ctl, task) => {
        release(200)(f, ctl, task);
        const x = mem.read32(task + 0x24) >>> 0;
        const w = [0, 4].map((k) => mem.read32(x + k) >>> 0);
        trace.push([...state(task), ...w.flatMap((a) => (a ? [mem.read16(a + 0xa4), mem.read8(a + 0xc3), mem.read16(a + 0x62)] : []))]);
    };
    const o = scenario("full", 300, watch);

    // trace[f] is the card and its two widgets before callback f (both runs
    // append; the first 300 rows are the original's): [state, sub-state,
    // then per widget revealed count, end-of-text flag, string bytes].
    const t = trace.slice(0, 300);
    const frames = o.out.slice(1).map(([log]) => log);
    // Build frame: two widgets at (128,26) and (40,68), delay 5, then +0x38.
    assert.deepEqual(frames[0].filter((e) => e[0] === "text"), [["text", 0x1003, 1, 0x80, 0x1a], ["text", 0x1003, 1, 0x28, 0x44]]);
    assert.ok(frames[0].some((e) => e[0] === "method" && e[2] === 0x130 && e[3] === 5));
    // First letter after callback 6; one letter every six callbacks.
    assert.deepEqual([t[6][2], t[7][2], t[13][2]], [0, 1, 2]);
    // The 14-letter area name shows its last letter after callback 84, but the
    // end-of-text flag the card waits on only rises one reveal step later.
    assert.deepEqual(t[85].slice(2, 5), [14, 0, 15]);
    assert.deepEqual(t[91].slice(2, 5), [15, 1, 15]);
    assert.deepEqual(t[91].slice(0, 2), [1, 4]);
    assert.deepEqual(t[92].slice(0, 2), [2, 0], "parks the callback after both flags are up");
    assert.deepEqual(t[200].slice(0, 2), [2, 1], "parked until the field releases it");
    assert.deepEqual([t[259].slice(0, 2), t[260].slice(0, 2)], [[2, 1], [2, 3]], "a 60-frame hold");
    const slit = frames.map((log) => log.filter((e) => e[0] === "method" && e[1] === VIEW && e[2] === 0x114)).flat();
    assert.equal(slit.length, 15);
    assert.deepEqual(slit.map((e) => e[4]), Array.from({ length: 15 }, (_, i) => 0xe0 - 0x10 * i));
    assert.equal(mem.read32(PLACE_CARD_BUSY), 0);
    assert.equal(state(o.task)[0], 3);
});

test("several stages: first, middle, last, sign-truncated scene id, and every language", () => {
    for (const r of [nameTable[0], nameTable[120], nameTable[238]]) {
        const o = scenario(`scene ${r.scene}`, 150, null, { ctl: { scene: r.scene } });
        const log = o.out[1][0];
        assert.ok(log.some((e) => e[0] === "method" && e[2] === 0x114 && e[4] === r.area));
        assert.ok(log.some((e) => e[0] === "method" && e[2] === 0x114 && e[4] === r.place));
    }
    scenario("scene 0x10200", 3, null, { ctl: { scene: 0x10200 } });
    for (let lang = 0; lang < 7; lang++) scenario(`lang ${lang}`, 2, null, { ctl: { lang } });
});

test("a scene missing from the name table: no widgets, bars still run, sub-state 4 reads null widgets", () => {
    for (const nullFlag of [0, 1]) {
        const o = scenario(`missing ${nullFlag}`, 90, null, { ctl: { scene: 9999, nullFlag } });
        assert.ok(!o.out[1][0].some((e) => e[0] === "text"));
        assert.ok(o.out.some(([log]) => log.some((e) => e[0] === "method" && e[1] === 0 && e[2] === 0x168)));
        assert.deepEqual(state(o.task), nullFlag ? [2, 0] : [1, 4]);
    }
    scenario("scene 0", 4, null, { ctl: { scene: 0 } });
});

test("show argument 0: no bars, no names, parks in state 2; release still closes", () => {
    const o = scenario("show 0", 100, release(10), { show: 0 });
    assert.ok(!o.out.some(([log]) => log.some((e) => e[0] === "text" || e[0] === "cursor")));
    assert.equal(state(o.task)[0], 3);
});

test("frame delta drives the hold", () => {
    for (const delta of [2, 7, 0x3c, -5]) {
        const seed = (t) => { mem.write32(t + 0x0c, 2); mem.write32(t + 0x10, 1); mem.write32(t + 4, 1); };
        scenario(`delta ${delta}`, 40, null, { seed, ctl: { delta } });
    }
});

test("seeded frames: task states, sub-states, slit values", () => {
    const seed = (s, sub, more) => (t, x) => {
        mem.write32(t + 4, 1); mem.write32(t + 0x0c, s); mem.write32(t + 0x10, sub);
        more?.(t, x);
    };
    for (const s of [-1, 3, 4, 7]) scenario(`state ${s}`, 2, null, { seed: seed(s, 0), busy: 1 });
    for (const sub of [5, 9, 0x7fffffff, -1]) scenario(`state 1 sub ${sub}`, 3, null, { seed: seed(1, sub) });
    for (const sub of [-1, 0, 2, 3, 4, 9]) scenario(`state 2 sub ${sub}`, 3, null, { seed: seed(2, sub) });
    for (const h of [0x10, 0x18, -0x10, 0x7ff0]) {
        const more = (t) => { mem.write16(t + 0x1b8, 5); mem.write16(t + 0x1ba, 0x7ffc); mem.write16(t + 0x1bc, 9); mem.write16(t + 0x1be, h); };
        scenario(`slit h ${h}`, 3, null, { seed: seed(2, 3, more) });
    }
});

test("bar animator and draw over random records", () => {
    let rng = 0x1234567;
    const rand = () => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) >>> 8);
    const pick = (a) => a[rand() % a.length];
    for (let n = 0; n < 40; n++) {
        const writes = [];
        for (let i = 0; i < 10; i++) {
            const r = 0x50 + 0x24 * i;
            writes.push([32, r, pick([0, 1, 1, 0x80000000])]);
            for (const o of [4, 6, 8, 10]) writes.push([16, r + o, pick([0, 1, 320, 240, 0x7fff, 0x8000, 0xfff0]) + (rand() & 7)]);
            writes.push([32, r + 0xc, rand() * 0x101]);
            writes.push([32, r + 0x10, pick([0, 1, 2, 3, -1])]);
            writes.push([32, r + 0x14, pick([0, 124, 320, -40, 0x7fffffff]) + (rand() & 3)]);
            writes.push([32, r + 0x18, pick([0, 240, 320, -8, 0x80000000]) + (rand() & 3)]);
            writes.push([32, r + 0x1c, pick([1, 2, 8, 16, 0, -3, 0x7fffffff])]);
        }
        const seed = (t) => {
            mem.write32(t + 4, 1); mem.write32(t + 0x0c, 2); mem.write32(t + 0x10, 0);
            for (const [bits, off, v] of writes) (bits === 32 ? mem.write32 : mem.write16).call(mem, t + off, v);
        };
        scenario(`random bars ${n}`, 6, null, { seed });
    }
});
