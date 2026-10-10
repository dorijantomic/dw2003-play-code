// Oracle: engine/dw3/ui/native/gym-boot.ts must match the original pro/stgtrain entry
// constructor F0x80083AC0, boot task F0x80083930 and panel constructor F0x80086174; and the
// fight report's fade port must match the gym panel's start F0x80085EF4 and tick
// F0x800860C0 (the two overlays carry the same instructions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKit } from "./gym-kit.js";
import { gymEntryCreate, gymBootTick, gymPanelCreate } from "../../engine/dw3/ui/native/gym-boot.ts";
import { reportFadeStart, reportFadeTick } from "../../engine/dw3/ui/native/fight-report-fade.ts";

const kit = createKit();
const SELF = 0x80150000;
const ARR = 0x80150100;
const NEW = 0x80154000;
const ROOT = 0x80155000;
const VIEW = 0x80156000;
const SVC = 0x8004de10;

// The resident factory cell and every display service the boot task calls.
kit.at(0x80014504, "alloc", () => NEW, { args: 3 });
for (const [slot, name, ret, args] of [
    [0x150, "displayReset", 0, 0], [0x154, "displayPacketSize", 0, 1], [0x174, "displayRegion", 0, 4],
    [0x180, "displayLink", 0, 3],
]) kit.cell(SVC + slot, name, ret, { args });
const rect = (p) => [0, 2, 4, 6].map((o) => kit.mem.read16(p + o));
kit.cell(SVC + 0x16c, "displayView", () => VIEW, {
    args: 3, silent: true,
    before: (_c, a) => kit.push("displayView", ...rect(a[0]), a[1], a[2]),
});
kit.mem.write32(VIEW + 0x12c, kit.stub("viewColour", 0, { args: 4 }));
kit.at(0x80085dd8, "createRoot", () => ROOT, { args: 0 });
const M38 = kit.stub("advance", 0, { args: 1 });
const M28 = kit.stub("setState", 0, { args: 2 });

const host = {
    alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; },
    displayReset() { kit.push("displayReset"); },
    displayPacketSize(b) { kit.push("displayPacketSize", b); },
    displayRegion(w, h, a, b) { kit.push("displayRegion", w, h, a, b); },
    displayView(r, kind, priority) { kit.push("displayView", r.x, r.y, r.w, r.h, kind, priority); return VIEW; },
    viewColour(v, r, g, b) { kit.push("viewColour", v, r, g, b); },
    displayLink(a, b, c) { kit.push("displayLink", a, b, c); },
    createRoot() { kit.push("createRoot"); return ROOT; },
    advance() { kit.push("advance", SELF); },
};
const ranges = [[SELF, 0x60], [ARR, 0x10], [NEW, 0x80]];
const seed = (c) => () => {
    kit.fill(SELF, 0x60, () => 0); kit.fill(ARR, 0x10, () => 0); kit.fill(NEW, 0x80, () => 0);
    kit.mem.write32(SELF + 0x0c, c.state);
    kit.mem.write32(SELF + 0x38, M38);
    kit.mem.write32(NEW + 0x28, M28);
};

test("gymEntryCreate matches F0x80083AC0", () => {
    kit.compare("entry", {
        seed: seed({ state: 0 }), ranges,
        original: () => kit.call(0x80083ac0, []),
        port: () => gymEntryCreate(host),
    });
});

test("gymBootTick matches F0x80083930 across states", () => {
    for (const state of [0, 1, 2, 3, 4, 5, -1, -7]) {
        kit.compare(`boot ${state}`, {
            seed: seed({ state }), ranges, ret: false,
            original: () => kit.call(0x80083930, [SELF, ARR]),
            port: () => gymBootTick(kit.mem, SELF, ARR, host),
        });
    }
});

test("gymPanelCreate matches F0x80086174", () => {
    kit.compare("panel", {
        seed: seed({ state: 0 }), ranges,
        original: () => kit.call(0x80086174, []),
        port: () => gymPanelCreate(kit.mem, host),
    });
});

// The fight report's fade port is the gym panel's start and tick.
const fadeHost = {
    alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; },
    callMethod(t, slot, args) { kit.push("method", t, slot, ...(slot === 0x38 ? [t] : args)); },
    dimQuad(f) { kit.push("dimQuad", f); },
};
kit.at(0x80085f7c, "dimQuad", 0, { args: 1 });
const FADE = SELF;
const FM28 = kit.stub("method", 0, { silent: true, before: (_c, a) => kit.push("method", a[0], 0x28, a[1]) });
const FM38 = kit.stub("method", 0, { silent: true, before: (_c, a) => kit.push("method", a[0], 0x38, a[0]) });
const fadeSeed = (c) => () => {
    kit.fill(FADE, 0x80, () => 0); kit.fill(NEW, 0x80, () => 0);
    const m28 = FM28, m38 = FM38;
    kit.mem.write32(FADE + 0x28, m28); kit.mem.write32(FADE + 0x38, m38);
    kit.mem.write32(FADE + 0x0c, c.state ?? 0); kit.mem.write32(FADE + 0x10, c.armed ?? 0);
    kit.mem.write32(FADE + 0x58, c.dir ?? 0); kit.mem.write32(FADE + 0x5c, c.level ?? 0);
    kit.mem.write32(FADE + 0x60, c.step ?? 0);
};

test("the gym panel start F0x80085EF4 is reportFadeStart", () => {
    for (const dirn of [0, 1, 2, -1]) for (const frames of [1, 7, 30, 255, 0x100, 0x10000, 0]) {
        kit.compare(`start ${dirn} ${frames}`, {
            seed: fadeSeed({}), ranges: [[FADE, 0x80]], ret: false,
            original: () => kit.call(0x80085ef4, [FADE, dirn, frames]),
            port: () => reportFadeStart(kit.mem, FADE, dirn, frames, fadeHost),
        });
    }
});

test("the gym panel tick F0x800860C0 is reportFadeTick", () => {
    for (const state of [0, 1, 2, 3, 4, -1]) for (const armed of [0, 1]) for (const dirn of [0, 1]) {
        for (const level of [0, 0x100, 0xff00, 0xffff]) for (const step of [0x888, -0x888, 0x2000]) {
            kit.compare(`tick ${state} ${armed} ${dirn} ${level} ${step}`, {
                seed: fadeSeed({ state, armed, dir: dirn, level, step }), ranges: [[FADE, 0x80]], ret: false,
                original: () => kit.call(0x800860c0, [FADE]),
                port: () => reportFadeTick(kit.mem, FADE, fadeHost),
            });
        }
    }
});
