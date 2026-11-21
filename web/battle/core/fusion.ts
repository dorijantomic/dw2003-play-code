import { fusedRecord } from "../../fusion.js";
import { initialActorTimeline, FormChangeProgram, DV_TASK_START_FRAME } from "../../vendor/engine.js";
import { effectiveSpd } from "../plans.js";
import { setFighterTint } from "../../battle3d.js";
import { enemyMsgName } from "../hud.js";
import { ST, MSG_KIND, MSG } from "../messages.js";
import { TAG_PRESENTATION } from "../layout.js";
import {
  releaseReservedSecondForm,
  setLiveBattleForm,
  markFormTaken,
  commitBattleFormChange,
} from "../form-blast.js";
import { emit as emitGameEvent } from "../../gameEvents.js";
import type { EnemyStatBlock, FusedRecord } from "./types.js";
import type { BattleContext } from "../../types/battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makeFusion(B: BattleContext) {
/**
   * NEW content (F2 -> Extras -> "Fusion bosses"): the two halves fuse.
   *
   * The battle's own precedent is the Galacticmon finale's body swap (runFinaleBeat): a new
   * record, a model swap, result pages, and the fight goes on. Here the record is built by
   * web/fusion.js from the halves' real enemy rows and the authored boss spec
   * (web/fusion_bosses.json): the body species is the one stored and drawn, `displayName`
   * is what the plate and the pages say, and the fused HP is the authored 2424 — never a
   * full heal of the player's side, and never the fallen body's own pool.
   */
  function fuseIntoBoss(b, boss) {
    const en = b?.enemy;
    // A Fusion Lab part with no enemies.json row (a partner form) brings its own stat row in `boss.rows`.
    const bodyRow = B.enemiesDB?.[boss?.body] ?? boss?.rows?.[boss?.body] ?? null;
    if (!en || !bodyRow) return;
    const halves = (boss.halves ?? []).map((name: string | number) => B.enemiesDB?.[name] ?? boss.rows?.[name] ?? null).filter(Boolean);
    const fused: FusedRecord = fusedRecord({
      halves, body: boss.body, level: boss.level, hp: boss.hp,
      statScale: boss.statScale, moves: boss.moves, aiFill: boss.aiFill === true,
    });
    // The body's own row with the fused attack, the two techniques and the AI rows on top;
    // its resistances, status bytes and drop stay the body's, because the fused fighter IS
    // that body.
    const eStats = { ...bodyRow } as EnemyStatBlock;
    eStats.attack = fused.attack;
    eStats.move_1 = fused.move_1;
    eStats.move_2 = fused.move_2;
    eStats.ai_moves = fused.ai_moves;
    en.eStats = eStats;
    en.profile = B.enemyToProfile(eStats);
    en.fightSkill = B.skillDB?.[eStats.attack] ?? en.fightSkill;
    en.displayName = boss.displayName ?? null;
    en.level = fused.level;
    en.hp = fused.hp; en.maxHp = fused.maxHp;
    en.mp = fused.mp; en.maxMp = fused.maxMp;
    en.str = fused.stats.str;
    en.def = fused.stats.def;
    en.spt = fused.stats.spt;
    en.wis = fused.stats.wis;
    en.spd = fused.stats.spd;
    en.powerScale = fused.statScale;
    en.statusImmunities = b.statusImmunities;
    en.turnCounter = 0;
    // F2 -> Extras -> "Boss phases": the authored record's own id and a fresh phase
    // cursor. The four AI rows only change once an HP line is crossed (advanceBossPhase).
    en.bossId = boss.id ?? null;
    en.bossPhase = -1;
    // The record keeps its status-event pool and side/slot bytes: it is the same object.
    b.timeline = initialActorTimeline(effectiveSpd(b.player), effectiveSpd(en));
    b._turnSeq = (b._turnSeq ?? 0) + 1;
    // One body only: once the fused fighter falls there is nothing left to fuse.
    if (b.party?.[b.partyIndex]) b.party[b.partyIndex].fuseInto = null;
    if (boss.transform === "whiteout") B.renderer3d?.whiteOut?.(20);
    setFighterTint("enemy", boss.tint ?? null);
    // A Fusion Lab boss is drawn as its own built model folder, not as a species name.
    if (boss.modelFolder) B.renderer3d?.setEnemyDigimon?.(boss.modelFolder);
    else B.swapEnemyModel(boss.body);
    const name = enemyMsgName(en, "");
    B.setResultPages(b, [
      `${(boss.halves ?? []).join(" and ")} fuse!`,
      `${name} appears!`,
    ]);
    b.menuSel = 0;
    b._nextState = ST.PLAYER_MENU;
    b.state = ST.RESULT_MSG;
    b.timer = 0;
  }
function applyTagAction(action: { rosterIndex: number; formId: number; }) {
    const b = B.battle;
    const member = b.playerRoster[action.rosterIndex];
    const incoming = b.playerRecords[action.rosterIndex];
    const profile = B.digimonDB[action.formId];
    if (!member || !incoming || !profile || incoming.hp <= 0 || action.rosterIndex === b.activePlayerIndex) {
      B.sayOriginal(b, {
        kind: MSG_KIND.OUTCOME, payload: [MSG.SWITCH_FAILED], name: member?.name,
      }, "Cannot tag.");
      return false;
    }
    // menu.c WFIGHTMN_tag: message 0x38 FIRST (input-gated, below), then FIGHTSTG_startEntrance, and the commit
    // (commitTag) when the entrance's cut sets `done` (f114). Nothing is hidden here: the outgoing model stays
    // on screen until the cut, and the roster record stays the outgoing one.
    b._tagPresentation = {
      phase: "prompt",
      sequence: TAG_PRESENTATION.sequence,
      memberName: member.name,
      profile,
      action,
      // menu.c:312 queuePlayerTurn(getDelay(0, 0)) runs in the command dispatch, BEFORE WFIGHTMN_tag
      // swaps active[0]: the delay uses the OUTGOING fighter's speed. A forced KO replacement does
      // not pass that dispatch (WFIGHTMN_knockOut sets substate 5 = WFIGHTMN_tag directly, menu.c:1119),
      // so it queues no turn at all: the next turn was already queued.
      spd: b._forcedTag ? null : effectiveSpd(b.player),
    };
    B.sayOriginal(b, {
      kind: MSG_KIND.OUTCOME, payload: [MSG.GO_FOR_IT], name: member.name,
    }, `${member.name}\nGo for it!`);
    return true;
  }
/**
   * The Tag commit, menu.c:388-398 (WFIGHTMN_tag state 2, run when `entrance->done` is set at the cut):
   * the new fighter becomes the active one, the turn was queued at command time with the OUTGOING speed (spd; none when forced).
   */
  function commitTag(b, action: { rosterIndex: number; formId: number; }, spd: number | undefined) {
    const member = b.playerRoster[action.rosterIndex];
    const incoming = b.playerRecords[action.rosterIndex];
    const profile = B.digimonDB[action.formId];
    if (!member || !incoming || !profile) return;
    // Tag while Blast is active forfeits the charge. The shared cleanup
    // F0x800a7328 tests the combatant's reserved second form at +0x1a, and when
    // it is set it ZEROES the DV/Blast gauge at +0x58 and clears the flag
    // (EV-tag-commit-cancels-blast-static-2026-08-04; claim
    // tag-commit-cancels-blast-no-suppression-branch). It is the same routine
    // the Digivolve commit runs, so both call it. Zeroing here also prevents
    // the outgoing partner's revert from firing on the incoming one.
    releaseReservedSecondForm(b);
    // The a2 = 0 forced list is the cancel gate only (fightstg.s:21294 reads
    // self+0x58 inside the pad-0x4000 branch), so the swap through the
    // follow-up screen releases it exactly as the immediate commit does.
    b._forcedTag = false;
    b.activePlayerIndex = action.rosterIndex;
    b.player = incoming;
    // The pool link follows the active fighter. The original has ONE queue at 0x800a3868
    // and every stager writes into it, but the walker hands `statusEvents` / `sideByte` /
    // `slot` to the records at battle setup — and setup only reaches the record that was
    // active then. Without this a tagged-in partner's ailment would be staged into a
    // DETACHED pool (`applyAilment` creates one when a record has none), so its poison
    // would never tick and its recovery would never come due.
    incoming.statusEvents = b.statusEvents;
    incoming.sideByte = 0;
    incoming.slot = 0;
    // Native Tag writes the selected form id into the already-resident incoming
    // record, then marks that roster position as a battle participant.
    setLiveBattleForm(b.player, profile);
    // F0x800a78d8's commit also runs F0x800A69F0 on the incoming record
    // (wfightmn file 0x0C10): byte 7 + the equipped row of the form Tagged in,
    // so the report pays that form's DVEXP and ladder too.
    markFormTaken(b, action.rosterIndex, profile.id);
    b.participantIndices.add(action.rosterIndex);
    if (typeof spd === "number") B.queueAfterAction(b, "player", spd);
  }
function applyDvAction(action: { formId: number; }) {
    const b = B.battle;
    const member = b.playerRoster[b.activePlayerIndex];
    const profile = B.digimonDB[action.formId];
    if (!member || !profile) { b.message = "Cannot digivolve."; return; }
    // Manual DV is temporary and does not spend the inactive Blast gauge.
    // The original's commit (wfightmn.s:1680-1692) writes the live form id, the
    // equipped-form flags and the reserved-second-form release, and NO stat, HP,
    // MP, technique or ailment value; the numbers a changed form fights with are
    // re-derived on every read by F0x8009EC94, which is what savedSpeciesId in
    // effStats reproduces. Captured order (dv_manual.txt): the model loads AT
    // commit with a1=0 — Blast uses a1=1 and loads before its presentation — and
    // the next turn is queued as an ordinary code-2 turn. The EVOLUTIO jingle is
    // 34 frames later, so it is fired by the presentation, not here.
    commitBattleFormChange(b, profile, b.activePlayerIndex);
    emitGameEvent("formWorn", { name: profile.name });   // the glossary counts a form you wore as met
    // The model is NOT swapped here: the original adds it hidden as model 1 on f-180 and swapInNewDigimon
    // takes slot 0 on f278 (advanceBlastPresentation swaps it then, `swapName`).
    // The original's box is empty while the transformation plays: its "Digivolved!"
    // page is built only when the sequence ends (the `blastShow.endSpec` below).
    B.clearBattleLine(b);
    b.blastShow = {
      program: FormChangeProgram.MANUAL_DV,
      frame: DV_TASK_START_FRAME, target: null, swapName: profile.name, swapped: false, healed: false, state: null, sounded: false,
      // The original's own line: wfightmn.s .L0x00001abc calls unkAC(kind 12), whose
      // arm puts `esmfight[0x16]` = "{1}" on line one (the Digimon's name, filled by
      // F0x80098d14) and `esmfight[0x37]` = "Digivolved! {1}!" on line two, with the
      // name in slot 1 out of the Digimon-name bank.
      endMessage: `Digivolved! ${profile.name}!`,
      endSpec: {
        kind: MSG_KIND.DIGIVOLVED, payload: [0], name: profile.name,
        slots: [profile.name],
      },
    };
    B.renderer3d?.setFaceCamVisible?.(false);
  }
  return { fuseIntoBoss, applyTagAction, commitTag, applyDvAction };
}
