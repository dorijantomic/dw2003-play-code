// Oracle: engine/dw3/ui/native/lab-roster.ts and lab-capsule.ts must match the original pro/stgdglab
// roster picker (F0x8008EABC create, F0x8008E8D0 lifecycle, F0x8008D7CC texts, F0x8008D9BC fill,
// F0x8008DFA0 hide, F0x8008E018 tick, F0x8008E4CC draw) and the scroll bar actor (F0x8008A8C4 create,
// F0x8008A670 / 67C / 690 / 6A4 setters, F0x8008A6AC tick). Each case reseeds a fresh generator so the
// original and the port start from the same memory and receive the same answers.
import { test } from "node:test";
import { createLabKit, installLab, rng } from "./lab-kit.js";
import {
    labRosterCreate, labRosterLifecycle, labRosterTexts, labRosterFill, labRosterHide, labRosterTick, labRosterDraw,
} from "../../engine/dw3/ui/native/lab-roster.ts";
import {
    labCapsuleCreate, labCapsuleSetBar, labCapsuleSetTrack, labCapsuleSetCounts, labCapsuleSetTop, labCapsuleTick,
} from "../../engine/dw3/ui/native/lab-capsule.ts";

const kit = createLabKit();
const mem = kit.mem;
const SELF = 0x80150000;
const AUX = 0x80151000;
const PROFILE = 0x80153000;
const NEW = 0x80154000;
const CAP = 0x80156000;
const cfg = {};
const lab = installLab(kit, cfg);
const host = lab.host;
// The capsule setters run as real overlay code inside the original; stub them to record the same call.
for (const [slot, addr, arity] of [[0x8c, 0x8008a670, 2], [0x90, 0x8008a67c, 2], [0x94, 0x8008a690, 2], [0x98, 0x8008a6a4, 1]]) {
    kit.at(addr, "m", 0, { args: arity + 1, silent: true, before: (_c, a) => kit.push("m", a[0], slot, ...a.slice(1)) });
}

const forms = [];
for (let f = 0; f < 0x190; f += 1) forms.push(f);

function seedRoster(seed) {
    const r = rng(seed);
    const pick = (n) => Math.floor(r() * n);
    const half = () => pick(0x10000);
    kit.fill(SELF, 0x180, () => 0); kit.fill(AUX, 0x80, () => 0); kit.fill(NEW, 0x80, () => 0); kit.fill(CAP, 0xa0, () => 0);
    kit.fill(PROFILE, 0x100, () => pick(0x100000000));
    const w = (off, v) => mem.write32(SELF + off, v >>> 0);
    lab.methods(SELF, "task");
    w(0x20, 0x1c); w(0x24, AUX);
    w(0x0c, [0, 1, 1, 1, 2, 3, 4, -1][pick(8)]);
    w(0x10, pick(8));
    w(0x50, pick(2)); w(0x54, pick(8)); w(0x58, 0x1000); w(0x5c, 2);
    for (const f of [0x68, 0x78, 0x88]) w(f, [0, 0x1000, 0x1000, pick(0x1000)][pick(4)]);
    w(0x80, 8); w(0x84, pick(0x1000)); w(0x88, [0, 0x1000, pick(0x1000)][pick(3)]); w(0x8c, pick(2));
    w(0x158, pick(5)); w(0x15c, pick(9)); w(0x160, pick(3)); w(0x164, pick(30)); w(0x168, pick(2)); w(0x16c, pick(2));
    for (let i = 0; i < 0x60 / 4 + 8; i++) w(0x90 + i * 4, r() < 0.15 ? pick(3) : 3 + pick(0x188));
    for (let k = 0; k < 26; k++) mem.write32(AUX + k * 4, lab.widget(k));
    mem.write32(AUX + 0x68, lab.icon(0));
    if (pick(2)) { lab.methods(CAP, "capsule"); mem.write32(AUX + 0x6c, CAP); }
    for (let slot = 0; slot < 8; slot++) mem.write32(0x80049490 + slot * 0x3dc + 8, r() < 0.5 ? 3 + pick(0x188) : half());
    cfg.pressed = half() & half(); cfg.held = half() & half(); cfg.repeat = half() & half();
    cfg.frame = pick(40);
    const foldMask = pick(8);
    cfg.fold = (t) => ((t >>> 4) + foldMask) & 1;
    cfg.method = () => 0;
    cfg.profile = () => PROFILE;
    cfg.created = null; cfg.cursors = null;
    cfg.allocs = [CAP, NEW];
    cfg.effective = (slot, out) => { for (let i = 0; i < 0x2c; i += 2) mem.write16(out + i, r() < 0.2 ? 0 : (r() < 0.5 ? pick(0x400) : half())); };
    cfg.equipped = (slot, out) => { for (let i = 0; i < 3; i++) mem.write16(out + i * 2, r() < 0.3 ? pick(4) : 3 + pick(0x188)); };
    cfg.acquiredFill = (slot, out) => {
        const n = pick(10);
        for (let i = 0; i < 0x2c; i++) mem.write16(out + i * 2, i < n ? (r() < 0.2 ? pick(3) : 3 + pick(0x188)) : 0);
    };
    cfg.acquired = () => 0;
    cfg.entryFill = (slot, form, out) => {
        for (let i = 0; i < 0x14; i += 2) mem.write16(out + i, r() < 0.3 ? 0 : (r() < 0.5 ? pick(0x4000) : half()));
        mem.write8(out + 2, pick(256));
    };
    lab.reset();
}
const ranges = [[SELF, 0x180], [AUX, 0x80], [CAP, 0xa0], [NEW, 0x80]];
const cases = (n, fn) => { for (let i = 0; i < n; i++) fn(i, 0x2000 + i); };
const run = (label, seed, original, port, ret = false) =>
    kit.compare(label, { seed: () => seedRoster(seed), original, port, ranges, ret });

test("labRosterCreate matches F0x8008EABC", () => {
    run("create", 1, () => kit.call(0x8008eabc, [5, 1, 1]), () => labRosterCreate(mem, host, 5, 1, 1));
    cases(10, (n, seed) => {
        run(`create ${n}`, seed, () => kit.call(0x8008eabc, [n, n & 1, 1 - (n & 1)]), () => labRosterCreate(mem, host, n, n & 1, 1 - (n & 1)));
    });
});

test("the scroll bar matches F0x8008A8C4 / 670 / 67C / 690 / 6A4 / 6AC", () => {
    run("capsule create", 3, () => kit.call(0x8008a8c4, []), () => labCapsuleCreate(mem, host));
    // The setters themselves run unstubbed on a second kit.
    const kit2 = createLabKit();
    cases(200, (n, seed) => {
        const r = rng(seed ^ 0x99);
        const a = Math.floor(r() * 0x200) - 0x20, b = Math.floor(r() * 0x200) - 0x20;
        const run2 = (label, original, port) => kit2.compare(label, {
            seed: () => kit2.fill(CAP, 0xa0, () => Math.floor(rng(seed)() * 0x100000000)), ranges: [[CAP, 0xa0]], original, port, ret: false,
        });
        run2(`bar ${n}`, () => kit2.call(0x8008a670, [CAP, a, b]), () => labCapsuleSetBar(kit2.mem, CAP, a, b));
        run2(`track ${n}`, () => kit2.call(0x8008a67c, [CAP, a, b]), () => labCapsuleSetTrack(kit2.mem, CAP, a, b));
        run2(`counts ${n}`, () => kit2.call(0x8008a690, [CAP, a, b]), () => labCapsuleSetCounts(kit2.mem, CAP, a, b));
        run2(`top ${n}`, () => kit2.call(0x8008a6a4, [CAP, a]), () => labCapsuleSetTop(kit2.mem, CAP, a));
    });
    // The tick on randomised bar objects: every field random but sane.
    cases(600, (n, seed) => {
        const prep = () => {
            seedRoster(seed);
            const r = rng(seed ^ 0x1234);
            const pick = (k) => Math.floor(r() * k);
            const w = (o, v) => mem.write32(CAP + o, v >>> 0);
            lab.methods(CAP, "task");
            w(0x0c, [0, 1, 1, 1, 2, 3, 5, -1][pick(8)]);
            w(0x50, 0x1000); w(0x54, pick(3)); w(0x58, pick(0x200)); w(0x60, pick(0x20));
            w(0x6c, pick(8)); w(0x70, [0, 1, 2, 3, 5, 8, 20][pick(7)]); w(0x74, pick(25));
            w(0x78, pick(2)); w(0x68, pick(2)); w(0x7c, pick(0x100)); w(0x80, pick(0x200));
            w(0x64, pick(0x4000)); w(0x88, pick(0x400) - 0x100); w(0x5c, pick(0x100));
        };
        kit.compare(`capsule tick ${n}`, {
            seed: prep, ranges: [[CAP, 0xa0]], ret: false,
            original: () => kit.call(0x8008a6ac, [CAP, 0]), port: () => labCapsuleTick(mem, CAP, host),
        });
    });
});

test("labRosterTexts and labRosterFill match F0x8008D7CC / F0x8008D9BC", () => {
    cases(200, (n, seed) => {
        run(`texts ${n}`, seed, () => kit.call(0x8008d7cc, [SELF, AUX]), () => labRosterTexts(mem, SELF, AUX, host));
        run(`fill ${n}`, seed, () => kit.call(0x8008d9bc, [SELF, AUX, n % 5 === 0 ? 0 : 1]), () => labRosterFill(mem, SELF, AUX, n % 5 === 0 ? 0 : 1, host));
        run(`hide ${n}`, seed, () => kit.call(0x8008dfa0, [SELF]), () => labRosterHide(mem, SELF, host));
    });
});

test("labRosterDraw matches F0x8008E4CC", () => {
    cases(300, (n, seed) => run(`draw ${n}`, seed, () => kit.call(0x8008e4cc, [SELF]), () => labRosterDraw(mem, SELF, host)));
});

test("labRosterTick matches F0x8008E018 across phases, pads and folds", () => {
    const reached = new Set();
    cases(1200, (n, seed) => {
        run(`tick ${n}`, seed, () => kit.call(0x8008e018, [SELF, AUX]), () => labRosterTick(mem, SELF, AUX, host));
        for (const [name, a] of kit.log) {
            if (name === "play") reached.add(`play ${a.toString(16)}`);
            if (name === "alloc") reached.add("capsule");
            if (name === "quad") reached.add("quad");
        }
    });
    for (const need of ["play 8004513e", "play 800450bd", "capsule"]) {
        if (!reached.has(need)) throw new Error(`the random cases never reached ${need}`);
    }
});

test("labRosterLifecycle matches F0x8008E8D0 (build, tick and draw)", () => {
    cases(600, (n, seed) => run(`lifecycle ${n}`, seed, () => kit.call(0x8008e8d0, [SELF, AUX]), () => labRosterLifecycle(mem, SELF, AUX, host)));
});
