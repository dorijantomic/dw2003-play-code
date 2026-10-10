// Phase 4 oracle: engine/dw3/ui/duel-create.ts must reproduce pro/cardgame's
// createCardDuel. The original runs through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the factory and the audio-archive device
// boundaries stubbed on both sides; the object, the factory arguments, the
// archive request struct and the ordered device calls are compared.

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
} from "../engine/dw3/audio-archive.ts";
import {
    DUEL_METHOD_SLOTS,
    DUEL_OBJECT_EXTRA,
    DUEL_OBJECT_SIZE,
    DUEL_SCENE_HANDLER,
    DUEL_SELECTOR,
    DUEL_START_ARCHIVE,
    createCardDuel,
} from "../engine/dw3/ui/duel-create.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const CREATE = 0x800a3240;
const ALLOC = 0x80014504;
const ACQUIRE_CELL = 0x80044f44;
const ACQUIRE_STUB = 0x80019120;
const VOICE_STUB = 0x800335b4;
const PROGRAM_STUB = 0x8003058c;
const SLOT_STUB = 0x80037dcc;
const DESCRIPTORS = 0x80172000;
const OBJECT_SPAN = DUEL_OBJECT_SIZE;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/**
 * The device boundaries and the archive table, identical on both sides. The
 * original reaches the acquire through the resident data pointer [0x80044F44];
 * the port receives it as the audio-archive host's `acquire`.
 */
function scenario(rt, events, o = {}) {
    rt.cpu.setStub(VOICE_STUB, (c) => { events.push(["voice", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(PROGRAM_STUB, (c) => { events.push(["program", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(SLOT_STUB, (c) => { events.push(["slot", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(ACQUIRE_STUB, (c) => { events.push(["acquire", c.reg(4) | 0]); return 0; });
    rt.mem.write32(ACQUIRE_CELL, ACQUIRE_STUB);
    // the archive table: id 0x27 -> a descriptor whose +4 is the file id
    const desc = DESCRIPTORS + 0x40;
    rt.mem.write32(desc + 0x4, 0x250d);
    rt.mem.write32(AUDIO_ARCHIVE_TABLE + DUEL_START_ARCHIVE * 4, desc);
    // the two gate channels
    for (const [chan, shape] of Object.entries(o.channels ?? {})) {
        const rec = AUDIO_CHANNEL_BASE + Number(chan) * AUDIO_CHANNEL_STRIDE;
        rt.mem.write32(rec + 0x0, shape.id ?? 0);
        rt.mem.write16(rec + 0x4, shape.slot ?? 0xffff);
        rt.mem.write16(rec + 0x6, shape.count ?? 0);
        for (let j = 0; j < (shape.entries ?? []).length; j++) {
            rt.mem.write16(rec + 0x8 + j * 2, shape.entries[j]);
        }
    }
    rt.mem.write32(AUDIO_TOGGLE, o.toggle ?? 0);
    rt.mem.write32(AUDIO_REQUEST_DESCRIPTOR, o.descriptorWord ?? 0);
    rt.mem.write32(AUDIO_REQUEST_PENDING, 0);
    rt.mem.write16(AUDIO_REQUEST_CHANNEL, 0);
}

function archiveHost(rt, events) {
    return {
        releaseVoice: (e, i) => events.push(["voice", e | 0, i | 0]),
        closeProgram: (e) => events.push(["program", e | 0]),
        releaseVabSlot: (s) => events.push(["slot", s | 0]),
        acquire: (fileId) => events.push(["acquire", fileId | 0]),
    };
}

function objectBytes(rt, obj) {
    const out = [];
    for (let i = 0; i < OBJECT_SPAN; i++) out.push(rt.mem.read8(obj + i));
    return out;
}

function archiveWords(rt) {
    return [
        rt.mem.read32(AUDIO_REQUEST_DESCRIPTOR) >>> 0,
        rt.mem.read32(AUDIO_REQUEST_PENDING) & 0xffff,
        rt.mem.read32(AUDIO_REQUEST_CHANNEL) & 0xffff,
        rt.mem.read32(AUDIO_TOGGLE) >>> 0,
        rt.mem.read32(AUDIO_CHANNEL_BASE) >>> 0,
        rt.mem.read32(AUDIO_CHANNEL_BASE + AUDIO_CHANNEL_STRIDE) >>> 0,
    ];
}

const CASES = [
  { name: "no channel holds the archive", selector: 0 },
  { name: "channel 0 already holds it", selector: 1, channels: { 0: { id: DUEL_START_ARCHIVE } } },
  { name: "channel 1 already holds it", selector: 0x27, channels: { 1: { id: DUEL_START_ARCHIVE } } },
  { name: "toggle set", selector: 0xff, toggle: 1 },
  {
    name: "channel 1 has a used slot with two programs",
    selector: 2,
    channels: { 1: { id: 0x11, slot: 3, count: 2, entries: [0x40, 0x41] } },
  },
];

test("createCardDuel matches F0x800A3240", () => {
    for (const tc of CASES) {
        const evA = [];
        const a = runtime();
        const allocs = [];
        a.cpu.setStub(ALLOC, (c) => {
            allocs.push([c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
            return a.world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0);
        });
        scenario(a, evA, tc);
        const objA = a.cpu.call(CREATE, [tc.selector]) >>> 0;

        const evB = [];
        const b = runtime();
        scenario(b, evB, tc);
        const objB = createCardDuel(b.mem, {
            allocate: (h, s, e) => b.world.alloc(h >>> 0, s, e, 0),
            ...archiveHost(b, evB),
        }, tc.selector);

        assert.equal(objB >>> 0, objA, `${tc.name}: the same object address`);
        assert.deepEqual(objectBytes(b, objB), objectBytes(a, objA), `${tc.name}: object`);
        assert.deepEqual(evB, evA, `${tc.name}: device calls`);
        assert.deepEqual(archiveWords(b), archiveWords(a), `${tc.name}: archive state`);
        assert.equal(allocs[0][0] >>> 0, DUEL_SCENE_HANDLER);
        assert.equal(allocs[0][1] >>> 0, DUEL_OBJECT_SIZE);
        assert.equal(allocs[0][2] >>> 0, DUEL_OBJECT_EXTRA);
    }
});

test("the five method pointers are the shipped addresses", () => {
    const ev = [];
    const rt = runtime();
    scenario(rt, ev, {});
    const obj = rt.world.alloc(DUEL_SCENE_HANDLER, DUEL_OBJECT_SIZE, DUEL_OBJECT_EXTRA, 0) >>> 0;
    // read them out of the overlay the way the creator writes them: each is an
    // absolute word the compiler splits into lui+addiu, so the stored values are
    // the constants below and the oracle above compares the whole object
    const expected = [0x8009f04c, 0x8009eefc, 0x800a0754, 0x800a0708, 0x800a3934];
    for (let i = 0; i < DUEL_METHOD_SLOTS.length; i++) {
        assert.equal(DUEL_METHOD_SLOTS[i][0], 0x810 + i * 4);
        assert.equal(DUEL_METHOD_SLOTS[i][1], expected[i]);
    }
    // the port writes exactly those words into a fresh object
    const b = runtime();
    const objB = createCardDuel(b.mem, {
        allocate: () => obj,
        releaseVoice: () => {}, closeProgram: () => {}, releaseVabSlot: () => {}, acquire: () => {},
    }, 0);
    for (let i = 0; i < expected.length; i++) {
        assert.equal(b.mem.read32(objB + 0x810 + i * 4) >>> 0, expected[i] >>> 0);
    }
    assert.equal(b.mem.read8(objB + DUEL_SELECTOR), 0);
});
