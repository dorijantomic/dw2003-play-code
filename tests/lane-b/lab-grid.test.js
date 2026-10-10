// Oracle: engine/dw3/ui/native/lab-grid.ts must match the original pro/stgdglab form grid:
// F0x80087018 (create), F0x80085470 (texts), F0x80085730 (fill), F0x80085C50 (slot fill) and
// F0x80085DD0 (tick and pictures). Each case reseeds a fresh generator so the original and the port
// start from the same memory and receive the same answers.
import { test } from "node:test";
import { createLabKit, installLab, rng } from "./lab-kit.js";
import {
    labGridCreate, labGridTexts, labGridFill, labGridSlotFill, labGridTick,
} from "../../engine/dw3/ui/native/lab-grid.ts";

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
    kit.fill(SELF, 0x108, () => 0); kit.fill(AUX, 0xa8, () => 0); kit.fill(NEW, 0x180, () => 0);
    kit.fill(PROFILE, 0x100, () => pick(0x100000000));
    lab.methods(SELF, "task");
    const w = (off, v) => mem.write32(SELF + off, v >>> 0);
    mem.write32(SELF + 0x24, AUX); w(0x20, 0x28);
    w(0x0c, [0, 1, 1, 1, 1, 2, 3, 4, -1][pick(9)]);
    w(0x10, pick(8)); w(0x14, pick(2));
    w(0x50, 0x1000); w(0x54, 6); w(0x58, pick(8)); w(0x5c, pick(3));
    w(0x60, pick(2)); w(0x64, pick(5)); w(0x68, pick(8)); w(0x6c, pick(30)); w(0x70, pick(2));
    const formOf = () => (r() < 0.2 ? pick(3) : 3 + pick(0x188));
    for (let e = 0; e < 3; e++) mem.write16(SELF + 0x74 + 2 * e, r() < 0.2 ? 0 : formOf());
    const count = pick(0x1d);
    w(0xd8, count);
    for (let i = 0; i < 0x2c; i++) mem.write16(SELF + 0x7a + 2 * i, i < count ? formOf() : 0);
    for (const f of [0xdc, 0xec]) { w(f, 8); w(f + 4, pick(0x1000)); w(f + 8, [0, 0x1000, 0x1000, pick(0x1000)][pick(4)]); w(f + 0xc, pick(2)); }
    w(0xfc, pick(5));
    for (let k = 0; k < 0x28; k++) mem.write32(AUX + k * 4, lab.widget(k));
    mem.write32(AUX + 0x94, lab.icon(0)); mem.write32(AUX + 0x98, lab.icon(1));
    if (pick(2) === 0 && mem.read32(SELF + 0x0c) !== 1) for (let k = 0; k < 0x28; k++) mem.write32(AUX + k * 4, 0);
    for (let i = 0; i < 8; i++) mem.write32(0x80049490 + i * 0x3dc + 8, r() < 0.4 ? mem.read16(SELF + 0x74 + 2 * pick(3)) : (r() < 0.5 ? 3 + pick(0x188) : half()));
    cfg.pressed = half() & half(); cfg.held = half() & half(); cfg.repeat = half() & half();
    cfg.frame = pick(40);
    const foldMask = pick(8);
    cfg.fold = (t) => ((t >>> 4) + foldMask) & 1;
    cfg.method = () => 0;
    cfg.profile = () => PROFILE;
    cfg.allocs = [NEW];
    cfg.created = null; cfg.cursors = null;
    cfg.effective = (slot, out) => { for (let i = 0; i < 0x2c; i += 2) mem.write16(out + i, r() < 0.2 ? 0 : (r() < 0.5 ? pick(0x400) : half())); };
    cfg.equipped = (slot, out) => { for (let i = 0; i < 3; i++) mem.write16(out + i * 2, r() < 0.3 ? pick(4) : 3 + pick(0x188)); };
    cfg.acquiredFill = (slot, out) => {
        const n = pick(0x1d);
        for (let i = 0; i < 0x2c; i++) mem.write16(out + i * 2, i < n ? formOf() : 0);
        cfg.lastAcquired = n;
    };
    cfg.acquired = () => cfg.lastAcquired ?? 0;
    cfg.entryFill = (slot, form, out) => {
        for (let i = 0; i < 0x14; i += 2) mem.write16(out + i, r() < 0.3 ? 0 : (r() < 0.5 ? pick(0x4000) : half()));
        mem.write8(out + 2, pick(256));
    };
    lab.reset();
}
const ranges = [[SELF, 0x108], [AUX, 0xa8], [NEW, 0x180], [0x80049490, 0x3dc * 8 + 12]];
const cases = (n, fn) => { for (let i = 0; i < n; i++) fn(i, 0x6000 + i); };
const run = (label, s, original, port, ret = false) =>
    kit.compare(label, { seed: () => seed(s), original, port, ranges, ret });

test("labGridCreate matches F0x80087018", () => {
    cases(5, (n, s) => run(`create ${n}`, s, () => kit.call(0x80087018, [n, n * 2]), () => labGridCreate(mem, host, n, n * 2)));
});

const populate = () => { for (let k = 0; k < 0x28; k++) mem.write32(AUX + k * 4, lab.widget(k)); mem.write32(AUX + 0x94, lab.icon(0)); mem.write32(AUX + 0x98, lab.icon(1)); };
test("labGridTexts, labGridFill and labGridSlotFill match F0x80085470 / 85730 / 85C50", () => {
    cases(250, (n, s) => {
        run(`texts ${n}`, s, () => kit.call(0x80085470, [SELF, AUX]), () => labGridTexts(mem, SELF, AUX, host));
        run(`fill ${n}`, s, () => { populate(); return kit.call(0x80085730, [SELF, AUX, n % 4 === 0 ? 0 : 1]); }, () => { populate(); labGridFill(mem, SELF, AUX, n % 4 === 0 ? 0 : 1, host); });
        run(`slot ${n}`, s, () => { populate(); return kit.call(0x80085c50, [SELF, AUX, n % 4 === 0 ? 0 : 1]); }, () => { populate(); labGridSlotFill(mem, SELF, AUX, n % 4 === 0 ? 0 : 1, host); });
    });
});

test("labGridTick matches F0x80085DD0 across phases, pads and folds", () => {
    const reached = new Set();
    cases(3000, (n, s) => {
        run(`tick ${n}`, s, () => kit.call(0x80085dd0, [SELF, AUX]), () => labGridTick(mem, SELF, AUX, host));
        for (const [name, a] of kit.log) {
            if (name === "play") reached.add(`play ${a.toString(16)}`);
            if (name === "setEquipped") reached.add("setEquipped");
            if (name === "createText") reached.add("build");
        }
    });
    for (const need of ["play 8004513e", "play 8004503c", "play 800450bd", "setEquipped", "build"]) {
        if (!reached.has(need)) throw new Error(`the random cases never reached ${need}`);
    }
});
