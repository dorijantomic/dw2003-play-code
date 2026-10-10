// Oracle: engine/dw3/ui/native/fight-report-boot.ts must match the original
// pro/stfgtrep boot chain: the overlay entry constructor F0x80082F6C, the boot
// task F0x80082E70, the root constructor F0x80085B24 and the bank-ready probe
// F0x80085C08. The original runs through engine/native with the allocator, the
// resident display service, the view methods and the cache poll stubbed on both
// sides, so the ordered boundary calls and the fields can be compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { reportBanksReady, reportBootTick, reportEntryCreate, reportRootCreate } from "../../engine/dw3/ui/native/fight-report-boot.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const TASK = 0x80150000;
const ARR = 0x80151000;
const NEW = 0x80154000;
const ROOT = 0x80156000;
const VIEW = 0x80158000;
const DISPLAY = 0x8004de10;
const LANGUAGE = 0x8005cca8;
const CACHE = 0x80044b38;
const STUB = { advance: 0x0fe40038, reset: 0x0fe40150, packet: 0x0fe40154, region: 0x0fe40174, view: 0x0fe4016c, colour: 0x0fe4012c, poll: 0x0fe40404 };
const LOG = [];
let pendingIds = new Set();

const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
st(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return NEW; });
st(0x80085b24, () => { LOG.push(["createRoot"]); return ROOT; });
st(STUB.advance, (c) => { LOG.push(["advance", c.reg(4) | 0]); return 0; });
st(STUB.reset, () => { LOG.push(["displayReset"]); return 0; });
st(STUB.packet, (c) => { LOG.push(["displayPacketSize", c.reg(4) >>> 0]); return 0; });
st(STUB.region, (c) => { LOG.push(["displayRegion", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
st(STUB.view, (c) => {
    const rect = c.reg(4) >>> 0;
    LOG.push(["displayView", rt.mem.read16(rect), rt.mem.read16(rect + 2), rt.mem.read16(rect + 4), rt.mem.read16(rect + 6), c.reg(5) | 0, c.reg(6) | 0]);
    return VIEW;
});
st(STUB.colour, (c) => { LOG.push(["viewColour", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });
st(STUB.poll, (c) => { const id = c.reg(4) | 0; LOG.push(["pending", id]); return pendingIds.has(id) ? 1 : 0; });
rt.mem.write32(DISPLAY + 0x150, STUB.reset);
rt.mem.write32(DISPLAY + 0x154, STUB.packet);
rt.mem.write32(DISPLAY + 0x174, STUB.region);
rt.mem.write32(DISPLAY + 0x16c, STUB.view);
rt.mem.write32(CACHE + 0x404, STUB.poll);
rt.mem.write32(VIEW + 0x12c, STUB.colour);

const host = () => ({
    alloc(h, s, e) { LOG.push(["alloc", h >>> 0, s, e]); return NEW; },
    displayReset() { LOG.push(["displayReset"]); },
    displayPacketSize(b) { LOG.push(["displayPacketSize", b >>> 0]); },
    displayRegion(w, h, a, b) { LOG.push(["displayRegion", w | 0, h | 0, a | 0, b | 0]); },
    displayView(r, k, p) { LOG.push(["displayView", r.x, r.y, r.w, r.h, k | 0, p | 0]); return VIEW; },
    viewColour(v, r, g, b) { LOG.push(["viewColour", v >>> 0, r | 0, g | 0, b | 0]); },
    advance() { LOG.push(["advance", TASK | 0]); },
    createRoot() { LOG.push(["createRoot"]); return ROOT; },
    pending(id) { LOG.push(["pending", id | 0]); return pendingIds.has(id | 0) ? 1 : 0; },
});

function seed(state) {
    for (let i = 0; i < 0x60; i += 4) { rt.mem.write32(TASK + i, 0); rt.mem.write32(NEW + i, 0xabcd0000 + i); }
    rt.mem.write32(TASK + 0x38, STUB.advance);
    rt.mem.write32(TASK + 0x0c, state >>> 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(ARR + i, 0xdead);
}
const snap = () => {
    const out = [];
    for (const base of [TASK, NEW]) for (let i = 0; i < 0x60; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
    for (let i = 0; i < 0x20; i += 4) out.push(rt.mem.read32(ARR + i) >>> 0);
    return out;
};
function compare(name, state, orig, port) {
    seed(state); LOG.length = 0; const a = orig();
    const olog = LOG.slice(); const osnap = snap();
    seed(state); LOG.length = 0; const b = port();
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
    assert.equal(b, a, `${name}: return`);
}

test("reportEntryCreate matches F0x80082F6C", () => {
    compare("entry", 0, () => { rt.cpu.call(0x80082f6c, [], 20000); return 0; }, () => { reportEntryCreate(host()); return 0; });
});

test("reportRootCreate matches F0x80085B24", () => {
    // The original root constructor is stubbed elsewhere in this file; run the real body here.
    const real = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
        undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
    real.cpu.setStub(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) >>> 0, c.reg(5) | 0, c.reg(6) | 0]); return NEW; });
    for (let i = 0; i < 0x60; i += 4) real.mem.write32(NEW + i, 0);
    LOG.length = 0;
    const a = real.cpu.call(0x80085b24, [], 20000) >>> 0;
    const olog = LOG.slice();
    const orig = [real.mem.read32(NEW + 0x50), real.mem.read32(NEW + 0x54)];
    for (let i = 0; i < 0x60; i += 4) real.mem.write32(NEW + i, 0);
    LOG.length = 0;
    const b = reportRootCreate(real.mem, host()) >>> 0;
    assert.deepEqual(LOG, olog);
    assert.equal(b, a);
    assert.deepEqual([real.mem.read32(NEW + 0x50), real.mem.read32(NEW + 0x54)], orig);
});

test("reportBootTick matches F0x80082E70 across states", () => {
    for (const state of [0, 1, 2, 3, 4, 5, 0x35, -1, -7, 0x7fffffff]) {
        compare(`boot state ${state}`, state,
            () => { rt.cpu.call(0x80082e70, [TASK, ARR], 40000); return 0; },
            () => { reportBootTick(rt.mem, TASK, ARR, host()); return 0; });
    }
});

test("reportBanksReady matches F0x80085C08 for every pending combination", () => {
    for (const language of [0, 2, 6]) {
        for (let mask = 0; mask < 8; mask++) {
            rt.mem.write32(LANGUAGE, language);
            pendingIds = new Set([0x55, 0x4e, 0x6a].filter((_, i) => mask & (1 << i)).map((o) => language + o));
            compare(`banks lang ${language} mask ${mask}`, 0,
                () => rt.cpu.call(0x80085c08, [], 20000) | 0,
                () => reportBanksReady(rt.mem, host()) | 0);
        }
    }
});
