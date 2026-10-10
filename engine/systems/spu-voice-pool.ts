/**
 * The SPU voice pool — a port of the original's one voice allocator,
 * `F0x80034b9c` (exe, `fns.s:40073-40231`, section "fns3_1.0x80034b9c").
 *
 * Both sound paths take a voice from this one pool: the positional/panned call
 * `F0x8003432c` at `fns.s:39631` (`.L0x8003452c: jal F0x80034b9c`) and the 2D
 * phrase sequencer `F0x8003581c` at `fns.s:41033` (`.L0x80035a74: jal
 * F0x80034b9c`). So it is a shared system, not a per-screen one: every cue the
 * game plays — UI blip, footstep, jingle, technique, effect loop — asks the
 * same 24 slots.
 *
 * ## The pool's size
 *
 * One signed byte, `D0x8008265c`, is both the loop bound and the refusal value.
 * `F0x8003078c` calls the sound init with 24 in the argument's delay slot —
 * `fns.s:35460-35461`:
 *
 *     .L0x800307c4: jal F0x800354cc
 *     .L0x800307c8: li $a0, 0x18
 *
 * and the init clamps it to at most 24 before storing it — `fns.s:40723-40732`:
 *
 *     .L0x800355a0: sltiu $v0, $v1, 0x18
 *     .L0x800355b0: lui $at, %hi(D0x8008265c) / sb $v0, ...   -> 24
 *
 * ## The scan, one field at a time
 *
 * The voice record table is `D0x80081e3a`, stride 0x38 (`fns.s:40096-40098`:
 * `sll $v0,$v1,0x3 / subu $v0,$v1 / sll $v1,$v0,0x3`), so with the table base
 * at 0 the record fields the allocator reads are:
 *
 * | offset | read | field |
 * |---|---|---|
 * | +0x00 | `lhu` `fns.s:40133` | age counter — "how long since this voice was last taken" |
 * | +0x04 | `lhu` `fns.s:40107` | sample left — 0x7fff when idle (`fns.s:40246-40250`) |
 * | +0x18 | `lh` `fns.s:40117-40119` | the priority this voice was given |
 * | +0x1b | `lb` `fns.s:40099-40101` | keyed-on flag (set `fns.s:41046-41048`, cleared `fns.s:41869-41871`) |
 *
 * The loop walks voices 0..N-1 and skips any whose bit is set in the 32-bit
 * mask `D0x8005c070` (`fns.s:40089-40094`). No writer for that mask exists
 * anywhere in the exe, so it reads as 0 and no voice is skipped; it is kept
 * because the scan is written against it.
 *
 * Per voice, in order:
 *
 * 1. **Free wins immediately.** `+0x1b == 0 && u16[+0x04] == 0`
 *    (`fns.s:40099-40112`) jumps straight out at `fns.s:40111`
 *    (`j .L0x80034d14`) — the lowest free index, and no age bookkeeping at all.
 * 2. **Lower priority is stealable** (`fns.s:40123`: `slt $v0, $a2, $a1`,
 *    a signed compare of the voice's priority against the running best, which
 *    starts at the request). The winner is remembered unconditionally
 *    (`fns.s:40127-40128`), so this is a plain minimum search.
 * 3. **Equal priority** then compares the sample left, unsigned, smallest first
 *    (`fns.s:40143`: `sltu $v0, $a1, $a0`) — cut the voice with the least audio
 *    still on it — and then the age, signed, largest first
 *    (`fns.s:40159`: `slt $v0, $t0, $v0`) — cut the one taken longest ago.
 * 4. **Higher priority is never stolen**: `fns.s:40136` (`bne $a2, $a1,
 *    .L0x80034d00`) skips the voice.
 *
 * ## When nothing qualifies
 *
 * `fns.s:40169-40176` — if no index was chosen and the `found` flag is clear,
 * the routine stores `u8 D0x8008265c` and returns it. `D0x8008265c` is the voice
 * count, so the return is an index one past the end: the callers read it as a
 * refusal and **drop the sound** rather than steal. `F0x8003432c` returns -1 at
 * `fns.s:39637-39642` (`bne $a0, $v0` / `sw $zr, D0x80081594` + `li $v0, -0x1`)
 * and the sequencer bails at `fns.s:41039-41040` (`slt $v1, $a0, $v1` /
 * `beqz $v1, .L0x80035ce8`).
 *
 * ## On a successful steal
 *
 * `fns.s:40184-40203` bumps the age of every unmasked voice, `fns.s:40213-40215`
 * zeroes the winner's age, and `fns.s:40216-40228` writes the *requested*
 * priority back into the winner.
 *
 * ## The pool at boot
 *
 * `F0x800354cc` zeroes `+0x04` and `+0x1b` on every voice
 * (`fns.s:40762-40774`), so all 24 are free the moment sound comes up, and it
 * seeds the age counter with 24 (`fns.s:40749/40762` `li $s5, 0x18`, stored at
 * `fns.s:40749/40762`). `+0x04 = 0x7fff` is not the idle value: it is what
 * `F0x80034e0c` writes when it parks a listed voice looping forever
 * (`fns.s:40246-40250`), and such a voice is deliberately not free.
 */

/** The allocator itself. */
export const SPU_VOICE_ALLOCATOR = 0x80034b9c;
/** The one signed byte that is both the pool size and the refusal value. */
export const SPU_VOICE_COUNT_SYMBOL = 0x8008265c;
/** The init's clamp: `sltiu $v0, $v1, 0x18`. */
export const SPU_VOICE_COUNT_LIMIT = 0x18;
/** The size the game asks for: `li $a0, 0x18` in the init call's delay slot. */
export const SPU_VOICE_COUNT = 0x18;
/** The voice-skip mask, one bit per voice. */
export const SPU_VOICE_MASK = 0x8005c070;
/** The single global holding the priority of the sound being allocated. */
export const SPU_PRIORITY_REQUEST = 0x80082677;
/** The voice record table, stride 0x38. */
export const SPU_VOICE_TABLE = 0x80081e3a;
export const SPU_VOICE_STRIDE = 0x38;

/** Record field offsets, relative to the record's own address. */
export const SPU_VOICE_AGE = 0x00;
export const SPU_VOICE_SAMPLE_LEFT = 0x04;
export const SPU_VOICE_PRIORITY = 0x18;
export const SPU_VOICE_KEYED = 0x1b;
/** `li $v0, 0x7fff` — the loop-forever sample count, never a free voice. */
export const SPU_VOICE_SAMPLE_LEFT_LOOP = 0x7fff;
/** `li $s5, 0x18` — the age counter the sound init seeds every voice with. */
export const SPU_VOICE_AGE_AT_BOOT = 0x18;
/** `li $t3, 0x63` — "no index yet", distinct from the refusal value. */
const NO_INDEX = 0x63;
/** What `allocate` returns when the original would have refused. */
export const SPU_NO_VOICE = SPU_VOICE_COUNT;

/** What the caller of a voice has to give back when the voice is taken. */
export interface SpuOccupant {
  /** Called by the pool's owner to key the stolen voice off. */
  release(): void;
  /** Whatever identifies the playing source, so `finish` can check identity. */
  src?: unknown;
}

export interface SpuVoiceRecord {
  /** +0x1b — the voice is keyed on. */
  keyed: boolean;
  /** +0x04 — sample left, as the 16-bit counter the SPU side decrements. */
  sampleLeft: number;
  /** +0x18 — the priority this voice was last allocated with. */
  priority: number;
  /** +0x00 — the age counter. */
  age: number;
  /** Whoever is holding the voice, and what to release to key it off. */
  occupant: SpuOccupant | null;
}

export interface SpuAllocation {
  /** The voice taken, 0..count-1. */
  index: number;
  /** The sound that was holding it — key this off before starting the new one. */
  evicted: SpuOccupant | null;
  /** True when a genuinely idle voice was taken (no age bookkeeping happened). */
  idle: boolean;
}

export interface SpuVoicePoolOptions {
  /** Pool size; the original stores `min(s8 arg, 24)`. */
  count?: number;
  /** `D0x8005c070` — one bit per voice, set bits are skipped entirely. */
  masked?: number;
  /** Milliseconds, used to age a voice's sample-left counter down. */
  now?: () => number;
}

const clamp16 = (n: number) => Math.max(0, Math.min(0xffff, Math.round(n)));
/** `lh` / `lhu` on a 16-bit field: one number, read either way. */
const signed16 = (n: number) => (clamp16(n) & 0x8000 ? clamp16(n) - 0x10000 : clamp16(n));
/** The age counter is a 16-bit up-counter; `fns.s:40155-40159` compares it signed. */
const age16 = (n: number) => clamp16(n);

/**
 * The pool. `now` and the occupant's own length reporting drive the
 * sample-left field, which is what the original's tie-break reads; with no
 * clock every voice reports the length its owner gave it, unchanged.
 */
export function createSpuVoicePool(options: SpuVoicePoolOptions = {}) {
  const count = Math.max(0, Math.min(SPU_VOICE_COUNT_LIMIT, options.count ?? SPU_VOICE_COUNT));
  const masked = options.masked ?? 0;
  const now = options.now ?? (() => 0);
  const records: SpuVoiceRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      keyed: false,
      // fns.s:40766-40774: the sound init zeroes both, so every voice is free
      // when sound comes up.
      sampleLeft: 0,
      // No voice carries a priority until it is allocated one. Zero is what the
      // disc gives 752 of the 768 common-bank tone records.
      priority: 0,
      age: SPU_VOICE_AGE_AT_BOOT,
      occupant: null,
    });
  }
  /** ms of audio each keyed voice was started with; -1 when unknown. */
  const lengthMs: number[] = new Array(count).fill(-1);
  const startedAt: number[] = new Array(count).fill(0);
  const maskedBit = (i: number) => (masked & (1 << i)) !== 0;
  const record = (i: number): SpuVoiceRecord => records[i] as SpuVoiceRecord;

  const pool = {
    count,
    masked,
    records,

    /** `+0x04` as the allocator reads it: sample left, clamped to 16 bits. */
    sampleLeft(i: number): number {
      const r = record(i);
      if (!r.keyed) return 0;
      const len = lengthMs[i] ?? -1;
      if (len < 0) return r.sampleLeft;
      return clamp16(len - (now() - (startedAt[i] ?? 0)));
    },

    /** Report how long a voice's audio runs, in ms, for the tie-break. */
    setLength(i: number, ms: number) {
      lengthMs[i] = Number.isFinite(ms) ? Math.max(0, ms) : -1;
    },

    /**
     * Take a voice for a sound whose priority is `request`, or answer `null` the
     * way the original answers `D0x8008265c` — drop the sound.
     */
    allocate(request: number | null | undefined): SpuAllocation | null {
      const req = signed16(request ?? 0);
      let chosen = NO_INDEX;
      let best = NO_INDEX;
      let bestPriority = req;
      let bestSampleLeft = 0xffff;
      let bestAge = 0;
      let found = false;
      for (let i = 0; i < count; i++) {
        if (maskedBit(i)) continue;
        const r = record(i);
        if (!r.keyed && pool.sampleLeft(i) === 0) {
          chosen = i;
          break;
        }
        const priority = signed16(r.priority);
        if (priority < bestPriority) {
          bestPriority = priority;
          best = i;
          bestSampleLeft = pool.sampleLeft(i);
          bestAge = r.age;
          found = true;
        } else if (priority === bestPriority) {
          const left = pool.sampleLeft(i);
          if (left < bestSampleLeft) {
            bestSampleLeft = left;
            bestAge = r.age;
            best = i;
            found = true;
          } else if (left === bestSampleLeft && signed16(bestAge) < signed16(r.age)) {
            bestAge = r.age;
            best = i;
          }
        }
      }
      const idle = chosen !== NO_INDEX;
      let index = chosen;
      if (!idle) {
        index = found ? best : count;
        if (index >= count) return null;
        for (let i = 0; i < count; i++) {
          if (!maskedBit(i)) {
            const r = record(i);
            r.age = age16(r.age + 1);
          }
        }
      }
      const r = record(index);
      r.age = 0;
      r.priority = req;
      r.sampleLeft = 0;
      const evicted = r.occupant;
      r.occupant = null;
      r.keyed = false;
      return { index, evicted, idle };
    },

    /** The voice is keyed on and belongs to `occupant`. */
    keyOn(i: number, occupant: SpuOccupant | null) {
      const r = records[i];
      if (!r) return;
      r.keyed = true;
      r.sampleLeft = 0;
      r.occupant = occupant;
      startedAt[i] = now();
    },

    /** Key-off: release the occupant and mark the voice idle again. */
    keyOff(i: number) {
      const r = records[i];
      if (!r) return;
      // The record is cleared BEFORE the sound is stopped, as the original
      // clears the voice before it keys it off. Otherwise the release, which
      // ends the source, re-enters this with the record still occupied.
      const occ = r.occupant;
      r.occupant = null;
      r.keyed = false;
      r.sampleLeft = 0;
      lengthMs[i] = -1;
      occ?.release();
    },

    /**
     * A score's note-off: the pool slot is free from this instant, while the
     * voice is still AUDIBLE ringing its release out.
     *
     * Both branches of the original's key-off clear the voice record at once —
     * `F0x8003670c` (`fns.s:41864-41881`: keyed-on, sample-left and age all
     * zeroed) and `F0x8003674c` (`fns.s:41884-41931`: the same three, then the
     * SPU key-off mask registers). `F0x80035d38` picks between them per voice and
     * then walks to the next one, so one note-off frees every voice whose four
     * key halfwords match it. Nothing here stops the audio: the release is the
     * SPU's own envelope, which is why a 2D phrase's note keeps playing after
     * its slot is gone.
     *
     * So the 2D phrase player calls this at each note's note-off, and a phrase's
     * releasing tails never hold a slot against the next sound. A hard cut —
     * the 2D path's own-slot key-off, `sfx.stop`, `stopAll` — is `keyOff`.
     *
     * Pass `src` to clear only while this voice is still the one holding that
     * source: a note whose sample ran out first has nothing to free, and a voice
     * another sound has since taken is not this note's to release.
     */
    noteOff(i: number, src?: unknown) {
      const r = records[i];
      if (!r) return;
      if (src !== undefined && r.occupant?.src !== src) return;
      r.occupant = null;
      r.keyed = false;
      r.sampleLeft = 0;
      lengthMs[i] = -1;
    },

    /**
     * The voice's sample ran out. The record is cleared and NOTHING is keyed
     * off — the sound is already over, and key-off on a finished voice is what
     * a browser's `stop()` would double-count. Pass `src` to clear only if this
     * voice is still the one holding that source.
     */
    finish(i: number, src?: unknown) {
      const r = records[i];
      if (!r) return;
      if (src !== undefined && r.occupant?.src !== src) return;
      r.occupant = null;
      r.keyed = false;
      r.sampleLeft = 0;
      lengthMs[i] = -1;
    },

    /** How many voices are sounding right now. */
    active(): number {
      let n = 0;
      for (let i = 0; i < count; i++) if (record(i).keyed) n++;
      return n;
    },

    /** Stop every voice, the way `F0x80020204` stops all three channels. */
    stopAll() {
      for (let i = 0; i < count; i++) {
        const r = record(i);
        if (r.keyed || r.occupant) pool.keyOff(i);
      }
    },
  };
  return pool;
}

export type SpuVoicePool = ReturnType<typeof createSpuVoicePool>;
