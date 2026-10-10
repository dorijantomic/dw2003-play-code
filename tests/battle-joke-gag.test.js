// The joke gag a confused partner gets: the two words of the battle message box, and the
// box the original draws around them.
//
// What the player sees when a confused Digimon picks a joke and the roll comes up gag
// (FIGHTSTG_F0x8009a898 state 1, fightstg.s:24667-24759):
//
//   * the battle's own window picture, PGFGTC00 cel 0x31 (296 x 38), at native (11, 188).
//     FIGHTSTG_F0x8009a3b4 (fightstg.s:24273-24361) is the ordinary message draw
//     FIGHTSTG_F0x80098924 (:22521-22610) with its three fields moved by +0x14
//     (gate 0x98 -> 0xac, stamp 0x94 -> 0xa8, frame 0x90 -> 0xa4): the SAME panel, the
//     SAME cel, the SAME place. There is no joke pose icon; the joke turn uses the
//     message box like every other battle line.
//   * line 1 at native (20, 194) is the acting Digimon's NAME, and line 2 at (20, 208) is
//     the joke's phrase. FIGHTSTG_F0x8009a734 (fightstg.s:24505-24595) builds them with
//     `F0x8001ae38(0x1005, 1, 0x14, 0xc2)` / `0xd0`, esmfight 0x16 — the bare `{1}` the
//     shared tail fills — on the first, and the halfword at +2 of its own table entry on
//     the second. **Not** "<name> is confused!": "Confused!" is esmfight 32, the message
//     the game prints when the ailment is applied, a different line entirely.
//   * a small glyph blinks at native (291, 208) once the last line has been up four
//     display ticks, until Circle closes the line with sound 0x0004001c.
//
// The phrase index is read off the table at 0x800a35e4 (fightstg.s:33989-34004): entry
// `2*joke + (rand() & 1)`, its halfword at +2 = `0x73 + 2*joke + bit`. So joke 0 is
// "Grinning!"/"Shiny white teeth!", joke 1 "Confessing!"/"\"I love sweet things\"", and so
// on through joke 7's "Can't stop crying!"/"Tears are salty!".
//
// The words come from the disc's own bank: web/assets/data/battlecmd/esmfight.json, built
// by tools/extract_battle_text.py from ~/ddw3/lang_file/dw2003/eng/esmfight.toml, bank 0x7f.
// tests/lane-b/battle-message-words.test.js runs the ORIGINAL VM arm 7 over
// web/assets/native/screens/pro_fightstg.bin and diffs the element calls, which is what
// fixes the two indices; this file pins every joke and both bits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BattleMessageSession } from "../engine/dw3/ui/battle-message-session.ts";
import {
  BATTLE_MESSAGE_PANEL_CEL, BATTLE_MESSAGE_PANEL_PACK, BATTLE_MESSAGE_PANEL_W,
  BATTLE_MESSAGE_PANEL_H, BATTLE_MESSAGE_PANEL_X, BATTLE_MESSAGE_PANEL_Y,
  BATTLE_MESSAGE_PROMPT_CEL, BATTLE_MESSAGE_PROMPT_PACK, BATTLE_MESSAGE_PROMPT_X,
  BATTLE_MESSAGE_PROMPT_Y, battleMessageNamesLineOne,
} from "../engine/dw3/ui/native/battle-message-line.ts";
import {
  JOKE_COMMANDS, JOKE_FLAVOR, JOKE_FLAVOR_FIRST_ID, JOKE_GAG_BANK, JOKE_GAG_KIND,
  JOKE_GAG_NAME_ID, jokeFlavorMessageId, jokeFlavorPick,
} from "../engine/dw3/battle-confusion.ts";
import { MSG_KIND, jokeGagMessageSpec } from "../web/battle.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bank = JSON.parse(
  readFileSync(join(root, "web/assets/data/battlecmd/esmfight.json"), "utf8"));
const STRING = (index) => bank.strings[index] ?? "";

const session = () => new BattleMessageSession({
  textOf: (b, index) => (b === JOKE_GAG_BANK ? STRING(index) : ""),
  paint: () => {},
});

/** Open a gag the way web/battle.js does and run its reveal out. */
function playedGag(name, jokeIndex, bit, ticks = 12) {
  const s = session();
  s.openOriginal(jokeGagMessageSpec(name, jokeIndex, bit));
  for (let tick = 0; tick < ticks; tick++) s.tick(tick, 0);
  return s;
}

test("the gag takes the shared message arm, so it never prints \"is confused!\"", () => {
  // F0x8009a734's two lines are the shared VM arm 7's shape (.L0x80099908):
  // esmfight 0x16 on line one, the caller's own index on line two, two lines counted at
  // `sw $v0, 0x7c($a0)`, and the shared tail filling slot 1 of line one.
  assert.equal(JOKE_GAG_KIND, 7);
  assert.equal(MSG_KIND.JOKE_GAG, 7);
  assert.ok(battleMessageNamesLineOne(JOKE_GAG_KIND),
    "arm 7 reaches F0x80098d14, which is what fills the name into {1}");
  assert.equal(STRING(JOKE_GAG_NAME_ID), "{1}", "line one's template is the bare name slot");
  // "Confused!" exists in the bank, and it is NOT what a gag prints.
  assert.equal(STRING(32), "Confused!");
});

test("every joke, on both bits, prints the name and the game's own phrase", () => {
  assert.equal(JOKE_FLAVOR.length, JOKE_COMMANDS.length, "eight jokes, eight pairs");
  for (let joke = 0; joke < JOKE_COMMANDS.length; joke++) {
    for (const bit of [0, 1]) {
      const id = jokeFlavorMessageId(joke, bit);
      assert.equal(id, JOKE_FLAVOR_FIRST_ID + 2 * joke + bit,
        `joke ${joke} bit ${bit}: esmfight[${id}]`);
      assert.equal(STRING(id), JOKE_FLAVOR[joke][bit],
        `joke ${joke} (${JOKE_COMMANDS[joke]}) bit ${bit} reads esmfight[${id}]`);
      const spec = jokeGagMessageSpec("Kuwagamon", joke, bit);
      assert.equal(spec.kind, JOKE_GAG_KIND, `joke ${joke} bit ${bit}: the shared arm`);
      assert.deepEqual(spec.payload, [id], `joke ${joke} bit ${bit}: the payload index`);
      assert.equal(spec.name, "Kuwagamon");
      const s = playedGag("Kuwagamon", joke, bit);
      assert.deepEqual(s.lines(), ["Kuwagamon", JOKE_FLAVOR[joke][bit]],
        `joke ${joke} (${JOKE_COMMANDS[joke]}) bit ${bit}`);
      assert.equal(s.lines().join(" ").includes("confused"), false,
        `joke ${joke} bit ${bit} must not read "is confused!"`);
    }
  }
});

test("the bank holds the two lines of every pair, and the phrases are the disc's own", () => {
  // Spelled out here so a bank edit that renumbers the table cannot pass silently.
  assert.deepEqual(
    JOKE_FLAVOR.map((pair, joke) => [
      STRING(jokeFlavorMessageId(joke, 0)), STRING(jokeFlavorMessageId(joke, 1)),
    ]),
    [
      ["Grinning!", "Shiny white teeth!"],
      ["Confessing!", '"I love sweet things"'],
      ["Dancing!", '"Whoa, dizzy!"'],
      ["Packing!", '"I\'m leaving this house!"'],
      ["Boasting!", '"I\'m the best!"'],
      ["Posing!", '"Hi, there"'],
      ["Angry!", '"I\'m leaving you!"'],
      ["Can't stop crying!", "Tears are salty!"],
    ],
  );
});

test("the random bit picks the phrase, and the index it feeds is that phrase", () => {
  for (let seed = 0; seed < 16; seed++) {
    // .L0x8009aad0/`.L0x8009aae0` take one fresh rand() and `.L0x8009ab04 or $a1, $v0`
    // keeps its low bit, doubling the shuffled joke entry first (.L0x8009aafc).
    let calls = 0;
    const rng = () => { calls++; return seed; };
    const pick = jokeFlavorPick(3, rng);
    assert.equal(calls, 1, "the original draws exactly once for the pair");
    assert.equal(pick.bit, seed & 1, `seed ${seed}`);
    assert.equal(pick.msgId, jokeFlavorMessageId(3, seed & 1), `seed ${seed}`);
    assert.equal(pick.text, STRING(pick.msgId), `seed ${seed}: words and index agree`);
  }
});

test("the gag is drawn in the battle's own box, with the game's own prompt", () => {
  // F0x8009a3b4 (:24273-24361) is F0x80098924 (:22521-22610) with the three prompt fields
  // at +0x14, so the panel and the glyph are the message line's, not the joke list's.
  const s = playedGag("Kuwagamon", 0, 0, 9);
  const frame = s.frame();
  assert.deepEqual(frame.panel, {
    pack: 0x04550000, cel: 0x31, x: 0x0b, y: 0xbc, w: 296, h: 38,
  }, "PGFGTC00 cel 49 at native (11, 188)");
  assert.equal(BATTLE_MESSAGE_PANEL_PACK, frame.panel.pack);
  assert.equal(BATTLE_MESSAGE_PANEL_CEL, frame.panel.cel);
  assert.equal(BATTLE_MESSAGE_PANEL_X, frame.panel.x);
  assert.equal(BATTLE_MESSAGE_PANEL_Y, frame.panel.y);
  assert.equal(BATTLE_MESSAGE_PANEL_W, frame.panel.w);
  assert.equal(BATTLE_MESSAGE_PANEL_H, frame.panel.h);
  assert.ok(frame.prompt, "the glyph blinks once the last line has landed");
  assert.equal(frame.prompt.pack, 0x02860000, "CMFONT");
  assert.equal(frame.prompt.cel, 0x0a);
  assert.equal(frame.prompt.x, 0x123, "native (291, 208)");
  assert.equal(frame.prompt.y, 0xd0);
  assert.equal(BATTLE_MESSAGE_PROMPT_PACK, frame.prompt.pack);
  assert.equal(BATTLE_MESSAGE_PROMPT_CEL, frame.prompt.cel);
  assert.equal(BATTLE_MESSAGE_PROMPT_X, frame.prompt.x);
  assert.equal(BATTLE_MESSAGE_PROMPT_Y, frame.prompt.y);
});

test("the gag shows the name first, the phrase four display ticks later", () => {
  // F0x8009a514's phase 1 stamps the tick and sets the gap to 3 (.L0x8009a59c/.L0x8009a5a0)
  // showing one whole line, and phase 2 shows the next when the elapsed count passes it
  // (.L0x8009a5f0 `subu` / `.L0x8009a5f4 slt`) — the ordinary message line's cadence.
  const s = session();
  s.openOriginal(jokeGagMessageSpec("Kuwagamon", 4, 0));
  assert.deepEqual(s.lines(), ["Kuwagamon", ""], "the phrase waits for the reveal");
  let stampedAt = -1;
  let arrivedAt = -1;
  let glyphAt = -1;
  for (let tick = 0; tick < 20; tick++) {
    s.tick(tick, 0);
    if (stampedAt < 0 && s.machine.visibleLines >= 1) stampedAt = tick;
    if (arrivedAt < 0 && s.machine.visibleLines >= 2) arrivedAt = tick;
    if (glyphAt < 0 && s.promptVisible) glyphAt = tick;
  }
  assert.equal(s.lines()[0], "Kuwagamon", "the name is on the first line, whole");
  assert.equal(s.lines()[1], "Boasting!", "and the joke's phrase on the second");
  assert.equal(arrivedAt - stampedAt, 4,
    "the phrase lands four ticks after the stamp (.L0x8009a5f4 over the gap 3)");
  assert.equal(glyphAt, arrivedAt,
    "the glyph starts with the last line (.L0x8009a620, the Circle test's delay slot)");
});

test("Circle closes the gag and nothing else does", () => {
  // F0x8009a514 phase 2 tests `andi $v0, $s2, 0x2000` (.L0x8009a618) and there is no
  // timeout: the line stays up until the button is down.
  const s = session();
  s.openOriginal(jokeGagMessageSpec("Kuwagamon", 6, 1));
  for (let tick = 0; tick < 400; tick++) assert.equal(s.tick(tick, 0), false, `tick ${tick}`);
  assert.equal(s.finished, false);
  assert.equal(s.tick(400, 0x2000), true, "one Circle press ends the line");
  assert.equal(s.finished, true);
  assert.equal(s.promptVisible, false, "the glyph goes with the line");
});

test("web/battle.js asks for that line instead of writing its own sentence", () => {
  // The gag branch of applyPlayerAction must go through the shared panel. Read the source
  // so a future edit that reintroduces a walker-written combined line fails here.
  const src = readFileSync(join(root, "web/battle.js"), "utf8");
  const branch = src.slice(src.indexOf('if (action.type === "confused")'));
  const body = branch.slice(0, branch.indexOf('} else if (action.type === "tag")'));
  assert.match(body, /jokeGagMessageSpec\(/,
    "the confused branch asks the shared panel for the gag's two lines");
  assert.doesNotMatch(body.slice(body.indexOf("sayOriginal")),
    /^\s*b\.message\s*=\s*prefix\s*\+\s*`\$\{pname\} is confused!/m,
    "the gag line is no longer the walker's own single sentence");
});