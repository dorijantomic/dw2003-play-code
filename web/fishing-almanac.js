// web/fishing-almanac.js — the 46 fishing stages as one read-only table.
//
// Pure: no DOM, no fs, no fetch. The page (web/fishing-almanac.html) hands in
// the four tables the game already ships and the field line in web/game.js
// reads castsLeft(); nothing here writes a game rule, a catch table or a
// reward.
//
// WHAT THE DATA SAYS (docs/research/field/fishing-system-decoded-2026-07-11.md,
// tools/extract_fishing_spots.py):
//   * a fishing spot is an op-7 step record gated on the FishingPole flag
//     (0x8005), so the spots only exist once you own the rod;
//   * a strike starts a BATTLE, never an item drop. Band 1 starts the stage's
//     scripted encounter-block slot 4, band 2 starts slot 7;
//   * slot 4 is a Cardmon party on every one of the 46 fishing stages, slot 7
//     is the area's big water Digimon;
//   * a visit carries sixteen casts (engine/systems/fishing.ts FISHING_BUDGET,
//     `li $v0, 0x10` at fieldstg file 0x488c); the map entry resets it.
//
// The two tables this joins:
//   * web/assets/data/fishing_spots.json — one record per stage: `spots[]`
//     (`stepIndex`, `dx`, `dy`) and `catch["4"]` / `catch["7"]` with the
//     `screenId` the strike hands to the battle setup;
//   * web/assets/data/field_encounters.json — `screens`, the party each battle
//     screen fights with (`[{ name, id, level, hp, mp, stat_scale }, ...]`);
//   * web/assets/data/progression.json — `battle_rewards`, an ARRAY indexed by
//     screen id, each record `[dvexp, exp, bits]`;
//   * web/assets/manifest.json — `maps`, the stage's own name.
//
// A screen the reward array does not reach is null ("unknown" on the page),
// never a made-up zero.

/** Catches per map visit — engine/systems/fishing.ts FISHING_BUDGET (16). */
export const CASTS_PER_VISIT = 16;

/** The two catch slots a fishing stage's scripted encounter block carries. */
const CARDMON_SLOT = "4";
const WATER_SLOT = "7";

/** A stage id → name lookup from manifest.maps (array or id → name object). */
function mapNameLookup(maps) {
    if (Array.isArray(maps)) {
        const byId = new Map();
        for (const map of maps) {
            if (map && map.id != null) byId.set(String(map.id), map.name ?? "");
        }
        return (id) => byId.get(String(id)) ?? "";
    }
    if (maps && typeof maps === "object") {
        return (id) => maps[String(id)] ?? "";
    }
    return () => "";
}

/**
 * One catch slot of a stage: `{ screen, species }`.
 *
 * `screen` is the battle screen id the strike starts (the stage's own scripted
 * encounter block), `species` the first party member's name from
 * field_encounters.screens. A slot the stage does not carry, or a screen the
 * encounters table does not know, leaves the missing half null.
 */
function catchAt(stageRecord, slot, screens) {
    const record = stageRecord?.catch?.[slot];
    if (!record || record.screenId == null) return { screen: null, species: null };
    const party = screens?.[String(record.screenId)];
    return { screen: record.screenId, species: party?.[0]?.name ?? null };
}

/**
 * One row per fishing stage, in stage order:
 * `{ stage, name, spots, budget, cardmon, water, reward }`.
 *
 * `spots` is the count of the stage's spot records (each one is a standable
 * tile with the float's own landing offset), `budget` the sixteen casts a
 * visit starts with, `cardmon` / `water` the two catches, and `reward` the
 * record the water catch's screen pays — the area's own number. The page shows
 * the Cardmon catch's record too, through rewardFor.
 */
export function almanac(fish, screens, rewards, maps) {
    const nameOf = mapNameLookup(maps);
    const stages = Object.keys(fish ?? {}).sort();
    return stages.map((stage) => {
        const record = fish[stage] ?? {};
        const cardmon = catchAt(record, CARDMON_SLOT, screens);
        const water = catchAt(record, WATER_SLOT, screens);
        return {
            stage,
            name: nameOf(stage) || stage,
            spots: Array.isArray(record.spots) ? record.spots.length : 0,
            budget: CASTS_PER_VISIT,
            cardmon,
            water,
            reward: rewardFor(rewards, water.screen),
        };
    });
}

/** The rows whose slot-4 catch is a Cardmon party (all 46 today). */
export function cardmonStages(rows) {
    return (rows ?? []).filter((row) => String(row?.cardmon?.species ?? "").includes("Cardmon"));
}

/**
 * The water Digimon index: one `{ species, stages }` row per distinct slot-7
 * species, by species name. Ten rows today; a species' stages are the stage
 * ids whose slot-7 catch resolves to it.
 */
export function waterIndex(rows) {
    const bySpecies = new Map();
    for (const row of rows ?? []) {
        const species = row?.water?.species;
        if (!species) continue;
        if (!bySpecies.has(species)) bySpecies.set(species, []);
        bySpecies.get(species).push(row.stage);
    }
    return [...bySpecies.keys()].sort().map((species) => ({ species, stages: bySpecies.get(species) }));
}

/**
 * Casts left this visit, clamped to 0..CASTS_PER_VISIT.
 *
 * The field line passes the live `state.fishingBudget` (or FISHING_BUDGET
 * before the first cast); a missing number means a fresh visit.
 */
export function castsLeft(budget) {
    const n = Number(budget);
    if (!Number.isFinite(n)) return CASTS_PER_VISIT;
    return Math.max(0, Math.min(CASTS_PER_VISIT, Math.floor(n)));
}

/**
 * The reward record a battle screen pays: `{ dvexp, exp, bits }`, or null when
 * `battle_rewards` has no record at that index. `battle_rewards` is an ARRAY
 * indexed by screen id, each record `[dvexp, exp, bits]`; an index past the
 * end (or no table at all) is unknown, never zero.
 */
export function rewardFor(rewards, screenId) {
    if (screenId == null) return null;
    const id = Number(screenId);
    if (!Number.isInteger(id) || id < 0) return null;
    const record = Array.isArray(rewards) ? rewards[id] : null;
    if (!Array.isArray(record) || record.length < 3) return null;
    return { dvexp: record[0], exp: record[1], bits: record[2] };
}
