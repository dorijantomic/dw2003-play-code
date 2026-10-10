// Oracle: engine/dw3/ui/native/gym-hud-delta.ts must match the original pro/stgtrain screen draw
// method F0x80084370 (with the nothing-to-compare case running the translated HUD fills).
import { test } from "node:test";
import { createKit, installUi, rng, UI } from "./gym-kit.js";
import { gymHudDeltaFill } from "../../engine/dw3/ui/native/gym-hud-delta.ts";

const kit = createKit();
const mem = kit.mem;
const SCREEN = 0x80150000;
const HUD = 0x80150200;
const SNAP = 0x80150400;
const PROJ = 0x80150600;
mem.write32(0x8005cca8, 3);
const cfg = { pressed: 0, held: 0, repeat: 0, channel: 7, created: [], done: () => 0, waiting: () => 0, fold: () => 1, group: 0, rand: () => 0,
    projection: [], roster: (p) => p + 1 };
const ui = installUi(kit, cfg);
// The resident accessors the HUD uses: the member's name block and the projection.
kit.cell(0x8004b484, "handle", () => UI.block, { args: 1 });
kit.cell(0x8004b468, "projection", 0, { args: 2, silent: true, before: (_c, a) => {
    kit.push("projection", a[0]);
    for (let i = 0; i < 0x2c; i++) mem.write8(a[1] + i, cfg.projection[i] ?? 0);
} });
const host = {
    resolveText(off) { kit.push("source", mem.read32(0x8005cca8) + off); return UI.source; },
    rosterSlot(pos) { kit.push("roster", pos); return cfg.roster(pos); },
    rosterHandle(slot) { kit.push("handle", slot); return UI.block; },
    copyProjection(slot, dest) { kit.push("projection", slot); for (let i = 0; i < 0x2c; i++) mem.write8(dest + i, cfg.projection[i] ?? 0); },
    createTextElement() { return 0; },
    widgetSetLine0(w, s, i) { kit.push("set", w, s, i); },
    widgetSetLineNumber(w, l, v) { kit.push("number", w, l, v); },
    widgetSetC0(w, c) { kit.push("colour", w, c); },
    widgetSetFlagC1(w, v) { kit.push("show", w, v); },
    widgetMeasure(w, v) { kit.push("measure", w, v); },
};
// The original's measure method is +0x148 (the shared table calls it "waiting"/"measure"): install it.
for (let k = 0; k < 28; k++) {
    const w = ui.widgetAt(k);
    mem.write32(w + 0x148, kit.stub("measure", 0, { args: 2 }));
}
const ranges = [[SCREEN, 0x80], [HUD, 0x80]];
const projOf = (r, a) => { const p = new Array(0x2c).fill(0); for (let i = 0; i < 0x2c; i += 2) { const v = a[(i >> 1) % a.length](r); p[i] = v & 0xff; p[i + 1] = (v >> 8) & 0xff; } return p; };

function seed(c) {
    return () => {
        const r = rng(c.seed);
        kit.fill(SCREEN, 0x80, () => 0); kit.fill(HUD, 0x80, () => 0); kit.fill(SNAP, 0x30, () => 0);
        mem.write32(SCREEN + 0x24, HUD); mem.write32(SCREEN + 0x68, c.pod ?? 1); mem.write16(SCREEN + 0x50, 0x1000);
        for (let k = 0; k < 28; k++) mem.write32(HUD + k * 4, ui.widgetAt(k));
        cfg.projection = c.projection;
        for (let i = 0; i < 0x2c; i += 2) mem.write16(SNAP + i, c.snapshot[i >> 1]);
    };
}

test("gymHudDeltaFill matches F0x80084370", () => {
    for (let n = 0; n < 300; n++) {
        const r = rng(n);
        const pick = (...v) => v[(r() * v.length) | 0];
        const vals = [0, 1, 5, 99, 100, 101, 299, 300, 999, 1200];
        const projection = projOf(r, Array.from({ length: 22 }, () => () => pick(...vals)));
        // Flags at 0x26/0x28/0x2A are the conditional-stat marks.
        for (const off of [0x26, 0x28, 0x2a]) { const v = pick(0, 1); projection[off] = v; projection[off + 1] = 0; }
        const snapshot = Array.from({ length: 22 }, (_, i) => pick(...vals));
        for (const snap of [0, SNAP]) {
            kit.compare(`delta ${n} ${snap ? "snapshot" : "refill"}`, {
                seed: seed({ seed: n, projection, snapshot, pod: pick(0, 1, 2) }), ranges, ret: false,
                original: () => kit.call(0x80084370, [SCREEN, snap], 400000),
                port: () => gymHudDeltaFill(mem, SCREEN, snap, host, PROJ),
            });
        }
    }
});
