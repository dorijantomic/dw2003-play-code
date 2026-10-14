// engine/dw3/items.ts
// DW3 item data (ItemId enum + Unknown2 struct) + the field use path. Ported from
// web/items.js. The headless port mutates the passed `state`; PERSISTENCE (localStorage in
// the JS original) is the host's responsibility — dropped here to keep the module pure.

import { EQUIPMENT } from "./equipment.ts";
import { ITEM_NAMES, ITEM_DESCS } from "./item-names.ts";
import { ITEM_DATA } from "./item-data.ts";
import { addItem, removeItem } from "./item-store.ts";
import {
    applyFieldItemEffect, fieldItemMessageId, IDX_CORE_BASE, IDX_ELEMENT_BASE, IDX_HP,
    IDX_MAX_HP, IDX_MAX_MP, IDX_TP, MESSAGE_NO_EFFECT, type FieldItemTarget,
} from "./item-effect.ts";
import { ELEMENT_KEYS, type ElementSources } from "./effective-stats.ts";
import { RECORD_CORE_STATS } from "./party-context.ts";

export interface Item {
  id: number;
  name: string;
  effect: string;
  value: number;
  price: number;
  sell: number;
  desc: string;
  /** Effect record byte +0; bit 0 = the original offers this item in the field. */
  itemClass: number;
  /** Effect record byte +1: the code the field applier dispatches on. */
  selector: number;
}

export interface InvSlot { id: number; qty: number; }

export interface PartnerStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  tp?: number;
  /** The species base, which the chips never move. */
  stats?: Record<string, number>;
  bonuses?: Record<string, number>;
  elemBonuses?: Record<string, number>;
}

export interface ItemState {
  inventory: InvSlot[];
  partnerStats: PartnerStats;
}

// Decoded consumable/booster records (item-data.ts, GENERATED from the master item
// table D0x80041844 + consumable-effect table D0x8005cb54 — see
// docs/research/ui/item-system-decoded-2026-07-10.md). Charges restore 500/2000/
// 5000/9999 HP, chips are +30 HP/MP / +10 stats/resists, TrainChips grant TP, and
// disks/plugs/throwables are battle-only.
export const ITEMS: Item[] = ITEM_DATA.map(d => ({ ...d, desc: "" }));

// Real weapon/armor/accessory catalog (equipment.ts) merged in so the inventory list
// and shop can show equip-drops by their real name/price instead of "Item {id}" — these
// are equipped via equipItem()/the status menu, never useItem()'d.
const EQUIPMENT_AS_ITEMS: Item[] = EQUIPMENT.map(e => ({
  id: e.id, name: e.name, effect: "equipment", value: 0, price: e.buyPrice,
  sell: e.sellPrice, itemClass: 0, selector: 0,
  // No stat words here: the real description comes from esitminf below, and the
  // item's displayed stat movement is the shop rule in equipment.ts
  // (`gearStatContributions`), not a single "power"/"defense" field.
  desc: `Equip in ${e.slot}.`,
}));

// Every item gets its REAL display name/description (lang_file esitmnam/esitminf,
// generated item-names.ts) — the hand-written names above are decomp enum
// identifiers ("PowerCharge"), not what the game renders ("Power Charge").
// Ids with no effect entry still appear, as inert-but-named items, so no screen
// ever falls back to "Item {id}".
const WITH_REAL_NAMES: Item[] = [...ITEMS, ...EQUIPMENT_AS_ITEMS].map(i => ({
  ...i,
  name: ITEM_NAMES[i.id] ?? i.name,
  desc: ITEM_DESCS[i.id] ?? i.desc,
}));
const COVERED = new Set(WITH_REAL_NAMES.map(i => i.id));
const NAME_ONLY_ITEMS: Item[] = Object.entries(ITEM_NAMES)
  .filter(([id]) => !COVERED.has(Number(id)))
  .map(([id, name]) => ({
    id: Number(id), name, effect: "none", value: 0, price: 0, sell: 0,
    itemClass: 0, selector: 0,
    desc: ITEM_DESCS[Number(id)] ?? "",
  }));

export const ITEM_BY_ID: Record<number, Item> = Object.fromEntries(
  [...WITH_REAL_NAMES, ...NAME_ONLY_ITEMS].map(i => [i.id, i]),
);
export const ITEM_BY_NAME: Record<string, Item> = Object.fromEntries(
  [...WITH_REAL_NAMES, ...NAME_ONLY_ITEMS].map(i => [i.name, i]),
);

/**
 * Add qty of item id to inventory. (Host persists.)
 *
 * The bag belongs to the shared store (engine/dw3/item-store.ts), the port of the
 * original's three resident routines: this is F0x800161D8's add arm, reached from
 * the give/take dispatcher F0x800165ac. One byte per item, clamped at 99 with no
 * "bag full" message and no check before the add (claim
 * items-stack-quantity-cap-99-floor-0-2026-08-04). Every writer — steal, an
 * enemy's drop, a story grant, a shop purchase, the pause screen's own commit —
 * goes through it.
 */
export { addItem, removeItem } from "./item-store.ts";

export interface UseResult { ok: boolean; msg?: string; }

/**
 * Pause ITEMS bag Circle: the original OFFERS an item when bit 0 of its effect
 * record's byte +0 is set (`pro/ststatus.s`, the ITEMS page's choose branch).
 * For consumables that byte is the pair-table lo-byte, so classes 1 and 3 (the
 * field chips and the HP charges) are offered and classes 2 and 4 (the battle
 * disks and the booster packs) are not. Key items carry no effect record and
 * equipment never reaches this tab, so both read 0.
 *
 * Offering is not applying: an offered item can still be refused at APPLY time by
 * the applier (see {@link useItem}), which is where the original refuses.
 */
export function itemUsableInField(id: number): boolean {
  return (ITEM_BY_ID[id]?.itemClass ?? 0) % 2 !== 0;
}

/** Battle ITEM admission: effect-record byte 0 bit 1 (fightstg.s:19470-19473). */
export function itemUsableInBattle(id: number): boolean {
  return ((ITEM_BY_ID[id]?.itemClass ?? 0) & 2) !== 0;
}

/**
 * Permanent-boost caps, from the field applier's own table (ststatus file
 * 0x17c2c, RAM 0x8009a8dc; entries {selector, stat index, cap}): max HP and max
 * MP cap at 9999 (0x270f), every other boosted stat and the seven elemental
 * tolerances cap at 999 (0x3e7). See claim
 * field-stat-boost-applier-random-delta-and-cap-2026-09-13.
 *
 * These are the decoded copy of that table (engine/dw3/item-effect.ts's
 * FIELD_ITEM_BOOST_TABLE), kept as names because the walker's own callers ask
 * about the cap directly; tests/item-effect-codes.test.js holds the two equal.
 */
export const FIELD_BOOST_CAP_HP_MP = 9999;
export const FIELD_BOOST_CAP_STAT = 999;

/**
 * One use of one item, and what the player is told.
 *
 * `msg` is the original's own message id (0x52 + the effect code, or 0x6a for the
 * single refusal the original has) and `amount` the figure it prints beside it —
 * for a chip that is the ROLL, even when the cap clipped the real rise. The
 * clipped heal arm is the one message with NO figure: the constant 0x52
 * ("HP healed to maximum.", ststatus :12922-:12936 prints it and jumps to the
 * tail without the 0x118 amount call), so `amount` is absent there and `clipped`
 * marks it. The walker's legacy ITEMS panel renders its own English words from
 * these.
 */
export interface UseResult {
  ok: boolean;
  msg?: string;
  /** The original's message id, when the item resolved to a record. */
  messageId?: number;
  /** The figure the original prints with messageId, when it prints one. */
  amount?: number;
  /** True for the clipped heal arm: message 0x52, which carries no figure. */
  clipped?: boolean;
  /** How much the record actually rose, after the cap clipped it. */
  delta?: number;
}

/** The one refusal the original has, in its own words' id (`pro/ststatus.s:13063`). */
const REFUSAL_MESSAGE_ID = MESSAGE_NO_EFFECT;

/**
 * The member's own stat block as the shared applier sees it.
 *
 * The original writes a roster record and the walker keeps the same fifteen
 * numbers in its own fields, so this view is where the two meet: a read is the
 * number the original would have found in the record, and a write is the rise the
 * chip produced, split the way the walker's read model splits it (a rise in max HP
 * is both the member field and the chip's share of `bonuses.hp`, because
 * `evolvedMaxStats` rebuilds the sum as species + bonuses on every digivolution).
 *
 * Core stats read species + bonuses. Element tolerances read the profile's
 * resistance + trained points, matching the pause page's seeded record, and
 * write only the applied rise back to trained points.
 */
function memberTarget(ps: PartnerStats, profile?: ElementSources): FieldItemTarget {
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const halfword = (index: number): number => {
    if (index === IDX_TP) return num(ps.tp);
    if (index === IDX_HP) return num(ps.hp);
    if (index === IDX_MAX_HP) return num(ps.maxHp);
    if (index === IDX_MAX_MP) return num(ps.maxMp);
    const key = RECORD_CORE_STATS[index - IDX_CORE_BASE];
    if (key !== undefined) return num(ps.stats?.[key]) + num(ps.bonuses?.[key]);
    const elem = ELEMENT_KEYS[index - IDX_ELEMENT_BASE];
    if (elem !== undefined) return num(profile?.resistances?.[elem]) + num(ps.elemBonuses?.[elem]);
    return 0;
  };
  return {
    read: halfword,
    write: (index, value) => {
      if (index === IDX_TP) { ps.tp = value; return; }
      if (index === IDX_HP) { ps.hp = value; return; }
      // A rise in a max total is BOTH the member field and the chip's share of
      // `bonuses`, because `evolvedMaxStats` rebuilds the sum as species +
      // bonuses on every digivolution; the ported page's fold does the same split.
      if (index === IDX_MAX_HP) {
        ps.bonuses = ps.bonuses ?? {};
        ps.bonuses.hp = num(ps.bonuses.hp) + (value - num(ps.maxHp));
        ps.maxHp = value;
        return;
      }
      if (index === IDX_MAX_MP) {
        ps.bonuses = ps.bonuses ?? {};
        ps.bonuses.mp = num(ps.bonuses.mp) + (value - num(ps.maxMp));
        ps.maxMp = value;
        return;
      }
      const key = RECORD_CORE_STATS[index - IDX_CORE_BASE];
      if (key !== undefined) {
        // The species base stays where it is and the chip keeps its share in
        // `bonuses`, exactly as the ported page's fold does. The share grows by
        // the RISE, measured against the total the applier just read.
        ps.bonuses = ps.bonuses ?? {};
        const total = num(ps.stats?.[key]) + num(ps.bonuses[key]);
        ps.bonuses[key] = num(ps.bonuses[key]) + (value - total);
        return;
      }
      const elem = ELEMENT_KEYS[index - IDX_ELEMENT_BASE];
      if (elem !== undefined) {
        ps.elemBonuses = ps.elemBonuses ?? {};
        ps.elemBonuses[elem] = num(ps.elemBonuses[elem]) + (value - halfword(index));
      }
    },
  };
}

/**
 * Use one item on a partner, on the field.
 *
 * The decision is the shared applier's (engine/dw3/item-effect.ts, the port of
 * F0x8008F584) over the member's own stat block, so this route and the ported
 * pause ITEMS page agree on every effect code. The original spends the copy only
 * when the effect APPLIED: a refusal prints one line and leaves the item in the
 * bag (`pro/ststatus.s:13039`, the consume sits on the applied path only).
 *
 * `rand` is the original's random source, a non-negative integer: the chip's rise
 * is `rand() % value + 1` (`:12982` `div`, `:12983` `mfhi`, `:12989` `addiu`).
 * Injectable so tests are deterministic.
 */
export function useItem(
  state: ItemState, id: number,
  rand: () => number = () => Math.floor(Math.random() * 0x100000000),
  profile?: ElementSources,
): UseResult {
  const item = ITEM_BY_ID[id];
  if (!item) return { ok: false, msg: "Unknown item." };
  const slot = state.inventory.find(s => s.id === id);
  if (!slot || slot.qty <= 0) return { ok: false, msg: "Not in bag." };

  const outcome = applyFieldItemTarget(state.partnerStats, item.selector, item.value, rand, profile);
  if (outcome.flag === 0) {
    return { ok: false, msg: "No effect.", messageId: REFUSAL_MESSAGE_ID, amount: 0, delta: 0 };
  }
  removeItem(state, id, 1);
  return {
    ok: true,
    messageId: outcome.flag === 1 ? fieldItemMessageId(item.selector) : 0x52,
    // The clipped heal arm (flag 2) prints the constant 0x52 with NO figure
    // (ststatus :12934 sets the string and :12935 jumps to the tail without the
    // 0x118 amount call), so `amount` is absent there — the listed value is not
    // something the player was told. `delta` still carries the real rise.
    ...(outcome.flag === 1 ? { amount: outcome.used } : { clipped: true as const }),
    delta: outcome.delta,
  };
}

/**
 * {@link applyFieldItemEffect} against a walker's member, with the clipped heal's
 * constant message folded in. Split out so a caller that wants the bare decision
 * (a test, the legacy panel) can reach it without a bag.
 */
export function applyFieldItemTarget(
  ps: PartnerStats, selector: number, amount: number, rand: () => number, profile?: ElementSources,
): ReturnType<typeof applyFieldItemEffect> {
  return applyFieldItemEffect(memberTarget(ps, profile), selector, amount, rand);
}
