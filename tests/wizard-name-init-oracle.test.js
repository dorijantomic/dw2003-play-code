// Phase 4 oracle: engine/dw3/ui/wizard-name-init.ts must match pro/stplnmet
// F0x80085BBC. The original runs through engine/native with the text-context
// builder, its +0x08 slot and the measurer stubbed; the port compares calls and
// the padded field.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { wizardNameFieldInit } from "../engine/dw3/ui/wizard-name-init.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80180000;
const SAVE_CTX = 0x80048d88;
const SLOT8 = 0x0fee0010;
const MEASURE = 0x8002525c;
const WIDTH = 10;

let EVENTS = [];
let LENGTH = 0;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x8001fcc0, (c) => {
        rt.mem.write32(c.reg(4) + 0x08, SLOT8);
        EVENTS.push(["initTextContext"]);
        return 0;
    });
    rt.cpu.setStub(SLOT8, (c) => { EVENTS.push(["textSlot", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(MEASURE, (c) => { EVENTS.push(["measure", c.reg(4)]); return LENGTH; });
    return rt;
}

const rt = runtime();

function seed(length) {
    EVENTS = [];
    LENGTH = length;
    for (let i = 0; i <= 0x98; i += 4) rt.mem.write32(OBJ + i, 0);
    for (let i = 0; i <= WIDTH; i++) rt.mem.write16(OBJ + 0x78 + i * 2, 0xdead);
    rt.mem.write32(OBJ + 0x94, WIDTH);
}

function field() {
    const out = [];
    for (let i = 0; i <= WIDTH; i++) out.push(rt.mem.read16(OBJ + 0x78 + i * 2) >>> 0);
    return out;
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        initTextContext() { EVENTS.push(["initTextContext"]); },
        textContextSource(buffer, saveCtx, mode) { EVENTS.push(["textSlot", buffer >>> 0, saveCtx >>> 0, mode]); },
        measureText(buffer) { EVENTS.push(["measure", buffer >>> 0]); return LENGTH; },
    };
}

test("wizardNameFieldInit matches F0x80085BBC", () => {
    for (const length of [0, 2, 10, 20, 21]) {
        seed(length);
        rt.cpu.call(0x80085bbc, [OBJ, SAVE_CTX]);
        const oracleEvents = norm(EVENTS.slice());
        const oracleField = field();

        seed(length);
        wizardNameFieldInit(rt.mem, OBJ, SAVE_CTX, portHost());
        assert.deepEqual(norm(EVENTS.slice()), oracleEvents, `len ${length}: calls`);
        assert.deepEqual(field(), oracleField, `len ${length}: field`);
    }
});
