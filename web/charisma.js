// web/charisma.js — the party's total Charisma, the quantity flag bank 0x72 asks about.
//
// Bank 0x72 stores nothing. `get_flag(0x7200 + n)` routes to F0x80015FBC, which walks the
// three deployed party positions, sums each one's effective Charisma, and answers
// "is that total at least ladder[n]?" against the 15-word table at D0x80048CF8.
// — ledger charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate
//
// It is the gate a roaming card tamer checks before agreeing to duel you: every tamer's
// dialogue ladder has a brush-off line gated on the bank-0x72 flag being unmet and a
// challenge line gated on it being met. Until this module existed the walker returned
// "unmodelled" for the bank, the brush-off line always won, and 286 of the game's 351
// duel launchers could never fire.
// — CARDNPC-TWO-DECKS-ARE-CHALLENGE-AND-REMATCH-2026-08-14,
//   docs/research/ui/card-folder-editor-2026-08-14.md §10
//
// The sum itself lives in the engine (partyCharismaTotal); this module only assembles the
// walker's party into the shape it takes.
import { partyCharismaTotal, scaledStat, equipmentBonuses } from "./vendor/engine.js";
import { partyRosterView, CHARID_TO_DIGID } from "./party.js";

let DB = null;
let dbPromise = null;

/** digimon.json, keyed by id. The menu keeps its own copy; this is a second small fetch
 *  rather than a cross-import, because the flag store is created before the menu is. */
export function loadCharismaDb() {
  if (dbPromise) return dbPromise;
  dbPromise = fetch("assets/data/digimon.json")
    .then((r) => r.json())
    .then((j) => { DB = Object.fromEntries(j.digimon.map((d) => [d.id, d])); return DB; })
    .catch(() => null);
  return dbPromise;
}

export function charismaDbReady() { return !!DB; }

/**
 * One deployed position as partyCharismaTotal wants it, from a roster-view entry and
 * that position's equipment. Pure, so the composition is testable without a document.
 *
 * `charisma` is the member's EFFECTIVE stored Charisma: its stored current stat plus the
 * permanent stat-item bonus the chips write (`bonuses.chr`) — the same sum battle.js's
 * partnerInfo draws on the status screen. Without stored stats it stays undefined and the
 * engine scales the species profile to the member's level.
 *
 * `buffCharisma` is the walker's EQUIPMENT figure — Charisma Gem +20, Charisma Ring +30 —
 * and it is a STATED ASSUMPTION, not a decoded value. The native folds a per-item modifier
 * into each member's Charisma before the 999 clamp, but the table it reads the amount from
 * is not decoded (see CharismaMember.buffCharisma). The walker has its own equipment model,
 * so it supplies its own numbers; the ARITHMETIC (add, then clamp each member at 999, then
 * sum three positions) is the decoded part.
 *
 * Equipment is read from `state.equipment[i]` for all three positions rather than from
 * `partnerStats.equipBonuses`, because the menu only syncs that cached block for the lead.
 */
export function charismaMemberFor(entry, slots) {
  const stored = entry?.stats?.chr;
  const chip = entry?.bonuses?.chr ?? 0;
  return {
    profile: entry?.profile,
    level: entry?.level,
    charisma: stored != null ? stored + chip : undefined,
    // With no stored stat the chip rides in here instead, which is the same number:
    // both are added before the one 999 clamp, so it cannot change the result.
    buffCharisma: (equipmentBonuses(slots ?? {}).chr ?? 0)
      + (stored != null ? 0 : chip),
  };
}

/**
 * The party's effective total Charisma, or null when it cannot be computed yet.
 *
 * null is not zero: an unknown total leaves every bank-0x72 gate dormant, which is the
 * walker's standing rule for a predicate it cannot answer. Returning 0 would actively
 * assert "below every threshold" and make tamers refuse for the wrong reason.
 */
export function partyCharismaFrom(view, equipment) {
  if (!view?.length) return null;
  return partyCharismaTotal(view.map((m, i) => charismaMemberFor(m, equipment?.[i])));
}

export function partyCharisma(state) {
  if (!DB || !state?.party?.length) return null;
  const view = partyRosterView(
    state.party, state.partnerStats, state.partyStats, DB, state.digimonNames,
  );
  return partyCharismaFrom(view, state.equipment);
}

/** The Charisma one member contributes, for the status screen / a diagnostic read-out. */
export function memberCharisma(entry, slots) {
  const m = charismaMemberFor(entry, slots);
  const own = m.charisma ?? (m.profile ? scaledStat(m.profile, "chr", m.level ?? 1) : null);
  return own == null ? null : Math.min(999, own + (m.buffCharisma ?? 0));
}

export { CHARID_TO_DIGID };
