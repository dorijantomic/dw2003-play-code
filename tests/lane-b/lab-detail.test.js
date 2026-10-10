// Oracle: engine/dw3/ui/native/lab-detail.ts must match the original pro/stgdglab Digivolve screen:
// F0x80088694 (create), F0x800885EC (lifecycle), F0x80087070 (texts), F0x80087248 (fill),
// F0x80087600 (tick) and F0x8008820C (draw). The grid and chooser constructors it calls run as real
// overlay code in the original and as the registered ports in the port's host.
import { test } from "node:test";
import { createLabKit, installLab, rng } from "./lab-kit.js";
import {
    labDetailCreate, labDetailLifecycle, labDetailTexts, labDetailFill, labDetailTick, labDetailDraw,
} from "../../engine/dw3/ui/native/lab-detail.ts";
import { labGridCreate } from "../../engine/dw3/ui/native/lab-grid.ts";
import { labChooserCreate } from "../../engine/dw3/ui/native/lab-chooser.ts";

const kit = createLabKit();
const mem = kit.mem;
const SELF = 0x80150000;
const AUX = 0x80151000;
const ROOT = 0x80152000;
const PROFILE = 0x80153000;
const NEW = 0x80154000;
const ROSTER = 0x80158000;
const cfg = {};
const lab = installLab(kit, cfg);
const host = {
    ...lab.host,
    createGrid(slot, row) { return labGridCreate(mem, lab.host, slot, row); },
    createChooser(slot, row) { return labChooserCreate(mem, lab.host, slot, row); },
};

const PHASES = [0, 1, 2, 3, 4, 0x28, 0x29, 0x2a, 0xa, 0xb, 0xc, 0x14, 0x15, 0x16, 0x1e, 0x1f, 0x20, 0x32, 0x33, 0x34, 5, 9, 0x21, 0x40];

function seed(s) {
    const r = rng(s);
    const pick = (n) => Math.floor(r() * n);
    const half = () => pick(0x10000);
    kit.fill(SELF, 0x138, () => 0); kit.fill(AUX, 0x68, () => 0); kit.fill(ROOT, 0x80, () => 0); kit.fill(NEW, 0x180, () => 0);
    kit.fill(ROSTER, 0x180, () => 0);
    kit.fill(PROFILE, 0x100, () => pick(0x100000000));
    lab.methods(SELF, "task");
    lab.methods(ROOT, { 0x68: 0, 0x6c: 0, 0x70: 0 });
    const w = (off, v) => mem.write32(SELF + off, v >>> 0);
    mem.write32(SELF + 0x24, AUX); w(0x20, 0x18); w(0x50, ROOT);
    mem.write32(ROOT + 0x64, pick(3));
    w(0x0c, [0, 1, 1, 1, 1, 2, 3, 4, -1][pick(9)]);
    w(0x10, PHASES[pick(PHASES.length)]); w(0x14, [0, 1, 0xa, 0x14][pick(4)]);
    for (const f of [0x54, 0x64, 0x74, 0x84, 0x94, 0xa4]) { w(f, 8); w(f + 4, pick(0x1000)); w(f + 8, [0, 0x1000, 0x1000, pick(0x1000)][pick(4)]); w(f + 0xc, pick(2)); }
    w(0xb4, 0x1000); w(0xb8, 6); w(0xbc, pick(2)); w(0xc8, pick(3));
    for (let e = 0; e < 3; e++) mem.write16(SELF + 0xcc + 2 * e, r() < 0.25 ? pick(3) : 3 + pick(0x188));
    w(0x12c, pick(7));
    for (let k = 0; k < 0x13; k++) mem.write32(AUX + k * 4, lab.widget(k));
    mem.write32(AUX + 0x4c, pick(2) ? lab.widget(19) : 0);
    mem.write32(AUX + 0x50, lab.icon(0));
    // Child objects: the roster picker (phases that touch it must have it) and the grid and chooser slots.
    const phase = mem.read32(SELF + 0x10);
    const needsRoster = [0x29, 0xa, 0x14, 0x34].includes(phase);
    if (needsRoster || (pick(2) && phase !== 0x28)) {
        lab.methods(ROSTER, { 0x170: 0 });
        mem.write32(ROSTER + 0x10, pick(7)); mem.write32(ROSTER + 0x160, pick(3));
        mem.write32(AUX + 0x54, ROSTER);
    }
    mem.write32(AUX + 0x58, pick(2) ? 0 : lab.widget(33));
    mem.write32(AUX + 0x5c, pick(2) ? 0 : lab.widget(34));
    if (phase === 0x1f || phase === 0x20 || phase === 0x33 || phase === 0x34) mem.write32(AUX + 0x4c, lab.widget(35));
    for (let i = 0; i < 8; i++) mem.write32(0x80049490 + i * 0x3dc + 8, r() < 0.4 ? mem.read16(SELF + 0xcc + 2 * pick(3)) : 3 + pick(0x188));
    cfg.pressed = half() & half(); cfg.held = half() & half(); cfg.repeat = half() & half();
    cfg.frame = pick(40);
    const foldMask = pick(8);
    cfg.fold = (t) => ((t >>> 4) + foldMask) & 1;
    const live = pick(3) ? 1 : 0;
    cfg.method = (t, slot) => (t === ROOT && slot === 0x70 ? live : 0);
    const partners = [0, 1, 2].map(() => pick(8));
    cfg.partner = (p) => partners[p] ?? 0;
    cfg.profile = () => PROFILE;
    cfg.allocs = [NEW, NEW, NEW];
    cfg.created = null; cfg.cursors = null;
    cfg.effective = (slot, out) => { for (let i = 0; i < 0x2c; i += 2) mem.write16(out + i, r() < 0.2 ? 0 : (r() < 0.5 ? pick(0x400) : half())); };
    cfg.equipped = (slot, out) => { for (let i = 0; i < 3; i++) mem.write16(out + i * 2, r() < 0.25 ? pick(3) : 3 + pick(0x188)); };
    cfg.acquiredFill = (slot, out) => {
        const n = pick(0x1d);
        for (let i = 0; i < 0x2c; i++) mem.write16(out + i * 2, i < n ? 3 + pick(0x188) : 0);
        cfg.lastAcquired = n;
    };
    cfg.acquired = () => cfg.lastAcquired ?? 0;
    cfg.entryFill = (slot, form, out) => {
        for (let i = 0; i < 0x14; i += 2) mem.write16(out + i, r() < 0.45 ? 0 : (r() < 0.5 ? pick(0x4000) : half()));
    };
    lab.reset();
}
const ranges = [[SELF, 0x138], [AUX, 0x68], [NEW, 0x180], [ROSTER, 0x20]];
const cases = (n, fn) => { for (let i = 0; i < n; i++) fn(i, 0x8000 + i); };
const populate = () => { for (let k = 0; k < 0x18; k++) mem.write32(AUX + k * 4, lab.widget(k)); mem.write32(AUX + 0x50, lab.icon(0)); };
const run = (label, s, original, port, ret = false) =>
    kit.compare(label, { seed: () => seed(s), original, port, ranges, ret });

test("labDetailCreate matches F0x80088694", () => {
    run("create", 1, () => kit.call(0x80088694, [ROOT]), () => labDetailCreate(mem, host, ROOT));
});

test("labDetailTexts, labDetailFill and labDetailDraw match F0x80087070 / 87248 / 8820C", () => {
    cases(250, (n, s) => {
        run(`texts ${n}`, s, () => kit.call(0x80087070, [SELF, AUX]), () => labDetailTexts(mem, SELF, AUX, host));
        run(`fill ${n}`, s, () => { populate(); return kit.call(0x80087248, [SELF, AUX, n % 4 === 0 ? 0 : 1]); }, () => { populate(); labDetailFill(mem, SELF, AUX, n % 4 === 0 ? 0 : 1, host); });
        run(`draw ${n}`, s, () => kit.call(0x8008820c, [SELF]), () => labDetailDraw(mem, SELF, host));
    });
});

test("labDetailTick matches F0x80087600 across phases, pads and folds", () => {
    const reached = new Set();
    cases(4000, (n, s) => {
        run(`tick ${n}`, s, () => kit.call(0x80087600, [SELF, AUX]), () => labDetailTick(mem, SELF, AUX, host));
        for (const [name, a] of kit.log) {
            if (name === "play") reached.add(`play ${a.toString(16)}`);
            if (name === "alloc") reached.add("child");
            if (name === "entryCopy") reached.add("entryCopy");
        }
    });
    for (const need of ["play 8004513e", "play 8004503c", "play 800450bd", "child", "entryCopy"]) {
        if (!reached.has(need)) throw new Error(`the random cases never reached ${need} (${[...reached].join(', ')})`);
    }
});

test("labDetailLifecycle matches F0x800885EC (build, tick and draw)", () => {
    cases(800, (n, s) => run(`lifecycle ${n}`, s, () => kit.call(0x800885ec, [SELF, AUX]), () => labDetailLifecycle(mem, SELF, AUX, host)));
});
