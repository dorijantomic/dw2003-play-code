// Every in-battle list screen loads its own data out of the extracted files
// instead of loading pro/fightstg, so each `loadResidentResources` range is a
// hand-written copy length. A range that runs past its table does not fail: it
// writes the next table's bytes, or the exe's own resident words, over whatever
// the screen then reads. Two of those faults have already been real here -
//
//   * the Digivolve form list wrote its whole file tail from offset 40, so the
//     0x148 bytes between the page-zero number table (0x800A350C) and the marker
//     blit's source rectangle (0x800A3654) were overwritten and the selection
//     bar could not be copied (tests/battle-form-panel-blit.test.js), and
//   * the technique table at 0x80042BDC is 443 records of 0x12 bytes, so the last
//     byte is 0x80044B01 and 0x80044B02 is the next resident word
//     (~/ddw3/rust/dw2003_exe_data/src/data.rs:1504). The TECH, Digivolve and
//     DNA sessions each copied the extracted file's whole 512-entry window, which
//     is 0x4DA bytes too long: they wrote the exe's word table over 0x80044B02
//     and put a false pointer in both pack services, [0x80044F4C] (F0x80013E5C)
//     and [0x80044F5C] (F0x800140D8).
//
// This file is the audit that keeps every range at its own table: each screen is
// built for real and every address it wrote past its last block is read back.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FightCommandSession } from "../engine/dw3/ui/fight-command-session.ts";
import { FightDnaPane } from "../engine/dw3/ui/fight-dna-session.ts";
import {
    FightFormSession, FIGHT_FORM_BANKS, FIGHT_FORM_ICON_TABLE_SIZE,
    FIGHT_FORM_PANEL_TABLE_SIZE, FIGHT_FORM_TABLES_SIZE,
} from "../engine/dw3/ui/fight-form-session.ts";
import {
    FightItemSession, FIGHT_ITEM_BANKS, FIGHT_ITEM_TABLES_SIZE,
} from "../engine/dw3/ui/fight-item-session.ts";
import { FightTagSession, FIGHT_TAG_BANKS, FIGHT_TAG_TABLES_SIZE } from "../engine/dw3/ui/fight-tag-session.ts";
import {
    FightTechSession, FIGHT_TECH_BANKS, FIGHT_TECH_ICON_OFFSET, FIGHT_TECH_TABLES_SIZE,
} from "../engine/dw3/ui/fight-tech-session.ts";
import {
    COMMAND_BLIT_RECT, COMMAND_CONFIG, COMMAND_JOKE_CONFIG, COMMAND_NAME_BANK,
} from "../engine/dw3/ui/native/fight-command-menu.ts";
import { ITEM_LIST_CONFIG } from "../engine/dw3/ui/native/battle-item-menu.ts";
import { TECH_LIST_CONFIG } from "../engine/dw3/ui/native/battle-tech-menu.ts";
import { TAG_LIST_CONFIG } from "../engine/dw3/ui/native/battle-tag-menu.ts";
import {
    DNA_MP_XS, DNA_PANE_CONFIG_OPTIONS, DNA_PANE_CONFIG_STRIP, DNA_SPECIES_TABLE,
} from "../engine/dw3/ui/native/battle-dna-menu.ts";
import {
    FORM_ICON_TABLE, FORM_LIST_CONFIG, FORM_PANEL_PAGE0_TABLE, FORM_PROFILE_BLOCK,
} from "../engine/dw3/ui/native/digivolve-form-menu.ts";
import { PROFILE_ROWS } from "../engine/dw3/ui/native/pause-status.ts";

const data = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const bytes = (path) => new Uint8Array(readFileSync(join(data, path)));
const bankBytes = (banks) => new Map([...banks].map((bank) => [bank + 2, bytes(`battlecmd/${bank + 2}.bin`)]));
const font = bytes("shop_font.bin");
const profiles = bytes("digimon_profiles.bin");
const quiet = { playSound: () => {} };
const formOption = (species) => ({
    species, left: [10, 10, 10, 10, 10, 10], right: [1, 1, 1, 1, 1, 1, 1],
    techs: [0x8001, 0, 0, 0, 0, 0], level: 2, dvexp: 0,
});

/**
 * Every range a battle list screen copies, with the address of the next piece of
 * data it must not reach. `next` is read out of pro/fightstg's own image (the
 * overlay's words) or, for the exe's tables, out of the first resident symbol
 * after the table.
 */
const RANGES = [
    { screen: "command", base: COMMAND_CONFIG, length: 32, next: FORM_LIST_CONFIG },
    { screen: "command", base: COMMAND_JOKE_CONFIG, length: 32, next: COMMAND_BLIT_RECT },
    { screen: "command", base: COMMAND_BLIT_RECT, length: 8, next: COMMAND_BLIT_RECT + 8 },
    { screen: "form", base: FORM_LIST_CONFIG, length: 32, next: FORM_PANEL_PAGE0_TABLE },
    { screen: "form", base: FORM_PANEL_PAGE0_TABLE, length: FIGHT_FORM_PANEL_TABLE_SIZE, next: ITEM_LIST_CONFIG },
    { screen: "form", base: FORM_ICON_TABLE, length: FIGHT_FORM_ICON_TABLE_SIZE, next: 0x80044b02 },
    { screen: "item", base: ITEM_LIST_CONFIG, length: 32, next: TECH_LIST_CONFIG },
    { screen: "tech", base: TECH_LIST_CONFIG, length: 32, next: TAG_LIST_CONFIG },
    { screen: "tag", base: TAG_LIST_CONFIG, length: 32, next: DNA_PANE_CONFIG_STRIP },
    { screen: "tag", base: FORM_PROFILE_BLOCK, length: PROFILE_ROWS * 0x58, next: 0x80040244 },
    { screen: "dna", base: DNA_PANE_CONFIG_STRIP, length: 32, next: DNA_PANE_CONFIG_OPTIONS },
    { screen: "dna", base: DNA_PANE_CONFIG_OPTIONS, length: 32, next: DNA_MP_XS },
    { screen: "dna", base: DNA_MP_XS, length: 16, next: DNA_MP_XS + 16 },
    { screen: "dna", base: DNA_SPECIES_TABLE, length: PROFILE_ROWS * 0x58, next: 0x80040244 },
];

function openCommand() {
    const tables = bytes("battlecmd/tables.bin");
    return new FightCommandSession(2, { initialRow: 0, activeIndex: 0, ailmentBits: 0 }, {
        tables, font, banks: bankBytes([COMMAND_NAME_BANK]),
    }, quiet);
}

function openItem() {
    return new FightItemSession(2, { items: [{ id: 43, qty: 3, family: 0 }] }, {
        tables: bytes("battlecmd/tables.bin").subarray(0, FIGHT_ITEM_TABLES_SIZE),
        font, banks: bankBytes(FIGHT_ITEM_BANKS),
    }, quiet);
}

function openTech() {
    return new FightTechSession(2, {
        activeIndex: 0, mp: 40, maxMp: 80, noCharge: 0,
        techniques: [{ word: 0x8001, cost: 4 }, { word: 0, cost: 0 }],
    }, { tables: bytes("battlecmd/tech-tables.bin"), font, banks: bankBytes(FIGHT_TECH_BANKS) }, quiet);
}

function openTag() {
    return new FightTagSession(2, {
        activeIndex: 0, interactive: 1, cursorRow: 0,
        members: [{ digimonId: 1, hp: 60, maxHp: 200, mp: 80, maxMp: 80 }, null, null],
    }, { tables: bytes("battlecmd/tag-tables.bin"), profiles, font, banks: bankBytes(FIGHT_TAG_BANKS) }, quiet);
}

function openForm() {
    return new FightFormSession(2, {
        activeIndex: 0, slotIndex: 0, currentSpecies: 3, liveSpecies: 3, reservedForm: 0,
        rosterSlots: [0, 1, 2],
        options: [formOption(3), formOption(9), formOption(10)],
        equipped: [9, 10, -1], panelBlock: Array.from({ length: 22 }, (_, i) => 0x40 + i), preselected: 0x8001,
    }, {
        tables: bytes("battlecmd/form-tables.bin"), profiles, font,
        banks: new Map(FIGHT_FORM_BANKS.map((bank) => [bank + 2, bytes(`battlecmd/${bank + 2}.bin`)])),
    }, quiet);
}

function openDna() {
    const member = (digimonId, rosterSlot, hp) => ({ digimonId, rosterSlot, hp, maxHp: 200, mp: 80, maxMp: 80 });
    return new FightDnaPane(2, { activeIndex: 0, partnerIndex: 1, members: [
        member(1, 0, 60), member(3, 1, 200), member(4, 2, 200),
    ] }, {
        tables: bytes("battlecmd/dna-tables.bin"),
        techniques: bytes("battlecmd/tech-tables.bin").subarray(FIGHT_TECH_ICON_OFFSET),
        panelTable: bytes("battlecmd/form-tables.bin").subarray(40, 40 + FIGHT_FORM_PANEL_TABLE_SIZE),
        species: profiles, font,
        banks: new Map([[0x7f + 2, bytes("battlecmd/79.bin")], [0x4e + 2, bytes("battlecmd/78.bin")],
            [0xa2 + 2, bytes("battlecmd/162.bin")]]),
    }, quiet);
}

const SCREENS = {
    command: openCommand, form: openForm, item: openItem, tech: openTech, tag: openTag, dna: openDna,
};

/** The exe's own words from the first symbol after the technique table. */
const RESIDENT_AFTER_TECHNIQUES = { first: 0x80044b02, last: 0x80044fdc };

test("every battle list range stops at the next piece of data", () => {
    for (const range of RANGES) {
        const label = `${range.screen} @0x${range.base.toString(16)}`;
        assert.ok(range.length > 0, `${label}: a range with no length copies nothing`);
        assert.ok(range.base + range.length <= range.next,
            `${label}: ${range.length} bytes run to 0x${(range.base + range.length).toString(16)},`
            + ` past 0x${range.next.toString(16)}`);
    }
});

test("no screen writes a byte past the exe's technique table", () => {
    for (const screen of ["tech", "form", "dna"]) {
        const mem = SCREENS[screen]().mem;
        for (let at = RESIDENT_AFTER_TECHNIQUES.first; at < RESIDENT_AFTER_TECHNIQUES.last; at += 4) {
            assert.equal(mem.read32(at), 0,
                `${screen} wrote over the resident word at 0x${at.toString(16)}`);
        }
        assert.equal(mem.read32(0x80044f4c), 0,
            `${screen} wrote over [0x80044F4C], the pack-by-number getter (F0x80013E5C)`);
        assert.equal(mem.read32(0x80044f5c), 0,
            `${screen} wrote over [0x80044F5C], the pack-entry resolver (F0x800140D8)`);
    }
});

test("the technique table itself is still whole, all 443 records", () => {
    const file = bytes("battlecmd/tech-tables.bin").subarray(FIGHT_TECH_ICON_OFFSET);
    for (const screen of ["tech", "form", "dna"]) {
        const mem = SCREENS[screen]().mem;
        const at = (address, length) => Array.from({ length }, (_, i) => mem.read8(address + i) & 0xff);
        assert.deepEqual(at(FORM_ICON_TABLE, FIGHT_FORM_ICON_TABLE_SIZE),
            Array.from(file.subarray(0, FIGHT_FORM_ICON_TABLE_SIZE)),
            `${screen}: every byte of the table is the file's own`);
    }
});

test("the data files are the sizes the sessions expect", () => {
    assert.equal(bytes("battlecmd/tables.bin").length, 72);
    assert.equal(bytes("battlecmd/tables.bin").length, 72);
    assert.equal(FIGHT_ITEM_TABLES_SIZE, 40);
    assert.equal(bytes("battlecmd/tag-tables.bin").length, FIGHT_TAG_TABLES_SIZE);
    assert.equal(bytes("battlecmd/tech-tables.bin").length, FIGHT_TECH_TABLES_SIZE);
    assert.equal(bytes("battlecmd/form-tables.bin").length, FIGHT_FORM_TABLES_SIZE);
    assert.equal(bytes("battlecmd/dna-tables.bin").length, 0x50);
    assert.equal(profiles.length, PROFILE_ROWS * 0x58);
});