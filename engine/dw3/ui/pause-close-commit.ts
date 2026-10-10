// What the walker's own state keeps when a PAUSE page closes, in the original's order:
// the record's writes and the wear changes first, the bag the page's own count arrays
// hold LAST.
//
// There are two pause routes -- the translated pages (web/status-translated.js, whose
// logic is engine/dw3/ui) and the original-code reference page
// (web/status-native.js, which runs pro/ststatus through engine/native) -- and they
// are ONE system of the original: the same pro/ststatus pages, seeded from the same
// save block and read back once when the page folds away. Before this module each
// adapter carried its own copy of that read-back, so the ORDER below was knowledge
// held twice and the two copies had already drifted once (commit bf46c4dc had to put
// the bag last in both). What differs between the routes is only where the numbers
// come from, and that is what a caller supplies:
//
//   * `recordAt(rosterSlot)` -- the page's own view of one roster record. The
//     translated route hands over `session.snapshot().records[slot]`; the reference
//     route reads the record out of the save block the original wrote
//     (0x80048D34 + 0x760 + slot*0x3DC = 0x80049494 + slot*0x3DC).
//   * `inventory` -- the WHOLE held-count array the page now holds. The original has
//     no per-item bag structure: it is 402 bytes at `base + 0x7C + id`
//     (docs/research/items/item-store-shared-system-2026-10-03.md §1).
//   * `partyMap` -- the three u32 roster slots at `base + 0x70` (0xFFFFFFFF = an empty
//     pedestal), which is the SORT page's whole output.
//
// Everything else -- the clamp, the permutation, the stat fold, the worn-slot diff,
// the lead's bonus refresh, the persisted keys and the bag -- is this routine, so both
// routes cannot disagree about it again.
//
// WHY THE BAG IS COMMITTED LAST. The pause page's equip apply (pro/ststatus
// F0x8009A3E8, file 0x17738, and the unequip arm beside it at 0x17788) moves ONE count
// between the worn byte and the held byte IN THE PAGE'S OWN ARRAYS: `worn -= 1; bag += 1`
// on the displace arm, `worn += 1; bag -= 1` on the equip arm. So the held array handed
// back already carries that move, and the store's `wearOne`/`unwearOne` make the same
// move again on the walker. Committing the bag first applied it twice: a sword taken off
// in See Equipment left the bag holding two of them (tests/pause-commit-bag-order.test.js
// keeps the failing order as a case). The merchant's close commit states the same rule
// for the same reason (engine/dw3/ui/shop-close-commit.ts).
import { foldRecordStatsIntoBonuses, type StatCarrier } from "../party-context.ts";
import { reconcileHeldCounts, setEquippedItem, type ItemStoreState } from "../item-store.ts";
import { ROSTER_SLOT_COUNT, rosterSlotOfCharId } from "../roster.ts";
import { EQUIP_SLOTS, syncLeadEquipBonuses, type EquipmentSlots } from "../equipment.ts";

/** The money ceiling the extracted bounds report (9,999,999; extract_bounds). */
export const PAUSE_MONEY_CAP = 0x98967f;

/** The subset of `localStorage` this routine writes; null where there is none (node). */
export interface PauseCloseStorage {
  setItem(key: string, value: string): void;
}

/** One roster record as the page now holds it, in the walker's own field names. */
export interface PauseCloseRecord {
  /** The record's form word; 0 means the page never changed it. */
  formValue?: number | null;
  level?: number | null;
  tp?: number | null;
  hp?: number | null;
  mp?: number | null;
  exp?: number | null;
  maxHp?: number | null;
  maxMp?: number | null;
  core?: ArrayLike<unknown> | null;
  elements?: ArrayLike<unknown> | null;
  /** The six worn slots by name: head, body, right, left, acc0, acc1. */
  equipment?: EquipmentSlots | null;
}

/** The live card collection the Card Album / folder editor browse (commit-contract §4). */
export interface PauseCloseCards {
  owned: Map<number, number>;
  seen: Set<number>;
}

/** The walker's state, as much of it as a pause page can write to. */
export interface PauseCloseState extends ItemStoreState {
  bits?: number;
  party?: (string | null)[] | null;
  partyStats?: (Record<string, unknown> | null)[] | null;
  partnerStats?: Record<string, unknown> | null;
  manifest?: { characters?: { id: string; digimonId?: number }[] } | null;
}

export interface PauseCloseInput {
  state: PauseCloseState;
  /** The BIT box's figure, clamped here. */
  money?: number | null;
  /** Every id the page lists, with the count it shows. */
  inventory?: Iterable<{ id: number; qty: number }> | null;
  /** The three u32 roster slots the page now holds (0xFFFFFFFF = an empty pedestal). */
  partyMap?: ArrayLike<number> | null;
  /** The page's own view of one roster record, or null when it has none. */
  recordAt?: ((rosterSlot: number) => PauseCloseRecord | null | undefined) | null;
  /** Per roster slot, the seven element values the page OPENED with (species base +
   *  elemBonuses): the record's element block carries the base, so the fold in
   *  {@link foldRecordStatsIntoBonuses} cannot measure a chip's rise without them. */
  openedElements?: (ArrayLike<unknown> | null | undefined)[] | null;
  /** The page's form value -> digimon.json id, from the form list it was built with.
   *  A FUNCTION, not a table: a route whose roster is empty never needs it, and the
   *  native one only builds it when it reads a record. */
  formId?: ((formValue: number) => number | undefined) | null;
  /** The card arrays the page now holds, and the live collection to write them into.
   *  Supplied only by a route that seeded the card arrays before the page opened. */
  cards?: { owned: Map<number, number>; seen: Set<number>; live: PauseCloseCards } | null;
  storage?: PauseCloseStorage | null;
  moneyCap?: number;
}

export interface PauseCloseResult {
  /** True when the six worn slots of any member differ from what the walker held. */
  gearChanged: boolean;
  /** The pedestals the SORT page moved, as [pedestal, rosterSlot] pairs. */
  formation: [number, number][];
}

/**
 * Apply one closed pause page to the walker's state, once. Both pause routes call this
 * and nothing else, so the order above cannot drift apart again.
 */
export function commitPauseClose(input: PauseCloseInput): PauseCloseResult {
  const state = input.state;
  const result: PauseCloseResult = { gearChanged: false, formation: [] };
  if (!state) return result;
  const storage = input.storage ?? null;
  const cap = input.moneyCap ?? PAUSE_MONEY_CAP;
  state.bits = Math.max(0, Math.min(cap, Number(input.money) || 0));

  // The bag is committed LAST (see the header). This closure is its only call site, so
  // the order is a property of where it is invoked rather than of a comment.
  const commitBag = () => {
    reconcileHeldCounts(state, input.inventory ?? []);
    storage?.setItem("inventory", JSON.stringify(state.inventory));
  };

  // The card arrays the album and the folder editor write. They round-trip exactly
  // because the page was seeded with the walker's own collection before it opened, and
  // they are only applied when the seed really put cards in RAM: a collection that
  // appeared after the page opened (the boot starter-deck fetch) must not be wiped by
  // an empty read-back.
  if (input.cards) {
    const { owned, seen, live } = input.cards;
    live.owned.clear();
    for (const [id, n] of owned) live.owned.set(id, n);
    live.seen.clear();
    for (const id of seen) live.seen.add(id);
  }

  const roster = Array.isArray(state.partyStats) ? state.partyStats : [];
  if (!roster.length) {
    commitBag();
    return result;
  }
  // A reordered party is permuted BEFORE the roster fields are written into the new
  // pedestals, and the stat fields are then read from the roster slot each pedestal
  // names rather than from the pedestal's own index.
  const party = Array.isArray(state.party) ? state.party : [];
  // Each pedestal's ROSTER SLOT, as the page now holds it (the SORT page's whole
  // output). The map names members by identity, not by pedestal: ctx+0x70 holds the
  // roster slot the picture row and the stats producer resolve by.
  const slots: number[] = [0, 1, 2].map((i) => {
    const raw = input.partyMap?.[i];
    return (raw === undefined || raw === null ? 0xffffffff : Number(raw)) >>> 0;
  });
  // The roster slot each pedestal held when the page OPENED — the walker's own party
  // names it. A SORT swap shows up as a change here, never as `slots[i] !== i`: a
  // party is free to sit at any slots, so the pedestal index is not an identity.
  const before: number[] = [0, 1, 2].map((i) => {
    const id = rosterSlotOfCharId(party[i] as string);
    return id === null ? i : id;
  });
  const seen = new Set<number>();
  const owned = new Set(before);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] as number;
    // A valid map is a permutation of the party's own roster slots: no empty pedestal
    // (0xFFFFFFFF), no slot outside the eight, no slot the party does not hold, and no
    // slot claimed twice. The old `s >= roster.length` bound read the map as pedestal
    // indices and would reject a real slot like 7.
    if (s === 0xffffffff || s >= ROSTER_SLOT_COUNT || !owned.has(s) || seen.has(s)) {
      result.formation.length = 0;
      break;
    }
    seen.add(s);
    result.formation.push([i, s]);
  }
  const moves = result.formation;
  const moved = moves.length === 3 && [0, 1, 2].some((i) => before[i] !== (moves[i] as [number, number])[1]);
  if (moved) {
    const orderParty = party.slice();
    const orderStats = roster.slice();
    for (let i = 0; i < 3; i++) { orderParty[i] = null; orderStats[i] = null; }
    for (const [i, s] of moves) {
      // The pedestal whose member carries roster slot `s` is the one `before` names.
      let src = before.indexOf(s);
      if (src < 0) src = s < party.length ? s : i;
      orderParty[i] = party[src] ?? null;
      orderStats[i] = roster[src] ?? null;
    }
    state.party = orderParty;
    state.partyStats = orderStats;
    if (orderStats[0]) state.partnerStats = orderStats[0];
  }
  const rows = Array.isArray(state.partyStats) ? state.partyStats : [];
  // Where each pedestal's record lives: the roster slot it now names, or — with no
  // applied permutation — the slot it held when the page opened.
  const src = [0, 1, 2].map((i) => before[i] as number);
  if (moves.length) for (const [i, s] of moves) src[i] = s;
  for (let slot = 0; slot < rows.length && slot < 3; slot++) {
    const rec = rows[slot] as Record<string, unknown>;
    if (!rec) continue;
    const rosterSlot = src[slot] ?? slot;
    const record = input.recordAt?.(rosterSlot) ?? null;
    if (!record) continue;
    const current = Number(record.formValue) || 0;
    rec.digimonId = current === 0
      ? (rosterSlotOfCharId(state.party?.[slot] as string) ?? rosterSlot) + 1
      : input.formId?.(current) ?? rec.digimonId;
    rec.level = Number(record.level) || 0;
    rec.tp = Number(record.tp) || 0;
    rec.hp = Number(record.hp) || 0;
    rec.mp = Number(record.mp) || 0;
    rec.xp = Number(record.exp) || 0;
    // Fold every group the applier can raise into the walker's own stat fields BEFORE
    // the copy, because the fold measures the rise against the values the page opened
    // with and `rec` still holds those.
    foldRecordStatsIntoBonuses(rec as StatCarrier, record, {
      elements: input.openedElements?.[rosterSlot] ?? null,
    });
    rec.maxHp = Number(record.maxHp) || 0;
    rec.maxMp = Number(record.maxMp) || 0;
    rec.core = record.core;
    rec.elements = record.elements;
    // Worn gear: the six halfwords the See Equipment window swaps (F0x8009A3E8).
    // `setEquippedItem` moves the worn byte with the halfword, so the stored count and
    // the wearer record cannot disagree.
    for (const name of EQUIP_SLOTS) {
      const id = Number(record.equipment?.[name]) || 0;
      const eq = (Array.isArray(state.equipment) ? state.equipment : undefined)?.[slot] as
        EquipmentSlots | undefined;
      if ((Number(eq?.[name]) || 0) !== (id > 0 ? id : 0)) result.gearChanged = true;
      setEquippedItem(state, slot, name, id);
    }
  }
  if (result.gearChanged) {
    // Keep the lead's cached bonus block and the persisted keys honest, exactly as the
    // walker's own equip paths do (web/menu.js, web/shop.js).
    syncLeadEquipBonuses(state, storage);
    storage?.setItem("equipment", JSON.stringify(state.equipment));
    storage?.setItem("worn", JSON.stringify(state.worn ?? {}));
  }
  if (rows[0]) {
    state.partnerStats = rows[0] as Record<string, unknown>;
    const lead = state.manifest?.characters?.find((c) => c.id === state.party?.[0]);
    if (lead) lead.digimonId = (rows[0] as Record<string, unknown>).digimonId as number;
  }
  storage?.setItem("partyStats", JSON.stringify(state.partyStats));
  storage?.setItem("partnerStats", JSON.stringify(state.partnerStats));
  commitBag();
  return result;
}