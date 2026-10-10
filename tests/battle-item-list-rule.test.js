// The in-battle ITEM list: WHICH items it offers, from the disc's own rule.
//
// Disc selection rule (pro/fightstg.s `FIGHTSTG_F0x800959b0` state 0, :19436-19567):
//   1. the inventory service `F0x800135E8(kind 1)` fills `self+0x58` with the HELD ids of
//      directory `D0x80042bc8[1]` in TABLE order (exe/f3.s; 83 ids: 43-91 and 361-394);
//   2. the screen keeps an id iff bit 1 of byte +0 of its EFFECT record is set
//      (`F0x8001355C(id)` -> master record -> its f0 word -> effect record; :19468-19473);
//   3. seven rows a page (:19523-19548, `min(count,7)` into the config word 0x800a3534).
//
// `engine/dw3/items.ts` `itemUsableInBattle` IS that bit-1 test, and `web/battle.js`
// `usableItems` is directory 1 filtered by it. This file pins both directions over the shipped
// table, pins the SCREEN applying the rule itself (not an allowlist of whatever ids its caller
// passed), and pins the restore amounts to the record's own value halfword.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEM_BY_ID, itemUsableInBattle } from "../engine/dw3/items.ts";
import { itemDirectory } from "../engine/dw3/item-directories.ts";
import { ITEM_LIST_ROWS } from "../engine/dw3/ui/native/battle-item-menu.ts";
import {
    ITEM_PAGE_KIND_HEALED, chargeHealPage, chargeNoEffectPage,
    ITEM_PAGE_KIND_ONE_LINE, ITEM_NO_EFFECT_ID,
} from "../engine/dw3/battle-items.ts";
import { FightItemSession, FIGHT_ITEM_BANKS, FIGHT_ITEM_TABLES_SIZE } from "../engine/dw3/ui/fight-item-session.ts";
import { setDefaultCursorGlyphs } from "../engine/dw3/ui/resident-text-host.ts";

const D = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const resident = new Uint8Array(readFileSync(resolve(D, "../native/screens/resident.bin")));
const RESIDENT_BASE = 0x80010000;
const ITEM_RECORD_TABLE = 0x80041838;

const u32 = (addr) => new DataView(resident.buffer, resident.byteOffset).getUint32(addr - RESIDENT_BASE, true);
const u16 = (addr) => new DataView(resident.buffer, resident.byteOffset).getUint16(addr - RESIDENT_BASE, true);
const u8 = (addr) => resident[addr - RESIDENT_BASE];

/** The disc's effect record for an id, exactly as F0x8001355C reaches it. */
function discRecord(id) {
    const master = u32(ITEM_RECORD_TABLE + 12 * id);
    if (!master) return null;
    return { klass: u8(master), value: u16(master + 2) };
}

const DIR1 = itemDirectory(1);
/** The disc's own offer: directory 1, effect-record byte +0 bit 1 set. */
const discOffers = () => DIR1.filter((id) => (discRecord(id)?.klass ?? 0) & 2);
/** Our rule over the same table. */
const ourOffers = () => DIR1.filter((id) => itemUsableInBattle(id));
const BATTLE_KIT = [43, 44, 45, 46, ...Array.from({ length: 25 }, (_, i) => 66 + i)];

test("the disc's directory 1 is the 83 consumable/booster ids, and ours is the same", () => {
    assert.deepEqual(DIR1, [...Array.from({ length: 49 }, (_, i) => 43 + i),
        ...Array.from({ length: 34 }, (_, i) => 361 + i)]);
    assert.equal(DIR1.length, 83);
});

test("both directions are empty: the disc's offer and ours are the same 29 ids", () => {
    // original offers, we never list:
    assert.deepEqual(discOffers().filter((id) => !itemUsableInBattle(id)), []);
    // we list, original would not:
    assert.deepEqual(ourOffers().filter((id) => !((discRecord(id)?.klass ?? 0) & 2)), []);
    // and the set itself, item by item.
    assert.deepEqual(ourOffers(), BATTLE_KIT);
    assert.deepEqual(discOffers(), BATTLE_KIT);
    // Name the two directions in the disc's own terms for the record:
    //   the chips 47-65 (class byte 0x01) and the boosters 91/361-394 (0x04) are NOT offered
    //   in battle by the original either -- a correct port, not a gap.
    for (const id of [...Array.from({ length: 19 }, (_, i) => 47 + i), 91,
        ...Array.from({ length: 34 }, (_, i) => 361 + i)]) {
        assert.equal((discRecord(id).klass & 2), 0, `disc ${id} byte+0 bit1 clear`);
        assert.equal(itemUsableInBattle(id), false, `ours ${id} not offered`);
    }
    assert.equal(BATTLE_KIT.length, 29, "the four HP charges and the 25 battle discs/plugs");
    assert.equal(ITEM_LIST_ROWS, 7, "seven rows a page, as the disc divides by 7");
});

test("the ITEM screen applies the record rule itself (not an allowlist of the seed)", () => {
    // The disc's diary: F0x800135E8 hands the screen the HELD ids of directory 1 WITHOUT the
    // class test; the screen applies the class test. So a seed of every directory-1 id must
    // still list only the 29 admitted ones.
    setDefaultCursorGlyphs(undefined);
    const items = JSON.parse(readFileSync(join(D, "item_effects.json"), "utf8")).items;
    const familyOf = Object.fromEntries(items.map((it) => [it.id, it.family ?? 0]));
    const seed = { items: DIR1.map((id) => ({ id, qty: 5, family: familyOf[id] ?? 0 })) };
    const session = new FightItemSession(2, seed, {
        tables: bytes("battlecmd/tables.bin").subarray(0, FIGHT_ITEM_TABLES_SIZE),
        font: bytes("shop_font.bin"),
        banks: new Map([[0x7f + 2, bytes("battlecmd/129.bin")],
            [0x6a + 2, bytes("shop-banks/108.bin")], [0x63 + 2, bytes("shop-banks/101.bin")]]),
    }, { playSound: () => {} });
    // One tick is state 0's build; the list is in the screen's own array afterwards.
    session.tick([], 1);
    assert.equal(session.count(), 29, "83 ids in, 29 offered: the screen ran the rule");
    assert.deepEqual(session.ids(), BATTLE_KIT, "and kept the disc's own 29, in table order");
});

test("a heal prints the amount it restored, from the record's value halfword", () => {
    // Every charge's amount is its own record halfword (fightstg.s:11241 `lhu $a1, 0x2($v0)`).
    assert.deepEqual([43, 44, 45, 46].map((id) => discRecord(id).value), [500, 2000, 5000, 9999]);
    for (const id of [43, 44, 45, 46]) {
        assert.equal(ITEM_BY_ID[id].value, discRecord(id).value, `charge ${id} carries the record amount`);
    }
    // The page is kind 8 with the amount the arm actually restored in slot 1 (never the listed
    // value when the cap clipped it), and a full-HP use is the shared one-line "No effect!".
    const clipped = chargeHealPage("Kotemon", 300);
    assert.equal(clipped.kind, ITEM_PAGE_KIND_HEALED);
    assert.deepEqual(clipped.slots, ["300"]);
    assert.equal(clipped.payload[1], 300);
    const refused = chargeNoEffectPage();
    assert.equal(refused.kind, ITEM_PAGE_KIND_ONE_LINE);
    assert.deepEqual(refused.payload, [ITEM_NO_EFFECT_ID]);
});
