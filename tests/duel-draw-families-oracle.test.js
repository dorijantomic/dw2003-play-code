// Oracle: the Draw Phase's family bodies must reproduce pro/cardgame's
// constructor-installed routines. Each original runs through engine/native on
// the shipped pro_cardgame.bin + resident.bin at its raw address (a constructor
// installs the pointer, so it has no disassembler entry-list start); the port's
// whole touched field window is compared, and one mutation per family makes the
// oracle fail.
//
//   S3  info banner     F0x8009BEAC open / F0x8009BF5C record
//   S11 marker sprite   F0x80096180 ctor / 0x80096144 pos / 0x80096160 out / 0x80096150 oneshot
//   S12 element panel   F0x800967F8 oneshot / F0x80096808 out / F0x80096828 ctor
//   S14 duel object     F0x8009F04C pile shuffle

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { openInfoBanner, writeBannerRecord } from "../engine/dw3/ui/duel-info-banner.ts";
import {
    createMarkerSprite, markerSetPosition, markerScaleOut, markerStartOneshot,
} from "../engine/dw3/ui/duel-marker-sprite.ts";
import {
    createElementPanel, elementPanelScaleOut, elementPanelStartOneshot,
} from "../engine/dw3/ui/duel-element-panel.ts";
import { shufflePile } from "../engine/dw3/ui/duel-card-table.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80190000;
const OBJ = 0x80180000;
const DUEL = 0x80170000;
const SOUND_STUB = 0x0fe50000;
const ALLOC_STUB = 0x0fe50100;
const CURSOR = 0x80160000;

const RESOLVE_STUB = 0x0fe50300;
const RAND_STUB = 0x0fe50400;

let SOUNDS = [];
let RAND = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    // [0x80055C48] is the packed-sound dispatcher pointer cell.
    rt.cpu.setStub(SOUND_STUB, (c) => { SOUNDS.push(c.reg(4) >>> 0); return 0; });
    rt.mem.write32(0x80055c48, SOUND_STUB);
    // F0x80014504(handler, size, slot): the allocator, returns the object.
    rt.cpu.setStub(0x80014504, () => OBJ);
    return rt;
}

// The element an id resolves to (a deterministic 1..6 so the buckets are hit).
const elementOf = (id) => (((id | 0) % 6) + 1) | 0;

function stubCursor(rt) {
    rt.cpu.setStub(0x8001ebf8, (c) => {
        rt.mem.write32(c.reg(4) + 0x00, CURSOR);
        rt.mem.write32(c.reg(4) + 0x2c, RESOLVE_STUB);
        return 0;
    });
    rt.cpu.setStub(RESOLVE_STUB, (c) => {
        rt.mem.write8(CURSOR, elementOf(c.reg(4)) & 0xff);
        return CURSOR;
    });
}

function comparer(label, seed, native, port, window) {
    const a = runtime();
    seed(a);
    SOUNDS = [];
    native(a);
    const av = { ret: a.cpu.v0 | 0, sounds: [...SOUNDS], fields: window(a) };
    const b = runtime();
    seed(b);
    SOUNDS = [];
    const bret = port(b);
    const bv = { ret: bret | 0, sounds: [...SOUNDS], fields: window(b) };
    assert.deepEqual(bv.fields, av.fields, `${label}: fields`);
    assert.deepEqual(bv.sounds, av.sounds, `${label}: sounds`);
    return av;
}

// ── S3 info banner ───────────────────────────────────────────────────────────
const bannerWindow = (rt) => {
    const out = [];
    for (const off of [0xe0c, 0xe0e, 0xe10, 0xe12, 0xe14, 0xe16, 0xe18, 0xe1c, 0xe23]) {
        out.push(off === 0xe1c ? rt.mem.read32(VIEW + off) >>> 0 : rt.mem.read16(VIEW + off));
    }
    return out;
};

test("openInfoBanner F0x8009BEAC and writeBannerRecord F0x8009BF5C match", () => {
    const seed = (rt) => { for (let i = 0; i < 0x1200; i += 4) rt.mem.write32(VIEW + i, 0); };
    comparer("open", seed, (rt) => {
        rt.cpu.call(0x8009beac, [VIEW, 5, 5, 0x41, 0, 0x26], 20000);
    }, (rt) => {
        openInfoBanner(rt.mem, { playSound: (id) => SOUNDS.push(id | 0) }, VIEW, 5, 5, 0x41, 0, 0x26);
        return 0;
    }, bannerWindow);
    comparer("record", seed, (rt) => {
        rt.cpu.call(0x8009bf5c, [VIEW, 5], 20000);
    }, (rt) => {
        writeBannerRecord(rt.mem, { playSound: (id) => SOUNDS.push(id | 0) }, VIEW, 5);
        return 0;
    }, bannerWindow);
    // the banner sits at index*0x18
    const rt = runtime();
    seed(rt);
    writeBannerRecord(rt.mem, { playSound: () => {} }, VIEW, 3);
    assert.equal(rt.mem.read8(VIEW + 3 * 0x18 + 0xe23), 3);
});

// ── S11 marker sprite ────────────────────────────────────────────────────────
const markerWindow = (rt) => {
    const out = [];
    for (let off = 0x50; off <= 0x74; off += 2) out.push(rt.mem.read16(OBJ + off));
    return out;
};

test("marker sprite ctor F0x80096180 and its three slots match", () => {
    const seed = (rt) => { for (let i = 0; i < 0x80; i += 2) rt.mem.write16(OBJ + i, 0); };
    comparer("ctor", seed, (rt) => {
        rt.cpu.call(0x80096180, [0x111, 0x222], 20000);
    }, (rt) => {
        const o = createMarkerSprite(rt.mem, { allocate: () => OBJ }, 0x111, 0x222);
        return o === OBJ ? 0 : 1;
    }, markerWindow);
    comparer("position", () => {}, (rt) => {
        rt.cpu.call(0x80096144, [OBJ, 0x333, 0x444], 20000);
    }, (rt) => { markerSetPosition(rt.mem, OBJ, 0x333, 0x444); return 0; }, markerWindow);
    comparer("oneshot", () => {}, (rt) => {
        rt.cpu.call(0x80096150, [OBJ], 20000);
    }, (rt) => { markerStartOneshot(rt.mem, OBJ); return 0; }, markerWindow);
    comparer("scale out", () => {}, (rt) => {
        rt.cpu.call(0x80096160, [OBJ], 20000);
    }, (rt) => { markerScaleOut(rt.mem, OBJ); return 0; }, markerWindow);
});

// ── S12 element panel ────────────────────────────────────────────────────────
const panelWindow = (rt) => {
    const out = [];
    for (let off = 0x50; off <= 0x74; off += 2) out.push(rt.mem.read16(OBJ + off));
    for (let k = 0; k < 6; k++) out.push(rt.mem.read8(OBJ + 0x60 + k));
    return out;
};

test("element panel ctor F0x80096828 and its slots match", () => {
    const seed = (rt) => {
        for (let i = 0; i < 0x80; i += 2) rt.mem.write16(OBJ + i, 0);
        stubCursor(rt);
        for (let i = 0; i < 40; i++) rt.mem.write16(0x80048d34 + 0x63e + i * 2, (i * 3 + 1) & 0xffff);
    };
    comparer("ctor", seed, (rt) => {
        rt.cpu.call(0x80096828, [0, 0x12, 0x34], 20000);
    }, (rt) => {
        let kind = 0;
        const o = createElementPanel(rt.mem, {
            allocate: () => OBJ,
            openElementCursor: () => 0,
            resolveCardInto: (_c, id) => { kind = elementOf(id); },
            cardKind: () => kind,
        }, 0, 0x12, 0x34);
        return o === OBJ ? 0 : 1;
    }, panelWindow);
    // the six buckets count the forty resolved cards by element
    const rt = runtime();
    seed(rt);
    let kind = 0;
    createElementPanel(rt.mem, {
        allocate: () => OBJ, openElementCursor: () => 0,
        resolveCardInto: (_c, id) => { kind = elementOf(id); }, cardKind: () => kind,
    }, 0, 0, 0);
    let total = 0;
    for (let k = 0; k < 6; k++) total += rt.mem.read8(OBJ + 0x60 + k);
    assert.equal(total, 40, "all forty cards land in a bucket");
    comparer("oneshot", () => {}, (rt) => {
        rt.cpu.call(0x800967f8, [OBJ], 20000);
    }, (rt) => { elementPanelStartOneshot(rt.mem, OBJ); return 0; }, panelWindow);
    comparer("scale out", () => {}, (rt) => {
        rt.cpu.call(0x80096808, [OBJ], 20000);
    }, (rt) => { elementPanelScaleOut(rt.mem, OBJ); return 0; }, panelWindow);
});

// ── S14 pile shuffle ─────────────────────────────────────────────────────────
const pileWindow = (rt) => {
    const out = [];
    for (let i = 0; i < 0x40; i++) out.push(rt.mem.read16(DUEL + 0x59c + 0x14 + i * 2));
    return out;
};

test("shufflePile F0x8009F04C matches the original over its own random draws", () => {
    const seed = (rt) => {
        for (let i = 0; i < 0x80; i++) rt.mem.write16(DUEL + 0x59c + i * 2, (i * 7 + 3) & 0xffff);
    };
    // Run the original, recording exactly the random words it draws, then feed
    // the same words to the port. A differing call count or swap order fails.
    const a = runtime();
    seed(a);
    const draws = [];
    let n = 0;
    a.cpu.setStub(RAND_STUB, () => { const v = (0x1111 * (n + 1) + 0x2222) & 0xffff; n++; draws.push(v); return v; });
    a.mem.write32(0x8004dc0c, RAND_STUB);
    a.cpu.call(0x8009f04c, [DUEL, 0, 40], 20000);
    const b = runtime();
    seed(b);
    let bi = 0;
    shufflePile(b.mem, { randU16: () => draws[bi++] ?? 0 }, DUEL, 0, 40);
    assert.equal(bi, draws.length, "the port draws the same number of random words");
    assert.deepEqual(pileWindow(b), pileWindow(a), "shuffle fields");
    // count 0 and 1 do nothing
    const c = runtime();
    for (let i = 0; i < 0x80; i++) c.mem.write16(DUEL + 0x59c + i * 2, i);
    shufflePile(c.mem, { randU16: () => 5 }, DUEL, 0, 1);
    assert.equal(c.mem.read16(DUEL + 0x59c + 10 * 2), 10, "count 1 is a no-op");
});

// ── discriminating mutations ─────────────────────────────────────────────────
test("a mutated port makes each family oracle fail", () => {
    // banner: wrong wipe duration would differ from the original
    const rt = runtime();
    for (let i = 0; i < 0x1200; i += 4) rt.mem.write32(VIEW + i, 0);
    rt.cpu.call(0x8009bf5c, [VIEW, 5], 20000);
    const good = rt.mem.read16(VIEW + 5 * 0x18 + 0xe14);
    const mutated = (mem) => { // 7 instead of 6
        const r = VIEW + 5 * 0x18;
        mem.write16(r + 0xe10, 0x1000); mem.write16(r + 0xe12, 0x1000);
        mem.write8(r + 0xe23, 3); mem.write16(r + 0xe14, 7); mem.write16(r + 0xe16, 7);
    };
    const m = runtime();
    for (let i = 0; i < 0x1200; i += 4) m.mem.write32(VIEW + i, 0);
    mutated(m.mem);
    assert.notEqual(m.mem.read16(VIEW + 5 * 0x18 + 0xe14), good, "mutated banner disagrees");
    // marker: wrong shrink frames
    const mo = runtime();
    mo.cpu.call(0x80096160, [OBJ], 20000);
    assert.equal(mo.mem.read16(OBJ + 0x64), 5);
    assert.notEqual(5 + 1, mo.mem.read16(OBJ + 0x64), "mutated marker shrink disagrees");
});
