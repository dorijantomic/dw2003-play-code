// Phase 4 oracle: engine/dw3/audio-archive.ts must reproduce F0x8002044C
// (loadAudioArchive) and F0x80020574 (ensureSoundArchiveLoaded). Both originals
// run through engine/native over the same seeded channel records, archive table
// and request struct; the port runs on an identical seed, and the request
// struct, the channel records, the toggle and the ordered device calls are
// compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    AUDIO_ARCHIVE_TABLE,
    AUDIO_CHANNEL_BASE,
    AUDIO_CHANNEL_STRIDE,
    AUDIO_REQUEST_CHANNEL,
    AUDIO_REQUEST_DESCRIPTOR,
    AUDIO_REQUEST_PENDING,
    AUDIO_TOGGLE,
    AUDIO_VOICE_COUNT,
    ensureSoundArchiveLoaded,
    loadAudioArchive,
    releaseVabSlot,
    AUDIO_VAB_STATE,
    AUDIO_VAB_COUNT,
    AUDIO_VAB_TABLE,
    SPU_BLOCK_COUNT,
    SPU_BLOCK_CAPACITY,
    SPU_BLOCK_BASE,
    SPU_UPLOAD_LATCH,
    readUploadLatch,
    setUploadLatch,
    compactBlockRelease,
    compactSpuBlocks,
} from "../engine/dw3/audio-archive.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// One ordering mutation is provably equivalent in-domain and the sweep cannot
// see it: storing the toggle before or after loadAudioArchive is indistinguishable
// because the loader never reads the toggle (its only reader is this gate).
const VOICE_STUB = 0x800190f0;
const PROGRAM_STUB = 0x80019100;
const SLOT_STUB = 0x80019110;
const ACQUIRE_CELL = 0x80044f44;
const ACQUIRE_STUB = 0x80019120;
const DESCRIPTORS = 0x80172000;

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function scenario(channels = {}, toggle = 0, realRelease = false) {
    const rt = runtime();
    const voices = [];
    const programs = [];
    const slots = [];
    const acquires = [];
    rt.cpu.setStub(VOICE_STUB, (c) => { voices.push([c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(PROGRAM_STUB, (c) => { programs.push(c.reg(4) | 0); return 0; });
    rt.cpu.setStub(SLOT_STUB, (c) => { slots.push(c.reg(4) | 0); return 0; });
    rt.cpu.setStub(ACQUIRE_STUB, (c) => { acquires.push(c.reg(4) | 0); return 0; });
    rt.mem.write32(0x800335b4 + 0, 0); // the device functions are not called directly
    rt.cpu.setStub(0x800335b4, (c) => { voices.push([c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8003058c, (c) => { programs.push(c.reg(4) | 0); return 0; });
    if (!realRelease) rt.cpu.setStub(0x80037dcc, (c) => { slots.push(c.reg(4) | 0); return 0; });
    rt.mem.write32(ACQUIRE_CELL, ACQUIRE_STUB);
    // channel records
    for (const [chan, shape] of Object.entries(channels)) {
        const rec = AUDIO_CHANNEL_BASE + Number(chan) * AUDIO_CHANNEL_STRIDE;
        rt.mem.write32(rec + 0x0, shape.id ?? 0);
        rt.mem.write16(rec + 0x4, shape.slot ?? 0xffff);
        rt.mem.write16(rec + 0x6, shape.count ?? 0);
        for (let j = 0; j < (shape.entries ?? []).length; j++) {
            rt.mem.write16(rec + 0x8 + j * 2, shape.entries[j]);
        }
    }
    rt.mem.write32(AUDIO_TOGGLE, toggle);
    // archive table: id -> descriptor, descriptor+4 = the file id
    for (const [id, fileId] of Object.entries({ 1: 0x101, 2: 0x202, 3: 0x303 })) {
        const desc = DESCRIPTORS + Number(id) * 0x20;
        rt.mem.write32(desc + 0x4, fileId);
        rt.mem.write32(AUDIO_ARCHIVE_TABLE + Number(id) * 4, desc);
    }
    return { rt, voices, programs, slots, acquires, host: {
        releaseVoice: (entry_, index) => voices.push([entry_, index]),
        closeProgram: (entry_) => programs.push(entry_),
        releaseVabSlot: (slot) => slots.push(slot),
        acquire: (fileId) => acquires.push(fileId),
    } };
}

function requestWords(rt) {
    return [
        rt.mem.read32(AUDIO_REQUEST_DESCRIPTOR) >>> 0,
        rt.mem.read32(AUDIO_REQUEST_PENDING) & 0xffff,
        rt.mem.read32(AUDIO_REQUEST_CHANNEL) & 0xffff,
    ];
}

function channelWords(rt, chan) {
    const rec = AUDIO_CHANNEL_BASE + chan * AUDIO_CHANNEL_STRIDE;
    return [
        rt.mem.read32(rec + 0x0) >>> 0,
        rt.mem.read32(rec + 0x4) >>> 0,
        rt.mem.read32(rec + 0x8) >>> 0,
        rt.mem.read32(rec + 0xc) >>> 0,
    ];
}

function compare(name, a, b) {
    assert.deepEqual(requestWords(b.rt), requestWords(a.rt), `${name} request`);
    for (const chan of [1, 2]) {
        assert.deepEqual(channelWords(b.rt, chan), channelWords(a.rt, chan), `${name} channel ${chan}`);
    }
    assert.equal(b.rt.mem.read32(AUDIO_TOGGLE) >>> 0, a.rt.mem.read32(AUDIO_TOGGLE) >>> 0, `${name} toggle`);
    assert.deepEqual(b.voices, a.voices, `${name} voice calls`);
    assert.deepEqual(b.programs, a.programs, `${name} program calls`);
    assert.deepEqual(b.slots, a.slots, `${name} slot calls`);
    assert.deepEqual(b.acquires, a.acquires, `${name} acquire calls`);
}

test("loadAudioArchive matches F0x8002044C", () => {
    const cases = [
        { name: "no current program", channel: 1, id: 2, seed: { 1: { slot: -1, count: 0 } } },
        { name: "two entries to release", channel: 2, id: 3,
          seed: { 2: { slot: 7, count: 2, entries: [3, 4] } } },
        { name: "slot but zero entries", channel: 2, id: 1,
          seed: { 2: { slot: 7, count: 0 } } },
        { name: "negative id store", channel: 1, id: -5,
          seed: { 1: { slot: -1, count: 0 } } },
    ];
    for (const tc of cases) {
        const a = scenario(tc.seed);
        a.rt.cpu.call(0x8002044c, [tc.channel, tc.id]);
        const b = scenario(tc.seed);
        loadAudioArchive(b.rt.mem, b.host, tc.channel, tc.id);
        compare(tc.name, a, b);
        assert.equal(a.acquires.length, 1, `${tc.name} one acquire`);
        if (tc.name === "two entries to release") {
            assert.equal(a.voices.length, 2 * AUDIO_VOICE_COUNT, "16 voices per entry");
            assert.deepEqual(a.programs, [3, 4], "each program closed once");
            assert.deepEqual(a.slots, [7], "the VAB slot released once");
        }
        if (tc.name === "slot but zero entries") {
            assert.equal(a.voices.length, 0, "no voices touched");
            assert.deepEqual(a.slots, [7], "the slot still released");
        }
    }
});

test("ensureSoundArchiveLoaded matches F0x80020574", () => {
    const cases = [
        ["channel one holds it", { 1: { id: 2, slot: -1 } }, 0, 2],
        ["channel two holds it", { 2: { id: 3, slot: -1 } }, 0, 3],
        ["toggle one requests channel two", {}, 1, 2],
        ["other toggle requests channel one", {}, 0, 2],
        ["toggle two is not one", {}, 2, 3],
    ];
    for (const [name, channels, toggle, id] of cases) {
        const a = scenario(channels, toggle);
        a.rt.cpu.call(0x80020574, [id]);
        const b = scenario(channels, toggle);
        ensureSoundArchiveLoaded(b.rt.mem, b.host, id);
        compare(name, a, b);
        const held = (mem, chan) => mem.read32(AUDIO_CHANNEL_BASE + chan * AUDIO_CHANNEL_STRIDE) >>> 0;
        if (name.startsWith("channel")) {
            assert.equal(a.acquires.length, 0, `${name} no request`);
        } else {
            const expectChan = name.startsWith("toggle one") ? 2 : 1;
            assert.equal(held(a.rt.mem, expectChan), id >>> 0, `${name} requested on channel ${expectChan}`);
            assert.equal(a.acquires.length, 1, `${name} one acquire`);
            assert.equal(a.rt.mem.read32(AUDIO_TOGGLE) >>> 0, expectChan, `${name} toggle flipped`);
        }
    }
});

// The release helper's three callees are recorded device boundaries on BOTH
// sides (researcher B turn350-next-resident-row Unit 2/3): the compactor
// F0x8003913c and the latch setter F0x8003a98c take the original's argument,
// the latch reader F0x8003a9b4 returns the scripted value. No recursive
// cpu.call in either path.
const COMPACT_STUB = 0x8003913c;
const LATCH_GET_STUB = 0x8003a9b4;
const LATCH_SET_STUB = 0x8003a98c;

function releaseScenario(state = {}, count = 0, latch = 0, blocks = {}, rt = runtime()) {
    const compacts = [];
    const latchSets = [];
    const calls = [];
    const host = {
        compactBlock(block) {
            compacts.push(block | 0);
            calls.push(["release", block | 0, releaseWords(rt)]);
        },
        readUploadLatch() {
            calls.push(["getLatch", releaseWords(rt)]);
            return latch | 0;
        },
        setUploadLatch(value) {
            latchSets.push(value | 0);
            calls.push(["setLatch", value | 0, releaseWords(rt)]);
        },
    };
    rt.cpu.setStub(COMPACT_STUB, (c) => { host.compactBlock(c.reg(4)); return 0; });
    rt.cpu.setStub(LATCH_GET_STUB, () => host.readUploadLatch());
    rt.cpu.setStub(LATCH_SET_STUB, (c) => { host.setUploadLatch(c.reg(4)); return 0; });
    // Sentinels pin byte/halfword write widths, including adjacent slots/table.
    for (let p = AUDIO_VAB_STATE - 4; p < AUDIO_VAB_TABLE + 16 * 4 + 4; p++) rt.mem.write8(p, 0xa5);
    rt.mem.write16(AUDIO_VAB_COUNT, count);
    for (let s = 0; s < 16; s++) {
        rt.mem.write32(AUDIO_VAB_TABLE + s * 4, blocks[s] ?? (0x90000000 + s));
        rt.mem.write8(AUDIO_VAB_STATE + s, state[s] ?? 0);
    }
    return { rt, compacts, latchSets, calls, host };
}

function releaseBytes(rt) {
    return Array.from({ length: AUDIO_VAB_TABLE + 16 * 4 + 4 - (AUDIO_VAB_STATE - 4) },
        (_, i) => rt.mem.read8(AUDIO_VAB_STATE - 4 + i));
}

function releaseWords(rt) {
    return [rt.mem.read16(AUDIO_VAB_COUNT) & 0xffff,
        ...Array.from({ length: 16 }, (_, s) => rt.mem.read8(AUDIO_VAB_STATE + s))];
}

test("releaseVabSlot matches F0x80037dcc", () => {
    const full = Object.fromEntries([1, 2, 7, 15].map((s) => [s, s <= 2 ? s : 1]));
    const cases = [
        // [name, seed state bytes, count, latch return, slots to release]
        ["slot 0 rejects state zero", { 0: 0 }, 4, 0, [0]],
        ["slot 1 state 1 releases", { 1: 1 }, 4, 0, [1]],
        ["slot 2 state 2 releases", { 2: 2 }, 4, 0, [2]],
        ["state 255 rejected", { 3: 255 }, 4, 0, [3]],
        ["state 3 rejected", { 4: 3 }, 4, 0, [4]],
        ["slot 15 accepted", { 15: 1 }, 4, 0, [15]],
        ["slot 16 rejected", full, 4, 0, [16]],
        ["slot 0xffff rejected", full, 4, 0, [0xffff]],
        ["slot 0x80010002 upper-bit alias accepted", { 2: 2 }, 4, 0, [0x80010002]],
        ["latch 1 cleared to 0", { 5: 1 }, 4, 1, [5]],
        ["latch 2 not cleared", { 5: 1 }, 4, 2, [5]],
        ["latch 0 not set", { 5: 1 }, 4, 0, [5]],
        ["counter zero wraps to ffff", { 6: 2 }, 0, 0, [6]],
        ["repeated release is a no-op", { 7: 1 }, 4, 0, [7, 7]],
    ];
    for (const [name, state, count, latch, slots] of cases) {
        const a = releaseScenario(state, count, latch, { 1: 0x1234, 2: 0x5678, 5: 0x9abc, 6: 0xdef0, 7: 0x1357, 15: 0x2468 });
        const b = releaseScenario(state, count, latch, { 1: 0x1234, 2: 0x5678, 5: 0x9abc, 6: 0xdef0, 7: 0x1357, 15: 0x2468 });
        for (const slot of slots) a.rt.cpu.call(0x80037dcc, [slot]);
        for (const slot of slots) releaseVabSlot(b.rt.mem, b.host, slot);
        assert.deepEqual(releaseWords(b.rt), releaseWords(a.rt), `${name} state/count`);
        assert.deepEqual(releaseBytes(b.rt), releaseBytes(a.rt), `${name} adjacent bytes and pointer table`);
        assert.deepEqual(b.calls, a.calls, `${name} ordered calls and intermediate state`);
        assert.deepEqual(b.compacts, a.compacts, `${name} compactor calls`);
        assert.deepEqual(b.latchSets, a.latchSets, `${name} latch writes`);
        // Independent assertions: once released, a slot's cleared byte rejects
        // subsequent requests. This is not a mutation-test claim.
        const released = [...new Set(slots.map((s) => s & 0xffff))].filter((s) => s < 0x10 && (state[s] ?? 0) >= 1 && (state[s] ?? 0) < 3);
        if (released.length === 0) {
            assert.equal(a.compacts.length, 0, `${name} no compactor call`);
        } else {
            const s = released[0] & 0xffff;
            assert.deepEqual(a.compacts, released.map(() => ({ 1: 0x1234, 2: 0x5678, 5: 0x9abc, 6: 0xdef0, 7: 0x1357, 15: 0x2468 }[s])), `${name} block pointer`);
            assert.equal(a.rt.mem.read8(AUDIO_VAB_STATE + s), 0, `${name} state cleared`);
            assert.equal(a.rt.mem.read16(AUDIO_VAB_COUNT) & 0xffff, (count - released.length) & 0xffff, `${name} count decremented`);
            if (latch === 1) assert.deepEqual(a.latchSets, [0], `${name} latch cleared once`);
            else assert.deepEqual(a.latchSets, [], `${name} latch untouched`);
        }
    }
});

test("loadAudioArchive's release step composes with the real F0x80037dcc", () => {
    // The loader path with a slot and zero entries must produce the same slot
    // state, count, compactor call and latch writes as the original pair.
    const seed = { 2: { slot: 9, count: 0 } };
    const blocks = { 9: 0xbeef };
    const state = { 9: 1 };
    const a = scenario(seed, 0, true);
    const aRel = releaseScenario(state, 4, 1, blocks, a.rt);
    a.rt.cpu.call(0x8002044c, [2, 2]);
    const b = scenario(seed, 0, true);
    const bRel = releaseScenario(state, 4, 1, blocks, b.rt);
    loadAudioArchive(b.rt.mem, {
        ...b.host,
        releaseVabSlot: (slot) => releaseVabSlot(b.rt.mem, bRel.host, slot),
    }, 2, 2);
    compare("composition", a, b);
    assert.deepEqual(releaseBytes(b.rt), releaseBytes(a.rt), "composition state and sentinels");
    assert.deepEqual(bRel.calls, aRel.calls, "composition ordered calls and intermediate state");
    assert.deepEqual(bRel.compacts, aRel.compacts, "composition compactor");
    assert.deepEqual(bRel.latchSets, aRel.latchSets, "composition latch");
    // the release actually ran: the slot's byte cleared through the real callee
    assert.equal(aRel.rt.mem.read8(AUDIO_VAB_STATE + 9), 0, "original cleared slot 9");
    assert.equal(aRel.rt.mem.read16(AUDIO_VAB_COUNT) & 0xffff, 3, "original decremented count");
});
// ---------------------------------------------------------------------------
// Turn 356+ oracle: upload latch pair and SPU block compactor
// ---------------------------------------------------------------------------

function latchScenario(latchValue) {
    const rt = runtime();
    rt.mem.write32(SPU_UPLOAD_LATCH, latchValue);
    return rt;
}

test("readUploadLatch matches F0x8003a9b4", () => {
    const values = [0, 1, 2, 0x7fffffff, 0x80000000, 0xffffffff];
    for (const v of values) {
        const a = latchScenario(v);
        const origResult = a.cpu.call(0x8003a9b4, []) | 0;
        const tsResult = readUploadLatch(a.mem);
        assert.equal(tsResult, origResult, "readUploadLatch(0x" + (v >>> 0).toString(16) + ") = " + origResult);
    }
});

test("setUploadLatch matches F0x8003a98c", () => {
    const values = [0, 1, 2, -1, 0x100];
    for (const v of values) {
        const a = latchScenario(0);
        a.cpu.call(0x8003a98c, [v]);
        const origAfter = a.mem.read32(SPU_UPLOAD_LATCH) | 0;

        const b = latchScenario(0);
        setUploadLatch(b.mem, v);
        const tsAfter = b.mem.read32(SPU_UPLOAD_LATCH) | 0;

        assert.equal(tsAfter, origAfter, "setUploadLatch(0x" + (v >>> 0).toString(16) + "): orig=" + origAfter + " ts=" + tsAfter);
    }
});

// SPU block-map helper: write an array of [flags, size] entries at a
// separate address and store the pointer in D0x8005c2e8.  The MIPS code
// reads the pointer via `lw $t0, %lo(D0x8005c2e8)($t0)`, so the entries
// must live at a different address than D0x8005c2e8 itself.
const BLOCK_ARRAY_BASE = 0x8005c400;  // well past the SPU globals

function seedBlockMap(rt, entries) {
    rt.mem.write32(SPU_BLOCK_COUNT, entries.length);
    rt.mem.write32(SPU_BLOCK_CAPACITY, entries.length);
    rt.mem.write32(SPU_BLOCK_BASE, BLOCK_ARRAY_BASE);
    for (let i = 0; i < entries.length; i++) {
        rt.mem.write32(BLOCK_ARRAY_BASE + i * 8, entries[i][0]);
        rt.mem.write32(BLOCK_ARRAY_BASE + i * 8 + 4, entries[i][1]);
    }
}

function readBlockMap(rt) {
    const count = rt.mem.read32(SPU_BLOCK_COUNT) | 0;
    const capacity = rt.mem.read32(SPU_BLOCK_CAPACITY) | 0;
    const base = rt.mem.read32(SPU_BLOCK_BASE) | 0;
    const result = [];
    for (let i = 0; i <= capacity; i++) {
        result.push([
            rt.mem.read32(base + i * 8) | 0,
            rt.mem.read32(base + i * 8 + 4) | 0,
        ]);
    }
    return { count, capacity, entries: result };
}

test("compactSpuBlocks matches F0x800391bc", () => {
    // Case 1: empty map (capacity -1 -> no work)
    {
        const a = runtime();
        a.mem.write32(SPU_BLOCK_COUNT, 0);
        a.mem.write32(SPU_BLOCK_CAPACITY, -1);
        a.cpu.call(0x800391bc, []);
        const aState = readBlockMap(a);

        const b = runtime();
        b.mem.write32(SPU_BLOCK_COUNT, 0);
        b.mem.write32(SPU_BLOCK_CAPACITY, -1);
        compactSpuBlocks(b.mem);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "empty map");
    }

    // Case 2: two freed adjacent blocks should merge
    {
        const entries = [
            [0x80001000, 0x100],  // freed, addr 0x1000, size 0x100
            [0x80001100, 0x200],  // freed, addr 0x1100, size 0x200 (adjacent)
        ];
        const a = runtime();
        seedBlockMap(a, entries);
        a.cpu.call(0x800391bc, []);
        const aState = readBlockMap(a);

        const b = runtime();
        seedBlockMap(b, entries);
        compactSpuBlocks(b.mem);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "two adjacent freed blocks merge");
    }

    // Case 3: three entries with one zero-size -> removed
    {
        const entries = [
            [0x00001000, 0x100],
            [0x00000000, 0],      // zero-size
            [0x00002000, 0x200],
        ];
        const a = runtime();
        seedBlockMap(a, entries);
        a.cpu.call(0x800391bc, []);
        const aState = readBlockMap(a);

        const b = runtime();
        seedBlockMap(b, entries);
        compactSpuBlocks(b.mem);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "zero-size entry removed");
    }

    // Case 4: mixed locked, freed, active entries -> sort and compact
    {
        const entries = [
            [0xC0003000, 0x300],  // locked (0x40000000 | 0x80000000 | 0x3000)
            [0x80001000, 0x100],  // freed at 0x1000
            [0x00005000, 0x400],  // active at 0x5000
            [0x80002000, 0x100],  // freed at 0x2000
        ];
        const a = runtime();
        seedBlockMap(a, entries);
        a.cpu.call(0x800391bc, []);
        const aState = readBlockMap(a);

        const b = runtime();
        seedBlockMap(b, entries);
        compactSpuBlocks(b.mem);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "mixed entries");
    }
});

test("compactBlockRelease matches F0x8003913c", () => {
    // Case 1: release a block that exists
    {
        const entries = [
            [0x00001000, 0x100],
            [0x00002000, 0x200],
        ];
        const a = runtime();
        seedBlockMap(a, entries);
        a.cpu.call(0x8003913c, [0x1000]);
        const aState = readBlockMap(a);

        const b = runtime();
        seedBlockMap(b, entries);
        compactBlockRelease(b.mem, 0x1000);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "release existing block");
    }

    // Case 2: release a block that doesn't exist -> no change
    {
        const entries = [
            [0x00001000, 0x100],
            [0x00002000, 0x200],
        ];
        const a = runtime();
        seedBlockMap(a, entries);
        a.cpu.call(0x8003913c, [0x3000]);
        const aState = readBlockMap(a);

        const b = runtime();
        seedBlockMap(b, entries);
        compactBlockRelease(b.mem, 0x3000);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "release non-existent block");
    }

    // Case 3: release with a locked entry before the target
    {
        const entries = [
            [0xC0005000, 0x500],  // locked
            [0x00001000, 0x100],  // active target
        ];
        const a = runtime();
        seedBlockMap(a, entries);
        a.cpu.call(0x8003913c, [0x1000]);
        const aState = readBlockMap(a);

        const b = runtime();
        seedBlockMap(b, entries);
        compactBlockRelease(b.mem, 0x1000);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "locked entry before target");
    }

    // Case 4: release with empty map (count 0)
    {
        const a = runtime();
        a.mem.write32(SPU_BLOCK_COUNT, 0);
        a.mem.write32(SPU_BLOCK_CAPACITY, 0);
        a.mem.write32(SPU_BLOCK_BASE, BLOCK_ARRAY_BASE);
        a.cpu.call(0x8003913c, [0x1000]);
        const aState = readBlockMap(a);

        const b = runtime();
        b.mem.write32(SPU_BLOCK_COUNT, 0);
        b.mem.write32(SPU_BLOCK_CAPACITY, 0);
        b.mem.write32(SPU_BLOCK_BASE, BLOCK_ARRAY_BASE);
        compactBlockRelease(b.mem, 0x1000);
        const bState = readBlockMap(b);

        assert.deepEqual(bState, aState, "empty map release");
    }
});

