// Oracle: engine/dw3/ui/native/lab-select-labels.ts must match the original pro/stgdglab Select Action
// pane labels F0x80088808 and pane methods F0x800886DC (show) and F0x80088718 (hide).
import { test } from "node:test";
import { createLabKit, installLab, rng } from "./lab-kit.js";
import { labSelectLabels, labSelectShow, labSelectHide } from "../../engine/dw3/ui/native/lab-select-labels.ts";

const kit = createLabKit();
const mem = kit.mem;
const PANE = 0x80150000;
const AUX = 0x80151000;
const ROOT = 0x80152000;
const RECORD = 0x80153000;
const cfg = {};
const lab = installLab(kit, cfg);
const host = lab.host;

function seed(s) {
    const r = rng(s);
    const pick = (n) => Math.floor(r() * n);
    kit.fill(PANE, 0x120, () => 0); kit.fill(AUX, 0x60, () => 0); kit.fill(ROOT, 0x80, () => 0);
    lab.methods(PANE, "task");
    mem.write32(PANE + 0x24, AUX); mem.write32(PANE + 0x50, ROOT);
    mem.write32(PANE + 0x58, 0x1000 + pick(3)); mem.write32(PANE + 0x5c, 2); mem.write32(PANE + 0x0c, pick(4));
    for (let o = 0xfc; o <= 0x10c; o += 4) mem.write32(PANE + o, 1 + pick(9));
    mem.write32(ROOT + 0x64, pick(3));
    // Some labels exist already, some not.
    let k = 0;
    for (const off of [0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c, 0x30, 0x34, 0x38, 0x3c, 0x40]) {
        if (pick(2)) mem.write32(AUX + off, lab.widget(k++));
    }
    cfg.partner = () => (pick(3) === 0 ? -1 : pick(8));
    const sticky = (cfg.partner(0) | 0) < 0 ? -1 : pick(8);
    cfg.partner = () => sticky;
    cfg.effective = (slot, out) => { for (let i = 0; i < 0x2c; i += 2) mem.write16(out + i, pick(0x10000)); };
    cfg.record = () => RECORD;
    cfg.method = () => 0;
    cfg.created = null;
    lab.reset();
}
const ranges = [[PANE, 0x120], [AUX, 0x60]];
const run = (label, s, original, port) => kit.compare(label, { seed: () => seed(s), original, port, ranges, ret: false });

test("labSelectLabels matches F0x80088808", () => {
    for (let n = 0; n < 400; n++) run(`labels ${n}`, 0x3000 + n, () => kit.call(0x80088808, [PANE, AUX]), () => labSelectLabels(mem, PANE, AUX, host));
});

test("labSelectShow and labSelectHide match F0x800886DC / F0x80088718", () => {
    for (let n = 0; n < 100; n++) {
        run(`show ${n}`, 0x4000 + n, () => kit.call(0x800886dc, [PANE]), () => labSelectShow(mem, PANE, host));
        run(`hide ${n}`, 0x4000 + n, () => kit.call(0x80088718, [PANE]), () => labSelectHide(mem, PANE, host));
    }
});
