// Oracle: the album popup's fade start and tick (engine/dw3/ui/native/album-leaves.ts
// albumPopupFadeStart / albumPopupFadeTick) must match the original pro/stcrdabm
// F0x80082D88 and F0x80082F54 bodies (claim `stcrdabm-fader-lerp-addresses-2026-10-11`).
//
// The original runs through engine/native on pro_stcrdabm.bin; the object's two
// method pointers (+0x28 start, +0x38 parked) and the fade-quad draw
// (F0x80082E10) are stubbed on both sides, so the ordered calls and the fields
// can be compared.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { albumPopupFadeStart, albumPopupFadeTick } from "../../engine/dw3/ui/native/album-leaves.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_stcrdabm.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const OBJ = 0x80150000;
const M28 = 0x0fe30028;
const M38 = 0x0fe30038;
const DRAW = 0x80082e10;
const LOG = [];

const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
const st = (a, f) => rt.cpu.setStub(a, f);
st(M28, (c) => { LOG.push(["method", c.reg(4) | 0, 0x28, c.reg(5) | 0]); return 0; });
st(M38, (c) => { LOG.push(["method", c.reg(4) | 0, 0x38, c.reg(4) | 0]); return 0; });
st(DRAW, (c) => { LOG.push(["drawFade", c.reg(4) | 0]); return 0; });
const host = (mem) => ({
    callMethod(t, slot, args) { LOG.push(["method", t | 0, slot, ...(slot === 0x38 ? [t | 0] : args.map((a) => a | 0))]); },
    baseMethod38(obj) { LOG.push(["method", obj | 0, 0x38, obj | 0]); },
    drawFade(obj) { LOG.push(["drawFade", obj | 0]); },
});

const FIELDS = [0x0c, 0x10, 0x58, 0x5c, 0x60];
function seed(obj, c) {
    for (let i = 0; i < 0x70; i += 4) rt.mem.write32(obj + i, 0);
    rt.mem.write32(obj + 0x28, M28);
    rt.mem.write32(obj + 0x38, M38);
    rt.mem.write32(obj + 0x0c, c.state ?? 0);
    rt.mem.write32(obj + 0x10, c.armed ?? 0);
    rt.mem.write32(obj + 0x58, c.dir ?? 0);
    rt.mem.write32(obj + 0x5c, c.level ?? 0);
    rt.mem.write32(obj + 0x60, c.step ?? 0);
}
const snap = (obj) => FIELDS.map((off) => rt.mem.read32(obj + off) >>> 0);

test("albumPopupFadeStart matches F0x80082D88", () => {
    for (const [dir, frames] of [[0, 10], [1, 10], [0, 7], [1, 255], [0, 1], [1, 1], [0, 0], [1, 0], [2, 4], [-1, 6]]) {
        seed(OBJ, {});
        LOG.length = 0;
        rt.cpu.call(0x80082d88, [OBJ, dir, frames], 20000);
        const olog = LOG.slice(); const osnap = snap(OBJ);
        seed(OBJ, {});
        LOG.length = 0;
        albumPopupFadeStart(rt.mem, OBJ, dir, frames, host(rt.mem));
        assert.deepEqual(LOG, olog, `start ${dir}/${frames}: calls`);
        assert.deepEqual(snap(OBJ), osnap, `start ${dir}/${frames}: fields`);
    }
});

test("albumPopupFadeTick matches F0x80082F54", () => {
    const levels = [[0, 0x1000], [0xf800, 0x1000], [0x400, -0x1000], [0x400, 0x300], [0xff00, 0x100], [0, -0x400], [0x100, 0]];
    for (const state of [0, 1, 2, 3, 4, -1]) {
        for (const armed of [0, 1]) {
            for (const dir of [0, 1]) {
                for (const [level, step] of levels) {
                    const c = { state, armed, dir, level, step };
                    seed(OBJ, c);
                    LOG.length = 0;
                    rt.cpu.call(0x80082f54, [OBJ], 20000);
                    const olog = LOG.slice(); const osnap = snap(OBJ);
                    seed(OBJ, c);
                    LOG.length = 0;
                    albumPopupFadeTick(rt.mem, OBJ, host(rt.mem));
                    assert.deepEqual(LOG, olog, `tick s${state} a${armed} d${dir} ${level}/${step}: calls`);
                    assert.deepEqual(snap(OBJ), osnap, `tick s${state} a${armed} d${dir} ${level}/${step}: fields`);
                }
            }
        }
    }
});
