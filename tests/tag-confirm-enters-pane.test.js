// Playtest bug 12b: confirming a TAG row must reach the DNA pane directly.
//
// The disc has no separate form screen between the partner list and the pane:
// confirming a row answers the chosen party POSITION and the coordinator spawns
// ONE follow-up object -- the DNA pane (fightstg.s:16343 F0x800988fc delegates
// to F0x80098884, allocated at :22481). The walker used to open a hand-drawn
// form screen (state PLAYER_TAG_FORM=12) first, which duplicated the pane's own
// species sub-state and showed a screen labelled with one form name before the
// real RENAMON / KYUBIMON pane.
//
// This test evaluates the real confirmTag body out of web/battle.js (the same
// technique tests/lane-b/dna-path-branches.test.js uses for applyDnaAnswer) and
// asserts that a confirmed position seats the pane. It FAILS on the old
// confirmTag (which set state 12) and passes on the fixed one (state 15).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(process.env.TAG_BATTLE_SOURCE || "web/battle.js", "utf8");

function sliceFunction(name) {
  const begin = source.indexOf(`  function ${name}(`);
  assert.ok(begin > 0, `${name} is defined in web/battle.js`);
  const end = source.indexOf("\n  /**", begin);
  assert.ok(end > begin, `${name} has an end boundary`);
  return source.slice(begin, end);
}

/** The real confirmTag, wired to the dependencies it reads. */
function makeConfirmTag() {
  const ST = { PLAYER_MENU: 2, PLAYER_TAG: 11, PLAYER_TAG_FORM: 12, PLAYER_DNA_CHOICE: 15 };
  const formOptionsFor = () => [{ id: 9, name: "Kyubimon" }];
  const dnaChoiceFor = () => null;
  const applyTagAction = () => true;
  const USE_ORIGINAL_TAG_SWAP = true;
  const fn = new Function(
    "ST", "formOptionsFor", "dnaChoiceFor", "applyTagAction", "USE_ORIGINAL_TAG_SWAP",
    sliceFunction("confirmTag") + "\nreturn confirmTag;",
  )(ST, formOptionsFor, dnaChoiceFor, applyTagAction, USE_ORIGINAL_TAG_SWAP);
  return { fn, ST };
}

const battle = () => ({
  state: 11,
  tagTargetIndex: null,
  formSel: 5,
  dnaSel: 5,
  _dnaChoice: undefined,
  playerRoster: [{}, { name: "Renamon", id: 9 }, {}],
});

test("a TAG row confirm seats the DNA pane, with no intermediate form screen", () => {
  const { fn, ST } = makeConfirmTag();
  const b = battle();
  fn(b, 1);
  assert.equal(b.state, ST.PLAYER_DNA_CHOICE,
    "the confirm reaches the pane state directly");
  assert.notEqual(b.state, ST.PLAYER_TAG_FORM,
    "no hand-drawn form screen is entered");
  assert.equal(b.tagTargetIndex, 1, "the chosen party position is kept");
  assert.equal(b.formSel, 0, "the form cursor resets");
  assert.equal(b.dnaSel, 0, "the pane row cursor starts on Switch");
  assert.ok(b._dnaChoice && b._dnaChoice.rosterIndex === 1,
    "the pane is seated with the partner's party position");
  assert.equal(b._dnaChoice.formId, 9,
    "the partner's live form is the pane's fallback form");
  assert.equal(b._dnaChoice.switchOnly, true,
    "no DNA pairing => the one-row Switch pane");
});

test("a partner with no roster record returns to the command list", () => {
  const { fn, ST } = makeConfirmTag();
  const b = battle();
  fn(b, 9);
  assert.equal(b.state, ST.PLAYER_MENU);
});

test("the walker no longer declares or drives a tag form state", () => {
  assert.ok(!/PLAYER_TAG_FORM\s*:/.test(source),
    "no PLAYER_TAG_FORM state is declared");
  assert.ok(!/b\.state === ST\.PLAYER_TAG_FORM/.test(source),
    "no code branches on the removed tag form state");
  assert.ok(!/drawFormMenu\(b, b\.tagTargetIndex/.test(source),
    "the tag form screen is no longer drawn");
});
