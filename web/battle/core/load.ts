import { fusionEnabled, mergeFusionSkills, mergeLabBosses } from "../../fusion.js";
import {
  pickEncounter,
  RAND_U16,
  zoneRateLevel,
  zoneAt,
  stageZoneBlocks,
  stealProc,
  storeAddItem,
  battleMessagePage,
} from "../../vendor/engine.js";
import { CHARID_TO_DIGID } from "../../party.js";
import { enemyStatRecordFor } from "../hud.js";
import { effStats } from "../hit-results.js";
import { itemForDropName } from "../../drop-item.js";
import { battleMsgText } from "../../battlemsg-translated.js";
import { winBattleRewards, paidParticipants } from "../progress.js";
import type { BattleContext } from "../../types/battle.js";
import type { BattleEndContext } from "./types.js";

import type { EnemyRecord } from "../../types/battle.js";
import type { GameState } from "../../game/types.js";
// moved by tools/rewrite/split-closure.mjs
export function makeLoad(B: BattleContext) {
async function loadFusionData() {
    if (B.fusionDataTried || !fusionEnabled()) return;
    B.fusionDataTried = true;
    try {
      const r = await fetch("fusion_bosses.json", { cache: "no-store" });
      if (!r.ok) return;
      const fj = await r.json();
      B.fusionBossesDB = fj?.bosses ?? null;
      B.skillDB = mergeFusionSkills(B.skillDB, fj?.skills, true);
    } catch { B.fusionBossesDB = null; }
    // Fusion Lab bosses (web/fusion-lab.html "Make boss"): a private, git-ignored file in
    // web/assets. Absent = nothing happens; the authored table stays exactly as it was.
    try {
      const r = await fetch("assets/data/fusion_lab_bosses.json", { cache: "no-store" });
      if (r.ok) B.fusionBossesDB = mergeLabBosses(B.fusionBossesDB ?? {}, await r.json());
    } catch { /* no Lab bosses */ }
  }
// Roll a random encounter for (mapId, player x,y) against the authentic field tables.
  // Faithful to the engine selector (fieldstg fn 0x800925a8): geographic zone → rand()&7
  // slot → screen_id → enemy party. Returns the party array (1–3 members) or null when the
  // roll lands on an empty slot / the stage has no pool ("no encounter this roll").
  // See docs/research/battle-invocation.md and web/encounters.js.
  function pickEnemy(mapId: number | string, x: number = 0, y: number = 0) {
    if (!B.stageEncDB) return null;
    return pickEncounter({
      stageDB: B.stageEncDB, fieldDB: B.fieldEncDB, gridDB: B.zoneGridDB,
      mapId, x, y, rng: () => RAND_U16(), progressOrdinal: B.storyOrdinal(),
      entryKey: B.entryKey(),
    });
  }
// The encounter-rate level of the zone the player is standing in, for the field's
  // step counter (fieldstg driver fn 0x80092664 reads `*zoneArray[zone-1]`).
  // Returns 0 when the stage has no pool — the caller then rolls nothing.
  function encounterRateLevel(mapId: number | string, x: number = 0, y: number = 0) {
    if (!B.stageEncDB) return 0;
    const key = String(mapId).match(/(\d+)/)?.[1];
    const stage = key ? B.stageEncDB.stages?.[key] : null;
    if (!stage?.zones) return 0;
    return zoneRateLevel(stage.zones, zoneAt(B.zoneGridDB?.stages?.[key], x, y),
                         stageZoneBlocks(stage, B.storyOrdinal(), B.entryKey()));
  }
// Build a fake profile-like object from a sdigiedt enemy entry so elementFactor works.
  function enemyToProfile(eStats: EnemyRecord) {
    return {
      name: eStats.digimon_id,
      resistances: eStats.resistances ?? {},
      // The effective block's +0x25 family byte. The enemy branch of F0x8009EC94
      // copies the resolved species record's byte +0x30 (pro/fightstg.s:0x8009f5f4,
      // engine/dw3/equipment.ts:883), and that record field is this entry's
      // `digimon_type` — the same 1..11 classification a player form carries in
      // `family`. Without it `effStats` answers the fallback 1, so a family-targeted
      // technique (skill +0x9 = elem2 >= 2) loses its x1.5 stage and its +0x3C
      // crit arm whenever the DEFENDER is an enemy.
      family: eStats.digimon_type,
    };
  }
// HP formula for wild enemies: calibrated so Apemon (str=128) at level 10 ≈ 360 HP.
  function enemyHp(eStats: { str: number; }, level: number) {
    return Math.max(30, Math.round(eStats.str * 2.5 + level * 5));
  }
function enemyMp(eStats: { spt: number; }, level: number) {
    return Math.max(10, Math.round(eStats.spt * 1.5 + level * 3));
  }
// Map charId → digimon id (matches packs.js charId values)
  function getPlayerProfile(state: GameState) {
    const chars = state.manifest?.characters;
    if (!chars || state.charIdx <= 0) return null;
    const char   = chars[state.charIdx];
    // A character may carry an explicit digimonId (e.g. an evolved form chosen by the
    // battle-test harness); otherwise fall back to the starter charId map.
    const digId  = state.partnerStats?.digimonId ?? char?.digimonId ?? CHARID_TO_DIGID[char?.id];
    return digId ? B.digimonDB[digId] : null;
  }
// (scaledStat / scaledHp / scaledMp are module-level pure functions above.)

  // Steal (f7=12): the player's steal moves roll effect_p1 vs the enemy's WIS; on success
  // they grab the enemy's drop item into the inventory. Returns `{ text, page }`: the
  // walker's own flat suffix for the legacy box, and the original's own PAGE when there
  // is one.
  //
  // A landed steal is FIGHTSTG_F0x80091534's opcode 5 arm: `FIGHTSTG_F0x80091534`
  // writes the stolen ItemId into the payload word the message reads
  // (fightstg.s:15000 `lh $v0, 0x18($s0)` / `:15002 sw $v0, 0x54($s3)` then
  // `:15004 li $a1, 0x11`) and asks
  // for **kind 17**, whose arm `.L0x80099e8c` is line one `esmfight[0x26]` "Stole"
  // (`:23945 li $a2, 0x26`), line two `esmfight[0x09]` `{1}!` (`:23956 li $a2, 0x9`)
  // and the item's own name out of bank 0x6a in slot 1 (`:23960 addiu $a0, 0x6a`,
  // `:24147 lw $a2, ($s2)`). So the player reads two lines, not a sentence appended to
  // the damage one. The two refusals keep the walker's own words: the original's opcode-5
  // arm has no refusal page of its own — it tests `andi $v0, 0x8` at `:14990` and, when
  // it fails, stores the item id and prints kind 17 anyway.
  function trySteal(skill, enemy, state, thiefName = "") {
    if (skill?.effect !== "steal" || enemy.hp <= 0) return { text: "", page: null };
    const stealBonus = B.battle?.player?.stealBonus ?? 0;  // HackSticker/System (+32/+64)
    // FIGHTSTG_F0x800a1114's own roll, through the port `stealProc`: a ratio of the
    // ACTING side's effective SPD (eff+0xa) to the other side's (eff+0x4a) clamped to 200,
    // times the technique record's +0x0B weight byte (fight_tech_table `f8`) plus the
    // steal_up bonus, scaled by the resolved enemy stat record's +0x04, compared against
    // the low ten bits of the RNG. This REPLACES the walker's old secondary-status formula
    // `statusRoll(effect_p1 + bonus, enemy.wis)` and changes the odds — the direction is
    // laid out in docs/research/battle/battle-steal-roll-wired-2026-10-06.md.
    const record = enemyStatRecordFor(enemy.eStats?.enemy_id ?? enemy.profile?.name ?? "");
    const techWeight = B.fightTechDB?.[String(skill.id)]?.f8 ?? 0;
    const thiefSpd = B.battle?.player ? effStats(B.battle.player).spd | 0 : 0;
    const foeSpd = effStats(enemy).spd | 0;
    const enemyFactor = record?.field04 ?? 0;
    if (!stealProc(enemyFactor, thiefSpd, foeSpd, techWeight, stealBonus, RAND_U16())) return { text: "", page: null };
    const dropName = enemy.eStats?.drop_item;
    if (!dropName || dropName === "Null") return { text: " ...but there was nothing to steal!", page: null };
    const item = itemForDropName(dropName);
    if (!item) return { text: " ...but the item slipped away!", page: null };
    // The shared store, so a stolen item at the original's 99 cap stays at 99
    // (F0x800161D8) instead of running to 100.
    storeAddItem(state, item.id, 1);
    localStorage.setItem("inventory", JSON.stringify(state.inventory));
    const name = battleMsgText(0x6a, item.id) || item.name;
    return {
      text: ` Stole ${item.name}!`,
      page: battleMessagePage(17, { name: thiefName, index: item.id, slot: name }),
    };
  }
// The battle's EXP/Bits/DVEXP payout: the disc's per-battle reward record for this
  // battle's own screenId, shared between the participants. Nothing else — the original
  // has no per-enemy EXP rule, so a battle with no record pays 0 (winBattleRewards).
  // The divisor is the number of participants STILL STANDING at the outcome, which is
  // what stfgtrep's flagged-row count divides by (.L0x00002c68).
  function winRewards(b: BattleEndContext, rosterIndex: number = b.activePlayerIndex ?? 0) {
    return winBattleRewards({
      screenId: b.screenId,
      participants: Math.max(1, paidParticipants(b).length),
      equipment: B.getState().equipment?.[rosterIndex] ?? {},
      rewards: B.progressionDB?.battle_rewards,
    });
  }
  return { loadFusionData, pickEnemy, encounterRateLevel, enemyToProfile, enemyHp, enemyMp, getPlayerProfile, trySteal, winRewards };
}
