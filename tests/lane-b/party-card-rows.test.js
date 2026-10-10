// Oracle: engine/dw3/ui/native/party-card-rows.ts against the party-card row fills
// of the pause pages (techniques, sort, status, card folders, demo setup).
import { test } from "node:test";
import { createHarness } from "./helpers/screen-harness.js";
import {
    partyCardRows, ROWS_CARD_FOLDERS, ROWS_SORT, ROWS_STATUS, ROWS_TECHNIQUES,
} from "../../engine/dw3/ui/native/party-card-rows.ts";
import { buildEffectiveStats } from "../../engine/dw3/effective-stats.ts";
import { itemRecord } from "../../engine/dw3/item-record.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../../engine/dw3/party-context.ts";

const h = createHarness({ overlayFile: "pro_ststatus.bin" });
const OBJ = 0x80150000, UI = 0x80155000, SCRATCH = 0x80159000;
const LANG = 0x8005cca8;
const ROWS = [
    ["techniques", 0x80094144, ROWS_TECHNIQUES],
    ["sort", 0x80096744, ROWS_SORT],
    ["status", 0x8008b944, ROWS_STATUS],
    ["card folders", 0x80083914, ROWS_CARD_FOLDERS],
    ["demo setup", 0x8008519c, { ...ROWS_CARD_FOLDERS, statTable: 0x8009a798 }],
];

test("every page's party-card row fill matches its original", () => {
    for (const [name, addr, layout] of ROWS) {
        for (const row of [0, 1, 2]) {
            for (const show of [0, 1]) {
                for (const lang of [0, 2]) {
                    const seed = () => {
                        const m = h.rt.mem;
                        for (let i = 0; i < 0x100; i += 4) m.write32(UI + i, 0);
                        h.reset(5);
                        for (let i = 0; i < 0xb0; i += 4) m.write32(UI + i, h.widgetAt(10 + i / 4));
                        m.write32(LANG, lang);
                        for (let i = 0; i < 3; i++) m.write32(0x80048d34 + 0x70 + i * 4, i);
                        for (let slot = 0; slot < 3; slot++) {
                            const rec = 0x8004949c + slot * 0x3dc;
                            for (let k = 0; k < 0x2c; k += 2) m.write16(rec + 0x1c + k, (slot * 100 + k * 7) & 0x3ff);
                        }
                    };
                    const base = h.host();
                    const mem = h.rt.mem;
                    h.compare(`${name} row${row} show${show} lang${lang}`, seed, [[UI, 0x100]],
                        () => h.rt.cpu.call(addr, [OBJ, UI, row, show], 200000),
                        () => partyCardRows(mem, UI, row, show, SCRATCH, layout, {
                            rosterSlot: (r) => partyPositionToRosterSlot(mem, r),
                            copyStats: (slot, dest) => buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, dest),
                            cardRecord: (slot) => persistentRosterSlot(slot),
                            resolveText: (off) => base.languageBank((mem.read32(LANG) | 0) + off),
                            widgetSetLine0: (w, src, i) => base.callMethod(w, 0x114, [src, i]),
                            widgetSetLineNumber: (w, l, v) => base.callMethod(w, 0x118, [l, v]),
                            widgetSetFlagC1: (w, v) => base.callMethod(w, 0x144, [v]),
                            widgetMeasure: (w, v) => base.callMethod(w, 0x148, [v]),
                        }));
                }
            }
        }
    }
});
