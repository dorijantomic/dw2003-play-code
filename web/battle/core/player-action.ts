import { enemyMsgName } from "../hud.js";
import {
  processTurnStart,
  resolveMultiHit,
  resolveAttack,
  tryInflict,
  applyWeaponSecondary,
  ailmentBoxPage,
  chooseResultLine,
  effStats,
} from "../hit-results.js";
import {
  jokeGagMessageSpec,
  MSG_KIND,
  MSG,
  ST,
  scriptedWalkerSentence,
  restoreWalkerSentence,
} from "../messages.js";
import {
  basicAttackHitCount,
  RAND_U16,
  techniqueMpCost,
  DAMAGE_TERM_REPEAT_WORD,
  DAMAGE_TERM_FLEE_LOCK_RECORD,
  RESULT_QUEUE,
  isBattleEffectItem,
  chargeHealPage,
  chargeNoEffectPage,
  useBattleItem,
  resolveDamage,
  magicalBase,
  storeRemoveItem,
} from "../../vendor/engine.js";
import { applyPostHitDispatch } from "../status.js";
import { battleScriptedPlanFor, forcedDedigivolveLanded } from "../plans.js";
import { battleRestorePlanFor, castFieldTechnique, applyStatDebuffDispatch } from "../restore.js";
import { isThrowItem } from "../../fight/fight-tables.js";
import { persistPlayerGauge } from "../form-blast.js";
import { finalizePlayerDamage } from "../../battle.js";
import type { BattleContext } from "../../types/battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makePlayerAction(B: BattleContext) {
function applyPlayerAction() {
    const b = B.battle;
    const action = b.pendingAction;
    if (!action) return;
    // Layer key 0x1009 shows the speaking side; this line is the player's
    // (talk-system speaker id 0).
    B.renderer3d?.setFaceCamSpeaker?.(0);
    const pname     = b.player.profile.name;
    const enemyName = enemyMsgName(b.enemy);

    // Action resolve, not the turn gate: the original's guard here is F0x80098600, which
    // tests the sleep bit (0x08) and nothing else. The Frozen roll already happened in
    // front of the command menu (`frozenGateLosesTurn`, F0x800a7418 step 1) and the
    // confuse bit was the joke list, so neither is rolled a second time here.
    const ts = processTurnStart(b.player, pname, false, false);
    if (ts.skipped) {
      // The gate's own page: the name on line one, the disc's line on line two
      // ("Asleep!", one of the eight confuse one-liners, "Frozen and can't move!").
      // FIGHTSTG_F0x80088564's three arms share the tail at fightstg.s:6017-6025.
      //
      // `ts.spec` is always there for a skipped turn: `processTurnStart` skips only for
      // sleep, frozen or confusion (engine/dw3/battle-combat.ts:571-584) and
      // `ailmentTurnStartMessageSpec` has an arm for each of those three, so there is no
      // typed sentence left on this path. `ts.prefix` is the empty string for the same
      // reason (battle-combat.ts:565), which is why the walker no longer offers its own
      // wording here.
      B.sayOriginal(b, ts.spec, ts.prefix);
      b.pendingAction = null;
      return;
    }
    const prefix = ts.prefix ? ts.prefix.trim() + " " : "";

    if (action.type === "confused") {
      // The joke gag is the battle message box's own two lines (F0x8009a734,
      // fightstg.s:24505-24595): the Digimon's name, then the phrase off 0x800a35e4. The
      // walker's sentence stays in `b.message` only so `peek()`
      // still has something to say.
      B.sayOriginal(b, jokeGagMessageSpec(pname, action.jokeIndex ?? 0, action.flavorBit ?? 0),
        prefix + `${pname} is confused! ${action.flavor}`);
    } else if (action.type === "tag") {
      if (B.applyTagAction(action)) {
        b.pendingAction = null;
        return true;
      }
    } else if (action.type === "dna") {
      if (B.applyDnaAction(action)) {
        b.pendingAction = null;
        return "dna";
      }
    } else if (action.type === "dv") {
      B.applyDvAction(action);
    } else if (action.type === "fight") {
      const basicSkill = B.skillDB[b.player.profile.tech_basic];
      // The row's own category: every player basic technique is a physical row on the disc
      // (only id 440, the finale head's attack, is a basic row that is magical).
      let skill = basicSkill ? { ...basicSkill } : null;
      // The record the original's own page chooser reads: the technique id is
      // `self+0x54` (`pro/fightstg.s:13109` forms `0x80042bca + 18 * id` from it), and for
      // a basic attack that id is the form's own basic technique. The id runs through the
      // fight task spawner (FIGHTSTG_F0x80090c44), which stores the acting side at +0x50 and
      // the technique word at +0x54; the machine reads the id back off the spawned object.
      const basicTechId = B.spawnFightTaskFor(0, skill?.id ?? b.player.profile.tech_basic ?? 0).technique;
      // The worn weapon element (+0x2b/+0x2c, *Power accessories) is added by the shared
      // damage stage to every physical row whose own element is below 2 (basic attacks and
      // techniques alike, F0x8009f6dc 0x8009f804-0x8009f864): there is no basic-attack test.
      if (skill) skill = { ...skill, basic_attack: true };
      // F0x8009e0cc .L0x8009e238-.L0x8009e3a4: the record's own dispatch byte (+0x0A)
      // picks the count — 9 takes the multi-hit applier on the record's +0x11 hits,
      // below 2 the Multi Crest three-hit diversion (clip outside {0xb,0xc}), anything
      // else one. The enemy's action runs the same function below.
      const attempts = basicAttackHitCount(b.player.multiAttack, skill);
      let total = 0, landed = 0, perHit = 0;
      if (attempts > 1) {
        // F0x8009d4b8: the damage value is computed once (accuracy #1 first, then
        // the leaf with its single critical roll) and each further attempt re-rolls
        // only accuracy on that same value. Re-rolling damage here was the
        // browser's divergence (BATTLE-Q004-ROLLTABLE-001).
        const r = resolveMultiHit(b.player, b.enemy, skill, attempts, RAND_U16, b.field);
        total = r.dmg; landed = r.landed; perHit = r.dmgPerHit;
      } else {
        const r = resolveAttack(b.player, b.enemy, skill, RAND_U16, b.field);
        if (r.hit) { total += r.dmg; landed++; perHit = r.dmg; }
      }
      const hit = landed > 0;
      if (hit) {
        total = finalizePlayerDamage(b, total); const lethal = total >= b.enemy.hp;
        // the damage comes off contact by contact (A12); the final strike pays the remainder
        const contact = B.armContactDamage(b.enemy, total, perHit, landed);
        let committed = false;
        const commitImpact = () => {
          if (committed) return;
          committed = true;
          b.enemy.hp = Math.max(0, b.enemy.hp - contact.remaining());
          B.recordFinaleTechnique(b, basicTechId);   // the finale's latch (F0x800aa06c), before the wrapper
          if (total > 0) B.noteFinalBossPhaseDamage(b);   // the final boss's 3rd landed blow switches boss04 on
          let message = `${enemyName} took ${total} damage!`;
          let extra = "";
          if (attempts > 1) message += ` (${landed}/${attempts} hits)`;
          // The landed ailment is NOT part of that sentence. It is the box's own next
          // page: the original shows the damage page (kind 4), waits for the player to
          // read it, and only then builds the "apply what landed" object that prints the
          // ailment word (kind 2) — fightstg.s:14624-14626, :14705, :15198-15260.
          const inflicted = tryInflict(skill, b.enemy, enemyName, b.player);
          const weapon = applyWeaponSecondary(b.player, b.enemy, enemyName, total, pname);
          const stolen = B.trySteal(skill, b.enemy, B.getState(), pname);
          // The record's own dispatch byte — a hit's SECONDARY effect off record +0x0a,
          // the shared dispatcher FIGHTSTG_F0x8009df78 the resolver calls on a landed hit
          // (pro/fightstg.s:28588). A different machine from the `tryInflict` line above
          // (which reads the technique's own `effect`); its stat-penalty arms write the
          // persistent halfwords the inn later rests away.
          applyPostHitDispatch(b, B.fightTechDB?.[String(basicTechId)] ?? null);
          message += inflicted.text;
          extra += weapon.text + stolen.text
            + B.triggerEnemyCounterRow(b, b.player, b.enemy, total, pname, enemyName);
          message += extra;
          const ailPage = ailmentBoxPage(enemyName, inflicted.ail ?? weapon.ail);
          // The one machine that picks this line (FIGHTSTG_F0x8008cb70, ported by
          // engine/dw3/battle-result-page.ts). An instant-death KO lands on its second
          // arm, which prints NOTHING and takes the damage line with it — see
          // `chooseResultLine`. A signature weapon's KO writes the same queue slot a
          // technique's does, so it silences the line the same way.
          const { page: resultLine } = chooseResultLine({
            record: B.fightTechDB?.[String(basicTechId)] ?? null,
            multiHit: attempts > 1,
            instantDeath: b.enemy.hp <= 0 && (inflicted.text !== "" || weapon.ko),
            landed: landed as unknown as boolean,
            name: enemyName,
            damage: total,
          });
          B.setResultPages(b, [
            resultLine
              ? { text: prefix + message,
                spec: B.damageSpec(enemyName, total, prefix || extra, basicTechId, 0) }
              : null,
            ailPage,
            // The weapon's drain and a landed steal are PAGES of the box in their own
            // right (kinds 18 and 17), not fragments of the damage sentence: the
            // original's weapon machine builds each line object and asks the panel
            // separately (FIGHTSTG_F0x80091534, fightstg.s:15005 / :15055). The walker
            // keeps the flat sentence above for peek().
            weapon.page ? { text: weapon.text, spec: weapon.page } : null,
            stolen.page ? { text: stolen.text, spec: stolen.page } : null,
            lethal || b.enemy.hp <= 0 ? { text: `${enemyName} has been defeated!`,
              spec: B.defeatedSpec(enemyName) } : null,
          ]);
          // No page at all is a real answer, not a missing one: the chooser's
          // instant-death arm leaves the box empty (see `chooseResultLine`).
          if (!b._resultPages.length) B.clearBattleLine(b);
        };
        B.armPendingImpact(b, commitImpact);
        const started = B.renderer3d?.playerAttack(b.player.profile.tech_basic, {
          lethal,
          onHit: B.contactOnHit(contact, commitImpact),
        });
        if (!started) commitImpact();
      } else {
        // A basic attack that missed. The original's attack-resolution sequencer
        // FIGHTSTG_F0x80090e84 prints the evasion page on its own --
        // `pro/fightstg.s:14670` (`li $v0, 0x1d` = "Evade!") / `:14671` (payload word 0)
        // / `:14673` (`li $a1, 0x2`) / `:14674` (`lw $v0, 0xac($a0)`) -- so this is the
        // disc's word under the defender's name and never the walker's sentence.
        B.recordFinaleTechnique(b, basicTechId);   // a miss still reaches the latch (wfightmn.s:4ae8 -> 4b5c -> 4b7c)
        B.sayOriginal(b, B.evadeSpec(b, enemyName), `${enemyName} evaded!`);
        B.renderer3d?.playerAttack(b.player.profile.tech_basic, { miss: true });
      }
    } else if (action.type === "tech") {
      const skill = action.skill;
      // FIGHTSTG_F0x800a1d3c (TL-010): the displayed price, the sufficiency test and
      // the debit are one result. Proxy reduction floors at 1 first; the loaded
      // +20% premium then adds max(1, floor(cost/5)).
      const cost = techniqueMpCost(skill.mp_cost ?? 20, skill.techWord ?? 0, {
        mpCostDown: b.player.mpCostDown ?? 0,
      });
      // While Blast is active, technique execution bypasses MP sufficiency and
      // debit — techniques are free (menu MP-gate skipped at 0x80096548) [BLAST-C004].
      if (!b.blast?.active) {
        if (b.player.mp < cost) {
          // The original's technique-MP gate asks for its own page here: the damage
          // machine compares the technique's cost against the actor's MP
          // (`lh $v0, 0xc($a1)` at `pro/fightstg.s:10210` and `slt $v0, $v1` at :10212)
          // and prints `esmfight[0x8d]` "No MP!" through **kind 2** at :10219-:10227
          // (`li $v0, 0x8d` / `sw $v0, 0x60($s0)` / `li $a1, 0x2` / `lw $v0, 0xac($a0)`).
          // The command-gate arm prints the same word at :6104-:6113.
          B.sayOriginal(b, {
            kind: MSG_KIND.OUTCOME, payload: [MSG.NO_MP], name: b.player.profile?.name,
          }, "Not enough MP!");
          b._nextState = ST.ENEMY_ACT;
          b.pendingAction = null;
          return;
        }
        b.player.mp -= cost;
      }
      // The resolver's own count (F0x8009e0cc 0x8009e238-0x8009e26c): dispatch 9 = the
      // record's +0x11, dispatch < 2 on a physical row with Multi Crest = 3, else one.
      const hits = basicAttackHitCount(b.player.multiAttack, skill);
      // A CATEGORY-4 record is a heal or a cure, not a hit, so it never enters the
      // resolver at all: the record machine's category-4 handler `0x8008fbec`
      // (`pro/fightstg.s:13269`-`:13664`) is what runs, and the applier
      // `FIGHTSTG_F0x8009e0cc` makes NO accuracy roll for it (`:28463 lbu $v1, 0x4($s4)` /
      // `:28465` / `:28467` reach the accuracy getters for categories 2 and 3; `:28470
      // j .L0x8009e3c8` sends everything else, category 4 included, down a roll-free path).
      // One rule,
      // keyed on the record's own category byte, for the player's side and the enemy's.
      // The action the command phase starts is the fight task FIGHTSTG_F0x80090c44 spawns
      // (engine/dw3/battle-task-spawn.ts): the acting side byte at +0x50 and the technique
      // word at +0x54. The record machine runs the id read back off the spawned object, so the
      // shared spawner owns the hand-off rather than a bare local.
      const actionTechId = B.spawnFightTaskFor(0, skill.id | 0).technique;
      const restoreRecord = B.fightTechDB?.[String(actionTechId)] ?? null;
      // f7 == 10 (63 / 90 / 121 / 122): the resolver F0x8009e0cc sends a PLAYER's use to F0x8009d72c, which
      // only writes the slot byte -- no accuracy roll, no damage, no status, no post-hit dispatch, and the
      // action task skips the technique's animation (fightstg.s:28425-28461, :27745-27760, :13067-13096). The
      // MP above stays debited: the disc's charge for an unused technique is not read.
      if ((restoreRecord?.dispatch | 0) === 10) {
        B.setResultPages(b, []);
        B.clearBattleLine(b);
        b.pendingAction = null;
        return false;
      }
      // THE WHOLE CATEGORY-5 FAMILY is one call, both sides, before the category-4
      // gate below: the eight arms of `0x8009021c` (the stat table pair, the two Chi
      // arms, the two roll-gated locks, the no-page arm, the MP transfer and Gilead
      // Plant) all run in the original's state-1 sub-state 1 and all deal no damage, so
      // none of them reaches the resolver. `battleScriptedPlanFor` is null for every
      // other technique, which is what makes it the gate.
      const scripted = battleScriptedPlanFor(b, 0, restoreRecord, skill.id, { name: pname });
      if (scripted) {
        const spec = scripted.page
          ? { kind: scripted.page.kind, payload: scripted.page.payload,
              name: scripted.page.name, slots: scripted.page.slots }
          : null;
        // Tech 0x187 (391) with its roll landed builds NO page: it queues EVENT_DIGIDEVOLVE (tech_action.c:586-588).
        if (forcedDedigivolveLanded(scripted)) {
          B.setResultPages(b, []);
          B.clearBattleLine(b);
          b._dedigivolvePending = true;
        } else {
          B.setResultPages(b, [{
            text: scriptedWalkerSentence(scripted, skill, pname),
            spec,
          }]);
        }
        B.renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, { miss: false });
        b.pendingAction = null;
        return false;
      }
      const restore = battleRestorePlanFor(b, 0, restoreRecord, skill.id, { name: pname });
      if (restore) {
        const spec = restore.page
          ? { kind: restore.page.kind, payload: restore.page.payload,
              name: restore.page.name, slots: restore.page.slots }
          : null;
        B.setResultPages(b, [{
          text: restoreWalkerSentence(restore, skill, pname),
          spec,
        }]);
        B.renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, { miss: false });
        // The turn itself is queued by the caller's `queueAfterAction(b, "player")`,
        // exactly as every other action path is.
        b.pendingAction = null;
        return false;
      }
      // THE SEVEN FIELD TECHNIQUES (category 6, records 213..219) are the record
      // machine's own field writer: FIGHTSTG_F0x800907cc stores the technique's
      // element (record +0x07, elem1 = fire..dark) and its 64 power byte (record
      // +0x0c, the same 64 the seven field items write) into the battle header's
      // field pair (0x800a4530/+2), then prints esmfight[elem1 + 0x61]. The
      // browser printed the word but never wrote the pair, so the field never
      // moved. It is always on, as on the disc; castFieldTechnique has the power and timer.
      if (restoreRecord?.category === 6) castFieldTechnique(b, 0, restoreRecord, B.elementNameForElem1(restoreRecord.elem1));
      // Every remaining technique on this path is an ORDINARY attack, so the resolver
      // runs: the category-4 arm above is the only one that does not, because the
      // original's applier rolls for accuracy on categories 2 and 3 alone
      // (`pro/fightstg.s:28463 lbu $v1, 0x4($s4)` / `:28465` / `:28467`, falling to
      // `:28470 j .L0x8009e3c8` for every other category).
      // F0x8009d4b8: multi-hit applier re-rolls only accuracy on one computed
      // damage value. Miss only if all whiff.
      let total = 0, healTotal = 0, anyHit = false, perHit = 0, landedHits = 1;
      if (restoreRecord?.dispatch === DAMAGE_TERM_REPEAT_WORD) {
        // FIGHTSTG_F0x8009ddd8: the dispatch-byte-0x1f arm. Two hit slots, each with its
        // own accuracy roll and its own damage leaf, summed by the record machine. The
        // one disc technique that reaches it is 406 Back Storm.
        const r = B.resolveRepeatDispatch(b.player, b.enemy, skill, 0, b.field);
        total = r.total; anyHit = r.landed > 0; perHit = total; landedHits = Math.max(1, r.landed | 0);
      } else if (hits > 1) {
        const r = resolveMultiHit(b.player, b.enemy, skill, hits, RAND_U16, b.field);
        total = r.dmg; healTotal = r.heal; anyHit = r.hit; perHit = r.dmgPerHit; landedHits = Math.max(1, r.landed | 0);
      } else {
        const r = resolveAttack(b.player, b.enemy, skill, RAND_U16, b.field);
        if (r.hit) { total += r.dmg; healTotal += r.heal; anyHit = true; perHit = r.dmg; landedHits = 1; }
      }
      const elemTag = (skill.element && skill.element !== "normal") ? ` [${skill.element}]` : "";
      if (anyHit) {
        total = finalizePlayerDamage(b, total); const lethal = total >= b.enemy.hp;
        // the damage comes off contact by contact (A12); the final strike pays the remainder
        const contact = B.armContactDamage(b.enemy, total, perHit, landedHits);
        let committed = false;
        const commitImpact = () => {
          if (committed) return;
          committed = true;
          b.enemy.hp = Math.max(0, b.enemy.hp - contact.remaining());
          B.recordFinaleTechnique(b, actionTechId);   // the finale's latch (F0x800aa06c), before the wrapper
          if (total > 0) B.noteFinalBossPhaseDamage(b);
          let message = `${enemyName} took ${total} damage!`;
          let extra = "";
          if (hits > 1) message += ` (${hits} hits)`;
          if (healTotal > 0) {
            const before = b.player.hp;
            b.player.hp = Math.min(b.player.maxHp, b.player.hp + healTotal);
            const recovered = b.player.hp - before;
            if (recovered > 0) { message += ` Drained ${recovered} HP!`; extra += "drain"; }
          }
          // The heal and cure arms never reach this block, so the only HP this path can
          // add to the player is a weapon drain.
          const missingForPage = Math.max(0, b.player.maxHp - b.player.hp);
          const after = tryInflict(skill, b.enemy, enemyName, b.player);
          const weapon = applyWeaponSecondary(b.player, b.enemy, enemyName, total, pname);
          const stolen = B.trySteal(skill, b.enemy, B.getState(), pname);
          // A hit's SECONDARY effect off the record's dispatch byte: FIGHTSTG_F0x8009df78,
          // the resolver's own post-hit call (pro/fightstg.s:28588). See
          // `applyPostHitDispatch`. No-op unless the record is a stat-penalty arm.
          const hitPages = [
            applyPostHitDispatch(b, restoreRecord, { lockRecord: B.fightTechDB?.[String(DAMAGE_TERM_FLEE_LOCK_RECORD)], playerName: pname, enemyName }),
            applyStatDebuffDispatch(b, 0, restoreRecord, { player: pname, enemy: enemyName }),
          ].map((r) => (r as { page?: any })?.page ?? null);
          if ((restoreRecord?.dispatch | 0) === RESULT_QUEUE.CROSS_SLASH) b._enemyFled = true; // Cross Slash (record +0x0a = 35): its result-queue slot 35 drains to "the target flees" (fightstg F0x80091a8c) — here the target is the enemy
          message += after.text;
          extra += after.text + weapon.text + stolen.text
                      + B.triggerEnemyCounterRow(b, b.player, b.enemy, total, pname, enemyName);
          const ailPage = ailmentBoxPage(enemyName, after.ail ?? weapon.ail);
          // The one machine that picks this line (FIGHTSTG_F0x8008cb70, ported by
          // engine/dw3/battle-result-page.ts). An instant-death KO lands on its second
          // arm, which prints NOTHING and takes the damage line with it.
          const { page: resultLine } = chooseResultLine({
            record: restoreRecord,
            multiHit: hits > 1,
            instantDeath: b.enemy.hp <= 0 && (after.text !== "" || weapon.ko),
            landed: anyHit,
            name: enemyName,
            damage: total,
          });
          B.setResultPages(b, [
            resultLine
              ? { text: prefix + message,
                spec: B.damageSpec(enemyName, total, prefix || extra, skill?.id ?? 0, 0, {
                  heal: healTotal, missingHp: missingForPage, healer: pname,
                }) }
              : null,
            ailPage,
            ...hitPages,
            weapon.page ? { text: weapon.text, spec: weapon.page } : null,
            stolen.page ? { text: stolen.text, spec: stolen.page } : null,
            lethal || b.enemy.hp <= 0 ? { text: `${enemyName} has been defeated!`,
              spec: B.defeatedSpec(enemyName) } : null,
          ]);
          // No page at all is a real answer, not a missing one: the chooser's
          // instant-death arm leaves the box empty (see `chooseResultLine`).
          if (!b._resultPages.length) B.clearBattleLine(b);
        };
        B.armPendingImpact(b, commitImpact);
        const started = B.renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, {
          lethal,
          onHit: B.contactOnHit(contact, commitImpact),
        });
        if (!started) commitImpact();
      } else {
        // A technique that missed is TWO pages in the original, not one sentence: the
        // attack-resolution sequencer FIGHTSTG_F0x80090e84 asks for the technique
        // announcement (`kind 3`, `pro/fightstg.s:14582`/`:14583`) and then, when no
        // attempt landed, for the evasion page (`kind 2`, `:14673`/`:14674`) -- the same
        // two calls it makes for a technique that lands, where the second is the damage
        // page instead (`:14654`/`:14655`). The walker used to flatten both into
        // "<tech>! <enemy> evaded!".
        const text = prefix + `${skill.name}${elemTag}! ${enemyName} evaded!`;
        // The counter stance has no page of its own on this path in the two overlays:
        // the only `esmfight[0x0a]` "Counter! {1}!" page is `kind 5` inside the technique
        // machine FIGHTSTG_F0x8008ee84 (`pro/fightstg.s:12546`-`:12556`), which this miss
        // never reaches, so the miss prints no counter note at all (the old invented
        // "braces to counter!" sentence is gone).
        B.setResultPages(b, [
          { text, spec: B.techniqueSpec(b, skill) },
          { text, spec: B.evadeSpec(b, enemyName) },
        ]);
        B.recordFinaleTechnique(b, actionTechId);   // a miss still reaches the latch (wfightmn.s:4ae8 -> 4b5c -> 4b7c)
        B.renderer3d?.playerAttack(skill.id ?? b.player.profile.tech_basic, { miss: true });
      }
    } else if (action.type === "item") {
      const item  = action.item;
      const state = B.getState();
      const pname = b.player.profile.name;
      const enemyName = enemyMsgName(b.enemy);
      // Start the item-use motion through the item machine's own 3-D entries. The original's
      // FIGHTSTG_F0x8008d3b4 dispatches on the used item id: ids 77-90 take the 14-word jump
      // table at 0x80082ee4 — the typed THROW arms (clips 15/14/17, each with its own motion,
      // effect and sound writes; fightstg.s:131-144, arms at :10709-:11030) — and every other
      // id takes the default arm, which allocates an action actor and writes its clip
      // +0x54 = 10 plus the used item's record from the 0x800a336c table into +0x6c (effect)
      // and +0x70 (sound) (fightstg.s:11008-11030), so the acting Digimon plays action clip
      // 10 — its op2 tables 44/45, its op5 camera and its op3 effect spawn — with the item's
      // own effect sprite and contact sound. An item with no table record writes neither
      // field, exactly as the disc's scan falls through. The throw band's entry starts inside
      // the battle-effect arm below, because item 88's effect type is chosen by the STR/DEF
      // branch its own producer computes there. With no op1 in either script there is no
      // defender reaction, which is why the item does not go through `playerAttack`/the
      // coordinator.
      if (!isThrowItem(item.id)) B.renderer3d?.playPlayerItemUse(item.id);
      if (item.effect === "full_hp" && !isBattleEffectItem(item.id)) {
        const healed = b.player.maxHp - b.player.hp;
        b.player.hp = b.player.maxHp;
        // The generic charge handler 0x8008dc00 (items 43-65): at full HP it asks for
        // kind 1 with `esmfight[0x2f]` "No effect!" (fightstg.s:11234), otherwise kind 8
        // with `esmfight[0x22]` `{1}HP healed!` and the amount in slot 1 (:11258).
        const page = healed > 0 ? chargeHealPage(pname, healed) : chargeNoEffectPage();
        B.showItemPage(b, prefix, `Used ${item.name}! ${healed} HP restored!`, [page]);
      } else if (item.effect === "hp" && !isBattleEffectItem(item.id)) {
        const healed = Math.min(item.value, b.player.maxHp - b.player.hp);
        b.player.hp += healed;
        const page = healed > 0 ? chargeHealPage(pname, healed) : chargeNoEffectPage();
        B.showItemPage(b, prefix, `Used ${item.name}! ${healed} HP restored!`, [page]);
      } else if (item.effect === "mp" && !isBattleEffectItem(item.id)) {
        const restored = Math.min(item.value, b.player.maxMp - b.player.mp);
        b.player.mp += restored;
        // The disc has no MP-restore page of its own for a charge: the same 0x8008dc00
        // handler only ever builds the `{1}HP healed!` page, so this one keeps the
        // walker's sentence rather than borrow the HP wording.
        b.message = prefix + `Used ${item.name}! ${restored} MP restored!`;
      } else if (isBattleEffectItem(item.id) || item.effect === "battle") {
        // Battle-class items (66–90): the decoded FIGHTSTG jump-table dispatch.
        // Field state feeds the shared damage stage; TNTBall resolves virtual
        // Flame Ball while CrimsonCable uses its exact maxHP/5 producer.
        const r = useBattleItem(item.id, b.player, b.enemy, {
          userName: pname,
          enemyName,
          party: b.playerRecords,
          userIndex: b.activePlayerIndex ?? 0,
          effectGates: b.effectGates,
          specialMode: b.specialMode,
          setField: (element, power) => { b.field = { element, power }; },
          magicalHit: (power, element) => {
            const atk = effStats(b.player), def = effStats(b.enemy);
            return Math.max(1, resolveDamage(magicalBase(atk, def, power), atk, def,
              { power, element, base_acc: 128, crit_bonus: 0, magical: true }, RAND_U16, b.field));
          },
        });
        // The throw band's presentation (ids 77-90, FIGHTSTG_F0x8008d3b4's typed arms):
        // its own clip plus the arm's motion/effect/sound. Started here so item 88's
        // effect pair follows the STR/DEF branch the handler just took, and so item 84's
        // presentation reads the element roll the handler just made. When the extracted
        // table is not loaded yet the entry declines, so keep the default-arm clip-10 entry.
        if (isThrowItem(item.id) && !B.renderer3d?.playPlayerThrowItem(item.id, {
          branch: r.statBranch ?? null,
          elementIndex: r.elementIndex ?? null,
        })) {
          B.renderer3d?.playPlayerItemUse(item.id);
        }
        // Every handler in the band ends by asking the shared battle message box for its
        // own page(s); `r.pages` is that call verbatim (message id + kind + payload), so
        // the words on screen are the disc's own and not this file's sentences.
        B.showItemPage(b, prefix, `Used ${item.name}!`, r.pages);
        if (item.id === 76) persistPlayerGauge(b);
        if (!r.ok) {
          // "No effect!" / "Evade!" — the original still consumes the item (state-2 bag
          // decrement runs unconditionally), so fall through to consumption.
        }
      }
      // NO cue here. This used to play RECOVERY (0x00040014) on the strength of
      // a doc line that named the fightstg site at 0x80086d64 "the recovery
      // effect" — but that site's delay slot is `ori $a0, 0x5ec9` after
      // `lui $a0, 0xa004`, i.e. PLAYER11, not RECOVERY. The name was 2026-07-27
      // name-shift residue. RECOVERY's only literal call sites in the whole
      // corpus are in cardgame and ststatus (the save ceremony), and although it
      // is op10 table entry 7, no shipped action script emits type 7 — 245 model
      // packs plus dna_clip12 use 54 distinct types and 7 is not among them. So
      // the battle overlay never plays it, and an item heal getting a cue here
      // was invented. What the original plays for an item heal, if anything, is
      // an open question; see docs/research/audio/sound-system.md.
      // Consume from inventory through the shared store (F0x800161D8's remove arm).
      storeRemoveItem(state, item.id, 1);
      localStorage.setItem("inventory", JSON.stringify(state.inventory));
      b._nextState = ST.ENEMY_ACT;
    }
    b.pendingAction = null;
    return false;
  }
  return { applyPlayerAction };
}
