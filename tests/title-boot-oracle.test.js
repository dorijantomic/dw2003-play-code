// Phase 4 oracle: engine/dw3/ui/title-boot.ts must match pro/stdwtitl
// F0x8008497C (create), F0x800848EC (tick), F0x80084868 (spawn) and
// F0x80086DF8 (logo loader). The original runs through engine/native with the
// standard-context slots, the pack resolver, the sound archive and the sequence
// ctor stubbed; the port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    titleBootCreate, titleBootTick, titleBootSpawnSequence, loadTitleLogoPack,
} from "../engine/dw3/ui/title-boot.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stdwtitl.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ROOT = 0x80180000;
const ARG1 = 0x80181000;
const SEQ = 0x80182000;
const PACK_STUB = 0x0fec0000;
const SOUND_STUB = 0x0fec0040;
const AUDIO_STUB = 0x0fec0050;
const PACK_PTR = 0x80190000;
const SLOT24 = 0x0fec0010;
const SLOT28 = 0x0fec0020;
const SLOT2C = 0x0fec0030;
const SET_STATE0 = 0x80014274;
const ADVANCE0 = 0x800142ac;
const LOGO_CELL = 0x80088234;
const LANG_PTR = 0x8005cca8;

let EVENTS = [];
let AUDIO = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80014504, (c) => { EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]); return ROOT; });
    rt.cpu.setStub(SOUND_STUB, (c) => { EVENTS.push(["soundArchive", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c54, SOUND_STUB);
    rt.cpu.setStub(AUDIO_STUB, (c) => { EVENTS.push(["audioPending"]); return AUDIO; });
    rt.mem.write32(0x80055c60, AUDIO_STUB);
    rt.cpu.setStub(0x8001ffa8, (c) => {
        const ctx = c.reg(4) >>> 0;
        rt.mem.write32(ctx + 0x24, SLOT24);
        rt.mem.write32(ctx + 0x28, SLOT28);
        rt.mem.write32(ctx + 0x2c, SLOT2C);
        EVENTS.push(["ctxInstall"]);
        return 0;
    });
    rt.cpu.setStub(SLOT24, (c) => { EVENTS.push(["ctx", 0x24, c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(SLOT28, (c) => { EVENTS.push(["ctx", 0x28, c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(SLOT2C, (c) => { EVENTS.push(["ctx", 0x2c, c.reg(4)]); return 0; });
    rt.cpu.setStub(0x80086db0, (c) => { EVENTS.push(["createSequence", c.reg(4)]); return SEQ; });
    rt.cpu.setStub(PACK_STUB, (c) => { EVENTS.push(["packResolve", c.reg(4)]); return PACK_PTR; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    AUDIO = o.audio ?? 0;
    for (let i = 0; i <= 0x58; i += 4) rt.mem.write32(ROOT + i, 0);
    for (let i = 0; i <= 0x10; i += 4) rt.mem.write32(ARG1 + i, 0);
    rt.mem.write32(ROOT + 0x28, SET_STATE0);
    rt.mem.write32(ROOT + 0x38, ADVANCE0);
    rt.mem.write32(ROOT + 0x0c, (o.state0 ?? 0) >>> 0);
    rt.mem.write32(ROOT + 0x10, (o.substate ?? 0) >>> 0);
    rt.mem.write32(ARG1, (o.slot0 ?? 0) >>> 0);
    rt.mem.write32(LOGO_CELL, (o.cell ?? 0) >>> 0);
    rt.mem.write32(LANG_PTR, (o.lang ?? 0) >>> 0);
}

function fields() {
    return [
        rt.mem.read32(ROOT + 0x0c), rt.mem.read32(ROOT + 0x10), rt.mem.read32(ROOT + 0x14),
        rt.mem.read32(ROOT + 0x18), rt.mem.read32(ROOT + 0x50), rt.mem.read32(ROOT + 0x54),
        rt.mem.read32(ARG1), rt.mem.read32(LOGO_CELL),
    ].map((v) => v >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        allocTitleBoot(handler, size, extra) { EVENTS.push(["alloc", handler >>> 0, size, extra]); return ROOT; },
        requestSoundArchive(id) { EVENTS.push(["soundArchive", id >>> 0]); },
        audioPending() { EVENTS.push(["audioPending"]); return AUDIO; },
        advance0(obj) {
            const o = obj >>> 0;
            const v = (rt.mem.read32(o + 0x0c) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0x0c, v);
        },
        setState0(obj, state) {
            const o = obj >>> 0;
            rt.mem.write32(o + 0x0c, state >>> 0);
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        },
        createTitleSequence(obj) { EVENTS.push(["createSequence", obj >>> 0]); return SEQ; },
        installStandardContext() { EVENTS.push(["ctxInstall"]); },
        contextSlot(slot) { return slot === 0x24 ? SLOT24 : slot === 0x28 ? SLOT28 : SLOT2C; },
        contextCall(slot, a, b, c) {
            if (slot === 0x24) EVENTS.push(["ctx", 0x24, a >>> 0, b >>> 0]);
            else if (slot === 0x2c) EVENTS.push(["ctx", 0x2c, a >>> 0]);
            else EVENTS.push(["ctx", 0x28, a >>> 0, b >>> 0, (c ?? 0) >>> 0]);
        },
        packResolve(handle) { EVENTS.push(["packResolve", handle >>> 0]); return PACK_PTR; },
    };
}

test("titleBootCreate matches F0x8008497C", () => {
    seed({});
    EVENTS = [];
    rt.cpu.call(0x8008497c, []);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = fields();

    seed({});
    const obj = titleBootCreate(rt.mem, portHost());
    assert.equal(obj, ROOT, "return");
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, "calls");
    assert.deepEqual(fields(), oracleFields, "fields");
});

test("titleBootTick matches F0x800848EC", () => {
    const cases = [
        ["state 0 loading", { state0: 0, audio: 1 }],
        ["state 0 ready", { state0: 0, audio: 0, lang: 2 }],
        ["state 4 ready", { state0: 4, audio: 0, lang: 0 }],
        ["state 2 idle", { state0: 2 }],
        ["state 3 idle", { state0: 3 }],
        ["state 1 spawn", { state0: 1, substate: 0 }],
        ["state 1 waiting", { state0: 1, substate: 1, slot0: 0 }],
        ["state 1 sequence alive", { state0: 1, substate: 1, slot0: SEQ }],
    ];
    for (const [label, o] of cases) {
        seed(o);
        rt.cpu.call(0x800848ec, [ROOT, ARG1]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleFields = fields();

        seed(o);
        titleBootTick(rt.mem, ROOT, ARG1, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `${label}: calls`);
        assert.deepEqual(fields(), oracleFields, `${label}: fields`);
    }
});

test("titleBootSpawnSequence matches F0x80084868", () => {
    for (const o of [{ substate: 0 }, { substate: 2 }, { substate: 1, slot0: 0 }, { substate: 1, slot0: SEQ }]) {
        seed(o);
        rt.cpu.call(0x80084868, [ROOT, ARG1]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleFields = fields();

        seed(o);
        titleBootSpawnSequence(rt.mem, ROOT, ARG1, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `sub ${o.substate}: calls`);
        assert.deepEqual(fields(), oracleFields, `sub ${o.substate}: fields`);
    }
});

test("loadTitleLogoPack matches F0x80086DF8", () => {
    for (const lang of [0, 2, 6]) {
        seed({ lang });
        rt.cpu.call(0x80086df8, []);
        const oracleEvents = norm(EVENTS.slice());
        const oracleCell = rt.mem.read32(LOGO_CELL) >>> 0;

        seed({ lang });
        loadTitleLogoPack(rt.mem, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `lang ${lang}: calls`);
        assert.equal(rt.mem.read32(LOGO_CELL) >>> 0, oracleCell, `lang ${lang}: logo cell`);
    }
});
