// web/flag-store.js
//
// The banked-flag GATING ADAPTER — the tri-state get_flag layer the walker reads for NPC
// spawn-gating, chapter derivation, and the OnStep trigger VM. Extracted from the old
// story-vm.js (createFlagStore) when the legacy story stack was deleted; the STORAGE now
// lives in the headless TS engine (engine.state.flags, a FlagManager). This adapter is the
// thin glue between that boolean store and the walker's spawn-gate logic.
//
// Why a separate adapter and not the engine's FlagManager directly: the spawn-gate
// (engine npc-manager chapterNpcs) and the OnStep trigger-system both consume a
// TRI-STATE reader — `get(id) => 0 | 1 | null` — where `null` means UNMODELLED (party /
// currency / collection banks the walker doesn't simulate yet). A null matches NEITHER
// polarity, so a gate on an unmodelled flag stays dormant (never a false spawn) — the
// progression-frontier philosophy. The engine FlagManager is deliberately boolean
// (architecture.md §4.1); this layer re-introduces the null for the banks the walker can't
// yet decide, keeping behavior identical to the pre-engine walker.

// A get_flag/set_flag store over an injected STORED-BIT backend (the engine FlagManager
// adapter: { get(id)->0|1, set(id,val) }). `get(id)` returns the decoded CONDITION value:
//   • banks 0x00–0x40  → stored bit, delegated to the backend (engine FlagManager)
//   • bank 0x60        → progress-ordinal equality: (ordinal == id&0x1ff)
//   • bank 0x70 op0x30 → progress-ordinal range [lo,hi] (roster_predicate_table.json)
//   • banks 0x80–0x8e  → ITEM possession: (item (id&0x1ff) in bag) — via hasItem opt.
//     Faithful per npc-decode.md §talk-handler: possession IS a collection-bank flag, set by
//     the NPC on_close set_flag table. Without a hasItem callback these stay null (unmodelled).
//   • bank 0x92        → CARD possession: (copies of card (id&0x1ff) > 0) — via hasCard opt.
//     Corrected 2026-08-14: this bank is the CARD collection, not the item bag. The write
//     side routes to F0x80016314(cardId, value), give on non-zero and take on zero, and the
//     read side is the third call of the same API — the 'does the player own this card'
//     test. Answering it from the item bag matched a card id against an item id, which is
//     a different id space entirely.
//     — CARD-COLLECTION-ENTRY-POINTS-2026-08-14
//   • bank 0x7e        → ROUTE-PAIR predicate: one space over the two scalars the map
//     transition writes from step params[5]/[6] — index<0x1e tests key==index+1, index>=0x1e
//     tests companion==index-0x1d (F0x800160a8). Gates the 161 family-B maze NPCs.
//   • bank 0x72        → PARTY-CHARISMA threshold: (party total Charisma >= ladder[id&0x1ff])
//     — via partyCharisma opt. Wired 2026-08-14. Read-only: the bank has no set_flag arm, so
//     an extracted "set" of a 0x72xx id is inert. This is the gate a roaming card tamer checks
//     before agreeing to a duel (rung 0 = 60); while it was unmodelled the brush-off line won
//     every ladder and no wandering tamer would ever fight. See web/charisma.js.
//   • bank 0x70 case-7 → every OBTAINED roster slot's level >= 45 (0x7095) — via
//     ownedSlots + partnerLevels. The walker's per-slot levels come from the same
//     records the DRI resolves a slot with (web/dri-native.js slotStats). An owned
//     slot with no resolvable record keeps the gate dormant (null), never a guess.
//     This is the condition the walkthrough states as "all 8 partners at level
//     45+": it gates the post-game circuit-board cast (the Epic-Weapon forgers on
//     s970/s974 and the DDNA givers on s970/s971).
//   • command banks 0x74/76/78/7a/7c/90/94 → get_flag success for either polarity.
//     matches() preserves this distinction from stored-bit values; set() routes commands
//     through the optional host command callback and never stores them.
//   • everything else  → null = UNMODELLED (party/currency).
//     null is deliberately distinct from 0 so a gate on an unmodelled flag stays dormant for
//     BOTH polarities (never a false fire).
// opts: { getOrdinal:()=>number, rosterTable:{...}, hasItem:(bit)=>boolean,
//         hasCard:(cardId)=>boolean,
//         packIndex:()=>0|1|2|null, ownedSlots:()=>number,
//         partnerLevels:()=>Map<slot, level>,
//         routePair:()=>[key, companion] } (all optional).
// ownedSlots returns the obtained-partner bitmask (bit n = roster slot n obtained), the
// walker's model of the original's `roster_owned[slot] != 0` (see dw3-config ROSTER_OWNED_VAR).
import { partyCharismaMeets, routePairPredicate, isStoryCommandBank, flagConditionPasses, storyCommand, ordinalInRange } from "./vendor/engine.js";

const ITEM_BANKS = new Set([0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e]);
const CARD_BANK = 0x92;
const CHARISMA_BANK = 0x72;
export function createFlagStore(backend, opts = {}) {
  const {
    getOrdinal, rosterTable, hasItem, hasCard, packIndex, ownedSlots, routePair,
    partyCharisma, partnerLevels,
  } = opts;
  function get(id) {
    const bank = (id >> 8) & 0xfe;
    if (isStoryCommandBank(bank)) return 1; // get_flag fallthrough: success for either polarity
    if (bank <= 0x40) return backend.get(id) ? 1 : 0;               // stored bit (delegated)
    if (bank === CARD_BANK)                                         // card possession
      return hasCard ? (hasCard(id & 0x1ff) ? 1 : 0) : null;
    if (hasItem && ITEM_BANKS.has(bank))                            // item possession
      return hasItem(id & 0x1ff) ? 1 : 0;
    if (bank === 0x60) {                                            // ordinal equality
      return getOrdinal ? (getOrdinal() === (id & 0x1ff) ? 1 : 0) : null;
    }
    if (bank === 0x70) {                                            // table-dispatched predicate
      const rec = rosterTable && rosterTable[id & 0x1ff];
      if (rec && (rec.op & 0xf0) === 0x30 && getOrdinal) {         // op0x30 = ordinal range
        // `F0x80015b9c` — `lo <= ordinal <= hi`, both bounds inclusive, hi the literal
        // byte the disc stores. The seven records whose range has no end carry the byte
        // 0x63 = 99 (extract_roster_predicate_table.py writes null for hi >= 0x63), and
        // the disc compares it with no special case, so an open range ENDS AT 99 — it is
        // not unbounded. Shared with the engine's FlagManager (engine/dw3/dw3-config.ts)
        // so both consumers of the same bank resolve identically; reading null as
        // "missing bound" is the bug claim bank70-open-range-upper-bound-99-2026-10-02
        // closed on the engine side.
        return ordinalInRange(rec.ordinal_lo, rec.ordinal_hi, getOrdinal()) ? 1 : 0;
      }
      // Everything else dispatches on the extractor's decoded `semantics` (see
      // tools/extract_roster_predicate_table.py). A record with no semantics, or one whose
      // semantics need state the walker doesn't simulate (the 3-slot ACTIVE party, currency
      // compares, per-slot levels it has no record for), stays null = unmodelled/dormant.
      const sem = rec && rec.semantics;
      if (!sem) return null;
      switch (sem.kind) {
        // op0x10 case-0 (F0x80015754 case 0): get_flag(0x700N) = (DIGIMON_CUR_STATS[+0x1ED8] ==
        // param2). That global holds the chosen starter-pack selector (0/1/2); flags 0x7000/1/2
        // are the s212 download gate that picks the pack's variant. The walker's packIndex IS the
        // selector, so we resolve it faithfully. null (dormant) until a pack is chosen.
        case "pack_selector_equals": {
          if (!packIndex) return null;
          const sel = packIndex();
          return (sel == null || sel < 0) ? null : (sel === sem.value ? 1 : 0);
        }
        // op0x00 (F0x8001561c): an AND over bank-0x80 collection entries — the same parallel
        // arrays the possession banks read, so hasItem answers it exactly.
        case "collection_all":
          if (!hasItem) return null;
          return sem.collection_indices.every((i) => hasItem(i)) ? 1 : 0;
        // op0x10 cases 1/6/9 read only `roster_owned[slot] != 0`, which ownedSlots models.
        case "roster_owned":
          return ownedSlots ? ((ownedSlots() >> sem.slot) & 1 ? 1 : 0) : null;
        case "roster_not_owned":
          return ownedSlots ? ((ownedSlots() >> sem.slot) & 1 ? 0 : 1) : null;
        case "every_slot_owned":
          return ownedSlots ? (ownedSlots() === 0xff ? 1 : 0) : null;
        // op0x10 case 7 (F0x80015944): every OBTAINED slot's level >= 45 — the
        // walkthrough's "all 8 partners at level 45+". The disc skips unowned
        // slots with no level test at all (`lw 0x760($v1)` / `beqz` straight to
        // the next slot), so the predicate is vacuously TRUE with nothing
        // obtained, and it answers 0 the moment any owned slot is below the
        // floor. The walker keeps no record for a partner it never deployed, so
        // an owned slot whose level cannot be resolved leaves the gate DORMANT
        // (null) rather than inventing a level — never a false spawn.
        case "every_owned_at_level": {
          if (!ownedSlots || !partnerLevels) return null;
          const owned = ownedSlots();
          const levels = partnerLevels();
          for (let slot = 0; slot < (sem.slots ?? 8); slot++) {
            if (!((owned >> slot) & 1)) continue;
            const level = levels?.get ? levels.get(slot) : levels?.[slot];
            if (level == null) return null;
            if (Number(level) < sem.min_level) return 0;
          }
          return 1;
        }
        // op0x40 (F0x80015bd8): both subops are plain stored-bit reads (F0x80015590) on
        // banks 0x1c/0x10, which the backend already stores — so these resolve exactly.
        case "stored_bits_all_set":
          return sem.flag_ids.every((id) => backend.get(id)) ? 1 : 0;
        case "stored_bit_tally": {
          const set = sem.flag_ids.filter((id) => backend.get(id)).length;
          const clear = sem.flag_ids.length - set;
          if (sem.test === "set_count_at_least") return set >= sem.n ? 1 : 0;
          if (sem.test === "clear_count_at_least") return clear >= sem.n ? 1 : 0;
          if (sem.test === "clear_count_equals") return clear === sem.n ? 1 : 0;
          return null;
        }
        // op0x50 (F0x80015d4c) is an ACTION whose handler unconditionally returns 1, so as a
        // READ the gate is always true. The action itself is decoded (2026-07-27): the resident
        // type-0x16 object is the player's FIELDCOM sparkle actor and `+0x2c` is the shared
        // allocator's setSub1, so `[obj+0x2c](obj,3)` = "run acquisition flourish program 3 +
        // ITEM_GET". The walker plays it from the engine's PlaySparkle(3) presentation command
        // (see web/fieldcom.js drawSparkleActor); this read path stays a pure predicate.
        // See docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md.
        case "object_action":
          return 1;
        default:
          return null;   // writes (grant_partner/heal_active_party) and unmodelled reads
      }
    }
    if (bank === 0x7e && routePair) {                               // ROUTE-PAIR predicate
      // F0x800160a8 (exe/fns.s L6679-6700), reached from the bank getter F0x800163b0
      // for bank 0x7E — the address the shipped image holds at [0x80048ACC]. One
      // predicate space over TWO scalars: index < 0x1e tests [0x80048D78] == index + 1,
      // index >= 0x1e tests [0x80048D7A] == index - 0x1d. The arithmetic and the band
      // split live in engine/systems/route-pair.ts (the port), with both writer sites
      // and the bank map; this adapter only supplies the two scalars and applies the
      // caller's expectation. The shipped bank-0x7E ids are exactly 0x7E00-0x7E25 =
      // indices 0..37, i.e. 30 key slots + 8 companion slots, with no id outside that
      // range. Ledger: encounter-companion-scalar-is-second-route-coordinate.
      const [key, companion] = routePair();
      return routePairPredicate(id, { key, companion });
    }
    if (bank === CHARISMA_BANK && partyCharisma) {                  // PARTY-CHARISMA threshold
      // F0x80015FBC: sum the three deployed positions' effective Charisma and compare
      // against the 15-word ladder D0x80048CF8 (60,150,210,...,2472). The flag's low bits
      // choose the rung. Read-only — bank 0x72 has no arm in the set_flag dispatcher, so a
      // "set" of a 0x72xx id is inert and must never be stored.
      // This is what a roaming card tamer checks before agreeing to duel: rung 0 (>= 60).
      // Ledger: charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate.
      const total = partyCharisma();
      if (total == null) return null;                               // unknown => still dormant
      return partyCharismaMeets(total, id & 0x1ff) ? 1 : 0;
    }
    return null;                                                   // 0x80/0x92: unmodelled
  }
  return {
    get,
    matches: (id, expected) => flagConditionPasses(get, id, expected),
    set: (id, val) => {
      if (isStoryCommandBank((id >>> 8) & 0xfe)) {
        const command = storyCommand(id);
        if (command) opts.command?.(command);
        return;
      }
      backend.set(id, val);
    },
    raw: backend,
  };
}
