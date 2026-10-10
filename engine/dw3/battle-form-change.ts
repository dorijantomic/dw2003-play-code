// The in-battle form change: the ONE place a Digimon's battle form is changed,
// and the read-time rule that decides what the change is worth.
//
// Two original bodies, both in pro/wfightmn's turn loop (RAM = file offset +
// 0x800A5DE0), and both reached from the event handler at file 0x19d4 =
// 0x800A77B4 (index 1 of the 24-entry table at 0x800AADF0):
//
//   commit            wfightmn.s:1680-1692 (.L0x00001A08-.L0x00001A58)
//     sh speciesId, (liveRecord)   the delay slot of the first jal, so the store
//                                   happens BEFORE either call below reads it.
//   equipped flags    file 0x0C10 = RAM 0x800A69F0 (wfightmn.s:779-852)
//   reserved release  file 0x1548 = RAM 0x800A7328 (wfightmn.s:1369-1428)
//
// What the original does NOT do, confirmed by listing every store in the three
// bodies: no HP, no MP, no stat value, no technique and no ailment is written.
// The only stores are the live form id, the two flag bytes in 0x800A69F0, and
// the reserved-second-form release in 0x800A7328.
//
// The numbers a changed form fights with are therefore never stored: they are
// re-derived on every read. F0x8009EC94 (fightstg.s:29186-29248, .L0x8009ed84
// `.L0x8009ed90`) compares the live form id in the combatant record with the
// roster's own species and, ONLY when they differ, ADDS the live form's species
// record core stats to the roster's own values. So the roster numbers are the
// base and a temporary form's own base stats sit on top of them, on every read,
// with nothing written at the moment of the change.

/** The five stats F0x8009EC94 adds (species record +0x02..+0x0A; CHR is not one). */
export interface FormChangeCoreStats {
  str: number; def: number; spt: number; wis: number; spd: number;
}

/** The combatant record block the form id lives in (party side). */
export const PARTY_RECORD_BASE = 0x800a4470;
export const PARTY_ACTIVE_SLOT = 0x800a4468;
export const PARTY_RECORD_STRIDE = 0x20;
/** record +0x00 the live form, record +0x02 the reserved second form, +0x1A its flag. */
export const COMBATANT_FORM = 0x00;
export const COMBATANT_RESERVED_FORM = 0x02;
export const COMBATANT_RESERVED_FLAG = 0x1a;
/** 0x800A69F0: byte 6 of the slot's word, then byte 7 + the equipped row index. */
export const FORM_FLAG_BASE = 0x80042b84;
export const FORM_FLAG_STRIDE = 4;
export const FORM_FLAG_CHANGED = 6;
export const FORM_FLAG_EQUIPPED = 7;
/**
 * 0x800A7328 zeroes this gauge when the reserved second form was set: the table
 * at 0x80042B1C indexed by the ROSTER KEY times two, plus 0x58
 * (wfightmn.s:1405-1412, `sll $v1, $a1, 0x1` over the roster key).
 */
export const FORM_GAUGE_BASE = 0x80042b1c;
export const FORM_GAUGE_STRIDE = 2;
export const FORM_GAUGE_OFFSET = 0x58;
/** The two resident timeline lookups 0x800A7328 makes through [0x800A4374]. */
export const FORM_RELEASE_KINDS = [0x13, 0x8] as const;
export const EQUIPPED_SLOTS = 3;

const NO_STATS: FormChangeCoreStats = { str: 0, def: 0, spt: 0, wis: 0, spd: 0 };

/**
 * The record and services the commit touches. Both adapters (the original's RAM
 * in the oracle test, the walker's live record in the browser) implement exactly
 * these, so the routine below is the single shared implementation.
 */
export interface FormChangeView {
  /** [0x800A4468]: the acting party slot. */
  activeSlot(): number;
  liveFormId(slot: number): number;
  writeLiveFormId(slot: number, speciesId: number): void;
  /** record +0x1A: the reserved second form (Blast) is standing. */
  reservedSecondForm(slot: number): number;
  /** record +0x02: the form to go back to when the reserved one is released. */
  reservedFormId(slot: number): number;
  clearReservedSecondForm(slot: number): void;
  /** [0x80042B84 + slot*4 + k] = value. */
  setFormFlag(slot: number, k: number, value: number): void;
  /** [0x80042B1C + rosterKey*2 + 0x58] = 0. */
  clearFormGauge(rosterKey: number): void;
  /** [0x800A4374](kind): the timeline index, or negative when there is none. */
  findTimelineIndex(kind: number): number;
  /** [0x800A3868 + index*0x1C] = 0 (a halfword). */
  clearTimelineCounter(index: number): void;
  /** [0x8004B44C](position): the roster key of a party position. */
  rosterKey(position: number): number;
  /** [0x8004B46C](rosterKey, dest): the equipped form triple, -1 for an empty slot. */
  equippedForms(rosterKey: number, dest: number[]): number;
  /** 0x8003EF5C + 0x58*rosterKey, halfword 0: the form the roster's stats are for. */
  rosterSpecies(rosterKey: number): number;
}

/**
 * 0x800A69F0 (wfightmn.s:779-852). Byte 6 of the acting slot's word is set
 * unconditionally; byte 7 + i is set for the equipped row whose form id equals
 * the live form, and the original LEAVES on that first match
 * (`j 0x800a6afc`, wfightmn.s:840, in the delay slot of the store at :841), so
 * only the first matching row is ever marked. The roster's own species
 * short-circuits both lookups when it is already the live form
 * (`.L0x00000ca8 beq`, wfightmn.s:817).
 *
 * The jump target 0x800a6afc is file 0x0D1C (wfightmn.s:846), the routine's own
 * epilogue, so nothing else runs after the mark; see ledger
 * EV-FORM-EQUIPPED-FLAGS-800A69F0-STORES-2026-10-04.
 */
export function markEquippedFormFlags(view: FormChangeView, speciesId: number): void {
  const slot = view.activeSlot();
  view.setFormFlag(slot, FORM_FLAG_CHANGED, 1);
  const key = view.rosterKey(slot);
  if (view.rosterSpecies(key) === speciesId) return;
  const dest: number[] = [];
  if (view.equippedForms(key, dest) <= 0) return;
  for (let i = 0; i < EQUIPPED_SLOTS && i < dest.length; i++) {
    if (dest[i] === speciesId) {
      view.setFormFlag(slot, FORM_FLAG_EQUIPPED + i, 1);
      return;
    }
  }
}

/**
 * 0x800A7328 (wfightmn.s:1369-1428). The first timeline lookup happens
 * unconditionally; the rest runs only while the reserved second form is
 * standing, and it releases it: the gauge is zeroed, the record's +0x02/flag are
 * cleared and a second timeline counter is cleared.
 */
export function releaseReservedSecondForm(view: FormChangeView): void {
  const slot = view.activeSlot();
  const first = view.findTimelineIndex(FORM_RELEASE_KINDS[0]);
  // The original resolves the roster key here and then ignores it: the record it
  // tests is built from the party position (`sll $a1, $a0, 5` + 0x800A4470 in the
  // delay slot, wfightmn.s:1400-1403). The call is reproduced so the service
  // sequence matches; nothing here depends on its answer.
  const key = view.rosterKey(slot);
  if (view.reservedSecondForm(slot) === 0) return;
  if (first >= 0) view.clearTimelineCounter(first);
  view.clearFormGauge(key);
  view.clearReservedSecondForm(slot);
  const second = view.findTimelineIndex(FORM_RELEASE_KINDS[1]);
  if (second >= 0) view.clearTimelineCounter(second);
}

/**
 * The whole manual-Digivolve commit (wfightmn.s:1680-1692): the live form id and
 * nothing else. The caller then starts the change presentation (F0x8008A7F4 with
 * a1 = 0) and steps the turn on; neither touches a stat.
 */
export function commitManualDigivolve(view: FormChangeView, speciesId: number): void {
  view.writeLiveFormId(view.activeSlot(), speciesId);
  markEquippedFormFlags(view, speciesId);
  releaseReservedSecondForm(view);
}

/** The memory the RAM adapter reads and writes (engine/dw3/native/memory.ts). */
export interface FormChangeMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read32(addr: number): number;
  write8(addr: number, value: number): void;
  write16(addr: number, value: number): void;
  write32(addr: number, value: number): void;
}

/** 0x800A3868 + index*0x1C: the timeline record 0x800A7328 zeroes a halfword of. */
export const TIMELINE_BASE = 0x800a3868;
export const TIMELINE_STRIDE = 0x1c;
/** 0x8003EF5C + 0x58*rosterKey: the per-slot profile row. */
export const ROSTER_PROFILE_BASE = 0x8003ef5c;
export const ROSTER_PROFILE_STRIDE = 0x58;

/**
 * The three services 0x800A69F0 and 0x800A7328 call through resident pointers.
 * They are host boundaries here exactly as they are in the form session, so the
 * adapter takes them as callbacks.
 */
export interface FormChangeServices {
  /** [0x800A3868]->0xB0C = [0x800A4374](kind). */
  timelineIndex(kind: number): number;
  /** [0x8004B44C](position): the roster key of a party position. */
  rosterKey(position: number): number;
  /** [0x8004B46C](rosterKey): the equipped triple, -1 for an empty slot. */
  equippedForms(rosterKey: number): number[];
}

/**
 * The adapter over the original's own RAM, so the oracle test can run the shared
 * routine beside the interpreter on the same memory image: every write lands
 * where the interpreter wrote it and the two images are compared.
 */
export function formChangeRamView(
  mem: FormChangeMemory, services: FormChangeServices,
): FormChangeView {
  const record = (slot: number): number => PARTY_RECORD_BASE + slot * PARTY_RECORD_STRIDE;
  return {
    activeSlot: () => mem.read32(PARTY_ACTIVE_SLOT) | 0,
    liveFormId: (slot) => mem.read16(record(slot) + COMBATANT_FORM) | 0,
    writeLiveFormId: (slot, speciesId) => mem.write16(record(slot) + COMBATANT_FORM, speciesId & 0xffff),
    reservedSecondForm: (slot) => mem.read8(record(slot) + COMBATANT_RESERVED_FLAG) | 0,
    reservedFormId: (slot) => mem.read16(record(slot) + COMBATANT_RESERVED_FORM) | 0,
    clearReservedSecondForm: (slot) => mem.write8(record(slot) + COMBATANT_RESERVED_FLAG, 0),
    setFormFlag: (slot, k, value) => mem.write8(FORM_FLAG_BASE + slot * FORM_FLAG_STRIDE + k, value & 0xff),
    clearFormGauge: (rosterKey) =>
      mem.write16(FORM_GAUGE_BASE + rosterKey * FORM_GAUGE_STRIDE + FORM_GAUGE_OFFSET, 0),
    findTimelineIndex: services.timelineIndex,
    clearTimelineCounter: (index) => mem.write16(TIMELINE_BASE + index * TIMELINE_STRIDE, 0),
    rosterKey: services.rosterKey,
    equippedForms: (_rosterKey, dest) => {
      const forms = services.equippedForms(_rosterKey);
      dest.length = 0;
      for (const id of forms) dest.push(id | 0);
      return forms.length;
    },
    rosterSpecies: (rosterKey) =>
      mem.read16(ROSTER_PROFILE_BASE + rosterKey * ROSTER_PROFILE_STRIDE) | 0,
  };
}

/**
 * F0x8009EC94's one form test (fightstg.s .L0x8009ed84-.L0x8009ed90): the live
 * form id in the combatant record against the roster row's own species id. Equal
 * means the roster numbers already are the numbers; different means the live
 * form's own species record is added on top, on every read. A record with no
 * roster form (an enemy, or a battle that never changed form) never differs.
 */
function formChanged(
  liveSpeciesId: number | null | undefined,
  rosterSpeciesId: number | null | undefined,
): boolean {
  if (liveSpeciesId == null || rosterSpeciesId == null) return false;
  const live = Number(liveSpeciesId);
  const roster = Number(rosterSpeciesId);
  if (!Number.isInteger(live) || !Number.isInteger(roster)) return false;
  return live !== roster;
}

/**
 * F0x8009EC94's form rule (fightstg.s .L0x8009ed84-.L0x8009ed90): the live form
 * id against the roster's own species. Equal means the roster numbers already are
 * the numbers; different means the live form's own base stats are added on top,
 * on every read. `base` is the live form's species-record STR..SPD.
 */
export function formChangeCoreStats(
  liveSpeciesId: number | null | undefined,
  rosterSpeciesId: number | null | undefined,
  base: Partial<FormChangeCoreStats> | null | undefined,
): FormChangeCoreStats {
  if (!formChanged(liveSpeciesId, rosterSpeciesId)) return NO_STATS;
  return {
    str: Number(base?.str) || 0, def: Number(base?.def) || 0, spt: Number(base?.spt) || 0,
    wis: Number(base?.wis) || 0, spd: Number(base?.spd) || 0,
  };
}

/**
 * The seven element fields of the effective-stat block, in the original's order:
 * block +0x0C..+0x18 = fire, water, ice, wind, thunder, machine, dark. The seven
 * halfwords F0x8009EC94 adds come from the live form's species record at +0x0E
 * (`pro/fightstg.s:29271` `lhu $v0, 0xe($a1)`, seven iterations, `.L0x8009ede4`),
 * and land in the block through the scratch profile's +0x18..+0x24
 * (`pro/fightstg.s:29336-29347`, the seven halfwords each floored at 1).
 */
export const FORM_ELEMENT_KEYS = [
  "fire", "water", "ice", "wind", "thunder", "machine", "dark",
] as const;

/**
 * The five status resistances of the block, in the original's order: block
 * +0x1A..+0x22 = Poison, Paralyze, Confuse, Sleep, KO. F0x8009EC94 adds the live
 * form's own five bytes here (species record +0x2C..+0x30, five iterations of
 * index 7..11 from `lbu 0x25($v0)`, `pro/fightstg.s:29282-29290`), on top of the
 * roster row's own five bytes, which the same routine stores unconditionally
 * first (`.L0x8009ed68-.L0x8009ed80`). Nothing floors these five.
 */
export const FORM_STATUS_RESIST_KEYS = [
  "poison", "paralyze", "confuse", "sleep", "ko",
] as const;

/** The two species-record tables the read needs: the live form's and the roster's. */
export interface FormChangeSpeciesFields {
  resistances?: Record<string, number> | undefined;
  status_resist?: Record<string, number> | undefined;
}

/** The two halves of the effective-stat block F0x8009EC94 writes past the five stats. */
export interface FormChangeValues {
  /** Block +0x0C..+0x18: the roster row's seven plus the live form's seven. */
  elements: Record<string, number>;
  /** Block +0x1A..+0x22: the roster row's five bytes plus the live form's five. */
  statusResist: Record<string, number>;
}

const NO_ELEMENTS: Record<string, number> = {};
const NO_STATUS_RESIST: Record<string, number> = {};
const EMPTY_VALUES: FormChangeValues = { elements: NO_ELEMENTS, statusResist: NO_STATUS_RESIST };

function pick(map: Record<string, number> | undefined, key: string): number {
  const v = Number(map?.[key]);
  return Number.isFinite(v) ? v : 0;
}

/**
 * The element and status-resistance halves of F0x8009EC94's read
 * (`FIGHTSTG_F0x8009EC94`, `pro/fightstg.s:29186`). Same `beq` as
 * `formChangeCoreStats` and the same rule: while the live form differs from the
 * roster's own species, the live form's species record is ADDED to the roster
 * row's own values on every read, and nothing is stored at the moment of the
 * change.
 *
 * `live` is the live form's species record (the walker's `profile`), `roster` the
 * row the roster's own numbers belong to (the walker's `savedProfile`). With no
 * roster row there is nothing to sit on top of, so the live row's own values are
 * returned unchanged — the walker's behaviour before this rule existed.
 */
export function formChangeValues(
  liveSpeciesId: number | null | undefined,
  rosterSpeciesId: number | null | undefined,
  live?: FormChangeSpeciesFields | null,
  roster?: FormChangeSpeciesFields | null,
): FormChangeValues {
  const base = roster ?? live;
  if (!base) return EMPTY_VALUES;
  const add = roster && formChanged(liveSpeciesId, rosterSpeciesId) ? live : null;
  const elements: Record<string, number> = {};
  for (const key of FORM_ELEMENT_KEYS) {
    // `sh` of a sum, floored at 1 by the block writer (`.L0x8009eea8` / the
    // `blez` arm storing 1).
    elements[key] = Math.max(1, pick(base.resistances, key) + pick(add?.resistances, key));
  }
  const statusResist: Record<string, number> = {};
  for (const key of FORM_STATUS_RESIST_KEYS) {
    statusResist[key] = pick(base.status_resist, key) + pick(add?.status_resist, key);
  }
  return { elements, statusResist };
}