import { battleAilmentByte } from "../../battlecmd-translated.js";
import {
  elementId,
  pickEnemyAiMove,
  RAND_U16,
  enemyFleeProc,
  runAwayLine,
  enemyActionSkillId,
  FINALE_HEAD_ATTACK_ID,
  techniqueMpCost,
  basicAttackHitCount,
  DAMAGE_TERM_REPEAT_WORD,
  hitGaugeGain,
  DAMAGE_TERM_FLEE_LOCK_RECORD,
  RESULT_QUEUE,
} from "../../vendor/engine.js";
import { enemyMsgName } from "../hud.js";
import {
  processTurnStart,
  resolveMultiHit,
  resolveAttack,
  tryInflict,
  ailmentBoxPage,
  chooseResultLine,
} from "../hit-results.js";
import { effectiveSpd, battleScriptedPlanFor, forcedDedigivolveLanded } from "../plans.js";
import { MSG_KIND, MSG, scriptedWalkerSentence, restoreWalkerSentence } from "../messages.js";
import {
  enemySwitchTarget,
  enemySelfTagPick,
  enemyTeamSlots,
  ENEMY_SWITCH_MSG_TAKING_OUT,
} from "../../enemy-switch.js";
import { battleRestorePlanFor, castFieldTechnique, applyStatDebuffDispatch } from "../restore.js";
import { normalizeDvGauge } from "../layout.js";
import { persistPlayerGauge, markedEquippedForms, applyFormLearnPass } from "../form-blast.js";
import { applyPostHitDispatch } from "../status.js";
import {
  levelUpGrowthProfile,
  levelForExp,
  applyLevelUp,
  treeCandidatesFor,
  dvexpShareCount,
  paidParticipants,
  bankFormDvexp,
  dvexpGain,
  nextUnlockedEvolution,
  autoEquipForm,
  levelUpThreshold,
} from "../progress.js";
import type { BattleContext } from "../../types/battle.js";
import type { TurnStart } from "../../../engine/dw3/battle-combat.js";
import type { BattleEndContext } from "./types.js";

import type { EnemyBattleRecord } from "../../types/battle.js";
import type { FormLedgerEntry } from "../../game/types.js";
// moved by tools/rewrite/split-closure.mjs
export function makeEnemyAction(B: BattleContext) {
function applyEnemyAction() {
    const b  = B.battle;
    const en = b.enemy;
    // NEW content (F2 -> Extras -> "Fusion bosses"): a fused body shows its authored name
    // on every page it speaks, not the species it is drawn as.
    const name = enemyMsgName(en, "");
    // Combatant record +0x04, once per action turn and BEFORE any gate: the code-3
    // "enemy action turn" handler bumps the acting slot's counter and then spawns the
    // turn script (`wfightmn.s:4140-4148`), so a turn the ailment gate skips still counts
    // and cond 18 sees turn 1 on the first turn (`check_move_cond.s:413-421`).
    en.turnCounter = (en.turnCounter ?? 0) + 1;
    // Layer key 0x1009 shows the speaking side; this line is the enemy's
    // (talk-system speaker id 0x10).
    B.renderer3d?.setFaceCamSpeaker?.(0x10);

    const pname = b.player.profile.name;

    // Start-of-turn ailments on the enemy: poison DoT, then frozen/sleep/confuse may skip.
    const ts: TurnStart = processTurnStart(en, name);
    if (ts.skipped) {
      // The gate's own page (FIGHTSTG_F0x80088564, shared tail at fightstg.s:6017-6025).
      // `ts.spec` is always present for a skipped turn and `ts.prefix` is always empty --
      // see the player-side arm above for why.
      // ETS item 9: a skipped turn always carries its spec (see the comment above)
      B.sayOriginal(b, ts.spec!, ts.prefix);
      // No attack animation on a skipped turn.
      return;
    }
    const prefix = ts.prefix ? ts.prefix.trim() + " " : "";

    const move = pickEnemyMove(en);

    // AI action 4 maps through F0x80089148 to code -1, the flee special; its consumer is
    // the enemy escape roll F0x800a1608. Binder (the player's +0x3d) halves the base;
    // Sleep refuses the flee, Frozen halves it.
    if (move.action === 4) {
      const fled = enemyFleeProc(effectiveSpd(b.player), effectiveSpd(en), b.player.binderCrest, RAND_U16, battleAilmentByte(en));
      // The action-code -1 path puts up 0x5E "Trying to flee." BEFORE the roll
      // (fightstg.s file `0x6123`-`0x6137` = .L0x800889f4-.L0x80088a30: queue the
      // RUN_AWAY event for side 0x10, then the 0x5E page), and the runAway arm prints
      // the outcome after it — 0x5F "Fleeing!" for an enemy actor (the arm picks 0x43
      // only when the queued entry's actor is 0, `wfightmn.s` file `0x228c`-`0x22a0`)
      // or 0x60 "Did not flee.". The original's message panel is blocking, so both are
      // Circle-gated pages in this order.
      B.setResultPages(b, [
        { text: `${name} is trying to flee!`,
          spec: { kind: MSG_KIND.OUTCOME, payload: [MSG.TRYING_TO_FLEE], name } },
        { text: fled ? `${name} ran away!` : `${name} couldn't escape!`,
          spec: { kind: MSG_KIND.OUTCOME, payload: [fled ? runAwayLine(0x10) : MSG.DID_NOT_FLEE], name } },
      ]);
      if (fled) b._enemyFled = true;
      return;
    }

    // FIGHTSTG_F0x80089148 maps action 1/2/3 to attack/move_1/move_2. The old
    // profile.techs lookup could never work because enemy profiles intentionally contain no
    // player-form tech list, so every enemy silently used Fight.
    // Actions 5..8 are the slot switch: F0x80089148 returns -2..-5 (`fightstg.s:6314-6320`)
    // and FIGHTSTG_F0x80088394 finds no candidate slot in a one-enemy fight — -2 fails on
    // slot 0 already holding the actor, -3/-4 on the empty slots' +0x8 halfword, -5 on a
    // zero candidate count (`fightstg.s:5771-5824`). Every one resolves to -1, and that
    // failure arm puts up kind-2 esmfight 0x8E "Switch failed!" and enters the routine's
    // terminal state (`fightstg.s:6159-6188`): the turn is SPENT and the enemy does
    // nothing. A solo fight can only pay for trying. With a team (enemyTeamActive) the pick is the
    // original's FIGHTSTG_pickEnemySwitch (web/enemy-switch.js); a pick is the enemy's own tag:
    // enemy_turn.c switchEnemyOut (page esmfight 0x4D kind 1), then the side 0x10 entrance.
    if (enemySwitchTarget(move.action) !== 0) {
      const team = B.enemyTeamActive(b);
      const pick = enemySelfTagPick(move, enemyTeamSlots(team ? B.enemyTeamRecords(b) : [en]),
        team ? b.partyIndex : 0, RAND_U16);
      if (team && pick! >= 0) {
        b._selfTag = { slot: pick, stage: "taking" };
        B.setResultPages(b, [{
          text: "Taking out Digimon!",
          spec: { kind: MSG_KIND.ONE_LINE, payload: [ENEMY_SWITCH_MSG_TAKING_OUT] },
        }]);
        return;
      }
      B.sayOriginal(b, { kind: MSG_KIND.OUTCOME, payload: [MSG.SWITCH_FAILED], name },
        `${name}: Switch failed!`);
      return;
    }

    const requestedSkillId = enemyActionSkillId(move.action || 1, en.eStats ?? {});
    const requestedSkill = requestedSkillId ? B.skillDB[requestedSkillId] : null;
    const usesTech = (move.action === 2 || move.action === 3) && !!requestedSkill;
    let skill = requestedSkill;
    if (!skill) skill = en.fightSkill ?? null;
    // The finale's head attacks with the technique it copied from the player: arm 22
    // state 2 rebuilt its own attack record (technique 440, the "?????" skill) from
    // the row latched while the tail stood, so that id serves the rebuilt record from
    // the head phase on (claim wfightmn-finale-kinds-2026-10-10).
    if (b._finaleCopiedAttack && (requestedSkillId | 0) === FINALE_HEAD_ATTACK_ID) skill = b._finaleCopiedAttack;
    if (!usesTech && skill) skill = { ...skill, basic_attack: true };
    if (usesTech) {
      const mpCost = techniqueMpCost(skill!.mp_cost ?? 0, 0, { enemySide: true }); // enemy side pays list price
      // F0x80088564's dispatch for action codes >= 2 (.L0x80088934-.L0x800889d0,
      // fightstg.s:6080-6100): the actor's current MP is tested against the technique
      // record's own u16 cost FIRST, and when it is below the cost the action is
      // replaced by esmfight[0x8d] "No MP!" (kind 2, the same page shape the ailment
      // gate uses) — no MP is taken and the technique never runs.
      if (en.mp < mpCost) {
        B.sayOriginal(b, { kind: MSG_KIND.OUTCOME, payload: [MSG.NO_MP], name }, `${name} has no MP!`);
        return;
      }
      en.mp -= mpCost;
    }

    // The record's own dispatch byte decides the count, exactly as on the player's
    // Fight: +0x0A == 9 -> the record's +0x11 hits, +0x0A < 2 -> one (the enemy side
    // carries no Multi Crest +0x37 byte, so that diversion cannot fire), else one.
    const hits = basicAttackHitCount(!!en.multiAttack, skill);
    // The SAME rule the player's side runs, on the enemy's side: a category-4 record is a
    // heal or a cure and never enters the resolver, because the original's applier rolls
    // for accuracy only on categories 2 and 3 (`pro/fightstg.s:28463 lbu $v1, 0x4($s4)` /
    // `:28465` / `:28467`, falling to `:28470 j .L0x8009e3c8` for every other category).
    // The record machine's category-4 handler `0x8008fbec` is the
    // shared system; 100 and 375 restore the PLAYER's party because that arm hard-codes
    // side 0 (`sw $zr, 0x64($s4)` :13448 / `addiu $a0, $v0, 0x4470` :13443).
    const restoreRecordBase = skill?.id ? (B.fightTechDB?.[String(skill.id | 0)] ?? null) : null;
    // The finale head's copied +0x0b/+0x0d/+0x0e/+0x0f ride on the copied skill.
    const restoreRecord = restoreRecordBase && skill?.techRecord
      ? { ...restoreRecordBase, ...skill.techRecord } : restoreRecordBase;
    // The SAME category-5 family the player's side runs, from the same one call. Knightmon's
    // `move_2` is Soul Charge (209) and Raidenmon's `move_1` is Gilead Plant (400) in
    // web/assets/data/enemies.json, so an ENEMY charges, locks, drains and heals too: the
    // same arms, the same record bytes, and every value read on whichever side acts next.
    const scripted = battleScriptedPlanFor(b, 1, restoreRecord, skill?.id ?? 0, { name });
    if (scripted) {
      const spec = scripted.page
        ? { kind: scripted.page.kind, payload: scripted.page.payload,
            name: scripted.page.name, slots: scripted.page.slots }
        : null;
      const text = scriptedWalkerSentence(scripted, skill, name);
      if (forcedDedigivolveLanded(scripted)) {
        // Tech 0x187 (391), roll landed: no page, EVENT_DIGIDEVOLVE is queued first (tech_action.c:586-588). The turn's
        // own delay is queued by the caller BEFORE the event runs (enemy_turn.c:260 ends the turn, menu.c:1446-1461
        // pops the event after), so the de-digivolve comes from advanceAfterResult.
        B.clearBattleLine(b);
        b._dedigivolvePending = true;
      } else if (spec) B.sayOriginal(b, spec, text); else B.sayWalker(b, text);
      B.renderer3d?.enemyAttack(skill!.id ?? en.profile?.tech_basic, { miss: false });
      return;
    }
    const restore = battleRestorePlanFor(b, 1, restoreRecord!, skill?.id ?? 0, { name });
    if (restore) {
      const spec = restore.page
        ? { kind: restore.page.kind, payload: restore.page.payload,
            name: restore.page.name, slots: restore.page.slots }
        : null;
      const text = restoreWalkerSentence(restore, skill, name);
      if (spec) B.sayOriginal(b, spec, text); else B.sayWalker(b, text);
      B.renderer3d?.enemyAttack(skill!.id ?? en.profile?.tech_basic, { miss: false });
      return;
    }
    // The category-6 field write, on the enemy's side too: F0x800907cc is the record
    // machine's ONE field arm, reached whichever side acts, so an enemy that casts a
    // field technique moves the battlefield element exactly as the player's does.
    if (restoreRecord?.category === 6) castFieldTechnique(b, 1, restoreRecord, B.elementNameForElem1(restoreRecord.elem1));
    // F0x8009d4b8: the multi-hit applier re-rolls only accuracy on one computed
    // damage value. Miss only if all whiff.
    let total = 0, healTotal = 0, anyHit = false, perHit = 0, landedHits = 1;
    if (restoreRecord?.dispatch === DAMAGE_TERM_REPEAT_WORD) {
      // FIGHTSTG_F0x8009ddd8 on the enemy's side too: the one disc record with dispatch
      // byte 0x1f is 406 Back Storm, which is Raijinmon's `move_2` in enemies.json. Two
      // hit slots, each rolled and computed independently, summed by the record machine.
      const r = B.resolveRepeatDispatch(en, b.player, skill, 1, b.field);
      total = r.total; anyHit = r.landed > 0; perHit = total; landedHits = Math.max(1, r.landed | 0);
    } else if (hits > 1) {
      const r = resolveMultiHit(en, b.player, skill, hits, RAND_U16, b.field);
      total = r.dmg; healTotal = r.heal; anyHit = r.hit; perHit = r.dmgPerHit; landedHits = Math.max(1, r.landed | 0);
    } else {
      const r = resolveAttack(en, b.player, skill, RAND_U16, b.field);
      if (r.hit) { total += r.dmg; healTotal += r.heal; anyHit = true; perHit = r.dmg; landedHits = 1; }
    }
    const elemTag = (skill?.element && skill.element !== "normal") ? ` [${skill.element}]` : "";
    const skillName = skill?.name && skill.name !== "Fight" ? skill.name : null;
    // The ordinary attack's own announcement plate -- the SHARED one the player's
    // "Fight" choice already puts up (`confirmCommand` / `confirmJokePick`). The
    // original's attack-resolution sequencer builds kind 2 `esmfight[0x08]` "Attack!"
    // for whichever side swings (`pro/fightstg.s:14548`-`:14556`), so the enemy
    // announces through the same plate; until now the enemy action never reached it and
    // only the damage page followed. A named technique has its own page (kind 3,
    // `enemyTechniqueSpec`), which is why this is gated on the basic-attack word.
    if (!skillName) B.sayOriginal(b, B.attackSpec(b, name)!, `${name} attacks!`);
    if (anyHit) {
      const lethal = total >= b.player.hp;
      // the enemy's blow comes off contact by contact too (A12)
      const contact = B.armContactDamage(b.player, total, perHit, landedHits);
      let committed = false;
      const commitImpact = () => {
        if (committed) return;
        committed = true;
        b.player.hp = Math.max(0, b.player.hp - contact.remaining());
        // The disc's hit-gain gate (wfightmn 0x4330 = 0x800aa110): no gain on a lethal hit, nor while Blast is up.
        const hitGain = hitGaugeGain(total, b.player.maxHp, b.player.hp, { blastActive: !!b.blast?.active, accessories: b.player.gaugeAccessories });
        if (hitGain !== null) {   // the writer ran; `null` means it short-circuited on a KO or a Blast [BLAST-C002]
          b.player.gauge = normalizeDvGauge(b.player.gauge + hitGain);
          persistPlayerGauge(b);
          if (B.blastReady(b)) b._blastPending = true;
        }
        const enemyMissingBeforeHeal = Math.max(0, en.maxHp - en.hp);
        if (healTotal > 0) en.hp = Math.min(en.maxHp, en.hp + healTotal);
        b.message = (skillName
          ? `${name} uses ${skillName}${elemTag}! ${total} damage!`
          : `${name} attacks! ${total} damage!`);
        if (hits > 1) b.message += ` (${hits} hits)`;
        // As on the player's side: the ailment is the box's own next page, not a
        // fragment of the damage sentence (fightstg.s:14624-14626 and :15277-15279).
        const inflicted = tryInflict(skill, b.player, pname, en);
        // The resolver's post-hit dispatch (FIGHTSTG_F0x8009df78, pro/fightstg.s:28588):
        // a landed enemy hit also runs the record's +0x0a secondary effect, which is how a
        // Cardmon's attack lands the persistent stat penalty on the member it hit.
        const hitPages = [
          applyPostHitDispatch(b, restoreRecord, { lockRecord: B.fightTechDB?.[String(DAMAGE_TERM_FLEE_LOCK_RECORD)], playerName: pname, enemyName: name }),
          applyStatDebuffDispatch(b, 1, restoreRecord, { player: pname, enemy: name }),
        ].map((r) => (r as { page?: any })?.page ?? null).filter(Boolean);
        if ((restoreRecord?.dispatch! | 0) === RESULT_QUEUE.CROSS_SLASH) b._forcedFlee = true; // Cross Slash (record +0x0a = 35): its result-queue slot 35 drains to "the target flees" (fightstg F0x80091a8c)
        b.message += inflicted.text;
        b.message = prefix + b.message;
        // The line names the Digimon that took the damage, as on the player's side.
        // The enemy's technique announcement is the sequencer's OWN page before the
        // damage page (FIGHTSTG_F0x80090e84: `kind 3` at `pro/fightstg.s:14582`/`:14583`,
        // then `kind 4` at `:14654`/`:14655`), so a named technique no longer costs the
        // walker its damage page: it becomes the first page of the sequence.
        const counterText = B.triggerPlayerCounter(b, en, b.player, total, name, pname);
        const dmgSpec = B.damageSpec(pname, total,
          prefix || counterText, skill?.id ?? 0, 1,
          healTotal > 0
            ? { heal: healTotal, missingHp: enemyMissingBeforeHeal, healer: name }
            : null);
        const techPage = skillName ? {
          text: `${name} uses ${skillName}${elemTag}!`,
          spec: B.enemyTechniqueSpec(name, skill),
        } : null;
        const ailPage = ailmentBoxPage(pname, inflicted.ail);
        // The one machine that picks this line (FIGHTSTG_F0x8008cb70, ported by
        // engine/dw3/battle-result-page.ts), on the enemy's side too: an instant-death
        // KO lands on its second arm, which prints NOTHING and takes the damage line with
        // it. The technique announcement in front of it is the sequencer's OWN page
        // (FIGHTSTG_F0x80090e84), a different machine, so it stays.
        const { page: resultLine } = chooseResultLine({
          record: restoreRecord,
          multiHit: hits > 1,
          instantDeath: b.player.hp <= 0 && inflicted.text !== "",
          landed: anyHit,
          name: pname,
          damage: total,
        });
        const pages = [];
        if (techPage) pages.push(techPage);
        if (resultLine) pages.push({ text: b.message, spec: dmgSpec });
        if (ailPage) pages.push(ailPage);
        pages.push(...hitPages);
        // No page at all is a real answer, not a missing one: the chooser's instant-death
        // arm leaves the box empty (see `chooseResultLine`), so nothing is put up.
        if (!pages.length) B.clearBattleLine(b);
        else if (pages.length > 1) B.setResultPages(b, pages);
        else if (pages[0].spec) B.sayOriginal(b, pages[0].spec, pages[0].text);
        else B.sayWalker(b, pages[0].text);
      };
      B.armPendingImpact(b, commitImpact);
      const started = B.renderer3d?.enemyAttack(skill?.id ?? en.profile?.tech_basic, {
        lethal,
        onHit: B.contactOnHit(contact, commitImpact),
      });
      if (!started) commitImpact();
    } else {
      // A miss prints the box's own evasion page, the same shared `evadeSpec` the
      // player's attack uses: the sequencer writes `esmfight[0x1d]` "Evade!" under the
      // defender's name when nothing landed, either side (`pro/fightstg.s:14673`/`:14674`).
      // The enemy path used to leave a typed sentence here, so the announcement plate
      // above was the only page; now the miss reads the disc's own words too.
      B.sayOriginal(b, B.evadeSpec(b, pname)!, prefix + `${pname} evaded!`);
      B.renderer3d?.enemyAttack(skill?.id ?? en.profile?.tech_basic, { miss: true });
    }
  }
function applyParticipantProgress(b: BattleEndContext, rosterIndex: number) {
    const player = b.playerRecords[rosterIndex];
    const ps = player.statsRecord;
    const prof = player.profile;
    // The disc's level curve and level-up rolls read the member's STARTER
    // species' profile row (0x8003EF5C + slot*0x58), never the active form's
    // row — see levelUpGrowthProfile. `prof` stays the active form for every
    // other use below (the dvexpByForm migration key, the returned formId, the
    // per-form DVEXP caps, the stored-stat seed).
    const growthProfile = levelUpGrowthProfile(player, B.digimonDB) ?? prof;
    const reward = B.winRewards(b, rosterIndex);
    const lu = B.progressionDB?.level_up;
    // The partner as it stood BEFORE this battle's rewards: the results screen
    // replays the disc's own rules from this snapshot on a private record, so it
    // shows the same outcome this function applies (once) to the walker's state.
    const before = JSON.parse(JSON.stringify(ps));
    const oldXp = ps.xp ?? 0;
    const newXp = Math.min(oldXp + reward.xp, lu?.exp_cap ?? 999999);
    const oldLevel = ps.level ?? 1;
    const newLevel = lu ? levelForExp(oldLevel, newXp, growthProfile.growth_xp ?? 8, lu)
                        : 1 + Math.floor(newXp / 100);
    let levelUp = false;
    let availableEvos = [];
    const learnedTechs = [];
    const loadableTechs = [];
    const formLevelsGained = [];
    const unlocked = [];
    const namedSkill = (id: number) => B.skillDB?.[Number(id) & 0x1fff]?.name ?? "";

    if (newLevel > oldLevel) {
      levelUp = true;
      // The disc's level-up writes the level, the rolls, and TP — never HP or MP,
      // so the partner keeps the damage the battle left (applyLevelUp). The rolls
      // read the STARTER row's growth bytes (growthProfile), not the form's.
      applyLevelUp(ps, prof, oldLevel, newLevel, lu, growthProfile);
      if (rosterIndex === 0)
        availableEvos = treeCandidatesFor(B.evolutionTrees, B.digimonDB, B.partyFormState(B.getState(), rosterIndex));
    }
    ps.xp = newXp;

    // DVEXP is paid to every form the battle TOOK, not only the one in the seat
    // at the end. F0x800A69F0 marks the equipped row of the form just taken
    // (the lead at setup, then each Manual DV and Tag commit), and the report's
    // state-0x14 arm runs dvGain + dvLadder for every marked row (stfgtrep.s
    // file 0x12C0, reading byte 7 + formIndex of the position's word). A form
    // with no row to mark — the rookie — banks nothing and gets no ledger entry.
    // The share divisor is the number of MARKED FORMS across the standing rows
    // (dvexpShareCount), not the number of positions: a mid-battle DV adds a
    // second mark to its row and enlarges the divisor. The state-0x16/0x17 arms
    // then try ONE learn and ONE loadable per marked form, at the level the
    // ladder just landed on.
    if (reward.dvexp > 0) {
      ps.dvexpByForm ??= {};
      if (ps.dvexp) {
        ps.dvexpByForm[prof.id] = (ps.dvexpByForm[prof.id] ?? 0) + ps.dvexp;
        delete ps.dvexp;
      }
      ps.formLedger ??= [];
      const participants = dvexpShareCount(b.formFlags, paidParticipants(b));
      for (const formId of markedEquippedForms(b.formFlags?.[rosterIndex], ps.equippedForms)) {
        const formProfile = B.digimonDB?.[formId] ?? B.profileById(formId!) ?? prof;
        let record = ps.formLedger.find((r: FormLedgerEntry) => Number(r.id) === Number(formId));
        if (!record) {
          record = { id: formId, formLevel: 1, dvexp: ps.dvexpByForm[formId] ?? 0,
            techSlots: [0, 0, 0, 0, 0, 0] };
          ps.formLedger.push(record);
        }
        const oldFormLevel = record.formLevel ?? 1;
        const oldSlots = [...(record.techSlots ?? [0, 0, 0, 0, 0, 0])];
        if (record.dvexp == null) record.dvexp = ps.dvexpByForm[formId] ?? 0;
        const formCap = formProfile.dv_cap ?? 100;
        // A form already at level 99 banks nothing (bankFormDvexp / the disc's
        // ladder early return); a lower one takes the gain and the ladder.
        const leveled = bankFormDvexp(record, dvexpGain(reward.dvexp, ps.level ?? 1,
          participants, oldFormLevel, formCap), formCap, lu?.dvexp_cap ?? 9999999);
        if (leveled) {
          // EVERY technique the new form level has passed, then every loadable
          // it unlocked — the report LOOPS both services. F0x8008670C is called
          // from state 0x16, which the state-0x19 message-done dispatch re-enters
          // through selector 1 (its table at 0x80082d80 points selectors 0 AND 1
          // at 0x800843f4 = state 0x16) until the service answers 0; F0x80086844
          // loops the same way through selector 2 -> state 0x17. Proven by
          // running the original F0x80083E74 in engine/native: msg-done with
          // selector 1 writes state 0x16 (tests/report-row-oracle.test.js
          // carries the case). The signature is ledger slot 5 with its own learn
          // gate (+0x36) — see web/form-tech-slots.js.
          applyFormLearnPass(record, formProfile);
        }
        ps.dvexpByForm[formId] = record.dvexp;
        if (record.formLevel > oldFormLevel)
          formLevelsGained.push({ name: formProfile.name, level: record.formLevel });
        for (let i = 0; i < 6; i++) {
          const now = record.techSlots[i] ?? 0;
          const was = oldSlots[i] ?? 0;
          if (!was && now) {
            const name = namedSkill(now);
            if (name) learnedTechs.push(name);
          }
          if (i < 5 && !(was & 0x2000) && (now & 0x2000)) {
            const name = namedSkill(now);
            if (name) loadableTechs.push(name);
          }
        }
      }
    }

    // "Digivolve learned": the disc's unlock routine, once per battle. It takes the
    // member's ROSTER SLOT, picks that line's tree out of the eight pointers at
    // 0x8008903C and grants the FIRST record in table order whose gates pass, then
    // stops — one acquisition a battle, and a form already in the ledger is skipped.
    const acquired = nextUnlockedEvolution(B.evolutionTrees,
      b.playerRoster[rosterIndex]?.slot ?? 0, ps);
    const acquiredProf = acquired ? B.profileById(acquired.toId) : null;
    if (acquiredProf) {
      ps.formLedger ??= [];
      if (!ps.formLedger.some((r: FormLedgerEntry) => Number(r.id) === Number(acquiredProf.id)))
        ps.formLedger.push({ id: acquiredProf.id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
      ps.equippedForms ??= [];
      let slotFull = false;
      if (!ps.equippedForms.includes(acquiredProf.id)) {
        // stfgtrep file 0x3884-0x38C0: the new form goes into the first slot
        // holding a value < 3; a full triple is left alone and the report says so.
        const fitted = autoEquipForm(ps.equippedForms, acquiredProf.id);
        ps.equippedForms = fitted.equipped;
        slotFull = !fitted.equippedNow;
      }
      unlocked.push({ name: acquiredProf.name, slotFull, id: acquiredProf.id });
    }

    // read-only look data for the victory rings (web/ui-c): how far through its level the EXP stood before and stands after
    const levelFrac = (xp: number, lv: number) => {
      if (!lu) return 0;
      const g = growthProfile.growth_xp ?? 8, lo = lv <= 1 ? 0 : levelUpThreshold(g, lv, lu), hi = levelUpThreshold(g, lv + 1, lu);
      return Number.isFinite(hi) && hi > lo ? Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) : 1;
    };
    const ringA = levelFrac(oldXp, oldLevel), ringB = levelUp ? 1 : levelFrac(newXp, newLevel);
    return {
      ringA, ringB,
      xp: reward.xp, oldXp, oldLevel, newLevel, levelUp, availableEvos,
      before, formId: prof.id,
      name: b.playerRoster[rosterIndex]?.name ?? prof?.name ?? "",
      learnedTechs, loadableTechs, formLevels: formLevelsGained, unlocked,
    };
  }
// Pick enemy action from ai_moves (sdigiedt Moves struct) through the engine's
  // F0x80088564 selection loop (engine/dw3/battle-formulas.ts::pickEnemyAiMove): rows
  // 0..2 are condition-tested in order and the first passing row wins; the FOURTH row
  // is taken unconditionally when none passes — the loop exits on `slti $s1, 0x3` and
  // `sll $v0, $s1, 0x2` reads row 3 without ever evaluating its condition
  // (fightstg.s:6050-6056). Conditions 0-8, 9, 10-13 are wired, and 14-18 read the
  // acting record's own live halfwords — +0x0e affinity, +0x10/+0x12/+0x14 the three stat
  // modifiers, +0x04 the per-slot action-turn counter the turn handler bumps above.
  function pickEnemyMove(en: EnemyBattleRecord) {
    const moves = en.eStats?.ai_moves;
    if (!moves || !moves.length) return { action: 1 };
    // check_move_cond operands: the active party form (0x800a4468 record +0x00
    // -> DIGIMON_PROFILES row), the party member's own ailment byte (record +0x1c,
    // cond 9), the field element (0x800a4530), the battle id (0x80042b2c) and
    // encounter config byte 1 (0x80042b59). The enemy-slot scan (cond 10) reads the enemy
    // team (enemyConditionSlots: the boss party, slots 0..2); a one-member fight sees only
    // this actor, so condition 10 is false there.
    const context = {
      partyProfileId: B.battle.player?.profile?.id ?? null,
      partyAilmentByte: battleAilmentByte(B.battle.player),
      fieldElementId: B.battle.field ? elementId(B.battle.field.element) : 0,
      battleId: B.battle.screenId ?? null,
      encounterGateByte: B.battle.encounterGateBytes?.[1] ?? null,
      ...B.enemyConditionSlots(B.battle, en),
    };
    // F2 -> Battle -> "Pattern breaker" (new, off by default; web/enemy-tells.js): the
    // every-Nth rows (comparator 18) test one turn further on, so each such special
    // fires a turn early. Only the counter moves — hp/mp/affinity/statMods pass through,
    // so conditions 2-17 read exactly what they read before; with the switch off `en`
    // stays the enemy record itself, so the picks and the RNG draws are unchanged.
    if (window.__fx?.aishift) en = { ...en, turnCounter: (en.turnCounter ?? 0) + 1 };
    const picked = pickEnemyAiMove(moves, en, RAND_U16, B.battle.player, context);
    if (picked) return picked;
    // Only when the extracted row set has no fourth row at all (the disc's record always
    // carries four) does the walker keep its explicit safe fallback: a basic attack.
    return { action: 1 };
  }
  return { applyEnemyAction, applyParticipantProgress, pickEnemyMove };
}
