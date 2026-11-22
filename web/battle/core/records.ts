import { scaledHp, scaledMp } from "../../battle.js";
import { enemyVitals } from "../form-blast.js";
import { scaleEnemyStat } from "../../enemy-stats.js";
import {
  scaledStat,
  rosterSlotOfCharId,
  rosterSlotOfDigimonId,
  equipmentBonuses,
  crestSuppressedByWeapon,
  weaponCritByte,
  battleCoreStat,
  wornFamilyBytes,
  statPenaltyOf,
  isFormDigimonId,
} from "../../vendor/engine.js";
import { S } from "../state.js";
import { CHARID_TO_DIGID, baseStatsFor, elementPointsWithGear } from "../../party.js";
import { ensureStoredStats, autoEquipForm, dvLevelForExp, treeCandidatesFor } from "../progress.js";
import { normalizeDvGauge } from "../layout.js";
import { enemyTeamSlots } from "../../enemy-switch.js";
import { canonicalProfileName } from "../messages.js";
import { emit as emitGameEvent } from "../../gameEvents.js";
import type { BattleContext } from "../../types/battle.js";
import type { BattlePartyEntry } from "./types.js";

import type { GameState, FormLedgerEntry } from "../../game/types.js";
import type { RosterMember, BattleState, EnemyBattleRecord } from "../../types/battle.js";
import type { DigimonRecord } from "../../types/battle.js";
// moved by tools/rewrite/split-closure.mjs
export function makeRecords(B: BattleContext) {
// Build one enemy combat record from an encounter entry (enemyId name/id, level, and the
  // REAL per-encounter hp/mp). Reused for every member of a sequential boss party. Returns
  // null when the species can't be resolved.
  function buildEnemyRecord({
    enemyId, enemyLevel, enemyHp: realHp, enemyMp: realMp, enemyStatScale = 16, displayName = null,
  }: BattlePartyEntry) {
    // Resolve enemy: prefer sdigiedt entry by name, fall back to profile by numeric id
    const eStats = typeof enemyId === "string" ? B.enemiesDB[enemyId] : null;
    const enemyProf = eStats ? B.enemyToProfile(eStats) : (B.digimonDB[enemyId] ?? null);
    if (!enemyProf) return null;

    // Prefer the REAL per-encounter hp/mp (field_encounters, ROM-extracted) over the formula;
    // boss screens carry boss-specific values (e.g. Genji's Kuwagamon hp 100 / mp 9999).
    const { hp: eHp, mp: eMp } = enemyVitals(
      { hp: realHp, mp: realMp },
      {
        hp: eStats ? B.enemyHp(eStats, enemyLevel!) : scaledHp(enemyProf, enemyLevel),
        mp: eStats ? B.enemyMp(eStats, enemyLevel!) : scaledMp(enemyProf, enemyLevel),
      },
    );

    // FIGHTSTG_F0x8009ec94 scales the resolved species primary stats by the
    // encounter enemy-struct +0x0a halfword / 16. A value of 16 is identity.
    const scaledEnemyStat = (name: string) => eStats
      ? scaleEnemyStat(eStats[name], enemyStatScale)
      : scaledStat(enemyProf, name, enemyLevel);
    return {
      profile: enemyProf,
      // The disc id the team rules test (menu.c:1088 id != 0): enemyToProfile has none, field_encounters does.
      speciesId: S.enemyStatIdByName?.[eStats?.enemy_id] ?? (Number(enemyProf.id) || 0),
      eStats,                                 // raw sdigiedt entry (null for legacy numeric enemies)
      // The authored name the plate and the pages show instead of the body species
      // (NEW content, web/fusion.js: the fused body is drawn and stored as Kimeramon).
      displayName: displayName ?? null,
      fightSkill: eStats ? B.skillDB[eStats.attack] : null,
      level: enemyLevel,
      hp: eHp, maxHp: eHp,
      mp: eMp, maxMp: eMp,
      str: scaledEnemyStat("str"),
      def: scaledEnemyStat("def"),
      spt: scaledEnemyStat("spt"),
      wis: scaledEnemyStat("wis"),
      spd: scaledEnemyStat("spd"),
      // F0x8009f97c / F0x8009fab4 scale the attacking enemy's move power by
      // the same +0x0a halfword / 16, on top of the scaled stats above.
      powerScale: enemyStatScale,
      chr: 0,                                 // sdigiedt has no chr field
      // The enemy branch of F0x8009EC94 writes no accessory or weapon ladder byte,
      // so +0x28..+0x2A stay at the memset's 0 and +0x26 copies the live record's +0x0E.
      weaponFamilies: [],
      affinity: 0,
      // The live record's `+0x10` / `+0x12` / `+0x14`: the three signed stat modifiers
      // the category-5 stat arms write (`FIGHTSTG_F0x800a1aa8`, pro/fightstg.s:32295).
      // `effStats` adds them on top of the base fold above.
      statMods: { str: 0, def: 0, spd: 0 },
      ailments: {},
      // Combatant record +0x04: the enemy action turns this SLOT has started. The code-3
      // "enemy action turn" handler bumps it by one before spawning the turn script
      // (`wfightmn.s:4144-4148`, `lhu`/`addiu 1`/`sh` in the delay slot), so cond 18
      // tests the current turn's own number. Nothing resets it during a battle.
      turnCounter: 0,
    };
  }
// Materialize the three persistent roster records for battle.  Slot 0 remains
  // state.partnerStats for compatibility with existing saves; reserve slots are
  // the index-aligned partyStats records used by DRI/status/formation screens.
  function buildPlayerRoster(state: GameState) {
    const leadChar = state.manifest?.characters?.[state.charIdx]?.id;
    const partyIds = Array.isArray(state.party) && state.party.length
      ? state.party : (leadChar ? [leadChar] : []);
    if (!Array.isArray(state.partyStats) || state.partyStats.length !== partyIds.length)
      state.partyStats = partyIds.map((_, i: number) => i === 0 ? state.partnerStats : null);
    state.partyStats[0] = state.partnerStats;
    return partyIds.map((charId: string | number, index: number) => {
      const rookieId = Number(CHARID_TO_DIGID[charId]);
      const rookie = B.digimonDB[rookieId];
      if (index > 0 && !state.partyStats[index])
        state.partyStats[index] = baseStatsFor(rookie);
      return {
        index, charId, rookieId,
        // Which of the eight digivolution trees this line learns from. The unlock
        // routine is handed a roster slot, so the slot travels with the member.
        slot: rosterSlotOfCharId(charId) ?? rosterSlotOfDigimonId(rookieId) ?? rookieId - 1,
        name: state.digimonNames?.[charId] ?? rookie?.name ?? charId,
        stats: index === 0 ? state.partnerStats : state.partyStats[index],
      };
    }).filter((member) => member.stats && B.digimonDB[member.rookieId]);
  }
// Build the resident live 0x20-style combat record for one roster member.
  // wfightmn F0x800a66b0 copies the persistent HP/MP/stat body once at battle
  // setup. Manual DV and Tag subsequently replace only record+0x00 (form id)
  // before reloading the model; they do not rebuild the live stat body.
  function buildPlayerRecord(member: RosterMember, requestedFormId: number | null = null) {
    const state = B.getState();
    const ps = member.stats;
    const configuredId = Number(ps.digimonId ?? member.rookieId);
    const formId = Number(requestedFormId ?? configuredId);
    const configuredProfile = B.digimonDB[configuredId] ?? B.digimonDB[member.rookieId];
    const profile = B.digimonDB[formId] ?? configuredProfile;
    // The roster row's own species: the starter of this slot (F0x8009EC94 reads the
    // fixed DIGIMON_PROFILES row, and the pause menu / lab write only the worn-form
    // word, ps.digimonId). A worn form therefore always differs from it.
    const starterProfile = B.digimonDB[member.rookieId];
    const level = ps.level ?? 1;
    const bn = ps.bonuses ?? {};
    // Combat initialization reads the equipped slots themselves, the same
    // engine interpretation the status sheet and shop preview use. The cached
    // partnerStats.equipBonuses is display/charisma only and can go stale on a
    // path that changes a slot without syncing it (the shop counter did).
    const equipment = state.equipment?.[member.index] ?? {};
    // `member.slot` is the ROSTER slot, which is what the original's signature-set
    // table is keyed by (F0x80017174 indexes 0x8004B53C by the slot the save context
    // handed it), not the party position.
    const eb = equipmentBonuses(equipment, member.slot);
    // The stored body is the roster row's own (the starter's), so a record with none
    // is seeded from the starter, never from the worn form that is added on top.
    const st = ensureStoredStats(ps, starterProfile);
    const maxHp = Number(ps.maxHp ?? scaledHp(starterProfile, level));
    const maxMp = Number(ps.maxMp ?? scaledMp(starterProfile, level));
    const accFx = {} as Record<string, number>;
    for (const f of eb.effects ?? []) accFx[f.kind] = (accFx[f.kind] ?? 0) + (f.amount || 1);
    // The MP proxies are slot-assigned, not cumulative: FIGHTSTG_F0x800a1d3c keeps
    // the LAST matching accessory slot (acc1 overwrites acc0), so both equipped
    // means one −10, never −15.
    const mpProxies = (eb.effects ?? []).filter((f) => f.kind === "mp_cost_down");
    const mpCostDown = mpProxies.length ? (mpProxies[mpProxies.length - 1]!.amount || 1) : 0;
    // The trained points with the worn gear's coded resist folded on top, through
    // the one shared helper (web/party.js) — the same sum the status sheet and the
    // gym HUD print, so the battle divisor cannot drift from them.
    const pElem = elementPointsWithGear(ps.elemBonuses, eb.elemResists);
    const pStatusRes = {};
    for (const [stName, v] of Object.entries(eb.statusResists ?? {}))
      pStatusRes[stName === "paralyze" ? "frozen" : stName] = v;
    const elemAttack = (eb.effects ?? []).find(f => f.kind === "elem_attack");
    // The effective crit byte (+0x38) has ONE writer at a time: the signature-weapon
    // ladder fills it for SaberFang/Shuriken and sets its own found flag, which makes
    // the Multi/Search/Counter crest rungs skip (fightstg.s:29521 `bnez $s3`). The
    // ladder walks roster +0x3C0/+0x3C4/+0x3C6 and steps over +0x3C2, so a body piece
    // is never a signature weapon.
    // So a signature weapon in head, right or left cancels the three crest effects.
    // The ladder visits head, right, left in that order and each crit rung overwrites
    // the byte (`sb $v0, 0x38($s2)` at 0x8009f1f0), so the LAST crit weapon wins.
    const crestOff = crestSuppressedByWeapon(equipment);
    let critByte = 0;
    for (const slot of ["head", "right", "left"]) {
      const id = equipment[slot];
      if (id != null && weaponCritByte(id) !== 0) critByte = weaponCritByte(id);
    }
    return {
      profile, level, rosterIndex: member.index, rookieId: member.rookieId, statsRecord: ps,
      // The species the numbers below belong to (F0x8009EC94's profile-block
      // species: the roster slot's own starter row, which a form change never
      // alters). While the live form differs from it, a form worn from the pause
      // menu or lab included, the live form's own base stats are added on every read.
      savedSpeciesId: member.rookieId,
      // The roster's own species record, the row savedSpeciesId names. The live
      // `profile` above is swapped by every form change, and F0x8009EC94 keeps
      // building the seven element values and the five status resistances from
      // THIS row before adding the live form's own on top.
      savedProfile: starterProfile,
      rosterSpeciesId: ps.digimonId ?? configuredId,
      hp: Math.min(Number(ps.hp ?? maxHp), maxHp),
      maxHp,
      mp: Math.min(Number(ps.mp ?? maxMp), maxMp),
      maxMp,
      // The five core stats F0x8009EC94 copies into the block at +0x02..+0x0A:
      // the member's own stored halfword with every worn piece's fold added by
      // F0x80017174 — capped on the RUNNING total at 999 by that producer's own add
      // (exe/fns.s:7837-7847) and floored at 1 by the block's copy
      // (pro/fightstg.s:29320-29326). CHR is not in the block: the five-word loop stops
      // at scratch +0x14, and the charisma gate clamps its own sum.
      str: battleCoreStat(st.str + (bn.str ?? 0), eb.str ?? 0),
      def: battleCoreStat(st.def + (bn.def ?? 0), eb.def ?? 0),
      spt: battleCoreStat(st.spt + (bn.spt ?? 0), eb.spt ?? 0),
      wis: battleCoreStat(st.wis + (bn.wis ?? 0), eb.wis ?? 0),
      spd: battleCoreStat(st.spd + (bn.spd ?? 0), eb.spd ?? 0),
      chr: st.chr + (bn.chr ?? 0) + (eb.chr ?? 0),
      elemBonuses: pElem,
      ailments: {},
      regeneration: !!accFx.regen,
      crit: critByte || (crestOff ? 0 : (accFx.crit_up ?? 0)),
      armor: accFx.damage_down ?? 0,
      // Combatant +0x3a / +0x3b: the worn weapon's byte +0x0E and the worn armour's
      // byte +0x10 accumulate into these pools, and the Glasses / DanceFeather
      // accessory rungs feed the same two bytes (claims EQUIP-C009, EQUIP-C016).
      accBonus: (eb.accPool ?? 0) + (accFx.accuracy_up ?? 0),
      evadeBonus: (eb.evadePool ?? 0) + (accFx.evade_up ?? 0),
      escapeBonus: accFx.escape_up ?? 0,
      mpCostDown,
      stealBonus: accFx.steal_up ?? 0,
      statusResists: pStatusRes,
      elemAttack: elemAttack ?? null,
      multiAttack: !crestOff && !!accFx.multi_attack,
      // Effective block +0x28..: the stat-record byte +0x12 of the worn family
      // 2..14 pieces (Dramon Guard / Dramon Horn carry 11, the Paildramon line).
      // F0x8009f6dc stage 2 adds half again (x1.5) to a plain attack on a match.
      weaponFamilies: wornFamilyBytes(equipment),
      // Effective block +0x26, the affinity multiplier. F0x8009EC94 copies it from
      // the live record's +0x0E, whose writer is not located; the walker's own live
      // record carries none, which is what every captured battle shows.
      affinity: 0,
      // The live record's `+0x10` / `+0x12` / `+0x14`, as on the enemy record: the
      // category-5 stat arms' own writes, which `effStats` adds to the block.
      statMods: { str: 0, def: 0, spd: 0 },
      // The three PERSISTENT penalty halfwords the post-hit arms write (roster
      // `+0x42`/`+0x44`/`+0x46`), copied from the roster member at setup the way
      // `F0x800a66b0` copies the member's body into the live record. A penalty dealt in an
      // earlier battle is on `ps` and shows up here; `effStats` subtracts it.
      statPenalty: statPenaltyOf({ statPenalty: ps.statPenalty }),
      binderCrest: !!accFx.no_flee,
      counterCrest: !crestOff && !!accFx.counter,
      gaugeAccessories: [equipment.acc0, equipment.acc1].filter(Boolean),
      // Right-hand weapon id — its signature secondary (poison/frozen/confuse/
      // KO) is gated on a plain attack; see weaponSecondaryProc.
      rightWeapon: equipment.right ?? null,
      gauge: normalizeDvGauge(ps.dvGauge),
    };
  }
// The enemy TEAM: the original keeps up to three enemy records at once (fighters[1][0..2], one active) and its
  // turn can switch to another (enemy_turn.c FIGHTSTG_pickEnemySwitch); a KO brings the lowest living slot
  // (menu.c:1088-1096). Here slot i is the boss party's entry i. Not a team: a one-member party, the Galacticmon finale
  // (its three members are phases of one body, specialMode 4) and the F2 fusion bodies.
  function enemyTeamActive(b: BattleState) {
    return !!b?.enemy && (b.party?.length ?? 0) > 1 && b.specialMode !== 4
      && !b.enemy.bossId && !b.party.some((entry) => entry?.fuseInto);
  }
/** Slot i's record: the active one is b.enemy; the others are built once (full hp) and kept, so a member that tagged
   *  out keeps its hp, mp and ailments. null for a slot the party does not have or whose species does not resolve. */
  function enemyTeamRecord(b: BattleState, i: number) {
    if (i === b.partyIndex) return b.enemy;
    const entry = b.party?.[i];
    if (!entry) return null;
    b._team ??= [];
    if (b._team[i] === undefined) {
      const rec = buildEnemyRecord(entry);
      if (rec) (rec as { statusImmunities?: any }).statusImmunities = b.statusImmunities;
      b._team[i] = rec ?? null;
    }
    return b._team[i];
  }
/** The three slots' records, in slot order. */
  function enemyTeamRecords(b: BattleState) {
    const out = [];
    for (let i = 0; i < Math.min(3, b.party?.length ?? 0); i++) out.push(enemyTeamRecord(b, i));
    return out;
  }
/** check_move_cond 10's operands for the actor `en`: the team's slots and the active one, or just `en` alone. */
  function enemyConditionSlots(b: BattleState, en: EnemyBattleRecord) {
    if (b && en === b.enemy && enemyTeamActive(b)) {
      return { enemySlots: enemyTeamSlots(enemyTeamRecords(b)), activeEnemyIndex: b.partyIndex };
    }
    return { enemySlots: enemyTeamSlots([en]), activeEnemyIndex: 0 };
  }
// Resolve a digimon profile by its DiscId. The evolution trees name their forms by
  // DigimonId (the 1-based species-table row), which is also what the form ledger keys,
  // so nothing in the unlock path has to go through a name and get it misspelled.
  function profileById(id: number | string) {
    return B.digimonDB?.[Number(id)] ?? null;
  }
function profileByName(name: string | number) {
    if (!B.digimonDB) return null;
    if (!B._profileByName) {
      B._profileByName = {};
      for (const id of Object.keys(B.digimonDB)) B._profileByName[B.digimonDB[id]!.name] = B.digimonDB[id];
    }
    return B._profileByName[canonicalProfileName(name)] ?? null;
  }
// From a list of available evos, keep only those whose target form has a usable profile
  // (so the menu never offers an evolution we can't actually apply). Dedupes by `to`.
  function evoTargets<T extends { to: string | number; }>(evos: readonly T[] | null | undefined) {
    const seen = new Set<string | number>();
    const out: T[] = [];
    for (const e of evos ?? []) {
      if (seen.has(e.to)) continue;
      if (!profileByName(e.to)) continue; // no stat profile for this form → can't apply
      seen.add(e.to);
      out.push(e);
    }
    return out;
  }
// Apply an evolution: switch the partner's digimon to `toName`, recompute max HP/MP at the
  // current level (+ stat-item bonuses), full-heal, and persist. The partner identity rides on
  // the character's `digimonId` (getPlayerProfile reads it); we also stash it in partnerStats so
  // it survives a reload. Returns { ok, from, name } or { ok:false }.
  function partyFormState(state: GameState, rosterIndex = 0) {
    const charId = state?.party?.[rosterIndex]
      ?? (rosterIndex === 0 ? state?.manifest?.characters?.[state?.charIdx]?.id : null);
    const rookieId = Number(CHARID_TO_DIGID[charId]);
    const rookie = B.digimonDB?.[rookieId];
    if (!rookie) return null;
    if (!Array.isArray(state.partyStats) || state.partyStats.length !== (state.party?.length ?? 1))
      state.partyStats = (state.party ?? [charId]).map((_, i: number) => i === 0 ? state.partnerStats : null);
    if (rosterIndex > 0 && !state.partyStats[rosterIndex])
      state.partyStats[rosterIndex] = baseStatsFor(rookie);
    const stats = rosterIndex === 0 ? state.partnerStats : state.partyStats[rosterIndex];
    const current = B.digimonDB?.[Number(stats?.digimonId ?? rookieId)] ?? rookie;
    // Which of the eight trees this member learns from. The unlock routine takes a
    // roster slot, so the slot is the member's identity here — not the form it is in.
    const slot = rosterSlotOfCharId(charId) ?? rosterSlotOfDigimonId(rookieId) ?? rookieId - 1;
    return { charId, rookieId, rookie, current, stats, slot };
  }
function initializePartyStats(state: GameState) {
    if (!Array.isArray(state?.party) || !state.party.length) return false;
    state.partyStats = state.party.map((charId: string | number) =>
      baseStatsFor(B.digimonDB?.[Number(CHARID_TO_DIGID[charId])]),
    );
    state.partnerStats = state.partyStats[0];
    localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
    return !!state.partnerStats;
  }
function applyEvolution(toName: string | number, state = B.getState(), rosterIndex = 0) {
    const prof = profileByName(toName);
    const member = partyFormState(state, rosterIndex);
    const ps = member?.stats;
    if (!prof || !member || !ps) return { ok: false };
    const from = member.current?.name ?? "Your partner";
    ps.formLedger ??= [];
    if (isFormDigimonId(prof.id) && !ps.formLedger.some((record: FormLedgerEntry) => Number(record.id) === Number(prof.id)))
      ps.formLedger.push({ id: prof.id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
    ps.equippedForms ??= [];
    if (isFormDigimonId(prof.id) && !ps.equippedForms.includes(prof.id)) {
      // stfgtrep file 0x3898-0x38C0: first free slot, or nothing at all when
      // the three slots are full. The oldest form is never shifted out.
      const fitted = autoEquipForm(ps.equippedForms, prof.id);
      ps.equippedForms = fitted.equipped;
    }
    // Wearing a form writes only the current-form word (pro/ststatus.s:7655-7663): stats, max HP/MP and HP/MP stay the member's own; buildPlayerRecord adds the form on top in battle.
    ps.digimonId = prof.id;          // persisted partner identity (restored on load)
    emitGameEvent("formWorn", { name: prof.name });   // the glossary counts a form you wore as met
    if (rosterIndex === 0) {
      state.partnerStats = ps;
      const char = state.manifest?.characters?.[state.charIdx];
      if (char) char.digimonId = prof.id; // live session: future battles use the new form
      localStorage.setItem("partnerStats", JSON.stringify(ps));
    } else {
      state.partyStats[rosterIndex] = ps;
      localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
    }
    B._profileByName = null; // (no-op; profiles don't change, kept for symmetry)
    return { ok: true, from, name: prof.name };
  }
// The current partner's resolved profile + scaled combat stats at its level (+ bonuses) —
  // for the menu's Digimon/Status tabs. null when there's no partner yet.
  function partnerInfo(state: GameState) {
    const prof = B.getPlayerProfile(state);
    const ps = state?.partnerStats;
    if (!prof || !ps) return null;
    const level = ps.level ?? 1;
    const b = ps.bonuses ?? {};
    const st = ensureStoredStats(ps, B.digimonDB?.[CHARID_TO_DIGID[state?.party?.[0]]] ?? prof);
    const stat = (k: string) => st[k] + (b[k] ?? 0);
    // DV (form) level: derived from the current form's DVEXP bank (fn 0x800865c0).
    const formCap = prof.dv_cap ?? 100;
    const dvexp = ps.dvexpByForm?.[prof.id] ?? ps.dvexp ?? 0;
    return {
      name: prof.name, level,
      hp: ps.hp, maxHp: ps.maxHp, mp: ps.mp, maxMp: ps.maxMp,
      str: stat("str"), def: stat("def"), spt: stat("spt"),
      wis: stat("wis"), spd: stat("spd"), chr: stat("chr"),
      dvLevel: dvLevelForExp(dvexp, formCap), dvexp,
    };
  }
// The forms this partner can be in RIGHT NOW: the three it has already equipped,
  // then the forms its own line's tree says it has earned and not yet used. The
  // second list is one rule call over the disc's tree for THIS roster slot, so a
  // Kotemon line is never offered another line's route.
  function availableEvolutions(state: GameState, rosterIndex: number = 0) {
    const member = partyFormState(state, rosterIndex);
    if (!member?.stats) return [];
    const out: { to: string; formId: number; equipped: boolean; }[] = [];
    const seen = new Set();
    const add = (prof: DigimonRecord | null | undefined, entry: { to: null; equipped: boolean; }) => {
      if (!prof || seen.has(prof.id) || out.length >= 3) return;
      seen.add(prof.id);
      out.push({ ...entry, to: prof.name, formId: prof.id });
    };
    for (const id of member.stats.equippedForms ?? []) {
      add(B.digimonDB?.[Number(id)], { to: null, equipped: true });
    }
    for (const entry of treeCandidatesFor(B.evolutionTrees, B.digimonDB, member)) add(profileById(entry.toId), entry);
    return out;
  }
  return { buildEnemyRecord, buildPlayerRoster, buildPlayerRecord, enemyTeamActive, enemyTeamRecord, enemyTeamRecords, enemyConditionSlots, profileById, profileByName, evoTargets, partyFormState, initializePartyStats, applyEvolution, partnerInfo, availableEvolutions };
}
