// Oracle: engine/dw3/ui/native/wizard-commit.ts against the resident F0x80016DC0.
import { test } from "node:test";
import { createHarness } from "./helpers/screen-harness.js";
import { commitStarterPack } from "../../engine/dw3/ui/native/wizard-commit.ts";

const h = createHarness({ overlayFile: "pro_stplnmet.bin" });
const PARTY_MAP = 0x80048d34 + 0x70;
const RECORDS = 0x80049494;

test("commitStarterPack matches F0x80016DC0 for every pack", () => {
    for (const pack of [0, 1, 2, 3]) {
        const seed = () => {
            for (let i = 0; i < 3; i++) h.rt.mem.write32(PARTY_MAP + i * 4, 0xffffffff);
            for (let slot = 0; slot < 9; slot++) h.rt.mem.write32(RECORDS + slot * 0x3dc, 0x1111);
            h.rt.mem.write32(0x8004b374, 0x77);
        };
        h.compare(`pack ${pack}`, seed, [[PARTY_MAP, 12], [RECORDS, 9 * 0x3dc], [0x8004b374, 4]],
            () => h.rt.cpu.call(0x80016dc0, [pack], 20000), () => commitStarterPack(h.rt.mem, pack));
    }
});
