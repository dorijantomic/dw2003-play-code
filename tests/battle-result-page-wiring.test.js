// The result-page chooser is WIRED into every landed-blow commit, on both sides.
//
// Split from tests/battle-result-page-chooser.test.js so it fails as an ASSERTION on the
// code before this change, not as a module error: this file imports nothing from the engine
// bundle, only the two sources it reads.
//
// FIGHTSTG_F0x8008cb70 (`~/ddw3/asm/dw2003/pro/fightstg.s:10141-:10656`) picks the line for
// a blow that has just landed, and its second arm — queue slot 6, the instant-death KO byte —
// prints nothing and takes the damage line with it. Before this change web/battle.js put up a
// result line for that case on all three commit sites: the player's basic attack, the player's
// technique and the enemy's attack.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSource } from "./helpers/source.js";

const src = readSource(new URL("../web/battle.js", import.meta.url));
const translated = readSource(
  new URL("../web/battlemsg-translated.js", import.meta.url));

test("all three landed-blow commit sites ask the chooser", () => {
  const calls = src.match(/= chooseResultLine\(\{/g) ?? [];
  assert.equal(calls.length, 3,
    "the player's basic attack, the player's technique and the enemy's attack");
});

test("the KO words are never a page, on either side", () => {
  assert.equal((src.match(/struck down/g) ?? []).length, 1,
    "the walker's own flat-text line in applyWeaponSecondary, and nothing else");
  assert.equal(/page:\s*` \$\{defenderName\} was struck down/.test(src), false);
  // Before this change the page list's first entry was built unconditionally on all three
  // sites. Each now guards it on the chooser's answer.
  assert.equal((src.match(/resultLine\s*\?\s*\{ text: prefix \+ message,/g) ?? []).length, 2,
    "the two player-side commit sites guard the damage page");
  assert.equal(/if \(resultLine\) pages\.push/.test(src), true,
    "the enemy-side commit site guards the damage page");
});

test("a silent arm empties the box instead of leaving the last line up", () => {
  assert.equal((src.match(/if \(!b\._resultPages\.length\) B\.clearBattleLine\(b\);/g) ?? []).length, 2,
    "both player-side commit sites");
  assert.equal(/if \(!pages\.length\) B\.clearBattleLine\(b\);/.test(src), true,
    "and the enemy-side commit site");
});

test("the renderer is not chosen by a URL flag", () => {
  // Nothing on the chooser's path reads the URL, so the walker's own sentence is computed
  // the same way whichever renderer is on.
  assert.doesNotMatch(translated, /URLSearchParams/);
  assert.doesNotMatch(src, /chooseResultLine[\s\S]{0,200}URLSearchParams/);
});
