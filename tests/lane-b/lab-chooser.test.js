// Oracle: engine/dw3/ui/native/lab-chooser.ts must match the original pro/stgdglab technique chooser:
// F0x8008D774 (create), F0x8008C278 (texts), F0x8008C4EC (fill) and F0x8008C960 (tick and pictures).
// Each case reseeds a fresh generator so the original and the port start from the same memory and
// receive the same answers.
import { test } from "node:test";
import { createLabKit, installLab, rng } from "./lab-kit.js";
import { labChooserCreate, labChooserTexts, labChooserFill, labChooserTick } from "../../engine/dw3/ui/native/lab-chooser.ts";

const kit = createLabKit();
const mem = kit.mem;
const SELF = 0x80150000;
const AUX = 0x80151000;
const PROFILE = 0x80153000;
const NEW = 0x80154000;
const cfg = {};
const lab = installLab(kit, cfg);
const host = lab.host;

function seed(s) {
    const r = rng(s);
    const pick = (n) => Math.floor(r() * n);
    const half = () => pick(0x10000);
    kit.fill(SELF, 0xb0, () => 0); kit.fill(AUX, 0x60, () => 0); kit.fill(NEW, 0x180, () => 0);
    kit.fill(PROFILE, 0x100, () => pick(0x100000000));
    lab.methods(SELF, "task");
    const w = (off, v) => mem.write32(SELF + off, v >>> 0);
    mem.write32(SELF + 0x24, AUX); w(0x20, 0x17);
    w(0x0c, [0, 1, 1, 1, 1, 2, 3, 4, -1][pick(9)]);
    w(0x10, [0, 1, 1, 1, 5, 6, 7, 10, 11, 20, 21, 30, 40, 2, 3, 9, 41][pick(17)]); w(0x14, [0, 0xa, 0x14][pick(3)]);
    for (const f of [0x50, 0x60]) { w(f, 8); w(f + 4, pick(0x1000)); w(f + 8, [0, 0x1000, 0x1000, pick(0x1000)][pick(4)]); w(f + 0xc, pick(2)); }
    w(0x70, 0x1000); w(0x74, 2); w(0x78, pick(8)); w(0x7c, pick(3));
    for (let e = 0; e < 3; e++) mem.write16(SELF + 0x80 + 2 * e, 3 + pick(0x188));
    mem.write16(SELF + 0x88, r() < 0.15 ? pick(3) : 3 + pick(0x188));
    for (let i = 0; i < 6; i++) mem.write16(SELF + 0x90 + 2 * i, r() < 0.2 ? 0 : (pick(0x100) | (pick(8) << 13)));
    w(0x9c, pick(7)); w(0xa0, pick(2)); w(0xa4, pick(6)); w(0xa8, [6, 6, 6, 0, 3][pick(5)]);
    for (let k = 0; k < 0x17; k++) mem.write32(AUX + k * 4, lab.widget(k));
    mem.write32(AUX + 0x54, lab.icon(0)); mem.write32(AUX + 0x58, lab.icon(1));
    cfg.pressed = half() & half(); cfg.held = half() & half(); cfg.repeat = half() & half();
    cfg.frame = pick(40);
    const foldMask = pick(8);
    cfg.fold = (t) => ((t >>> 4) + foldMask) & 1;
    cfg.method = () => 0;
    cfg.profile = () => PROFILE;
    cfg.allocs = [NEW];
    cfg.created = null; cfg.cursors = null;
    cfg.equipped = (slot, out) => { for (let i = 0; i < 3; i++) mem.write16(out + i * 2, 3 + pick(0x188)); };
    cfg.entryFill = (slot, form, out) => {
        mem.write16(out, r() < 0.15 ? pick(3) : 3 + pick(0x188));
        for (let i = 2; i < 0x14; i += 2) mem.write16(out + i, r() < 0.2 ? 0 : (pick(0x100) | (pick(8) << 13)));
    };
    cfg.writeEntry = () => 0;
    lab.reset();
}
const ranges = [[SELF, 0xb0], [AUX, 0x60], [NEW, 0x180]];
const cases = (n, fn) => { for (let i = 0; i < n; i++) fn(i, 0x7000 + i); };
const populate = () => { for (let k = 0; k < 0x17; k++) mem.write32(AUX + k * 4, lab.widget(k)); mem.write32(AUX + 0x54, lab.icon(0)); mem.write32(AUX + 0x58, lab.icon(1)); };
const run = (label, s, original, port, ret = false) =>
    kit.compare(label, { seed: () => seed(s), original, port, ranges, ret });

test("labChooserCreate matches F0x8008D774", () => {
    cases(5, (n, s) => run(`create ${n}`, s, () => kit.call(0x8008d774, [n, n * 2]), () => labChooserCreate(mem, host, n, n * 2)));
});

test("labChooserTexts and labChooserFill match F0x8008C278 / F0x8008C4EC", () => {
    cases(300, (n, s) => {
        run(`texts ${n}`, s, () => kit.call(0x8008c278, [SELF, AUX]), () => labChooserTexts(mem, SELF, AUX, host));
        run(`fill ${n}`, s, () => { populate(); return kit.call(0x8008c4ec, [SELF, AUX, n % 4 === 0 ? 0 : 1]); }, () => { populate(); labChooserFill(mem, SELF, AUX, n % 4 === 0 ? 0 : 1, host); });
    });
});

test("labChooserTick matches F0x8008C960 across phases, pads and folds", () => {
    const reached = new Set();
    cases(4000, (n, s) => {
        run(`tick ${n}`, s, () => { if (mem.read32(SELF + 0x0c) !== 1 && n % 2) for (let k = 0; k < 0x17; k++) mem.write32(AUX + k * 4, 0); return kit.call(0x8008c960, [SELF, AUX]); },
            () => { if (mem.read32(SELF + 0x0c) !== 1 && n % 2) for (let k = 0; k < 0x17; k++) mem.write32(AUX + k * 4, 0); labChooserTick(mem, SELF, AUX, host); });
        for (const [name, a] of kit.log) {
            if (name === "play") reached.add(`play ${a.toString(16)}`);
            if (name === "writeEntry") reached.add("writeEntry");
        }
    });
    for (const need of ["play 8004513e", "play 8004503c", "play 800450bd", "writeEntry"]) {
        if (!reached.has(need)) throw new Error(`the random cases never reached ${need}`);
    }
});
