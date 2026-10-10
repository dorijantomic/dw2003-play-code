// Every field a CARDPAK record carries, read straight off the disc and compared
// to the shipped catalogue -- the check that the catalogue is not missing a
// field the record holds.
//
// The extractor (tools/extract_card_catalog.py) writes card_catalog.json from
// CARDPAK0..4.BIN through the resident selector F0x8001E7EC. This test does not
// trust it: it re-reads the same five disc files and recomputes every field at
// its own offset and width, then asserts the committed catalogue agrees for all
// 316 records. The field list is the one established in
// docs/research/card/CARD-DUEL-VERIFIED.md S8.1 (colour +0x00, AP +0x01, HP
// +0x02, kind +0x03, program cost +0x04, summon cost +0x05, level +0x06,
// strength rank +0x08 u16, combo target +0x0A u16), and +0x07 is the one byte
// the record holds that has no established meaning.
//
// The disc lives at ~/ddw3 and is read-only; when it is not present the
// disc-side assertions are skipped and only the catalogue's completeness is
// checked (the shipped JSON is still the artefact under test).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG = JSON.parse(
  readFileSync(new URL("../web/assets/data/card_catalog.json", import.meta.url), "utf8"),
);
const COLOURS = { 1: "white", 2: "blue", 3: "green", 4: "red", 5: "black", 6: "brown" };
const STAGES = { 2: "rookie", 3: "champion", 4: "ultimate", 5: "mega" };
const STRIDE = 1580;

const DISC = join(homedir(), "ddw3", "dw2003", "AAA", "DAT", "CARD");

/** Smudge a git-lfs pointer through the local binary, else return the bytes. */
function readPak(path) {
  const raw = readFileSync(path);
  if (!raw.subarray(0, 40).toString("latin1").startsWith("version https://git-lfs.github.com")) {
    return raw;
  }
  const lfs = join(homedir(), "bin", "git-lfs");
  const bin = existsSync(lfs) ? lfs : "git-lfs";
  return execFileSync(bin, ["smudge"], { input: raw, cwd: join(homedir(), "ddw3") });
}

function discRecords() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const blob = readPak(join(DISC, `CARDPAK${i}.BIN`));
    assert.equal(blob.length % STRIDE, 0, `CARDPAK${i}.BIN is a whole number of ${STRIDE}-byte records`);
    for (let j = 0; j < blob.length / STRIDE; j++) out.push(blob.subarray(j * STRIDE, (j + 1) * STRIDE));
  }
  return out;
}

/** The record's own field set, recomputed from its bytes at their real widths. */
function fields(record) {
  const digimon = record[3] === 0x10;
  const card = {
    colour: COLOURS[record[0]] ?? record[0],
    ap: record[1],
    hp: record[2],
    kind: digimon ? "digimon" : "program",
    programCost: record[4],
    summonCost: record[5],
    level: record[6],
    strengthRank: record.readUInt16LE(8),
    comboInto: record.readUInt16LE(10),
  };
  if (digimon) card.stage = STAGES[record[6]] ?? record[6];
  else card.programCategory = record[3];
  return card;
}

const hasDisc = existsSync(join(DISC, "CARDPAK0.BIN"));

test("every catalogue card carries every leading record field", () => {
  assert.equal(CATALOG.cards.length, 316);
  for (const card of CATALOG.cards) {
    for (const key of ["colour", "ap", "hp", "kind", "programCost", "summonCost", "level", "strengthRank", "comboInto"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(card, key), `card ${card.id} is missing ${key}`);
    }
    // The old spellings still read, so an older consumer is not broken.
    assert.equal(card.summonCost, card.kind === "digimon" ? card.summonTier : card.summonCost);
    if (card.kind === "program") assert.equal(card.programCost, card.cost, `card ${card.id} programCost == cost`);
  }
  // A Program holds a real program cost; its summon cost and level are the
  // disc's own zeros -- carried, not defaulted.
  const sacredSpear = CATALOG.cards.find((c) => c.id === 1);
  assert.equal(sacredSpear.kind, "program");
  assert.equal(sacredSpear.programCost, 4);
  assert.equal(sacredSpear.summonCost, 0);
  assert.equal(sacredSpear.level, 0);
});

test("the catalogue equals the disc for all 316 records, field by field", { skip: !hasDisc }, () => {
  const recs = discRecords();
  assert.equal(recs.length, 316, "five CARDPAK files hold 316 records");
  for (let i = 0; i < recs.length; i++) {
    const fromDisc = fields(recs[i]);
    const fromCatalog = CATALOG.cards[i];
    assert.equal(fromCatalog.id, i + 1);
    for (const key of ["colour", "ap", "hp", "kind", "programCost", "summonCost", "level", "strengthRank", "comboInto"]) {
      assert.equal(fromCatalog[key], fromDisc[key], `card ${i + 1} ${key}`);
    }
    if (fromDisc.kind === "digimon") assert.equal(fromCatalog.stage, fromDisc.stage, `card ${i + 1} stage`);
    else assert.equal(fromCatalog.programCategory, fromDisc.programCategory, `card ${i + 1} programCategory`);
    // +0x07 has no established meaning and is zero on every record; the
    // extractor leaves it out rather than naming a guess at it.
    assert.equal(recs[i][7], 0, `card ${i + 1} +0x07 is zero`);
  }
});
