// Oracle: engine/dw3/ui/native/lab-chart.ts must match the original pro/stgdglab Digivolve Chart:
// F0x80085408 (create), F0x80083334 (reload), F0x80083484 (row present), F0x80083550 (page total),
// F0x800835CC (seek first), F0x800841E4 (move row), F0x8008365C (draw) and F0x800842F4 (tick).
// The originals run on the shipped overlay data; every service is a recording stub, and the port's
// host records the same events. Each case reseeds a fresh generator so the original and the port
// start from the same memory and receive the same answers.
import { test } from "node:test";
import { createLabKit, installLab, rng } from "./lab-kit.js";
import {
    labChartCreate, labChartReload, labChartRowPresent, labChartPageTotal, labChartSeekFirst,
    labChartMoveRow, labChartDraw, labChartTick, LAB_SLOT_BLOCKS,
} from "../../engine/dw3/ui/native/lab-chart.ts";

const kit = createLabKit();
const mem = kit.mem;
const CH = 0x80150000;
const AUX = 0x80151000;
const ROOT = 0x80152000;
const PROFILE = 0x80153000;
const NEW = 0x80154000;
const cfg = {};
const lab = installLab(kit, cfg);
const host = lab.host;

/** Every requirement form of every slot's table (the forms a partner could own). */
const formList = (() => {
    const forms = new Set();
    for (let slot = 0; slot < 10; slot++) {
        const table = mem.read32(LAB_SLOT_BLOCKS + slot * 4 + 8);
        for (let i = 0; i < 16 * 4; i++) {
            for (let k = 0; k < 5; k++) { const f = mem.read16s(table + i * 12 + 2 + k * 2); if (f > 0 && f < 0x400) forms.add(f); }
        }
    }
    return [...forms];
})();

function seedChart(seed) {
    const r = rng(seed);
    const pick = (n) => Math.floor(r() * n);
    kit.fill(CH, 0x2a0, () => 0); kit.fill(AUX, 0x20, () => 0); kit.fill(ROOT, 0x80, () => 0); kit.fill(NEW, 0x80, () => 0);
    kit.fill(PROFILE, 0x80, () => pick(256));
    const w = (off, v) => mem.write32(CH + off, v >>> 0);
    lab.methods(CH, "task");
    lab.methods(ROOT, { 0x6c: 0, 0x70: 0 });
    mem.write32(CH + 0x50, ROOT);
    mem.write32(ROOT + 0x64, pick(3));
    w(0x54, 0x1000); w(0x58, 2);
    w(0x0c, [0, 1, 1, 1, 2, 3, -1, 5][pick(8)]);
    w(0x10, pick(10)); w(0x14, pick(6)); w(0x18, pick(2));
    w(0xbc, pick(10));
    const count = pick(9);
    w(0xb8, count);
    for (let i = 0; i < count; i++) mem.write16(CH + 0x60 + i * 2, r() < 0.7 ? formList[pick(formList.length)] : pick(500));
    w(0xc0, pick(4)); w(0xc4, 4); w(0xc8, pick(4)); w(0xcc, pick(5));
    for (let p = 0; p < 4; p++) for (let row = 0; row < 4; row++) for (let e = 0; e < 5; e++) {
        const v = r() < 0.4 ? 0 : (r() < 0.05 ? -1 : formList[pick(formList.length)]);
        w(0xd0 + p * 0x50 + row * 0x14 + e * 4, v);
    }
    for (let p = 0; p < 4; p++) { w(0x210 + p * 4, pick(2)); w(0x220 + p * 4, pick(6)); }
    for (const f of [0x230, 0x240, 0x250, 0x260, 0x270]) {
        w(f, 8); w(f + 4, pick(0x1000)); w(f + 8, [0, 0x1000, 0x1000, pick(0x1000)][pick(4)]); w(f + 0xc, pick(2));
    }
    w(0x280, pick(2)); w(0x284, pick(2)); w(0x288, pick(20)); w(0x28c, pick(5));
    w(0x290, pick(5)); w(0x294, pick(4));
    for (let i = 0; i < 7; i++) mem.write32(AUX + i * 4, lab.widget(i));
    cfg.pressed = pick(0x10000) & pick(0x10000); cfg.held = pick(0x10000) & pick(0x10000); cfg.repeat = pick(0x10000) & pick(0x10000);
    cfg.frame = pick(40);
    const foldMask = pick(8);
    cfg.fold = (t) => ((t >>> 4) + foldMask) & 1;
    cfg.live = pick(4) ? 1 : 0;
    cfg.method = (t, slot) => (t === ROOT && slot === 0x70 ? cfg.live : 0);
    cfg.partner = (p) => p;
    cfg.acquiredFill = (slot, out) => {
        const n = pick(9);
        for (let i = 0; i < 0x2c; i++) mem.write16(out + i * 2, i < n ? formList[pick(formList.length)] : 0);
    };
    cfg.acquired = () => pick(9);
    cfg.record = () => PROFILE;
    cfg.profile = () => PROFILE;
    lab.reset();
}
const ranges = [[CH, 0x2a0], [AUX, 0x20], [ROOT, 0x80], [NEW, 0x80]];
const cases = (n, fn) => { for (let i = 0; i < n; i++) fn(i, 0x1000 + i); };
const run = (label, seed, original, port, ret = false) =>
    kit.compare(label, { seed: () => seedChart(seed), original, port, ranges, ret });

test("labChartCreate matches F0x80085408", () => {
    kit.at(0x80014504, "alloc", () => NEW, { args: 3 });
    kit.compare("create", {
        seed: () => { seedChart(1); kit.fill(NEW, 0x2a0, () => 0); },
        ranges: [[NEW, 0x2a0], [ROOT, 0x80]],
        original: () => kit.call(0x80085408, [ROOT]),
        port: () => labChartCreate(mem, {
            alloc(h, s, e) { kit.push("alloc", h, s, e); return NEW; },
            callMethod(t, slot, args) { kit.push("m", t, slot, ...args); return 0; },
        }, ROOT),
    });
});

test("the row helpers match F0x80083334 / 83484 / 83550 / 835CC", () => {
    cases(300, (n, seed) => {
        const r = rng(seed ^ 0x55);
        const page = Math.floor(r() * 4), group = [0, 1, 2, 3, 4, 5, 9][Math.floor(r() * 7)], row = Math.floor(r() * 4);
        run(`reload ${n}`, seed, () => kit.call(0x80083334, [CH, page, group, row]), () => labChartReload(mem, CH, page, group, row), true);
        run(`present ${n}`, seed, () => kit.call(0x80083484, [CH, page, group]), () => labChartRowPresent(mem, CH, page, group), true);
        run(`total ${n}`, seed, () => kit.call(0x80083550, [CH, page + (n % 3 === 0 ? 3 : 0)]), () => labChartPageTotal(mem, CH, page + (n % 3 === 0 ? 3 : 0)), true);
        run(`seek ${n}`, seed, () => kit.call(0x800835cc, [CH]), () => labChartSeekFirst(mem, CH));
        run(`move ${n}`, seed, () => kit.call(0x800841e4, [CH, [1, -1, 2, -2][n % 4]]), () => labChartMoveRow(mem, CH, [1, -1, 2, -2][n % 4]), true);
    });
});

test("labChartDraw matches F0x8008365C", () => {
    cases(300, (n, seed) => {
        run(`draw ${n}`, seed, () => kit.call(0x8008365c, [CH]), () => labChartDraw(mem, CH, host));
    });
});

test("labChartTick matches F0x800842F4 across states, pads and folds", () => {
    const reached = new Set();
    cases(1500, (n, seed) => {
        run(`tick ${n}`, seed, () => kit.call(0x800842f4, [CH, AUX]), () => labChartTick(mem, CH, AUX, host));
        for (const [name, a, b] of kit.log) {
            if (name === "play") reached.add(`play ${a.toString(16)}`);
            if (name === "createText") reached.add("init");
            if (name === "m" && b === 0x28) reached.add("close");
        }
    });
    // The random cases must reach the moves, the confirm, the back key and the build, or they prove little.
    for (const need of ["play 4001b", "play 4001c", "play 800450bd", "init", "close"]) {
        if (!reached.has(need)) throw new Error(`the random cases never reached ${need}`);
    }
});
