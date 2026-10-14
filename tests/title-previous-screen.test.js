// The title's attract loop reads the resident launcher's PREVIOUS screen code
// when its Japanese idle timeout fires.
//
// stdwtitl's choice dispatcher F0x80086834 calls the previous-code getter
// 0x80016B58 (the word at 0x8004B400, through the game context's slot
// 0x8004B448) and launches 0xE01 unless that word already reads 0xE01, in which
// case it launches 0xE02; on every non-Japanese language it launches 0xE02
// without reading the word at all (pro/stdwtitl.s .L0x00003CA0-.L0x00003CEC;
// ledger UI-TITLE-ATTRACT-LOOP-2026-08-14; the port is oracle-checked against
// the original in tests/title-fade-oracle.test.js).
//
// The launcher records the code of the screen a launch replaces, so every route
// into the title must record what it left: the opening movie that handed back
// (0xE01/0xE02), the memory card backed out of (0xC00, the code the title's
// Continue choice launches) or the battle lost (0x600, wfightmn's loss arm
// hands 0xE00 over the running battle). A stale value — the movie watched
// before some other screen — made the Japanese build watch the wrong opening
// movie after a memory-card return or a battle loss.
//
// Part 1 pins the rule for those route values through the same engine session
// the walker runs; part 2 pins the host's wiring in web/game.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TitleMenuSession, TitleSequenceSession, TitleVisualSession, advanceFrameClock,
} from "../engine/dw3/ui/index.ts";
import { BATTLE_HANDOFF_SELECTOR } from "../engine/dw3/screen-routing.ts";
import { TITLE_TWINKLES } from "../web/title-twinkle-data.js";

const layout = {
  promptAt: [79, 166], optionAt: [[79, 154], [79, 174]],
  clipByLanguage: { 0: [8, 9, 10], 1: [8, 9, 10], 2: [8, 9, 10] },
};

/** The launch code the idle timeout picks, driven field by field the way the
 *  screen's host drives it (engine/dw3/ui/title-session.ts: one displayed field
 *  per MenuDisplayClock step). */
function idleMovie(language, previous) {
  const menu = new TitleMenuSession(layout, language);
  const visual = new TitleVisualSession([0, 1], language === 0);
  const title = new TitleSequenceSession(language, menu, visual, TITLE_TWINKLES, previous);
  for (let frame = 0; frame < 800 && !title.selector(); frame += 1) {
    advanceFrameClock();
    title.tick();
  }
  return title.selector();
}

// ── 1. the rule, for every previous-screen value the walker's routes produce ──

test("the Japanese idle timeout launches 0xE01 unless the previous screen was 0xE01", () => {
  // The memory card's code (the title's Continue choice launches 0xC00) and the
  // battle's code (0x600): neither is 0xE01, so both time out to MOVIEOP2.
  assert.equal(BATTLE_HANDOFF_SELECTOR, 0x600);
  assert.equal(idleMovie(0, 0xc00), 0xe01, "after a memory-card return");
  assert.equal(idleMovie(0, 0x600), 0xe01, "after a lost battle");
  assert.equal(idleMovie(0, 0), 0xe01, "a fresh boot's unset word");
  // Only the movie itself flips the choice.
  assert.equal(idleMovie(0, 0xe01), 0xe02, "after MOVIEOP2");
  assert.equal(idleMovie(0, 0xe02), 0xe01, "after MOVIEOPN");
});

test("every other language launches 0xE02 without consulting the previous screen", () => {
  for (const previous of [0, 0xc00, 0x600, 0xe01, 0xe02]) {
    assert.equal(idleMovie(1, previous), 0xe02, `usa, previous 0x${previous.toString(16)}`);
    assert.equal(idleMovie(2, previous), 0xe02, `eng, previous 0x${previous.toString(16)}`);
  }
});

// ── 2. the host's wiring: every route into the title records what it left ────

const gameJs = () => readFileSync("web/game.js", "utf8");

test("the movie's return records the movie's own code", () => {
  const src = gameJs();
  assert.match(src, /previousScreenCode = code;[\s\S]{0,200}?movieReturnScreen\(code, false\)/,
    "the movie's end callback records the movie before the destination resolves");
});

test("the memory-card back-out records the card (0xC00), not the movie watched before it", () => {
  const src = gameJs();
  assert.match(src, /const MEMCARD_SCREEN_CODE = 0xc00;/,
    "the card's screen code is the decoded 0xC00 (the title's Continue launch code)");
  const at = src.indexOf("const leaveMemoryCardToTitle = () => {");
  assert.ok(at > 0, "the card's back-out route exists");
  const arm = src.slice(at, src.indexOf("};", at));
  assert.match(arm, /previousScreenCode = MEMCARD_SCREEN_CODE;/,
    "the back-out records the card before the fresh title is built");
  assert.match(arm, /startTitle\(\);/);
  const order = [arm.indexOf("previousScreenCode = MEMCARD_SCREEN_CODE;"),
    arm.indexOf("startTitle();")];
  assert.ok(order[0] >= 0 && order[0] < order[1], "the record lands before the title opens");
});

test("the battle loss records the battle (0x600), not the movie watched before it", () => {
  const src = gameJs();
  const at = src.indexOf("launchTitleScreen = () => {");
  assert.ok(at > 0, "the loss route exists");
  const arm = src.slice(at, src.indexOf("};", at));
  assert.match(arm, /previousScreenCode = BATTLE_HANDOFF_SELECTOR;/,
    "the loss records the battle screen's own code before the fresh title is built");
  const order = [arm.indexOf("previousScreenCode = BATTLE_HANDOFF_SELECTOR;"),
    arm.indexOf("ts = newTitle();")];
  assert.ok(order[0] >= 0 && order[0] < order[1], "the record lands before the title opens");
});

test("the title is always built from the record; no stale field remains", () => {
  const src = gameJs();
  assert.ok(!src.includes("previousTitleCode"),
    "the stale field name is gone — every route writes the one record");
  assert.equal((src.match(/createTitleScreen\(\{ language: state\.languageByte \?\? 2, previousScreenCode \}\)/g) || []).length, 2,
    "both title constructions read the record");
});
