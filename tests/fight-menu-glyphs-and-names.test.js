// The battle menus' two shared systems, per screen:
//
//   * the resident selection-cursor glyph table (0x8004DCE0) every forming-battle
//     screen forwards into `loadResidentResources` — the lab/gym/status fix, now
//     closed for the seven battle-menu sessions; and
//   * the TAG partner list's row name, whose plate installs a pointer to the
//     Digimon name bank 0x4E word the profile row's +0x55 byte names (the same
//     word the pause status and the DNA pane read).
//
// No PlayStation instruction runs; the tables come from the data build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultCursorGlyphs } from "../engine/dw3/ui/resident-text-host.ts";
import { FightCommandSession } from "../engine/dw3/ui/fight-command-session.ts";
import { FightDnaPane } from "../engine/dw3/ui/fight-dna-session.ts";
import { FightFormSession, FIGHT_FORM_BANKS, FIGHT_FORM_PANEL_TABLE_SIZE } from "../engine/dw3/ui/fight-form-session.ts";
import { FightItemSession, FIGHT_ITEM_BANKS, FIGHT_ITEM_TABLES_SIZE } from "../engine/dw3/ui/fight-item-session.ts";
import { FightReportSession } from "../engine/dw3/ui/fight-report-session.ts";
import { FightTagSession, FIGHT_TAG_BANKS } from "../engine/dw3/ui/fight-tag-session.ts";
import { TAG_NAME_X } from "../engine/dw3/ui/native/battle-tag-menu.ts";
import { FightTechSession, FIGHT_TECH_BANKS, FIGHT_TECH_ICON_OFFSET } from "../engine/dw3/ui/fight-tech-session.ts";
import { COMMAND_NAME_BANK } from "../engine/dw3/ui/native/fight-command-menu.ts";

const D = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const font = bytes("shop_font.bin");
const profiles = bytes("digimon_profiles.bin");
const glyphs = JSON.parse(readFileSync(join(D, "shop_catalog.json"), "utf8")).cursorGlyphs;
const quiet = { playSound: () => {} };
const bankBytes = (banks) => new Map([...banks].map((bank) => [bank + 2, bytes(`battlecmd/${bank + 2}.bin`)]));
const formOption = (species) => ({
    species, left: [10, 10, 10, 10, 10, 10], right: [1, 1, 1, 1, 1, 1, 1],
    techs: [0x8001, 0, 0, 0, 0, 0], level: 2, dvexp: 0,
});

/** Every screen, built for real, each handed the glyph table. */
const SCREENS = {
    command: () => new FightCommandSession(2, { initialRow: 0, activeIndex: 0, ailmentBits: 0 },
        { tables: bytes("battlecmd/tables.bin"), font, cursorGlyphs: glyphs, banks: bankBytes([COMMAND_NAME_BANK]) }, quiet),
    tech: () => new FightTechSession(2, { activeIndex: 0, mp: 40, maxMp: 80, noCharge: 0,
        techniques: [{ word: 0x8001, cost: 4 }, { word: 0, cost: 0 }] },
        { tables: bytes("battlecmd/tech-tables.bin"), font, cursorGlyphs: glyphs, banks: bankBytes(FIGHT_TECH_BANKS) }, quiet),
    form: () => new FightFormSession(2, { activeIndex: 0, slotIndex: 0, currentSpecies: 3, liveSpecies: 3,
        reservedForm: 0, rosterSlots: [0, 1, 2], options: [formOption(3), formOption(9), formOption(10)],
        equipped: [9, 10, -1], panelBlock: Array.from({ length: 22 }, (_, i) => 0x40 + i), preselected: 0x8001 },
        { tables: bytes("battlecmd/form-tables.bin"), profiles, font, cursorGlyphs: glyphs, banks: bankBytes(FIGHT_FORM_BANKS) }, quiet),
    dna: () => new FightDnaPane(2, { activeIndex: 0, partnerIndex: 1, members: [
        { digimonId: 1, rosterSlot: 0, hp: 60, maxHp: 200, mp: 80, maxMp: 80 },
        { digimonId: 3, rosterSlot: 1, hp: 200, maxHp: 200, mp: 80, maxMp: 80 },
        { digimonId: 4, rosterSlot: 2, hp: 200, maxHp: 200, mp: 80, maxMp: 80 },
    ] }, { tables: bytes("battlecmd/dna-tables.bin"),
        techniques: bytes("battlecmd/tech-tables.bin").subarray(FIGHT_TECH_ICON_OFFSET),
        panelTable: bytes("battlecmd/form-tables.bin").subarray(40, 40 + FIGHT_FORM_PANEL_TABLE_SIZE),
        species: profiles, font, cursorGlyphs: glyphs,
        banks: new Map([[0x7f + 2, bytes("battlecmd/79.bin")], [0x4e + 2, bytes("battlecmd/78.bin")],
            [0xa2 + 2, bytes("battlecmd/162.bin")]]) }, quiet),
    item: () => new FightItemSession(2, { items: [{ id: 43, qty: 3, family: 0 }] },
        { tables: bytes("battlecmd/tables.bin").subarray(0, FIGHT_ITEM_TABLES_SIZE), font, cursorGlyphs: glyphs,
          banks: new Map([[0x7f + 2, bytes("battlecmd/129.bin")], [0x6a + 2, bytes("shop-banks/108.bin")],
              [0x63 + 2, bytes("shop-banks/101.bin")]]) }, quiet),
    tag: () => new FightTagSession(2, { activeIndex: 0, interactive: 1, cursorRow: 0,
        members: [{ digimonId: 1, hp: 60, maxHp: 200, mp: 80, maxMp: 80 }, null, null] },
        { tables: bytes("battlecmd/tag-tables.bin"), profiles, font, cursorGlyphs: glyphs, banks: bankBytes(FIGHT_TAG_BANKS) }, quiet),
    report: () => new FightReportSession({ language: 2, battleId: 5, dropItemId: 0, activePosition: 0, bits: 4321, bag: [],
        members: [{ position: 0, rosterSlot: 0, nameBytes: [14, 15, 16, 17], exp: 8188, level: 20, tp: 10, participated: true }] },
        { tables: bytes("report/tables.bin"), profiles, cursorGlyphs: glyphs,
          textButtons: Uint8Array.from(JSON.parse(readFileSync(join(D, "report/manifest.json"), "utf8")).textButtons.bytes),
          font, banks: new Map([[0x55 + 2, bytes("report/87.bin")], [0x4e + 2, bytes("wizard/80.bin")],
              [0x6a + 2, bytes("shop-banks/108.bin")], [0xa2 + 2, bytes("pause/164.bin")]]) },
        { playSound() {}, rand: () => 0x1234 }),
};

/** The five pointers of the resident cursor glyph table 0x8004DCE0. */
const glyphPointers = (mem) => Array.from({ length: 5 }, (_, i) => mem.read32(0x8004dce0 + i * 4) >>> 0);

for (const name of Object.keys(SCREENS)) {
    test(`${name}: the session installs the forwarded cursor glyph table`, () => {
        // No shared default: the only source is the screen's own resources.
        setDefaultCursorGlyphs(undefined);
        const session = SCREENS[name]();
        assert.ok(glyphPointers(session.mem).every((p) => p !== 0),
            `${name} must install the cursor glyph table it was handed (${JSON.stringify(glyphPointers(session.mem))})`);
    });
}

test("tag: without cursorGlyphs and without a default the table is left empty (the old trap)", () => {
    setDefaultCursorGlyphs(undefined);
    const resources = { tables: bytes("battlecmd/tag-tables.bin"), profiles, font, banks: bankBytes(FIGHT_TAG_BANKS) };
    const session = new FightTagSession(2, { activeIndex: 0, interactive: 1, members: [{ digimonId: 1, hp: 60, maxHp: 200, mp: 80, maxMp: 80 }, null, null] }, resources, quiet);
    assert.deepEqual(glyphPointers(session.mem), [0, 0, 0, 0, 0], "nothing installed it");
});

// ── the TAG partner list's row name ────────────────────────────────────────────
const decode = (b) => {
    if (b >= 4 && b <= 0x0d) return String.fromCharCode(0x30 + b - 4);
    if (b >= 0x0e && b <= 0x27) return String.fromCharCode(0x41 + b - 0x0e);
    if (b >= 0x28 && b <= 0x41) return String.fromCharCode(0x61 + b - 0x28);
    return "";
};
const decodeText = (bytes) => (bytes ?? []).filter((b) => b !== 0).map(decode).join("");

test("tag: the partner row's blue bar carries the member's OWN name, not the species", () => {
    // The row plate is the member's own roster-record string: ctx+0x2718 answers
    // the member's ROSTER SLOT, ctx+0x2750 points at that slot's record, and the
    // record's string at +0x08 IS the name (pause-root-session.ts seats the same
    // bytes). A species-name lookup shows "Renamon" here; the member's own name
    // must win. Member 1 is a Renamon (roster slot 6) renamed RENA.
    const nickname = "RENA";
    const nameBytes = [...nickname].map((ch) => 0x0e + (ch.charCodeAt(0) - 0x41)); // A-Z -> 0x0e+n
    const session = new FightTagSession(2, { activeIndex: 0, interactive: 1, cursorRow: 0, members: [
        { digimonId: 3, hp: 200, maxHp: 200, mp: 80, maxMp: 80, rosterSlot: 2 },
        { digimonId: 7, hp: 200, maxHp: 200, mp: 80, maxMp: 80, rosterSlot: 6, nameBytes },
        null,
    ] }, { tables: bytes("battlecmd/tag-tables.bin"), profiles, font, banks: bankBytes(FIGHT_TAG_BANKS) }, quiet);

    // ctx+0x70 (PARTY_MAP) is seated with each row's ROSTER SLOT, not its position:
    // the identity every reader of ctx+0x2718 resolves the member by.
    assert.equal(session.mem.read32(0x80048d34 + 0x70) >>> 0, 2,
        "party position 0 seats its member's roster slot");
    assert.equal(session.mem.read32(0x80048d34 + 0x74) >>> 0, 6,
        "party position 1 seats Renamon's roster slot, not 1");

    let tick = 0;
    for (let i = 0; i < 12 && !session.ready(); i++) { session.tick([], tick++); }
    assert.equal(session.ready(), true, "the list is live");
    const nameWidgets = session.widgets.textWidgets().filter((w) => w.penX === TAG_NAME_X);
    assert.ok(nameWidgets.length > 0, "a row name widget exists");
    const texts = nameWidgets.map((w) => decodeText(w.lines[0].bytes));
    assert.ok(texts.includes(nickname),
        `the row plate must carry the member's own name "${nickname}", got ${JSON.stringify(texts)}`);
});
