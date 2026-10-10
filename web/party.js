import { elementValues } from "./vendor/engine.js";

/** The six core stats, in the original's own order. */
const CORE_STATS = ["str", "def", "spt", "wis", "spd", "chr"];

// Keep the lead's cached battle bonus block in sync with the worn slots. The
// status sheet, shop preview and battle all read equipmentBonuses; battle.js now
// derives it from the slots itself, but charisma and the persisted partnerStats
// still read this cache, so every path that changes the lead's gear refreshes it
// (pause menu, shop counter, DRI form change, and the pause page's own close
// commit). It has ONE implementation, beside `equipmentBonuses` in
// engine/dw3/equipment.ts; the two pause routes reach it through the shared close
// commit (engine/dw3/ui/pause-close-commit.ts) rather than through a second copy.
export { syncLeadEquipBonuses } from "./vendor/engine.js";

// web/party.js
//
// The tamer's FIELD party. A Starter Pack is three Digimon and you keep all three
// (RAM-verified roster of 3 deployed — docs/research/battle-ram-layout.md). All three
// trail the tamer in the overworld; the lead (index 0) is the battle-active one and
// follows closest. Pure + DOM-free so it unit-tests under node:test.

// Grant every member of the chosen pack, moving the picked lead to the front.
// packMembers: array of manifest character ids; leadIdx: which one the player chose.
export function grantPack(packMembers, leadIdx) {
  const lead = packMembers[leadIdx];
  const rest = packMembers.filter((_, i) => i !== leadIdx);
  return { party: [lead, ...rest], leadIdx: 0 };
}

// The download scene is the ownership boundary. A selected manifest character
// or stale charIdx is not a party and must never create followers/encounters.
export function fieldPartySize(party, cap = 3) {
  return Array.isArray(party) ? Math.min(party.length, cap) : 0;
}

// Starter-pack manifest character id -> digimon.json id (mirrors battle.js's internal
// map; kept here as the single source of truth so the status menu can resolve the same
// party members without depending on battle.js's private closure state).
export const CHARID_TO_DIGID = {
  "p003pken": 1,  // Kotemon
  "p004kogu": 2,  // Kumamon
  "p005koet": 3,  // Monmon
  "p006agum": 4,  // Agumon
  "p007vmon": 5,  // Veemon
  "p008giru": 6,  // Guilmon
  "p009rena": 7,  // Renamon
  "p010pata": 8,  // Patamon
};

// Base (level-1) stat block for a freshly-recruited party member — same shape as
// state.partnerStats. Used to seed the two field-party members who never enter battle
// in the current engine (only the lead fights), so the status menu has real numbers
// to show instead of blanks.
export function baseStatsFor(digimonProfile) {
  if (!digimonProfile) return null;
  return {
    digimonId: digimonProfile.id,
    level: 1,
    xp: 0,
    hp: digimonProfile.hp, maxHp: digimonProfile.hp,
    mp: digimonProfile.mp, maxMp: digimonProfile.mp,
    bonuses: {}, elemBonuses: {},
  };
}

// Build the full roster view the status menu draws: one entry per party member, with
// the LEAD's entry backed by the live battle-tracked partnerStats (so leveling/EXP/HP
// stay in sync with battles) and the other members backed by their own static
// partyStats slot (persisted separately; they don't fight, so they don't level).
// Pure function: party = state.party (manifest ids, lead first), partnerStats = the
// lead's live stat block, partyStats = array of stat blocks for indices 1.., digimonDB
// keyed by digimon.json id.
export function partyRosterView(party, partnerStats, partyStats, digimonDB, names) {
  return (party ?? []).map((charId, i) => {
    const rookieId = CHARID_TO_DIGID[charId];
    const rookie = digimonDB?.[rookieId];
    const stats = i === 0 ? partnerStats : (partyStats?.[i] ?? baseStatsFor(rookie));
    const digId = Number(stats?.digimonId ?? rookieId);
    const prof = digimonDB?.[digId] ?? rookie;
    return {
      charId, rookieId, digimonId: digId, profile: prof,
      // names = player-given names (Baronmon's Change Account desk — launcher bank
      // 0x7c index 1); falls back to the species name.
      // The menus name the BASE Digimon, never the form it is wearing. Every
      // status and report screen in the original shows "Kotemon" while the
      // three digivolutions sit in their own slots beside it — captures
      // docs/research/ui/captures/original-status-2026-09-03/. `formName` is
      // the current form, for the places that really do want it.
      name: names?.[charId] ?? rookie?.name ?? prof?.name ?? charId,
      formName: prof?.name ?? rookie?.name ?? charId,
      level: stats?.level ?? 1,
      xp: stats?.xp ?? 0,
      tp: stats?.tp ?? 0,
      hp: stats?.hp ?? prof?.hp ?? 0,
      maxHp: stats?.maxHp ?? prof?.hp ?? 0,
      mp: stats?.mp ?? prof?.mp ?? 0,
      maxMp: stats?.maxMp ?? prof?.mp ?? 0,
      // Stored current core stats (stored-stat model; grown by level-up rolls + gym)
      // and the per-form DVEXP bank. Absent on non-lead members / old saves —
      // consumers fall back to profile baselines.
      stats: stats?.stats ?? null,
      // Permanent stat-item bonuses (the chips), which the walker stores beside the
      // stored stats rather than inside them — partnerInfo draws str/def/.../chr as
      // stats[k] + bonuses[k], and the Charisma gate has to read the same total.
      bonuses: stats?.bonuses ?? null,
      dvexpByForm: stats?.dvexpByForm ?? null,
      formLedger: stats?.formLedger ?? null,
      equippedForms: stats?.equippedForms ?? null,
      // The roster record's thirteen stat halfwords, the block the translated
      // pause session writes at record +0x30..+0x48 and F0x80017174 then copies
      // verbatim (exe/fns.s:7740-7811). `core` is the stored value plus the
      // permanent stat chips; `elements` is the one shared element value
      // (species base + every trained point, 999-capped) — the worn gear's
      // resist is added by F0x80017174 itself, so it is deliberately NOT here.
      core: CORE_STATS.map((k) => (Number(stats?.stats?.[k] ?? prof?.[k] ?? 0) || 0)
        + (Number(stats?.bonuses?.[k] ?? 0) || 0)),
      elements: elementValues(prof, stats?.elemBonuses),
    };
  });
}
