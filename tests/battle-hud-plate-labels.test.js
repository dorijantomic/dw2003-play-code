// The browser adapter for the in-battle plate's names and the slash between the HP
// numbers (web/battlehud-translated.js) must hand the painter the original's own three
// strings at the original's three places: the enemy name at (17, 21), the player's at
// (174, 21), and bank 0x7f line 0x10 — the single glyph "/" — at (268, 26).
//
// The arithmetic and the call order are pinned against the original in
// tests/lane-b/battle-hud.test.js; this file covers the adapter's translation of the
// walker's state into the ported build and the strings it reads out of the shipped
// banks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const {
  battleHudLabelsGeometry, battleHudPlateLabels, battleHudSetNameBank,
} = await import("../web/battlehud-translated.js");
const { battleMsgSetBank } = await import("../web/battlemsg-translated.js");
const { decodeGameName } = await import("../web/nameentry-translated.js");

/** The shipped bank 0x7f, read the way the port's index resolver reads it. */
function bankLines(file) {
  const bytes = readFileSync(join(dir, file));
  const count = bytes.readUInt32LE(0);
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = bytes.readUInt32LE(4 + i * 4);
    out.push(bytes.subarray(start, bytes.indexOf(0, start)));
  }
  return out;
}

const esmFight = bankLines("battlecmd/127.bin");
const decoded = JSON.parse(readFileSync(join(dir, "battlecmd/esmfight.json"), "utf8"));
// Resource 0x1cf, the enemy stat records the plate's name line is read out of.
const stats = JSON.parse(readFileSync(join(dir, "battlecmd/enemy_stats.json"), "utf8"));
const enemies = JSON.parse(readFileSync(join(dir, "enemies.json"), "utf8")).enemies;

test("bank 0x7f line 0x10 is the single glyph the plate shows between the numbers", () => {
  // The port's index is fightstg.s .L0x80093b1c `li $a2, 0x10`; the bank ships as
  // battlecmd/127.bin and the decoded copy of the same table carries 145 lines, which
  // is what ties index 16 to text.
  assert.equal(esmFight.length, decoded.strings.length, "the .bin and the decoded table agree on the count");
  assert.equal(esmFight.length, decoded.count);
  assert.deepEqual([...esmFight[13]], [...Buffer.from([0x1a, 0x1d])], "line 13 is the two bytes of HP");
  assert.equal(decoded.strings[14], "HP");
  assert.equal(decoded.strings[13], "MP");
  assert.equal(decoded.strings[16], "/", "line 0x10 is the slash, not a bar or a colon");
  assert.equal(decoded.bank, 0x7f);
});

test("the separator is the bank line at the original's own place", () => {
  battleMsgSetBank(Object.fromEntries(decoded.strings.map((text, i) => [i, text])));
  battleHudSetNameBank(["", "Kotemon", "Agumon", "Greymon", "Tyrannomon", "Devimon", "ExVeemon", "Renamon"]);
  const labels = battleHudPlateLabels({ activePlayerIndex: 0, enemyName: "Kunemon" });
  assert.deepEqual(labels.separator, {
    text: "/", kind: 3, x: 268, y: 26, bank: 0x7f, index: 0x10,
  });
  // The build arm creates it after both names, as its last element.
  const creates = labels.calls.filter((c) => c[0] === "create");
  assert.deepEqual(creates.map((c) => [c[2], c[3], c[4]]), [[1, 174, 21], [1, 17, 21], [3, 268, 26]]);
  assert.deepEqual(creates.map((c) => c[1]), [0x1005, 0x1005, 0x1005], "layer 0x1005");
});

test("the two names sit where the original puts them and carry the walker's strings", () => {
  const labels = battleHudPlateLabels({
    activePlayerIndex: 1, activeEnemyIndex: 0,
    playerName: "MetalGarurumon", enemyName: "Kuwagamon",
  });
  assert.deepEqual({ x: labels.enemy.x, y: labels.enemy.y, kind: labels.enemy.kind }, { x: 17, y: 21, kind: 1 });
  assert.deepEqual({ x: labels.player.x, y: labels.player.y, kind: labels.player.kind }, { x: 174, y: 21, kind: 1 });
  assert.equal(labels.player.text, "MetalGarurumon", "the roster member's own stored name");
  assert.equal(labels.enemy.text, "Kuwagamon");
  // The player's setter is handed the roster record with index -1, which is how the
  // original installs a literal; the port exposes the address so a caller can see it.
  assert.equal(labels.player.source >>> 0, 0x8004949c + 1 * 988);
});

test("an enemy name id reads the line out of the Digimon-name bank", () => {
  // The original reads bank 0x4e line (enemy stat record + 0x06). That table ships
  // decoded as battlecmd/enemy_stats.json (resource 0x1cf), so the browser adapter takes
  // the line from its caller; when it has one, the text comes out of the bank.
  const names = bankLines("wizard/80.bin");
  assert.ok(names.length > 52, "the bank carries at least the profile names");
  const labels = battleHudPlateLabels({ enemyNameId: 7, enemyName: "ignored" });
  assert.equal(labels.separator.text, "/", "the slash is read from the same build");
  assert.equal(labels.enemy.text, decodeGameName(names[7]));
  assert.equal(labels.enemy.nameId, 7);
  // Bank 0x4e is indexed by a NAME id, not by species id: line 7 is Renamon's, and
  // the profile table's own name-id byte for Renamon (species 373) is 7.
  assert.equal(decodeGameName(names[7]), "Renamon");
  assert.equal(decodeGameName(names[65]), "Kuwagamon");
  // With no line the port still builds the element and takes the original's
  // null-record path, and the caller keeps its own species name.
  const none = battleHudPlateLabels({ enemyName: "Kuwagamon" });
  assert.equal(none.enemy.nameId, null);
  assert.equal(none.enemy.text, "Kuwagamon");
  assert.ok(none.calls.some((c) => c[0] === "create" && c[2] === 1 && c[3] === 17),
    "the enemy element is created even with no stat record");
});

test("the decoded placement is the original's literals", () => {
  assert.deepEqual(battleHudLabelsGeometry(), {
    names: { player: { x: 174, y: 21 }, enemy: { x: 17, y: 21 } },
    separator: { x: 268, y: 26, bank: 0x7f, index: 0x10 },
  });
});

// The whole point of extracting resource 0x1cf: the plate's enemy name is no longer a
// species string the walker makes up, it is the original's own bank 0x4e line, reached
// through the original's own chain — the numeric enemy id, the resolver's record, the
// record's +0x06, then the bank. The chain for the first story battle is closed here.

test("resource 0x1cf is the 0x46-stride table the resolver scans, and stops where the scan stops", () => {
  // FIGHTSTG_F0x8009b864 (fightstg.s:25645) walks the table with stride `addiu $v1, 0x46`
  // (:25656) and gives up at the first record whose `+0x00` halfword is zero (:25655 ->
  // :25663), so `recordCount` is what the code itself would return, not a guess.
  assert.equal(stats.resource, 0x1cf);
  assert.equal(stats.recordStride, 0x46);
  assert.equal(stats.records.length, stats.recordCount);
  assert.equal(stats.terminatorIndex, stats.recordCount, "the next record is the zero-id terminator");
  assert.ok(stats.recordCount > 190 && stats.recordCount < 200, "the scan finds 193 records");
  for (const [i, row] of stats.records.entries()) {
    assert.equal(row.index, i, "records are in scan order");
    assert.notEqual(row.id, 0, "no record before the terminator has id 0");
    assert.equal(row.raw.length, 0x46 * 2, "the record's own 70 bytes travel with it");
    assert.equal(Buffer.from(row.raw, "hex").readInt16LE(0), row.id, "raw +0x00 is the id");
    assert.equal(Buffer.from(row.raw, "hex").readInt16LE(6), row.nameId, "raw +0x06 is the name line");
  }
});

test("every field the JSON decodes is the byte the reader reads", () => {
  // Each field names the load that reads it in pro/fightstg.s. Re-derive the JSON's
  // values from `raw` at those exact offsets so a wrong offset cannot pass.
  for (const row of stats.records) {
    const raw = Buffer.from(row.raw, "hex");
    assert.equal(row.attack, raw.readInt16LE(0x08));
    assert.equal(row.tech1, raw.readInt16LE(0x0a));
    assert.equal(row.tech2, raw.readInt16LE(0x0c));
    assert.equal(row.field04, raw.readInt16LE(0x04));
    assert.equal(row.strength, raw.readInt16LE(0x0e));
    assert.equal(row.defence, raw.readInt16LE(0x10));
    assert.equal(row.spirit, raw.readInt16LE(0x12));
    for (let k = 0; k < 3; k++) {
      assert.deepEqual(row.aiMoves[k],
        { action: raw[0x32 + 4 * k], comparator: raw[0x33 + 4 * k], value: raw.readInt16LE(0x34 + 4 * k) });
    }
    assert.deepEqual(row.counter,
      { action: raw[0x42], comparator: raw[0x43], value: raw.readInt16LE(0x44) });
  }
});

test("the record table is the same table enemies.json was decoded from, row for row", () => {
  // web/battle.js zips these two files by index to find an enemy's name line, so the
  // alignment has to hold — this is what makes the zip legal rather than a coincidence.
  // `enemies.json` is the same disc file with these seven fields already expanded. Its
  // rows 0..192 are the records in scan order; its 194th row is the walker's own
  // all-zero "Null" placeholder, standing where the resolver's zero-id terminator is,
  // and it has no record in the original's table.
  assert.equal(enemies.length, stats.recordCount + 1, "the scan's 193 records plus the placeholder");
  assert.equal(enemies[stats.recordCount].enemy_id, "Null");
  assert.equal(enemies[stats.recordCount].attack, 0, "the placeholder is not a real enemy");
  for (const [i, e] of enemies.slice(0, stats.recordCount).entries()) {
    const row = stats.records[i];
    assert.equal(row.attack, e.attack, `${e.enemy_id} attack`);
    assert.equal(row.tech1, e.move_1, `${e.enemy_id} first technique`);
    assert.equal(row.tech2, e.move_2, `${e.enemy_id} second technique`);
    assert.equal(row.strength, e.str, `${e.enemy_id} strength`);
    assert.equal(row.defence, e.def, `${e.enemy_id} defence`);
    assert.equal(row.spirit, e.spt, `${e.enemy_id} spirit`);
    assert.deepEqual(row.aiMoves, (e.ai_moves ?? []).slice(0, 3), `${e.enemy_id} AI moves`);
    assert.deepEqual(row.counter,
      { action: e.counter?.action ?? 0, comparator: e.counter?.comparator ?? 0, value: e.counter?.value ?? 0 },
      `${e.enemy_id} counter`);
  }
});

test("the first story battle's Kuwagamon: enemy id 0x33 -> record -> bank 0x4e line 65", () => {
  // 1. The walker's first story fight is against the enemy_id "Kuwagamon", which is
  //    enemies.json entry 7.
  const walker = enemies.findIndex((e) => e.enemy_id === "Kuwagamon");
  assert.equal(walker, 7);
  // 2. Its record in resource 0x1cf carries the original's numeric enemy id at +0x00.
  //    docs/research/battle/battle-invocation.md:172 dumped that word for this very
  //    fight — "0x80042b1c+0x18 = 51 (0x33)" — and 0x33 is the id the resolver scans for.
  const row = stats.records[walker];
  assert.equal(row.id, 0x33, "the numeric enemy id the original's descriptor holds");
  // 3. FIGHTSTG_F0x80093364 reads `record + 0x06` and installs bank 0x4e line that.
  assert.equal(row.nameId, 65);
  // 4. Bank 0x4e line 65 is the text the plate shows for this enemy.
  assert.equal(decodeGameName(bankLines("wizard/80.bin")[row.nameId]), "Kuwagamon");
  // 5. And the port, handed that id, puts that bank line on the plate.
  battleMsgSetBank(Object.fromEntries(decoded.strings.map((text, i) => [i, text])));
  battleHudSetNameBank(bankLines("wizard/80.bin").map((b) => decodeGameName(b)));
  const labels = battleHudPlateLabels({ enemyNameId: row.nameId, enemyName: "ignored" });
  assert.equal(labels.enemy.text, "Kuwagamon", "the name comes out of bank 0x4e, not the caller's string");
  assert.equal(labels.enemy.nameId, 65);
  assert.deepEqual([labels.enemy.x, labels.enemy.y, labels.enemy.kind], [17, 21, 1]);
});

test("an enemy outside the table keeps the walker's species name", () => {
  // The original's plate shows nothing when the resolver returns a null record, so the
  // port leaves the element's text empty and the caller falls back to its own name.
  battleHudSetNameBank(bankLines("wizard/80.bin").map((b) => decodeGameName(b)));
  const none = battleHudPlateLabels({ enemyName: "Kuwagamon" });
  assert.equal(none.enemy.nameId, null);
  assert.equal(none.enemy.text, "Kuwagamon");
  assert.ok(none.calls.some((c) => c[0] === "create" && c[2] === 1 && c[3] === 17),
    "the element is still created");
});

// Three species each side, end to end: the disc's own record picks the line, the bank's
// own line decodes to the name, and the port puts that name at the original's place. The
// three enemies are walked through the chain the walker's own battle takes — the enemy_id
// in enemies.json, its row in resource 0x1cf, the +0x06 name line, bank 0x4e — with no
// per-species row anywhere: a fourth species needs no new code.

test("three enemy species: record -> name line -> the name on the plate", () => {
  const names = bankLines("wizard/80.bin").map((b) => decodeGameName(b));
  battleMsgSetBank(Object.fromEntries(decoded.strings.map((text, i) => [i, text])));
  battleHudSetNameBank(names);
  const cases = [
    { walker: 0, record: 0, name: "Kunemon" },
    { walker: 7, record: 7, name: "Kuwagamon" },
    // The walker's own species string for the last one is "Galacticmon" but the enemy is
    // "Galacticmon2", so this also shows the plate reads the bank and not the encounter
    // table's string.
    { walker: 191, record: 191, name: "Galacticmon", enemyId: "Galacticmon2" },
  ];
  const seenIds = new Set();
  const seenLines = new Set();
  for (const c of cases) {
    const row = stats.records[c.record];
    assert.equal(enemies[c.walker].enemy_id, c.enemyId ?? c.name,
      `enemies.json row ${c.walker} is the enemy the record belongs to`);
    assert.equal(Buffer.from(row.raw, "hex").readInt16LE(6), row.nameId,
      `record ${c.record} carries its own name line`);
    assert.ok(!seenIds.has(row.id), `${c.name}: a distinct enemy id (${row.id})`);
    assert.ok(!seenLines.has(row.nameId), `${c.name}: a distinct name line (${row.nameId})`);
    seenIds.add(row.id);
    seenLines.add(row.nameId);
    assert.equal(names[row.nameId], c.name, `bank 0x4e line ${row.nameId} is ${c.name}`);

    const labels = battleHudPlateLabels({
      enemyId: row.id, enemyNameId: row.nameId, enemyName: "ignored",
    });
    assert.equal(labels.enemy.text, c.name, `${c.name}: the plate shows the bank's name`);
    assert.equal(labels.enemy.nameId, row.nameId);
    assert.deepEqual([labels.enemy.x, labels.enemy.y, labels.enemy.kind], [17, 21, 1]);
    // The slash between the HP numbers is the same line whatever is fighting.
    assert.deepEqual(labels.separator, {
      text: "/", kind: 3, x: 268, y: 26, bank: 0x7f, index: 0x10,
    });
  }
});

test("three party species: the plate shows the active member's own stored name", () => {
  // The player side is the other half of the same build: the routine resolves the active
  // party slot through [0x8004b44c], addresses 0x8004949c + slot*0x3dc and installs that
  // record's own bytes as a literal. So three species in three roster slots produce three
  // different record addresses, and the text is whatever the roster holds — the nickname
  // once the Digimon has been renamed, which is why the port is handed the string.
  battleMsgSetBank(Object.fromEntries(decoded.strings.map((text, i) => [i, text])));
  battleHudSetNameBank(bankLines("wizard/80.bin").map((b) => decodeGameName(b)));
  const digimon = JSON.parse(readFileSync(join(dir, "digimon.json"), "utf8")).digimon;
  const party = [[0, 3], [1, 7], [2, 8]];
  const seen = new Set();
  for (const [slot, species] of party) {
    const stored = digimon.find((d) => d.id === species).name;
    assert.ok(!seen.has(stored), `${stored}: three different species`);
    seen.add(stored);
    const labels = battleHudPlateLabels({
      activePlayerIndex: slot, playerName: stored, enemyNameId: 65,
    });
    assert.equal(labels.player.text, stored, `slot ${slot} shows ${stored}`);
    assert.equal(labels.player.source >>> 0, 0x8004949c + slot * 988,
      `slot ${slot} is the roster record at the 988-byte stride`);
    assert.equal(labels.player.index, -1, "installed as a literal, not as a bank line");
    assert.deepEqual([labels.player.x, labels.player.y, labels.player.kind], [174, 21, 1]);
    // A rename is the same case: the plate follows the stored string.
    const renamed = battleHudPlateLabels({
      activePlayerIndex: slot, playerName: `${stored}-jr`, enemyNameId: 65,
    });
    assert.equal(renamed.player.text, `${stored}-jr`);
  }
});
