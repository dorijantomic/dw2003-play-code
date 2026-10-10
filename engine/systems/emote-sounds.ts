/**
 * The field scene object's emote-sound dispatch — `SETANIM 813 <C>`.
 *
 * The resident scene object (registry id 0x32d, `SETANIM` first operand 813) has
 * notify handler F0x800837EC = fieldstg file offset 0xb3c. Its tail dispatches the
 * opcode's SECOND operand (`C`) through a 0x1f-entry jump table that sits at the
 * overlay base (RAM 0x80082CB0 = fieldstg file offset 0):
 *
 *   .L0x00000cec  sltiu $v0, ($s1 - 0x365), 0x1f      ; C 0x365..0x383
 *   .L0x00000cf0  beqz  $v0, .L0x00000ecc              ; else the >0x383 branch
 *   .L0x00000d00  addu  $v1, table, (C-0x365)*4
 *   .L0x00000d0c  jr    $v0                            ; slot handler
 *
 * Each slot handler loads a packed sound word with `lui $a0, hi` (+ an `ori` or
 * delay-slot `ori`) and jumps to the shared play tail 0x80083b74, which calls the
 * play cell [0x80055C48]. A slot pointing at the silent default 0x80083B7C plays
 * nothing. The two the walker's field events actually reach most — 0x369 (DEMO_BGM,
 * 0x60040002) and 0x37E (PIYOPIYO, 0x00040013) — are plain table slots.
 *
 * The routines for `C >= 0x384` (0x384 play 0xA0042FCB, 0x385/0x386 key that id
 * off) live in the branch the `beqz` selects at .L0x00000ecc; they are the only
 * live entries there, because that block is reachable only when `C - 0x365 >= 0x1f`
 * (i.e. `C >= 0x384`, or `C < 0x365` which matches nothing). The block also holds
 * comparisons against 0x366/0x367/0x370/0x371/0x382, but those ids take the jump
 * table and can never reach it — they are dead compares, and their table slots are
 * the silent default. (docs/research/audio/emote-sound-table.json, written from an
 * earlier pass, still lists 0x366 GAYALOOP / 0x370 RECOVERY; the binary does not
 * play them from `SETANIM 813`. Recorded for the lead, not rewritten here.)
 *
 * Read-only: the test re-derives the jump-table slots straight from
 * web/assets/native/fieldstg.bin, the same way tools/extract_emote_sounds.py does.
 */

/** First `SETANIM 813 <C>` value the jump table covers. */
export const EMOTE_SOUND_MIN = 0x365;
/** Last `SETANIM 813 <C>` value the jump table covers (0x1f slots). */
export const EMOTE_SOUND_MAX = 0x383;

/**
 * The jump-table slots that play a sound: `C -> packed id`, straight out of the
 * fieldstg image. A `C` absent here and from `EMOTE_SOUND_STOPS` is the silent
 * default (a `0x1f`-slot entry that points at 0x80083B7C).
 */
export const EMOTE_SOUND_PLAY: Readonly<Record<number, number>> = {
  0x365: 0x00b80001,
  0x368: 0x80e8383c,
  0x369: 0x60040002, // DEMO_BGM — the Giant Hill-area event cue (SETANIM 813 873)
  0x36a: 0x00a40006,
  0x36b: 0x805458bd,
  0x36c: 0x800410bd,
  0x36d: 0x803c503c,
  0x36e: 0x01100000,
  0x36f: 0x01100002,
  0x374: 0x00700001,
  0x375: 0x00040015,
  0x377: 0x8004113e,
  0x378: 0x8110303c,
  0x379: 0x81103240,
  0x37a: 0x0004001d,
  0x37c: 0x00440001,
  0x37d: 0x00340004,
  0x37e: 0x00040013, // PIYOPIYO — fires on s615/s685 events (SETANIM 813 894)
  0x37f: 0x800429bf,
  0x380: 0x800430bd,
  0x381: 0x80042dc7,
  0x383: 0x8004103c,
  // The >0x383 branch (.L0x00000ecc): 0x384 plays 0xA0042FCB through the play
  // cell and stores its voice handle for 0x385 to key off. No shipped event
  // issues 0x384, but the branch is decoded and kept so the table is complete.
  0x384: 0xa0042fcb,
};

/**
 * The `C >= 0x384` branch ids that STOP a sound by handle ([0x80055C50]) rather
 * than start one. 0x385 keys off 0xA0042FCB (0x384's voice); 0x386 keys off
 * 0xA054583C, a sound no live path starts — a no-op. A stop of a sound the walker
 * never started does nothing, so hosts may treat these as no-ops.
 */
export const EMOTE_SOUND_STOPS: Readonly<Record<number, number>> = {
  0x385: 0xa0042fcb,
  0x386: 0xa054583c,
};

/** A `SETANIM 813 <C>` cue: the packed sound word and whether it stops that word. */
export interface EmoteSoundCue {
  id: number;
  /** true => the branch keys the id off by handle instead of playing it. */
  stop: boolean;
}

/**
 * Resolve a `SETANIM 813 <C>` second operand to its sound cue, or null when the
 * dispatcher plays nothing (the silent default slot, or a `C` the table does not
 * cover at all).
 */
export function emoteSound(c: number): EmoteSoundCue | null {
  if (Object.prototype.hasOwnProperty.call(EMOTE_SOUND_PLAY, c)) {
    return { id: EMOTE_SOUND_PLAY[c]!, stop: false };
  }
  if (Object.prototype.hasOwnProperty.call(EMOTE_SOUND_STOPS, c)) {
    return { id: EMOTE_SOUND_STOPS[c]!, stop: true };
  }
  return null;
}

/** The packed id a `SETANIM 813 <C>` plays, or null when it plays nothing. */
export function emoteSoundId(c: number): number | null {
  const cue = emoteSound(c);
  return cue && !cue.stop ? cue.id : null;
}
