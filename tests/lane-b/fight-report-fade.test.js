// Oracle: engine/dw3/ui/native/fight-report-fade.ts must match the original
// pro/stfgtrep fade object (F0x80083218 create, F0x80082F98 start, F0x80083164
// tick). The original runs through engine/native; the allocator, the object
// methods and the dim painter (F0x80083020, a GPU primitive) are stubbed on both
// sides so the ordered calls and the fields can be compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { reportFadeCreate, reportFadeStart, reportFadeTick } from "../../engine/dw3/ui/native/fight-report-fade.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stfgtrep.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const FADE = 0x80150000;
const NEW_FADE = 0x80154000;
const M28 = 0x0fe30028;
const M38 = 0x0fe30038;
const LOG = [];

const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
st(0x80014504, (c) => { LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]); return NEW_FADE; });
st(0x80083020, (c) => { LOG.push(["dimQuad", c.reg(4) | 0]); return 0; });
st(M28, (c) => { LOG.push(["method", c.reg(4) | 0, 0x28, c.reg(5) | 0]); return 0; });
st(M38, (c) => { LOG.push(["method", c.reg(4) | 0, 0x38, c.reg(4) | 0]); return 0; });
const host = () => ({
    alloc(h, s, e) { LOG.push(["alloc", h | 0, s, e]); return NEW_FADE; },
    callMethod(t, slot, args) { LOG.push(["method", t | 0, slot, ...(slot === 0x38 ? [t | 0] : args.map((a) => a | 0))]); },
    dimQuad(f) { LOG.push(["dimQuad", f | 0]); },
});

function seed(c) {
    for (let i = 0; i < 0x80; i += 4) { rt.mem.write32(FADE + i, 0); rt.mem.write32(NEW_FADE + i, 0); }
    rt.mem.write32(FADE + 0x28, M28);
    rt.mem.write32(FADE + 0x38, M38);
    rt.mem.write32(FADE + 0x0c, c.state ?? 0);
    rt.mem.write32(FADE + 0x10, c.armed ?? 0);
    rt.mem.write32(FADE + 0x58, c.dir ?? 0);
    rt.mem.write32(FADE + 0x5c, c.level ?? 0);
    rt.mem.write32(FADE + 0x60, c.step ?? 0);
    rt.mem.write32(NEW_FADE + 0x28, M28);
    rt.mem.write32(NEW_FADE + 0x38, M38);
}
const snap = () => {
    const out = [];
    for (const base of [FADE, NEW_FADE]) for (let i = 0; i < 0x80; i += 4) out.push(rt.mem.read32(base + i) >>> 0);
    return out;
};
function compare(name, c, orig, port) {
    seed(c); LOG.length = 0; orig();
    const olog = LOG.slice(); const osnap = snap();
    seed(c); LOG.length = 0; port();
    assert.deepEqual(LOG, olog, `${name}: calls`);
    assert.deepEqual(snap(), osnap, `${name}: memory`);
}

test("reportFadeCreate matches F0x80083218", () => {
    compare("create", {}, () => rt.cpu.call(0x80083218, [], 20000), () => reportFadeCreate(rt.mem, host()));
});

test("reportFadeStart matches F0x80082F98", () => {
    for (const dirn of [0, 1, 2, -1]) {
        for (const frames of [1, 7, 30, 255, 0x100, 0xff00, 0x10000, 0]) {
            compare(`start dir${dirn} frames${frames}`, {},
                () => rt.cpu.call(0x80082f98, [FADE, dirn, frames], 20000),
                () => reportFadeStart(rt.mem, FADE, dirn, frames, host()));
        }
    }
});

test("reportFadeTick matches F0x80083164 across states", () => {
    for (const state of [0, 1, 2, 3, 4, 9, -1]) {
        for (const armed of [0, 1]) {
            for (const dirn of [0, 1]) {
                for (const level of [0, 0x100, 0xfe00, 0xff00, 0xffff]) {
                    for (const step of [0x888, -0x888, 0x2000, -0x2000]) {
                        const c = { state, armed, dir: dirn, level, step };
                        compare(`tick ${JSON.stringify(c)}`, c,
                            () => rt.cpu.call(0x80083164, [FADE], 40000),
                            () => reportFadeTick(rt.mem, FADE, host()));
                    }
                }
            }
        }
    }
});
