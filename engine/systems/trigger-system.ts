import { flagConditionPasses } from './story-command-banks.ts';
// engine/systems/trigger-system.ts
// The WS4 STORY-STEP / OnStep position trigger — the position-triggered, flag-gated
// scene engine, ported from the fieldstg position step (pro/fieldstg.s).
//
// One resident 0x68-byte driver object per stage runs this every frame
// (`F0x80014504(0x80088888, 0x68, 8)`, fieldstg.s:5998-6007 `.L0x00005d9c`; the driver is
// fieldstg.s:5885 `.L0x00005bd8` = 0x80088888). Its two halves:
//
//   step-load  0x80088288 (fieldstg.s:5501 `.L0x000055d8`)
//     byte     = zonecheck(type=7, player x,y)            :5614  byte = result & 0xff
//     step_idx = byte & 0x1f                              :5624
//     group    = byte >> 5                                :5620   -> runner+0x60
//     step_idx -> runner+0x5c, base + step_idx*24 -> runner+0x64   :5628 :5634 :5644
//     live     = the facing cone, but only for SOME opcodes (see stepLive below)   :5648-5680
//
//   step-exec  0x8008836c (fieldstg.s:5558 `.L0x000056bc`)
//     get_flag(cond_A,arg_A) AND get_flag(cond_B,arg_B)     :56d4-5738  (0xffff = none)
//     opcode dispatch                                        :573c-5840
//     ops 0-4, 7, 9, 10, 14+ -> the indicator bubble's kind  :587c-589c -> engine/systems/scene-step-ops.ts
//     op 5: two words;  op 6: a call through a cell;  ops 11-13: the player actor
//     op 8: lhu param@+0xa ; jal start_event ; latch the runner   :57c0-57e8
//
// Generic: the flag store, the grid, the step program and the cone table are injected.
//
// Faithfulness notes (each cited to pro/fieldstg.s):
// * The step index lives at runner+0x5c and the hi-3-bit group at runner+0x60 —
//   docs/research/scripting/field-script-engine-verified.md §WS4.1 said "+0x60 = current
//   step index" and is corrected (fieldstg.s:5628/5634).
// * Only opcodes 0-4, 7 and >= 15 read the enable table; opcodes 5, 6 and 8-14 branch
//   straight to the epilogue with v0 = 1 (fieldstg.s:5660 delay slot `li $v0,0x1`, and
//   :567c `j` with :5680 `li $v0,0x1`). So a cutscene step (op 8) is NEVER facing-gated.
// * op 8's re-entry guard is the latch at extra+4, where `extra` is the driver's own
//   8-byte second buffer (fieldstg.s:57c0/57e8; the object manager passes obj+0x24 as
//   a1 — exe/fns.s:8888-8890 `lw $a1, 0x24($s0)`). It holds the runner pointer, so the
//   step fires at most once per stage visit; it is NOT keyed on any flag.
// * The event is resolved by ID (param@+0xa is the event id start_event is handed),
//   because flag_key is not unique inside a stage — s305's records for event 965 and
//   event 1450 (wstag305.s:3699-3708) share flag_key 012e000a.
// * The playback arm never re-reads a record's flag conditions, but they decide whether
//   it is reachable at all: `step-exec`'s failure branch (:5700 / :5734) returns WITHOUT
//   the level-1 increment at :5d40, and that increment (`F0x800142c8`, +0x10 += 1) is the
//   resident driver's only way out of sub-state 0 — the arm that hands a held press to
//   `0x800885d4`. So `playback()` applies `gatePasses` as well, and a tile whose conds
//   fail is dark for the press exactly as it is dark for the bubble. That is the
//   FishingPole requirement: all 212 op-7 records carry cond_a = 0x8005 / arg_a = 1
//   (item 5 in the bag), so without the rod there is no cast.
//
// Acts on op-8 (start_event) and runs every other setup opcode through
// engine/systems/scene-step-ops.ts, which is the port of the shared dispatch tables
// (0x80082E48 / 0x80082E70). The banked predicate returns null for UNMODELLED flags,
// which match neither polarity → that step stays dormant (never a false fire) — the
// progression-flag frontier, not a VM bug.
//
// WHEN the setup arm runs — the rule `setup()` is the port of, and the reason a
// launch pad needs no button (fieldstg.s, the resident driver 0x80088888):
//
//   * NOT on a press. The driver's only pad read is `andi $v0,0x2000` at :5d04,
//     and it sits in the PLAYBACK arm (:5cbc-:5d50), behind the sub-state test
//     `beq $v1,$a0 -> :5cbc` at :5c7c. The setup arm (:5c94-:5cb8) reads no
//     button at all — there is no `pad()` call anywhere between :5c94 and :5cb8.
//   * NOT once on the step onto the tile. `+0x10` is the driver's own sub-state
//     (exe/fns.s F0x800142c8 at `+0x3c` increments it), and its ONE exit is the
//     level-1 increment at :5d40/:5d48, which only the setup arm's success branch
//     :5cb4 (`j 0x800889f0` = :5d40) reaches. Setup ops 5, 6, 8, 11, 12 and 13
//     all return 0 — each of those handlers ends `j 0x800885c0` (:5910) with
//     `move_ $v0,$zr` in the delay slot (:5790, :581c, :57cc, :583c) — so the
//     driver stays in sub-state 0 and runs step-load + step-exec again next frame.
//     Ops 0-4, 7, 9, 10 and 14+ fall out of table B into the controller tail
//     (:58fc / `li $v0,0x1` at :590c), return 1, and hand the tile to the button.
//   * SO: every frame, while the player stands on a live step tile whose record's
//     two flag conditions hold — which is exactly what `setup()` reports.
//   * The facing cone does NOT gate op 13. step-load (:5648-:56a4) consults
//     0x80097624 for ops 0-4 (`slti $v1,5` / `bnez -> :5684`), op 7 (`slti $v1,8`
//     / `bnez -> :5688`) and ops >= 15 (`slti $v1,0xf` / `beqz -> :5684`) only;
//     ops 5, 6 fall through `slti $v0,$v1,7` + `bnez -> :5910` and ops 8-14 jump
//     `j 0x80088358` (:567c) with `li $v0,0x1` (:5680) — live, cone never read.
//   * The record's OWN two conditions are the only gate on the setup arm:
//     `lhu $v1,($a1)` / `beq $v1,0xffff` / `get_flag(cond,arg)` / `beqz -> :5910`
//     for cond_a (:56dc-:5700) and cond_b (:5710-:5734). :5910 returns 0, which is
//     the driver returning at :5d84 PAST the increment — so a shut tile runs
//     neither its setup op nor its playback op.

import {
    execPlaybackRecord, execStepRecord, launcherRouteWords,
    type PlaybackEffect, type StepOpEffect,
} from "./scene-step-ops.ts";

export interface Step {
  cond_a: number;
  arg_a: number;
  cond_b: number;
  arg_b: number;
  op: number;
  params: number[];
}

export interface StepGrid {
  uniform?: number;
  cell?: number;
  w?: number;
  h?: number;
  grid?: number[];
}

/**
 * The EXACT type-7 zone map: per stage, horizontal runs `[x0, x1, y, byte]` of a
 * constant non-zero byte (`tools/extract_story_trigger_zones.py`). It is
 * `zonecheck(7, x, y)` decimised only by run length. The value the disc reads
 * varies PIXEL by pixel — the quadtree descends to an 8x8 leaf and indexes
 * `leaf[n*64 + (y&7)*8 + (x&7)]` — so a 32 px cell grid ({@link StepGrid}) fires
 * a step up to a cell before the player's pixel is inside its real zone. That is
 * the Protocol Ruins tunnel defect (playtest, 2026-10-07): the hide began before
 * the passage and the restore did not land where the original brings the player
 * back. byte 0 = no step (the default).
 */
export type ZoneRuns = readonly (readonly number[])[] | null;

/** The 8x8 facing cone read out of FIELDSTG.PRO at RAM 0x80097624 (rows[group][facing]). */
export interface StepEnableTable {
  rows: number[][];
}

export interface StoryEvent {
  event_id: number;
  flag_key: string;
  sets?: [number, number][];
}

export interface StoryProgram {
  steps: Step[];
  events: StoryEvent[];
}

/** One frame of the position step, as the disc's own fields read after step-load. */
export interface StepSample {
  /** runner+0x5c — index into the step program. */
  step: number;
  /** runner+0x60 — the grid byte's top three bits, the required facing group. */
  group: number;
  /** the step-load return value: the step runs this frame. */
  live: boolean;
}
export interface TriggerDeps {
  getProgram: (mapId: string) => StoryProgram | null;
  getGrid: (mapId: string) => StepGrid | null;
  /**
   * The EXACT per-pixel type-7 zones ({@link ZoneRuns}). When a host supplies
   * them, `sampleStep` reads the step byte from here and never consults
   * `getGrid`, so the trigger is pixel-exact instead of cell-quantised. Optional
   * so a host without the zone asset keeps the (approximate) cell grid.
   */
  getZoneRuns?: (mapId: string) => ZoneRuns;
  /** FIELDSTG.PRO's 8x8 facing cone. Null = no cone available (see stepLive). */
  getEnableTable: () => StepEnableTable | null;
  /** Resolve the event the step names, BY ID — the disc hands start_event an id. */
  getEventById: (mapId: string, eventId: number) => unknown | null;
  /** Fallback for a stage whose wstag ids disagree with the step table's. */
  getEventByKey: (mapId: string, flagKey: string) => unknown | null;
  flags: { get(id: number): number | null; set(id: number, v: boolean): void };
  /** The host runs the decoded completion leaf. Do not replay the extraction's
   * copy of its writes as a second command invocation. */
  hostCompletesEvent?: boolean;
  done: (flagKey: string) => boolean;
  markDone: (flagKey: string) => void;
  playEvent: (ev: unknown, onDone: () => void) => void;
  /**
   * True while the field is owned by a handoff — the disc's two guard words
   * `scene_struct+0x54` (the screen worker) and `+0x58` (its argument). Fieldstg's
   * type-7 state-2 handler raises the second of them (`[0x80099DD8] = 1`, file
   * 0x8b24) and phase 1 clears it again (file 0x8708); `F0x8008F3E4` (the dive
   * launcher) sets it itself. Read here at fieldstg.s:5c58 and :5c6c, before AND
   * after the pad read (:5d14/:5d18). Optional: absent = clear.
   */
  handoffPending?: () => boolean;
  isBusy?: () => boolean;
}

/** What the step program's op did this frame — engine/systems/scene-step-ops.ts. */
export interface StepIndicator {
    step: number;
    group: number;
    op: number;
    /** the bubble row the disc writes into the indicator actor, or null for no bubble. */
    kind: number | null;
}

/**
 * One frame of the playback executor (exec#2, `0x800885d4`), as the disc's own driver
 * decides it (fieldstg.s:5bd8-5d84). The order of the gates is the order of the
 * assembly and every gate is reproduced:
 *
 *   1. `handoffPending` — scene_struct+0x54 / +0x58 nonzero: a warp or a screen handoff
 *      owns the field, so nothing runs (:5c54/:5c64, and again at :5d10/:5d18).
 *   2. the step must be live — grid byte, facing cone, exactly as step-load reads them
 *      (:5cbc jal 0x80088288, `bnez` into the arm at :5cf4) — AND the record's own two
 *      flag conditions must pass. The disc reads the conditions in the SETUP arm
 *      (:56d4-:5738), but its failure branch returns past the level-1 increment at
 *      :5d40, so a step whose conds fail can never reach this executor at all
 *      (:5cac `beqz` -> :5d84). When the tile is not live the disc puts the indicator
 *      away (:5cc8/:5ce0 `setState(2)`).
 *   3. Circle must be HELD, not tapped — `pad(0)`, `andi $v0,0x2000`, `beqz` returns
 *      (:5cf4-:5d08). Holding is what distinguishes the disc's press-to-use tiles from
 *      its walk-over ones.
 *   4. the bubble is switched to its "used" state (:5d20-:5d34 `setState(3)`) and the op
 *      runs (:5d38).
 */
export interface StepPlayback {
    /** the step-load result: the tile under the player is an armed step. */
    live: boolean;
    /** the step index (runner+0x5c) and its facing group (runner+0x60). */
    step: number;
    group: number;
    /** the op the executor ran, or null when it did not run. */
    op: number | null;
    /** what it did. */
    effect: PlaybackEffect | null;
    /**
     * The route pair this step publishes into `[D0x80048D34+0x44]` / `[+0x46]` — the
     * record's own params[5] / params[6], read verbatim. Present only for the three
     * opcodes that reach one of the two writer sites: op 1 in the executor's own body
     * (`effect.routeWords`, fieldstg.s:5773/:5778) and ops 9/10 one call deeper, in the
     * dive launcher's chain (`launcherRouteWords`, fieldstg.s:8780/:8785). `undefined`
     * means the opcode publishes nothing at all, which is different from publishing a
     * zero pair. See engine/systems/route-pair.ts.
     */
    routeWords?: { d78: number; d7a: number };
    /** the disc put the indicator into its "step is not live" state. */
    bubbleHidden: boolean;
    /** the disc put the indicator into its "step used" state. */
    bubbleUsed: boolean;
}
/**
 * One frame of the disc's SETUP arm: the live, gated record under the player and
 * what its opcode did (fieldstg.s:5c94-:5cb8). No button is involved — that is the
 * whole difference from {@link StepPlayback}.
 */
export interface StepSetup {
    /** the step index (runner+0x5c) and its facing group (runner+0x60). */
    step: number;
    group: number;
    /** the setup opcode that ran. */
    op: number;
    /** what it did — engine/systems/scene-step-ops.ts. */
    effect: StepOpEffect;
    /** the record's own params, so a consumer never re-reads the program. */
    params: readonly number[];
}

export interface TriggerSystem {
  tick(mapId: string, x: number, y: number, facing?: number): boolean;
  /**
   * The disc's SETUP arm, one frame (fieldstg.s:5c94-:5cb8: `step-load` then
   * `step-exec`). It asks for no button — see the header — so this is what a
   * walk-over opcode reads, every frame, and `playback()` is what a press reads.
   */
  setup: (mapId: string, x: number, y: number, facing?: number) => StepSetup | null;
  /** step-load 0x80088288 with the facing cone folded in. */
  sampleStep(mapId: string, x: number, y: number, facing?: number): StepSample | null;
  _sampleStepByte(grid: StepGrid | null, x: number, y: number): number | null;
  _stepLive(op: number, group: number, facing: number): boolean;
  _gatePasses(step: Step): boolean;
  /** Whether op 8 has already latched a runner for this stage (extra+4, fieldstg.s:57c0). */
  latched(mapId: string): boolean;
  /** The op this tick's step ran, or null when no live gated step ran (fieldstg :573c). */
  lastOp: (mapId: string) => StepOpEffect | null;
  /**
   * The proximity icon the disc would draw under the player right now, read the way
   * step-exec reads it: grid byte -> step index -> the op's kind. Null when no step is
   * live or the op draws no bubble. This is the port the indicator reads.
   */
  indicator: (mapId: string, x: number, y: number, facing?: number) => StepIndicator | null;
  /**
   * exec#2 — the playback executor, with the driver's own state-1 gates in front of it
   * (fieldstg.s:5bd8-5d84). `circleHeld` is the pad: the disc reads mask 0x2000 and
   * runs only while it is held.
   */
  playback: (mapId: string, x: number, y: number, facing: number, circleHeld: boolean) => StepPlayback | null;
}

// Opcodes whose liveness the disc decides through the 0x80097624 cone
// (fieldstg.s:5650/565c/5668/5670); everything else returns 1 without reading it.
function coneGated(op: number): boolean {
  return op < 5 || op === 7 || op >= 15;
}

export function createTriggerSystem(deps: TriggerDeps): TriggerSystem {
  const {
    getProgram, getGrid, getEnableTable, getEventById, getEventByKey,
    flags, done, markDone, playEvent, handoffPending, isBusy, getZoneRuns,
  } = deps;
  let _firing = false;
  // The op result of the last live, gated step, per driver instance. The disc keeps
  // this in the driver's own 8-byte extra buffer and the indicator actor beside it.
  const lastOpByMap = new Map<string, StepOpEffect | null>();
  // extra+4 per driver instance. The driver is created fresh on every stage load
  // (fieldstg.s:5998) and nothing clears the word, so the latch lives exactly as long as
  // one visit to a stage. A stage change is what ends that visit here.
  let latchedByMap: string | null = null;
  // runner+0x5c / runner+0x60 — the driver's own two words, zero until a frame reads a
  // non-zero grid byte.
  const runner = { step: 0, group: 0 };
  let runnerMap: string | null = null;

  // The grid value is the FULL trigger byte: low 5 bits = step index, top 3 = the
  // required approach-facing group (step-load 0x80088288 :5614-:5628).
  function sampleStepByte(grid: StepGrid | null, x: number, y: number): number | null {
    if (!grid) return null;
    if (grid.uniform !== undefined) return grid.uniform & 0xff;
    if (grid.cell === undefined || grid.w === undefined || grid.h === undefined || !grid.grid) return null;
    const cx = Math.floor(x / grid.cell), cy = Math.floor(y / grid.cell);
    if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return null;
    const b = grid.grid[cy * grid.w + cx];
    return b == null ? null : b & 0xff;
  }

  // Per-stage row index of the exact zone runs, so a lookup is O(runs in that
  // row) rather than O(runs). Keyed by the runs ARRAY the host handed us (a
  // stable reference per stage), so no mapId bookkeeping is needed.
  const zoneRunIndex = new WeakMap<object, Map<number, Array<readonly number[]>>>();
  function zoneByteAt(runs: readonly (readonly number[])[], x: number, y: number): number {
    let index = zoneRunIndex.get(runs);
    if (!index) {
      index = new Map();
      for (const r of runs) {
        const row = r[2] ?? 0;
        const list = index.get(row);
        if (list) list.push(r); else index.set(row, [r]);
      }
      zoneRunIndex.set(runs, index);
    }
    const row = index.get(y);
    if (row) {
      for (const r of row) {
        if (x >= (r[0] ?? 0) && x <= (r[1] ?? 0)) return (r[3] ?? 0) & 0xff;
      }
    }
    return 0;
  }

  /**
   * The type-7 trigger byte at the player's own pixel (x,y) — the disc's
   * `zonecheck(7, x, y)` (`fieldstg.s:5514` hands it the actor's `+0x58`/`+0x5c`).
   *
   * The exact per-pixel zones are consulted ONLY around a DRAW-LAYER (op 5) tile:
   * when the pixel's grid byte names an op-5 step, OR when the pixel's zone byte
   * does. That is the one authoring the playtest proved needs the pixel-exact read
   * (`stepSetupBucketTick` in web/game.js — the Protocol Ruins tunnel's hide/restore,
   * where a 32 px cell grid fires a step up to a cell early, and where the grid's
   * most-frequent-byte rule mislabels half the mouth cell op 6). EVERY OTHER TILE
   * KEEPS THE CELL GRID: the disc's own patch is a sub-cell region and the playtest-
   * validated ordinary route (doors, ladders, ledges) stands on pixels that patch
   * does not cover, so arming only the patch goes dark at the cell centre the walker
   * uses. Measured 2026-10-07: the pure zone read darkened s210/s220's doors, s946's
   * ladder and s375's own op-4 ledge; see
   * `.dw3-research/step-zone-regression-2026-10-07/worker-p.md`. With no zone asset,
   * or no captured op-5 step, the grid is the answer.
   */
  function zoneByte(mapId: string, x: number, y: number): number {
    // The disc reads INTEGER PIXELS: step-load hands `zonecheck(7, …)` the actor's
    // own `+0x58`/`+0x5c` (pro/fieldstg.s:5514), the character's screen-space pixel
    // word. The walker's `state.x`/`state.y` are FRACTIONAL while walking
    // (web/game.js moveWithCollision returns x+dx), and `zoneByteAt` keys its row
    // map by the exact integer row AND tests the run's x bounds — so an un-floored
    // y found no row and an un-floored x could slip past a run's right edge. Every
    // op-5 tile therefore went dark on the move: the Protocol Ruins tunnel's hide
    // fired only when the player stood on an exact integer pixel (a placed test),
    // never while actually walking in (four failed fixes, 2026-10-08). Floor here
    // once, the way the disc's own pixel read is integral.
    const px = Math.floor(x), py = Math.floor(y);
    const grid = sampleStepByte(getGrid(mapId), px, py) ?? 0;
    const runs = getZoneRuns ? getZoneRuns(mapId) : null;
    if (!runs || !runs.length) return grid;
    const prog = getProgram(mapId);
    const opOf = (byte: number): number => {
      const rec = prog ? prog.steps[byte & 0x1f] : undefined;
      return rec ? rec.op : 0;
    };
    if (opOf(grid) !== 5) {
      const zb = zoneByteAt(runs, px, py);
      // The grid's cell vote can label a real op-5 patch with a neighbour's byte
      // (s375's tunnel mouth: grid 164/op 6 over disc 1/op 5). Let the exact zone
      // win only when it is itself the draw-layer tile.
      return zb && opOf(zb) === 5 ? zb : grid;
    }
    return zoneByteAt(runs, px, py);   // grid names the draw layer: take the exact edge
  }

  // The gate. A gated opcode is live iff cone[group][facing] != 0; an ungated one is
  // always live. With no table shipped the cone cannot be consulted, and the disc's
  // table has no zero row, so the gated opcodes stay live rather than going dark.
  function stepLive(op: number, group: number, facing: number): boolean {
    if (!coneGated(op)) return true;
    const table = getEnableTable();
    const row = table?.rows?.[group & 7];
    if (!row) return true;
    return !!row[facing & 7];
  }

  /**
   * The disc keeps the two fields in the driver object itself, so a frame whose grid
   * byte is 0 leaves them at whatever the last non-zero byte wrote (fieldstg.s:5618
   * branches out BEFORE the two stores at :5628/:5634). `runner` is that memory.
   */
  function sampleStep(mapId: string, x: number, y: number, facing = 0): StepSample | null {
    const prog = getProgram(mapId);
    if (!prog) return null;
    if (runnerMap !== mapId) { runnerMap = mapId; runner.step = 0; runner.group = 0; }
    const byte = zoneByte(mapId, x, y);
    if (byte === 0) return { step: runner.step, group: runner.group, live: false }; // :5618
    runner.step = byte & 0x1f;                              // :5624
    runner.group = (byte >> 5) & 7;                         // :5620
    const rec = prog.steps[runner.step];
    const op = rec ? rec.op : 0;
    return { step: runner.step, group: runner.group, live: stepLive(op, runner.group, facing) };
  }

  // A step runs iff get_flag(cond,arg) holds for BOTH conds. An unmodelled flag returns
  // null, which matches neither arg → that step stays dormant.
  function gatePasses(step: Step): boolean {
    if (step.cond_a !== 0xffff && !flagConditionPasses(flags.get.bind(flags), step.cond_a, step.arg_a)) return false;
    if (step.cond_b !== 0xffff && !flagConditionPasses(flags.get.bind(flags), step.cond_b, step.arg_b)) return false;
    return true;
  }

  /**
   * The icon the disc would draw here: grid byte -> step index -> the op's kind
   * (fieldstg.s:587c-589c via engine/systems/scene-step-ops.ts). It reads the same
   * three things step-exec reads — the grid, the cone and the two flag gates — so the
   * bubble and the op's behaviour can never disagree about whether the step is live.
   */
  function indicator(mapId: string, x: number, y: number, facing = 0): StepIndicator | null {
    const prog = getProgram(mapId);
    if (!prog) return null;
    const s = sampleStep(mapId, x, y, facing);
    if (s === null || !s.live) return null;                  // :5648-:56a4
    const step = prog.steps[s.step];
    if (!step || !gatePasses(step)) return null;              // :56d4-:5738
    const eff = execStepRecord(step, s.group);
    return { step: s.step, group: s.group, op: step.op, kind: eff.kind };
  }

  // Per-frame driver. Returns true if it fired a cutscene this tick.
  function tick(mapId: string, x: number, y: number, facing = 0): boolean {
    if (latchedByMap !== mapId) latchedByMap = null;   // new stage = new driver = clear latch
    const su = setup(mapId, x, y, facing);
    if (!su) { lastOpByMap.set(mapId, null); return false; }
    lastOpByMap.set(mapId, su.effect);

    if (su.op !== 8) return false;                              // only start_event acts
    if (_firing || (isBusy && isBusy())) return false;

    // The disc's latch is the runner pointer in the controller, not a per-flag_key done
    // set (fieldstg.s:57c0 `bnez` on extra+4), and op 8 sets it on the way past — in the
    // jump's delay slot at :57e8 — so it latches even when the event id the step names is
    // not in this stage's table and start_event binds nothing.
    if (latchedByMap !== null) return false;
    latchedByMap = mapId;

    const prog = getProgram(mapId);
    const erec = prog!.events.find((e) => e.event_id === su.params[0]);
    if (!erec) return false;
    const ev = getEventById(mapId, su.params[0] ?? -1) ?? getEventByKey(mapId, erec.flag_key);
    if (!ev) return false;

    _firing = true;
    playEvent(ev, () => {
      _firing = false;
      markDone(erec.flag_key);
      if (!deps.hostCompletesEvent) for (const [fid, val] of (erec.sets || [])) flags.set(fid, !!val); // open downstream gates
    });
    return true;
  }

  /**
   * The SETUP arm, one frame (fieldstg.s:5c94-:5cb8) — `step-load` (0x80088288)
   * then `step-exec` (0x8008836c), with the record's own two conditions in front
   * (:56dc/:5700, :5710/:5734). Every live, gated setup opcode runs every frame
   * and no button is read; the header says why, op by op. This is the ONE reading
   * of "what does this tile do while the player stands on it".
   */
  function setup(mapId: string, x: number, y: number, facing = 0): StepSetup | null {
    const prog = getProgram(mapId);
    if (!prog) return null;
    const s = sampleStep(mapId, x, y, facing);
    if (s === null || !s.live) return null;                            // :5648-:56a4
    const step = prog.steps[s.step];
    if (!step || !gatePasses(step)) return null;                       // :56d4-:5738
    return {
      step: s.step,
      group: s.group,
      op: step.op,
      effect: execStepRecord(step, s.group),
      params: step.params ?? [],
    };
  }

  /**
   * exec#2 — the playback executor (`0x800885d4`), reached the way the disc's own
   * resident driver reaches it (fieldstg.s:5bd8-5d84). This is the ONE reading of "what
   * does pressing on this tile do": the walker asks it for doors, ladders and warps
   * instead of reading the step program itself.
   *
   * The gates, in the disc's own order:
   *   :5c08  the driver's level-0 state is 1 (this caller is the playback arm)
   *   :5c54  scene_struct+0x58 clear, else return
   *   :5c64  scene_struct+0x54 clear, else return
   *   :5c7c  the sub-state is 1; 0 is the indicator arm and 2 is the release arm
   *   :5cbc  step-load must report live
   *   :5cc8  ... and if it does not, the indicator is put away (setState(2))
   *   :5d04  pad mask 0x2000 must be HELD
   *   :5d10  scene_struct+0x54 clear AGAIN (checked after the pad read)
   *   :5d20  indicator setState(3), then :5d38 the executor
   *   and, in front of all of them, the RECORD'S OWN FLAG CONDITIONS — see the note
   *   below; they are what decides whether the disc ever reaches this arm at all.
   *
   * A stage with no step program returns null: it has no step tiles at all, so nothing
   * there is armed by this system (its doors come from the ordinary warp tables).
   *
   * A stage with an EMPTY program (`story_steps.json` stage entry, `steps: []`) returns
   * null for the same reason, and that is a real gap rather than a fact about the disc:
   * s780 is the one stage still in that state. Its overlay keeps no parseable
   * `scene+0x14` store (wstag780 0x10a0-0x10ac is a function's return value, not a
   * constant), so `tools/extract_story_steps.step_program_ptr` finds nothing to read. It
   * also ships no type-7 grid, so no step tile exists to answer either way — measured, the
   * one stage in the game where this rule is currently load-bearing. Until that overlay's
   * program is read, treating an empty program as "no step tiles" keeps the door rows
   * standing on their own instead of leaving them permanently dark, and it changes nothing
   * on the 290 stages that do carry records.
   */
  function playback(mapId: string, x: number, y: number, facing: number, circleHeld: boolean): StepPlayback | null {
    const prog = getProgram(mapId);
    if (!prog || !prog.steps?.length) return null;              // no step program: no tiles
    if (handoffPending && handoffPending()) return null;      // :5c54 / :5c64 / :5d10
    const s = sampleStep(mapId, x, y, facing);
    // Not live -> the disc's other arm: the indicator is put away (:5cc8/:5ce0).
    const step = s ? prog.steps[s.step] : undefined;
    if (s === null || !s.live || !step) {
      return {
        live: false, step: s ? s.step : 0, group: s ? s.group : 0,
        op: null, effect: null, bubbleHidden: true, bubbleUsed: false,
      };
    }
    // The record's flag conditions, which the disc reads in the SETUP arm and never
    // re-reads here — yet they still decide whether this arm is EVER reached, because
    // they gate the level-1 increment that is the driver's only way out of sub-state 0:
    //   :5700 / :5734  beqz $v0, .L0x00005d84   cond A / cond B failed -> plain RETURN,
    //                                             skipping :5d40
    //   :5cb4 j 0x800889f0 -> :5d40 lw $v0,0x3c($s0) / :5d48 jalr   the ONE increment
    //                                             (F0x800142c8: +0x10 += 1), reached
    //                                             only from a setup arm that PASSED
    //   :5c7c beq $v1,$a0 -> :5cbc               sub-state 1 == the playback arm
    // So a step whose conds fail can never play back, whatever the pad says. This is
    // the FishingPole gate: all 212 op-7 records carry cond_a = 0x8005, arg_a = 1
    // (item 5 possession), so without the rod the cast never starts.
    if (!gatePasses(step)) {
      return {
        live: false, step: s.step, group: s.group,
        op: null, effect: null, bubbleHidden: true, bubbleUsed: false,
      };
    }
    if (!circleHeld) {                                        // :5d04 `beqz` -> return
      return {
        live: true, step: s.step, group: s.group, op: null, effect: null,
        bubbleHidden: false, bubbleUsed: false,
      };
    }
    const effect = execPlaybackRecord(step, s.group);        // :5d38
    // The pair the two writer sites publish for this opcode, from the same record.
    const routeWords = effect.routeWords ?? launcherRouteWords(step.op, step.params);
    return {
      live: true, step: s.step, group: s.group, op: step.op, effect,
      ...(routeWords ? { routeWords } : {}),
      bubbleHidden: false, bubbleUsed: true,                 // :5d20 setState(3)
    };
  }

  return {
    tick,
    setup,
    sampleStep,
    _sampleStepByte: sampleStepByte,
    _stepLive: stepLive,
    _gatePasses: gatePasses,
    latched: (mapId) => latchedByMap === mapId,
    lastOp: (mapId) => (lastOpByMap.has(mapId) ? lastOpByMap.get(mapId)! : null),
    indicator,
    playback,
  };
}
