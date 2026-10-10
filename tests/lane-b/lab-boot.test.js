// Oracle: engine/dw3/ui/native/lab-boot.ts must match the original pro/stgdglab entry constructor
// F0x80083040, boot task F0x80082F48, fade panel constructor F0x800832EC and the root's four small
// methods F0x8008EEA0 / EEFC / EF58 / EF8C; and the fight report's fade port must match the lab's
// fade start F0x8008306C and tick F0x80083238 (the two overlays carry the same instructions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKit, overlayImage } from "./gym-kit.js";
import {
    labEntryCreate, labBootTick, labFadeCreate, labRootShowPane, labRootHidePane, labRootPaneLive,
    labRootStartFade,
} from "../../engine/dw3/ui/native/lab-boot.ts";
import { reportFadeStart, reportFadeTick } from "../../engine/dw3/ui/native/fight-report-fade.ts";

const kit = createKit(overlayImage("pro_stgdglab.bin"));
const SELF = 0x80150000;
const ARR = 0x80150100;
const NEW = 0x80154000;
const ROOT = 0x80155000;
const VIEW = 0x80156000;
const PANE = 0x80157000;
const EXTRA = 0x80158000;
const SVC = 0x8004de10;

kit.at(0x80014504, "alloc", () => NEW, { args: 3 });
for (const [slot, name, ret, args] of [
    [0x150, "displayReset", 0, 0], [0x154, "displayPacketSize", 0, 1], [0x174, "displayRegion", 0, 4],
]) kit.cell(SVC + slot, name, ret, { args });
const rect = (p) => [0, 2, 4, 6].map((o) => kit.mem.read16(p + o));
kit.cell(SVC + 0x16c, "displayView", () => VIEW, {
    args: 3, silent: true,
    before: (_c, a) => kit.push("displayView", ...rect(a[0]), a[1], a[2]),
});
kit.mem.write32(VIEW + 0x12c, kit.stub("viewColour", 0, { args: 4 }));
kit.at(0x8008efd0, "createRoot", () => ROOT, { args: 0 });
const M38 = kit.stub("advance", 0, { args: 1 });
const M28 = kit.stub("setState", 0, { args: 2 });

const host = {
    alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; },
    displayReset() { kit.push("displayReset"); },
    displayPacketSize(b) { kit.push("displayPacketSize", b); },
    displayRegion(w, h, a, b) { kit.push("displayRegion", w, h, a, b); },
    displayView(r, kind, priority) { kit.push("displayView", r.x, r.y, r.w, r.h, kind, priority); return VIEW; },
    viewColour(v, r, g, b) { kit.push("viewColour", v, r, g, b); },
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

test("labEntryCreate matches F0x80083040", () => {
    kit.compare("entry", {
        seed: seed({ state: 0 }), ranges,
        original: () => kit.call(0x80083040, []),
        port: () => labEntryCreate(host),
    });
});

test("labBootTick matches F0x80082F48 across states", () => {
    for (const state of [0, 1, 2, 3, 4, 5, -1, -7]) {
        kit.compare(`boot ${state}`, {
            seed: seed({ state }), ranges, ret: false,
            original: () => kit.call(0x80082f48, [SELF, ARR]),
            port: () => labBootTick(kit.mem, SELF, ARR, host),
        });
    }
});

test("labFadeCreate matches F0x800832EC", () => {
    kit.compare("fade", {
        seed: seed({ state: 0 }), ranges,
        original: () => kit.call(0x800832ec, []),
        port: () => labFadeCreate(kit.mem, host),
    });
});

// The report fade's start and tick are the lab's.
const fadeHost = {
    alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; },
    callMethod(t, slot, args) { kit.push("method", t, slot, ...(slot === 0x38 ? [t] : args)); },
    dimQuad(f) { kit.push("dimQuad", f); },
};
kit.at(0x800830f4, "dimQuad", 0, { args: 1 });
const FADE = SELF;
const FM28 = kit.stub("method", 0, { silent: true, before: (_c, a) => kit.push("method", a[0], 0x28, a[1]) });
const FM38 = kit.stub("method", 0, { silent: true, before: (_c, a) => kit.push("method", a[0], 0x38, a[0]) });
const fadeSeed = (c) => () => {
    kit.fill(FADE, 0x80, () => 0); kit.fill(NEW, 0x80, () => 0);
    kit.mem.write32(FADE + 0x28, FM28); kit.mem.write32(FADE + 0x38, FM38);
    kit.mem.write32(FADE + 0x0c, c.state ?? 0); kit.mem.write32(FADE + 0x10, c.armed ?? 0);
    kit.mem.write32(FADE + 0x58, c.dir ?? 0); kit.mem.write32(FADE + 0x5c, c.level ?? 0);
    kit.mem.write32(FADE + 0x60, c.step ?? 0);
};

test("the lab fade start F0x8008306C is reportFadeStart", () => {
    for (const dirn of [0, 1, 2, -1]) for (const frames of [1, 7, 30, 255, 0x100, 0x10000, 0]) {
        kit.compare(`start ${dirn} ${frames}`, {
            seed: fadeSeed({}), ranges: [[FADE, 0x80]], ret: false,
            original: () => kit.call(0x8008306c, [FADE, dirn, frames]),
            port: () => reportFadeStart(kit.mem, FADE, dirn, frames, fadeHost),
        });
    }
});

test("the lab fade tick F0x80083238 is reportFadeTick", () => {
    for (const state of [0, 1, 2, 3, 4, -1]) for (const armed of [0, 1]) for (const dirn of [0, 1]) {
        for (const level of [0, 0x100, 0xff00, 0xffff]) for (const step of [0x888, -0x888, 0x2000]) {
            kit.compare(`tick ${state} ${armed} ${dirn} ${level} ${step}`, {
                seed: fadeSeed({ state, armed, dir: dirn, level, step }), ranges: [[FADE, 0x80]], ret: false,
                original: () => kit.call(0x80083238, [FADE]),
                port: () => reportFadeTick(kit.mem, FADE, fadeHost),
            });
        }
    }
});

// The root's four small methods.
const PM114 = kit.stub("method", 0, { silent: true, before: (_c, a) => kit.push("method", a[0], 0x114) });
const PM118 = kit.stub("method", 0, { silent: true, before: (_c, a) => kit.push("method", a[0], 0x118) });
const rootSeed = (c) => () => {
    kit.fill(ROOT, 0x80, () => 0); kit.fill(EXTRA, 0x20, () => 0); kit.fill(PANE, 0x200, () => 0); kit.fill(NEW, 0x80, () => 0);
    kit.mem.write32(ROOT + 0x24, EXTRA);
    kit.mem.write32(EXTRA, c.pane ? PANE : 0);
    kit.mem.write32(PANE + 0x0c, c.state);
    kit.mem.write32(PANE + 0x114, PM114); kit.mem.write32(PANE + 0x118, PM118);
    kit.mem.write32(NEW + 0x64, 0); kit.mem.write32(NEW + 0x28, M28);
};
const rootHost = {
    callMethod(t, slot, args) { kit.push("method", t, slot, ...args); },
    createFade() { kit.push("createFade"); return NEW; },
};
const FM64 = kit.stub("method", 0, { silent: true, before: (_c, a) => kit.push("method", a[0], 0x64, a[1], a[2]) });

test("the root's pane methods match F0x8008EEA0 / EEFC / EF58", () => {
    for (const pane of [0, 1]) for (const state of [0, 1, 2, 3, -1]) {
        const c = { pane, state };
        kit.compare(`show ${pane} ${state}`, {
            seed: rootSeed(c), ranges: [[ROOT, 0x80], [EXTRA, 0x20], [PANE, 0x20]],
            original: () => kit.call(0x8008eea0, [ROOT]), port: () => labRootShowPane(kit.mem, ROOT, rootHost),
        });
        kit.compare(`hide ${pane} ${state}`, {
            seed: rootSeed(c), ranges: [[ROOT, 0x80], [EXTRA, 0x20], [PANE, 0x20]],
            original: () => kit.call(0x8008eefc, [ROOT]), port: () => labRootHidePane(kit.mem, ROOT, rootHost),
        });
        kit.compare(`live ${pane} ${state}`, {
            seed: rootSeed(c), ranges: [[ROOT, 0x80], [EXTRA, 0x20], [PANE, 0x20]],
            original: () => kit.call(0x8008ef58, [ROOT]), port: () => labRootPaneLive(kit.mem, ROOT),
        });
    }
});

test("the root's fade start matches F0x8008EF8C", () => {
    kit.at(0x800832ec, "createFade", () => NEW, { args: 0 });
    kit.mem.write32(NEW + 0x64, FM64);
    kit.compare("startFade", {
        seed: () => { rootSeed({ pane: 1, state: 1 })(); kit.mem.write32(NEW + 0x64, FM64); },
        ranges: [[ROOT, 0x80], [EXTRA, 0x20], [NEW, 0x80]], ret: false,
        original: () => kit.call(0x8008ef8c, [ROOT]), port: () => labRootStartFade(kit.mem, ROOT, rootHost),
    });
});
