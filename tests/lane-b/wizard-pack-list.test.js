// Oracle: engine/dw3/ui/native/wizard-pack-list.ts against the original
// pro/stplnmet starter-pack list bodies (build, text bind, move, draw, tick).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import { wizardPackListShow } from "../../engine/dw3/ui/wizard-methods.ts";
import {
    packListDraw, packListMove, packListTextBind, packListTick, packListWidgetsBuild,
} from "../../engine/dw3/ui/native/wizard-pack-list.ts";

const h = createHarness({ overlayFile: "pro_stplnmet.bin" });
const OBJ = 0x80150000;
const UI = 0x80155000;
const LANG = 0x8005cca8;

const seedObj = (c = {}) => () => {
    for (let i = 0; i < 0x100; i += 4) h.rt.mem.write32(OBJ + i, 0);
    for (let i = 0; i < 0x40; i += 4) h.rt.mem.write32(UI + i, 0);
    h.rt.mem.write32(LANG, c.lang ?? 2);
    const set = (o, v) => h.rt.mem.write32(OBJ + o, v | 0);
    set(0x0c, c.state ?? 1); set(0x10, c.sub ?? 0); set(0x54, 0x1001); set(0x58, 6);
    set(0x5c, c.f0 ?? 0); set(0x60, c.f1 ?? 0); set(0x64, c.f2 ?? 0); set(0x68, c.t ?? 90);
    set(0x6c, c.pack ?? 0); set(0x70, c.arrow ?? 0); set(0x74, c.at ?? 95);
    set(0x24, UI); set(0x38, h.S.methodBase + 0x38); set(0x3c, h.S.methodBase + 0x3c);
    h.reset(c.seed ?? 3);
    for (let i = 0; i < 0x34; i += 4) h.rt.mem.write32(UI + i, h.widgetAt(20 + i / 4));
    h.CTL.pad = c.pad ?? { pressed: 0, held: 0, repeat: 0 };
    h.CTL.frame = c.frame ?? 130;
};
const RANGES = [[OBJ, 0x100], [UI, 0x40]];
// The list's own show method (F0x800879E0) is a ported body that calls the text bind.
const host = () => {
    const base = h.host();
    return h.host({
        show(obj, on) {
            wizardPackListShow(h.rt.mem, obj, on, {
                packChildCall: (o, child, mode) => packListTextBind(h.rt.mem, o, child, mode, base),
                confirmChildCall: () => { throw new Error("not reached"); },
            });
        },
    });
};

test("packListWidgetsBuild and packListTextBind match", () => {
    h.compare("build", seedObj(), RANGES, () => h.rt.cpu.call(0x80086fc0, [OBJ, UI], 60000),
        () => packListWidgetsBuild(h.rt.mem, OBJ, UI, host()));
    for (const lang of [0, 1, 2, 5]) {
        for (const pack of [0, 1, 2]) {
            for (const show of [0, 1]) {
                h.compare(`bind l${lang} p${pack} s${show}`, seedObj({ lang, pack }), RANGES,
                    () => h.rt.cpu.call(0x80087190, [OBJ, UI, show], 60000),
                    () => packListTextBind(h.rt.mem, OBJ, UI, show, host()));
            }
        }
    }
});

const bit = (n) => 1 << n;
const padSets = [
    { pressed: 0, repeat: 0 }, { pressed: bit(4), repeat: 0 }, { pressed: bit(6), repeat: 0 },
    { pressed: 0, repeat: bit(4) }, { pressed: 0, repeat: bit(6) }, { pressed: bit(0xd), repeat: 0 },
    { pressed: bit(0xe), repeat: 0 }, { pressed: bit(4) | bit(0xd), repeat: 0 },
    { pressed: bit(6), repeat: bit(4) }, { pressed: bit(0xd) | bit(0xe), repeat: bit(6) },
];

test("packListMove matches", () => {
    for (const pack of [0, 1, 2]) {
        for (const p of padSets) {
            h.compare(`move p${pack} ${JSON.stringify(p)}`, seedObj({ pack, pad: { ...p, held: 0 } }), RANGES,
                () => h.rt.cpu.call(0x80087774, [OBJ, UI], 60000),
                () => packListMove(h.rt.mem, OBJ, UI, host()));
        }
    }
});

test("packListDraw matches across clocks and frames", () => {
    for (const pack of [0, 1, 2]) {
        for (const frame of [100, 103, 108, 109, 113, 130]) {
            for (const f of [[0, 0, 0], [7, 3, 1], [8, 8, 8], [2, 6, 7]]) {
                h.compare(`draw p${pack} f${frame} ${f}`,
                    seedObj({ pack, frame, f0: f[0], f1: f[1], f2: f[2], t: 100, at: 100, arrow: frame % 7 }), RANGES,
                    () => h.rt.cpu.call(0x80087444, [OBJ], 60000), () => packListDraw(h.rt.mem, OBJ, host()));
            }
        }
    }
});

test("packListTick matches across states", () => {
    for (const state of [0, 1, 2, 3, 4, 9]) {
        for (const p of padSets.slice(0, 6)) {
            h.compare(`tick s${state} ${JSON.stringify(p)}`, seedObj({ state, pad: { ...p, held: 0 } }), RANGES,
                () => h.rt.cpu.call(0x80087a30, [OBJ, UI], 200000), () => packListTick(h.rt.mem, OBJ, UI, host()));
        }
    }
    assert.ok(true);
});
