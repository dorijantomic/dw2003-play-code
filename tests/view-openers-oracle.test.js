// Phase 4 oracle: engine/dw3/ui/view-openers.ts must reproduce pro/cardgame's
// three board-view slot writers. Each original runs through engine/native on the
// shipped pro_cardgame.bin + resident.bin with the packed-sound cell stubbed to a
// recording stub, and the whole view region the routine can reach is compared,
// together with the sound the routine fired.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { openBannerSlot, openPromptSlot, resetViewPanels, closePromptSlot, confirmPromptSlot } from "../engine/dw3/ui/view-openers.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OPEN_BANNER = 0x8009beac;
const OPEN_PROMPT = 0x8009c054;
const CLOSE_PROMPT = 0x8009c0dc;
const CONFIRM_PROMPT = 0x8009c124;
const RESET_PANELS = 0x8009c264;
const VIEW = 0x80190000;
/** Covers the highest record an out-of-range index can reach (0xE0C + 0x18*0xFF). */
const VIEW_SPAN = 0x3000;
const SOUND_CELL = 0x80055c48;
const SOUND_STUB = 0x0fe50200;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** A recognisable view the routine's writes have to land inside. */
function seed(rt, events) {
    for (let i = 0; i < VIEW_SPAN; i++) rt.mem.write8(VIEW + i, 0x5a);
    rt.mem.write32(SOUND_CELL, SOUND_STUB);
    rt.cpu.setStub(SOUND_STUB, (c) => {
        events.push(["sound", c.reg(4) >>> 0]);
        return 0;
    });
}

function viewBytes(rt) {
    const out = [];
    for (let i = 0; i < VIEW_SPAN; i++) out.push(rt.mem.read8(VIEW + i));
    return out;
}

function portHost(events) {
    return {
        playPackedSound(id) {
            events.push(["sound", id >>> 0]);
        },
    };
}

/** The caller's fifth and sixth arguments go on the stack, the rest in a0..a3. */
function runBanner(rt, args) {
    rt.mem.write32(rt.cpu.sp + 0x10, args[3] & 0xffff);
    rt.mem.write32(rt.cpu.sp + 0x14, args[4] & 0xffff);
    rt.cpu.call(OPEN_BANNER, [VIEW, args[0], args[1], args[2]]);
}

test("openBannerSlot matches F0x8009BEAC", () => {
    const CASES = [
        [0, 0x1234, 0xdeadbeef, 0x11, 0x22],
        [1, 0x0000, 0, 0, 0],
        [5, -1, -1, 0x8000, 0xffff],
        [2, 0x0260, 0x00010002, 0x00f1, 0x00bd],
        [6, 7, 8, 9, 10],          // past the six records
        [0xff, 1, 2, 3, 4],        // far past them
    ];
    for (const args of CASES) {
        const evA = [];
        const a = runtime();
        seed(a, evA);
        runBanner(a, args);

        const evB = [];
        const b = runtime();
        seed(b, evB);
        openBannerSlot(b.mem, portHost(evB), VIEW, args[0], args[1], args[2], args[3], args[4]);

        assert.deepEqual(viewBytes(b), viewBytes(a), JSON.stringify(args));
        assert.deepEqual(evB, evA, `${JSON.stringify(args)} sound`);
        assert.deepEqual(evA, [["sound", 0x40019]], "the opener's sound id");
    }
});

test("openPromptSlot matches F0x8009C054", () => {
    const CASES = [
        [0x8000abcd, 0x11, 0x1234, 0xdeadbeef],
        [0, 0, 0, 0],
        [0xffffffff, -1, -1, -1],
        [0x00010000, 0x00ff, 0x8000, 2],
    ];
    for (const args of CASES) {
        const evA = [];
        const a = runtime();
        seed(a, evA);
        a.mem.write32(a.cpu.sp + 0x10, args[3]);
        a.cpu.call(OPEN_PROMPT, [VIEW, args[0], args[1], args[2]]);

        const evB = [];
        const b = runtime();
        seed(b, evB);
        openPromptSlot(b.mem, portHost(evB), VIEW, args[0], args[1], args[2], args[3]);

        assert.deepEqual(viewBytes(b), viewBytes(a), JSON.stringify(args));
        assert.deepEqual(evB, evA, `${JSON.stringify(args)} sound`);
        assert.deepEqual(evA, [["sound", 0x40019]], "the opener's sound id");
    }
});

test("resetViewPanels matches F0x8009C264", () => {
    const evA = [];
    const a = runtime();
    seed(a, evA);
    a.cpu.call(RESET_PANELS, [VIEW]);

    const evB = [];
    const b = runtime();
    seed(b, evB);
    resetViewPanels(b.mem, VIEW);

    assert.deepEqual(viewBytes(b), viewBytes(a));
    assert.deepEqual(evA, [], "the reset plays no sound");
    // the hidden panel Y values the atlas' panel table names
    assert.equal(b.mem.read16(VIEW + 0x6e), 0xf1, "side 0 panel Y");
    assert.equal(b.mem.read16(VIEW + 0xc2), 0xff9c, "side 1 panel Y (-0x64)");
    assert.equal(b.mem.read16(VIEW + 0x80), 0x147, "side 0 endpoint");
    assert.equal(b.mem.read16(VIEW + 0xd4), 0x147, "side 1 endpoint");
});

// close_prompt (F0x8009C0DC, view+0xEE8) and confirm_prompt (F0x8009C124,
// view+0xEEC): the two prompt teardown bodies the phase banner and the effect
// step reach. Both are constructor-installed, so the m2c blob drops them; each
// is read from exe-decomp/cardgame.norm.s .L0x0001942c / .L0x00019474.
for (const [name, addr, port, sound] of [
    ["closePromptSlot matches F0x8009C0DC", CLOSE_PROMPT, closePromptSlot, 0x4001a],
    ["confirmPromptSlot matches F0x8009C124", CONFIRM_PROMPT, confirmPromptSlot, 0x8004503c],
]) {
    test(name, () => {
        const evA = [];
        const a = runtime();
        seed(a, evA);
        a.cpu.call(addr, [VIEW]);

        const evB = [];
        const b = runtime();
        seed(b, evB);
        port(b.mem, portHost(evB), VIEW);

        assert.deepEqual(viewBytes(b), viewBytes(a));
        assert.deepEqual(evB, evA, "sound");
        assert.deepEqual(evA, [["sound", sound]], "the teardown's sound id");
    });
}

test("close_prompt and confirm_prompt write different state, and a swapped mutant fails", () => {
    const seedOne = () => {
        const rt = runtime();
        seed(rt, []);
        return rt;
    };
    const close = seedOne();
    close.cpu.call(CLOSE_PROMPT, [VIEW]);
    const confirm = seedOne();
    confirm.cpu.call(CONFIRM_PROMPT, [VIEW]);
    assert.equal(close.mem.read16(VIEW + 0xdf0), 6, "close arms 6");
    assert.equal(close.mem.read8(VIEW + 0xdfa), 5, "close dismisses");
    assert.equal(confirm.mem.read16(VIEW + 0xdf0), 0xa, "confirm arms 10");
    assert.equal(confirm.mem.read8(VIEW + 0xdfa), 4, "confirm slides out");
    // a mutant confirm that copied close's fields must diverge
    const mutant = seedOne();
    closePromptSlot(mutant.mem, portHost([]), VIEW);
    assert.notDeepEqual(viewBytes(mutant), viewBytes(confirm), "the mutant must diverge");
});
