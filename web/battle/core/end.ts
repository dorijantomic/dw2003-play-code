import { rollFusionDrops } from "../../fusion-loot.js";
import {
  RAND_U16,
  battleWinLaunchCode,
  battleWinJinglePlays,
  initialActorTimeline,
  storeAddItem,
  MONEY_CAP,
  techniqueMpCost,
  battleFormIds,
  basicAttackHitCount,
  enemyActionSkillId,
  storeRemoveItem,
  stealProc,
} from "../../vendor/engine.js";
import { fusionOnDefeat, fusionEnabled } from "../../fusion.js";
import { firstAliveEnemySlot, enemyTeamSlots } from "../../enemy-switch.js";
import {
  gauntletNext,
  battleKindOf,
  applyGiantScales,
  giantModeOn,
  battleOutcomeRelease,
  syncPlayerRoster,
  setLiveBattleForm,
  equippedTriple,
  writeBackBattleVitals,
  blastTargetProfile,
} from "../form-blast.js";
import { rollBattleDrop } from "../../tech-record.js";
import { ST, MSG_KIND } from "../messages.js";
import { enemyMsgName, enemyStatRecordFor } from "../hud.js";
import { effectiveSpd } from "../plans.js";
import { releaseBattleLayer } from "../../battle-layer.js";
import { itemForDropName } from "../../drop-item.js";
import {
  paidParticipants,
  dvLevelForExp,
  winBattleRewards,
  levelUpGrowthProfile,
  levelForExp,
  applyLevelUp,
} from "../progress.js";
import { emit as emitGameEvent } from "../../gameEvents.js";
import { battleTechWords } from "../layout.js";
import { resolveMultiHit, resolveAttack, effStats } from "../hit-results.js";
import { CHARID_TO_DIGID } from "../../party.js";
import { buildFightReportRows } from "../report.js";
import { battleMsgText } from "../../battlemsg-translated.js";

// moved by tools/rewrite/split-closure.mjs
export function makeEnd(B) {
function endBattle(result) {
    const b = B.battle;
    const state = B.getState();
    battleOutcomeRelease(b, result);
    syncPlayerRoster(b);
    B.commandNative.close(); // the command list never outlives the battle
    B.techNative.close();     // neither does the TECH list
    B.formNative.close();     // nor the Digivolve form list
    B.wfightNative.close();  // nor does the boot pipeline

    // Restore the field track the battle music replaced.
    if (B.bgm && b._fieldTrack !== undefined) B.bgm.play(b._fieldTrack);

    // Teardown 3D renderer
    if (B.renderer3d) { B.renderer3d.setSlowMotion?.(0); B.renderer3d.destroy(); B.renderer3d = null; }
    releaseBattleLayer();
    B.offscreen3d = null;
    B.exitBattleFullscreen();

    if (result === "win") {
      const activeReward = b._winReward ?? B.winRewards(b);
      const bits = activeReward.bits ?? 0;

      // The native results screen (stfgtrep) already paid the BIT and the
      // dropped item when the route is on; do not pay them a second time.
      // Gauntlets can bank several drops, so only the one the screen paid is
      // excluded and the rest still land here.
      const paidByReport = b._reportNative === true;
      const paidItemId = paidByReport ? (b._reportPaidItemId ?? 0) : 0;
      let drops = b._loot.drops;
      if (paidItemId > 0) {
        const firstIdx = drops.findIndex((name) => name && itemForDropName(name));
        if (firstIdx >= 0) drops = drops.filter((_, i) => i !== firstIdx);
      }
      let applied = false;
      for (const name of drops) {
        const item = itemForDropName(name);
        if (!item) continue;
        // The store's add arm clamps at 99, as the original's does (F0x800161D8):
        // a loot stack already at the cap takes the drop and stays at 99.
        storeAddItem(state, item.id, 1);
        applied = true;
      }
      if (applied) localStorage.setItem("inventory", JSON.stringify(state.inventory));
      const droppedItem = b._winReward?.droppedItem ?? null;
      // F0x800a69f0 marks the lead at setup and every Digimon that Tags in.
      // stfgtrep pays each marked roster position: 100% solo, 60% each for
      // two participants, or one third each for three. Applied once when the
      // report pages are built so the numbers on screen match the write-back.
      // A position the outcome knocked out is not in that set (paidParticipants:
      // pro/wfightmn.s .L0x00002070 clears its flag before the report counts).
      const progress = b._winApplied
        ? (b._winProgress ?? [])
        : paidParticipants(b).map((index) => ({ index, ...B.applyParticipantProgress(b, index) }));
      const activeProgress = progress.find((entry) => entry.index === (b.activePlayerIndex ?? 0))
        ?? progress[0] ?? { xp: 0, newLevel: b.player.level, levelUp: false, availableEvos: [] };
      // The money ceiling is 9,999,999 and the original clamps on the way up
      // (SCREEN-OBJECT-NAME-AUDIT-001; docs/generated/bounds.md:69). The shop
      // path already clamped; the battle reward did not.
      if (!paidByReport) state.bits = Math.min((state.bits ?? 0) + bits, MONEY_CAP);
      localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
      localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
      localStorage.setItem("bits", String(state.bits));
      B.battle = null;
      // optional layers (extra quests) hear every win; no listener means nothing happens
      emitGameEvent("battleWon", { enemies: (b.party ?? []).map((e) => e?.enemyId).filter((n) => typeof n === "string"), mapId: b.mapId ?? null, screenId: b.screenId ?? null });
      b.onWin?.({ xp: activeProgress.xp, bits, levelUp: activeProgress.levelUp,
        newLevel: activeProgress.newLevel, droppedItem,
        availableEvos: activeProgress.availableEvos, participantProgress: progress });
    } else if (result === "enemy-fled") {
      localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
      localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
      B.battle = null;
      b.onWin?.({ xp: 0, bits: 0, levelUp: false, droppedItem: null, availableEvos: [], enemyFled: true });
    } else if (result === "lose") {
      // The loss exit writes nothing. `F0x800a7328` — the call at
      // pro/wfightmn.s .L0x00002174, on every exit arm before the result byte is
      // even read — clears three RAM words and nothing else: the group's reserved
      // form byte at `0x800a4470 + group*0x20` + 0x1A, the halfword at
      // `0x80042b1c + group*0x40` + 0x58, and the halfword at `0x800a3868 + i*0x1C`
      // on each of the two participating Digimon records. No memory-card record, no
      // money, no story flag, and no HP: the fade to black has already covered the
      // screen by the time this runs, and the only thing left is the launch the
      // caller does. (It also means the fainted member's writeBackBattleVitals
      // "1 HP" floor never reaches the card — the walker's stored party is what it
      // was, exactly as on the disc.)
      B.battle = null;
      b.onLose?.();
    }
  }
// EXPERIMENT (multiplayer many-vs-many, web/mpbattle.js): the pieces of this engine that a separate N-vs-M screen needs, so
  // its numbers are the game's own: the same enemy and player records, the same damage / accuracy / critical rolls, the same
  // technique lists and prices, the same EXP and BIT payout. A normal one-on-one fight never calls any of this.
  function mpKitTechs(rec, blastOn = false) {
    const partner = rec.statsRecord;
    partner.formLedger ??= Object.entries(partner.dvexpByForm ?? {}).map(([id, dvexp]) => ({
      id: Number(id), formLevel: dvLevelForExp(Number(dvexp) || 0, B.digimonDB?.[id]?.dv_cap ?? 100), dvexp: Number(dvexp) || 0, techSlots: [],
    }));
    const sig = rec.profile.tech_signature ?? rec.profile.techs?.[1] ?? 0;
    const words = battleTechWords({
      ledger: partner.formLedger, currentId: rec.profile.id, equippedForms: partner.equippedForms,
      signatureTech: sig, blastSignature: blastOn ? sig : 0,
    });
    return words.map((w) => {
      const s = B.skillDB[Number(w) & 0x1fff];
      if (!s) return null;
      const skill = { ...s, techWord: Number(w) & 0xffff };
      return { id: s.id, name: s.name, type: s.type, tw: skill.techWord, magical: s.attack_category === "magical", power: s.power | 0, skill,
        cost: techniqueMpCost(s.mp_cost ?? 20, skill.techWord, { mpCostDown: rec.mpCostDown ?? 0 }) };
    }).filter(Boolean);
  }
async function mpKit() {
    await B.loadData();
    const state = B.getState();
    const persist = () => {
      localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
      if (state.partyStats) localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
      localStorage.setItem("bits", String(state.bits | 0));
    };
    const basic = (rec) => {
      const s = B.skillDB[rec?.profile?.tech_basic];
      return s ? { ...s, basic_attack: true } : null;
    };
    return {
      enemyRecord: (e, screenId = null) => {
        const rec = B.buildEnemyRecord({
          enemyId: (typeof e.name === "string" && !B.enemiesDB?.[e.name] && Number.isFinite(e.digimonId)) ? e.digimonId : e.name,
          enemyLevel: e.level, enemyHp: e.hp, enemyMp: e.mp, enemyStatScale: e.stat_scale ?? 16,
        });
        if (rec) {   // the screen's own record says which ailments this fight's enemies cannot catch
          const gates = B.fieldEncDB?.battle_config?.[String(screenId)]?.effect_gates ?? {};
          rec.statusImmunities = Object.fromEntries(["poison", "frozen", "confuse", "sleep", "ko"].map((k) => [k, !!gates[k]]));
        }
        return rec;
      },
      /** My lead Digimon as a fighter (null when I have none). */
      myRecord: () => {
        const roster = B.buildPlayerRoster(state), prof = B.getPlayerProfile(state);
        return roster.length && prof ? B.buildPlayerRecord(roster[0], prof.id) : null;
      },
      basic,
      /** The forms this Digimon could digivolve to right now (the one-on-one battle's Digivolve list): [{ id, name }]. */
      forms: (rec) => battleFormIds(Number(rec?.profile?.id), rec?.statsRecord ?? {})
        .map((id) => B.digimonDB[id]).filter((p) => p && p.id !== rec?.profile?.id).map((p) => ({ id: p.id, name: p.name })),
      /** A manual digivolve: the record takes the form; the numbers it fights with are re-derived from it, as in the game. */
      digivolve: (rec, id) => { const p = B.digimonDB[id]; if (!p) return false; setLiveBattleForm(rec, p); return true; },
      /** A plain-data copy of a fighter record, to hand to the referee. */
      pack: (rec) => JSON.parse(JSON.stringify(rec)),
      /** My techniques: [{ id, name, cost, tw, type, magical, power, skill }]. type is "attack", "heal" or "support". */
      myTechs: (rec, blastOn = false) => mpKitTechs(rec, blastOn),
      /** One attack, rolled by the game's own resolver. Returns { hit, dmg, landed, attempts }. */
      attack: (att, def, skill) => {
        const n = basicAttackHitCount(att.multiAttack, skill);
        const r = n > 1 ? resolveMultiHit(att, def, skill, n, RAND_U16, null) : resolveAttack(att, def, skill, RAND_U16, null);
        return { hit: !!r.hit, dmg: r.dmg | 0, landed: r.landed ?? (r.hit ? 1 : 0), attempts: n, crit: !!r.crit, eff: r.eff ?? 1 };
      },
      skillOf: (id) => B.skillDB[id] ?? null,
      /** What an enemy can do: its basic attack, and its two moves when they are attack techniques. */
      foeMoves: (en) => {
        const out = [];
        const b0 = en.fightSkill ? { ...en.fightSkill, basic_attack: true } : null;
        if (b0) out.push({ skill: b0, cost: 0, tech: false });
        for (const action of [2, 3]) {
          const s = B.skillDB[enemyActionSkillId(action, en.eStats ?? {})];
          if (s && s.type === "attack") out.push({ skill: s, cost: techniqueMpCost(s.mp_cost ?? 0, 0, { enemySide: true }), tech: true });
        }
        return out;
      },
      /** The disc's payout for winning this fight, applied to my lead: EXP (with level ups) and BIT. */
      applyWin: ({ screenId, participants }) => {
        const ps = state.partnerStats, prof = B.getPlayerProfile(state);
        if (!ps || !prof) return null;
        const reward = winBattleRewards({
          screenId, participants: Math.max(1, participants | 0), equipment: state.equipment?.[0] ?? {}, rewards: B.progressionDB?.battle_rewards,
        });
        const lu = B.progressionDB?.level_up;
        const oldLevel = ps.level ?? 1, newXp = Math.min((ps.xp ?? 0) + reward.xp, lu?.exp_cap ?? 999999);
        // The disc's curve and rolls read the STARTER's row (0x8003EF5C + slot*0x58), never the worn form's.
        const growthProfile = levelUpGrowthProfile({ rookieId: CHARID_TO_DIGID[state.party?.[0]], profile: prof }, B.digimonDB) ?? prof;
        const newLevel = lu ? levelForExp(oldLevel, newXp, growthProfile.growth_xp ?? 8, lu) : oldLevel;
        if (newLevel > oldLevel) applyLevelUp(ps, prof, oldLevel, newLevel, lu, growthProfile);
        ps.xp = newXp;
        state.bits = Math.min((state.bits | 0) + reward.bits, 9999999);
        persist();
        return { xp: reward.xp, bits: reward.bits, from: oldLevel, to: Math.max(oldLevel, newLevel) };
      },
      /**
       * The payout for a won fight, the game's way: every Digimon that fought and still stands is paid by the disc's rules
       * (share, level-ups, DV EXP, learned techniques), exactly as a one-on-one win does. Returns the object the post-battle screen
       * opens from (the BIT and drop are paid by that screen) and the lead's summary line.
       */
      winReport: ({ screenId, party, took }) => {
        const recs = party.map((m) => m.rec);
        const b = {
          screenId, playerRoster: party.map((m) => m.member), playerRecords: recs, participantIndices: new Set(took),
          activePlayerIndex: took[0] ?? 0, formFlags: [], _loot: { drops: [] }, player: recs[0], enemy: null,
        };
        for (const i of took) {
          const flags = (b.formFlags[i] = new Array(10).fill(0));
          const triple = equippedTriple(recs[i].statsRecord?.equippedForms);
          triple.forEach((id, k) => { if (id === Number(recs[i].profile?.id)) flags[7 + k] = 1; });
        }
        const progress = paidParticipants(b).map((index) => ({ index, ...B.applyParticipantProgress(b, index) }));
        if (!progress.length) return null;
        const rewards = B.winRewards(b, progress[0].index);
        b._winProgress = progress; b._winApplied = true;
        b._winReward = { xp: rewards.xp, bits: rewards.bits, dvexp: rewards.dvexp, droppedItem: null, levelUp: progress[0].levelUp };
        b._winReportRows = buildFightReportRows(b.playerRoster, b.playerRecords, B.digimonDB);
        const lead = progress[0];
        return { b, save: persist, reward: { xp: rewards.xp, bits: rewards.bits, from: lead.oldLevel, to: Math.max(lead.oldLevel, lead.newLevel) } };
      },
      /** The data tables the rules read: technique rows, the decoded technique records, and the item menu. */
      skillDB: () => B.skillDB,
      techRecord: (id) => B.fightTechDB?.[String(id | 0)] ?? null,
      items: () => B.usableItems(),
      /** The disc's battle track for this fight (the name `bgm.play` takes). */
      musicFor: (screenId, mapId) => B.musicForScreen(screenId, mapId),
      /** Use an item from my bag: take it out through the shared store, as the one-on-one battle does. */
      spendItem: (id) => { storeRemoveItem(state, id, 1); localStorage.setItem("inventory", JSON.stringify(state.inventory)); },
      /** Leave my Digimon as the fight left it (the field's own write-back: KO -> 1 HP). */
      commit: (rec) => { writeBackBattleVitals(rec); persist(); },
      /** My whole party, lead first: [{ member, rec }] (member = the roster entry the game's screens read). */
      party: () => {
        const roster = B.buildPlayerRoster(state), prof = B.getPlayerProfile(state);
        return roster.map((member, i) => ({ member, rec: B.buildPlayerRecord(member, i === 0 && prof ? prof.id : null) }));
      },
      /** The profile Blast would turn this Digimon into at its level, or null. */
      blastForm: (rec) => blastTargetProfile(rec, B.digimonDB),
      /** The form (by its name) the record takes, as the game's own Digivolve / Tag / Blast commits do. */
      setFormByName: (rec, name) => {
        const p = Object.values(B.digimonDB ?? {}).find((x) => x?.name === name);
        if (!p) return false;
        setLiveBattleForm(rec, p); return true;
      },
      profileByName: (name) => Object.values(B.digimonDB ?? {}).find((x) => x?.name === name) ?? null,
      /** The disc's steal roll for a landed steal technique: { ok, item, name } | { ok:false, nothing } (no draw: it missed). */
      stealRoll: (skill, thief, enemy) => {
        if (skill?.effect !== "steal" || enemy.hp <= 0) return null;
        const record = enemyStatRecordFor(enemy.eStats?.enemy_id ?? enemy.profile?.name ?? "");
        const techWeight = B.fightTechDB?.[String(skill.id)]?.f8 ?? 0;
        if (!stealProc(record?.field04 ?? 0, effStats(thief).spd | 0, effStats(enemy).spd | 0, techWeight, thief.stealBonus ?? 0, RAND_U16())) return { ok: false, missed: true };
        const dropName = enemy.eStats?.drop_item;
        if (!dropName || dropName === "Null") return { ok: false, nothing: true };
        const item = itemForDropName(dropName);
        if (!item) return { ok: false, nothing: true };
        return { ok: true, item: item.id, name: battleMsgText(0x6a, item.id) || item.name };
      },
      /** An item into my bag (a stolen one), through the shared store. */
      giveItem: (id) => { storeAddItem(state, id, 1); localStorage.setItem("inventory", JSON.stringify(state.inventory)); },
      itemName: (id) => battleMsgText(0x6a, id | 0) || window.__ITEM_BY_ID?.[id]?.name || "",
      // the seeds the game's own translated screens are opened with (the same shapes the one-on-one battle hands them)
      techSeed: (rec, free = false) => {
        const list = mpKitTechs(rec, free);
        return { activeIndex: 0, mp: rec.mp | 0, maxMp: rec.maxMp | 0, noCharge: free ? 1 : 0, techniques: list.map((t) => ({ word: t.tw & 0xffff, cost: t.cost })) };
      },
      itemSeed: () => B.itemListSeed(null),
      formSeed: (rec, member) => B.formListSeed({ playerRoster: [member], playerRecords: [rec], activePlayerIndex: 0, player: rec, blast: null }),
      tagSeed: (members, records, active) => B.tagListSeed({ playerRoster: members, playerRecords: records, activePlayerIndex: active, _forcedTag: false, tagRow: 0, blast: null }),
    };
  }
// EXPERIMENT (multiplayer co-op, web/mpsocial.js): two players fight the same enemy on their own screens and share its HP.
  // These three are only used while a co-op fight is on; they change nothing for a normal fight.
  async function rollEncounter(mapId, x, y) {
    await B.loadData();
    const roll = B.pickEnemy(mapId, x, y);
    return roll ? { party: roll.party, screen: roll.screen } : null;
  }
function coopSetEnemyHp(index, hp) {
    if (B.battle?.enemy && (B.battle.partyIndex | 0) === index && hp < B.battle.enemy.hp) B.battle.enemy.hp = Math.max(0, hp | 0);
  }
// The current enemy reached 0 HP: bank its drop, then either bring in the next boss-party
  // member (sequential gauntlet) or finish the battle (WIN). EXP and BIT come from the
  // battle's own reward record once, at the win (winRewards) — never per enemy.
  function defeatCurrentEnemy() {
    const b = B.battle;
    // NEW content (F2 -> Extras -> "Fusion bosses"): a fused body carries the OTHER
    // halves' real loot. The body's own row was already rolled when that half fell —
    // this function ran for it before fuseIntoBoss swapped the record — so skipping the
    // body here is what stops Kimeramon's DevilChip being paid twice. `bossId` is
    // written only by fuseIntoBoss, which is only reachable with the switch on, so with
    // the fusion layer off the ordinary path below is exactly today's.
    const fusionBoss = b.enemy?.bossId ? B.fusionBossesDB?.[b.enemy.bossId] ?? null : null;
    if (fusionBoss) {
      // The stream is the disc's RAND_U16 word, exactly as rollBattleDrop does.
      // One live draw per owed row; every item that lands joins the loot list the report banks.
      for (const item of rollFusionDrops(fusionBoss.halves, fusionBoss.body, B.enemiesDB, RAND_U16, true)) {
        b._loot.drops.push(item);
      }
    } else {
      // The disc rolls ONE item per won battle (wfightmn .L0x00001e84-.L0x00001fdc), not one
      // per enemy: a defeated enemy that carries an item only joins the candidates here.
      const es = b.enemy.eStats;
      if (es && es.drop_item && es.drop_item !== "Null") (b._loot.candidates ??= []).push(es);
    }

    // The Galacticmon finale's scripted sequence replaces the gauntlet swap for the
    // tail's fall (claim wfightmn-finale-kinds-2026-10-10): the disc's kind word walks
    // 4 -> 5 -> 6 through the body's cannon, and the body is never fought. What the
    // player meets: "After beating the tail, the body will fire off the Ragnarock
    // Cannon, reducing your current digimon to 1 HP. Fortunately, though, you should
    // get first attack on the head" (docs/research/story-progression/WALKTHROUGH_FULL.txt:5469-5471).
    // The extracted party's three members stand in for the disc's three spawned
    // phases: member 0 the tail, 1 the body, 2 the head.
    if (b.specialMode === 4 && b.partyIndex === 0 && b.party.length === 3) {
      B.runFinaleBeat(b, 0);
      return;
    }

    // NEW content (F2 -> Extras -> "Fusion bosses"): the last body of an authored fusion
    // party fuses instead of the battle ending. Only the last member may carry `fuseInto`
    // and only with the switch on (web/fusion.js). Not a second heal: the fused record's HP
    // is the authored 2424, never the player's maximum.
    const fusion = fusionOnDefeat({
      party: b.party, partyIndex: b.partyIndex, fxOn: fusionEnabled(), bosses: B.fusionBossesDB,
    });
    if (fusion.fuse) {
      B.fuseIntoBoss(b, fusion.boss);
      return;
    }

    // A real team (enemyTeamActive): the next enemy is the lowest slot with an id and hp (menu.c:1088-1096), so a member
    // that tagged out earlier comes back with the hp it had; else the party's next entry in order.
    const team = B.enemyTeamActive(b);
    const slot = team ? firstAliveEnemySlot(enemyTeamSlots(B.enemyTeamRecords(b))) : -1;
    const step = team
      ? (slot < 0 ? { done: true } : { done: false, index: slot, entry: b.party[slot] })
      : gauntletNext(b.party, b.partyIndex);
    const nextEnemy = step.done ? null : (team ? B.enemyTeamRecord(b, step.index) : B.buildEnemyRecord(step.entry));
    if (!nextEnemy) {
      // The battle's single disc drop roll: pick one candidate (RAND % count), then its rate.
      const drop = rollBattleDrop(b._loot.candidates, RAND_U16);
      if (drop) b._loot.drops.push(drop);
      b._loot.candidates = [];
      b.state = ST.WIN;
      b.timer = 0;
      b.message = "Battle Won!";
      b._victoryPhase = "pose";
      b._victoryReady = false;
      B.renderer3d?.playPlayerVictory?.();
      // wfightmn's win arm: it writes result 1 (the stager F0x8009c534(1) stores
      // `1` into the result byte 0x800a435c, fightstg.s:26513-26524) and then
      // plays W_JINGLE 0x6004001e through [0x80055c48] (.L0x000034c0-.L0x000034c4)
      // ONLY when the battle-kind word is not 6 (.L0x000034a4-.L0x000034ac) — the
      // finale's win skips the jingle. The exit cue that result 1 then takes is
      // read at arm 4's phase 2 (wfightmn.s:2165-2174): 0xE0B at kind 6 — STTITL
      // mode 11 = movie row 10 = MOVIEE01_STR, the ending movie — vs 0x1400
      // (STFRPT, the battle-result screen) otherwise. The report phase below is
      // replaced by the ending chain when the cue is the movie. Same jingle id the
      // card duel's win already plays.
      const winKind = battleKindOf(b);
      b._winLaunchCode = battleWinLaunchCode(winKind);
      if (battleWinJinglePlays(winKind)) B.sfx?.play("w_jingle");
      return;
    }
    nextEnemy.statusImmunities = b.statusImmunities;

    const nextName = enemyMsgName(nextEnemy, "");
    b.menuSel = 0;
    b._nextState = ST.PLAYER_MENU;
    b.state = ST.RESULT_MSG;
    b.timer = 0;
    // menu.c:1110 WFIGHTMN_knockOut: FIGHTSTG_startEntrance(next enemy id, 1, weak). The record is committed at
    // the cut (f114, `entrance->done`), the "steps forward" line (message 0xD) comes after the task ends (f299).
    // The model follows the body species, never an authored display name (Millenniummon has
    // no model folder of its own; its body is Kimeramon).
    B.startEntrance(b, {
      side: 1,
      name: nextEnemy.eStats?.digimon_id ?? nextEnemy.profile?.name ?? nextName,
      endMessage: `${nextName} steps forward!`,
      endSpec: { kind: MSG_KIND.NEXT_OUT, payload: [0], slots: [nextName] },
      onSwap: () => {
        if (team) { b._team ??= []; b._team[b.partyIndex] = b.enemy; b._team[step.index] = undefined; }
        b.partyIndex = step.index;
        b.enemy = nextEnemy;
        b.timeline = initialActorTimeline(effectiveSpd(b.player), effectiveSpd(nextEnemy));
        // A fresh timeline is a fresh turn for the command phase's Frozen gate.
        b._turnSeq = (b._turnSeq ?? 0) + 1;
        // Giant mode part 1: the next boss-party member may be a different size than the last.
        applyGiantScales(B.renderer3d, b.party?.[b.partyIndex], giantModeOn());
      },
    });
  }
  return { endBattle, mpKitTechs, mpKit, rollEncounter, coopSetEnemyHp, defeatCurrentEnemy };
}
