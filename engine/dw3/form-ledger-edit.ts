// The form-ledger writers the fight report's reward services call, translated
// from the resident EXE. They are the write side of form-ledger.ts (matcher and
// validator): the save context's slot-table entries +0x273C, +0x2740, +0x2744 and
// +0x274C.
//
// Oracle: tests/form-ledger-edit-oracle.test.js runs each original address
// through engine/native over the same seeded save context and compares the
// touched ledger, the emitted buffer and the returned value.
//
// DECODED from the resident image (disassembled 2026-09-30; the slot table is
// D0x80048D34+0x2700..):
//   F0x800177D0 setEquippedForms  (+0x273C) (slot, in)  write the three equipped
//               form ids: each input form is looked up in the ledger and the
//               entry's own id is stored, else 0xFFFF.
//   F0x80017898 acquiredForms     (+0x2740) (slot, out) list every ledger entry
//               id >= 3 into `out`, zero-fill the rest of 0x2C halfwords, return
//               the count.
//   F0x80017924 addForm           (+0x2744) (slot, form) claim the first ledger
//               entry whose id is exactly 0: id = form, form level byte = 1. Returns
//               1 when added, 0 when the form is already there or the ledger is
//               full. (The original also calls the profile lookup and discards
//               its result; that lookup is pure, so the port omits it.)
//   F0x80017AB4 writeFormEntry    (+0x274C) (slot, form, in) copy five words from
//               `in` over the form's ledger entry. Returns the entry index or -1.
import { rosterContextBase } from "./roster-records.ts";
import {
  EQUIPPED_FORM_BASE, EQUIPPED_FORM_COUNT, FORM_ENTRY_BASE, FORM_ENTRY_COUNT, FORM_ENTRY_STRIDE,
  FORM_MIN_ID, ROSTER_SLOT_STRIDE, SAVE_CONTEXT, findFormLedgerIndex, s16,
} from "./form-ledger.ts";

export interface FormLedgerEditMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read32(addr: number): number;
  write8(addr: number, value: number): void;
  write16(addr: number, value: number): void;
  write32(addr: number, value: number): void;
}

const slotBase = (slot: number): number => rosterContextBase(slot);
const entryAddress = (slot: number, index: number): number =>
  (slotBase(slot) + FORM_ENTRY_BASE + index * FORM_ENTRY_STRIDE) >>> 0;

/** F0x800177D0(slot, in): store the ledger's own id for each of three input forms, else 0xFFFF. */
export function setEquippedForms(mem: FormLedgerEditMemory, slot: number, input: number): void {
  for (let i = 0; i < EQUIPPED_FORM_COUNT; i++) {
    const form = s16(mem.read16(input + i * 2));
    const index = findFormLedgerIndex(mem, slot, form);
    const value = index >= 0 ? mem.read16(entryAddress(slot, index)) : 0xffff;
    mem.write16(slotBase(slot) + EQUIPPED_FORM_BASE + i * 2, value);
  }
}

/** F0x80017898(slot, out): every acquired ledger id into `out`, zero padded; returns the count. */
export function acquiredForms(mem: FormLedgerEditMemory, slot: number, out: number): number {
  let count = 0;
  for (let i = 0; i < FORM_ENTRY_COUNT; i++) {
    const at = entryAddress(slot, i);
    if (s16(mem.read16(at)) >= FORM_MIN_ID) {
      mem.write16(out + count * 2, mem.read16(at));
      count++;
    }
  }
  for (let k = count; k < FORM_ENTRY_COUNT; k++) mem.write16(out + k * 2, 0);
  return count;
}

/** F0x80017924(slot, form): claim the first empty (id 0) ledger entry; 1 when added. */
export function addForm(mem: FormLedgerEditMemory, slot: number, form: number): number {
  if (findFormLedgerIndex(mem, slot, form) !== -1) return 0;
  let free = -1;
  for (let i = 0; i < FORM_ENTRY_COUNT; i++) {
    if (s16(mem.read16(entryAddress(slot, i))) === 0) { free = i; break; }
  }
  if (free === -1) return 0;
  const at = entryAddress(slot, free);
  mem.write16(at, form & 0xffff);
  mem.write8(at + 2, 1);
  return 1;
}

/** F0x80017AB4(slot, form, in): overwrite the form's ledger entry with five words; index or -1. */
export function writeFormEntry(mem: FormLedgerEditMemory, slot: number, form: number, input: number): number {
  const index = findFormLedgerIndex(mem, slot, form);
  if (index === -1) return -1;
  const at = entryAddress(slot, index);
  for (let i = 0; i < 5; i++) mem.write32(at + i * 4, mem.read32(input + i * 4));
  return index;
}
