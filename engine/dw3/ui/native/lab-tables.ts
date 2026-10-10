// The Digimon lab's two species lookups, translated from pro/stgdglab F0x8008F3D8 and F0x8008F424.
//
// Both walk the overlay's 6-byte records at 0x8008F628 (u16 key, s16 word1, s16 word2), stopping at
// the first zero key, and return one word of the record whose key equals the argument, else 0.
// A table whose first key is zero is empty. The keys are the save's form ids (the species profile
// table's value0); word1 is the chart's portrait column and word2 the portrait clip.
//
// Oracle: tests/lane-b/lab-tables.test.js runs both originals through engine/native.
// The m2c text steps `s16 *` by 6 elements; the assembly (addiu v1, v1, 6) steps 6 bytes.
export const LAB_SPECIES_TABLE = 0x8008f628;
export const LAB_SPECIES_STRIDE = 6;

export interface LabTablesMemory {
  read16s(addr: number): number;
}

function lookup(mem: LabTablesMemory, key: number, field: number): number {
  let row = LAB_SPECIES_TABLE;
  if (mem.read16s(row) === 0) return 0;
  for (;;) {
    if (mem.read16s(row) === (key | 0)) return mem.read16s(row + field);
    row += LAB_SPECIES_STRIDE;
    if (mem.read16s(row) === 0) return 0;
  }
}

/** F0x8008F3D8(form): the record's first word (the portrait column), 0 when the form is not listed. */
export function labSpeciesWord1(mem: LabTablesMemory, form: number): number { return lookup(mem, form, 2); }

/** F0x8008F424(form): the record's second word (the portrait clip), 0 when the form is not listed. */
export function labSpeciesWord2(mem: LabTablesMemory, form: number): number { return lookup(mem, form, 4); }
