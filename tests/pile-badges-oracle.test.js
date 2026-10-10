// Phase 4 oracle: engine/dw3/ui/pile-badges.ts must match pro/cardgame's
// F0x80096CF0 (pileCountBadgePopTick) and F0x80096E24 (pileCountBadgesPopAll).
// Each original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with the plate draw and the frame delta recorded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { pileCountBadgePopTick, pileCountBadgesPopAll, pileBadgeEntry } from "../engine/dw3/ui/pile-badges.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VIEW = 0x80180000;
const PLATE_STUB = 0x0fe50000;
const DELTA_STUB = 0x0fe20000;

let EVENTS = [];
let DELTA = 1;

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x80096c20, (c) => {
        EVENTS.push(["plate", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0]);
    });
    rt.cpu.setStub(DELTA_STUB, () => { EVENTS.push(["delta", 0]); return DELTA; });
    rt.mem.write32(0x8004df9c, DELTA_STUB);
    return rt;
}

const rt = runtime();

function seed(o = {}) {
    EVENTS = [];
    DELTA = o.delta ?? 1;
    for (let i = 0; i < 3 * 0x0c + 0x10; i += 4) rt.mem.write32(VIEW + 0xdc0 + i, 0);
    writeEntry(0, o.a ?? {});
    writeEntry(1, o.b ?? {});
    writeEntry(2, o.c ?? {});
}

function writeEntry(i, e) {
    const a = pileBadgeEntry(VIEW, i);
    rt.mem.write16(a + 0x02, e.scale ?? 0);
    rt.mem.write16(a + 0x04, e.counter ?? 0);
    rt.mem.write16(a + 0x06, e.duration ?? 0);
    rt.mem.write16(a + 0x08, e.state ?? 0);
}

function snapshot() {
    const out = [];
    for (let i = 0; i < 3; i++) {
        const a = pileBadgeEntry(VIEW, i);
        out.push(rt.mem.read16(a + 0x02), rt.mem.read16(a + 0x04), rt.mem.read16(a + 0x08));
    }
    return out;
}

function events() { return EVENTS.map((e) => e.map((v) => (typeof v === "number" ? v >>> 0 : v))); }

function portHost() {
    return {
        frameDelta() { EVENTS.push(["delta", 0]); return DELTA; },
        drawPileBadgePlate(view, param, index, e) {
            EVENTS.push(["plate", view >>> 0, param >>> 0, index >>> 0, e >>> 0]);
        },
    };
}

function runTick(label, o) {
    seed(o);
    EVENTS = [];
    rt.cpu.call(0x80096cf0, [VIEW, 0x11, 0, pileBadgeEntry(VIEW, 0)]);
    const oEvents = events();
    const oFields = snapshot();

    seed(o);
    EVENTS = [];
    pileCountBadgePopTick(rt.mem, VIEW, 0x11, 0, pileBadgeEntry(VIEW, 0), portHost());
    assert.deepEqual(events(), oEvents, `${label}: calls`);
    assert.deepEqual(snapshot(), oFields, `${label}: fields`);
}

test("pileCountBadgePopTick matches F0x80096CF0", () => {
    runTick("idle", { a: { state: 0, counter: 9, duration: 10 } });
    runTick("held", { a: { state: 2, scale: 0x1234 } });
    runTick("grow down", { a: { state: 1, counter: 10, duration: 10 } });
    runTick("grow lands", { a: { state: 1, counter: 1, duration: 10 } });
    runTick("shrink", { a: { state: 3, counter: 5, duration: 10 } });
    runTick("shrink lands", { a: { state: 3, counter: 1, duration: 10 } });
    runTick("shrink past zero", { a: { state: 3, counter: 0, duration: 10 } });
    runTick("above three", { a: { state: 4, counter: 2, duration: 5 } });
    runTick("negative state", { a: { state: -1, counter: 3, duration: 4 } });
});

test("pileCountBadgesPopAll matches F0x80096E24", () => {
    const o = {
        a: { state: 1, counter: 4, duration: 8 },
        b: { state: 0, counter: 9, duration: 9 },
        c: { state: 2, scale: 1 },
    };
    seed(o);
    EVENTS = [];
    rt.cpu.call(0x80096e24, [VIEW, 0x22]);
    const oEvents = events();
    const oFields = snapshot();

    seed(o);
    EVENTS = [];
    pileCountBadgesPopAll(rt.mem, VIEW, 0x22, portHost());
    assert.deepEqual(events(), oEvents, "calls");
    assert.deepEqual(snapshot(), oFields, "fields");
});
