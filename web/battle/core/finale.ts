import {
  FINALE_TAIL_DEFEAT_BEATS,
  initialActorTimeline,
  FINALE_HEAD_ATTACK_ID,
  finaleCopiedAttackSkill,
  FINALE_MSG_BODY,
  FINALE_MSG_LEARNED,
  finaleRecordsTechnique,
} from "../../vendor/engine.js";
import { effectiveSpd } from "../plans.js";
import { applyGiantScales, giantModeOn, battleKindOf } from "../form-blast.js";
import { MSG_KIND, ST } from "../messages.js";
import type { BattleContext } from "../../types/battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makeFinale(B: BattleContext) {
/**
   * Run one beat of the finale's scripted sequence (FINALE_TAIL_DEFEAT_BEATS).
   *
   * Beat 0 is arm 18's default sub-state (wfightmn.s:3219-3234): presentation 0x8B
   * "What! The body?!", kind 5, the body on the field (sub-state 5's spawn,
   * :3490-3494). Beat 1 is the kind-5 body object's cannon: the current Digimon is
   * set to 1 HP and the box shows the delta it took (fightstg.s:14416-14425). Beat 2
   * is arm 22 (:3781-3793, :3843-3966): kind 6, the head on the field, and its attack
   * record rebuilt from the technique latched while the tail stood. Each beat's pages
   * advance to the next through `_finaleAfter` (see advanceAfterResult); the last
   * beat hands the command menu to the player, who gets the first turn of the head
   * phase — the kind-6 fixed roll governs the player's attacks from there on.
   */
  function runFinaleBeat(b, index) {
    const beat = FINALE_TAIL_DEFEAT_BEATS[index];
    if (!beat) return;
    b._finaleKind = beat.kind;
    if (b.player) b.player.battleKind = beat.kind;
    if (b.partyIndex !== beat.member) {
      const entry = b.party[beat.member];
      const next = entry ? B.buildEnemyRecord(entry) : null;
      if (next) {
        next.statusImmunities = b.statusImmunities;
        next.battleKind = beat.kind;
        const nextName = next.eStats?.digimon_id ?? next.profile?.name ?? "Enemy";
        // menu.c:1034 bringSecondEnemy / :1241 bringLastEnemy: FIGHTSTG_startEntrance(id, 1, 0). The record is
        // committed at the cut (f114) and the beat's pages come after the task ends (f299).
        B.startEntrance(b, {
          side: 1, name: nextName,
          onSwap: () => {
            b.enemy = next;
            b.partyIndex = beat.member;
            b.timeline = initialActorTimeline(effectiveSpd(b.player), effectiveSpd(next));
            // A fresh timeline is a fresh turn for the command phase's Frozen gate.
            b._turnSeq = (b._turnSeq ?? 0) + 1;
            // Giant mode part 1: a scripted phase change may swap in a different-sized body too.
            applyGiantScales(B.renderer3d, entry, giantModeOn());
          },
          onDone: () => finishFinaleBeat(b, index, beat),
        });
        return;
      }
    } else if (b.enemy) {
      b.enemy.battleKind = beat.kind;
    }
    finishFinaleBeat(b, index, beat);
  }
/** The rest of a finale beat: the head's attack record and the beat's pages (after the body has entered). */
  function finishFinaleBeat(b, index, beat) {
    if (beat.head) {
      // Arm 22 state 2: the head's own attack record (technique 440, the "?????"
      // skill) is rebuilt from the technique row latched at 0x800a4538. The record
      // fields the walker's skill model carries are copied; a zero latch (nothing
      // recorded) leaves the head's own attack untouched.
      const headRaw = B.fightTechDB?.[String(FINALE_HEAD_ATTACK_ID)] ?? null;
      const baseRow = B.skillDB?.[String(FINALE_HEAD_ATTACK_ID)] ?? null;
      const base = baseRow && headRaw
        ? { ...baseRow, techRecord: { f8: headRaw.f8, sigEffect: headRaw.sigEffect, effect: headRaw.effect, motion: headRaw.motion } }
        : baseRow;
      const recordedSkill = b._finaleRecordedTechId
        ? (B.skillDB?.[String(b._finaleRecordedTechId)] ?? null) : null;
      // The raw record bytes (+0x07 elem1, +0x0b f8) live in the tech table, not the skill row.
      const recordedRaw = b._finaleRecordedTechId
        ? (B.fightTechDB?.[String(b._finaleRecordedTechId)] ?? null) : null;
      const recorded = recordedSkill
        ? { ...recordedSkill, elem1: recordedRaw?.elem1, techRecord: recordedRaw ? { f8: recordedRaw.f8 } : undefined } : null;
      b._finaleCopiedAttack = base && recorded ? finaleCopiedAttackSkill(base, recorded) : null;
    }
    const pages = [];
    if (beat.message === FINALE_MSG_BODY) {
      // The line arm 18's default sub-state plays: message kind 1, esmfight 0x8B.
      pages.push({
        text: "What! The body?!",
        spec: { kind: MSG_KIND.ONE_LINE, payload: [FINALE_MSG_BODY] },
      });
    }
    if (beat.cannon) {
      // The kind-5 object's state 1 (fightstg.s:14416-14425): the current Digimon's
      // HP is set to 1, after a damage page carrying the delta it took.
      const pname = b.player.profile.name;
      const dealt = Math.max(0, b.player.hp - 1);
      b.player.hp = 1;
      pages.push({ text: `${pname} took ${dealt} damage!`, spec: B.damageSpec(pname, dealt, "", 0, 1) });
    }
    if (beat.message === FINALE_MSG_LEARNED && b._finaleRecordedTechId) {
      // Arm 22's state-2 message: kind 22, line one the bank's 0x8C, line two the
      // copied technique's name. Arm 22 skips it (and the record build) when nothing
      // was latched (:3869 -> .L0x00003dd4 at :3964-3966).
      const techName = B.skillDB?.[String(b._finaleRecordedTechId)]?.name ?? "";
      pages.push({
        text: `Galacticmon learned a technique! ${techName}!`,
        spec: { kind: 22, payload: [0], slots: [techName] },
      });
    }
    if (pages.length) {
      B.setResultPages(b, pages);
      b.state = ST.RESULT_MSG;
      b.timer = 0;
      // The beat hook owns every non-final stage; only the head beat hands the turn
      // to the player.
      b._nextState = index === FINALE_TAIL_DEFEAT_BEATS.length - 1 ? ST.PLAYER_MENU : ST.NONE;
      b._finaleAfter = index + 1 < FINALE_TAIL_DEFEAT_BEATS.length
        ? () => runFinaleBeat(b, index + 1) : null;
    } else {
      b._finaleAfter = null;
      if (index + 1 < FINALE_TAIL_DEFEAT_BEATS.length) runFinaleBeat(b, index + 1);
      else {
        b.menuSel = 0;
        b.state = ST.PLAYER_MENU;
        b.timer = 0;
      }
    }
  }
/**
   * The finale's technique latch (F0x800aa06c), where the disc runs it: the damage
   * applier for a category-2/3 action calls it right before the damage wrapper
   * (wfightmn.s:4830-4842). The walker's landed damaging commit is that call's
   * closest equivalent; the predicate (player side, kind 4, the row's own filter)
   * is the engine's port.
   */
  function recordFinaleTechnique(b, techniqueId) {
    const row = B.fightTechDB?.[String(techniqueId | 0)] ?? null;
    if (!finaleRecordsTechnique(battleKindOf(b), 0, row)) return;
    b._finaleRecordedTechId = techniqueId | 0;
  }
  return { runFinaleBeat, finishFinaleBeat, recordFinaleTechnique };
}
