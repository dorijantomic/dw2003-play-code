// The training gym's stat rolls, translated from the original pro/stgtrain bodies.
//
// Oracle: tests/lane-b/gym-rolls.test.js runs each original through engine/native
// and compares the return value, every stat store and the ordered service calls.
//
//   F0x800861BC gymRollCoreGain     primary core-stat gain (stat ids 1..5).
//   F0x800862D0 gymRollCoreLoss     secondary core-stat loss (stat ids 1..5): skipped on an odd
//                                   random, clamped at zero.
//   F0x800863D4 gymRollElementGain  element-point gain (stat ids 8..14): the row comes from the
//                                   species growth byte and the current point band (< 100,
//                                   < 300, else).
//   F0x800865A0 gymRollHpMpGain     max HP (stat id 15) / max MP (stat id 16) gain.
//   F0x80086ABC gymRepBonus         the rep-hit bonus from the worn accessories: 3 with a
//                                   Training Book (item 0x151) in either slot, else 6 with a
//                                   Power Brace (0x152), else 0. The session adds 0x4B.
//
// Each roll reads an 8-byte table row { base, spread } from the overlay data tail and
// produces `base + random % spread` (just `base` when the spread is zero), adds it to a
// halfword of the partner's stats block and returns the amount it rolled.
//
// Random source. Every roll, and the loss gate, calls the resident random service cell
// [0x8004DC0C] (F0x8001933C, a 16-bit value). The loss routine reaches the same cell as
// [0x8004DC04 + 8]: its base register is 0x8004DC04 and the load offset is 8, so there is no
// second generator. The port takes that one service as `host.rand`.
//
// Object fields read: session +0x50 screen, +0x5C roster slot, +0x60 drill id (13 or more is
// a super drill), +0xD8 Ultra Training Chance won; screen +0x7C the TP choice (0, 1, 2).
export const GYM_GAIN_TABLE = 0x8008c304;
export const GYM_LOSS_TABLE = 0x8008c364;
export const GYM_ELEMENT_POINTERS = 0x8008c454;
export const GYM_HPMP_TABLE = 0x8008c490;
export const GYM_SPECIES_TABLE = 0x8003ef5c;
export const GYM_SPECIES_STRIDE = 0x58;

export interface GymRollMemory {
  read8(addr: number): number;
  read16(addr: number): number;
  read32(addr: number): number;
  write16(addr: number, value: number): void;
}

export interface GymRollHost {
  /** [0x8004B484](slot) = F0x80017B4C: the partner's stats block (record + 8). */
  recordBlock(slot: number): number;
  /** [0x8004DC0C]() = F0x8001933C: a 16-bit random value. */
  rand(): number;
}

const s16 = (v: number): number => (v << 16) >> 16;

/** base + (rand % spread) from one table row; a zero spread is the fixed amount. */
function rollRow(mem: GymRollMemory, row: number, host: Pick<GymRollHost, "rand">): number {
  const spread = mem.read32(row + 4) | 0;
  if (spread === 0) return mem.read32(row) | 0;
  return ((mem.read32(row) | 0) + ((host.rand() | 0) % spread)) | 0;
}

/** F0x800861BC(session, stat): the primary core-stat gain. */
export function gymRollCoreGain(mem: GymRollMemory, session: number, stat: number, host: GymRollHost): number {
  const block = host.recordBlock(mem.read32(session + 0x5c));
  if (((stat - 1) >>> 0) >= 5) return 0;
  const ptr = (block + stat * 2 + 0x26) >>> 0;
  const base = (mem.read32(session + 0x60) | 0) < 0xd ? 0 : 6;
  const tp = mem.read32(mem.read32(session + 0x50) + 0x7c) | 0;
  const row = (GYM_GAIN_TABLE + (base + ((mem.read32(session + 0xd8) | 0) * 3 + tp)) * 8) >>> 0;
  const gain = rollRow(mem, row, host);
  const sum = (mem.read16(ptr) + gain) & 0xffff;
  mem.write16(ptr, sum);
  if (s16(sum) >= 0x3e8) mem.write16(ptr, 0x3e7);
  return gain;
}

/** F0x800862D0(session, stat): the secondary core-stat loss. */
export function gymRollCoreLoss(mem: GymRollMemory, session: number, stat: number, host: GymRollHost): number {
  const block = host.recordBlock(mem.read32(session + 0x5c));
  if (((stat - 1) >>> 0) >= 5) return 0;
  if ((host.rand() & 1) !== 0) return 0;
  const ptr = (block + stat * 2 + 0x26) >>> 0;
  const tp = mem.read32(mem.read32(session + 0x50) + 0x7c) | 0;
  const row = (GYM_LOSS_TABLE + tp * 8) >>> 0;
  const loss = rollRow(mem, row, host);
  const left = (mem.read16(ptr) - loss) & 0xffff;
  mem.write16(ptr, left);
  if (s16(left) < 0) mem.write16(ptr, 0);
  return loss;
}

/** F0x800863D4(session, stat): the element-point gain. */
export function gymRollElementGain(mem: GymRollMemory, session: number, stat: number, host: GymRollHost): number {
  if (((stat - 8) >>> 0) >= 7) return 0;
  const block = host.recordBlock(mem.read32(session + 0x5c));
  const ptr = (block + stat * 2 + 0x24) >>> 0;
  const current = s16(mem.read16(ptr));
  const slot = mem.read32(session + 0x5c) | 0;
  const growth = mem.read8((GYM_SPECIES_TABLE + slot * GYM_SPECIES_STRIDE + (stat - 8) + 0x49) >>> 0);
  const band = current < 0x64 ? 0 : current < 0x12c ? 1 : 2;
  const pointer = mem.read32((GYM_ELEMENT_POINTERS + (((growth - 1) * 3 + band) | 0) * 4) >>> 0);
  let variant = 0;
  if ((mem.read32(session + 0xd8) | 0) !== 0) variant = (mem.read32(session + 0x60) | 0) < 0xd ? 1 : 2;
  const tp = mem.read32(mem.read32(session + 0x50) + 0x7c) | 0;
  const row = (pointer + (variant + tp * 3) * 8) >>> 0;
  const gain = rollRow(mem, row, host);
  const sum = (mem.read16(ptr) + gain) & 0xffff;
  mem.write16(ptr, sum);
  if (s16(sum) >= 0x3e8) mem.write16(ptr, 0x3e7);
  return gain;
}

/** F0x800865A0(session, stat): the max HP (0xF) or max MP (0x10) gain. */
export function gymRollHpMpGain(mem: GymRollMemory, session: number, stat: number, host: GymRollHost): number {
  if (((stat - 0xf) >>> 0) >= 2) return 0;
  const block = host.recordBlock(mem.read32(session + 0x5c));
  const ptr = stat === 0xf ? (block + 0x22) >>> 0 : (block + 0x26) >>> 0;
  let variant = 0;
  if ((mem.read32(session + 0xd8) | 0) !== 0) variant = (mem.read32(session + 0x60) | 0) < 0xd ? 1 : 2;
  const tp = mem.read32(mem.read32(session + 0x50) + 0x7c) | 0;
  const row = (GYM_HPMP_TABLE + (variant + tp * 3) * 8) >>> 0;
  const gain = rollRow(mem, row, host);
  const sum = (mem.read16(ptr) + gain) & 0xffff;
  mem.write16(ptr, sum);
  if (s16(sum) >= 0x2710) mem.write16(ptr, 0x270f);
  return gain;
}

/** The accessory item ids the rep bonus looks for. */
export const GYM_TRAINING_BOOK = 0x151;
export const GYM_POWER_BRACE = 0x152;

/** F0x80086ABC(session): the rep-hit bonus from the worn accessories. */
export function gymRepBonus(mem: GymRollMemory, session: number, host: Pick<GymRollHost, "recordBlock">): number {
  const block = host.recordBlock(mem.read32(session + 0x5c));
  const first = s16(mem.read16(block + 0x3c8));
  if (first === GYM_TRAINING_BOOK || s16(mem.read16(block + 0x3ca)) === GYM_TRAINING_BOOK) return 3;
  if (first === GYM_POWER_BRACE || s16(mem.read16(block + 0x3ca)) === GYM_POWER_BRACE) return 6;
  return 0;
}
