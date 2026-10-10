// The console's sine, shared.
//
// The original calls the resident F0x8002abcc, the standard PlayStation signed
// sine: a full turn is 0x1000 units and the result is 12-bit fixed with
// amplitude 0x1000. It reads a quarter-wave table at D0x80056088 and mirrors it
// across the quadrants (F0x8002ac08).
//
// That table lives in the EXE's data segment, which the disassembly does not
// carry, so the quarter wave is COMPUTED here instead of extracted. The
// quadrant folding is the original's, instruction for instruction; only the
// 1025 table entries are ours, and they can disagree with a real console table
// by at most one unit in 4096. If the table is ever extracted, replace QUARTER
// and nothing else changes.
//
// This lived inside the card duel's animation module until 2026-09-03, when the
// title screen's dim turned out to need the same function. It is the game's
// one sine, so it is now in one place.

const QUARTER: number[] = (() => {
  const t = new Array<number>(0x401);
  for (let i = 0; i <= 0x400; i++) {
    t[i] = Math.round(Math.sin((i * Math.PI * 2) / 0x1000) * 0x1000);
  }
  return t;
})();

/** F0x8002ac08: quarter-wave lookup folded over a full 0x1000-unit turn. */
function rsinTurn(a: number): number {
  if (a < 0x401) return QUARTER[a]!;
  if (a < 0x801) return QUARTER[0x800 - a]!;
  if (a >= 0xc01) return -QUARTER[0x1000 - a]!;
  return -QUARTER[a - 0x800]!;
}

/**
 * F0x8002abcc: sign-folded sine. The angle is in 4096ths of a turn; the result
 * is 12-bit fixed with amplitude 0x1000.
 */
export function rsin(a: number): number {
  return a >= 0 ? rsinTurn(a & 0xfff) : -rsinTurn(-a & 0xfff);
}
