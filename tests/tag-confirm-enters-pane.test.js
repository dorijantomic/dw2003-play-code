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
import { readSource } from "./helpers/source.js";

const source = readSource(process.env.TAG_BATTLE_SOURCE || "web/battle.js");

/** The end of a string / template / comment starting at `i`, or `i` when there is none. */
function skipLiteral(src, i) {
  const c = src[i];
  if (c === '"' || c === "'" || c === "`") {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === "\\") { j += 2; continue; }
      if (src[j] === c) return j + 1;
      j++;
    }
    return j;
  }
  if (c === "/" && src[i + 1] === "/") { const j = src.indexOf("\n", i); return j < 0 ? src.length : j; }
  if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); return j < 0 ? src.length : j + 2; }
  return i;
}

// The confirm body is one function in one of the split files now, so the slice ends at its
// own closing brace rather than at the next doc comment (which may be in another file).
function sliceFunction(name) {
  const sig = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(sig, `${name} is defined in the battle source`);
  let i = sig.index + sig[0].length;
  let parens = 1;                                   // inside the parameter list
  while (i < source.length && parens > 0) {
    const s = skipLiteral(source, i);
    if (s > i) { i = s; continue; }
    if (source[i] === "(") parens++;
    else if (source[i] === ")") parens--;
    i++;
  }
  while (i < source.length && source[i] !== "{") i++;
  let body = 0;
  while (i < source.length) {
    const s = skipLiteral(source, i);
    if (s > i) { i = s; continue; }
    if (source[i] === "{") body++;
    else if (source[i] === "}") { body--; if (!body) { i++; break; } }
    i++;
  }
  return source.slice(sig.index, i);
}

/** The real confirmTag, wired to the dependencies it reads. */
function makeConfirmTag() {
  const ST = { PLAYER_MENU: 2, PLAYER_TAG: 11, PLAYER_TAG_FORM: 12, PLAYER_DNA_CHOICE: 15 };
  const formOptionsFor = () => [{ id: 9, name: "Kyubimon" }];
  const dnaChoiceFor = () => null;
  const applyTagAction = () => true;
  // The shared closure object the moved battle functions read each other through.
  const B = { formOptionsFor, dnaChoiceFor, applyTagAction };
  const fn = new Function(
    "ST", "B", "formOptionsFor", "dnaChoiceFor", "applyTagAction",
    sliceFunction("confirmTag") + "\nreturn confirmTag;",
  )(ST, B, formOptionsFor, dnaChoiceFor, applyTagAction);
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
