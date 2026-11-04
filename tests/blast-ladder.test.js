// The Blast ladder: one card per starter, the five forms its Blast can reach,
// and the exact partner-level bracket that reaches each of them.
//
// The facts, all read (never guessed):
//   * the target of a Blast is the ROOKIE profile's `blasts[tier]`
//     (digivolution-tech-system-decoded-2026-07-11.md §9 step 3, profile byte
//     +0x50+tier, a DigimonId) — so every starter's ladder is five ids from
//     web/assets/data/digimon.json, resolved through the same profile table;
//   * the tier is the PARTNER's battle level, roster record +0x1c, on the ladder
//     <4 -> 0, <19 -> 1, <39 -> 2, <70 -> 3, else 4 (§9 step 2) — the same
//     ladder engine/dw3/battle-formulas.ts::levelTier implements;
//   * Blast is automatic, temporary, and never touches the form ledger (§9).
//
// The page is an in-game screen behind F2 -> Extras -> "Blast ladder (new)",
// off by default: web/blast-ladder.js is DOM-free and node imports it, the
// browser wires tickBlastLadder / blastPress / blastDraw into web/game.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLAST_BRACKETS, blastCards, blastCardCount, blastCardIndex, blastDraw, blastLoad, blastOpen,
  blastPress, blastReset, tierForLevel, tickBlastLadder, openBlastLadder,
} from "../web/blast-ladder.js";
import { levelTier } from "../engine/dw3/battle-formulas.ts";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const digimon = JSON.parse(read("../web/assets/data/digimon.json"));
const nameById = new Map(digimon.digimon.map((p) => [p.id, p.name]));

/** A canvas context that records every string it is asked to draw. */
function recorder() {
  const texts = [];
  const target = {
    texts,
    canvas: { width: 640, height: 480 },
    fillText: (text) => { texts.push(String(text)); },
    measureText: (text) => ({ width: String(text).length * 6 }),
  };
  return new Proxy(target, {
    get(t, k) { return k in t ? t[k] : () => {}; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const drawn = () => {
  const ctx = recorder();
  blastDraw(ctx, null, 640, 480);
  return ctx.texts.join("\n");
};

test("one card per starter, five forms each, every id a real profile", () => {
  const cards = blastCards(digimon);
  assert.equal(cards.length, 8, "the disc's eight starters");
  assert.deepEqual(cards.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8], "starters 1..8, in id order");
  for (const card of cards) {
    assert.equal(typeof card.starter, "string");
    assert.equal(card.forms.length, 5, `${card.starter} has five Blast forms`);
    card.forms.forEach((form, tier) => {
      assert.equal(form.tier, tier, `${card.starter} form ${tier} is tier ${tier}`);
      assert.equal(form.min, BLAST_BRACKETS[tier][0]);
      assert.equal(form.max, BLAST_BRACKETS[tier][1]);
      assert.ok(form.id > 0, `${card.starter} form ${tier} carries a profile id`);
      assert.equal(form.name, nameById.get(form.id), `${card.starter} form ${tier} resolves to a profile name`);
    });
  }
});

test("a form row can name the form's own signature technique from skills", () => {
  const cards = blastCards(digimon, digimon.skills);
  const dinohumon = digimon.digimon.find((p) => p.name === "Dinohumon");
  const signature = digimon.skills.find((s) => s.id === dinohumon.tech_signature);
  const kotemon = cards.find((c) => c.starter === "Kotemon");
  assert.equal(kotemon.forms[0].technique, signature.name, "the rookie row names what the form hits with");
  for (const card of cards) for (const form of card.forms)
    assert.equal(typeof form.technique, "string", `${card.starter} / ${form.name} names a technique`);
});

test("the five brackets are the partner-level ladder the engine reads", () => {
  assert.deepEqual(BLAST_BRACKETS, [[1, 3], [4, 18], [19, 38], [39, 69], [70, 99]]);
});

test("Kotemon's ladder is exactly Dinohumon, Kyukimon, GuardiAngemon, GranKuwagamon, MaloMyotismon", () => {
  const kotemon = blastCards(digimon).find((c) => c.starter === "Kotemon");
  assert.ok(kotemon, "Kotemon is a starter");
  assert.deepEqual(kotemon.forms.map((f) => f.name), [
    "Dinohumon", "Kyukimon", "GuardiAngemon", "GranKuwagamon", "MaloMyotismon",
  ]);
});

test("tierForLevel is the event-0x12 ladder and agrees with the engine for every level", () => {
  assert.equal(tierForLevel(1), 0);
  assert.equal(tierForLevel(3), 0);
  assert.equal(tierForLevel(4), 1);
  assert.equal(tierForLevel(18), 1);
  assert.equal(tierForLevel(19), 2);
  assert.equal(tierForLevel(38), 2);
  assert.equal(tierForLevel(39), 3);
  assert.equal(tierForLevel(69), 3);
  assert.equal(tierForLevel(70), 4);
  assert.equal(tierForLevel(99), 4);
  for (let level = 1; level <= 99; level++) {
    assert.equal(tierForLevel(level), levelTier(level), `level ${level} agrees with engine levelTier`);
  }
});

test("a card shows the five brackets and says Blast is automatic, temporary and leaves the ledger alone", async () => {
  blastReset();
  await blastLoad(async () => ({ json: async () => digimon }));
  openBlastLadder();
  const text = drawn();
  assert.match(text, /Kotemon/, "the card names the starter");
  for (const name of ["Dinohumon", "Kyukimon", "GuardiAngemon", "GranKuwagamon", "MaloMyotismon"])
    assert.ok(text.includes(name), `the card names ${name}`);
  for (const bracket of ["level 1-3", "level 4-18", "level 19-38", "level 39-69", "level 70-99"])
    assert.ok(text.includes(bracket), `the card names the bracket "${bracket}"`);
  assert.match(text, /automatic/i);
  assert.match(text, /temporary/i);
  assert.match(text, /never changes your learned forms/i);
  assert.match(text, /roster \+0x1c/, "the card says where the tier is read from");
  assert.match(text, /partner/i, "the level is the partner's, not the form's");
});

test("with the F2 switch off there is no page and no press is taken", () => {
  blastReset();
  assert.equal(tickBlastLadder(false), false, "the switch off leaves it closed");
  assert.equal(blastOpen(), false);
  const ctx = recorder();
  assert.equal(blastDraw(ctx, null, 640, 480), false, "nothing is drawn");
  assert.equal(ctx.texts.length, 0, "not a single string reaches the canvas");
  assert.equal(blastPress("cross"), false, "the pad falls through");
  assert.equal(blastPress("right"), false);
});

test("the F2 button opens it on the first card; Left/Right walk the eight; Cross closes", async () => {
  blastReset();
  await blastLoad(async () => ({ json: async () => digimon }));
  assert.equal(blastCardCount(), 8);
  let opened = false;
  for (let frame = 0; frame < 3; frame++) opened = tickBlastLadder(true);
  assert.equal(opened, false, "the switch on opens nothing");
  assert.equal(openBlastLadder(), true, "the F2 button opens the page");
  assert.equal(blastCardIndex(), 0, "it opens on the first starter");
  assert.equal(blastPress("right"), true);
  assert.equal(blastCardIndex(), 1);
  assert.equal(blastPress("left"), true);
  assert.equal(blastCardIndex(), 0);
  assert.equal(blastPress("left"), true);
  assert.equal(blastCardIndex(), 7, "Left wraps to the last starter");
  assert.equal(blastPress("right"), true);
  assert.equal(blastCardIndex(), 0, "Right wraps to the first");
  assert.equal(blastPress("cross"), true, "Cross is the page's");
  assert.equal(blastOpen(), false, "and it closes");
  assert.equal(blastPress("cross"), false, "the next press falls through");
  assert.equal(tickBlastLadder(false), false, "the switch going off keeps it closed");
  assert.equal(tickBlastLadder(true), false, "and switching it back on does not reopen it");
  openBlastLadder();
  assert.equal(tickBlastLadder(false), false, "the switch off closes an open page");
  assert.equal(blastOpen(), false);
});

test("blastLoad reads the shipped table through the page's own fetch", async () => {
  blastReset();
  const urls = [];
  const ok = await blastLoad(async (url) => {
    urls.push(url);
    return { json: async () => digimon };
  });
  assert.equal(ok, true);
  assert.deepEqual(urls, ["assets/data/digimon.json"]);
  const cards = blastCards(digimon);
  openBlastLadder();
  assert.equal(blastCardIndex(), 0);
  assert.match(drawn(), new RegExp(cards[0].starter), "the loaded card draws");
});

test("web/game.js gates the page on window.__fx?.blastladder and routes the pad and the draw to it", () => {
  const game = read("../web/game.js");
  assert.match(game, /window\.__fx\?\.blastladder === true/, "the source gate is the F2 flag");
  assert.match(game, /tickBlastLadder\(window\.__fx\?\.blastladder === true\)/, "the page follows the switch");
  assert.match(game, /if \(blastOpen\(\)\) return;/, "the field is frozen while it is up");
  assert.match(game, /if \(blastPress\(k\)\)/, "the pad goes to the page");
  assert.match(game, /blastDraw\(ctx, null, VIEW_W, VIEW_H\)/, "the page draws over everything");
  assert.match(game, /fieldFullScreenUiOpen\(\)[\s\S]{0,700}blastOpen\(\)/, "a full-screen page covers the wide sides");
});

test("the F2 Extras row is off by default", () => {
  const ambience = read("../web/ambience.js");
  assert.match(ambience, /\["blastladder", "Blast ladder \(new\)"\]/, "the Extras row");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
  assert.ok(experimental, "EXPERIMENTAL is still one array literal");
  assert.match(experimental[1], /"blastladder"/, "off until the player switches it on");
  assert.doesNotMatch(ambience, /(get|has)\("blastladder"\)/, "never a URL flag");
});
