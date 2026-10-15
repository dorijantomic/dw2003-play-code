// The finale's win path: winning the head phase exits through the ending movie,
// not the battle-result screen.
//
// Decode: ledger claim wfightmn-finale-kinds-2026-10-10 + section 14 of
// docs/research/battle/3d-battle-complete-model-2026-08-19.md. The won battle's
// exit (arm 4, `F0x800a7c00`, phase 2) reads the result byte `0x800a435c`:
// result 1 — the win — launches `0xE0B` when the battle-kind word is 6 —
// STTITL mode 11 = movie row 10 = `MOVIEE01_STR`, the ending movie — and
// `0x1400` (`STFRPT`, the battle-result screen) otherwise (wfightmn.s:2165-2174;
// exe-decomp/wfightmn_c/F0x800a7c00.c case 2). The same win arm suppresses the
// win jingle `0x6004001E` at kind 6 (wfightmn.s:3376-3384). The ending rows then
// chain through their own return selectors: 0xE0B -> 0xE0C (row 11,
// `MOVIEE02_STR`) -> 0x2d7 = screen 727 = stage 780 (pro/stdwtitl.s:161-167,
// :212-218; engine/dw3/movie-destinations.ts).
//
// This file pins the engine decision and the wiring in web/battle.js +
// web/game.js, so a future edit cannot quietly send the finale's win back to the
// result screen — or an ordinary win into the ending.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FINALE_KIND_TAIL, FINALE_KIND_BODY, FINALE_KIND_HEAD,
  BATTLE_WIN_RESULT_SCREEN, FINALE_WIN_ENDING_MOVIE,
  battleWinLaunchCode, battleWinJinglePlays,
  movieRow, movieReturnScreen,
} from "../engine/index.ts";

const battleJs = () => readFileSync("web/battle.js", "utf8");
const gameJs = () => readFileSync("web/game.js", "utf8");
const catalog = () => JSON.parse(readFileSync("data/stagslct_catalog.json", "utf8"));
const screenTable = () => JSON.parse(readFileSync("web/assets/data/screen_table.json", "utf8"));
const fullwidth = (s) => s.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

// ── 1. the exit cue: kind 6 takes the ending movie, every other win STFRPT ──

test("the kind-6 win's launch cue is the ending movie; every other win keeps STFRPT", () => {
  assert.equal(FINALE_WIN_ENDING_MOVIE, 0xe0b);
  assert.equal(BATTLE_WIN_RESULT_SCREEN, 0x1400);
  // Arm 4 phase 2: `li $a0, 0xE0B` when the kind is 6, else `li $a0, 0x1400`
  // (wfightmn.s:2165-2174). Only the head phase diverges.
  assert.equal(battleWinLaunchCode(FINALE_KIND_HEAD), FINALE_WIN_ENDING_MOVIE);
  assert.equal(battleWinLaunchCode(FINALE_KIND_TAIL), BATTLE_WIN_RESULT_SCREEN);
  assert.equal(battleWinLaunchCode(FINALE_KIND_BODY), BATTLE_WIN_RESULT_SCREEN);
  for (const kind of [0, 1, 2, 3, 7, 0x10]) {
    assert.equal(battleWinLaunchCode(kind), BATTLE_WIN_RESULT_SCREEN, `kind ${kind}`);
  }
});

test("the win jingle plays for every win except the finale's", () => {
  // wfightmn.s:3376-3384: the play of 0x6004001E sits behind `kind != 6`.
  assert.equal(battleWinJinglePlays(FINALE_KIND_HEAD), false);
  assert.equal(battleWinJinglePlays(FINALE_KIND_TAIL), true);
  assert.equal(battleWinJinglePlays(FINALE_KIND_BODY), true);
  assert.equal(battleWinJinglePlays(0), true);
  assert.equal(battleWinJinglePlays(2), true);
});

// ── 2. the cue resolves to the disc's ending rows and their return chain ────

test("0xE0B names movie row 10 (MOVIEE01_STR) and chains through 0xE0C to screen 727", () => {
  // STTITL mode 11 -> row 10: the launch code's low byte minus one
  // (stdwtitl.s:161-167 the mode dispatch, :212-218 the row).
  const row = movieRow(FINALE_WIN_ENDING_MOVIE);
  assert.ok(row, "the cue names a movie row");
  assert.equal(row.index, 10);
  assert.equal(row.file, "MOVIEE01_STR");
  assert.equal(row.fileIndex, 2035);
  assert.equal(movieReturnScreen(FINALE_WIN_ENDING_MOVIE, false), 0xe0c);
  // 0xE0C = mode 12 = row 11 = MOVIEE02_STR, whose own return selector is 0x2d7.
  const next = movieRow(0xe0c);
  assert.ok(next);
  assert.equal(next.index, 11);
  assert.equal(next.file, "MOVIEE02_STR");
  assert.equal(movieReturnScreen(0xe0c, false), 0x2d7);
  // 0x2d7 is screen 727 = WSTAG780_PRO (stage 780) in the field table the
  // router resolves — the same place the title's Start option lands.
  assert.equal(movieRow(0x2d7), null, "a field screen is not a movie");
  assert.deepEqual(screenTable()["727"], { file: "WSTAG780_PRO", lbaIdx: 489, stage: 780 });
});

test("0x1400 is the catalog's STFRPT row and 0xE00 the STTITL library", () => {
  const entries = catalog().entries;
  const byCode = (code) => entries.find((e) => String(e.code).toLowerCase() === code);
  assert.equal(fullwidth(byCode("0x1400").overlay), "STFRPT");
  assert.equal(fullwidth(byCode("0xe00").overlay), "STTITL");
  // The catalog carries no 0xE0B row: the mode's meaning comes from stdwtitl's
  // own dispatch (mode 11 -> row 10), which is what the test above pins.
  assert.equal(byCode("0xe0b"), undefined);
});

// ── 3. the walker's wiring ──────────────────────────────────────────────────

test("the win commit reads the live kind and gates the jingle and the cue", () => {
  const src = battleJs();
  const at = src.indexOf("function defeatCurrentEnemy");
  assert.ok(at > 0);
  const arm = src.slice(at, src.indexOf("\n  function runFinaleBeat", at));
  assert.ok(arm.includes("const winKind = battleKindOf(b);"),
    "the win reads the live kind word, not the frozen setup value");
  assert.ok(arm.includes("b._winLaunchCode = battleWinLaunchCode(winKind);"),
    "the exit cue is stored for the pose's exit");
  assert.ok(arm.includes("if (battleWinJinglePlays(winKind)) sfx?.play(\"w_jingle\");"),
    "the jingle sits behind the kind gate");
  assert.equal((arm.match(/sfx\?\.play\("w_jingle"\)/g) || []).length, 1,
    "exactly one jingle call: no unconditional one remains");
});

test("the pose's exit branches: ending movie vs the ordinary report", () => {
  const src = battleJs();
  const at = src.indexOf("if (b._victoryPhase === \"pose\")");
  assert.ok(at > 0);
  const arm = src.slice(at, src.indexOf("} else if (b._victoryPhase === \"report\")", at));
  assert.ok(arm.includes("if (b._winLaunchCode === FINALE_WIN_ENDING_MOVIE)"),
    "the ending branch is keyed on the exit cue");
  assert.ok(arm.includes("b._victoryPhase = \"ending\";"));
  assert.ok(arm.includes("b._endingHosted = endingHandoff?.play ? endingHandoff.play(b) === true : false;"));
  assert.ok(arm.includes("if (!b._endingHosted) endBattle(\"win\");"),
    "with no host the win still finishes instead of stranding");
  // The report path is the other arm and still opens exactly as before.
  assert.ok(arm.includes("b._victoryPhase = \"report\";"));
  assert.ok(arm.includes("if (reportHandoff?.open) b._reportNative = reportHandoff.open(b) === true;"));
});

test("the ending exit is a host hand-off with its own finish, and the guards hold", () => {
  const src = battleJs();
  assert.ok(src.includes("setEndingHandoff: (h) => { endingHandoff = h ?? null; }"),
    "the host registers the ending chain");
  assert.ok(src.includes("finishEnding: () => { if (battle) endBattle(\"win\"); }"),
    "the chain's end closes the win exactly like the report's");
  // The ending phase swallows keys and the battle stops painting while hosted.
  assert.ok(src.includes("if (b._victoryPhase === \"ending\") {"));
  assert.ok(src.includes("if (b._endingHosted) return;"));
});

test("the host plays the chain through the movie plumbing and warps to its end", () => {
  const src = gameJs();
  // The rows' return chain is shared with the story-handoff path (playMovieChain,
  // web/game.js doStoryHandoff); playEndingChain routes the selector it ends on.
  const at = src.indexOf("async function playMovieChain");
  assert.ok(at > 0, "the shared chain function exists");
  const chain = src.slice(at, src.indexOf("async function playEndingChain", at));
  assert.ok(chain.includes("movieRow(selector)"), "the launch code names its row");
  assert.ok(chain.includes("fieldMovie.open(selector)"), "the one field movie adapter plays it");
  assert.ok(chain.includes("movieReturnScreen(selector, screenRouterOptions.useAlt())"),
    "each row's own return selector drives the chain (the router's own ordinal predicate)");
  const atEnd = src.indexOf("async function playEndingChain", at);
  assert.ok(atEnd > 0, "the ending chain exists");
  const ending = src.slice(atEnd, src.indexOf("battle.setEndingHandoff({", atEnd));
  assert.ok(ending.includes("await playMovieChain(launchCode)"),
    "the ending hand-off runs the shared row chain");
  assert.ok(ending.includes("screenRouter.route(selector, currentMap().id)"),
    "the final selector resolves through the shared screen router");
  assert.ok(ending.includes("startTransition({ to: routed.to"),
    "the chain lands on the field screen it resolves to");
  const start = src.indexOf("battle.setEndingHandoff({");
  const reg = src.slice(start, src.indexOf("\n});", start) + 4);
  assert.ok(reg.includes("playEndingChain(b._winLaunchCode ?? FINALE_WIN_ENDING_MOVIE)"));
  assert.ok(reg.includes("battle.finishEnding()"));
  assert.ok(reg.includes("return true;"), "the host claims the screen while the chain plays");
  // The ordinary report hand-off is untouched.
  assert.ok(src.includes("battle.setReportHandoff({"));
});
