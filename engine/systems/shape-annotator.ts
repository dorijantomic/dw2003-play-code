// The stage users of the resident 2D draw-context service: the two-pass
// "disc plus column" annotators.
//
// DECODE. docs/research/field/draw-context-service-2026-10-04.md. The service
// itself is engine/systems/draw-context.ts; this file is the family that draws
// through it, and the tables are engine/dw3/annotator-tables.ts, lifted from
// the overlay words by tools/extract_annotator_tables.py.
//
// THE FAMILY. Nineteen stage overlays and fieldstg reach the 0x1002 object, at
// forty-four sites, found by searching the assembly for the getter word
// `lw $v?, -0x2074($v?)` (= 0x8004DF8C) and reading the `$a0` in effect at each
// `jalr`. `tools/annotator_census.py` re-derives that list and this module's
// ANNOTATOR_STAGE_USERS is the same list, so a new caller cannot be added to the
// game without being added here.
//
// Of those forty-four, twenty-two are the two-pass annotator pattern -- one
// routine that reads the layer's effective rect through `+0x128` and runs the
// overlays' own rectangle test, and one that queues through `+0x14C` up to three
// times with the stage's own shape routine as the callback. All twenty-two sit
// in the dungeon and Spy Satellite rooms:
//
//   s310 s311 s735 s736 s745 s746 s750 s780 s800 s805 s810 s815 s820
//
// (s310 and s800 carry two copies each.) The other twenty-two sites are the
// layer's own per-frame setup in fieldstg and the scroll-only reads in s375,
// s795, s800, s815 and s949, which are the same service but not this family.
//
// WHAT IS PORTED HERE. Two members, the two the stage-object registry lists as
// stage-owned annotators and the two the walker can drive in ordinary play:
//
//   0x349 (841) on s805, tick 0x800A5DE4 -- twenty-seven pooled children whose
//     positions come from the overlay's own descriptor table and which light up
//     one at a time on the delay walk. Driven by event 821.
//   0x34d (845) on s820, tick 0x800A6488 -- four children from the overlay's
//     four-record table, one of which takes the default position. Driven by
//     event 821 during the Spy Satellite beat.
//
// Both queue their two passes the same way, and that is the shared system: a
// disc pass queued at the drawable's own y, and, when the child has a column,
// a column pass queued at y + 0x12, each behind its own rectangle test. s820's
// own code: the disc's test is `(x, y, 0x20, 0x20)` and its queue key is y
// (wstag820.s:479-484 and :508-514); the column's test is `(x, y - 0x20,
// 0x20, 0x40)` and its queue key is y + 0x12 (:569-589). s805 uses one test,
// `(x, y, 0x20, 0x64)`, for both passes (wstag805.s:635-640 and :666-671).
//
// WHAT EACH PASS ASKS THE GPU FOR. The routine every member of the family hands
// to the emitter is wstag820.s:326-383 (RAM `0x800A62DC`) and wstag805.s:545-600
// (RAM `0x800A6664`), and both do the same four things:
//
//   1. the page and CLUT bases `0x140, 0x100`          -- block+0x74,
//      F0x8001ECBC  (wstag820.s:350-354, wstag805.s:564-568)
//   2. publish the layer and its packet slot            -- block+0x80,
//      F0x8001ECF8, with the slot 6 for the disc and 4 for the column on s820
//      (wstag820.s:344-348, :538-544) and 10 for BOTH on s805
//      (wstag805.s:570-574)
//   3. the CLUT-row offset                              -- block+0x88,
//      F0x8001ECEC, from the pass's own halfword
//      (wstag820.s:357-361 -> `child + 0x66`, wstag805.s:584-590 ->
//      `child + 0x66 + tag * 12`)
//   4. the shape itself: `F0x8001ED6C(shapeSet, id, x, y)`, where the shape set
//      is `*(0x80044F5C)(*(0x80049D8C))` -- F0x800140D8 over the field object's
//      own `+0x0C` handle -- and x/y are the child's own position words
//      (wstag820.s:362-375, wstag805.s:914-928).
//
// So each pass owns a PAIR of halfwords, and the pair's place in the child
// differs by overlay:
//
//   | overlay | stride | disc pair | column pair |
//   |---|---|---|---|
//   | s820 | `child + 0x64 + tag * 4` (wstag820.s:504-510) | `+0x64` shape, `+0x66` CLUT row | `+0x68` shape, `+0x6A` CLUT row |
//   | s805 | `child + 0x60 + tag * 12` (wstag805.s:568-572) | `+0x64` shape, `+0x66` CLUT row | `+0x70` shape, `+0x72` CLUT row |
//
// and the writer of each is the family's own step walk, whose KEY is the value:
//
//   s820 disc   `+0x64` = the child's own `+0x50` (wstag820.s:504, :518)
//   s820 disc   `+0x66` = the walk on `0x800A71DC` (`:520`, stored at `:528`)
//   s820 column `+0x68` = the child's `+0x50` plus the walk on `0x800A71F4`'s
//               key, zeroed when that key is `0x00FF` (`:527`, `:535-545`)
//   s820 column `+0x6A` = never written anywhere in wstag820.s, so it is zero
//   s805 disc   `+0x64` = the walk on `0x800A72B8`'s key (`:9FC`, stored at
//               `:A2C` in the NEXT call's delay slot, so it is the first walk's
//               return: keys 42..45)
//   s805 disc   `+0x66` = the walk on `0x800A7300`'s key (`:A14`, stored at
//               `:A44`: keys 0 and 1, a palette row, not a shape)
//   s805 column `+0x70` = 40 and `+0x72` = 40, both literals (`:A48`, `:A50`,
//               `:A60`)
//
// THAT is the field whose role the first pass left open, and it also corrects
// two things it got wrong: `+0x66` is a CLUT-row offset and not a texpage word
// (F0x8001ECEC stores it at the context's `+0x20`, which the emitter ADDS to
// every rectangle's palette row, exe/fns.s:16332-16338 and :16415-16456), and
// s805's second pass is not `+0x68` at all -- its stride is twelve bytes, and
// `+0x68`/`+0x6A` on s805 are unrelated state that the overlay only ever zeroes.
//
// WHAT IS NOT PORTED, AND WHY. s805's THIRD draw (wstag805.s:703-744, the arm
// entered when `child + 0x10` is zero): it repositions the child
// (`child + 0x58 = child + 0x54 << 8`, `child + 0x54 = y >> 8`, `:AF4`, `:B5C`),
// runs the walk on `0x800A7348` with the pass flag set -- keys 11..18 and
// `0x00FF`, all of them ids the directory holds -- into `+0x64`, zeroes `+0x66`,
// and queues the disc pass again. Porting it needs that arm's own state, which
// is a separate branch of the child's machine.
//
// The other thirteen overlays of the family have their shape sets decoded by the
// same extractor (`ANNOTATOR_SHAPE_SETS` in engine/dw3/annotator-shapes.ts, 722
// shapes over the fifteen overlays) and run through this same service, but each
// still needs its own member's child table and step walks lifted before it can
// name a shape; they are listed with their cull and queue sites in the document.
//
// THE PIXELS ARE THE DISC'S. Each shape set is the stage's own TMPK sprite
// directory, member 0 -- the same one the ambient point sprites and the launch
// pads read -- and `tools/extract_point_sprites.py` has already cut the texels
// of every id the two ported members ask for into `web/assets/effects/sNNN.png`
// (s805 ids 42..45; s820 ids 44 and 60..67, plus the `60@1`/`60@2` palette
// variants the disc pass's CLUT row selects). `annotatorShapeQuads` hands the
// browser the rectangles, and `web/effects.js drawAnnotatorShapes` draws those
// texels.
import {
  DrawQueue,
  effectiveRect,
  visibleInLayer,
  type DrawContextLayer,
  type DrawRect,
} from "./draw-context.ts";
import {
  S805_ANNOTATOR_CHILDREN,
  S805_ANNOTATOR_DELAY,
  S805_ANNOTATOR_TABLES,
  S820_ANNOTATOR_DEFAULT,
  S820_ANNOTATOR_RECORDS,
  S820_ANNOTATOR_TABLES,
  type AnnotatorChild,
  type AnnotatorStep,
} from "../dw3/annotator-tables.ts";
import {
  ANNOTATOR_SHAPE_SETS,
  type AnnotatorClip,
  type AnnotatorLayer,
  type AnnotatorShapeSet,
} from "../dw3/annotator-shapes.ts";

export { ANNOTATOR_SHAPE_SETS };

/**
 * The rectangles one shape id of a directory draws, or `null` when the id is not
 * in it. This is the emitter's own reading of the clip (exe/fns.s:16377-16400):
 * the id list is walked for the wanted byte, the record's `layer_count` triples
 * are read back to front, and each triple's frame supplies the rectangle and the
 * palette.
 */
export function annotatorShapeQuads(shapeSet: AnnotatorShapeSet | undefined, id: number): AnnotatorClip | null {
  if (!shapeSet) return null;
  if (!shapeSet.ids.includes(id)) return null;
  return shapeSet.clips[id] ?? null;
}

/** The shape set one stage's directory lives in, by its manifest id (`s805`). */
export function annotatorShapeSetFor(stage: string): AnnotatorShapeSet | undefined {
  const key = String(stage);
  return ANNOTATOR_SHAPE_SETS[key] ?? ANNOTATOR_SHAPE_SETS[key.replace(/^s/, "")];
}


/** One decoded caller of the 0x1002 service: overlay, site, and the slot it reads. */
export interface AnnotatorStageUser {
  /** The overlay image, `pro/<name>.s`. `fieldstg` is the resident one. */
  readonly overlay: string;
  /** The file offset of the `lw $v?, -0x2074($v?)` getter load. */
  readonly site: string;
  /** The service slot the routine reaches for: `+0x128` cull, `+0x14C` queue, `+0x11C` scroll. */
  readonly slot: string;
}

/**
 * All forty-four sites, twenty files, found by the getter-word search described
 * above. `fieldstg`'s nine are the layer's own per-frame setup and are not part
 * of the two-pass family; the `scroll` rows are the five overlays that only read
 * the scroll.
 */
export const ANNOTATOR_STAGE_USERS: readonly AnnotatorStageUser[] = [
  { overlay: "fieldstg", site: "0x2f34", slot: "queue" },
  { overlay: "fieldstg", site: "0x3664", slot: "queue" },
  { overlay: "fieldstg", site: "0x3f20", slot: "scroll" },
  { overlay: "fieldstg", site: "0x6448", slot: "cull" },
  { overlay: "fieldstg", site: "0x79f4", slot: "tint" },
  { overlay: "fieldstg", site: "0xa3c8", slot: "emit" },
  { overlay: "fieldstg", site: "0xaae8", slot: "queue" },
  { overlay: "fieldstg", site: "0xe420", slot: "queue" },
  { overlay: "fieldstg", site: "0xf6fc", slot: "scroll" },
  { overlay: "wstag205", site: "0x168", slot: "cull" },
  { overlay: "wstag310", site: "0x1230", slot: "cull" },
  { overlay: "wstag310", site: "0x12dc", slot: "queue" },
  { overlay: "wstag310", site: "0x1788", slot: "cull" },
  { overlay: "wstag310", site: "0x1834", slot: "queue" },
  { overlay: "wstag311", site: "0x127c", slot: "cull" },
  { overlay: "wstag311", site: "0x1328", slot: "queue" },
  { overlay: "wstag375", site: "0x09c", slot: "scroll" },
  { overlay: "wstag735", site: "0x390", slot: "cull" },
  { overlay: "wstag735", site: "0x43c", slot: "queue" },
  { overlay: "wstag736", site: "0x390", slot: "cull" },
  { overlay: "wstag736", site: "0x43c", slot: "queue" },
  { overlay: "wstag740", site: "0x554", slot: "cull" },
  { overlay: "wstag741", site: "0x554", slot: "cull" },
  { overlay: "wstag745", site: "0x764", slot: "cull" },
  { overlay: "wstag745", site: "0x810", slot: "queue" },
  { overlay: "wstag746", site: "0x764", slot: "cull" },
  { overlay: "wstag746", site: "0x810", slot: "queue" },
  { overlay: "wstag750", site: "0x8d0", slot: "cull" },
  { overlay: "wstag750", site: "0x97c", slot: "queue" },
  { overlay: "wstag780", site: "0x75c", slot: "scroll" },
  { overlay: "wstag795", site: "0x45c", slot: "scroll" },
  { overlay: "wstag800", site: "0x768", slot: "scroll" },
  { overlay: "wstag800", site: "0xe78", slot: "cull" },
  { overlay: "wstag800", site: "0xf24", slot: "queue" },
  { overlay: "wstag805", site: "0x7e8", slot: "cull" },
  { overlay: "wstag805", site: "0x954", slot: "queue" },
  { overlay: "wstag810", site: "0x8c4", slot: "cull" },
  { overlay: "wstag810", site: "0x970", slot: "queue" },
  { overlay: "wstag815", site: "0x008", slot: "scroll" },
  { overlay: "wstag815", site: "0x634", slot: "cull" },
  { overlay: "wstag815", site: "0x6e0", slot: "queue" },
  { overlay: "wstag820", site: "0x60c", slot: "cull" },
  { overlay: "wstag820", site: "0x6b8", slot: "queue" },
  { overlay: "wstag949", site: "0x09c", slot: "scroll" },
];

/**
 * The sixteen stage overlays carrying the two-pass annotator, in census order:
 * every overlay except fieldstg that reads the layer's effective rect through
 * `+0x128` and pairs it with a `+0x14C` queue. s310 carries two copies, which
 * is why the site list above is longer than this list.
 */
export const ANNOTATOR_FAMILY_OVERLAYS: readonly string[] = [
  "wstag205", "wstag310", "wstag311", "wstag735", "wstag736", "wstag740",
  "wstag741", "wstag745", "wstag746", "wstag750", "wstag800", "wstag805",
  "wstag810", "wstag815", "wstag820",
];

/** The two members the walker drives; the rest of the family is listed in the document. */
export const ANNOTATOR_PORTED_MEMBERS: readonly { stage: string; member: string; id: number }[] = [
  { stage: "805", member: "0x349", id: 841 },
  { stage: "820", member: "0x34d", id: 845 },
];

/** The disc pass. The rectangle test and the queue key both come from s820. */
export const DISC_TEST = { w: 0x20, h: 0x20 } as const;
/** The column pass: its test is 32 wide and 64 tall, lifted 32 up. */
export const COLUMN_TEST = { w: 0x20, h: 0x40, yLift: 0x20 } as const;
/** The column's queue key sits this far below the drawable's own y. */
export const COLUMN_KEY_OFFSET = 0x12;
/** s805's one rectangle test, used for both of its passes. */
export const S805_TEST = { w: 0x20, h: 0x64 } as const;
/**
 * s805's column pass, whose shape id and CLUT row are both this literal
 * (`li $v0, 0x28` stored twice, wstag805.s:1168-1192 / `:A48`, `:A50`, `:A60`).
 * 40 is an id its directory holds, so the column draws a real shape.
 */
export const S805_ANNOTATOR_COLUMN = 0x28;
/** The markers are 32 px across; the s805 table gives each one this shape slot. */
export const MARKER_SIZE = 0x20;

/** One queued pass, as the draw adapter wants it. */
export interface AnnotatorDraw {
  /** Where the marker sits, in the layer's screen space. */
  x: number;
  y: number;
  /** The key the service queued it under: the child's y, or that plus 0x12. */
  key: number;
  /** 0 for the disc, 1 for the column. */
  pass: 0 | 1;
  /** Which pooled child of the annotator this is. */
  child: number;
  /** The shape id the shape routine hands the emitter: `child + 0x64` / `+0x68` / `+0x70`. */
  shape: number;
  /**
   * The CLUT-row offset the shape routine publishes first: `child + 0x66` on
   * both overlays for the disc, `child + 0x6A` on s820 and `child + 0x72` on
   * s805 for the column. The emitter adds it to every rectangle's palette row
   * (exe/fns.s:16415-16456), which is how one marker cycles its colours. s820
   * writes nothing to `+0x6A`, so its column pass always carries 0.
   */
  clutRow: number;
  /** The pack member the emitter reads this shape out of. */
  shapeSet: AnnotatorShapeSet | null;
  /** The shape's own clip, resolved through the emitter's id search. */
  clip: AnnotatorClip | null;
}

/**
 * One {key, hold} step cursor: the pair of halfwords the overlays keep at
 * `child + 0x60` (index) and `child + 0x62` (hold) -- s820's disc pair -- and at
 * `child + 0x5C` / `child + 0x5E`, its column pair (wstag820.s:513 and :522).
 */
export interface StepCursor {
  /** The index into the table, the counter's first halfword. */
  index: number;
  /** The countdown, the counter's second halfword. */
  hold: number;
}

/**
 * The family's own step walk, `F0x8001E240`'s neighbour at wstag820.s:254-324
 * (RAM `0x800A61BC`, and s805's copy at `0x800A644C`). It returns the KEY of the
 * record the cursor sits on, and it is the only writer of the shape ids:
 *
 *   - it takes the resident random and clamps it to 4 (`:267-275`), and when the
 *     caller's fourth argument is zero it spends that from the hold (`:276-281`);
 *   - a hold still positive returns the current key at once (`:284`, `:317`);
 *   - otherwise the index steps on, the next record's hold is added (`:286-295`),
 *     and a key of `0x00FF` ends the run: with the pass flag clear it returns
 *     `0x00FF` (`:294` jumps to `:318`), and with the pass flag set it wraps the
 *     index to zero and re-enters itself one level deeper (`:302-312`).
 */
export function stepWalk(cursor: StepCursor, table: readonly AnnotatorStep[], rand: number, pass: number): number {
  const step = Math.min(rand, 4);
  cursor.hold -= step;
  if (cursor.hold > 0) return table[cursor.index]?.key ?? 0xff;
  cursor.index += 1;
  const next = table[cursor.index];
  if (!next) return 0xff;
  cursor.hold += next.hold;
  if (next.key !== 0xff) return stepWalk(cursor, table, 0, pass);
  // The 0x00FF end marker. pass 0 is the caller's "this pass is over" flag.
  if (pass === 0) return 0xff;
  cursor.index = 0;
  cursor.hold += table[0]?.hold ?? 0;
  return stepWalk(cursor, table, 0, pass);
}

/** The live state of one pooled child. */
export interface AnnotatorChildState {
  x: number;
  y: number;
  shape: number;
  /** Which descriptor row of the stage's table this child came from. */
  slot: number;
  /** The child's own countdown. */
  hold: number;
  /** The sequencer's own index into the delay walk (s805 only). */
  index: number;
  /** `child + 0x5C` / `child + 0x60`: the disc pass's step cursor. */
  disc: StepCursor;
  /** `child + 0x5C`'s neighbour: the column pass's step cursor. */
  column: StepCursor;
  /** `child + 0x64` (disc) and the column pass's own halfword: this blank's two
   *  shape ids, 0 = draw nothing (`+0x68` on s820, `+0x70` on s805). */
  shapes: [number, number];
  /** `child + 0x66` (disc) and `+0x6A` / `+0x72` (column): the two CLUT rows. */
  clutRows: [number, number];
}

/** Everything one stage's annotator needs. */
export interface AnnotatorConfig {
  stage: string;
  /** The layer the service hands back for this stage. */
  layer: DrawContextLayer;
  /** The children, already placed. */
  children: readonly AnnotatorChild[];
  /** Which rectangle test this stage uses. */
  test: { w: number; h: number; yLift?: number };
  /** The delay walk's bounds, or null for a stage with none. */
  delay: readonly number[] | null;
  /** Whether this stage draws the column pass as well. */
  column: boolean;
  /**
   * How far the shape routine lifts the column pass's own position. s820's does
   * `addiu $s1, -0x20` in its tag-1 arm (wstag820.s:538); s805's does not -- it
   * passes `child + 0x50` / `child + 0x54` for both tags (wstag805.s:924-928),
   * because its stride already separates the pair.
   */
  columnLift: number;
}

function childState(c: AnnotatorChild, slot: number): AnnotatorChildState {
  return {
    x: c.x,
    y: c.y,
    shape: c.shape,
    slot,
    hold: 0,
    index: 0,
    disc: { index: 0, hold: 0 },
    column: { index: 0, hold: 0 },
    shapes: [0, 0],
    clutRows: [0, 0],
  };
}

/**
 * s805's member 0x349. The sequencer's state machine (wstag805.s:8-100) builds
 * all twenty-seven children from the overlay's descriptor table when its own
 * state is 0, and walks the delay table when its state is 2; states 1 and 3 draw
 * nothing. The walk fires child `index` when
 * `delay[index] <= hold < delay[index + 1]` and no other, then advances the
 * index and adds a random 0..4 to the hold every blank -- the resident random is
 * `*(0x8004DF9C)` and it is clamped to 4 at wstag805.s:44-46. Reaching the
 * 0x1000 end bound sets the sequencer's own state to 1, which is how the run
 * finishes.
 */
export function createS805Annotator(layer: DrawContextLayer): {
  config: AnnotatorConfig;
  states: AnnotatorChildState[];
  queue: DrawQueue<AnnotatorChildState>;
  index: number;
  hold: number;
  done: boolean;
} {
  const queue = new DrawQueue<AnnotatorChildState>(64);
  return {
    config: {
      stage: "805",
      layer,
      children: S805_ANNOTATOR_CHILDREN,
      test: S805_TEST,
      delay: S805_ANNOTATOR_DELAY,
      column: true,
      columnLift: 0,
    },
    states: S805_ANNOTATOR_CHILDREN.map((c, i) => childState(c, i)),
    queue,
    index: 0,
    hold: 0,
    done: false,
  };
}

/**
 * One blank of the s805 sequencer. `rand` is the resident random the original
 * reads and clamps to 4; the caller supplies it so the walk is deterministic in
 * a test and free-running in the game.
 *
 * The lit child's two passes, from the child's own state-2 arm
 * (wstag805.s:630-700) and the shape routine it calls (wstag805.s:545-600, whose
 * pair is `child + 0x60 + tag * 12`):
 *
 *   - the DISC pair is `+0x64` / `+0x66`, and each halfword is a different
 *     walk's key: `+0x64` gets the walk on `0x800A72B8` (`:9FC`, stored by
 *     `:A2C` in the delay slot of the NEXT call, so it is the first walk's
 *     return -- keys 42..45, all ids the directory holds), and `+0x66` gets the
 *     walk on `0x800A7300` (`:A14`, stored at `:A44` -- keys 0 and 1, a palette
 *     row);
 *   - the COLUMN pair is `+0x70` / `+0x72`, and both are the literal 40 written
 *     once a blank (`:A48`, `:A50`, `:A60`).
 *
 * `+0x68` and `+0x6A` are NOT this pass: the overlay only ever zeroes them
 * (`:9C0`, `:AD4`), which is what the first pass of this work read as an absent
 * shape id. The stride is what settles it.
 */
export function tickS805Annotator(run: ReturnType<typeof createS805Annotator>, rand: number): void {
  const delay = run.config.delay;
  if (!delay || run.done) return;
  const lo = delay[run.index] ?? 0;
  const hi = delay[run.index + 1] ?? 0;
  const step = Math.min(rand, 4);
  if (run.hold >= lo && run.hold < hi) {
    const child = run.states[run.index];
    if (child) {
      child.shapes[0] = stepWalk(child.disc, S805_ANNOTATOR_TABLES.disc, rand, 0);
      child.clutRows[0] = stepWalk(child.column, S805_ANNOTATOR_TABLES.second, rand, 0);
      child.shapes[1] = S805_ANNOTATOR_COLUMN;
      child.clutRows[1] = S805_ANNOTATOR_COLUMN;
      queueChild(run.queue, run.config, child);
    }
  }
  run.hold += step;
  if (lo >= 0x1000) {
    run.done = true;
    return;
  }
  // The index moves by one when the window closes, so a single blank crosses at
  // most one bound -- the original compares against delay[i] and delay[i+1] only.
  // It may reach the last entry, because that is where the 0x1000 end marker is.
  if (run.hold >= hi && run.index < delay.length - 1) run.index += 1;
}

/**
 * s820's member 0x34d. The stage's entry loop (wstag820.s:170-183) walks four
 * twelve-byte records; the record's second halfword is the kind and its first is
 * the hold. Kind 2 takes the default child's own constructor constants, kind 0
 * builds one at the record's position. The default child is `(460, 436)` with a
 * hold of 60 (wstag820.s:634-641).
 */
export function createS820Annotator(layer: DrawContextLayer): {
  config: AnnotatorConfig;
  states: AnnotatorChildState[];
  queue: DrawQueue<AnnotatorChildState>;
} {
  const children: AnnotatorChild[] = S820_ANNOTATOR_RECORDS.map((r) =>
    r.kind === 2
      ? { x: S820_ANNOTATOR_DEFAULT.x, y: S820_ANNOTATOR_DEFAULT.y, shape: r.hold }
      : { x: r.x, y: r.y, shape: r.hold },
  );
  return {
    config: {
      stage: "820",
      layer,
      children,
      test: DISC_TEST,
      delay: null,
      column: true,
      columnLift: COLUMN_TEST.yLift,
    },
    states: children.map((c, i) => childState(c, i)),
    queue: new DrawQueue<AnnotatorChildState>(64),
  };
}

/**
 * s820's member 0x34d, one blank. The state-2 arm of the child's own machine
 * (wstag820.s:497-590) is the whole of it:
 *
 *   - the disc pass runs the step walk on the table at `0x800A71DC` with the
 *     pass flag clear (`:520`) and its KEY lands in `child + 0x66` (`:528`) --
 *     the CLUT row, keys 0, 1 and 2; the disc's SHAPE id is the child's own
 *     `+0x50`, stored into `+0x64` before the call (`:518`, `:521`);
 *   - the column pass runs the walk on `0x800A71F4` with the pass flag set
 *     (`:527`), and THIS key is what the arm branches on: `0x00FF` means the
 *     column is finished and `+0x68` is zeroed (`:537`), anything else makes
 *     `+0x68` the child's `+0x50` plus that key (`:544-545`) -- the same sum for
 *     the `0x12C` key, which only skips the `+0x28` method call (`:540`);
 *   - the disc draws only while `+0x64` is non-zero (`:479-481`) and the column
 *     only while `+0x68` is (`:570-572`), so both gates are the same test the
 *     port makes below;
 *   - `+0x6A`, the column's CLUT row, is never stored anywhere in wstag820.s,
 *     so the column pass always carries 0 -- which is what the port does rather
 *     than inventing a palette step.
 *
 * `rand` is the resident random the walk reads and clamps to 4 (`:267-275`).
 */
export function tickS820Annotator(run: ReturnType<typeof createS820Annotator>, rand = 0): void {
  for (const child of run.states) {
    const discKey = stepWalk(child.disc, S820_ANNOTATOR_TABLES.disc, rand, 0);
    const colKey = stepWalk(child.column, S820_ANNOTATOR_TABLES.column, rand, 1);
    child.shapes[0] = child.shape;
    // :528 stores the disc walk's return in +0x66, which the shape routine hands
    // to F0x8001ECEC; the emitter adds it to the palette row. So the disc pass's
    // colour is the disc walk's key and nothing else.
    child.clutRows[0] = discKey;
    child.shapes[1] = colKey === 0xff ? 0 : child.shape + colKey;
    child.clutRows[1] = 0;
    queueChild(run.queue, run.config, child);
  }
}

/**
 * The shared two-pass queue, which is the whole system: test the disc, queue it
 * at the drawable's own y, then -- when this stage draws a column -- test and
 * queue the column at y + 0x12. Both tests go through the layer's effective
 * rect (`+0x128`) and the overlays' own rectangle test, exactly as the two
 * routines do.
 */
function queueChild(queue: DrawQueue<AnnotatorChildState>, config: AnnotatorConfig, child: AnnotatorChildState): void {
  const rect = effectiveRect(config.layer);
  // The cull compares SCREEN coordinates: `+0x128` answers "where on screen does
  // this layer sit", so a child has to be brought into the same space first.
  const sx = rect.x + (child.x - config.layer.x);
  // Each pass draws only while its own shape id is non-zero: `lh $v1, 0x64($s0)`
  // then `beqz` for the disc (wstag820.s:479-481) and `lh $v0, 0x68($s0)` then
  // `beqz` for the column (:570-572).
  if (child.shapes[0] !== 0 &&
      visibleInLayer(rect, sx, rect.y + (child.y - config.layer.y), config.test.w, config.test.h)) {
    queue.queue(child.y, null, child, 0);
  }
  if (!config.column || child.shapes[1] === 0) return;
  const lift = config.test.yLift ?? 0;
  const colH = config.test === S805_TEST ? S805_TEST.h : COLUMN_TEST.h;
  if (visibleInLayer(rect, sx, rect.y + (child.y - config.layer.y) - lift, COLUMN_TEST.w, colH)) {
    queue.queue(child.y + COLUMN_KEY_OFFSET, null, child, 1);
  }
}

/**
 * This blank's shape requests, in the order the service's flush hands them over,
 * each with the rectangles the emitter would draw for it.
 */
export function annotatorDraws(
  run: { queue: DrawQueue<AnnotatorChildState>; config: AnnotatorConfig },
  shapeSet?: AnnotatorShapeSet,
): AnnotatorDraw[] {
  const { queue, config } = run;
  const layer = config.layer;
  const rect = effectiveRect(layer);
  const set = shapeSet ?? null;
  const out: AnnotatorDraw[] = [];
  for (const rec of queue.flush(layer)) {
    // The list's head is the 0x7FFFFFFF sentinel the reset leaves behind; it has
    // no payload and the original's flush never calls its callback, so it is
    // not a drawable.
    const child = rec.payload;
    if (child == null) continue;
    const pass = rec.tag === 1 ? 1 : 0;
    // The layer's effective rect says where its own (x, y) lands on screen, so
    // a child at layer coordinates moves with it. s820 lifts its column pass 32px
    // (`addiu $s1, -0x20`, wstag820.s:538) while queueing it at y + 0x12
    // (:589); s805's shape routine passes the child's own position for both
    // tags (wstag805.s:924-928), so its column sits on its disc.
    out.push({
      key: rec.key,
      x: rect.x + (child.x - layer.x),
      y: rect.y + (child.y - layer.y) - (pass === 1 ? config.columnLift : 0),
      pass: pass as 0 | 1,
      child: child.slot,
      shape: child.shapes[pass],
      clutRow: child.clutRows[pass],
      shapeSet: set,
      clip: annotatorShapeQuads(set ?? undefined, child.shapes[pass]),
    });
  }
  return out;
}

/**
 * The window one stage's layer must cover for its own annotator to be visible.
 * The service's cull is a rectangle test against the layer's effective rect, so
 * a layer no bigger than the 320x240 screen would hide every marker: s805's ring
 * runs x 8..668 and y -80..300, and s820's markers sit at y 242..436. The
 * original's layers are sized by the stage, not by the screen, and this is the
 * smallest window that holds each member's own children.
 */
export function annotatorLayerBounds(stage: string): { x: number; y: number; w: number; h: number } {
  const cfg: { children: readonly AnnotatorChild[]; test: { w: number; h: number; yLift?: number } } = stage === "805"
    ? { children: S805_ANNOTATOR_CHILDREN, test: S805_TEST }
    : {
        children: S820_ANNOTATOR_RECORDS.map((r) =>
          r.kind === 2
            ? { x: S820_ANNOTATOR_DEFAULT.x, y: S820_ANNOTATOR_DEFAULT.y, shape: r.hold }
            : { x: r.x, y: r.y, shape: r.hold }),
        test: DISC_TEST,
      };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cfg.children) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x + MARKER_SIZE);
    minY = Math.min(minY, c.y - (cfg.test.yLift ?? 0));
    maxY = Math.max(maxY, c.y + Math.max(cfg.test.h, COLUMN_TEST.h));
    // The window has to be at least the screen it is drawn on, or the service's
    // own 320x240 area would clip every marker that sits outside it.
    maxX = Math.max(maxX, 320);
    maxY = Math.max(maxY, 240);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The layer a stage hands the service, built from the field's own camera words. */
export function layerForField(
  layerX: number,
  layerY: number,
  w: number,
  h: number,
  originX: number,
  originY: number,
  scrollX: number,
  scrollY: number,
  capacity = 64,
): DrawContextLayer {
  return { x: layerX, y: layerY, w, h, originX, originY, scrollX, scrollY, capacity };
}

/** The rect the cull reads, exposed so the draw adapter and the tests agree. */
export function annotatorCullRect(layer: DrawContextLayer): DrawRect {
  return effectiveRect(layer);
}