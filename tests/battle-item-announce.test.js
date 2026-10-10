// The item announcement page — the in-battle message box's kind 14, and the item-name
// bank 0x6a it reads.
//
// Decode: FIGHTSTG_F0x8008dac0 (pro/fightstg) outer step 0 puts the page up before any
// handler runs — `fightstg.s:11154` `jal FIGHTSTG_F0x8009a298` allocates a line,
// `:11158` `sw $zr, 0x50($s2)` writes payload word 0 = 0, `:11157`/`:11159` put the
// ItemId in payload word 1, and `:11161` `li $a1, 0xe` is **kind 14**. The arm
// `.L0x80099ca0` (`:23809-23847`) is line 1 `esmfight[0x16]` (`:23822`), line 2
// `esmfight[0x09]` `{1}!` (`:23833`) and `+0x120(line2, bank 0x6a, payload[1], 1)`
// (`:23838`/`:23841`/`:23842`/`:23845`).
//
// Bank 0x6a + language is the item-name bank, string index == ItemId. It is the disc's
// ESITMNAM.BIN: `tools/extract_battle_text.py::verify_bank_layout` names it against the
// disc file-index table (`LBA_ESITMNAM_BIN_IDX = 108 = 0x6a + 2`). Its strings are the
// table `engine/dw3/item-names.ts` already carries, so this file also answers "do the
// two differ?" mechanically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  itemAnnouncementPage, ITEM_PAGE_KIND_ANNOUNCE, ITEM_NAME_BANK,
} from "../engine/dw3/battle-items.ts";
import {
  battleMessageArm, battleMessageLineIndex, battleMessageNamesLineOne, BATTLE_MESSAGE_BANK,
  BATTLE_MESSAGE_NAME,
} from "../engine/dw3/ui/native/battle-message-line.ts";
import { battleMessageCompose } from "../engine/dw3/ui/battle-message-session.ts";
import { ITEM_NAMES } from "../engine/dw3/item-names.ts";

const read = (name) => JSON.parse(readFileSync(
  resolve("web/assets/data/battlecmd", `${name}.json`), "utf8"));
const ESMFIGHT = read("esmfight").strings;
const ESITMNAM = read("esitmnam").strings;

/** What the panel would hold for one page, the way `BattleMessageSession.lines()` does. */
function panelLines(spec, bankText = (bank, index) => (bank === BATTLE_MESSAGE_BANK
  ? ESMFIGHT[index] : ESITMNAM[index])) {
  const i1 = battleMessageLineIndex(spec.kind, 0, spec.payload);
  const i2 = battleMessageLineIndex(spec.kind, 1, spec.payload);
  const slots1 = battleMessageNamesLineOne(spec.kind) && spec.name ? [spec.name] : [];
  return [
    battleMessageCompose(bankText(BATTLE_MESSAGE_BANK, i1), slots1),
    battleMessageCompose(bankText(BATTLE_MESSAGE_BANK, i2), spec.slots ?? []),
  ];
}

test("the announcement page is kind 14 with the ItemId in payload word 1", () => {
  const page = itemAnnouncementPage("Kotemon", 66, ESITMNAM[66]);
  assert.equal(page.kind, ITEM_PAGE_KIND_ANNOUNCE);
  assert.equal(page.kind, 14);
  assert.deepEqual(page.payload, [0, 66]);
  assert.equal(page.name, "Kotemon");
  assert.deepEqual(page.slots, ["Antidote Disk"]);
});

test("the announcement is its own page and it is Circle-gated, like the original", () => {
  // `.L0x8008db1c` allocates the line and `:11168`-`:11170` write self+0x10 = 1; the next
  // pass returns without doing anything while *($s3) is still set (:11171 `lw $v0, ($s3)`
  // / :11173 `bnez $v0, .L0x8008ee2c`), and only then consumes the item and calls
  // self+0x38 (:11179), the handler dispatch. So the page is a separate line object read
  // on its own, not a line inside the effect.
  const arm = battleMessageArm(14);
  assert.equal(arm.at, 0x80099ca0);
  assert.equal(arm.line1, BATTLE_MESSAGE_NAME);      // esmfight[0x16] "{1}"
  assert.equal(arm.line2, 0x09);                     // esmfight[0x09] "{1}!"
  assert.deepEqual(arm.slots, [{ payload: 1, bank: ITEM_NAME_BANK }]);
  assert.notEqual(arm.nameLine, false);              // the shared tail fills the name slot
});

test("the announcement reads the item's own name out of bank 0x6a, by ItemId", () => {
  for (const id of [43, 44, 45, 46, 66, 71, 76, 84, 90]) {
    const page = itemAnnouncementPage("Kuwagamon", id, ESITMNAM[id]);
    assert.deepEqual(panelLines(page), ["Kuwagamon", `${ESITMNAM[id]}!`]);
  }
  assert.deepEqual(panelLines(itemAnnouncementPage("Kuwagamon", 43, ESITMNAM[43])),
    ["Kuwagamon", "Power Charge!"]);
});

test("the side test is payload word 0, and the announcement writes 0 (the actor)", () => {
  // `:24035` `.L0x8009a028 lw $a2, ($s2)` -> `FIGHTSTG_F0x80098d14 .L0x80098d28 bnez $a2`
  // (:22789). Word 0 is 0, so the shared tail takes the current actor's own nickname
  // rather than a party record; 0x10 would have named the enemy instead.
  assert.equal(itemAnnouncementPage("Kotemon", 66, "Antidote Disk").payload[0], 0);
  const enemy = itemAnnouncementPage("Numemon", 86, "Chaos Wave");
  assert.equal(enemy.payload[0], 0, "kind 14 reads word 0, not the kind-2 word 1");
});

test("bank 0x6a is the item-name bank: 403 entries, index 0 empty, count > the last item id", () => {
  const bank = read("esitmnam");
  assert.equal(bank.bank, ITEM_NAME_BANK);
  assert.equal(bank.bank, 0x6a);
  assert.equal(bank.language, 2);
  assert.equal(bank.count, 403);
  assert.equal(bank.strings.length, 403);
  assert.equal(bank.strings[0], "", "index 0 is the unused item id");
  // Every id the 48-case dispatch covers (ItemId - 0x2b < 0x30, so 43..90) is named.
  for (let id = 43; id <= 90; id++) {
    assert.ok(bank.strings[id], `bank 0x6a has no name for item ${id}`);
  }
});

test("the disc's own image for bank 0x6a ships as shop-banks/108.bin with the same count", () => {
  // `tools/build_translated_screen_data.py` already copies this group's disc image for
  // the pause and report pages (its PAUSE_SHARED_BANKS / REPORT_SHARED_BANKS tables call
  // bank 0x6A "item-names"), so the entry count is checked against the disc's bytes and
  // not only against the language file.
  const image = readFileSync(resolve("web/assets/data/shop-banks/108.bin"));
  const count = new DataView(image.buffer, image.byteOffset, image.byteLength)
    .getUint32(0, true);
  assert.equal(count, 403);
  assert.equal(count, ESITMNAM.length, "the decoded bank and its disc image agree");
});

test("bank 0x6a and the walker's own item names are the same table, entry for entry", () => {
  // The job asked whether the bank's strings differ from what the walker ships. They do
  // not: both come from ~/ddw3/lang_file/dw2003/eng/esitmnam.toml, so the battle reads
  // the bank and the shared item names stay untouched.
  const diffs = [];
  for (let id = 0; id < ESITMNAM.length; id++) {
    const shipped = id === 0 ? "" : (ITEM_NAMES[id] ?? "");
    if (shipped !== ESITMNAM[id]) diffs.push([id, ESITMNAM[id], shipped]);
  }
  assert.deepEqual(diffs, []);
});

test("the four HP charges and the 25 battle items all announce a real name", () => {
  assert.deepEqual([43, 44, 45, 46].map((id) => ESITMNAM[id]),
    ["Power Charge", "Super Charge", "Ultra Charge", "Max Charge"]);
  assert.equal(ESITMNAM[66], "Antidote Disk");
  assert.equal(ESITMNAM[84], "Unknown Field");
  assert.equal(ESITMNAM[86], "Chaos Wave");
});

// ── What the player gets ────────────────────────────────────────────────────────────
// Two code paths open an item in a battle (the ITEM command's own action, and the
// target picker's shortcut). Both used to type one walker sentence, "Used <item>!", which
// is not the disc's page: the original puts up kind 14 and waits for Circle. These read
// web/battle.js the way tests/battle-hit-tint-absent.test.js reads it, because
// createBattle needs a canvas.
const battle = readFileSync(resolve("web/battle.js"), "utf8");

test("both item paths put up the kind-14 announcement instead of a typed sentence", () => {
  assert.equal(battle.includes("sayWalker(b, `Used "), false,
    'a "Used <item>!" sentence is still typed onto an item path in web/battle.js');
  const calls = battle.match(/sayOriginal\(b, itemAnnouncementSpec\(b, item\), /g) ?? [];
  assert.equal(calls.length, 2,
    "the ITEM command's action and the target picker's shortcut both open the page");
});

test("the announcement page is the shared box's spec, filled from bank 0x6a", () => {
  assert.match(battle, /itemAnnouncementPage\(\s*b\.player\.profile\.name, item\.id,\s*battleMsgText\(ui\.BATTLE_MESSAGE_BANK_FIELD, item\.id\)\)/,
    "web/battle.js no longer builds the announcement out of the loaded bank 0x6a");
  // The bank has to be loaded before the first item page, not after.
  assert.match(battle, /await battleMsgBank\(ui\.BATTLE_MESSAGE_BANK_FIELD\);/,
    "web/battle.js never loads the item-name bank");
});