// The per-species technique blocks a roster slot carries, translated from the EXE.
//
// These are the shared system the battle Digivolve form panel (pro/fightstg
// 0x80094F08) and the DRI screen (pro/stgdglab) both read: the per-Digimon
// ACQUIRED-FORM LEDGER. Each roster slot owns 44 fixed 0x14-byte entries; an
// entry is one form the Digimon has acquired:
//
//   +0x00 u16  the form's species id (the search key)
//   +0x02 u8   the form's level in that form
//   +0x03 u8   unused
//   +0x04 u32  digivolution exp banked against the form
//   +0x08 u16  six technique entry words, x6: 13-bit technique id plus the
//              0x2000 (set by the DRI once the technique is loaded onto the
//              partner), 0x4000 (loaded) and 0x8000 (signature) flags
//
// Addresses: `D0x80048D34 + slot*0x3DC + 0x7B8 + 0x14*index`, which is
// `DIGIMON_CUR_STATS + slot*0x3DC + 0x50` (DIGIMON_CUR_STATS sits at
// ctx+0x768, and 0x50 + 0x768 == 0x7B8). The three equipped form ids the panel
// pages off live just below at +0x7B0.
//
// DECODED from ~/ddw3/asm/dw2003/exe/fns.s, and matching the ledger's TL-001
// field layout:
//   F0x8001764C L8113-8130  find the entry index for a form id
//   F0x80017A1C L8318-8357  copy one whole entry out              ([0x8004B47C])
//   F0x800176AC L8095-8140  the three equipped form ids            ([0x8004B46C])
//   F0x80017AB4 L8359-8398  write one whole entry from 20 bytes   ([0x8004B480])
//   F0x80017924 L8250-8316  ACQUIRE a form into the first free slot ([0x8004B478])
// Oracle: tests/lane-b/form-tech-blocks.test.js runs each original address
// beside this translation over the same seeded slot.
//
// F0x80017924 writes the constant 1 into entry+0x02, which is why a freshly
// acquired form starts at level 1; the level itself is written later by the
// whole-entry writer F0x80017AB4, the DRI menu's save path.

import { s16 as sign16 } from "./form-ledger.ts";
import { rosterContextBase } from "./party-context.ts";

export interface FormTechBlockMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The first block, `D0x80048D34 + slot*0x3DC + 0x7B8`. */
export const TECH_BLOCK_BASE = 0x7b8;
/** The three equipped form ids, immediately below the blocks. */
export const EQUIPPED_FORMS_OFFSET = 0x7b0;
export const TECH_BLOCK_STRIDE = 0x14;
export const TECH_BLOCK_SIZE = 0x14;
/** F0x8001764C scans 0x2C = 44 blocks before answering -1. */
export const TECH_BLOCK_COUNT = 0x2c;
/** F0x800176AC and the row list both ignore any species id below 3. */
export const TECH_MIN_SPECIES = 3;
export const EQUIPPED_FORMS_COUNT = 3;
/** The technique-entry flags the panels and the DRI read. */
export const TECH_FLAG_DRI_SET = 0x2000;
export const TECH_FLAG_LOADED = 0x4000;
export const TECH_FLAG_SIGNATURE = 0x8000;
export const TECH_ID_MASK = 0x1fff;
/** The level F0x80017924 gives a form the moment it is acquired. */
export const TECH_LEVEL_NEW = 1;

/** The block address for one roster slot and block index. */
export function formTechBlockAddress(slot: number, index: number): number {
    return (rosterContextBase(slot) + TECH_BLOCK_BASE + (index | 0) * TECH_BLOCK_STRIDE) >>> 0;
}

/** The three equipped form ids of one roster slot. */
export function equippedFormsAddress(slot: number): number {
    return (rosterContextBase(slot) + EQUIPPED_FORMS_OFFSET) >>> 0;
}

/**
 * F0x8001764C(slot, species): the index of the block whose species halfword
 * matches, or -1. A stored id below 3 never matches, and the scan stops after
 * TECH_BLOCK_COUNT blocks.
 */
export function findFormTechBlock(mem: FormTechBlockMemory, slot: number, species: number): number {
    const want = species | 0;
    for (let i = 0; i < TECH_BLOCK_COUNT; i++) {
        const at = formTechBlockAddress(slot, i);
        if (sign16(mem.read16(at)) < TECH_MIN_SPECIES) continue;
        if (sign16(mem.read16(at)) === want) return i;
    }
    return -1;
}

/**
 * F0x80017A1C(slot, species, dest): copy the whole 0x14-byte block into `dest`
 * and answer the block index, or answer -1 and leave `dest` untouched — the
 * original's early exit skips the five word stores entirely.
 */
export function readFormTechBlock(
    mem: FormTechBlockMemory,
    slot: number,
    species: number,
    dest: number,
): number {
    const index = findFormTechBlock(mem, slot, species);
    if (index < 0) return -1;
    const from = formTechBlockAddress(slot, index);
    for (let i = 0; i < TECH_BLOCK_SIZE; i += 4) {
        mem.write32(dest + i, mem.read32(from + i));
    }
    return index;
}

/** F0x80017AB4(slot, species, src): overwrite a species' block from `src`. */
export function writeFormTechBlock(
    mem: FormTechBlockMemory,
    slot: number,
    species: number,
    src: number,
): number {
    const index = findFormTechBlock(mem, slot, species);
    if (index < 0) return -1;
    const to = formTechBlockAddress(slot, index);
    for (let i = 0; i < TECH_BLOCK_SIZE; i += 4) mem.write32(to + i, mem.read32(src + i));
    return index;
}

/**
 * F0x80017924(slot, species): the ACQUIRE path. Answers 0 when the form is
 * already in the ledger; otherwise it takes the first entry whose species
 * halfword is still zero, stamps the species id and the byte 1 into it, and
 * answers 1. A full ledger answers 0 without writing anything.
 */
export function registerFormTechBlock(
    mem: FormTechBlockMemory,
    slot: number,
    species: number,
): number {
    if (findFormTechBlock(mem, slot, species) >= 0) return 0;
    let index = -1;
    for (let i = 0; i < TECH_BLOCK_COUNT; i++) {
        if (sign16(mem.read16(formTechBlockAddress(slot, i))) === 0) { index = i; break; }
    }
    if (index < 0) return 0;
    const at = formTechBlockAddress(slot, index);
    mem.write16(at, species & 0xffff);
    mem.write8(at + 2, TECH_LEVEL_NEW);
    return 1;
}

/**
 * F0x800176AC / [0x8004B46C] (slot, dest): the three species ids the slot's
 * equipped forms resolve to. An equipped id with no block, or one whose block
 * carries a species below 3, is skipped; the tail of `dest` is filled with -1
 * and the kept count is answered. The panel reads `dest` at +0x90 + 2*(cursor-1),
 * so this triple is what its technique pages page over.
 */
export function readEquippedForms(
    mem: FormTechBlockMemory,
    slot: number,
    dest: number,
): number {
    const base = equippedFormsAddress(slot);
    let count = 0;
    for (let i = 0; i < EQUIPPED_FORMS_COUNT; i++) {
        const wanted = sign16(mem.read16(base + i * 2));
        if (wanted < TECH_MIN_SPECIES) continue;
        const index = findFormTechBlock(mem, slot, wanted);
        if (index < 0) continue;
        const species = mem.read16(formTechBlockAddress(slot, index));
        if (species < TECH_MIN_SPECIES) continue;
        mem.write16(dest + count * 2, species & 0xffff);
        count += 1;
    }
    for (let i = count; i < EQUIPPED_FORMS_COUNT; i++) mem.write16(dest + i * 2, 0xffff);
    return count;
}