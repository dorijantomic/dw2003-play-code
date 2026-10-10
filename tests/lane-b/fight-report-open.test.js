// Lane B Phase 4 oracle: engine/dw3/ui/native/fight-report-open.ts must match
// the original pro/stfgtrep F0x80085B60 report-screen open.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// menu/sound context constructor (F0x8001FFA8) and its two installed methods
// (+0x24/+0x2C), the pack resolver ([0x80044F5C]) and the audio/resource loader
// ([0x80044F44]) are the boundaries compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { reportScreenOpen } from "../../engine/dw3/ui/native/fight-report-open.ts";
import { observeUploadContext } from "../helpers/upload-context-observers.js";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const report = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: report.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const NAME_BASE = 0x801c0000;
const PACK_PTR = 0x801d0000;
const PACK_STUB = 0x0fd80000;
const AUDIO_STUB = 0x0fd80004;

const LOG = [];

function runtime() {
    const rt = new NativeStageRuntime(report, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    observeUploadContext(rt, {
        0x24: (c) => { LOG.push(["snd+0x24", c.reg(4) | 0, c.reg(5) | 0]); return 0; },
        0x2c: (c) => { LOG.push(["snd+0x2c", c.reg(4) | 0, c.reg(5) | 0]); return 0; },
    });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["packResolve", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(AUDIO_STUB, (c) => { LOG.push(["loadAudio", c.reg(4) | 0]); return 0; });
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x80044f44, AUDIO_STUB);
    rt.mem.write32(0x8005cca8, NAME_BASE);
    return rt;
}

function portHost() {
    return {
        initContext() {},
        contextMethod(slot, args) {
            LOG.push([slot === 0x24 ? "snd+0x24" : "snd+0x2c", ...args.map((a) => a | 0)]);
        },
        packResolve(handle) { LOG.push(["packResolve", handle | 0]); return PACK_PTR; },
        loadAudio(id) { LOG.push(["loadAudio", id | 0]); },
    };
}

test("reportScreenOpen matches F0x80085B60", () => {
    const rt = runtime();

    LOG.length = 0;
    rt.cpu.call(0x80085b60, [], 40000);
    const oracleLog = LOG.slice();

    LOG.length = 0;
    reportScreenOpen(rt.mem, portHost());
    const portLog = LOG.slice();

    assert.deepEqual(portLog, oracleLog, "ordered context/pack/audio calls");
    assert.deepEqual(
        portLog.filter(([m]) => m === "loadAudio").map(([, id]) => id),
        [NAME_BASE + 0x55, NAME_BASE + 0x4e, NAME_BASE + 0x6a].map((v) => v | 0),
        "audio string ids",
    );
});

test("reportScreenOpen binds the report pack to context slot 0x2C", () => {
    const rt = runtime();
    LOG.length = 0;
    rt.cpu.call(0x80085b60, [], 40000);
    const oracleLog = LOG.slice();
    assert.deepEqual(oracleLog[0], ["snd+0x24", 0x280, 0], "origin");
    assert.deepEqual(oracleLog[1], ["packResolve", 0x07a00000], "pack resolve");
    assert.deepEqual(oracleLog[2], ["snd+0x2c", PACK_PTR | 0, 0], "pack bind");

    LOG.length = 0;
    reportScreenOpen(rt.mem, portHost());
    assert.deepEqual(LOG, oracleLog);
});
