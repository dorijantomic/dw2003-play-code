// The menu selection cursor.
//
// BASIS: web/shop.js, whose cursor the operator has confirmed correct against
// the real game, and whose comment records that rig stills caught it mid-slide.
// The shop is the reference implementation; this module generalises it so every
// other screen inherits the same motion instead of re-deriving it.
//
// The confirmed behaviour is a POSITION ping-pong: the cursor glyph slides
// right and back over a 4-step cycle [0, 1, 2, 1] pixels. The shop advances it
// at 8 steps per second, which at PAL's 50 Hz is 6.25 vsyncs per step —
// matching the 6-ticks-per-frame preset decoded for the shared cursor class
// (ledger UI-CURSORCLASS-B364-001, constructor field +0x78 = 6). Two
// independent routes to the same cadence, so 6 vsyncs is used here.
//
// ── UNRECONCILED, deliberately not implemented ──────────────────────────────
// UI-CURSOR-GLYPH-SEQUENCE-001 reads the cursor as a GLYPH ping-pong, cycling
// extended glyphs 0x84, 0x85, 0x86, 0x87, 0x86, with a 32-tick rest on frame 0
// before each cycle (constructor field +0x74 = 0x20).
//
// That does not reconcile with the shipped font: the extracted extended table
// holds 114 entries, indices 0..113, so 0x84 (132) is out of range and cannot
// be an extended-table index. The claim derives those numbers from a rule that
// "0x81 N selects extended glyph N-1" applied to the table words 0x8581,
// 0x8681, 0x8781, 0x8881 — but 0x81 is also a Shift-JIS lead byte, and the
// game's text is Shift-JIS, so that byte pair may simply be a Shift-JIS
// character rather than an extended-glyph escape.
//
// Two things therefore remain open, and neither is guessed at here:
//   1. whether the cursor animates by swapping glyphs or by sliding position
//      (they may be the same thing if the glyphs are pre-shifted copies), and
//   2. whether a 32-tick rest precedes each cycle. The shop shows none, and a
//      0.64s pause at PAL would be conspicuous, so it is not implemented.
// Resolving these needs the real cursor glyphs identified in the font, not
// another reading of the pointer table.

/** Sub-pixel offsets of the confirmed 4-step slide, in pixels. */
export const CURSOR_SLIDE = [0, 1, 2, 1] as const;

/**
 * Vsyncs per step. Decoded as constructor preset +0x78 = 6
 * (UI-CURSORCLASS-B364-001) and independently matched by the shop's 8 steps/sec
 * at PAL 50 Hz.
 */
export const CURSOR_FRAME_TICKS = 6;

/** Vsyncs for one full cycle. */
export const CURSOR_PERIOD_TICKS = CURSOR_FRAME_TICKS * CURSOR_SLIDE.length;

export interface CursorAnim {
  step: number;     // which entry of CURSOR_SLIDE is showing
  elapsed: number;  // vsyncs accumulated toward the next step
  frozen: boolean;  // +0x7c: snaps back to step 0 and stops
  visible: boolean; // +0x64, preset to 1 by the constructor
}

export function createCursorAnim(): CursorAnim {
  return { step: 0, elapsed: 0, frozen: false, visible: true };
}

/**
 * Advance by `ticks` vsyncs and return the horizontal pixel offset to add to
 * the cursor's base x. Freezing snaps to offset 0, matching the original
 * handler's behaviour when the freeze field is set.
 */
export function tickCursor(c: CursorAnim, ticks = 1): number {
  if (c.frozen) {
    c.step = 0;
    c.elapsed = 0;
    return CURSOR_SLIDE[0] ?? 0;
  }
  c.elapsed += ticks;
  while (c.elapsed >= CURSOR_FRAME_TICKS) {
    c.elapsed -= CURSOR_FRAME_TICKS;
    c.step = (c.step + 1) % CURSOR_SLIDE.length;
  }
  return CURSOR_SLIDE[c.step] ?? 0;
}

/** The current offset without advancing. */
export function cursorOffset(c: CursorAnim): number {
  return CURSOR_SLIDE[c.frozen ? 0 : c.step] ?? 0;
}

/**
 * The offset for a free-running clock, for call sites that keep wall time
 * rather than a per-cursor tick count — this is the form web/shop.js uses.
 * `seconds` is elapsed time; PAL 50 Hz is assumed for the vsync conversion.
 */
export function cursorOffsetAtTime(seconds: number, vsyncHz = 50): number {
  const ticks = Math.floor(seconds * vsyncHz);
  const step = Math.floor(ticks / CURSOR_FRAME_TICKS) % CURSOR_SLIDE.length;
  return CURSOR_SLIDE[step] ?? 0;
}
