// The action VM's frame-table sampler for the browser renderer.
//
// This is an adapter over the PORTED sampler engine/dw3/battle-timeline-sampler.ts
// (FIGHTSTG_F0x80083c30): the playhead that walks one position/frame table, loops
// in place on the 0x8000 marker and freezes on 0xffff. The browser used to
// hand-write this in _setFrom/step; the playhead mechanics are now the port's and
// the oracle tests/engine/unit/battle-timeline-sampler-oracle.test.ts pins them
// against the original instruction words.
//
// table entries: { value:u16, loop_target:u16, aux:u16 }
//   value & 0x8000 (a loop/blend segment) → frame = loop_target, justLooped = true,
//     blend = { from, t = (value & 0x7fff)/4096 }   (0x8000 and 0xffff included)
//   value === 0x8000 (pure loop marker)   → the playhead jumps to loop_target
//   value === 0xffff (end marker)         → the sampler freezes
//   otherwise                             → frame = value
import { frameTableFromEntries, newSamplerState, readPhase, sampleTick, SAMPLE_BIT, LOOP_MARKER, END_MARKER, BLEND_TARGET } from "../vendor/engine.js";

export class TimelinePlayer {
  // `prevFrame` (optional) seeds the "from" for a LEADING aux=0xffff ease-in blend.
  constructor(table, prevFrame = null) {
    this.table = table;
    this.length = table.length;
    this._frames = frameTableFromEntries(table);
    this._s = newSamplerState(1);
    this._prevFrame = prevFrame;
    this.frame = 0;
    this.blend = null;
    this.justLooped = false;
    this.looped = false;        // set the tick a 0x8000 loop-back fires
    // A table of length <= 1 has no index-1 entry; treat it as a single static
    // frame that has already ended (the original's [+0x80]=1 init assumes a real,
    // multi-entry table).
    this.ended = this.length <= 1;
    if (this.length <= 1) this._s.playhead = 0;   // no index-1 entry: read entry 0
    readPhase(this._s, this._frames, {});   // seed the display from the current entry
    this._select();
  }

  /** The ported sampler's playhead (object +0x80), exposed for tests/observers. */
  get playhead() { return this._s.playhead; }

  // Map the ported sampler's state to the renderer's {frame, blend, justLooped}.
  _select() {
    const s = this._s;
    this.frame = s.frame;
    const isSeg = s.loopSeg;
    this.justLooped = isSeg;
    if (isSeg) {
      const aux = this.table[s.playhead]?.aux;
      const from = (aux == null || aux === 0xffff) ? this._prevFrame : aux;
      this.blend = (from == null) ? null : { from, t: (s.frac & 0x7fff) / BLEND_TARGET };
    } else {
      this.blend = null;
      this._prevFrame = s.frame;
    }
  }

  step(speed) {
    if (this.ended) return;
    this.looped = false;
    const before = this._s.playhead;
    sampleTick(this._s, this._frames, speed, {});
    this.looped = this._s.playhead < before;   // a loop-back jumped the playhead
    this._select();
    if (this._s.frozen) this.ended = true;
  }

  currentFrame() { return this.frame; }
}

// Plays a SEQUENCE of position tables back-to-back — the "playlist" a single motion
// expands to (DATA: SFSTDATA record +0x10 is a null-terminated list of timeline-table
// indices). When the current sub-table ends (0xffff freeze) it advances to the next;
// when the last ends, the whole playlist is ended. Single-element playlists behave
// like a bare TimelinePlayer.
export class PlaylistPlayer {
  constructor(tables) {
    this.tables = (tables || []).filter((t) => t && t.length);
    this.idx = 0;
    this.cur = this.tables.length ? new TimelinePlayer(this.tables[0]) : null;
    this.frame = this.cur ? this.cur.currentFrame() : 0;
    this.blend = this.cur ? this.cur.blend : null;
    this.ended = !this.cur;
    this.justLooped = false;
  }

  step(speed) {
    if (this.ended || !this.cur) return;
    this.cur.step(speed);
    this.frame = this.cur.currentFrame();
    this.blend = this.cur.blend;
    this.justLooped = this.cur.justLooped;
    // A sub-table is "done" for the sequence when it freezes (0xffff) OR loops back (0x8000).
    // Non-final sub-tables advance on either; only the FINAL table is allowed to loop/hold
    // in place. This lets the op2 sequence reach its end instead of stalling on a
    // mid-sequence loop marker (e.g. Renamon basic table 17). (savestate-validated)
    const isLast = this.idx + 1 >= this.tables.length;
    const subDone = this.cur.ended || (this.cur.looped && !isLast);
    if (subDone) {
      if (!isLast) {                                  // advance to the next sub-table
        this.idx += 1;
        this.cur = new TimelinePlayer(this.tables[this.idx]);
        this.frame = this.cur.currentFrame();
        this.blend = this.cur.blend;
      } else {
        this.ended = true;                            // last sub-table finished (0xffff)
      }
    }
  }

  currentFrame() { return this.frame; }
}

export { SAMPLE_BIT, LOOP_MARKER, END_MARKER };
