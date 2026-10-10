// The pause session's data-only inputs, loaded the way the browser adapter loads them.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data");
const bytes = (path) => new Uint8Array(readFileSync(join(data, path)));
const json = (path) => JSON.parse(readFileSync(join(data, path), "utf8"));
import { PAUSE_TEXT_BANK_OFFSETS as BANK_OFFSETS } from "../../engine/dw3/ui/pause-root-session.ts";

export function pauseResources(language = 2) {
    const manifest = json("pause/manifest.json");
    const own = new Set(manifest.banks.map((bank) => bank.id));
    const shared = new Map(manifest.sharedBanks.map((entry) => [entry.offset, entry.dir]));
    const banks = new Map();
    for (const offset of BANK_OFFSETS) {
        const id = offset + language;
        banks.set(id, bytes(own.has(id) ? `pause/${id}.bin` : `${shared.get(offset)}/${id}.bin`));
    }
    const catalog = json("shop_catalog.json");
    return {
        tables: bytes("pause/tables.bin"),
        resident: bytes("pause/resident.bin"),
        homeData: bytes("pause/home-data.bin"),
        residentRanges: manifest.resident.ranges,
        profiles: bytes("digimon_profiles.bin"),
        font: bytes("shop_font.bin"),
        catalog,
        itemRecords: bytes("shop_item_records.bin"),
        descriptors: [bytes("shop_descriptors_main.bin"), bytes("shop_descriptors_extra.bin")],
        banks,
    };
}

/** The game's own letter codes for capital letters: 0x0E is A. */
export const gameName = (text) => new Uint8Array([...text].map((c) => 0x0e + c.charCodeAt(0) - 65));

/** Three partners with forms, a form ledger, stats and worn gear (item ids are real records). */
export function pauseSeed(page, overrides = {}) {
    const forms = (id) => ({
        digimonId: id, equippedForms: [id, id + 1, id + 2],
        formLedger: [
            { id, formLevel: 2, dvexp: 40, techSlots: [1, 2, 0x4003, 0, 0, 0] },
            { id: id + 1, formLevel: 1, dvexp: 5, techSlots: [3, 0, 0, 0, 0, 0] },
            { id: id + 2, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
        ],
    });
    const member = (rosterSlot, id, name) => ({
        rosterSlot, starterSlot: rosterSlot, nameBytes: gameName(name), forms: forms(id),
        level: 12 + rosterSlot, tp: 30, hp: 120, maxHp: 200, mp: 40, maxMp: 60, exp: 1234,
        core: [50, 40, 30, 20, 10, 5], elements: [1, 2, 3, 4, 5, 6, 7],
        equipment: rosterSlot === 0 ? { head: 5, body: 6 } : {},
    });
    return {
        page, money: 5000,
        inventory: [{ id: 1, qty: 3 }, { id: 2, qty: 1 }, { id: 7, qty: 5 }, { id: 20, qty: 2 }, { id: 40, qty: 1 }],
        party: [member(0, 13, "ABC"), member(1, 20, "DEF"), member(2, 30, "GHI")],
        ...overrides,
    };
}
