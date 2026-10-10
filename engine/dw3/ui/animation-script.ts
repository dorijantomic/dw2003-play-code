// Shared one-shot animation family, form E (cursor at +0/+2).
// Authority: stage-anim-script-stepper-oneshot-cursor0-family; canonical
// docs/research/field/stage-overlay-shared-routines-2026-08-11.md.
// cnty_sel F0x80083304; original assembly at cnty_sel.s:412–466.

export interface AnimationScriptMemory {
  read16(address: number): number;
  write16(address: number, value: number): void;
}

/** Advance {s16 index, s16 remaining} through {s16 frame, s16 duration} rows.
 * The recursive call advances the cursor but its return is deliberately ignored:
 * the caller publishes its immediate next row even when several holds expire.
 */
export function stepOneShotAnimation(
  mem: AnimationScriptMemory, cursor: number, table: number,
  nesting: number, frameDelta: () => number,
): number {
  const signed = (v: number) => (v << 16) >> 16;
  let row = table + signed(mem.read16(cursor)) * 4;
  const delta = Math.min(frameDelta() | 0, 4);
  if (nesting === 0) mem.write16(cursor + 2, mem.read16(cursor + 2) - delta);
  if (signed(mem.read16(cursor + 2)) > 0) return signed(mem.read16(row));
  row += 4;
  mem.write16(cursor, mem.read16(cursor) + 1);
  mem.write16(cursor + 2, mem.read16(cursor + 2) + mem.read16(row + 2));
  if (signed(mem.read16(row)) === 0xff) return 0xff;
  stepOneShotAnimation(mem, cursor, table, (nesting + 1) | 0, frameDelta);
  return signed(mem.read16(row));
}
