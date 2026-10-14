// A Digimon that knows more forms than the card's 44 ledger cells (the enemy-only species are forms too) loses
// none of them through a save and a load: the cells show a window (equipped + current first), the rest travel in
// the companion snapshot and come back with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { NativeMemory } from "../engine/native/memory.ts";
import { MemcardSession } from "../engine/dw3/ui/memcard-session.ts";
import { readSaveBlock, decodeSaveRoster } from "../engine/dw3/save-block.ts";
import { residentStorage } from "../engine/persistence/memcard-state.ts";
import { registerExtraProfiles, extraProfileCount } from "../engine/dw3/ui/native/pause-status.ts";
import { setLedgerPage } from "../engine/dw3/ui/roster-form-state.ts";

const have = existsSync("web/assets/data/extra_profiles.bin");
const bytes = (p) => new Uint8Array(readFileSync(`web/assets/data/${p}`));
const x = { skip: have ? false : "extra_profiles.bin is not built" };

test("45+ forms survive the card: the cells hold a window, the snapshot holds the rest", x, () => {
  registerExtraProfiles(bytes("extra_profiles.bin"));
  assert.ok(extraProfileCount() >= 135);
  const profiles = bytes("digimon_profiles.bin");
  const manifest = JSON.parse(readFileSync("web/assets/data/memcard/manifest.json"));
  const resources = { profiles, tables: bytes("memcard/tables.bin"), font: bytes("shop_font.bin"),
    textButtons: Uint8Array.from(manifest.textButtons.bytes),
    banks: new Map([[0x7a, bytes("memcard/122.bin")], [0xab, bytes("memcard/171.bin")], [0x96, bytes("shop-banks/150.bin")]]) };
  const ids = [...Array.from({ length: 44 }, (_, i) => 9 + i), 56, 71, 100, 150];     // 48 forms
  const ledger = ids.map((id) => ({ id, formLevel: 5, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
  const forms = { digimonId: 56, equippedForms: [56, 150, 9], formLedger: ledger };
  const member = { position: 0, rosterSlot: 0, nameBytes: [14], exp: 1, level: 30, tp: 1, hp: 100, maxHp: 100, mp: 10, maxMp: 10,
    core: [1, 2, 3, 4, 5, 6], elements: [1, 2, 3, 4, 5, 6, 7], equipment: {}, forms };
  const seed = { language: 2, mode: "save", bits: 1, bag: [], playSeconds: 0, playerNameBytes: [14], members: [member], reserves: [],
    residentImage: Uint8Array.from({ length: 0x26c4 }, () => 0) };
  const card = { present: () => true, directory: () => new Uint8Array(0xd4), image: () => null, writeDirectory() {}, writeImage() {} };

  setLedgerPage(0);
  const s = new MemcardSession(seed, resources, { playSound() {}, card });
  const image = readSaveBlock(s.mem);
  s.dispose();

  // the cells carry the equipped forms and the current one whichever page is showing
  const cells = decodeSaveRoster(image, profiles)[0];
  const inCells = new Set(cells.formLedger.map((e) => e.id));
  for (const id of [56, 150, 9]) assert.ok(inCells.has(id), `form ${id} is in the card's cells`);
  assert.ok(cells.formLedger.length <= 44);
  assert.deepEqual(cells.equippedForms, [56, 150, 9], "the equipped extras decode back to their walker ids");
  assert.equal(cells.digimonId, 56);

  // a load: the cells plus the snapshot saved with them give back every form
  const data = residentStorage(image, profiles, { party: JSON.stringify(["p003pken"]), partyStats: JSON.stringify([{ ...forms }]), reserveStats: "{}" });
  const back = JSON.parse(data.partyStats)[0];
  assert.deepEqual(back.formLedger.map((e) => e.id).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b));
  assert.deepEqual(back.equippedForms, [56, 150, 9]);
});
