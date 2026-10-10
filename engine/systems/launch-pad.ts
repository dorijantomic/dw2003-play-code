// Launch pads — the Ice Dungeon (s735/s736) teleport pads and s800's pair.
//
// DECODE (runtime, controlled PCSX-Redux replay 2026-07-28 + fieldstg.s static
// correlation). Full trace:
// docs/research/field/captures/ice-teleport-op13-state1-2026-07-28.txt
// Summary: docs/research/field/door-warp-decode.md.
//
// The step-program dispatcher F0x8008836c sends op 13 through the field
// character's actor method +0x158 = F0x8008f44c. That method puts the actor in
// mode 1, installs handler F0x8008eef0, sets facing 0, raises the scene lock
// (scene_struct+0x58) and constructs the 0x74-byte transition controller
// F0x8008c130 via F0x8008c610. The controller runs four states:
//
//   1. Locate the nearest type-0x17 pad object and target its centre
//      (pad.x + 20, pad.y + 13); walk the leader there under controller
//      control (trace frames 14-33 for a 20px approach).
//   2. Request pad state 2 and wait out its activation animation
//      (frames 35-122 = 88 frames), holding the leader on the pad centre.
//   3. Flight: a phase counter runs from 0x18 to 0x1000 (frames 124-265 = 142
//      frames). Each axis is advanced by F0x8008c0f0, which feeds phase>>2 to
//      the signed sine table F0x8002abcc — phase 0x1000 >> 2 = 0x400 = 90
//      degrees, so the motion is a QUARTER SINE ease from the pad centre to
//      the record's signed destination x/y.
//   4. Snap exactly to the destination, clear the scene lock, restore handler
//      F0x8008e8ac (frames 266-268).
//
// Followers leave their normal handlers and are parked while the sequence
// runs; handler F0x8008eae8 is restored at frame 268, and they re-enter mode 4.
//
// THE PAD OBJECT (decoded 2026-07-28 from wstag735/736 + eight more overlays).
// A launch pad is NOT a fieldstg system: each stage overlay builds its own
// type-0x17 objects in its init pass from a 12-byte record table
// {s16 clipBase, s16 guard, s32 x, s32 y} -- s735's is at RAM 0x800a67dc, ten
// slots. `tools/extract_launch_pads.py` lifts all ten stages' tables into
// web/assets/data/launch_pads.json; s735 slot 3 is (444,652), the pad the
// runtime capture homed in on. The object's callback (wstag735 F0x800a620c)
// copies x/y to obj+0x4/+0x8, which is what the transition controller reads.
//
// A pad is never inert: from the moment the stage loads it runs a looping IDLE
// script that cycles its floor disc through three palette rows (see
// PAD_IDLE_SCRIPT below). The disc's hue is its clip base, so a stage's pads
// come in red, green and blue.
//
// THE SOUND. fieldstg 0x8008c34c plays packed id 0x0004001d = TELEPORT at the
// instant the controller flips the pad into state 2 -- i.e. the moment the
// leader lands on the pad and it starts to flash, not at lift-off. It is the
// only sound on the whole op-13 path.
//
// TIMEBASE. The native drives everything off two EXE globals: [0x8004de28] is
// the per-frame delta (F0x8001d704) and [0x8004de20] the free-running tick
// counter (F0x8001d6f4). Flight phase advances `delta * 24` per frame; the pad
// animator decrements its hold timer by `min(delta, 4)`; the tumble reads the
// tick counter directly. The walker runs one tick per rendered frame (delta 1),
// which is the native behaviour on an undropped frame. Note this makes the
// sequence ~20% longer than the 2026-07-28 capture's frame indices suggest --
// the capture's own internal ratios (87:142 charge:flight, 5 frames per a
// 6-tick clip hold) are all a consistent 1.2x off the table data, so its frame
// counter was not 1:1 with vsync. Settling the wall-clock rate needs a capture
// that samples [0x8004de20] alongside the frame index; the ratios below come
// from the tables and are exact.

/** Offset from a type-0x17 pad object's origin to the leader's stand point. */
export const PAD_CENTER_OFFSET = { x: 20, y: 13 } as const;

/** Ticks between the exact destination snap and the actor/lock restore. */
export const RESTORE_FRAMES = 2;

/** Phase counter bounds read from the controller's +0x18 field. */
export const PHASE_START = 0x18;
export const PHASE_END = 0x1000;

/** Phase added per tick: fieldstg 0x8008c428 computes `delta * 3 << 3`. */
export const PHASE_STEP = 24;

/** Ticks of eased flight: PHASE_START -> PHASE_END at PHASE_STEP per tick. */
export const FLIGHT_FRAMES = Math.ceil((PHASE_END - PHASE_START) / PHASE_STEP);

/** Walk speed (px/frame) used for the controller-driven approach: the capture
 *  covered (484,659)->(464,665) in frames 14-33, i.e. ~20px over 19 frames. */
export const APPROACH_SPEED = 1;

// THE SPIN. fieldstg 0x8008c56c-0x8008c58c, run every flight tick:
//
//     facing = ([0x8004de20] >> 1) & 7
//
// i.e. the leader's facing is slaved directly to the free-running global tick
// counter, one step every two ticks, a full 8-step revolution every 16. Junior
// tumbles through the air rather than holding a pose, and because the counter
// is global the rate is constant in TIME, not in distance -- the last
// revolution takes as long as the first even though the eased path has almost
// stopped by then. The capture's ten revolutions over 134 sampled frames agree
// with 16 ticks/revolution at the same 1.2x frame:tick ratio as everything else
// on this path.
export const SPIN_TICKS_PER_STEP = 2;

/** Facing index the capture's flight started from (trace frame 124). The
 *  native value depends on the global counter's phase, so this is only the
 *  default seed, not a fixed property of the sequence. */
export const SPIN_START_FACING = 3;

/** facing = (tick >> 1) & 7 — the native expression, verbatim. */
export function spinFacing(tick: number): number {
  return (Math.floor(Math.max(0, tick) / SPIN_TICKS_PER_STEP)) & 7;
}

// THE PAD FLASH. The pad object's clip id (+0x68) is driven by the stage
// overlay's generic 4-byte-entry animator (wstag735 F0x800a5f40): each entry is
// {s16 value, u16 holdTicks}, the cursor holds `value` for `holdTicks` ticks,
// 0xff ends the script. The pad's strobe script is the table at RAM
// 0x800a686c, read verbatim below, and the drawn clip is
//
//     clip = padClipBase + value        (value 0x12c and 0xff draw nothing)
//
// so the ids are per-pad: s735's ordinary pads have base 0x1c and therefore
// strobe through 0x1d..0x23, exactly the range the capture sampled. The first
// entry is an 18-tick dark wind-up; then a 6-tick ramp up through +1..+4; then
// the +5/+6/+7 triple FOUR times at 4 ticks each; then a 4-tick ramp back down.
// Total 106 ticks, and the capture's 87 frames of state-2 is the same 1.2x.
//
// (This supersedes the earlier hand-transcribed timeline, which recorded the
// strobe holds as an irregular 3,3,4. They are uniformly 4 ticks; the 3,3,4 was
// the frame:tick ratio aliasing against the sampler.)
export const PAD_CLIP_SCRIPT_END = 0xff;
export const PAD_CLIP_SCRIPT_BLANK = 0x12c;

/** One `{s16 value, u16 holdTicks}` animator entry. */
export type PadScriptEntry = readonly [number, number];

export interface PadCursor {
  /** Script index (the object's +0x60/+0x5c halfword). */
  index: number;
  /** Ticks left on the current entry (+0x62/+0x5e). */
  timer: number;
}

/** Cursor as the pad's state-0 init leaves it: entry 0, loaded with its hold. */
export function newPadCursor(script: readonly PadScriptEntry[]): PadCursor {
  return { index: 0, timer: script[0]?.[1] ?? 0 };
}

/**
 * The stage animator, verbatim (wstag735 F0x800a5f40).
 *
 *     timer -= min(delta, 4)            // outermost call only
 *     while (timer <= 0) {
 *         index++;  timer += hold(index);
 *         if (value(index) == 0xff) { if (oneShot) return 0xff;
 *                                     index = 0; timer += hold(0); }
 *     }
 *     return value(index)
 *
 * `oneShot` is the native's $a2: 0 wraps the script at its terminator (the idle
 * pulse, which never stops), 1 stops on it (the launch strobe). The hold carries
 * over rather than resetting, which is why the cycle does not drift.
 */
export function advancePadScript(
  cur: PadCursor,
  script: readonly PadScriptEntry[],
  oneShot: boolean,
  delta = 1,
): number {
  if (!script.length) return PAD_CLIP_SCRIPT_END;
  cur.timer -= Math.min(delta, 4);
  let guard = 0;
  while (cur.timer <= 0 && guard++ < 1024) {
    cur.index += 1;
    if (cur.index >= script.length) cur.index = script.length - 1;
    cur.timer += script[cur.index]![1];
    if (script[cur.index]![0] === PAD_CLIP_SCRIPT_END) {
      if (oneShot) return PAD_CLIP_SCRIPT_END;
      cur.index = 0;
      cur.timer += script[0]![1];
    }
  }
  return script[cur.index]![0];
}

// THE IDLE COLOUR PULSE. A pad runs a SECOND script the whole time it is on
// screen, from the moment the stage loads — cursor +0x60/+0x62 on the table at
// wstag735 RAM 0x800a6854, looping (oneShot = 0). Its value lands in obj+0x66,
// and the pad's draw (wstag735 F0x800a6060) passes that to the draw context's
// method +0x88 = EXE F0x8001ecec, which stores it at ctx+0x20 — the value
// F0x8001ed6c adds to the sprite's CLUT ROW:
//
//     clutId = ((clutY + ctx->unk20) << 6) | ((clutX >> 4) & 0x3f)
//
// So the idle value is a PALETTE ROW OFFSET on the pad's floor disc, not a clip
// id: the same disc art is drawn through three consecutive palettes. Cut from
// the disc, the three rows are a dim / mid / bright ramp of one hue, and the
// hue is the pad's own clip base — s735's bases 0x14/0x1c/0x24 are RED, BLUE
// and GREEN discs. That is the colour pulse a pad shows before anyone steps on
// it. The strobe column (obj+0x68/+0x6a) is never given a CLUT offset, so it
// always draws on palette row 0.
//
// Identical in all ten launch-pad overlays (extract_launch_pads.py reads the
// script per stage into launch_pads.json rather than assuming this table).
export const PAD_IDLE_SCRIPT: ReadonlyArray<PadScriptEntry> = [
  [0, 6], [1, 6], [2, 68], [1, 4], [0, 4],
  [PAD_CLIP_SCRIPT_END, 0],
];

/** Ticks in one full idle colour cycle (the terminator wraps for free). */
export const PAD_IDLE_CYCLE_TICKS = PAD_IDLE_SCRIPT.reduce(
  (t, [value, hold]) => (value === PAD_CLIP_SCRIPT_END ? t : t + hold),
  0,
);

/**
 * CLUT row offset the idle pulse is showing `tick` ticks after the pad spawned
 * (or after a launch restarted it). Pure form of the cursor walk above.
 */
export function padIdlePalette(
  tick: number,
  script: readonly PadScriptEntry[] = PAD_IDLE_SCRIPT,
): number {
  const cycle = script.reduce(
    (t, [value, hold]) => (value === PAD_CLIP_SCRIPT_END ? t : t + hold),
    0,
  );
  if (cycle <= 0) return 0;
  let at = ((Math.floor(Math.max(0, tick)) % cycle) + cycle) % cycle;
  for (const [value, hold] of script) {
    if (value === PAD_CLIP_SCRIPT_END) break;
    if (at < hold) return value;
    at -= hold;
  }
  return 0;
}

/** [value, holdTicks] straight out of wstag735 RAM 0x800a686c. */
export const PAD_CLIP_SCRIPT: ReadonlyArray<readonly [number, number]> = [
  [PAD_CLIP_SCRIPT_BLANK, 18],
  [1, 6], [2, 6], [3, 6], [4, 6],
  [5, 4], [6, 4], [7, 4],
  [5, 4], [6, 4], [7, 4],
  [5, 4], [6, 4], [7, 4],
  [5, 4], [6, 4], [7, 4],
  [4, 4], [3, 4], [2, 4], [1, 4],
  [PAD_CLIP_SCRIPT_END, 999],
];

export const PAD_WINDUP_FRAMES = PAD_CLIP_SCRIPT[0]![1];
export const PAD_LOOP_REPEATS = 4;

/** Ticks the pad holds state 2 — the whole script up to its 0xff terminator. */
export const PAD_ANIM_FRAMES = PAD_CLIP_SCRIPT.reduce(
  (t, [value, hold]) => (value === PAD_CLIP_SCRIPT_END ? t : t + hold),
  0,
);

/** Base clip of s735's ordinary pads, so the capture's 0x1d..0x23 reproduce
 *  when no per-pad base is supplied. Real bases come from launch_pads.json. */
export const DEFAULT_PAD_CLIP_BASE = 0x1c;

/**
 * The pad's drawn clip `tick` ticks into its state-2 animation, or 0 when the
 * pad draws no strobe (the wind-up entry, and once the script ends).
 */
export function padAnimationClip(tick: number, clipBase = DEFAULT_PAD_CLIP_BASE): number {
  if (tick < 0) return 0;
  let at = 0;
  for (const [value, hold] of PAD_CLIP_SCRIPT) {
    if (value === PAD_CLIP_SCRIPT_END) return 0;
    at += hold;
    if (tick < at) {
      return value === PAD_CLIP_SCRIPT_BLANK ? 0 : clipBase + value;
    }
  }
  return 0;
}

/** Packed sound id fieldstg 0x8008c34c plays when the pad enters state 2. */
export const LAUNCH_PAD_SOUND_ID = 0x0004001d;
export const LAUNCH_PAD_SOUND = "TELEPORT";

export type LaunchPhase = "approach" | "charge" | "flight" | "done";

export interface LaunchExit {
  /** Trigger rectangle from the type-7 grid. */
  x?: number; y?: number; w?: number; h?: number;
  /** Record destination (signed x/y at record +2/+4). */
  spawnX?: number; spawnY?: number;
  dir?: string;
  transition?: string;
  stepOp?: number;
  launchPad?: boolean;
}

export function isLaunchExit(exit: LaunchExit | null | undefined): boolean {
  return !!exit && exit.stepOp === 13 && exit.transition === "launch";
}

/** Quarter-sine ease: sin(t * 90deg), matching F0x8008c0f0's phase>>2 lookup. */
export function launchEase(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return Math.sin((c * Math.PI) / 2);
}

/** Phase value at flight frame `frame` (0-based), clamped to PHASE_END. */
export function launchPhase(frame: number): number {
  return Math.min(PHASE_END, PHASE_START + PHASE_STEP * Math.max(0, frame));
}

export interface LaunchPad {
  x: number;
  y: number;
  /** Base clip id (the record's first halfword). */
  clip?: number;
  enabled?: boolean;
}

/**
 * The pad the controller picks: fieldstg 0x8008c1bc-0x8008c218 scores every
 * registered type-0x17 object as `|dx| + 2*|dy|` from the leader and keeps the
 * smallest — a y-weighted metric, not true distance, because the field is drawn
 * at half vertical scale.
 */
export function nearestPad(
  pads: readonly LaunchPad[] | null | undefined,
  from: { x: number; y: number },
): LaunchPad | null {
  let best: LaunchPad | null = null;
  let bestScore = 0x8000; // the native's initial $s2
  for (const pad of pads ?? []) {
    if (pad.enabled === false) continue;
    const score = Math.abs(from.x - pad.x) + 2 * Math.abs(from.y - pad.y);
    if (score < bestScore) {
      bestScore = score;
      best = pad;
    }
  }
  return best;
}

/**
 * Stand point for the pad. `pad` is a type-0x17 object origin when one is
 * known; otherwise the trigger rectangle's centre stands in (see header).
 */
export function padCenter(
  exit: LaunchExit,
  pad?: { x: number; y: number } | null,
): { x: number; y: number } {
  if (pad) return { x: pad.x + PAD_CENTER_OFFSET.x, y: pad.y + PAD_CENTER_OFFSET.y };
  const x = (exit.x ?? 0) + (exit.w ?? 0) / 2;
  const y = (exit.y ?? 0) + (exit.h ?? 0) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

export interface LaunchState {
  phase: LaunchPhase;
  /** Frames spent in the current phase. */
  frame: number;
  /** Pad stand point. */
  padX: number;
  padY: number;
  /** Record destination. */
  destX: number;
  destY: number;
  /** Where the flight started (the pad centre). */
  fromX: number;
  fromY: number;
  dir: string;
  /** Live leader position produced by the controller. */
  x: number;
  y: number;
  /** Native facing index (char+0x60). Spins 0-7 for the whole flight. */
  facing: number;
  /** Ticks into the pad's state-2 animation, or -1 outside it. */
  padFrame: number;
  /** The pad's current drawn clip id (0 = nothing drawn). */
  padClip: number;
  /** Base clip of the pad being used, for padClip and the idle sprite. */
  padClipBase: number;
  /** Pad object origin (top-left), for the renderer. */
  padOriginX: number;
  padOriginY: number;
  /** Free-running tick counter standing in for [0x8004de20]. */
  tick: number;
  /** Set for one step when the pad enters state 2; the TELEPORT cue. */
  playSound: string | null;
  /** Set for the same one step: entering state 2 rewinds the pad's idle colour
   *  cursor (wstag735 0x800a6320-0x800a6348 stores 0 to +0x60 and reloads
   *  +0x62), so the pulse restarts as the pad starts to flash. */
  padIdleReset: boolean;
  /** True while the scene lock (scene_struct+0x58) is raised. */
  locked: boolean;
}

/** Build the controller state for one activation. */
export function startLaunch(
  exit: LaunchExit,
  from: { x: number; y: number },
  pad?: LaunchPad | null,
): LaunchState {
  const c = padCenter(exit, pad);
  return {
    phase: "approach",
    frame: 0,
    padX: c.x,
    padY: c.y,
    destX: exit.spawnX ?? c.x,
    destY: exit.spawnY ?? c.y,
    fromX: c.x,
    fromY: c.y,
    dir: exit.dir ?? "down",
    x: from.x,
    y: from.y,
    // The actor method sets facing 0 before installing the flight handler.
    facing: 0,
    padFrame: -1,
    padClip: 0,
    padClipBase: pad?.clip ?? DEFAULT_PAD_CLIP_BASE,
    padOriginX: pad ? pad.x : c.x - PAD_CENTER_OFFSET.x,
    padOriginY: pad ? pad.y : c.y - PAD_CENTER_OFFSET.y,
    tick: SPIN_START_FACING * SPIN_TICKS_PER_STEP,
    playSound: null,
    padIdleReset: false,
    locked: true,
  };
}

/**
 * Advance the controller by `frames` (fractional frames allowed — the browser
 * runs on a variable timestep). Mutates and returns `st`; `phase === "done"`
 * means the leader is snapped, the lock is cleared and followers may recover.
 */
export function stepLaunch(st: LaunchState, frames = 1): LaunchState {
  st.playSound = null;
  st.padIdleReset = false;
  if (st.phase === "done") return st;
  st.tick += frames;
  let left = frames;
  while (left > 0 && st.phase !== "done") {
    if (st.phase === "approach") {
      const dx = st.padX - st.x;
      const dy = st.padY - st.y;
      const dist = Math.hypot(dx, dy);
      const move = APPROACH_SPEED * left;
      if (dist <= move || dist === 0) {
        st.x = st.padX;
        st.y = st.padY;
        left -= dist / APPROACH_SPEED;
        st.phase = "charge";
        st.frame = 0;
      } else {
        st.x += (dx / dist) * move;
        st.y += (dy / dist) * move;
        left = 0;
      }
      continue;
    }
    if (st.phase === "charge") {
      const need = PAD_ANIM_FRAMES - st.frame;
      const used = Math.min(left, need);
      st.frame += used;
      left -= used;
      if (st.padFrame < 0) {
        st.playSound = LAUNCH_PAD_SOUND;
        st.padIdleReset = true;
      }
      st.padFrame = st.frame;
      st.padClip = padAnimationClip(st.frame, st.padClipBase);
      if (st.frame >= PAD_ANIM_FRAMES) {
        st.phase = "flight";
        st.frame = 0;
        st.padFrame = -1;
        st.padClip = 0;
        st.facing = spinFacing(st.tick);
      }
      continue;
    }
    // flight
    const need = FLIGHT_FRAMES + RESTORE_FRAMES - st.frame;
    const used = Math.min(left, need);
    st.frame += used;
    left -= used;
    const t = Math.min(1, launchPhase(st.frame) / PHASE_END);
    const e = launchEase(t);
    st.x = st.fromX + (st.destX - st.fromX) * e;
    st.y = st.fromY + (st.destY - st.fromY) * e;
    // Tumble: facing = (tick >> 1) & 7, straight off the global counter.
    st.facing = spinFacing(st.tick);
    if (st.frame >= FLIGHT_FRAMES) {
      st.x = st.destX;
      st.y = st.destY;
    }
    if (st.frame >= FLIGHT_FRAMES + RESTORE_FRAMES) {
      st.phase = "done";
      st.locked = false;
      // Frames 265-268: the spin settles on facing 0 before the normal handler
      // comes back.
      st.facing = 0;
    }
  }
  return st;
}
