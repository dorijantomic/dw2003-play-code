import {
  scheduleNextActor,
  advanceAilmentTimeline,
  regenTickMessageSpec as engineRegenTickMessageSpec,
  poisonTickMessageSpec as enginePoisonTickMessageSpec,
  damageTermPage,
  resolveDamage,
  magicalBase,
  rollMagicHit,
  RAND_U16,
  multiHitReset,
  specialModeLowHpEscape,
  activeKoResolution,
} from "../../vendor/engine.js";
import { effectiveSpd } from "../plans.js";
import { enemyMsgName, hpPlateTick } from "../hud.js";
import { MSG_KIND, ST, MSG } from "../messages.js";
import { phaseFor, phaseRows, phaseEffects } from "../../boss-phase.js";
import { setFighterTint, clampFighterScale } from "../../battle3d.js";
import { effStats } from "../hit-results.js";
import { persistPlayerGauge } from "../form-blast.js";
import { releaseBattleLayer } from "../../battle-layer.js";
import type { BattleContext } from "../../types/battle.js";

import type { BattleState, BattleResultPage, BattleLineSpec, BattleHeal } from "../../types/battle.js";
import type { BattleSkill } from '../../types/battle.js';

// moved by tools/rewrite/split-closure.mjs
export function makeFlow(B: BattleContext) {
// ── Public API ──

  function isActive() { return B.battle !== null; }
// ── Update ──

  // True while an attack/reaction animation sequence is still playing (the action VM or the
  // defender's reaction VM is running). Used to gate turn transitions on the animation instead of
  // fixed timers, so the enemy doesn't start its own attack while the player's attack/recoil is
  // still on screen. Capped by the caller so a held motion can't stall the battle.
  function animBusy() {
    return !!(B.renderer3d && B.renderer3d.coordinator && B.renderer3d.coordinator.active);
  }
// playerSpd: the player speed the delay is read with when it is not the live active fighter's
  // (Tag: menu.c:312 asks getDelay at command time, before WFIGHTMN_tag swaps active[0]).
  function queueAfterAction(b: BattleState, acted: string, playerSpd?: any) {
    // A new turn on the shared timeline, so the command phase's Frozen gate rolls again
    // (F0x800a7418 step 1 runs once per player turn, `wfightmn.s:1494-1540`).
    b._turnSeq = (b._turnSeq ?? 0) + 1;
    const step = scheduleNextActor(b.timeline, acted, playerSpd ?? effectiveSpd(b.player), effectiveSpd(b.enemy));
    // THE STATUS-EVENT QUEUE IS THE BATTLE CLOCK. `FIGHTSTG_F0x8009ba4c`
    // (`pro/fightstg.s:25779`) has no frame tick: every action-resolution epilogue asks
    // `[0x800a437c](side, 0)` for the next delay and re-enqueues the turn event with it
    // (`pro/wfightmn.s:4090`-`:4098`), and the pool's own `+0x2` fields are what comes
    // off. So the walker's advance is the original's `delay(side, 0)` -- `trunc(1000 *
    // opp.SPD / isqrt(own.SPD * opp.SPD))` clamped to `[707, 1414]` -- and the expiries it
    // produces are the ones a player sees: a buff that wears off, a lock that releases.
    // The poison tick and the three cures are POOL EXPIRIES, so their box pages come out
    // of the advance below rather than out of a per-ailment countdown. The two slots the
    // advance writes are cleared FIRST, or the previous turn's would be re-read.
    b._poisonTick = null;
    b._ailmentCures = [];
    b._regenEvents = [];
    B.statusEventQueueAdvance(b, playerSpd);
    const events = advanceAilmentTimeline([b.player, b.enemy], step.elapsed)
      .concat(b._regenEvents);
    // Each status moment is a battle message box PAGE of its own, in the original: the
    // poison tick is one line object and one `+0xac` call with kind 15, and the shared
    // tail fills line one with the name.
    const pages = [];
    const poisonTotals = new Map();
    if (b._poisonTick) poisonTotals.set(b._poisonTick.combatant, b._poisonTick.amount);
    for (const cure of (b._ailmentCures ?? [])) {
      const targetName = cure.combatant === b.player
        ? b.player.profile.name
        : enemyMsgName(b.enemy);
      // The timed cure keeps the walker's own sentence: only Sleep's cure page is decoded
      // (FIGHTSTG_F0x80091534's twin at fightstg.s:14734, id 0x2b "Awake!", kind 7), and
      // the frozen/confuse/poison cure words have no writer anywhere in the two battle
      // overlays, so there is nothing to port here yet.
      pages.push({ text: `${targetName} recovered from ${cure.ailment}!`, spec: null });
    }
    for (const event of events) {
      const targetName = event.combatant === b.player
        ? b.player.profile.name
        : enemyMsgName(b.enemy);
      if (event.kind === "regen") {
        // The gradual-HP-recovery source is an actor machine beside the poison tick
        // (pro/wfightmn.s `.L0x00002480`): one line object, one `+0xac` call with
        // **kind 10** (wfightmn.s:2428), whose arm (`.L0x80099a28`, fightstg.s:23651)
        // is the name plus `esmfight[0x27]` and writes NO numbered slot — so the box
        // says "HP gradually recovers." and the amount is left to the HP plate.
        pages.push({
          text: `${targetName} recovers ${event.amount} HP.`,
          spec: engineRegenTickMessageSpec(targetName, event.amount),
        });
      }
    }
    for (const [combatant, amount] of poisonTotals) {
      const targetName = combatant === b.player
        ? b.player.profile.name
        : enemyMsgName(b.enemy);
      pages.unshift({
        text: `${targetName} is hurt by poison! ${amount} damage!`,
        spec: enginePoisonTickMessageSpec(targetName, amount),
      });
    }
    // The field timer ran out (code 7): the box prints esmfight[0x6A] (wfightmn.s:2477-2484).
    if (b._fieldCleared) {
      b._fieldCleared = false;
      pages.push({
        text: "The field returned to normal.",
        spec: { kind: MSG_KIND.ONE_LINE, payload: [0x6a] },
      });
    }
    // NEW content (F2 -> Extras -> "Boss phases", off by default): an authored fusion
    // boss takes its second wind. At its own HP lines (60% then 25% for Millenniummon,
    // web/boss-phase.js) it swaps its four AI rows for the phase's moves, sets the
    // battlefield element once, takes a phase tint and puts up one authored page. The
    // newest phase only: a hit that crosses two lines fires the last one, never both
    // pages; a fired phase never fires twice (the cursor lives on the enemy record).
    // With the switch off no phase is read and the fight is exactly today's.
    if (acted === "player" && typeof window !== "undefined" && window.__fx?.bossphases === true &&
        b.enemy?.bossId && b.enemy.hp > 0) {
      const phasePages = advanceBossPhase(b);
      if (phasePages.length) pages.push(...phasePages);
    }
    b._timelinePages = pages;
    b._timelineMessage = pages.map((page) => page.text).join("\n");
    b._nextState = step.next === "player" ? ST.PLAYER_MENU : ST.ENEMY_ACT;
  }
/**
   * NEW content (F2 -> Extras -> "Boss phases"): advance an authored fusion boss to the
   * newest HP phase it has reached, and return the one page that phase puts up.
   *
   * The phase data is the boss record's own `phases` (data/authored/fusion_bosses.json,
   * built into web/fusion_bosses.json): `at` is the share of max HP, `moves` are the
   * boss's own technique ids in action order, and `field`/`tint`/`music`/`page` are what
   * the phase changes. `web/boss-phase.js` owns the arithmetic; this function only writes
   * the battle: the four AI rows (row 3 unconditional, so the last move always has a
   * fallback), the battlefield element at the field items' power 64, the fighter tint,
   * the battle track, the body size and the page.
   *
   * The enemy record carries the cursor (`bossPhase`, -1 before the first line), so a
   * fired phase never fires again and a single hit that crosses two thresholds fires
   * only the newer one. Returns [] when no new phase is due.
   */
  function advanceBossPhase(b: BattleState) {
    const en = b?.enemy;
    const boss = en?.bossId ? B.fusionBossesDB?.[en.bossId] ?? null : null;
    const phases = boss?.phases;
    if (!en || !Array.isArray(phases) || !phases.length) return [];
    const index = phaseFor(en.maxHp, en.hp, phases);
    if (!(index > (en.bossPhase ?? -1))) return [];
    en.bossPhase = index;
    const phase = phases[index];
    en.eStats!.ai_moves = phaseRows(phase, boss.moves);
    const effects = phaseEffects(phase);
    if (effects.element) b.field = { element: effects.element, power: effects.power };
    if (effects.tint) setFighterTint("enemy", effects.tint);
    // NEW content (F2 -> Extras -> "A phase changes the battle music", off by default):
    // the phase may name one of the game's own battle banks (battle_music.json carries
    // them all; the builder refuses anything else). These are the finale's own two lines
    // (`noteFinalBossPhaseDamage`: `_battleTrack = "boss04"` then `bgm?.play`) reached at
    // the phase's HP line instead of the third landed blow. With the switch off no bank
    // is read here and the screen's own track keeps playing.
    if (effects.music && window.__fx?.bossmusic === true) {
      b._battleTrack = effects.music;
      B.bgm?.play(b._battleTrack);
    }
    // NEW content (F2 -> Extras -> "The boss grows", off by default): the phase can change
    // the boss's SIZE, not only its moves, tint and field. The body takes the phase's own
    // multiplier (Millenniummon grows to 1.6 at 60% — web/battle3d.js GIANT_FIT_K, where
    // the camera opens its giant fit) and the party entry keeps it, so a later KO/gauntlet
    // reapply (applyGiantScales reads `entry.size`) draws the boss grown again. The
    // renderer call is optional: a headless battle has none.
    if (effects.size && window.__fx?.bossgrows === true) {
      B.renderer3d?.setFighterScale?.("enemy", clampFighterScale(effects.size));
      if (b.party?.[b.partyIndex]) b.party[b.partyIndex]!.size = clampFighterScale(effects.size);
    }
    return effects.page ? [{ text: effects.page, spec: null }] : [];
  }
/**
   * The battle message box's own page sequence: each entry is one line the player reads
   * and presses Circle on, in order, exactly as FIGHTSTG_F0x80091534's "apply what
   * landed" machine walks its effect slots (`fightstg.s:15262-15283` — one page per pass,
   * and a pass whose line slot is still occupied returns without building the next one).
   *
   * An entry is either the walker's own sentence, or `{ text, spec }` when the disc has
   * its own two lines for that page. `spec` (the third argument) is the shorthand for
   * "the first page's spec", for the callers that have one page and one arm.
   */
  function setResultPages(b: BattleState, pages: Array<BattleResultPage | string | null>, spec?: any) {
    const list = (pages || []).filter(Boolean).map((page) => (
      page && typeof page === "object"
        ? { text: String(page.text ?? ""), spec: page.spec ?? null }
        : { text: String(page), spec: null }
    ));
    b._resultPages = list.map((page) => page.text);
    b._resultPageSpecs = list.map((page) => page.spec);
    b._resultPageIndex = 0;
    b._resultReady = false;
    if (list.length) {
      const first = list[0]!.spec ?? spec ?? null;
      if (first) B.sayOriginal(b, first, list[0]!.text);
      else B.sayWalker(b, list[0]!.text);
    }
  }
/**
   * Put up the page(s) an item's handler asked for.
   *
   * One page keeps the ordinary result line the item path has always used (it times out
   * on the walker's own 1 s beat, because the item's own line was never a Circle-gated
   * page). Two pages — the only handler in the band that makes two is ChaosWave's
   * rand&3 follow-up, where the second page names the player's own Digimon — go through
   * `setResultPages`, so the player presses Circle between them the way the original's
   * two line objects do (each handler returns while its line slot is occupied,
   * `lw $v0, ($s3); bnez $v0, ...` throughout 0x8008dcd8-0x8008ede8).
   *
   * `walker` is what `peek()` still sees; it is the old sentence
   * and it is never what the original's own panel draws.
   */
  function showItemPage(b: BattleState, prefix: string, walker: string, pages: BattleLineSpec[]) {
    const list = (pages || []).filter(Boolean).map((page) => ({
      text: page.name
        ? `${page.name} ${page.slots?.length ? `${page.slots[0]} ` : ""}`.trim()
        : "",
      spec: page.name
        ? { kind: page.kind, payload: page.payload, name: page.name, slots: page.slots ?? [] }
        : null,
    }));
    const text = prefix + walker;
    if (list.length <= 1) {
      const only = list[0];
      if (only?.spec) B.sayOriginal(b, only.spec, text);
      else B.sayWalker(b, text);
      return;
    }
    setResultPages(b, list.map((page) => ({ text: text, spec: page.spec })));
  }
/**
   * "<n> damage!" on the line, the way the original puts it up, decided by the RECORD
   * MACHINE rather than by the walker.
   *
   * The original's own chooser is `FIGHTSTG_F0x8008f714`, the machine that walks the
   * 18-byte technique records at `0x80042bca`. It dispatches on the record's category
   * byte (record +0x04) through the five-word table at `.L0x80083004` and, for the two
   * attack categories that cover 402 of the 443 techniques, it picks the page from the
   * action context: the hit flag `ctx+0x30` chooses `kind 4` `"{1} damage!"`, and its
   * clear chooses `kind 2` with `esmfight[0x1d]` "Evade!" (`pro/fightstg.s:13108`,
   * `:13121`, `:13172`). `engine/dw3/battle-damage-terms.ts` is the port of that chooser
   * and `damageTermPage()` is its entry point; this function only hands it the record
   * and the context.
   *
   * **The multi-attack tally is not one of the walker's reasons any more.** A technique
   * that hits `hits` times still produces ONE `kind 4` page carrying the total: the
   * original's arm writes no hit count anywhere, so there was never a " (3 hits)"
   * fragment for the walker to keep, and the `hits` term used to force this function to
   * return null and let a typed sentence into the box.
   *
   * Returns null only when the walker has words the original's line does not (a counter
   * reaction, a timeline prefix) — the original prints those as pages of their own, so
   * the box keeps the walker's own sentence rather than silently dropping them.
   *
   * A category-4 record is a HEAL or a CURE, not a hit, so its context is the heal the
   * walker actually applied: the amount and the target's missing HP (the pair the original
   * compares at `pro/fightstg.s:13572`-`:13577`, which caps the amount at the missing HP),
   * and the page names the healer, not the target.
   *
   * @param {string} name the Digimon that took the damage
   * @param {number} total the damage the box reports
   * @param {string} extra walker's own words that have no page in the original
   * @param {number} [techniqueId] the technique's id, for the record lookup
   * @param {number} [side] 0 the player's partner attacking, 1 the enemy
   * @param {{heal?: number, missingHp?: number, healer?: string}} [heal] the heal context,
   *   read only when the record's category is 4
   */
  function damageSpec(name: string, total: number, extra?: string, techniqueId: number = 0, side: number = 1, heal: BattleHeal | null = null) {
    if (extra) return null;
    const record = B.fightTechDB?.[String(techniqueId | 0)] ?? null;
    const isHeal = record?.category === 4;
    const page = damageTermPage(record, {
      techniqueId: techniqueId | 0,
      side,
      name: isHeal ? (heal?.healer ?? name) : name,
      damage: isHeal ? (heal?.heal ?? 0) : total,
      hitCount: 1,
      landed: isHeal ? (heal?.heal ?? 0) > 0 : true,
      applied: false,
      retaliated: false,
      suppressed: false,
    }, isHeal ? { missingHp: heal?.missingHp ?? 0 } : {});
    if (page) return { kind: page.kind, payload: page.payload, name: page.name, slots: page.slots };
    // No record on the disc for this id, or a category `sltiu $v0, $v1, 0x5` rejects:
    // the original's own fall-through (`:13115 beqz $v0, .L0x80090c1c`) builds no page,
    // so keep the walker's own `kind 4` line rather than inventing a category.
    return { kind: MSG_KIND.DAMAGE, payload: [0, total], name, slots: [String(total)] };
  }
function elementNameForElem1(elem1: number) {
    if (!B.elem1NameCache) {
      B.elem1NameCache = {};
      for (const id of Object.keys(B.skillDB || {})) {
        const rec = B.fightTechDB?.[String(id)];
        const name = B.skillDB[id]?.element;
        if (rec && name) B.elem1NameCache[rec.elem1 | 0] = name;
      }
    }
    return B.elem1NameCache[elem1 | 0] ?? "normal";
  }
/**
   * The magical damage leaf F0x8009fab4 (`[0x800a4580+0x88]`) for ONE hit slot's own
   * technique record: the browser's own port (`magicalBase` + `resolveDamage`) on the
   * disc's record for `slotTechId`.
   */
  function slotDamage(slotTechId: number, atk, def, rng: () => number | undefined, field: number) {
    const rec = B.fightTechDB?.[String(slotTechId | 0)];
    if (!rec) return 0;
    const sk = {
      id: slotTechId | 0,
      power: rec.power,
      element: elementNameForElem1(rec.elem1),
      attack_category: rec.category === 3 ? "magical" : "physical",
      // `resolveDamage` reads `magical` directly (buildAttack sets it from the category
      // before it reaches the leaves), and its accuracy default is the record's own 128.
      magical: rec.category === 3,
      base_acc: 128,
      target_family: rec.elem2,
      damage_scalar: rec.scalar,
      clip: rec.clip,
    };
    return Math.max(0, resolveDamage(magicalBase(atk, def, sk.power), atk, def, sk, rng, field) | 0);
  }
/**
   * FIGHTSTG_F0x8009ddd8 — the move resolver FIGHTSTG_F0x8009e0cc's dispatch-byte-0x1f
   * arm, wired. The resolver writes the acting side to the action context +0x20 and the
   * technique id to +0x24 and, when the record's dispatch byte (`record +0x0a`) is 0x1f,
   * calls this reset INSTEAD of the path that carries one damage value. The reset seeds
   * two hit slots: for each it asks the magical ACCURACY leaf `[0x800a4580+0xa0]`
   * (F0x800a08c8) whether the slot lands, and for each landed slot calls the magical
   * DAMAGE leaf `[0x800a4580+0x88]` (F0x8009fab4) on the SLOT's own technique id
   * (0x1b9/0x1ba = 441/442, the last two of the 443 rows at 0x80042bca), storing the two
   * damages at ctx+0x60/ctx+0x64. The record machine applies their SUM
   * (`pro/fightstg.s:13154`-`:13158 lw $v0,0x60 / lw $v1,0x64 / addu / sw $v0,0x58`) and
   * prints ONE kind-4 damage page — there is no "\u00d7 hits" fragment on this arm.
   *
   * The two manager entries ARE the browser's own ports (the previous pass called +0x88 a
   * "message producer"; docs/research/battle/battle-formula-leaves.md settles it as the
   * magical damage leaf). The slot records come from the shipped `fight_tech_table.json`.
   */
  function resolveRepeatDispatch(attacker: BattleState, defender: BattleState, skill: BattleSkill | undefined, sideByte: number, field: number) {
    const atk = effStats(attacker), def = effStats(defender);
    const damages = [0, 0];
    const slotViews = [0, 1].map((i) => ({
      setFlag: () => {},
      setCaption: (v: number) => { damages[i] = v | 0; },
    }));
    const manager = {
      // The manager's predicate is the MAGICAL accuracy leaf (+0xa0), read
      // unconditionally by F0x8009ddd8 (:28224 `lw $v0, 0xa0($s3)`) — not the
      // physical +0x9c entry.
      predicate: () => (rollMagicHit(atk, def, skill, RAND_U16) ? 1 : 0),
      produce: (_side, slotTechId: number) => slotDamage(slotTechId, atk, def, RAND_U16, field),
    };
    const state = { count: 0, total: 0, done: 0 };
    multiHitReset(slotViews, { side: () => sideByte, id: () => skill?.id ?? 0 }, manager, state);
    return { landed: state.count | 0, total: (damages[0]! | 0) + (damages[1]! | 0), damageBySlot: damages };
  }
// Continue after the current action's result text has either timed out (ordinary results) or
  // been confirmed (the explicit impact/defeat sequence).
  function advanceAfterResult(b: BattleState) {
    // The finale's scripted beats chain through here: once a beat's pages have been
    // read, the next beat runs (the kind advance, the body's cannon, the head swap).
    // Set only while the sequence is in flight, and cleared before it runs so a beat
    // that puts up no page cannot re-enter itself.
    if (b._finaleAfter) { const run = b._finaleAfter; b._finaleAfter = null; run(); b.timer = 0; return; }
    // The enemy's own tag (enemy_turn.c substates 5, 6, 4, 3): the 0x4D page is read -> the side 0x10 entrance
    // runs -> its name page is read -> the turn ends (its status events are queued now, for the new enemy).
    if (b._selfTag) {
      const tag = b._selfTag;
      if (tag.stage === "taking") { tag.stage = "entering"; B.startEnemySelfTag(b, tag); b.timer = 0; return; }
      if (tag.stage === "named") { b._selfTag = null; queueAfterAction(b, "enemy"); }
    }
    // EVENT_DIGIDEVOLVE (tech 0x187) was pushed FIRST, delay 1 (battle.c:143-149): it is popped before the turn's
    // status events and the Blast events (menu.c:1355 pop after the turn task is gone), and the turn's own delay is
    // already queued (the caller ran queueAfterAction before this).
    if (b._dedigivolvePending) { b._dedigivolvePending = false; B.forcedDedigivolve(b); b.timer = 0; return; }
    if (b._forcedFlee) {
      b._forcedFlee = false;
      b.state = ST.RESULT_MSG;
      b._nextState = ST.NONE;
      b.message = "Running away!";
      b.timer = 0;
      const cb = b.onFlee;
      setTimeout(() => {
        if (B.battle === b) {
          persistPlayerGauge(b);
          if (B.bgm && b._fieldTrack !== undefined) B.bgm.play(b._fieldTrack);
          releaseBattleLayer();
          B.battle = null; cb?.();
        }
      }, 1400);
      return;
    }
    // ^ forced flee: Zanbamon's Cross Slash (result-queue slot 35, fightstg F0x80091a8c) puts
    // up esmfight[0x48] "Running away!" and commits the result to 0 (flee) — the disc's only
    // route that avoids the loss.
    if (b._enemyFled) { B.endBattle("enemy-fled"); return; }
    // A successful player Run ends the battle outside endBattle (the field callback owns the
    // exit), and only once its two pages have been read (setResultPages below).
    if (b._runAwayEnd) { const run = b._runAwayEnd; b._runAwayEnd = null; run(); return; }
    // The mode-1 low-HP escape (fightstg F0x80088564 `.L0x800885bc`, esmfight[0x5f]
    // "Fleeing!") is the mode-1 boss ending: mode 1 + the enemy's HP below maxHP/10 (which
    // the maxHP/11 floor guarantees) closes the fight back to the field with no rewards.
    if (!b._mode1EscapeShown && specialModeLowHpEscape(b.specialMode ?? 0, b.enemy.hp, b.enemy.maxHp)) {
      b._mode1EscapeShown = true;
      b.state = ST.RESULT_MSG;
      b._nextState = ST.NONE;
      const escName = enemyMsgName(b.enemy);
      B.sayOriginal(b, { kind: MSG_KIND.OUTCOME, payload: [MSG.FLEEING], name: escName }, "Fleeing!");
      b.timer = 0;
      setTimeout(() => { if (B.battle === b) B.endBattle("enemy-fled"); }, 1400);
      return;
    }
    if (b._timelinePages?.length) {
      // The turn's status pages. One page the player reads, then the next, the way the
      // original's status-event machines each build one line object and wait for it
      // (pro/wfightmn.s `.L0x000028ac`-`:0000294c`, `fightstg.s` `.L0x80091b04`-`:80091b24`).
      const pages = b._timelinePages;
      b._timelinePages = null;
      b._timelineMessage = "";
      if (pages.length === 1) {
        const page = pages[0];
        if (page.spec) B.sayOriginal(b, page.spec, page.text);
        else B.sayWalker(b, page.text);
        b.timer = 0;
        return;
      }
      setResultPages(b, pages);
      b.timer = 0;
      return;
    }
    if (b._timelineMessage) {
      b.message = b._timelineMessage;
      b._timelineMessage = "";
      b.timer = 0;
      return;
    }
    if (b.enemy.hp <= 0) { B.defeatCurrentEnemy(); return; }
    if (b.player.hp <= 0) {
      const liveRoster = b.playerRecords.map((record) => ({ stats: { hp: record.hp } }));
      const replacement = activeKoResolution(liveRoster, b.activePlayerIndex);
      if (replacement.outcome === "defeat") {
        B.enterLossState(b);
      } else {
        // A fallen active Digimon does not end the battle while another resident
        // party record is alive. Reuse the normal Tag and form screens, but make
        // the replacement mandatory and preserve the already-scheduled next turn.
        // The row the list opens on is NOT reset: the original's list carries the
        // row it confirmed last into the next one it opens (fightstg.s:21312
        // writes it, :21258-21260 seeds from it), so a party knocked out one at a
        // time reopens on the row the player last took rather than on the first.
        b._forcedTag = true;
        b.tagTargetIndex = null;
        b.message = "Choose the next Digimon.";
        b.state = ST.PLAYER_TAG;
      }
      b.timer = 0;
      return;
    }
    if (b._blastPending) { b._blastPending = false; B.triggerBlast(b); b.timer = 0; return; }
    if (b._blastRevertPending) { b._blastRevertPending = false; B.revertBlast(b); b.timer = 0; return; }
    const nextState = b._nextState ?? ST.PLAYER_MENU;
    b.state = nextState;
    b.menuSel = 0;
    b.timer = 0;
  }
/**
   * Feed the translated message line (engine/dw3/ui/battle-message-session.ts) the
   * display tick and the pad word, and open a new line whenever the battle's own
   * timeline puts one up. FIGHTSTG_F0x80098c9c + F0x80098a84 reveal one whole line per
   * BATTLE_MESSAGE_LINE_DELAY_TICKS and closes on Circle with no timeout.
   *
   * The panel goes when the line is read: the Circle press sets state 3
   * (`.L0x80098c00`-`.L0x80098c08`), F0x80098c9c draws nothing in states 2 and 3
   * (`.L0x80098ccc` -> `.L0x80098d00`), and the child runner F0x80018140 tears the
   * finished object and its two line elements down (`exe/fns.s` `.L0x800181c0` ->
   * `.L0x80018204`). The prompt is gated on `self+0x98` (`.L0x80098954`).
   */
  /**
   * One displayed frame is one vertical blank of the original
   * (engine/dw3/ui/pad-words.ts MenuDisplayClock), and the delta each blank published
   * is the word every translated screen reads. The battle's message line has always
   * driven that clock; the loss sequence reads the same published deltas
   * (F0x8008c93c counts `[0x8004DF9C]()`), so it is stepped once per displayed frame
   * here instead of once per browser frame -- at 60 Hz one browser frame in six is too
   * short to be a field, and a loss beat counted on browser frames would run at the
   * display's speed rather than the original's. With the panel rolled back
   */
  function advanceDisplayFrames(dt: number) {
    return B.msgClock.advance(dt);
  }
function tickHudEase(dt: number) {
    const b = B.battle;
    b._hudClock = (b._hudClock || 0) + dt;
    B.tickBattleMessage(b, dt);
    // The plate's mode-1 arm (FIGHTSTG_F0x80093a74 .L0x80093c6c), once per DISPLAYED
    // frame with that frame's published delta -- the same list the message line and
    // the loss sequence are stepped with, because a displayed frame is a vertical
    // blank of the original and the plate is one of that frame's own ticks. The poll
    // inside it (F0x80093108) is why a hit is noticed every eighth frame, not the
    // frame it lands.
    const plate = B.hpPlateOf(b);
    for (const frame of (b._displayFrames ?? [])) {
      hpPlateTick(plate, B.hpPlateMembers(b), frame.delta);
    }
  }
  return { isActive, animBusy, queueAfterAction, advanceBossPhase, setResultPages, showItemPage, damageSpec, elementNameForElem1, slotDamage, resolveRepeatDispatch, advanceAfterResult, advanceDisplayFrames, tickHudEase };
}
