// The Galacticmon finale's PRODUCER chain, pinned to the extracted disc data.
//
// The finale battle is battle id 0x144 = screen 324 (Galacticmon x3), and the disc
// reaches it from s820's own scripted block. The block (pro/wstag820.s file 0x15f8,
// the rate-0 zone) is [33, 324, 325, 326]; the bank-0x74 launcher indexes it, and
// event 1080's completion hook (file 0xa8c) writes the master ordinal 0x2b (43) and
// fires 0x7401 -> record 1 = screen 324. The walker runs that write through the
// shared scene-completion port (engine/systems/scene-completion.ts -> storyCommand
// {kind:'battle', index} -> the host's pendingStoryBattleIndex -> flushStoryBattle ->
// battle.scriptedScreen), so these values are the whole route from the stage to the
// ending. `tools/verify_finale_ending_chain.mjs` drives it end to end (finale win ->
// MOVIEE01/MOVIEE02 -> stage 780 -> the post-game route); this file pins the data so
// an edit to the extracted block, the completion writes, the finale party or the
// post-game handoffs cannot quietly cut the ending off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scriptedScreenId, specialBattleMode, movieReturnScreen,
} from "../engine/index.ts";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const stageEnc = read("web/assets/data/stage_encounters.json");
const fieldEnc = read("web/assets/data/field_encounters.json");
const completions = read("web/assets/data/scene/scene_completion.json");
const wstag = read("web/assets/events/wstag_events.json");
const screenTable = read("data/screen_table.json");

test("s820's scripted block is [33, 324, 325, 326] — the finale is record 1", () => {
  const stage = stageEnc.stages["820"];
  const scripted = stage.zones[3];
  assert.equal(scripted.rate_level, 0,
    "the block is the rate-0 scripted sentinel: walking never reaches it, only the launcher does");
  assert.deepEqual(scripted.slots, [33, 324, 325, 326, 0, 0, 0, 0],
    "the four records at pro/wstag820.s file 0x15f8");
  assert.equal(scriptedScreenId(stage, 0, 41), 33, "record 0 = screen 33 (event 1060's 0x7400)");
  assert.equal(scriptedScreenId(stage, 1, 41), 324, "record 1 = screen 324 (event 1080's 0x7401) — the finale");
});

test("event 1080's completion writes the ordinal 43 and fires the 0x7401 launcher", () => {
  const writes = completions.stages.s820.events["1080"].writes;
  assert.deepEqual(writes.map((w) => [w.op, w.op === "set_ordinal" ? w.value : w.flag]), [
    ["set_ordinal", 43],
    ["set_flag", 29697],
  ], "pro/wstag820.s 0xa8c: li $v0,0x2b / sw / li $a0,0x7401 / jalr — one hook, both writes");
});

test("screen 324 is the three-member Galacticmon gauntlet and selects battle mode 4", () => {
  const party = fieldEnc.screens["324"];
  assert.deepEqual(party.map((e) => e.name), ["Galacticmon", "Galacticmon2", "Galacticmon3"],
    "the disc's three spawned phases stand in as the walker's three-member party");
  assert.equal(party.length, 3, "the finale is the three-member gauntlet");
  assert.equal(specialBattleMode("s820", 324), 4,
    "battle id 0x144 takes WFIGHTMN's finale arm (wfightmn.s:1067)");
});

test("the post-game route's own handoffs: 1500 -> 0xE03 -> s925, 1600 -> 627 -> s923", () => {
  // The s780 reunion (event 1500) ends in HANDOFF 3587 = 0xE03, movie row 2, whose return
  // selector at ordinal 45 is 0x276 (stdwtitl.s .L0x00001144-.L0x00001198) -> screen 630 ->
  // its alias stage s925.
  const reunion = wstag.s780.find((e) => e.id === 1500);
  assert.match(reunion.disasm.at(-2), /^HANDOFF 3587 /, "event 1500's own handoff");
  assert.equal(movieReturnScreen(3587, true), 0x276, "movie row 2 re-points at ordinal 45");
  assert.equal(movieReturnScreen(3587, false), 0x207, "and keeps its own 0x207 before it");
  assert.equal(screenTable["630"].alt.stage, 925, "screen 630's post-game alias is s925");
  // s925's arrival event 1600 then hands off 627 -> screen 627's alias s923 — the disc's
  // own next post-game beat, where the ending chain leaves the player.
  const arrival = wstag.s925.find((e) => e.id === 1600);
  assert.match(arrival.disasm.at(-2), /^HANDOFF 627 /, "event 1600's own handoff");
  assert.equal(screenTable["627"].alt.stage, 923, "screen 627's post-game alias is s923");
});
