// The shared item store against the ORIGINAL three resident routines.
//
//   F0x800161D8  exe/fns.s .L0x800161d8  add / remove one item (99 cap, 0 floor, worn removal)
//   F0x80015F04  exe/fns.s .L0x80015f04  read the carried / worn counts
//   F0x800135E8  exe/f3.s                walk one of the five id directories
//
// The originals are run through engine/native over this repo's resident image
// (web/assets/native/screens/resident.bin, the exe's own bytes at base 0x80010000)
// and the store's answers are compared value for value. Nothing here trusts the
// .s TEXT: two of the three routines print misleading operands
// (`addu $a0, $v0` for the raw `addu $v0, $a0, $v0`, and a short-form `slt` whose
// operands the text transposes), and the flag==0 arm of F0x80015F04 contains two
// delay slots that cancel each other out — a reading of the text alone gets that
// one wrong.
//
// The party-slot resolver F0x800161D8 calls through [D0x80048D34 + 0x2718] is a
// host pointer the field installs, so the auto-unequip arm is reached with a stub
// that answers the slot index, exactly as the real pointer does (it is called with
// the slot number in $a0 and answers the roster record index in $v0).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
  addItem, heldCount, listItemIds, ownsItem, removeItem, wornCount,
  heldArrayAddress, wornArrayAddress, readItemArrays, writeItemArrays,
  syncWornFromEquipment, commitEquipEvent,
  ITEM_DIRECTORY_COUNT, ITEM_ID_MAX,
} from "../engine/dw3/item-store.ts";
// The walker's port of the original's ONE equip-apply routine, which is what the
// merchant's F0x8008C800 is compared against below.
import { equipApplyRecord } from "../engine/dw3/equipment.ts";

const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const overlay = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/pro_stitshop.bin", import.meta.url)));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const services = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };

const SAVE = 0x80048d34;         // the save/party/collection block
const HELD = 0x7c;               // SAVE + 0x7c + id  = carried count
const WORN = 0x20f;              // SAVE + 0x20f + id = worn count
const ROSTER = 0x8004949c;       // DIGIMON_CUR_STATS, stride 0x3DC
const STRIDE = 0x3dc;
const ITEM_RECORD = 0x80041838;  // f5: the 12-byte item record base
const PARTY_SLOT_POINTER = SAVE + 0x2718;
const RECORD_RESOLVER = SAVE + 0x2750;  // stitshop F0x8008C800's wearer-record resolver
const STUB = 0x80100000;
const ADD_OR_REMOVE = 0x800161d8;
const READ_COUNTS = 0x80015f04;
const BUILD_LIST = 0x800135e8;
const F5 = 0x8001355c;                   // the item provider at [0x80042B98]
const EQUIP_APPLY = 0x8008c800;          // stitshop's equip-apply, file 0x9B50

function boot() {
  const rt = new NativeStageRuntime(overlay, entry, services, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
  });
  rt.cpu.gp = 0x8005cb50;
  // The party-slot resolver: returns its argument, so party slot k maps to roster k.
  rt.cpu.setStub(STUB, (cpu) => cpu.reg(4));
  rt.mem.write32(PARTY_SLOT_POINTER, STUB);
  return rt;
}

/** The walker's own bag, as the store sees it. */
const bag = (rows) => ({ inventory: rows.map(([id, qty]) => ({ id, qty })), equipment: [] });

/** `count` copies of `id` worn, one per party member — how the original reaches a
 *  worn count above 1 (its writer is handed one slot of one record and moves the
 *  byte once for it). Never two halfwords of ONE record: no reachable writer in
 *  the original leaves the same id there twice, so the store counts a record's
 *  distinct ids. */
function wornRecords(id, count) {
  const records = [{ right: id }];
  while (records.length < count) records.push({ right: id });
  return records.slice(0, count);
}

function setHeld(rt, id, qty) { rt.mem.write8(SAVE + HELD + id, qty); }
function setWorn(rt, id, qty) { rt.mem.write8(SAVE + WORN + id, qty); }

test("the generated id directories are the disc's own pointer table at 0x80042BC8", () => {
  const rt = boot();
  for (let kind = 0; kind < ITEM_DIRECTORY_COUNT; kind++) {
    const original = [];
    let cursor = rt.mem.read32(0x80042bc8 + kind * 4) >>> 0;
    while (rt.mem.read16(cursor) !== 0) { original.push(rt.mem.read16(cursor)); cursor += 2; }
    assert.deepEqual(listItemIds(bag([]), kind), [], `an empty bag lists nothing (kind ${kind})`);
    assert.deepEqual(
      listItemIds(bag(original.map((id) => [id, 1])), kind), original,
      `directory ${kind} ids and their order`,
    );
  }
  // The five directories partition ids 1..402 with nothing left over.
  const rt2 = boot();
  const everything = [];
  for (let kind = 0; kind < ITEM_DIRECTORY_COUNT; kind++) {
    let cursor = rt2.mem.read32(0x80042bc8 + kind * 4) >>> 0;
    while (rt2.mem.read16(cursor) !== 0) { everything.push(rt2.mem.read16(cursor)); cursor += 2; }
  }
  assert.deepEqual([...everything].sort((a, b) => a - b), Array.from({ length: ITEM_ID_MAX }, (_, i) => i + 1));
});

test("F0x800135E8 and the store's list agree id for id, held and worn, in order", () => {
  const rt = boot();
  const bags = [
    [[43, 1], [44, 2], [92, 1], [292, 1], [9, 1], [402, 1]],
    [[1, 1], [2, 5], [40, 3], [360, 1], [395, 1]],
    [[66, 1], [90, 99], [43, 1], [361, 2]],
    [[214, 1], [215, 1], [291, 1], [292, 1], [359, 1]],
  ];
  const kinds = [0, 1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5];
  const DEST = 0x80190000;
  for (const rows of bags) {
    for (let id = 1; id <= ITEM_ID_MAX; id++) { setHeld(rt, id, 0); setWorn(rt, id, 0); }
    for (const [id, qty] of rows) setHeld(rt, id, qty);
    // One worn-only id per bag, so the negative-kind form is exercised too.
    setWorn(rt, 176, 1); setWorn(rt, 300, 1); setWorn(rt, 5, 1);
    for (const kind of kinds) {
      const count = rt.cpu.call(BUILD_LIST, [kind, DEST]);
      const original = Array.from({ length: count }, (_, i) => rt.mem.read16(DEST + i * 2));
      const state = bag(rows);
      // The worn byte is STORED (the second count array), so a state that says
      // "these two Digimon hold these pieces" has to say so in the store's array.
      // `syncWornFromEquipment` is the store's own rule: the byte array counts
      // wearer RECORDS, one per record that names the id, which is what
      // F0x800161D8's four writers keep.
      state.equipment = [{ right: 176, acc0: 300 }, { acc0: 5 }];
      syncWornFromEquipment(state);
      assert.deepEqual(listItemIds(state, kind), original,
        `kind ${kind} for bag ${JSON.stringify(rows)}`);
    }
  }
});

test("F0x80015F04 is an equality predicate, and the store's possession answers it", () => {
  const rt = boot();
  const cases = [];
  for (const held of [0, 1, 2, 99]) for (const worn of [0, 1, 2]) cases.push([held, worn]);
  for (const [held, worn] of cases) {
    for (const id of [1, 40, 43, 92, 176, 292, 359, 402]) {
      setHeld(rt, id, held);
      setWorn(rt, id, worn);
      // The item on as many party members as there are worn copies, so wornCount
      // is the number itself and not just "is any worn".
      const state = bag(held ? [[id, held]] : []);
      state.equipment = wornRecords(id, worn);
      syncWornFromEquipment(state);
      // flag != 0 asks "do we have any": carried OR worn answers 1.
      assert.equal(rt.cpu.call(READ_COUNTS, [id, 1]), held !== 0 || worn !== 0 ? 1 : 0,
        `the flag=1 arm (id ${id} held ${held} worn ${worn})`);
      assert.equal(ownsItem(state, id), held !== 0 || worn !== 0, "the store's possession agrees");
      // flag == 0 is the MIRROR question — "do we hold none" — and it counts a
      // worn-but-not-carried item as having it. It is not a count: the branch's
      // delay slot writes the answer, so the byte it loaded never survives. The
      // original's text reads as if the count were returned; the executed code
      // returns the equality of possession and expectation.
      assert.equal(rt.cpu.call(READ_COUNTS, [id, 0]), held !== 0 || worn !== 0 ? 0 : 1,
        `the flag=0 arm (id ${id} held ${held} worn ${worn})`);
      assert.equal(heldCount(state, id), held, `the carried byte for id ${id}`);
      assert.equal(wornCount(state, id), worn, `the worn count for id ${id}`);
    }
  }
});

test("F0x800161D8's add arm holds at 99 and its remove arm floors at 0", () => {
  const rt = boot();
  for (const id of [9, 43, 92, 176, 292, 402]) {
    for (const start of [0, 1, 50, 97, 98, 99]) {
      for (const value of [0, 1, 2, 7]) {
        setHeld(rt, id, start);
        setWorn(rt, id, 0);
        const state = bag([[id, start]]);
        // The routine moves ONE copy per call, so the store is stepped with it.
        for (let step = 0; step < Math.max(1, value); step++) {
          if (value) addItem(state, id, 1); else removeItem(state, id, 1);
          rt.cpu.call(ADD_OR_REMOVE, [id, value ? 1 : 0]);
          assert.equal(heldCount(state, id), rt.mem.read8(SAVE + HELD + id),
            `id ${id} from ${start}, ${value ? `add ${value}` : "remove 5"} step ${step}`);
        }
        assert.ok(heldCount(state, id) <= 99, `id ${id} never passes the cap`);
      }
    }
  }
  // A grant at the cap is neither refused nor announced: the byte simply stays 99.
  setHeld(rt, 43, 99);
  const atCap = bag([[43, 99]]);
  addItem(atCap, 43, 1);
  assert.equal(heldCount(atCap, 43), 99);
  // Removing more than is carried lands on 0, and the slot goes away with it.
  setHeld(rt, 43, 1);
  const one = bag([[43, 1]]);
  for (let step = 0; step < 5; step++) {
    removeItem(one, 43, 1);
    rt.cpu.call(ADD_OR_REMOVE, [43, 0]);
  }
  assert.equal(heldCount(one, 43), rt.mem.read8(SAVE + HELD + 43));
  assert.equal(heldCount(one, 43), 0);
  assert.deepEqual(one.inventory, [], "an emptied slot is dropped, as the original has no slot to keep");
});

test("F0x800161D8's zero branch takes the item off the wearer and drops one worn copy", () => {
  const rt = boot();
  const ID = 176;
  const slots = (record, slot) => ROSTER + record * STRIDE + 0x3c0 + slot * 2;

  // Party member 0 wears it in the right hand (roster record +0x3C4).
  for (let i = 0; i < 6; i++) { rt.mem.write16(slots(0, i), 0); }
  rt.mem.write16(slots(0, 2), ID);
  setHeld(rt, ID, 0);
  setWorn(rt, ID, 1);
  rt.cpu.call(ADD_OR_REMOVE, [ID, 0]);
  assert.equal(rt.mem.read16(slots(0, 2)), 0, "the original cleared the hand");
  assert.equal(rt.mem.read8(SAVE + WORN + ID), 0, "and dropped one worn copy");
  const mine = bag([[ID, 0]]);
  mine.equipment = [{ right: ID }];
  syncWornFromEquipment(mine);
  removeItem(mine, ID, 1);
  assert.deepEqual(mine.equipment, [{}], "the store took it off the same hand");
  assert.equal(wornCount(mine, ID), 0);

  // Nobody in the party wears it, but an obtained roster record does: the second
  // loop (eight records at stride 0x3DC, gated on record +0x760 >= 3) finds it.
  for (let record = 0; record < 8; record++) {
    for (let i = 0; i < 6; i++) rt.mem.write16(slots(record, i), 0);
    rt.mem.write32(ROSTER + record * STRIDE + 0x760, 0);
  }
  rt.mem.write16(slots(1, 2), ID);
  rt.mem.write32(ROSTER + 1 * STRIDE + 0x760, 4);   // obtained
  setHeld(rt, ID, 0);
  setWorn(rt, ID, 2);
  rt.cpu.call(ADD_OR_REMOVE, [ID, 0]);
  assert.equal(rt.mem.read16(slots(1, 2)), 0, "the roster loop cleared the hand");
  assert.equal(rt.mem.read8(SAVE + WORN + ID), 1, "one worn copy left");
});

test("the \"both hands\" arms read the WIELD byte, through the item record's own pointer", () => {
  // Every "clear both hands / write both hands" arm and every accessory-pair loop
  // in the disc's own code — f10 (exe/f10.s:42 and :54), the pause page's
  // displace / hand-pick / equip (ststatus.s:24056-24065, :24156-24165,
  // :24163-24172) and its accessory loop, and the merchant's copies
  // (stitshop.s:9981-9990, :10002-10006, :10094-10098, :10039-10074) — does this:
  //
  //     lui $v0, 0x8004 / lw $v0, 0x2b98($v0)   # the provider at [0x80042B98]
  //     jalr $v0                                # -> f5, F0x8001355C
  //     lw   $v1, ($v0)                         # WORD 0 of that item record
  //     lbu  $v1, 0x2($v1)                      # byte 2 of the record it names
  //
  // Word 0 is a POINTER to the item's equip-stat record, so the byte compared with
  // 7 (and with 8) is the WIELD DESCRIPTOR, not the item record's own byte 2.
  // This test pins both halves: the pointer step, and what each byte reads.
  const rt = boot();
  const equipStatByte = (id) => {
    const itemRecord = rt.mem.read32(ITEM_RECORD + 12 * id) >>> 0;   // the `lw`
    if (itemRecord < 0x80010000 || itemRecord >= 0x80010000 + resident.length) return null;
    return rt.mem.read8(itemRecord + 2);                             // the `lbu`
  };
  // ...and the ORIGINAL f5 is asked where that pointer comes from, id for id.
  for (const id of [1, 43, 92, 176, 178, 190, 275, 292, 316, 359, 402]) {
    const returned = rt.cpu.call(F5, [id]) >>> 0;
    assert.equal(returned, id > 0 ? (ITEM_RECORD + 12 * id) : 0,
      `f5(${id}) is 0x80041838 + 12*id`);
  }

  const groups = new Map();
  for (let id = 1; id <= ITEM_ID_MAX; id++) {
    const byte = equipStatByte(id);
    if (!groups.has(byte)) groups.set(byte, []);
    groups.get(byte).push(id);
  }
  const range = (ids) => {
    const out = [];
    for (const id of ids) {
      const last = out[out.length - 1];
      if (last && last[1] === id - 1) last[1] = id;
      else out.push([id, id]);
    }
    return out.map(([a, z]) => (a === z ? a : `${a}-${z}`)).join(",");
  };
  // The census that matters: 7 for the two-handed weapons, 8 for the behavioural
  // accessories. Both arms therefore FIRE — the withdrawn claim read 7 and 8 as
  // out of range because it stopped one load short.
  assert.equal(range(groups.get(7)), range(Array.from({ length: 23 }, (_, i) => 176 + i)),
    "byte 2 through the pointer is 7 for exactly the 23 two-handed weapons, ids 176-198");
  assert.equal(groups.get(7).length, 23);
  assert.equal(equipStatByte(178), 7, "the Zweihander 178 reads 7");
  assert.equal(equipStatByte(176), 7, "the Claymore 176 reads 7");
  assert.equal(equipStatByte(190), 7, "the Long Bow 190 reads 7");
  assert.equal(groups.get(8).length, 44, "and 8 for exactly the 44 behavioural accessories");
  assert.equal(range(groups.get(8)), "316-359");
  assert.equal(equipStatByte(316), 8);
  // The rest of the table, so the test is a census and not two spot checks.
  assert.deepEqual(
    [...groups].map(([byte, ids]) => [byte, ids.length]).sort((x, y) => (x[0] ?? -1) - (y[0] ?? -1)),
    [[null, 51], [0, 54], [1, 1], [2, 18], [3, 93], [4, 42], [5, 27], [6, 24], [7, 23], [8, 44],
     [10, 13], [15, 1], [30, 2], [32, 2], [64, 2], [96, 1], [136, 1], [200, 1], [208, 1], [244, 1]],
    "the whole byte-2 census across ids 1..402, read through the pointer");
  // The 51 NULL pointers are the key / story items, which have no equip record.
  assert.equal(range(groups.get(null)), range([...Array(42)].map((_, i) => i + 1).concat([360], Array.from({ length: 8 }, (_, i) => 395 + i))));

  // The NEGATIVE CONTROL, which is what the withdrawn claim actually measured:
  // the ITEM record's own byte 2 really is the catalogue category and really does
  // read only 0, 4 and 5 — one byte away from the byte the arms read.
  const categories = new Set();
  for (let id = 1; id <= ITEM_ID_MAX; id++) categories.add(rt.mem.read8(ITEM_RECORD + 12 * id + 2));
  assert.deepEqual([...categories].sort((a, b) => a - b), [0, 4, 5],
    "the item record's OWN byte 2 is 0, 4 or 5 — which is why reading it made these arms look dead");
  assert.notEqual(rt.mem.read8(ITEM_RECORD + 12 * 178 + 2), equipStatByte(178),
    "and for the Zweihander the two bytes differ, so the pointer step is not a detail");
});

test("the ORIGINAL merchant equip-apply F0x8008C800: both hands for a two-hander, one worn copy", () => {
  // `stitshop F0x8008C800` (file 0x9B50) run over the disc's own bytes, with the
  // two host pointers it calls stubbed the way the field answers them: the
  // party-slot resolver at [0x80048D34 + 0x2750] hands back a wearer record, and
  // the item provider at [0x80042B98] is f5 itself, which is resident.
  // Arguments: $a1 = the chosen slot (0..5), $a2 = the new item id, $a3 = the flag
  // that gates every count store; `move_ $s4, $s0` in the `beqz`'s delay slot is
  // how $a2 reaches $s4, and `move_ $s7, $a3` how the flag reaches $s7.
  //
  // What a player sees is the 2026-09-10 live capture
  // (docs/research/ui/captures/shop-heavyarmory-2026-09-10.md): buying the
  // Zweihander 178 over a Buckler 275 in the left hand left +0x3C4 = 178 AND
  // +0x3C6 = 178, the Buckler back in the bag, "equipped 1", and the pause sheet
  // reading Head / Body / Zweihander / Zweihander / Accessory / Accessory.
  const SLOT_ORDER = ["head", "body", "right", "left", "acc0", "acc1"];
  const halfword = (i) => ROSTER + 0x3c0 + i * 2;
  const rt = boot();
  rt.cpu.setStub(RECORD_RESOLVER, () => ROSTER);
  rt.mem.write32(SAVE + 0x2750, RECORD_RESOLVER);

  /** Run the original once and read the record and both count bytes back. */
  const original = (start, itemId, slot) => {
    for (let i = 0; i < 6; i++) rt.mem.write16(halfword(i), 0);
    for (let id = 0; id <= ITEM_ID_MAX; id++) { setHeld(rt, id, 0); setWorn(rt, id, 0); }
    for (const [name, id] of Object.entries(start)) {
      setHeld(rt, id, 1); setWorn(rt, id, 1);
      rt.mem.write16(halfword(SLOT_ORDER.indexOf(name)), id);
    }
    if (itemId > 0) setHeld(rt, itemId, 1);
    rt.cpu.call(EQUIP_APPLY, [0, slot, itemId, 1]);
    return {
      record: SLOT_ORDER.map((name, i) => [name, rt.mem.read16(halfword(i))]).filter(([, id]) => id),
      counts: Object.fromEntries(
        [...new Set([itemId, ...Object.values(start)])].filter((id) => id > 0)
          .map((id) => [id, [rt.mem.read8(SAVE + HELD + id), rt.mem.read8(SAVE + WORN + id)]])),
    };
  };

  // The capture's case, exactly.
  const cap = original({ left: 275 }, 178, SLOT_ORDER.indexOf("right"));
  assert.deepEqual(cap.record, [["right", 178], ["left", 178]],
    "the original writes the Zweihander into BOTH hand halfwords");
  assert.deepEqual(cap.counts, { 178: [0, 1], 275: [2, 0] },
    "one worn copy of it, none carried; the Buckler went back to the bag");

  // A one-handed sword in the right hand over a worn two-hander: the class-7
  // displace arm frees BOTH hands and returns one copy of the big sword.
  assert.deepEqual(original({ right: 178, left: 178 }, 92, 2).record, [["right", 92]],
    "and a displaced two-hander gives up both hands");
  assert.deepEqual(original({ right: 178, left: 178 }, 92, 2).counts, { 92: [0, 1], 178: [2, 0] });

  // Taking a two-hander off the right-hand row frees both hands for one copy.
  const off = original({ right: 178, left: 178 }, 0, 2);
  assert.deepEqual(off.record, [], "Unequip on the Right row clears both hand halfwords");
  assert.deepEqual(off.counts, { 178: [2, 0] }, "and returns exactly one copy");

  // A two-hander over a one-handed sword in the RIGHT hand: the displace arm
  // returns the sword, and the two-handed pick finds nothing left to take.
  const overSword = original({ right: 92 }, 178, 2);
  assert.deepEqual(overSword.record, [["right", 178], ["left", 178]]);
  assert.deepEqual(overSword.counts, { 178: [0, 1], 92: [2, 0] });

  // Every case above, and the walker's own record writer, agree halfword for
  // halfword and byte for byte.
  for (const [start, itemId, slot] of [
    [{ left: 275 }, 178, 2],
    [{ right: 92 }, 178, 2],
    [{ right: 178, left: 178 }, 92, 2],
    [{ right: 178, left: 178 }, 92, 3],
    [{ right: 178, left: 178 }, 0, 2],
    [{ acc0: 316, acc1: 317 }, 292, 4],
    [{ acc0: 292, acc1: 316 }, 292, 4],
  ]) {
    const before = {};
    for (const [name, id] of Object.entries(start)) before[name] = id;
    const want = original(start, itemId, slot);
    const walker = equipApplyRecord(before, SLOT_ORDER[slot], itemId);
    assert.deepEqual(
      SLOT_ORDER.map((name, i) => [name, walker.next[name] ?? 0]).filter(([, id]) => id),
      want.record,
      `walker and original agree on the record for ${JSON.stringify(start)} -> ${itemId} in ${SLOT_ORDER[slot]}`);
    // ...and on the counts, by running the same record through the store.
    const state = { inventory: [], equipment: [{ ...before }] };
    syncWornFromEquipment(state);
    commitEquipEvent(state, 0, walker.next);
    const wantCounts = {};
    for (const [id, [held, worn]] of Object.entries(want.counts)) {
      wantCounts[id] = [held - (Object.values(start).includes(Number(id)) ? 1 : 0), worn];
    }
    for (const [id, [held, worn]] of Object.entries(wantCounts)) {
      assert.deepEqual([heldCount(state, Number(id)), wornCount(state, Number(id))], [held, worn],
        `walker and original agree on the counts for ${JSON.stringify(start)} -> ${itemId} in ${SLOT_ORDER[slot]} (item ${id})`);
    }
  }
});
test("writeItemArrays/readItemArrays place all 402 ids where the original reads them", () => {
  // The save block's two count arrays as the memory card carries them
  // (stgmcard.s:3514-3560 copies 0x80048D34..0x8004B3F8 whole; state 0x47 copies
  // the same span back). The writer under test is the shipped port; the reader
  // that judges it is the ORIGINAL F0x80015F04, asked about every id.
  const rt = boot();
  const rows = [];
  for (let id = 1; id <= ITEM_ID_MAX; id++) {
    const held = id % 7 === 0 ? 99 : (id * 13) % 100;
    const worn = id % 11 === 0 ? 3 : 0;
    rows.push({ id, held, worn });
    setHeld(rt, id, 0);
    setWorn(rt, id, 0);
  }
  writeItemArrays(rt.mem, rows, SAVE);

  const read = readItemArrays(rt.mem, SAVE);
  assert.equal(read.length, ITEM_ID_MAX, "one row per id");
  assert.deepEqual(read, rows, "every id's two bytes come back where they were written");
  assert.ok(heldArrayAddress(ITEM_ID_MAX, SAVE) + 1 <= SAVE + 0x26c4);
  assert.ok(wornArrayAddress(ITEM_ID_MAX, SAVE) + 1 <= SAVE + 0x26c4);

  // The original agrees about every one of them: the flag != 0 arm answers 1 while
  // the item is carried OR worn, and 0 only when both bytes are zero.
  for (const row of rows) {
    const expect = row.held !== 0 || row.worn !== 0 ? 1 : 0;
    assert.equal(rt.cpu.call(READ_COUNTS, [row.id, 1]), expect,
      `the original reads id ${row.id} (held ${row.held}, worn ${row.worn}) at SAVE+0x7C+id`);
    assert.equal(rt.cpu.call(READ_COUNTS, [row.id, 0]), expect ? 0 : 1, `the mirror for id ${row.id}`);
  }

  // The high band the old `id < 256` guard dropped is included and unmasked: the
  // whole accessory tail and the top of the id space are ordinary bytes.
  for (const id of [256, 292, 321, 328, 330, 332, 337, 360, 395, 401, 402]) {
    const row = rows[id - 1];
    assert.equal(rt.mem.read8(SAVE + HELD + id), row.held, `held byte for id ${id}`);
    assert.equal(rt.mem.read8(SAVE + WORN + id), row.worn, `worn byte for id ${id}`);
  }
});
