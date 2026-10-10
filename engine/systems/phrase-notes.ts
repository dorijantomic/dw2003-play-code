/**
 * One SPU voice per note-on — the 2D phrase's own note renderer.
 *
 * ## Why a phrase is not one sound
 *
 * A bit-31-clear sound id is a SEQ **phrase**, not one sample: the disc's
 * `mpcommon/1.seq` and `2.seq` hold 32 mini scores, one per voice slot, and the
 * driver plays a phrase note by note. `F0x8003581c` (exe, `fns.s:40883-41354`)
 * is that sequencer, and its per-note loop is:
 *
 * 1. `F0x8003769c` (`fns.s:42886-42961`) expands the note into one entry per VAB
 *    tone whose `[note_min, note_max]` range covers it — a layered note gives
 *    two entries, so **two voices**.
 * 2. For every entry, `jal F0x80034b9c` at `fns.s:41033` (`.L0x80035a74`) takes
 *    one voice from the shared 24-voice pool. The priority it is handed is byte
 *    0 of that note's own tone record: `lbu $v1, ($v0)` at `fns.s:41016` stores
 *    it into the one global `D0x80082677` (`sb $v1, -0x7($s0)`, `fns.s:41018`)
 *    that the allocator compares every voice against.
 * 3. A refusal is not fatal to the phrase: `fns.s:41039-41040` writes -1 into
 *    the return value and **falls into the next entry**, so that one note is
 *    silent and the rest of the phrase still plays.
 * 4. The voice is written (`fns.s:41046-41290`) and keyed on. Its note-off frees
 *    it again — and the note-off frees the pool slot **immediately**, while the
 *    SPU's own envelope is still ringing the release out: both branches of the
 *    key-off clear the record at once (`F0x8003670c` at `fns.s:41864-41881` and
 *    `F0x8003674c` at `fns.s:41884-41931`, the latter then writing the SPU key-off
 *    mask registers). A one-shot that runs out of sample frees it too.
 *
 * ## What this module is
 *
 * The audio half of one of those voices: one sample, played at the note's
 * pitch, at the note's volume, held until its note-off and then decayed with the
 * tone's own ADSR2 release. It is a port of `render_phrase_voice16` in
 * `build_sfx.py`, which renders what `web/assets/sfx/<name>.wav` mixes together.
 * `tests/sfx-phrase-voices.test.js` compares every note this module renders
 * against the digest the build recorded for it, for every phrase the walker
 * ships, so the two renderers are pinned to each other voice by voice.
 *
 * The sample itself is the SPU's: one VAG, looped between its own loop points
 * when it has them (`web/sfx-voice/samples/<vag>.wav`, decoded by the same
 * `decode_vag_pcm` the build uses).
 */

/** The decode rate every VAB sample and every rendered note is at. */
export const SAMPLE_RATE = 44100;
/**
 * The envelope floor, -40 dB — the point at which a released voice is stopped.
 * `build_sfx.py:FLOOR`, and the same figure the mix it renders stops at.
 */
export const PHRASE_NOTE_FLOOR = 0.01;
/**
 * `ln(1/0.01)` — an exponential release is rendered this many time-constants
 * long, because that is where it crosses the floor.
 */
export const PHRASE_NOTE_EXP_TAU = 4.61;

/** One note-on of a phrase, as `build_sfx.py` emits it into phrases.json. */
export interface PhraseNote {
  /** When the note-on lands, in samples from the phrase's start. */
  start: number;
  /** The 1-based VAG field this note plays (`web/sfx-voice/samples/<n>.wav`). */
  sample: number;
  /** Playback pitch: `2^((note - center + shift/128) / 12)`, clamped at 4.0. */
  rate: number;
  /** Samples from the note-on to its note-off, where the release starts. */
  relStart: number;
  /** The tone's ADSR2 release: exponential (time constant) or linear (ramp). */
  release: { mode: "exp" | "lin"; seconds: number };
  /** The note's velocity x the tone's own volume, both 0..127. */
  gain: number;
  /** Byte 0 of this note's tone record — what the voice pool is asked for. */
  priority: number;
  note: number;
  program: number;
  vel: number;
  channel: number;
  /** Length and sha256 of this note's own render, as the build computed it. */
  voice: { samples: number; sha256: string };
}

/** A decoded VAG sample: its length and its ADPCM loop points, in samples. */
export interface PhraseSample {
  file: string;
  samples: number;
  loopStart: number | null;
  loopEnd: number | null;
}

const clamp16 = (n: number) => (n < -32768 ? -32768 : n > 32767 ? 32767 : n);

/**
 * Render one note-on voice, the way `render_phrase_voice16` in build_sfx.py
 * renders the note inside the phrase mix: the sample at the note's pitch,
 * truncated and clipped per sample, held until `relStart` — the note-off — and
 * then decayed with the tone's real ADSR2 release.
 *
 * That release is what the SPU does when a voice is keyed off mid-sample: a
 * looped sample keeps looping through the release, a one-shot keeps playing out
 * (and simply ends). The voice stops when the envelope falls below -40 dB, or
 * when a one-shot runs out of sample.
 *
 * The result is ONE voice's contribution to the mix, as 16-bit PCM — the same
 * numbers the build sums into `web/assets/sfx/<name>.wav`, and what one
 * AudioBufferSource plays. `tests/sfx-phrase-voices.test.js` checks this render
 * against the digest the build recorded on the note row.
 */
export function renderPhraseNote(
  pcm: ArrayLike<number>,
  sample: PhraseSample,
  note: PhraseNote,
): Int16Array {
  const { rate, relStart } = note;
  const ls = sample.loopStart ?? null;
  const le = sample.loopEnd ?? null;
  const looping = ls !== null && le !== null && le > ls;
  const loopFrom = looping ? (ls as number) : 0;
  const loopTo = looping ? (le as number) : 0;
  const rmode = note.release?.mode === "lin" ? "lin" : "exp";
  const rtime = Number(note.release?.seconds) || 0;
  let relN = Math.trunc(rtime * SAMPLE_RATE);
  if (rmode === "exp") relN = Math.trunc(rtime * SAMPLE_RATE * PHRASE_NOTE_EXP_TAU);
  let n = relStart + Math.max(relN, 1);
  // A one-shot has no loop points: the SPU stops it when the sample ends, so the
  // release never gets a chance to run past the sample.
  if (!looping) n = Math.min(n, Math.trunc(pcm.length / rate));
  const out = new Int16Array(Math.max(0, n));
  const gain = Number(note.gain) || 0;
  let len = 0;
  for (let i = 0; i < n; i++) {
    let sp = i * rate;
    if (looping && sp >= loopTo) {
      sp = loopFrom + ((sp - loopFrom) % (loopTo - loopFrom));
    }
    const j = Math.trunc(sp);
    if (j + 1 >= pcm.length) break;
    const frac = sp - j;
    let s = (pcm[j] as number) * (1 - frac) + (pcm[j + 1] as number) * frac;
    if (i >= relStart) {
      const t = (i - relStart) / SAMPLE_RATE;
      const env = rmode === "exp" ? Math.exp(-t / rtime) : Math.max(0, 1 - t / rtime);
      if (env < PHRASE_NOTE_FLOOR) break;
      s *= env;
    }
    // build_sfx.py clips every sample of every voice on its own
    // (`max(-32768, min(32767, int(s)))`) before the voices are summed, which is
    // what the SPU's mixer does to each voice it adds.
    out[len++] = clamp16(Math.trunc(s * gain));
  }
  return len === out.length ? out : out.subarray(0, len);
}