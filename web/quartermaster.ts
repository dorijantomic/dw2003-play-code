// web/quartermaster.js — Quartermaster part 1: the best LEGAL loadout for one
// party member out of everything we own, scored by the game's own decoded
// contribution. Pure: no DOM, no storage, no fetch, no writes. Part 2 adds the
// page and the single store commit; this half is the rule only.
//
// WHAT THE RULE IS (all read, nothing guessed)
// -------------------------------------------
// The pause EQUIP sheet's own three gates decide where a piece may sit
// (engine/dw3/equipment.ts, the port of pro/ststatus F0x8009A344):
//
//   wieldSlotsFor(item)      the decoded wield descriptor, stat byte +0x2:
//                            1 Right, 2 Left, 3 Left or Right, 4 Head, 5 Body,
//                            6/8 Accessory, 7 Two-handed. A descriptor-3 sword is
//                            offered in BOTH hand lists; a descriptor-7 weapon
//                            (statBytes[2] === 7) is offered in both AND takes
//                            both halfwords when worn.
//   pauseEquipRowAdmits(...)  the member's wear mask and the row's descriptor
//                            rule. A left-only piece is refused in the right
//                            row; a right-only piece in the left row. (The mask
//                            is indexed by the member's roster line slot.)
//   isTwoHanded(item)        statBytes[2] === 7.
//
// The score is the item's decoded contribution — `gearStatContributions` folds
// the record's own bytes (family-dependent) into {stat, amount} pairs. The
// module never writes a stat number: it sums what the engine returns, and its
// deltas are exactly `chosen minus worn` per slot.
//
// A TWO-HANDED WEAPON IS ONE WORN PIECE. The game stores it in BOTH hand
// halfwords and counts one worn copy (web/menu.js:1393, equipment-system-decoded
// EQUIP-C029), so a loadout proposes it once, in `right`, and leaves `left`
// empty. `wornSlots` folds a worn two-hander back to `right` for the same reason.
//
// ONE COPY, ONE SLOT. The store counts worn copies per id, not per slot
// (`recordItemIds` dedupes), so the same id is never proposed in two slots even
// when two bag copies exist; a worn copy with no held copy is therefore proposed
// exactly once.
//
// Copies: `poolFrom` keeps the store's two arrays in the store's id range
// 1..402. A row is proposable only when held + worn > 0.

import {
  gearStatContributions,
  isTwoHanded,
  pauseEquipRowAdmits,
  wieldSlotsFor,
} from "./vendor/engine.js";

/** The six pause rows, in the original's stored order. */
export const EQUIP_SLOTS = ["head", "body", "right", "left", "acc0", "acc1"];
/** The item store's id range (engine/dw3/item-store.ts ITEM_ID_MAX). */
export const ITEM_ID_MAX = 402;

const SLOT_ROW = new Map(EQUIP_SLOTS.map((slot, row) => [slot, row]));

/** A catalog row (`stat_bytes`) as the engine's own record (`statBytes`). */
export function itemRecord(row) {
  if (!row) return null;
  if (row.statBytes) return row;
  return {
    ...row,
    statBytes: row.stat_bytes ?? [],
    wearMask: row.wear_mask ?? null,
  };
}

/** The catalog as an id -> engine record map; accepts the file or its array. */
function itemMap(items) {
  const rows = Array.isArray(items) ? items : items?.equipment ?? [];
  const out = new Map();
  for (const row of rows) {
    const record = itemRecord(row);
    if (record && Number.isInteger(record.id)) out.set(record.id, record);
  }
  return out;
}

const count = (value) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The store's held arrays + worn map as one pool:
 * `{ [id]: { held, worn } }` for every id 1..402, zeros included, sorted by id.
 *
 * `bag` is `state.inventory` (or readItemArrays rows) and `worn` is
 * `state.worn` (or rows with a `worn`/`qty` count). Ids outside 1..402 are the
 * store's own ignore rule and are dropped.
 */
export function poolFrom(bag, worn) {
  const rows = new Map();
  const put = (id, key, n) => {
    const at = rows.get(id) ?? { held: 0, worn: 0 };
    at[key] = Math.max(at[key], n);
    rows.set(id, at);
  };
  for (const row of Array.isArray(bag) ? bag : []) {
    const id = Number(row?.id);
    if (!Number.isInteger(id) || id < 1 || id > ITEM_ID_MAX) continue;
    put(id, "held", count(row?.qty ?? row?.held));
  }
  const wornRows = Array.isArray(worn)
    ? worn
    : Object.entries(worn ?? {}).map(([id, n]) => ({ id, worn: n }));
  for (const row of wornRows) {
    const id = Number(row?.id);
    if (!Number.isInteger(id) || id < 1 || id > ITEM_ID_MAX) continue;
    put(id, "worn", count(row?.worn ?? row?.qty ?? row?.held));
  }
  const out = {};
  for (let id = 1; id <= ITEM_ID_MAX; id++) out[id] = rows.get(id) ?? { held: 0, worn: 0 };
  return out;
}

/** The roster line slot the wear mask is indexed by (rules wins over member). */
function lineSlotOf(member, rules) {
  if (rules && rules.lineSlot !== undefined) return rules.lineSlot;
  const slot = member?.lineSlot ?? member?.rosterSlot;
  return slot === undefined ? null : slot;
}

/**
 * Every owned piece, listed under each slot its descriptor admits, in id order.
 * Empty rows are kept so the caller can read all six slots. A piece owned only
 * as a worn copy (held === 0) is still listed — it can be re-worn — and a piece
 * the member's line or the pause row refuses is not listed at all.
 *
 * `member` = `{ lineSlot, equipment }`; `rules` may override `lineSlot`.
 */
export function slotOptions(member, pool, items, rules) {
  const lookup = itemMap(items);
  const lineSlot = lineSlotOf(member, rules);
  const out = Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, []]));
  const ids = Object.keys(pool ?? {})
    .map(Number)
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= ITEM_ID_MAX)
    .sort((a, b) => a - b);
  for (const id of ids) {
    const row = pool[id];
    if ((row?.held ?? 0) + (row?.worn ?? 0) <= 0) continue;
    const item = lookup.get(id);
    if (!item) continue;
    for (const slot of wieldSlotsFor(item)) {
      const at = SLOT_ROW.get(slot);
      if (at === undefined) continue;
      if (!pauseEquipRowAdmits(lineSlot, at, id)) continue;
      out[slot].push(id);
    }
  }
  return out;
}

/** The worn record as the six slots, with a two-handed weapon folded onto `right`. */
function wornSlots(member, lookup) {
  const out = {};
  const equipment = member?.equipment ?? {};
  for (const slot of EQUIP_SLOTS) {
    const id = Number(equipment[slot]) || 0;
    if (id > 0) out[slot] = id;
  }
  // A two-handed weapon is ONE worn piece stored in both hand halfwords; the
  // decoded rule makes it right-hand only and clears the left (EQUIP-C029).
  const left = out.left;
  if (left && isTwoHanded(lookup.get(left)) && (!out.right || out.right === left)) {
    out.right = left;
    delete out.left;
  }
  return out;
}

/**
 * Is this six-slot pick legal under the pause sheet's own three gates?
 *
 * `pick` = `{head, body, right, left, acc0, acc1}` (0/undefined = empty),
 * `items` = the catalog (or its `equipment` array), `member` =
 * `{lineSlot, equipment}`. Refused when a piece cannot sit in that row, when
 * the member's mask refuses it, when a two-handed piece shares the hands, when
 * one id would fill two slots, or when two same-bank descriptor-8 accessories
 * are worn together (the store takes the first off when the second goes on).
 */
export function legalCombo(pick, items, member) {
  const lookup = itemMap(items);
  const lineSlot = lineSlotOf(member);
  const used = new Set();
  let twoHanded = 0;
  for (const slot of EQUIP_SLOTS) {
    const id = Number(pick?.[slot]) || 0;
    if (id <= 0) continue;
    const item = lookup.get(id);
    if (!item) return false;
    if (!wieldSlotsFor(item).includes(slot)) return false;
    if (!pauseEquipRowAdmits(lineSlot, SLOT_ROW.get(slot), id)) return false;
    if (used.has(id)) return false;
    used.add(id);
    if (isTwoHanded(item)) {
      if (slot !== "right" && slot !== "left") return false;
      twoHanded += 1;
    }
  }
  if (twoHanded > 1) return false;
  const right = Number(pick?.right) || 0;
  const left = Number(pick?.left) || 0;
  if (right && left && (isTwoHanded(lookup.get(right)) || isTwoHanded(lookup.get(left)))) {
    return false;
  }
  const acc0 = lookup.get(Number(pick?.acc0) || 0);
  const acc1 = lookup.get(Number(pick?.acc1) || 0);
  if (
    acc0 && acc1 &&
    acc0.statBytes?.[2] === 8 && acc1.statBytes?.[2] === 8 &&
    acc0.statBytes?.[3] === acc1.statBytes?.[3]
  ) {
    return false;
  }
  return true;
}

const contributionsOf = (item) => (item ? gearStatContributions(item) : []);

/** A contribution list folded to a Map, adding repeats. */
function foldContributions(list) {
  const out = new Map();
  for (const c of list) out.set(c.stat, (out.get(c.stat) ?? 0) + c.amount);
  return out;
}

/** chosen minus worn as `{stat: amount}`, zeros dropped, keys sorted. */
function contributionDelta(chosen, worn) {
  const out = {};
  const keys = [...new Set([...chosen.keys(), ...worn.keys()])].sort();
  for (const key of keys) {
    const value = (chosen.get(key) ?? 0) - (worn.get(key) ?? 0);
    if (value !== 0) out[key] = value;
  }
  return out;
}

/** The single number two pieces are ranked by: their decoded contribution sum. */
function weigh(item) {
  return contributionsOf(item).reduce((total, c) => total + c.amount, 0);
}

/** The best of a slot's options by contribution total, lowest id on a tie. */
function bestOf(ids, lookup) {
  let best = 0;
  for (const id of ids) {
    if (!best) {
      best = id;
      continue;
    }
    const score = weigh(lookup.get(id));
    const held = weigh(lookup.get(best));
    if (score > held || (score === held && id < best)) best = id;
  }
  return best;
}

/**
 * The best legal loadout for one member, from everything the pool owns.
 *
 * `member` = `{lineSlot, equipment}`; `pool` = `poolFrom(...)`; `items` = the
 * catalog (or its `equipment` array); `rules` may override `lineSlot`.
 *
 * Returns `{slots, deltas, refusals}`:
 *   slots      the six chosen ids (0 = leave empty), a two-handed weapon in
 *              `right` with `left` empty — never the illegal pair;
 *   deltas     per slot, `gearStatContributions(chosen) - gearStatContributions
 *              (worn)`, zeros dropped (a worn two-hander counts once);
 *   refusals   every listed piece the winner left out, with the reason:
 *              "copy" (the same id already fills a slot), "hands" (a two-handed
 *              piece fills both hands), or "outranked" (legal, lower total).
 *
 * The answer is a pure function of the pool's numbers: pieces are ranked by
 * contribution, ties by lower id, so insertion order never matters.
 */
export function bestLoadout(member, pool, items, rules) {
  const lookup = itemMap(items);
  const lineSlot = lineSlotOf(member, rules);
  const at = { lineSlot, equipment: member?.equipment ?? {} };
  const options = slotOptions(member, pool, items, rules);
  const pick = {
    head: bestOf(options.head, lookup),
    body: bestOf(options.body, lookup),
    right: 0,
    left: 0,
    acc0: 0,
    acc1: 0,
  };

  // Hands: enumerate the legal pairs. A two-handed piece is canonicalised into
  // `right` with `left` empty, because that is the one worn piece the store
  // counts; a Left-or-Right sword may fill either hand.
  const hands = [];
  const pushHands = (right, left) => {
    if (!legalCombo({ right, left }, items, at)) return;
    hands.push({ right, left });
  };
  pushHands(0, 0);
  for (const id of options.right) pushHands(id, 0);
  for (const id of options.left) if (!isTwoHanded(lookup.get(id))) pushHands(0, id);
  for (const right of options.right) {
    if (isTwoHanded(lookup.get(right))) continue;
    for (const left of options.left) {
      if (right === left || isTwoHanded(lookup.get(left))) continue;
      pushHands(right, left);
    }
  }
  const handScore = (pair) => weigh(lookup.get(pair.right)) + weigh(lookup.get(pair.left));
  hands.sort((a, b) => handScore(b) - handScore(a));
  const bestHands = hands[0] ?? { right: 0, left: 0 };
  pick.right = bestHands.right;
  pick.left = bestHands.left;

  // Accessories: two separate rows, one copy per id, no same-bank descriptor-8
  // pair. Both rows admit the same classes, so the best legal pair is just the
  // two best different copies.
  const byScore = (a, b) => weigh(lookup.get(b)) - weigh(lookup.get(a)) || a - b;
  const first = options.acc0.slice().sort(byScore)[0] ?? 0;
  pick.acc0 = first;
  pick.acc1 = options.acc1
    .filter((id) => id !== first && legalCombo({ acc0: first, acc1: id }, items, at))
    .sort(byScore)[0] ?? 0;

  // Per-slot deltas against what is worn now (a two-hander read once).
  const worn = wornSlots(member, lookup);
  const deltas = {};
  for (const slot of EQUIP_SLOTS) {
    deltas[slot] = contributionDelta(
      foldContributions(contributionsOf(lookup.get(pick[slot]))),
      foldContributions(contributionsOf(lookup.get(worn[slot] ?? 0))),
    );
  }

  // Every listed piece the winner did not take, with the decoded reason.
  const chosen = new Set(Object.values(pick).filter((id) => id > 0));
  const refusals = [];
  for (const slot of EQUIP_SLOTS) {
    const other = slot === "left" ? pick.right : slot === "right" ? pick.left : 0;
    for (const id of options[slot]) {
      if (id === pick[slot]) continue;
      const item = lookup.get(id);
      let reason = "outranked";
      if (chosen.has(id)) reason = "copy";
      else if (isTwoHanded(item) && (pick.right || pick.left)) reason = "hands";
      else if (other && isTwoHanded(lookup.get(other))) reason = "hands";
      refusals.push({ slot, id, reason });
    }
  }

  return { slots: pick, deltas, refusals };
}
