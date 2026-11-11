// Two last gaps of the battle entrance, both from ~/dw3_decomp (rules and file:line in
// /home/dorij/dv-camera/BUILD-last2-play.md):
//  1. WHEN the pages around an entrance are made and drawn: src/battle/battle_mode/entrance.c,
//     normal_battle/menu.c (tag :355-420, endBlast :933-955, KO :1066-1150, digidevolve :1164-1198),
//     battle_mode/enemy_turn.c (substates 4-6), engine/task/registry.c (executeTask / runChildTasks).
//  2. Tech 0x187 (391 Helter Skelter) forced de-digivolve: tech_action.c:585-589 -> battle.c:143 queueDigidevolve ->
//     menu.c:1164 WFIGHTMN_digidevolve -> FIGHTSTG_startEntrance, rolls.c:400-409 FIGHTSTG_rollDedigivolve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENTRANCE_TASK_END_FRAME } from "../web/enemy-switch.js";
import { entranceCameraSchedule, formChangeState, FormChangeProgram } from "../engine/systems/blast-presentation.ts";
import {
  battleScriptedPlanFor, forcedDedigivolveLanded, MSG,
} from "../web/battle.js";

const BATTLE = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const TECH_TABLE = JSON.parse(readFileSync(new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const ESMFIGHT = JSON.parse(readFileSync(new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
const slice = (from, to) => { const a = BATTLE.indexOf(from); return BATTLE.slice(a, BATTLE.indexOf(to, a)); };

// ── 1. the task-order model of registry.c, with the decomp's own entrance frames ─────────────────────────────────
// One parent with ONE child slot (BattleChild is a union: message and entrance are the same pointer). executeTask:
// the parent's update first, then runChildTasks; a child in state KILL runs a last update and is cleared AFTER the
// parent's update of that frame. The entrance sets state 3 on f299 (entrance.c:154-163).
function runParentFrames(lastFrame, wait) {
  const slot = { task: { state: 1 } };      // children->entrance, created on the parent's frame f0 (runs that frame)
  let childFrame = -1;
  let pageFrame = null;
  for (let f = 0; f <= lastFrame; f++) {
    // parent update
    if (pageFrame === null && wait(slot, f)) pageFrame = f;
    // child update (runChildTasks)
    if (slot.task) {
      childFrame++;
      const dying = slot.task.state === 3;
      if (!dying && childFrame === 299) slot.task.state = 3;   // entrance.c state 7: setState(task, 3)
      if (dying) slot.task = null;                             // destroyed after its last update
    }
  }
  return pageFrame;
}

test("the page that waits for the entrance (enemy name, 0x39, 0x62, 0x47, 0xD) is made on f301, never earlier", () => {
  // `children->message == NULL` and `children->task.task == NULL` are the same union slot
  const frame = runParentFrames(400, (slot) => slot.task === null);
  assert.equal(frame, 301);
  assert.equal(frame, ENTRANCE_TASK_END_FRAME);
  // and the cut f114 (done) is seen by the parent on f115 but no page is made for it
  const sch = entranceCameraSchedule(1);
  assert.equal(sch.swapFrame + 1, 115);
  assert.equal(ENTRANCE_TASK_END_FRAME, sch.returnFrame + 2);
});

test("the player entrance's camera glide (60 frames, a camera task) outlives the task: the page is drawn over it", () => {
  const player = entranceCameraSchedule(0);
  const enemy = entranceCameraSchedule(1);
  assert.equal(player.lastFrame - ENTRANCE_TASK_END_FRAME, player.returnFadeFrames, "60 frames of glide after the page");
  assert.equal(enemy.lastFrame, ENTRANCE_TASK_END_FRAME, "the enemy side has no overlap (fade 1)");
  assert.equal(formChangeState(FormChangeProgram.BLAST_REVERT, ENTRANCE_TASK_END_FRAME).done, false);
  assert.equal(formChangeState(FormChangeProgram.ENTRANCE_ENEMY, ENTRANCE_TASK_END_FRAME).done, true);
});

test("battle.js makes the entrance pages on f301 and draws them over the entrance", () => {
  const adv = slice("function advanceBlastPresentation(b, dt)", "function revertBlast");
  assert.match(adv, /show\.entrance && !show\.taskEnded && frame >= ENTRANCE_TASK_END_FRAME/);
  assert.match(adv, /if \(show\.endMessage\) sayOriginal\(b, show\.endSpec \?\? null, show\.endMessage\);\s+show\.pageMade/);
  assert.match(adv, /show\.onTaskEnd\?\.\(\) === true/);
  // at the end of the window an entrance neither re-says nor clears a page it made
  assert.match(adv, /if \(show\.entrance\) \{ if \(!show\.endMessage && !show\.pageMade\) clearBattleLine\(b\); \}/);
  assert.doesNotMatch(BATTLE, /pageAt|onPage|ENEMY_SELFTAG_NAME_FRAME/, "the f115 hack is gone");
  // draw: the message panel is painted over the presentation, entrances only
  const draw = BATTLE.slice(BATTLE.indexOf("The entrance's own page (the next one is made on f301"));
  assert.match(draw.slice(0, 500), /b\.blastShow\.entrance && msgSession\?\.active && !msgSession\.finished/);
  assert.match(draw.slice(0, 500), /battleMsgPaint\(ctx, msgSession\.frame\(\)/);
});

test("the turn delay reads the ACTIVE fighter at the moment it is asked (events.c:224-285): after the swap, the new one", () => {
  // events.c FIGHTSTG_getEventDelay: `row = side != 0; computeStats(side, 1, FIGHTSTG_battle.state.active[row])`; the enemy
  // self-tag commits active[1] in substate 6 (enemy_turn.c:279) and queues the delay in substate 3 (:260), after it.
  // The walker queues the self-tag turn after the entrance (advanceAfterResult `named`), so it reads the new enemy.
  assert.match(BATTLE, /if \(tag\.stage === "named"\) \{ b\._selfTag = null; queueAfterAction\(b, "enemy"\); \}/);
  assert.match(BATTLE, /if \(!b\._selfTag\) queueAfterAction\(b, "enemy"\)/);
});

// ── 2. tech 0x187 = 391 Helter Skelter ───────────────────────────────────────────────────────────────────────────────
function battle(profileId) {
  const enemy = {
    profile: { name: "Persiamon", id: 200, family: 1 }, level: 10, hp: 500, maxHp: 500,
    mp: 100, maxMp: 100, str: 100, def: 100, spt: 100, wis: 100, spd: 100,
    affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {},
  };
  const player = {
    profile: { name: "Greymon", id: profileId, family: 1 }, level: 10, hp: 300, maxHp: 300,
    mp: 60, maxMp: 60, str: 100, def: 100, spt: 100, wis: 40, spd: 100,
    affinity: 0, statMods: { str: 0, def: 0, spd: 0 }, ailments: {},
  };
  return { player, enemy, playerRecords: [player, null, null], activePlayerIndex: 0, encounterGateBytes: new Array(14).fill(0) };
}
const rec391 = TECH_TABLE["391"];

test("391: category 5, 20 MP, effect chance 96/128 (tech_action.c rollTechChance: rand & 0x7F < effectChance)", () => {
  assert.equal(rec391.category, 5);
  assert.equal(rec391.mp, 20);
  assert.equal(rec391.f8, 96);
});

test("rollDedigivolve: an acquired form, roll under 96 lands (no page); roll 96+ is 'No effect!' (0x2F, kind 1)", () => {
  const landed = battleScriptedPlanFor(battle(100), 1, rec391, 391, { name: "Persiamon", roll7: 95 });
  assert.equal(landed.effect, "statusOnly");
  assert.equal(landed.rollLanded, true);
  assert.equal(landed.page, null, "tech_action.c:586-588 builds no page: queueDigidevolve, then the page's task is killed");
  assert.equal(forcedDedigivolveLanded(landed), true);
  const missed = battleScriptedPlanFor(battle(100), 1, rec391, 391, { name: "Persiamon", roll7: 96 });
  assert.equal(missed.rollLanded, false);
  assert.equal(forcedDedigivolveLanded(missed), false);
  assert.deepEqual(missed.page.payload, [0x2f]);
  assert.equal(missed.page.kind, 1);
  assert.equal(ESMFIGHT[0x2f], "No effect!");
});

test("rollDedigivolve: a partner already in one of the eight base forms is never hit and no random number is spent", () => {
  for (const id of [1, 4, 8]) {
    const b = battle(id);
    const r = battleScriptedPlanFor(b, 1, rec391, 391, { name: "Persiamon" });   // no roll7: it would draw RAND_U16
    assert.equal(r.rollBlocked, true, `form ${id}`);
    assert.equal(r.rollLanded, false);
    assert.equal(forcedDedigivolveLanded(r), false);
    assert.equal(r.page.payload[0], 0x2f);
  }
  for (const id of [9, 100, 300]) {
    assert.equal(battleScriptedPlanFor(battle(id), 1, rec391, 391, { name: "x", roll7: 0 }).rollBlocked, false, `form ${id}`);
  }
});

test("the page after the entrance is esmfight 0x47 'Digidevolved!', kind 2", () => {
  assert.equal(MSG.DIGIDEVOLVED, 0x47);
  assert.equal(ESMFIGHT[0x47], "Digidevolved!");
});

test("battle.js: forced de-digivolve reuses the ONE entrance and writes only what menu.c:1164-1198 writes", () => {
  const fn = slice("function forcedDedigivolve(b)", "/** Count one elapsed player turn");
  assert.match(fn, /digimonDB\?\.\[p\.rookieId\]/, "the party member's own Digimon (DIGIMON_DATA[member].id)");
  assert.match(fn, /setLiveBattleForm\(p, saved\)/, "unit->id");
  assert.match(fn, /clearActionAffinity\(b, 0\)/, "unit->charge = 0");
  assert.match(fn, /releaseReservedSecondForm\(b\)/, "WFIGHTMN_cancelBlast: the Blast gauge and its end event");
  assert.match(fn, /startEntrance\(b, \{\s+side: 0, name: saved\.name,/, "FIGHTSTG_startEntrance(unit->id, 0, weak)");
  assert.match(fn, /MSG\.DIGIDEVOLVED/, "message 0x47 after the task");
  assert.doesNotMatch(fn, /blastShow = \{|\.hp\b|\.mp\b|markFormTaken|commitBattleFormChange|swapPlayerModel/,
    "no second presentation, no hp/mp, no form flags (digidevolve does not call WFIGHTMN_markFought)");
});

test("battle.js: a landed 391 queues the event first, for both casters, and the turn's delay is already queued", () => {
  const apply = slice("function applyEnemyAction()", "NEW content (F2 -> Extras -> \"Fusion bosses\")");
  assert.ok(apply.length > 0);
  const enemy = BATTLE.slice(BATTLE.indexOf("const scripted = battleScriptedPlanFor(b, 1,"));
  assert.match(enemy.slice(0, 1800), /forcedDedigivolveLanded\(scripted\)[\s\S]*?clearBattleLine\(b\);\s+b\._dedigivolvePending = true;/);
  const player = BATTLE.slice(BATTLE.indexOf("const scripted = battleScriptedPlanFor(b, 0,"));
  assert.match(player.slice(0, 1500), /forcedDedigivolveLanded\(scripted\)\) \{\s+setResultPages\(b, \[\]\);\s+clearBattleLine\(b\);\s+b\._dedigivolvePending = true;/);
  // the event runs from advanceAfterResult, ahead of the status events, the Blast events and the next state
  const after = slice("function advanceAfterResult(b)", "function tickBattleMessage") ;
  const hook = after.indexOf("if (b._dedigivolvePending)");
  assert.ok(hook > 0);
  assert.ok(hook < after.indexOf("if (b._timelinePages"), "before the turn's status pages");
  assert.ok(hook < after.indexOf("if (b._blastPending)"), "before the Blast events");
  assert.match(after, /b\._dedigivolvePending = false; forcedDedigivolve\(b\);/);
  // the ENEMY_ACT tick queues the turn right after applyEnemyAction, i.e. BEFORE the event runs (menu.c:1446-1461)
  assert.match(BATTLE, /applyEnemyAction\(\);[\s\S]{0,700}if \(!b\._selfTag\) queueAfterAction\(b, "enemy"\);/);
});

// ── 3. player Tag delay and entrance end (last2 play) ────────────────────────────────────────────────────────────────
test("Tag: the turn delay is read at command time with the OUTGOING fighter (menu.c:312), a forced KO replacement queues none", () => {
  const apply = slice("function applyTagAction(action)", "function commitTag");
  // the speed is captured while b.player is still the outgoing record; a forced replacement (menu.c:1119 -> substate 5, no dispatch) has none
  assert.match(apply, /spd: b\._forcedTag \? null : effectiveSpd\(b\.player\)/);
  assert.ok(apply.indexOf("spd: b._forcedTag") < apply.lastIndexOf("sayOriginal"), "captured before the 0x38 page");
  const commit = slice("function commitTag(b, action, spd)", "function applyDvAction");
  assert.match(commit, /if \(typeof spd === "number"\) queueAfterAction\(b, "player", spd\);/);
  assert.doesNotMatch(commit, /queueAfterAction\(b, "player"\);/, "never the new fighter any more");
  assert.match(BATTLE, /onSwap: \(\) => commitTag\(b, tag\.action, tag\.spd\)/);
  // the speed reaches both clocks: the turn timeline and the status-event pool
  assert.match(BATTLE, /scheduleNextActor\(b\.timeline, acted, playerSpd \?\? effectiveSpd\(b\.player\)/);
  assert.match(BATTLE, /statusEventActionDelay\(playerSpd \?\? effectiveSpd\(b\.player\)/);
});

test("an entrance window ends on f301, not f361: the battle runs on under the camera glide (guard: f299 already published)", () => {
  const adv = slice("function advanceBlastPresentation(b, dt)", "function revertBlast");
  assert.match(adv, /const ended = s\.done \|\| \(show\.entrance && frame >= ENTRANCE_TASK_END_FRAME && prevFrame >= ENTRANCE_TASK_END_FRAME - 2\);\s+if \(ended\) \{/);
  assert.doesNotMatch(adv, /if \(s\.done\) \{/);
  // the glide itself is untouched: still 60 frames after the stop frame, and the window end is still f361 for the player
  const player = entranceCameraSchedule(0);
  assert.equal(player.lastFrame, ENTRANCE_TASK_END_FRAME + 60);
  assert.equal(entranceCameraSchedule(1).lastFrame, ENTRANCE_TASK_END_FRAME);
});
