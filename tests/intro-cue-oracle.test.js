// Phase 4 oracle: engine/dw3/ui/intro-cue.ts must reproduce pro/cardgame's intro
// cue sequencer. Both originals run through engine/native on the shipped
// pro_cardgame.bin + resident.bin with the cache acquire/poll and the object's
// set-state slot stubbed on both sides; the object fields, the cue the acquire
// receives and the ordered calls are compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    INTRO_CUE_CREATE,
    INTRO_CUE_FIELDS,
    INTRO_CUE_TICK,
    createIntroVoice,
    introVoiceCueTick,
} from "../engine/dw3/ui/intro-cue.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80194000;
const SET_STATE = 0x80014274;
const ACQUIRE = 0x80013c30;
const POLL = 0x80013a6c;
const THUNK_ALLOC = 0x80014504;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

/** The two cache edges; `pollBusy` says whether the poll reports loading. */
function stubOriginal(rt, events, polls) {
    rt.cpu.setStub(ACQUIRE, (c) => { events.push(["acquire", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(POLL, (c) => {
        events.push(["poll", c.reg(4) | 0]);
        const v = polls.shift();
        return v === undefined ? 0 : v;
    });
}

function portHost(rt, events, polls) {
    return {
        allocate: (h, s, e) => { events.push(["allocate", h >>> 0, s >>> 0, e >>> 0]); return rt.world.alloc(h >>> 0, s, e, 0); },
        acquire: (cue) => { events.push(["acquire", cue | 0]); },
        poll: (cue) => {
            events.push(["poll", cue | 0]);
            const v = polls.shift();
            return v === undefined ? 0 : v;
        },
        setState: (obj, state) => {
            rt.mem.write32(obj + 0xc, state | 0);
            rt.mem.write32(obj + 0x10, 0);
            rt.mem.write32(obj + 0x14, 0);
            rt.mem.write32(obj + 0x18, 0);
        },
    };
}

function seed(rt, o = {}) {
    const obj = rt.world.alloc(0x8009d540, 0x58, 0, 0);
    for (let i = 0; i < 0x58; i++) rt.mem.write8(obj + i, 0);
    rt.mem.write32(obj + INTRO_CUE_FIELDS.setState, SET_STATE);
    rt.mem.write32(obj + INTRO_CUE_FIELDS.state, o.state ?? 0);
    rt.mem.write32(obj + INTRO_CUE_FIELDS.latch, o.latch ?? 0);
    rt.mem.write32(obj + INTRO_CUE_FIELDS.skipped, o.skipped ?? 0);
    rt.mem.write16(obj + INTRO_CUE_FIELDS.cursor, o.cursor ?? 0);
    rt.mem.write16(obj + INTRO_CUE_FIELDS.cue, o.cue ?? 0);
    if (o.language !== undefined) rt.mem.write16(0x8005cca8, o.language);
    return obj;
}

function fields(rt, obj) {
    return {
        state: rt.mem.read32(obj + INTRO_CUE_FIELDS.state) | 0,
        latch: rt.mem.read32(obj + INTRO_CUE_FIELDS.latch) | 0,
        skipped: rt.mem.read32(obj + INTRO_CUE_FIELDS.skipped) | 0,
        cursor: rt.mem.read16(obj + INTRO_CUE_FIELDS.cursor) & 0xffff,
        cue: rt.mem.read16(obj + INTRO_CUE_FIELDS.cue) & 0xffff,
    };
}

test("createIntroVoice matches F0x8009D6B4", () => {
    const evA = [];
    const a = runtime();
    a.cpu.setStub(THUNK_ALLOC, (c) => {
        evA.push(["allocate", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0]);
        return a.world.alloc(c.reg(4) >>> 0, c.reg(5), c.reg(6), 0);
    });
    const objA = a.cpu.call(INTRO_CUE_CREATE, []) >>> 0;

    const evB = [];
    const b = runtime();
    const objB = createIntroVoice(b.mem, portHost(b, evB, []));

    assert.equal(objB >>> 0, objA);
    assert.deepEqual(evB, evA);
    assert.deepEqual(evA, [["allocate", 0x8009d540, 0x58, 0]]);
});

test("introVoiceCueTick matches F0x8009D540 across its states", () => {
    // states other than 1: 0, negative and >= 4 reset; 2 and 3 do nothing
    for (const state of [0, -1, 2, 3, 4, 0x7fffffff]) {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, []);
        const objA = seed(a, { state, cursor: 5, skipped: 9, latch: 7 });
        a.cpu.call(INTRO_CUE_TICK, [objA]);

        const evB = [];
        const b = runtime();
        const objB = seed(b, { state, cursor: 5, skipped: 9, latch: 7 });
        introVoiceCueTick(b.mem, portHost(b, evB, []), objB);

        assert.deepEqual(fields(b, objB), fields(a, objA), `state ${state}`);
        assert.deepEqual(evB, evA, `state ${state} calls`);
        if (state === 2 || state === 3) {
            assert.equal(a.mem.read16(objA + INTRO_CUE_FIELDS.cursor) & 0xffff, 5, "nothing changed");
        } else {
            assert.equal(a.mem.read16(objA + INTRO_CUE_FIELDS.cursor) & 0xffff, 0, "the cursor reset");
            assert.equal(a.mem.read32(objA + INTRO_CUE_FIELDS.skipped) | 0, 0);
        }
    }
});

test("introVoiceCueTick walks the cue table like the original", () => {
    // one full walk: poll always reports the transfer finished
    for (const language of [0, 2, 5]) {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, []);
        const objA = seed(a, { state: 1, language });
        for (let i = 0; i < 20; i++) a.cpu.call(INTRO_CUE_TICK, [objA]);

        const evB = [];
        const b = runtime();
        const objB = seed(b, { state: 1, language });
        for (let i = 0; i < 20; i++) introVoiceCueTick(b.mem, portHost(b, evB, []), objB);

        assert.deepEqual(fields(b, objB), fields(a, objA), `language ${language}`);
        assert.deepEqual(evB, evA, `language ${language} calls`);
        // the walk ends on the table's -1 record with the object at state 3
        assert.equal(a.mem.read32(objA + INTRO_CUE_FIELDS.state) | 0, 3, "the walk ends at state 3");
        assert.equal(a.mem.read32(objA + INTRO_CUE_FIELDS.skipped) | 0, 1, "the -2 record was skipped");
        // the cues the acquire saw: the seven content records plus the biased
        // ones, in table order
        const cues = evA.filter((e) => e[0] === "acquire").map((e) => e[1]);
        // the first record's bias flag is set, so the language index is added
        assert.equal(cues[0], 43 + language, "the first cue");
        assert.ok(cues.length >= 8, `only ${cues.length} cues`);
    }
    // a busy poll stops the walk where it is
    {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, [1, 1, 0]);
        const objA = seed(a, { state: 1 });
        for (let i = 0; i < 4; i++) a.cpu.call(INTRO_CUE_TICK, [objA]);
        const evB = [];
        const b = runtime();
        const objB = seed(b, { state: 1 });
        const polls = [1, 1, 0];
        for (let i = 0; i < 4; i++) introVoiceCueTick(b.mem, portHost(b, evB, polls), objB);
        assert.deepEqual(fields(b, objB), fields(a, objA));
        assert.deepEqual(evB, evA);
    }
    // a latch that is neither 0 nor the state re-issues and is incremented
    {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, [1]);
        const objA = seed(a, { state: 1, latch: 7, cursor: 3 });
        a.cpu.call(INTRO_CUE_TICK, [objA]);
        const evB = [];
        const b = runtime();
        const objB = seed(b, { state: 1, latch: 7, cursor: 3 });
        introVoiceCueTick(b.mem, portHost(b, evB, [1]), objB);
        assert.deepEqual(evB.map((e) => e[0]), ["acquire", "poll"], "a stale latch re-issues");
        assert.equal(a.mem.read32(objA + INTRO_CUE_FIELDS.latch) | 0, 8, "the latch increments");
        assert.deepEqual(fields(b, objB), fields(a, objA));
    }
    // the latch: a latch equal to the state skips the acquire and only polls
    {
        const evA = [];
        const a = runtime();
        stubOriginal(a, evA, [1]);
        const objA = seed(a, { state: 1, latch: 1, cursor: 3 });
        a.cpu.call(INTRO_CUE_TICK, [objA]);
        const evB = [];
        const b = runtime();
        const objB = seed(b, { state: 1, latch: 1, cursor: 3 });
        introVoiceCueTick(b.mem, portHost(b, evB, [1]), objB);
        assert.deepEqual(evB, evA);
        assert.deepEqual(evB.map((e) => e[0]), ["poll"], "no acquire while the latch matches the state");
        assert.deepEqual(fields(b, objB), fields(a, objA));
    }
});
