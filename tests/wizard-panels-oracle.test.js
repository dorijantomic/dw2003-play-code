// Phase 4 oracle: engine/dw3/ui/wizard-panels.ts must match pro/stplnmet
// F0x80088438/F0x800884CC (the fold) and F0x80085E10/F0x80087AC0/F0x80086F60
// (the three panels). The originals run through engine/native with the factory,
// the sound cell and the two name-field callees stubbed; the port compares
// calls, fields and return values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    wizardFoldStart, wizardFoldTick,
    wizardNameEntryCreate, wizardPackListCreate, wizardConfirmCreate,
} from "../engine/dw3/ui/wizard-panels.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const CTX = 0x80181000;
const SAVE_CTX = 0x80048d88;
const SOUND_STUB = 0x0fed0010;
const ALLOC_STUB = 0x0fed0020;
const NAME_INIT = 0x0fed0030;
const NAME_BOX = 0x0fed0040;
const LANG_PTR = 0x8005cca8;

let EVENTS = [];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(SOUND_STUB, (c) => { EVENTS.push(["sound", c.reg(4)]); return 0; });
    rt.mem.write32(0x80055c48, SOUND_STUB);
    rt.cpu.setStub(0x80014504, (c) => { EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]); return OBJ; });
    rt.cpu.setStub(NAME_INIT, (c) => { EVENTS.push(["initNameField", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(NAME_BOX, (c) => {
        rt.mem.write32(c.reg(4) + 0x5c, c.reg(5));
        rt.mem.write32(c.reg(4) + 0x60, c.reg(6));
        EVENTS.push(["setNameFieldBox", c.reg(4), c.reg(5), c.reg(6)]);
        return 0;
    });
    // The overlay's own calls to the two name-field helpers.
    rt.cpu.setStub(0x80085bbc, (c) => { EVENTS.push(["initNameField", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(0x80085bb0, (c) => {
        rt.mem.write32(c.reg(4) + 0x5c, c.reg(5));
        rt.mem.write32(c.reg(4) + 0x60, c.reg(6));
        EVENTS.push(["setNameFieldBox", c.reg(4), c.reg(5), c.reg(6)]);
        return 0;
    });
    return rt;
}

const rt = runtime();

function zeroObj() {
    for (let i = 0; i <= 0xf8; i += 4) rt.mem.write32(OBJ + i, 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        playSound(id) { EVENTS.push(["sound", id >>> 0]); },
        allocWizardPanel(handler, size, extra) {
            EVENTS.push(["alloc", handler >>> 0, size, extra]);
            return OBJ;
        },
        initNameField(obj, saveCtx) { EVENTS.push(["initNameField", obj >>> 0, saveCtx >>> 0]); },
        setNameFieldBox(obj, w, h) {
            rt.mem.write32((obj >>> 0) + 0x5c, w);
            rt.mem.write32((obj >>> 0) + 0x60, h);
            EVENTS.push(["setNameFieldBox", obj >>> 0, w, h]);
        },
    };
}

test("wizardFoldStart matches F0x80088438", () => {
    for (const open of [1, 0]) {
        for (const duration of [0x0a, 0x01, 0x00]) {
            EVENTS = [];
            for (let i = 0; i <= 0x10; i += 4) rt.mem.write32(CTX + i, 0);
            rt.mem.write32(CTX + 0x00, duration);
            rt.cpu.call(0x80088438, [CTX, open]);
            const oracleEvents = norm(EVENTS.slice());
            const oracleFields = [0, 4, 8, 0xc].map((o) => rt.mem.read32(CTX + o) >>> 0);

            EVENTS = [];
            for (let i = 0; i <= 0x10; i += 4) rt.mem.write32(CTX + i, 0);
            rt.mem.write32(CTX + 0x00, duration);
            wizardFoldStart(rt.mem, CTX, open, portHost());
            assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `open ${open} dur ${duration}: calls`);
            assert.deepEqual([0, 4, 8, 0xc].map((o) => rt.mem.read32(CTX + o) >>> 0), oracleFields,
                `open ${open} dur ${duration}: fields`);
        }
    }
});

test("wizardFoldTick matches F0x800884CC", () => {
    const cases = [
        { active: 0 },
        { active: 1, delta: 0x199, value: 0x1000 },
        { active: 1, delta: 0x199, value: 0 },
        { active: 1, delta: -0x332, value: 0x0001 },
        { active: 1, delta: -0x332, value: 0x1000 },
    ];
    for (const c of cases) {
        for (let i = 0; i <= 0x10; i += 4) rt.mem.write32(CTX + i, 0);
        rt.mem.write32(CTX + 0x04, (c.delta ?? 0) >>> 0);
        rt.mem.write32(CTX + 0x08, (c.value ?? 0) >>> 0);
        rt.mem.write32(CTX + 0x0c, (c.active ?? 0) >>> 0);
        const oracleRet = rt.cpu.call(0x800884cc, [CTX]) | 0;
        const oracleFields = [4, 8, 0xc].map((o) => rt.mem.read32(CTX + o) >>> 0);

        for (let i = 0; i <= 0x10; i += 4) rt.mem.write32(CTX + i, 0);
        rt.mem.write32(CTX + 0x04, (c.delta ?? 0) >>> 0);
        rt.mem.write32(CTX + 0x08, (c.value ?? 0) >>> 0);
        rt.mem.write32(CTX + 0x0c, (c.active ?? 0) >>> 0);
        const portRet = wizardFoldTick(rt.mem, CTX) | 0;
        assert.equal(portRet, oracleRet, `ret active ${c.active} delta ${c.delta}`);
        assert.deepEqual([4, 8, 0xc].map((o) => rt.mem.read32(CTX + o) >>> 0), oracleFields,
            `fields active ${c.active} delta ${c.delta}`);
    }
});

test("wizardNameEntryCreate matches F0x80085E10", () => {
    for (const lang of [0, 2]) {
        EVENTS = [];
        zeroObj();
        rt.mem.write32(LANG_PTR, lang);
        rt.cpu.call(0x80085e10, [SAVE_CTX]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleFields = [0xec, 0xf0, 0xf4, 0x50, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x94]
            .map((o) => rt.mem.read32(OBJ + o) >>> 0);

        EVENTS = [];
        zeroObj();
        rt.mem.write32(LANG_PTR, lang);
        const obj = wizardNameEntryCreate(rt.mem, SAVE_CTX, portHost());
        assert.equal(obj, OBJ, `lang ${lang}: return`);
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `lang ${lang}: calls`);
        assert.deepEqual([0xec, 0xf0, 0xf4, 0x50, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x94]
            .map((o) => rt.mem.read32(OBJ + o) >>> 0), oracleFields, `lang ${lang}: fields`);
    }
});

test("wizardPackListCreate matches F0x80087AC0", () => {
    EVENTS = [];
    zeroObj();
    rt.cpu.call(0x80087ac0, [0x80182000]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = [0x88, 0x50, 0x54, 0x58].map((o) => rt.mem.read32(OBJ + o) >>> 0);

    EVENTS = [];
    zeroObj();
    const obj = wizardPackListCreate(rt.mem, 0x80182000, portHost());
    assert.equal(obj, OBJ, "return");
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, "calls");
    assert.deepEqual([0x88, 0x50, 0x54, 0x58].map((o) => rt.mem.read32(OBJ + o) >>> 0), oracleFields, "fields");
});

test("wizardConfirmCreate matches F0x80086F60", () => {
    EVENTS = [];
    zeroObj();
    rt.cpu.call(0x80086f60, [0x80182000]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = [0xdc, 0xe0, 0x50, 0x54, 0x58].map((o) => rt.mem.read32(OBJ + o) >>> 0);

    EVENTS = [];
    zeroObj();
    const obj = wizardConfirmCreate(rt.mem, 0x80182000, portHost());
    assert.equal(obj, OBJ, "return");
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, "calls");
    assert.deepEqual([0xdc, 0xe0, 0x50, 0x54, 0x58].map((o) => rt.mem.read32(OBJ + o) >>> 0), oracleFields, "fields");
});
