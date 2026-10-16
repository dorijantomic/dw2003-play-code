// Browser save state <-> resident data fields read and written by the translated
// merchant tasks. This is an adapter, not a game rule interpreter.
import { MAX_ROSTER_SLOTS } from "../roster.ts";
import type { NativeMemory } from "../../native/memory.ts";
import { syncWornFromEquipment, wornCount, wornItemIds, type ItemStoreState } from "../item-store.ts";
import {
  PARTY_MAP, ROSTER_RECORDS, ROSTER_STRIDE, ROSTER_EQUIP_ENTRIES,
  type RosterEquipment, rosterRecordAddress
} from "../party-context.ts";

export const SHOP_MONEY = 0x80048da0;
export const SHOP_HELD_BASE = 0x80048db0;
/**
 * The save block's SECOND count array: how many of each item are WORN
 * (`D0x80048D34 + 0x20F + id`). Two screens read it and one writes it:
 *
 *  * the merchant's info band reads it for the "Equip n" figure under the list
 *    (`stitshop.s:7310`, RAM 0x80089ECC, `lb $a2, 0x20f($v0)`), so the seed has to
 *    carry it or a piece on a partner's hand reads 0 — including gear a
 *    switched-out partner is wearing, which is why it is handed over as the
 *    store's own array rather than counted from the three deployed members;
 *  * the merchant's hand swap writes it, beside the carried array, in
 *    `shopBlockEquip` / `shopBlockUnequip` above.
 *
 * It is NOT how the SELL shelf admits a piece. That shelf asks the resident
 * provider for the table's first four words at `stitshop` 0x8008CAA8 — 1, 2, 3, 4,
 * every one POSITIVE — because the SELL category cursor is clamped to 0..3
 * (`shop-sell-machine.ts`), and a positive kind never consults the worn byte
 * (`exe/f3.s`: `beqz $t0, .Lloop_cond` skips the `lb 0x20f` load). A piece only on
 * a partner's hand is therefore not for sale.
 */
export const SHOP_WORN_BASE = 0x80048f43;
export const SHOP_ITEM_MAX_ID = 402;
export const SHOP_BIT_CAP = 9999999;

/**
 * The merchant's hand swap moving ONE copy off a hand — the shared store's
 * unequip move, written into the block copy the merchant owns.
 *
 * This is `stitshop` F0x8008C800's unequip arm, `worn -= 1; held += 1`, as three
 * separate sites in that one routine, each four instructions:
 *
 *  * the piece in the chosen slot — `stitshop.s:9975-9980`
 *    (RAM `0x8008C8C0` worn load, `0x8008C8C4` held load, `0x8008C8D0` worn
 *    store, `0x8008C8D4` held store; the slot's halfword is cleared at
 *    `stitshop.s:9995`, RAM `0x8008C8E0`);
 *  * the two accessory slots whose class byte `+3` matches the new piece —
 *    `stitshop.s:10024-10034` (RAM `0x8008C934`/`0x8008C940`, `0x8008C95C`) and
 *    the second iteration `stitshop.s:10063-10073` (RAM `0x8008C9D0`/
 *    `0x8008C9DC`, `0x8008C9F8`).
 *
 * The bytes are raw: `addiu -1` / `addiu +1` then `sb`, with no floor and no
 * cap, which is why a copy coming off a hand at 99 held reaches 100 here exactly
 * as it does in the original (tests/shop-equip-swap-oracle.test.js). ststatus's
 * own unequip move (RAM `0x8009A518` / `0x8009A534`) is the same pair.
 */
export function shopBlockUnequip(mem: NativeMemory, id: number): void {
  mem.write8(SHOP_WORN_BASE + id, (mem.read8(SHOP_WORN_BASE + id) - 1) & 0xff);
  mem.write8(SHOP_HELD_BASE + id, (mem.read8(SHOP_HELD_BASE + id) + 1) & 0xff);
}

/**
 * The same move the other way: the shared store's equip move, `worn += 1;
 * held -= 1`. `stitshop` F0x8008C800's equip arm, `stitshop.s:10083-10088`
 * (RAM `0x8008CA20` worn load, `0x8008CA24` held load, `0x8008CA30` worn store,
 * `0x8008CA34` held store, gated on the transfer flag at `0x8008CA10`), and
 * ststatus's own equip move (RAM `0x8009A5FC` / `0x8009A600`).
 */
export function shopBlockEquip(mem: NativeMemory, id: number): void {
  mem.write8(SHOP_WORN_BASE + id, (mem.read8(SHOP_WORN_BASE + id) + 1) & 0xff);
  mem.write8(SHOP_HELD_BASE + id, (mem.read8(SHOP_HELD_BASE + id) - 1) & 0xff);
}

/**
 * The merchant's own view of a member's six equip halfwords. The original's
 * offsets live once, in `party-context` — the merchant and the pause EQUIP page
 * are the SAME twelve bytes of the SAME record, so neither screen may keep a
 * private copy of the numbers (see `ROSTER_EQUIP_OFFSETS`).
 */
export type ShopEquipment = RosterEquipment;

export interface ShopPartyMemberSeed {
  rosterSlot: number;
  starterSlot?: number;
  equipment?: ShopEquipment;
  exp?: number;
  level?: number;
  tp?: number;
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  core?: readonly number[];
  elements?: readonly number[];
  nameBytes?: Uint8Array;
}

export interface ShopSaveSeed {
  bits: number;
  inventory: readonly { id: number; qty: number }[];
  /**
   * WORN counts by item id — the shared store's stored worn byte
   * (`base + 0x20F + id`). Optional: without it the worn bytes are counted from
   * the supplied members' equipment through the shared item-store tally. A
   * two-handed piece counts once despite occupying both hands (stitshop
   * 0x8008CA20..0x8008CA34). The stored array takes precedence when supplied,
   * because it also carries switched-out partners' gear.
   */
  worn?: readonly { id: number; qty: number }[];
  party: readonly ShopPartyMemberSeed[];
}

export interface ShopSaveResult {
  bits: number;
  inventory: Array<{ id: number; qty: number }>;
  equipment: ShopEquipment[];
  swaps: ShopEquipSwap[];
}

/** One merchant HAND SWAP the screen performed, as F0x8008C800 made it. */
export interface ShopEquipSwap {
  /** Party position 0..2 — the member the piece went onto. */
  party: number;
  /** The piece that went on. */
  itemId: number;
  /** That member's whole six-slot map afterwards, as the block holds it. */
  equipment: ShopEquipment;
  /** Every item that came off a hand, one entry per copy. */
  displaced: number[];
}

const recordAt = (slot: number): number => rosterRecordAddress(slot);
const integer = (value: number, lo: number, hi: number, label: string): number => {
  if (!Number.isInteger(value) || value < lo || value > hi) throw new Error(`Invalid ${label}`);
  return value;
};

export function seedShopSaveState(mem: NativeMemory, seed: ShopSaveSeed): void {
  mem.write32(SHOP_MONEY, integer(seed.bits, 0, SHOP_BIT_CAP, "shop BIT"));
  for (let id = 1; id <= SHOP_ITEM_MAX_ID; id++) {
    mem.write8(SHOP_HELD_BASE + id, 0);
    mem.write8(SHOP_WORN_BASE + id, 0);
  }
  for (const row of seed.worn ?? []) {
    const id = integer(row.id, 1, SHOP_ITEM_MAX_ID, "shop worn item ID");
    mem.write8(SHOP_WORN_BASE + id, integer(row.qty, 0, 255, "shop worn item count"));
  }
  const seenItems = new Set<number>();
  for (const row of seed.inventory) {
    const id = integer(row.id, 1, SHOP_ITEM_MAX_ID, "shop item ID");
    if (seenItems.has(id)) throw new Error(`Duplicate shop item ${id}`);
    seenItems.add(id);
    mem.write8(SHOP_HELD_BASE + id, integer(row.qty, 0, 255, "shop item count"));
  }
  if (seed.party.length > 3) throw new Error("Shop party exceeds three positions");
  const seenSlots = new Set<number>();
  for (let position = 0; position < 3; position++) {
    const member = seed.party[position];
    if (!member) {
      mem.write32(PARTY_MAP + position * 4, 0xffffffff);
      continue;
    }
    const slot = integer(member.rosterSlot, 0, MAX_ROSTER_SLOTS - 1, "shop roster slot");
    if (seenSlots.has(slot)) throw new Error(`Duplicate shop roster slot ${slot}`);
    seenSlots.add(slot);
    mem.write32(PARTY_MAP + position * 4, slot);
    const base = recordAt(slot);
    mem.write32(base, integer(member.starterSlot ?? slot, 0, MAX_ROSTER_SLOTS - 1, "shop starter slot") + 3);
    const word = (off: number, value: number | undefined, label: string): void => {
      if (value !== undefined) mem.write16(base + off, integer(value, 0, 0xffff, label));
    };
    if (member.exp !== undefined) mem.write32(base + 0x20, integer(member.exp, 0, 0xffffffff, "shop EXP"));
    for (const [off, value, name] of [
      [0x24, member.level, "level"], [0x26, member.tp, "TP"],
      [0x28, member.hp, "HP"], [0x2a, member.maxHp, "max HP"],
      [0x2c, member.mp, "MP"], [0x2e, member.maxMp, "max MP"],
    ] as const) word(off, value, name);
    if (member.core && member.core.length !== 6) throw new Error("Shop core stats need six values");
    if (member.elements && member.elements.length !== 7) throw new Error("Shop elements need seven values");
    member.core?.forEach((value, index) => word(0x30 + index * 2, value, "core stat"));
    member.elements?.forEach((value, index) => word(0x3c + index * 2, value, "element stat"));
    if (member.nameBytes) {
      if (member.nameBytes.length > 23 || member.nameBytes.includes(0)) throw new Error("Invalid shop name bytes");
      mem.load(member.nameBytes, base + 8);
      mem.write8(base + 8 + member.nameBytes.length, 0);
    }
    for (const [name, off] of ROSTER_EQUIP_ENTRIES) {
      const id = member.equipment?.[name as keyof ShopEquipment] ?? 0;
      mem.write16(base + off, integer(id, 0, 0xffff, "shop equipment"));
    }
  }
  // A caller without the stored array uses the shared store's migration tally:
  // a two-handed piece is one worn copy, even though both halfwords name it.
  // Explicit stored counts remain authoritative, including reserve partners.
  if (!seed.worn) {
    const fallback: ItemStoreState = {
      inventory: [], equipment: (seed.party ?? []).map((member) => member.equipment ?? {}),
    };
    syncWornFromEquipment(fallback);
    for (const id of wornItemIds(fallback)) mem.write8(SHOP_WORN_BASE + id, wornCount(fallback, id));
  }
}

export function readShopSaveState(
  mem: NativeMemory, swaps: readonly ShopEquipSwap[] = [],
): ShopSaveResult {
  const bits = mem.read32(SHOP_MONEY) >>> 0;
  if (bits > SHOP_BIT_CAP) throw new Error("Merchant wrote BIT above the save cap");
  const inventory: ShopSaveResult["inventory"] = [];
  for (let id = 1; id <= SHOP_ITEM_MAX_ID; id++) {
    const qty = mem.read8(SHOP_HELD_BASE + id);
    if (qty > 0) inventory.push({ id, qty });
  }
  const equipment: ShopEquipment[] = [];
  for (let position = 0; position < 3; position++) {
    const slot = mem.read32(PARTY_MAP + position * 4) | 0;
    if (slot < 0 || slot >= MAX_ROSTER_SLOTS) continue;
    const equipped: ShopEquipment = {};
    const base = recordAt(slot);
    for (const [name, off] of ROSTER_EQUIP_ENTRIES) {
      const id = mem.read16(base + off);
      if (id) equipped[name as keyof ShopEquipment] = id;
    }
    equipment[position] = equipped;
  }
  return { bits, inventory, equipment, swaps: [...swaps] };
}
