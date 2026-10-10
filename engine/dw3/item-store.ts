// engine/dw3/item-store.ts
//
// THE item store: one owner for the bag every screen reads and writes.
//
// The original has no slot list and no per-item record. The whole inventory is
// two parallel byte arrays inside the save block at D0x80048D34 —
// `base + 0x7C + id` is how many you CARRY and `base + 0x20F + id` how many are
// WORN — and three resident routines own them:
//
//   F0x800161D8  add(id, nonzero) -> bag[id]++ then clamp to 99
//                add(id, 0)       -> bag[id]-- floor 0, and when the carried count
//                                     was ALREADY 0 and something is worn, take one
//                                     worn copy off whoever wears it
//   F0x80015F04  compare possession with the caller's expectation: it answers
//                "carried or worn" against flag != 0 and its mirror against 0
//   F0x800135E8  walk one of the five fixed id directories in table order and keep the
//                ids whose count is non-zero (a negative kind also admits worn-only ids)
//
// This module is the port of all three over the walker's own storage. Before it
// existed each screen did its own find/push/splice over a `[{id,qty}]` array, so
// the 99 cap was missing on four writers and the lists came out in the order the
// bag happened to receive items rather than the original's id order.
//
// Read this before adding an item writer: NOTHING outside this module may write
// `state.inventory` or `state.worn`. tests/item-store-single-writer.test.js scans
// web/ to keep it that way.
//
// The second array is the WORN count, and it is the number the game's two
// "Equip n" figures read. Four writers move it and nothing else does: the equip
// move (`wearOne`), the unequip move (`unwearOne`, which the merchant's hand swap
// also runs), the auto-unequip on depletion (inside `removeItem`) and the
// merchant's hand swap's own pair (`commitEquipEvent`, the stitshop 0x8008C880 /
// 0x8008CA30 arms).
//
// THE COUNTING RULE, read from the assembly 2026-10-04: the byte counts WEARER
// RECORDS that name the item, not halfwords. Every reachable worn-byte store in
// the original is reached once per writer call and each call moves the byte ONCE:
// ststatus 0x8009A45C (the replaced slot), 0x8009A518 (a two-handed pick),
// 0x8009A5AC (an accessory pair), 0x8009A5FC (the equip); stitshop 0x8008C880,
// 0x8008C940, 0x8008C9DC, 0x8008CA30 (the same four); and F0x800161D8's single
// `sb $v0, 0x20f($v1)` at 0x800162F8, which the auto-unequip reaches once however
// many hands it cleared. No path counts a halfword twice, so a piece that sits in
// both of a record's hand halfwords — which is exactly what the original's live
// "both hands" arms write for a two-handed weapon — is ONE worn copy.
// `commitRecord` below is where that lives, and `syncWornFromEquipment` rebuilds
// the array with the same rule.
//
// `state.equipment` remains the wearer record — which hand holds what — and is
// changed through `setEquippedItem` / `commitEquipEvent`, which move the byte in
// the same step; a wholesale replacement of the wearer record is followed by
// `syncWornFromEquipment`.
//
// The memory-side ports of the same three routines — engine/dw3/ui/shop-inventory.ts
// (the merchant SELL provider) and engine/dw3/ui/native/pause-inventory.ts (the
// translated pause ITEMS tabs) — share the admission rule below, so a list built
// in memory and a list built here cannot disagree.

import { EQUIP_SLOTS, type EquipSlot, type EquipmentSlots } from "./equipment.ts";
import { ITEM_DIRECTORY_COUNT, ITEM_ID_MAX, itemDirectory } from "./item-directories.ts";

/** One bag entry as the walker saves it. Shape unchanged since the first save. */
export interface ItemBagSlot {
  id: number;
  qty: number;
}

/**
 * The state this store owns two fields of. `inventory` is the carried array
 * (`base + 0x7C + id`) and `worn` is the WORN array (`base + 0x20F + id`), the
 * second of the original's two byte arrays; `worn` holds only the ids whose byte
 * is non-zero, keyed by item id, which is the same information.
 *
 * `equipment` stays the walker's WEARER RECORD — who wears what, one slot map
 * per party member — and is what the auto-unequip searches, exactly as
 * F0x800161D8 searches the roster's six equip halfwords. The two stay in step
 * because every change of a record goes through one function (`commitRecord`,
 * behind `setEquippedItem` and `commitEquipEvent`), which moves the worn byte by
 * the DIFFERENCE the record gained and lost; a wholesale replacement of
 * `state.equipment` (a save load, a new game) is followed by
 * `syncWornFromEquipment`, which recomputes the array from the wearer record with
 * the same rule — the invariant the original's four writers maintain, so the
 * recomputation is a no-op on any consistent save.
 */
export interface ItemStoreState {
  inventory: ItemBagSlot[];
  worn?: Record<string, number>;
  equipment?: Array<EquipmentSlots | null | undefined>;
}

/**
 * F0x800161D8's ceiling: the count is one byte, and a grant that reaches 100
 * stores 99 (`li $v0, 0x63`). Silently — no "bag full" message anywhere, and no
 * check before the add. Claim items-stack-quantity-cap-99-floor-0-2026-08-04.
 */
export const HELD_MAX = 99;

/** F0x800161D8's floor: a removal that would go below 0 stores 0 instead. */
export const HELD_MIN = 0;

/**
 * `base + 0x20F + id` is a byte, so a worn count cannot pass 255. The cap keeps
 * every real figure far below that (six hands at most), and no path reaches the
 * wrap; it is stated so the stored number is always the byte the original holds.
 */
export const WORN_MAX = 255;

/** The `worn` array read back as the byte the original loads (`lb`). */
function readWorn(state: ItemStoreState, id: number): number {
  const raw = Number(state.worn?.[String(id)] ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(WORN_MAX, Math.trunc(raw));
}

/** The only writer of the `worn` byte: it drops the key at 0, as the byte is 0. */
function writeWorn(state: ItemStoreState, id: number, value: number): void {
  if (!state.worn) state.worn = {};
  const n = Math.max(0, Math.min(WORN_MAX, Math.trunc(value) || 0));
  if (n === 0) delete state.worn[String(id)];
  else state.worn[String(id)] = n;
}

export { ITEM_DIRECTORY_COUNT, ITEM_ID_MAX };

/**
 * F0x800135E8's admission rule (exe/f3.s .Lloop): walk the directory in table
 * order and keep an id whose held byte is non-zero; a negative kind also keeps an
 * id whose WORN byte is non-zero, which is how an item you have equipped but hold
 * none of still appears in the merchant SELL list and the pause EQUIP tabs.
 *
 * Both counts are read as SIGNED bytes in the original (`lb`), and the cap keeps
 * them under 128, so a plain non-zero test is the same test.
 */
export function inventoryDirectoryAdmits(held: number, worn: number, includeWorn: boolean): boolean {
  return held !== 0 || (includeWorn && worn !== 0);
}

// ---------------------------------------------------------------------------
// F0x80015F04 — read the store.
// ---------------------------------------------------------------------------

/** The carried count: the raw `bag[id]` byte. */
export function heldCount(state: ItemStoreState, id: number): number {
  const slot = state.inventory.find((s) => s.id === id);
  const qty = slot ? slot.qty : 0;
  return qty > 0 ? qty : 0;
}

/**
 * how many of `id` are WORN — the stored byte at `base + 0x20F + id`, which is
 * what both "Equip n" figures read: stitshop 0x80089ECC (`lb $a2, 0x20f($v0)`,
 * stitshop file 0x721C) into the merchant band's Equip number, and ststatus
 * 0x8008F16C (routine at file 0xC4BC, the load `lb $a2, 0x20f($v0)` at file
 * 0xC4CC) into the pause band's number at screen+0xC4. Both load a BYTE from the
 * array; neither counts anything.
 *
 * It is a stored number, not a count of `state.equipment`, because that is what
 * the original keeps: the byte is written ONLY by the equip move, the unequip
 * move, the auto-unequip on depletion and the merchant's equip-apply. What the
 * byte COUNTS is wearer records, not halfwords (see the header) — one copy of an
 * item per Digimon wearing it, however many of that Digimon's six halfwords hold
 * it. `state.equipment` is the wearer record (which hand holds what) and is
 * moved by the same paths; `syncWornFromEquipment` rebuilds the byte array from
 * it whenever a save or a wholesale assignment replaces the wearer record.
 */
export function wornCount(state: ItemStoreState, id: number): number {
  return readWorn(state, id);
}

/**
 * F0x80015F04(id, 1) — "do we have any of this", the predicate every possession
 * gate in the game reads. Carried OR worn: the original returns 1 while either
 * count byte is non-zero.
 *
 * The routine's other form, `F0x80015F04(id, 0)`, is its exact mirror — "do we
 * hold NONE of this" — not a count. Both of its branches write the answer in a
 * delay slot, so the byte it loaded never survives; run against the original it
 * answers 1 exactly when nothing is carried and nothing is worn
 * (tests/item-store-oracle.test.js). In other words the routine compares
 * possession with the caller's expectation and answers true when they agree, and
 * every caller (getGameState, F0x800163B0) uses it as a boolean. The scene
 * predicate negates this function for the mirror question, which is that shape.
 */
export function ownsItem(state: ItemStoreState, id: number): boolean {
  return heldCount(state, id) !== 0 || wornCount(state, id) !== 0;
}

// ---------------------------------------------------------------------------
// The two arrays as they sit in the save block (D0x80048D34).
// ---------------------------------------------------------------------------

/**
 * The save/party/collection block the memory card copies whole, and its length.
 *
 * `pro/stgmcard` state 0x33 builds the image: the copy loop runs from
 * `0x80048D34` to `0x8004B3F4` sixteen bytes at a time and then one final word
 * (stgmcard.s:3514-3560, `exe-decomp/stgmcard_c/F0x80084dcc.c:446-457`), so the
 * blob is these `0x26C4` bytes verbatim — byte 0 is the XOR-8 checksum over the
 * next `0x26C0`, u16 at 2 is the format id 4. Driver state 0x47 reads the same
 * `0x26C4` and copies it back over the block in one loop after verifying
 * checksum and format (stgmcard.s:3250-3300, F0x80084dcc.c:587-614). Nothing
 * repacks a field, so the card layout IS the RAM layout minus this base.
 */
export const SAVE_BLOCK_BASE = 0x80048d34;
export const SAVE_BLOCK_SIZE = 0x26c4;

/**
 * Where the two count arrays begin inside that block. They are exactly adjacent
 * — `0x20F - 0x7C = 0x193 = 403` — with no padding, which is why they are easy
 * to confuse and why an off-by-one guard on either one is invisible.
 *
 * Id 0 owns neither first byte (0x7C and 0x20F): the live item range is
 * 0x7D..0x20A and 0x210..0x2BD, ids 1..402. The original addresses them as
 * `base + id + offset` with NO bound check anywhere (F0x800161D8, F0x80015F04,
 * stfgtrep.s:2844-2884) and never masks the id to a byte, so there is nothing
 * to reproduce by clipping it: every one of the 402 ids is a real byte.
 */
export const HELD_ARRAY_OFFSET = 0x7c;
export const WORN_ARRAY_OFFSET = 0x20f;

/** `base + 0x7C + id` — the carried count of `id`. */
export function heldArrayAddress(id: number, base: number = SAVE_BLOCK_BASE): number {
  return base + HELD_ARRAY_OFFSET + id;
}

/** `base + 0x20F + id` — the worn count of `id`. */
export function wornArrayAddress(id: number, base: number = SAVE_BLOCK_BASE): number {
  return base + WORN_ARRAY_OFFSET + id;
}

/**
 * A byte sink or source over the save block's RAM. `engine/native`'s
 * `NativeMemory` is one; the native screen host's `{ write, read }` pair is the
 * other (wrapped below), so the same port serves the original-code route and
 * the translated one.
 */
export interface SaveBlockBytes {
  write8?(address: number, value: number): void;
  read8?(address: number): number;
}

/** One item's two bytes, as the block holds them. */
export interface ItemCountEntry {
  id: number;
  held: number;
  worn: number;
}

function clampCount(value: number): number {
  const n = Math.trunc(Number(value)) || 0;
  return n > HELD_MAX ? HELD_MAX : n < 0 ? 0 : n;
}

/**
 * The whole store as the block's two arrays: one row per id 1..402, in id order,
 * including the ids the party holds nothing of (their bytes are 0, and the copy
 * puts them on the card like every other byte).
 *
 * The worn column is the stored worn byte (`wornCount`), the same number the
 * two "Equip n" figures read.
 */
export function itemCountEntries(state: ItemStoreState): ItemCountEntry[] {
  const rows: ItemCountEntry[] = [];
  for (let id = 1; id <= ITEM_ID_MAX; id++) rows.push({ id, held: 0, worn: 0 });
  const rowAt = (id: number): ItemCountEntry | undefined => rows[id - 1];
  for (const slot of state.inventory ?? []) {
    const id = Number(slot?.id);
    if (!Number.isInteger(id) || id < 1 || id > ITEM_ID_MAX) continue;
    const row = rowAt(id);
    if (row) row.held = clampCount(slot.qty);
  }
  for (const id of wornItemIds(state)) {
    const row = rowAt(id);
    if (row) row.worn = clampCount(wornCount(state, id));
  }
  return rows;
}

/**
 * Write both arrays into the block. Every id 1..402 is written, so a byte the
 * block used to hold for an item the party no longer has reads 0 — which is what
 * copying the block whole produced anyway.
 */
export function writeItemArrays(
  bytes: SaveBlockBytes,
  entries: Iterable<ItemCountEntry> | null | undefined,
  base: number = SAVE_BLOCK_BASE,
): void {
  const byId = new Map<number, ItemCountEntry>();
  // A seed with no bag writes an empty bag, as the copy did before.
  for (const entry of entries ?? []) {
    const id = Number(entry?.id);
    if (!Number.isInteger(id) || id < 1 || id > ITEM_ID_MAX) continue;
    byId.set(id, { id, held: clampCount(entry.held), worn: clampCount(entry.worn) });
  }
  const sink = bytes.write8;
  if (!sink) throw new Error("writeItemArrays needs a byte sink");
  for (let id = 1; id <= ITEM_ID_MAX; id++) {
    const row = byId.get(id);
    sink.call(bytes, heldArrayAddress(id, base), row ? row.held : 0);
    sink.call(bytes, wornArrayAddress(id, base), row ? row.worn : 0);
  }
}

/** The two arrays read back out of the block, ids 1..402 in order. */
export function readItemArrays(
  bytes: SaveBlockBytes,
  base: number = SAVE_BLOCK_BASE,
): ItemCountEntry[] {
  if (!bytes.read8) throw new Error("readItemArrays needs a byte source");
  const rows: ItemCountEntry[] = [];
  for (let id = 1; id <= ITEM_ID_MAX; id++) {
    rows.push({
      id,
      held: clampCount(bytes.read8!(heldArrayAddress(id, base))),
      worn: clampCount(bytes.read8!(wornArrayAddress(id, base))),
    });
  }
  return rows;
}

/** `base + 0x7C + id` read as one byte — the post-battle screen's payout reads this. */
export function readHeldByte(bytes: SaveBlockBytes, id: number, base: number = SAVE_BLOCK_BASE): number {
  if (!bytes.read8) throw new Error("readHeldByte needs a byte source");
  return clampCount(bytes.read8(heldArrayAddress(id, base)));
}

/** `base + 0x20F + id` read as one byte. */
export function readWornByte(bytes: SaveBlockBytes, id: number, base: number = SAVE_BLOCK_BASE): number {
  if (!bytes.read8) throw new Error("readWornByte needs a byte source");
  return clampCount(bytes.read8(wornArrayAddress(id, base)));
}

/**
 * The bag as the walker saves it, rebuilt from a block read. `F0x800135E8` and
 * `heldCount` answer from these bytes, so a loaded image restores the same shape
 * an old save has (`[{id, qty}]`, id order, qty > 0) and needs no migration.
 */
export function bagFromItemArrays(entries: Iterable<ItemCountEntry>): ItemBagSlot[] {
  const slots: ItemBagSlot[] = [];
  for (const entry of entries) {
    const held = clampCount(entry?.held);
    if (held > 0) slots.push({ id: Number(entry.id), qty: held });
  }
  return slots;
}

/** Replace the bag with what a block read says, through add/remove (cap, floor, auto-unequip). */
export function applyItemArrays(state: ItemStoreState, entries: Iterable<ItemCountEntry>): void {
  reconcileHeldCounts(state, bagFromItemArrays(entries));
}

// ---------------------------------------------------------------------------
// F0x800135E8 — build a list.
// ---------------------------------------------------------------------------

/**
 * The ids of directory `kind` the party has, in the original's order. `kind` is
 * the directory index; a negative kind also admits worn-only copies.
 *
 * The pause ITEMS tabs use 1 (Items), 2 (Weapons), 3 (Armor), 4 (Accessories) and
 * 0 (Important Items) — the walker's five tab rows in that reading order, which is
 * the original's own category table at 0x8009A890 (entries 0-3 held-only, then
 * kinds 2/3/4 including worn for the EQUIP pages). Any kind outside 0..4 lists
 * nothing, as in the original.
 */
export function listItemIds(state: ItemStoreState, kind: number): number[] {
  const directory = itemDirectory(kind);
  if (!directory) return [];
  const includeWorn = (kind | 0) < 0;
  const ids: number[] = [];
  for (const id of directory) {
    if (inventoryDirectoryAdmits(heldCount(state, id), includeWorn ? wornCount(state, id) : 0, includeWorn)) {
      ids.push(id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// F0x800161D8 — change the store.
// ---------------------------------------------------------------------------

/** The single place a bag slot is created or its count raised. */
function storeHeld(state: ItemStoreState, id: number, qty: number): void {
  const slot = state.inventory.find((s) => s.id === id);
  if (slot) slot.qty = qty;
  else state.inventory.push({ id, qty });
}

/** The single place a bag slot's count falls or the slot goes away. */
function dropHeld(state: ItemStoreState, id: number): void {
  const index = state.inventory.findIndex((s) => s.id === id);
  if (index >= 0) state.inventory.splice(index, 1);
}

/**
 * F0x800161D8(id, nonzero) — give `qty` copies: the count rises and is then held
 * at 99. A grant at the cap is not refused and not announced; it simply stays at
 * 99.
 */
export function addItem(state: ItemStoreState, id: number, qty = 1): void {
  storeHeld(state, id, Math.min(HELD_MAX, heldCount(state, id) + qty));
}

/**
 * F0x800161D8(id, 0) — take `qty` copies: the count falls and is floored at 0.
 *
 * When the carried count was ALREADY 0 and something is worn, the original does
 * not stop there: it looks for whoever wears the item and takes it off them
 * (see `autoUnequip`). That arm is the `worn[id] -= 1` a player sees when a story
 * line hands an equipped weapon back.
 */
export function removeItem(state: ItemStoreState, id: number, qty = 1): void {
  const held = heldCount(state, id);
  if (held > 0) {
    const left = held - qty;
    if (left > HELD_MIN) storeHeld(state, id, left);
    else dropHeld(state, id);
    return;
  }
  if (wornCount(state, id) > 0) autoUnequip(state, id);
}

/**
 * The original's zero branch: walk the three ACTIVE party slots, then every
 * roster record that has been obtained, and clear the equip slots holding this
 * item; then drop ONE worn copy. F0x800161D8 .L0x80016274 (party loop, three
 * iterations, slot -> roster index through [0x80048D34 + 0x2718]) and
 * .L0x800162AC (eight records at stride 0x3DC, each skipped while its word at
 * +0x760 is below 3 — the "obtained" marker, `roster_owned[slot] = slot + 3`,
 * engine/dw3/roster.ts).
 *
 * The clear itself is the resident helper f10 (exe/f10.s): it walks the record's
 * six equip halfwords at +0x3C0 and clears the one that matches, or — its second
 * arm — BOTH hands. That second arm is **live**: its class test reads byte 2 of
 * the EQUIP-STAT record (the provider at [0x80042B98] is f5, `0x80041838 + 12*id`,
 * and f10 then dereferences word 0 of that item record before reading byte 2), so
 * it reads 7 for the 23 two-handed weapons and fires for every one of them. It
 * fires for the FIRST matching halfword and returns, so a piece occupying two
 * hand halfwords of one record still costs exactly one worn copy: f10 returns
 * after the first match and F0x800161D8 then does its one `sb $v0, 0x20f($v1)` at
 * 0x800162F8 (`fns.s:6786`).
 *
 * `state.equipment` is the first loop — the deployed party. `state.reserveEquipment`
 * is the second one: a partner who is switched out keeps a roster record with its
 * own six halfwords, and the worn byte counts those too, which is why the byte
 * survives a partner switch untouched.
 */
function autoUnequip(state: ItemStoreState, id: number): void {
  for (const slots of wearableRecords(state)) {
    if (!slots) continue;
    if (!EQUIP_SLOTS.some((slot) => Number(slots[slot]) === id)) continue;
    for (const slot of EQUIP_SLOTS) {
      if (Number(slots[slot]) === id) delete slots[slot];
    }
    // Step 3 of the original's zero branch: `worn[id] -= 1`, and nothing else —
    // the carried byte is already 0 (F0x800161D8 only enters this arm from
    // `beqz $v0, .L0x80016260`, where $v0 is the carried byte), so this copy
    // never reappears in the bag. The single store is `sb $v0, 0x20f($v1)` at
    // F0x800161D8's 0x800162F8.
    writeWorn(state, id, readWorn(state, id) - 1);
    return;
  }
}

/**
 * Every wearer record the worn byte counts: the three deployed members in party
 * order (the original's first loop), then the obtained partners who are switched
 * out (its second loop over eight roster records).
 */
function wearableRecords(state: ItemStoreState): Array<EquipmentSlots | null | undefined> {
  const deployed = Array.isArray(state.equipment) ? state.equipment : [];
  const out: Array<EquipmentSlots | null | undefined> = [...deployed];
  const reserve = (state as { reserveEquipment?: Record<string, EquipmentSlots> }).reserveEquipment;
  for (const charId of Object.keys(reserve ?? {}).sort()) out.push(reserve![charId]);
  return out;
}

// ---------------------------------------------------------------------------
// The four writers of the worn byte (`base + 0x20F + id`).
//
// Only these move it, exactly as in the original: the equip move, the unequip
// move, the auto-unequip on depletion (inside `removeItem`, above) and the
// merchant's equip-apply. Every one of them is a raw pair of `lbu`/`sb` stores on
// the two arrays with NO cap and NO floor on either byte, so a caller that
// equipped something you do not carry would wrap the carried byte to 255; each
// caller in the original gates on possession first, and this port floors instead
// of wrapping.
//
// WHAT ONE WRITER CALL COUNTS: one copy of the item, once. The two count arrays
// are read and written per item id and the record holds at most six halfwords, so
// a caller that wants "this Digimon now wears this" moves the byte once however
// many halfwords that name it. That is the header's rule and `commitRecord` is
// the only place it is applied.
// ---------------------------------------------------------------------------

/**
 * The EQUIP move: one copy goes onto a wearer and one copy leaves the bag.
 *
 * `worn += 1; bag -= 1`, read and written raw. ststatus 0x8009A5E4 (file
 * 0x17934, `lbu $v1,0x20f($v0)` / `lbu $a0,0x7c($v0)` / `sb $v1,0x20f` /
 * `sb $a0,0x7c`) and the shop's shared equip-apply F0x8008C800 at 0x8008CA10
 * (file 0x9D60) are the same four instructions; the shop calls it through the
 * block's routine table at `0x8008D1AC+0x28`.
 *
 * The ststatus arm is at RAM 0x8009A5EC / 0x8009A5F0 (the two loads),
 * 0x8009A5FC (worn) and 0x8009A600 (bag); the shop's arm is 0x8008CA20 /
 * 0x8008CA24 (loads), 0x8008CA30 (worn) and 0x8008CA34 (bag). ststatus.s and
 * stitshop.s both load at 0x80082CB0, so a file offset is that plus the address.
 */
export function wearOne(state: ItemStoreState, id: number): void {
  writeWorn(state, id, readWorn(state, id) + 1);
  // The bag half is the original's own `addiu $a0, -0x1` / `sb`: a raw
  // decrement with no floor and no auto-unequip, because every caller in the
  // original gates on possession first. The slot therefore goes away when the
  // last copy leaves, the same shape `removeItem` gives it.
  const held = heldCount(state, id);
  if (held > 1) storeHeld(state, id, held - 1);
  else dropHeld(state, id);
}

/**
 * The UNEQUIP move: one copy comes off a wearer and one copy goes back to the
 * bag. `worn -= 1; bag += 1`.
 *
 * ststatus 0x8009A504 (file 0x17854) for the selected hand — the loads at
 * 0x8009A50C and 0x8009A528, the stores at 0x8009A518 (worn) and 0x8009A534
 * (bag), then `sh $zr, ($a1)` at 0x8009A53C clears the hand. The replaced-slot
 * arm is the one before it in the same routine, 0x8009A3E8 (file 0x17738), whose
 * stores are 0x8009A45C (worn) and 0x8009A464 (bag). The merchant's copy of the
 * same pair is 0x8008C940 (worn) and 0x8008C95C (bag) — see `commitEquipEvent`
 * for what reaches it.
 */
export function unwearOne(state: ItemStoreState, id: number): void {
  writeWorn(state, id, readWorn(state, id) - 1);
  addItem(state, id, 1);
}

/** The distinct item ids one wearer record names, in `EQUIP_SLOTS` order. */
function recordItemIds(slots: EquipmentSlots | null | undefined): number[] {
  const ids: number[] = [];
  if (!slots) return ids;
  for (const slot of EQUIP_SLOTS) {
    const id = Number(slots[slot]) || 0;
    if (id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The wearer record for `partyIdx`, created empty if it is not there yet. */
function ensureRecord(state: ItemStoreState, partyIdx: number): EquipmentSlots {
  if (!Array.isArray(state.equipment)) state.equipment = [];
  while (state.equipment.length <= partyIdx) state.equipment.push({});
  return state.equipment[partyIdx] ?? (state.equipment[partyIdx] = {});
}

/**
 * THE ONE RECORD WRITER: move `slots` from what it holds to `target` and move the
 * worn byte by the difference — once per item the record LOST (its copy goes back
 * to the bag, the byte falls) and once per item it GAINED (a copy leaves the bag,
 * the byte rises), in that order, which is the order the original's displace arm
 * and equip arm run in inside one call.
 *
 * The record's six keys are rewritten in place rather than replacing the object:
 * the DRI keeps a reserve partner's record ALIASED to the same object
 * (`web/dri-model.js`), so the object identity has to survive a wear change.
 *
 * Why the difference and not "one call, one move": the original's writer is handed
 * ONE halfword at a time and moves the byte once for it — and it DOES leave the
 * same id in two hand halfwords of a record, because its "both hands" arms are
 * live (they read byte 2 of the EQUIP-STAT record, reached through the item
 * record's own word-0 pointer: 7 for the 23 two-handed weapons, 8 for the 44
 * behavioural accessories — census in tests/item-store-oracle.test.js). Each of
 * those arms moves the byte ONCE however many halfwords it writes, and
 * `equipApplyRecord` (`engine/dw3/equipment.ts`, the shared port of the original's
 * one equip-apply routine) reproduces that shape. So the count has to come from
 * the record's distinct ids rather than from its halfwords.
 */
function commitRecord(
  state: ItemStoreState,
  partyIdx: number,
  slots: EquipmentSlots,
  target: EquipmentSlots,
): void {
  const before = recordItemIds(slots);
  const after = recordItemIds(target);
  for (const slot of EQUIP_SLOTS) delete slots[slot];
  for (const slot of EQUIP_SLOTS) {
    const id = Number(target[slot]) || 0;
    if (id > 0) slots[slot] = id;
  }
  for (const id of before) {
    if (!after.includes(id)) unwearOne(state, id);
  }
  for (const id of after) {
    if (!before.includes(id)) wearOne(state, id);
  }
}

/**
 * Commit a wear change to ONE slot of a wearer record whose new contents the
 * caller has already worked out — `target` is the whole slot map after the
 * change. This is the pause EQUIP panel's path (web/menu.js builds `target` with
 * `equipItem` / `unequipItem`, which carry the slot-acceptance rules and the
 * two-handed clearing) and `setEquippedItem` below is the same thing with the
 * target built from the id.
 *
 * The occupant of the slot leaves the record ENTIRELY, which for a two-handed
 * piece is both hand halfwords — f10's own second arm (`sh $zr, 0x3c4(stats)` /
 * `sh $zr, 0x3c6(stats)`, exe/f10.s:60-62), applied to the record shape the
 * walker keeps. It does NOT change the count: one item leaving a record is one
 * `worn -= 1`, wherever the original put its single store.
 */
export function commitEquipSlot(
  state: ItemStoreState,
  partyIdx: number,
  slot: EquipSlot,
  target: EquipmentSlots,
): void {
  const slots = ensureRecord(state, partyIdx);
  const prev = Number(slots[slot]) || 0;
  const next = Number(target?.[slot]) || 0;
  const resolved: EquipmentSlots = { ...(target ?? {}) };
  if (prev > 0 && prev !== next) {
    for (const other of EQUIP_SLOTS) {
      if (Number(resolved[other]) === prev) delete resolved[other];
    }
  }
  commitRecord(state, partyIdx, slots, resolved);
}

/**
 * Put `itemId` on `partyIdx`'s `slot`, taking off whatever was there. The wear
 * change as one step, so the wearer record and the worn byte cannot disagree.
 *
 * This is what a screen that owns the wearer record commits through: the pause
 * STATUS/EQUIP pages diff their six slots per member on close
 * (`web/status-translated.js`, `web/status-native.js`), and so do the two
 * merchant pages (`web/shop-translated.js`, `web/shop-native.js`).
 */
export function setEquippedItem(
  state: ItemStoreState,
  partyIdx: number,
  slot: EquipSlot,
  itemId: number | null | undefined,
): void {
  const slots = ensureRecord(state, partyIdx);
  const next = Number(itemId) || 0;
  const target: EquipmentSlots = { ...slots };
  if (next > 0) target[slot] = next;
  else delete target[slot];
  commitEquipSlot(state, partyIdx, slot, target);
}

/**
 * The merchant's EQUIP-screen commit: `next` is the whole slot map after the
 * swap. `stitshop` F0x8008C800 (file 0x9B50) is one routine with the same shape
 * as the pause page's 0x8009A3E8 — a displace arm that takes the piece out of
 * the chosen slot (0x8008C880 worn / 0x8008C884 bag) and an equip arm at
 * 0x8008CA30 (worn) / 0x8008CA34 (bag) — so it commits through the same record
 * writer and the same one-move-per-item rule.
 *
 * It is reached from the merchant's EQUIP screen, where choosing a piece takes
 * the old one off and puts the new one on — NOT from SELL. The merchant's SELL
 * shelf cannot list a worn-only piece at all: its category cursor is clamped to
 * 0..3 (`engine/dw3/ui/shop-sell-machine.ts`, `write(CATEGORY,
 * Math.min(3, old + 1))`) and the four kinds it then asks the resident provider
 * for are the table's first four words at `stitshop` 0x8008CAA8 — 1, 2, 3, 4,
 * every one POSITIVE. A positive kind never consults the worn byte
 * (`exe/f3.s`: `beqz $t0, .Lloop_cond` skips the `lb 0x20f` load), so the shelf
 * admits an id only when the carried byte is non-zero. Gear on a partner's hand is
 * therefore unsellable until you take it off.
 *
 * (The prior reading of the displace arm's address as "before selling" is in
 * docs/research/items/item-store-shared-system-2026-10-03.md §4 and gap 5; it is
 * contradicted by the category cursor's own clamp and by the table's first four
 * words, both read from stitshop. The SELL commit itself, at file 0x40E0-0x410C
 * = RAM 0x80086D90-0x80086DBC, touches the carried byte and the money and never
 * the worn byte at all.)
 */
export function commitEquipEvent(
  state: ItemStoreState,
  partyIdx: number,
  next: EquipmentSlots,
): void {
  const slots = ensureRecord(state, partyIdx);
  commitRecord(state, partyIdx, slots, next ?? {});
}

/**
 * Rebuild the whole worn array from the wearer record.
 *
 * The original never needs this: its four writers keep the byte and the six equip
 * halfwords in step inside one routine. The walker replaces `state.equipment`
 * wholesale in a few places that have nothing to do with a wear change — a save
 * load, a new game, a partner switch in the DRI, where the same gear moves to a
 * different member and the byte does not change — and those call this so the
 * stored array is the wearer records' own tally. The tally counts each id ONCE per
 * record, not once per halfword, for the reason in `commitRecord`. On any
 * consistent save the recomputation reproduces the array exactly, so it is also
 * the migration for a save written before the array existed.
 */
export function syncWornFromEquipment(state: ItemStoreState): void {
  const counts = new Map<number, number>();
  for (const slots of wearableRecords(state)) {
    for (const id of recordItemIds(slots)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const key of Object.keys(state.worn ?? {})) delete state.worn![key];
  for (const [id, n] of counts) writeWorn(state, id, n);
}

/**
 * The ids whose worn byte is non-zero, ascending — the shape a screen seeding the
 * original's second count array wants (`for (id = 1; id <= 402; id++) if (worn)`).
 */
export function wornItemIds(state: ItemStoreState): number[] {
  return Object.keys(state.worn ?? {})
    .map((key) => Number(key))
    .filter((id) => Number.isInteger(id) && id > 0 && id <= ITEM_ID_MAX)
    .sort((a, b) => a - b);
}

/**
 * Set one item's carried count to an exact number, the shape a screen that owns
 * the whole bag (the pause ITEMS page, the post-battle report) commits with.
 * Routes through `add`/`remove`, so it clamps at 99, floors at 0 and runs the
 * auto-unequip exactly like any other change; `from` is the count the caller
 * believes the bag holds, so the difference is applied, not the total.
 */
export function setHeldCount(state: ItemStoreState, id: number, qty: number, from: number): void {
  const wanted = Math.max(0, Math.min(HELD_MAX, Math.trunc(qty) || 0));
  const delta = wanted - from;
  if (delta > 0) addItem(state, id, delta);
  else if (delta < 0) removeItem(state, id, -delta);
}

/**
 * Apply a screen's whole-bag readout: every id the screen lists takes the count it
 * shows, and every id the bag holds that the screen does NOT list goes to 0.
 *
 * This is the shape the pause ITEMS page and the merchant screens commit with —
 * the original hands them the save block and they write the two count arrays
 * wholesale. Routing it through `add`/`remove` keeps the union complete (so an
 * item the screen discarded really leaves the bag, as replacing the array did) and
 * keeps the cap, the floor and the auto-unequip in one place.
 */
export function reconcileHeldCounts(
  state: ItemStoreState,
  entries: Iterable<{ id: number; qty: number }>,
): void {
  const wanted = new Map<number, number>();
  for (const entry of entries) {
    const id = Number(entry?.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    wanted.set(id, Math.max(0, Math.min(HELD_MAX, Math.trunc(entry.qty) || 0)));
  }
  const ids = new Set<number>(wanted.keys());
  for (const slot of state.inventory) ids.add(slot.id);
  for (const id of ids) setHeldCount(state, id, wanted.get(id) ?? 0, heldCount(state, id));
}

/**
 * Empty the bag. The original's new-game path zeroes the save block; nothing else
 * may drop every slot at once.
 */
export function clearBag(state: ItemStoreState): void {
  state.inventory.length = 0;
}