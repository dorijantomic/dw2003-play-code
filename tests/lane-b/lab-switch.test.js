// Oracle: engine/dw3/ui/native/lab-switch.ts must match the original pro/stgdglab Switch Digimon
// screen: F0x8008C230 (create), F0x8008C060 (lifecycle), F0x8008A92C (texts), F0x8008AD18 (hide),
// F0x8008AD98 (draw) and F0x8008B798 (tick). Each case reseeds a fresh generator so the original and
// the port start from the same memory and receive the same answers.
import { test } from "node:test";
import { createLabKit, installLab, rng } from "./lab-kit.js";
import {
    labSwitchCreate, labSwitchLifecycle, labSwitchTexts, labSwitchHide, labSwitchDraw, labSwitchTick,
} from "../../engine/dw3/ui/native/lab-switch.ts";

const kit = createLabKit();
const mem = kit.mem;
const SELF = 0x80150000;
const AUX = 0x80151000;
const ROOT = 0x80152000;
const RECORD = 0x80153000;
const NEW = 0x80154000;
const ROSTER = 0x80158000;
const cfg = {};
const lab = installLab(kit, cfg);
const host = lab.host;

function seed(s) {
    const r = rng(s);
    const pick = (n) => Math.floor(r() * n);
    const half = () => pick(0x10000);
    kit.fill(SELF, 0x110, () => 0); kit.fill(AUX, 0x40, () => 0); kit.fill(ROOT, 0x80, () => 0); kit.fill(NEW, 0x180, () => 0);
    kit.fill(ROSTER, 0x180, () => 0);
    lab.methods(SELF, "task");
    lab.methods(ROOT, { 0x68: 0, 0x6c: 0, 0x70: 0, 0x74: 0 });
    const w = (off, v) => mem.write32(SELF + off, v >>> 0);
    mem.write32(SELF + 0x24, AUX); w(0x20, 0xe); w(0x50, ROOT);
    mem.write32(ROOT + 0x5c, pick(5)); mem.write32(ROOT + 0x60, pick(4)); mem.write32(ROOT + 0x64, pick(3));
    w(0x0c, [0, 1, 1, 1, 2, 3, 4, -1][pick(8)]);
    w(0x10, pick(13)); w(0x14, pick(3));
    w(0x54, 0x1000); w(0x58, 2); w(0x5c, pick(2)); w(0x60, pick(5));
    for (const f of [0x64, 0x74, 0x84, 0x94, 0xa4]) { w(f, 8); w(f + 4, pick(0x1000)); w(f + 8, [0, 0x1000, 0x1000, pick(0x1000)][pick(4)]); w(f + 0xc, pick(2)); }
    w(0xc4, pick(30)); w(0xc8, pick(30)); for (let i = 0; i < 3; i++) w(0xcc + 4 * i, pick(8)); w(0xd8, pick(8)); w(0xdc, pick(5)); w(0xe0, pick(7));
    const count = pick(9);
    for (let i = 0; i < 8; i++) w(0xe4 + 4 * i, r() < 0.25 ? -1 : pick(8));
    w(0x104, count);
    let k = 0;
    for (let off = 0; off < 0x38; off += 4) if (off !== 0x34 && pick(5)) mem.write32(AUX + off, lab.widget(k++));
    // The prompt widget exists from phase 2 on (phase 1 creates it); the original calls through null otherwise.
    if (!(mem.read32(SELF + 0x10) === 1 && pick(2) === 0)) mem.write32(AUX + 0x30, lab.widget(30));
    else mem.write32(AUX + 0x30, 0);
    if (pick(2)) { mem.write32(AUX + 0x34, ROSTER); mem.write32(ROSTER + 0x10, pick(4)); }
    for (let i = 0; i < 8; i++) mem.write32(0x80048d34 + i * 0x3dc + 0x760, r() < 0.5 ? 3 + pick(8) : 0);
    cfg.pressed = half() & half(); cfg.held = half() & half(); cfg.repeat = half() & half();
    cfg.frame = pick(60);
    const foldMask = pick(8);
    cfg.fold = (t) => ((t >>> 4) + foldMask) & 1;
    const live = pick(3) ? 1 : 0;
    cfg.method = (t, slot) => (t === ROOT && slot === 0x70 ? live : 0);
    const followers = [0, 1, 2].map(() => (r() < 0.35 ? -1 : pick(8)));
    cfg.follower = (p) => followers[p] ?? -1;
    const partners = [0, 1, 2].map(() => (r() < 0.35 ? -1 : pick(8)));
    cfg.partner = (p) => partners[p] ?? -1;
    cfg.effective = (slot, out) => { for (let i = 0; i < 0x2c; i += 2) mem.write16(out + i, half()); };
    cfg.record = () => RECORD;
    cfg.allocs = [NEW];
    cfg.created = null;
    lab.reset();
}
const ranges = [[SELF, 0x110], [AUX, 0x40], [ROOT, 0x80], [NEW, 0x180], [0x80048d34 + 0x70, 12]];
const cases = (n, fn) => { for (let i = 0; i < n; i++) fn(i, 0x5000 + i); };
const run = (label, s, original, port, ret = false) =>
    kit.compare(label, { seed: () => seed(s), original, port, ranges, ret });

test("labSwitchCreate matches F0x8008C230", () => {
    run("create", 1, () => kit.call(0x8008c230, [ROOT]), () => labSwitchCreate(mem, host, ROOT));
});

test("labSwitchTexts and labSwitchHide match F0x8008A92C / F0x8008AD18", () => {
    cases(300, (n, s) => {
        run(`texts ${n}`, s, () => { mem.write32(AUX + 0x30, lab.widget(30)); return kit.call(0x8008a92c, [SELF, AUX]); }, () => { mem.write32(AUX + 0x30, lab.widget(30)); labSwitchTexts(mem, SELF, AUX, host); });
        run(`hide ${n}`, s, () => kit.call(0x8008ad18, [SELF]), () => labSwitchHide(mem, SELF, host));
    });
});

test("labSwitchDraw matches F0x8008AD98", () => {
    cases(400, (n, s) => run(`draw ${n}`, s, () => kit.call(0x8008ad98, [SELF]), () => labSwitchDraw(mem, SELF, host)));
});

test("labSwitchTick matches F0x8008B798 across phases, pads and folds", () => {
    const reached = new Set();
    cases(2500, (n, s) => {
        run(`tick ${n}`, s, () => kit.call(0x8008b798, [SELF, AUX]), () => labSwitchTick(mem, SELF, AUX, host));
        for (const [name, a] of kit.log) {
            if (name === "play") reached.add(`play ${a.toString(16)}`);
            if (name === "alloc") reached.add("roster");
        }
    });
    for (const need of ["play 4001b", "play 4001c", "play 800450bd", "roster"]) {
        if (!reached.has(need)) throw new Error(`the random cases never reached ${need}`);
    }
});

test("labSwitchLifecycle matches F0x8008C060 (build, tick and draw)", () => {
    cases(800, (n, s) => run(`lifecycle ${n}`, s, () => kit.call(0x8008c060, [SELF, AUX]), () => labSwitchLifecycle(mem, SELF, AUX, host)));
});
