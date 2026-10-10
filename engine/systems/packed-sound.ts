/**
 * The packed-sound call every screen plays through — a port of the resident
 * routine F0x8002006C, reached in the original through the function-pointer
 * cell [0x80055C48] (51 overlays, 534 call sites; the cell and its neighbours
 * are listed in docs/research/audio/sound-system.md §"The packed-sound entry
 * point"). One word goes in; the routine splits it and hands the pieces to the
 * SPU voice layer.
 *
 * Assembly, asm/dw2003/exe/fns.s:17667-17769 (section
 * "fns3_00.0x8002006c"), one `sra`/`srl` + `andi` pair per field:
 *
 *   .L0x80020078 sra $a0,$s0,0x12 / andi $a0,0x7f   -> archive      ($a0)
 *   .L0x80020084 srl $s7,$s0,0x1f                     -> bit 31      ($s7)
 *   .L0x80020088 sra $v0,$s0,0x1e / andi $s2,$v0,0x1 -> bit 30      ($s2)
 *   .L0x80020094 sra $v0,$s0,0xb  / andi $s6,$v0,0x7f -> bits 11-17  ($s6)
 *   .L0x800200a0 sra $v0,$s0,0x7  / andi $s5,$v0,0xf  -> bits 7-10   ($s5)
 *   .L0x800200ac andi $t0,$s0,0x7f                    -> bits 0-6    ($t0)
 *   .L0x800200b0 sra $v0,$s0,0x8  / andi $s4,$v0,0xff -> bits 8-15   ($s4)
 *   .L0x800200c0 andi $s8,$s0,0xff                    -> bits 0-7    ($s8)
 *
 * What each piece selects, read off the same lines:
 *
 *  - archive (bits 18-24) goes to F0x80020030 (.L0x800200d0), which returns the
 *    hardware channel already holding that archive or -1; -1 returns at once
 *    and nothing sounds (fn s.s:17649-17668, channel record at
 *    D0x800519ec+0x4200, stride 0x18).
 *  - bits 8-15 (row) is scaled by two and added to the channel's sfx-id field
 *    at +0x4208 (.L0x80020180-.L0x8002019c) — the row picks WHICH SAMPLE inside
 *    the loaded archive; bits 0-7 (slot) is the tone ordinal within it.
 *  - bit 31 set takes the positional call F0x8003432c with the channel's
 *    music slot at +0x4204 and the three packed arguments (bits 11-17, bits
 *    7-10, bits 0-6) — program, tone in that program, and note, i.e. the
 *    dx/dy-panned voice the field uses for footsteps and one-shot stingers
 *    (.L0x80020130-.L0x80020174). It returns that call's result, the voice it took,
 *    as a signed halfword (.L0x8002016c-.L0x80020174).
 *  - bit 31 clear takes the 2D trio F0x800335b4 / F0x80033b64 / F0x80032d1c on
 *    the same sample with the CONSTANTS 0x7f, 0x7f and 1, 1 — so the 2D path
 *    carries no volume or pan of its own (.L0x80020198-.L0x800201cc), and it
 *    returns the -1 loaded at .L0x800200d8.
 *  - bit 30 is the single exclusive-track register D0x800519ec+0x4248: set
 *    means "if it already holds this exact word, do nothing; otherwise stop
 *    whatever holds it, then take it" (.L0x800200f4-.L0x80020128).
 *
 * The service below owns the word's meaning and one queue of what every screen
 * asked for. It deliberately does NOT re-implement the two arbitration rules:
 * the per-voice self-cut and the exclusive register are already ported in the
 * browser's audio layer (web/audio.js, keyed off `dedup`/`positional` below),
 * and a second copy here would double-cut every cue.
 */

/** The pieces of a packed sound word, exactly as F0x8002006C splits it. */
export interface PackedSound {
  /** The word as it was passed, unsigned. */
  packed: number;
  /** bits 18-24. Which sound archive (soundtst "category") the id belongs to. */
  archive: number;
  /** bits 8-15. Which sample inside the archive, on the 2D path. */
  row: number;
  /** bits 0-7. The tone ordinal inside that sample, on the 2D path. */
  slot: number;
  /** bits 11-17. The VAB program the positional path addresses. */
  program: number;
  /** bits 7-10. The tone inside that program, on the positional path. */
  programTone: number;
  /** bits 0-6. The note the positional path plays. */
  note: number;
  /** bit 31. Set -> F0x8003432c, the panned positional call. */
  positional: boolean;
  /** bit 30. Set -> the exclusive-track register rules apply. */
  dedup: boolean;
}

/** F0x8002006C's unpacking, field for field (fns.s:17670-17694). */
export function unpackSound(packed: number): PackedSound {
  const word = packed >>> 0;
  return {
    packed: word,
    archive: (word >>> 18) & 0x7f,
    row: (word >>> 8) & 0xff,
    slot: word & 0xff,
    program: (word >>> 11) & 0x7f,
    programTone: (word >>> 7) & 0xf,
    note: word & 0x7f,
    positional: ((word >>> 31) & 1) === 1,
    dedup: ((word >>> 30) & 1) === 1,
  };
}

/** One shared queue: every sound any screen asked the packed-sound service for. */
export class PackedSoundService {
  private readonly queue: number[] = [];
  /** Absolute index of queue[0]; grows when the queue is trimmed. */
  private base = 0;

  /** Absolute index of the next sound played; a cursor's starting mark. */
  mark(): number {
    return this.base + this.queue.length;
  }

  /** The one call every screen makes: split the word and queue it. */
  play(packed: number): PackedSound {
    const fields = unpackSound(packed);
    this.queue.push(fields.packed);
    if (this.queue.length >= PACKED_SOUND_QUEUE_LIMIT) this.trim();
    return fields;
  }

  /** Everything queued since `mark`, oldest first. */
  since(mark: number): number[] {
    const from = Math.max(0, mark - this.base);
    return this.queue.slice(from);
  }

  /** True when the queue holds nothing since `mark`. */
  quiet(mark: number): boolean {
    return this.base + this.queue.length <= mark;
  }

  /** Drop the oldest half of a full queue. */
  private trim(): void {
    const drop = Math.floor(this.queue.length / 2);
    this.queue.splice(0, drop);
    this.base += drop;
  }
}

/**
 * A screen's record of the sounds IT played. Every play goes through the one
 * shared call (the service), but a screen's list holds only its own cues: the
 * original plays each word at once and keeps no queue, so a screen that drains
 * its list and sounds each id (the Yes/No box, the dialogue) must never be
 * handed another screen's cue, or that cue would sound twice. The list is the
 * same per-screen test hook the sessions had before.
 */
export class PackedSoundCursor {
  readonly service: PackedSoundService;
  private readonly own: number[] = [];

  constructor(service: PackedSoundService = packedSounds) {
    this.service = service;
  }

  /** The ids this screen played since it started or last drained. */
  get sounds(): number[] {
    return this.own.slice();
  }

  /** Play `packed` through the one shared call and record it as this screen's. */
  play(packed: number): PackedSound {
    const fields = this.service.play(packed);
    this.own.push(fields.packed);
    return fields;
  }

  /** Drain: this screen's ids since the last call, as the old arrays gave. */
  take(): number[] {
    return this.own.splice(0);
  }

  /** Forget the list (a screen rebuilt from a fresh state). */
  reset(): void {
    this.own.length = 0;
  }
}

/** A full queue is trimmed from the front; nothing holds more than this many. */
const PACKED_SOUND_QUEUE_LIMIT = 4096;

/** The one service the resident sound API and every screen share. */
export const packedSounds = new PackedSoundService();

/**
 * The sound cell the original dispatches through: [0x80055C48] holds
 * F0x8002006C. Screens that only ever recorded the address now route through
 * this one function.
 */
export const PACKED_SOUND_CELL = 0x80055c48;
export const PACKED_SOUND_ROUTINE = 0x8002006c;

/** Play through the shared service. The one call a screen's host method makes. */
export function playPackedSound(packed: number): PackedSound {
  return packedSounds.play(packed);
}