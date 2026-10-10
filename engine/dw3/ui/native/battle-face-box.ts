// The battle close-up face box — the 100x60 picture window that holds a close-up of the
// Digimon currently speaking — and the OBJECT rule that decides when it is on screen.
//
// The box is not a flag. It is one object of the exe's four-level object system, built by
// the battle HUD's own build arm, and the original's on/off behaviour falls out of that
// system's rules rather than out of any screen:
//
//   FIGHTSTG_F0x8009426c  the builder. F0x80014504(tick 0x80094064, size 0x58, child
//                         array 8) — fightstg.s:17891-17894.
//   FIGHTSTG_F0x80094064  the object's own step. State 0 writes the rectangle
//                         208,76,100,60 into 0x800A4710 and registers it through
//                         [0x8004DF7C](rect, 0x0C, 0x1009), then advances itself
//                         (fightstg.s:17777-17804). State 1 is the visible state: it hands
//                         key 0x1009 to this side's picture request and spawns the per-line
//                         worker (`:17806-17854`). State 3 clears the request and dequeues
//                         the layer through [0x8004DF80](0x1009) (`:17862-17882`).
//   FIGHTSTG_F0x80092684  the command-flow actor that owns it. Its arm for state 1,
//                         sub-state 1 builds the HP plates, the command window AND the box
//                         in one pass, each into its own child-array word, and each only
//                         when that word is empty: `lw $v0, 0x8($s0)` / `bnez` /
//                         `jal FIGHTSTG_F0x8009426c` (fightstg.s:16141-16153). Its arm for
//                         sub-state 3 builds the message line's owner and the box the same
//                         way (`:16364-16370`).
//
// The exe's object rules, which are what make the box come BACK:
//
//   F0x80018140  the per-object step (exe/fns.s:8850). It computes `s1 = (state ^ 3) < 1`
//                (`:8856-8860`), ticks the object (`:8877-8880`) and, for a state-3 object,
//                calls the destructor at `obj+0x4c` (`:8900-8903`) and returns 0
//                (`:8904-8905`). Otherwise it returns 1 and, while the object is in
//                state 1, steps the object's own children (`:8885-8897`).
//   F0x80018230  the child walk (exe/fns.s:8914). It walks the child count at `+0x20` over
//                the array at `+0x24` and writes each step's RETURN VALUE back over the
//                slot (`:8925-8931`), so a child that reached state 3 leaves a 0 behind.
//   D0x8004b7c4  the pointer that `F0x80018140` calls for the child walk; the exe's data
//                block binds it to F0x80018230 (~/ddw3/rust/dw2003_exe_data/src/data.rs:3412).
//
// So: state 3 is terminal, the slot empties itself, and the HUD build arm's
// `if (slot == 0)` test builds a FRESH object next time — which registers the layer again
// and re-frames the camera for whoever is speaking now. The same rule already read out for
// the battle message line is in docs/research/battle/3d-battle-complete-model-2026-08-19.md
// §8a ("the pointer is cleared by the generic child runner").
//
// Two hides reach state 3, both read out of the code:
//
//   FIGHTSTG_F0x8009a898  the battle message line's owner. On the arm where the player
//                         skipped a spoken line whose voice is still playing it writes 3
//                         into the box's state and into the paired window's
//                         (fightstg.s:24717-24722).
//   FIGHTSTG_F0x80092684  the actor's own tear-down arm walks its children and sends each
//                         one to state 3 (fightstg.s:16094-16098).
//
// Decode: docs/research/battle/battle-hud-ownership-check-2026-10-03.md §5.1a, corrected
// 2026-10-03 against the exe's child runner. Player-visible proof of the round-to-round
// return: docs/research/battle/captures/face-box-rounds-2026-10-03/ (five frames of one
// battle, no reload between them).

/** The box's layer key: the rectangle service and the 3D picture request both use it. */
export const FACE_BOX_LAYER_KEY = 0x1009;

/**
 * The box's own rectangle, the four halfwords state 0 writes into 0x800A4710 in order
 * (fightstg.s:17781, :17783, :17785, :17790 — 0xd0 = 208, 0x4c = 76, 0x64 = 100, 0x3c = 60).
 */
export const FACE_BOX_RECT = Object.freeze({ x: 208, y: 76, w: 100, h: 60 });

/**
 * The four states of the exe's object vtable, as the box's own step reads them
 * (fightstg.s:17780-17804 for 0 and 2, :17784 for 1, :17800 for 3).
 */
export const FACE_BOX_STATE = Object.freeze({
  /** builds the rectangle, registers the layer, advances itself */
  CREATE: 0,
  /** the visible state: owns the picture request and the per-line worker */
  VISIBLE: 1,
  /** the advance tail state 0 jumps to (`:17804`) */
  ADVANCE: 2,
  /** terminal: clears the request and dequeues the layer; the exe frees it */
  DESTROY: 3,
});

/** One box object plus the parent child-array word that holds it (actor arena word 2). */
export interface BattleFaceBox {
  /** the parent's child-array word: null when it is empty, as the exe leaves it. */
  slot: BattleFaceBox | null;
  /** the object's own state field (the exe's `+0x0c`). */
  state: number;
}

/** A battle that has built no box yet: an empty child slot, so nothing is on screen. */
export function createBattleFaceBox(): BattleFaceBox {
  return { slot: null, state: FACE_BOX_STATE.CREATE };
}

/**
 * The HUD build arm (fightstg.s:16141-16153): a fresh object only when the child slot is
 * empty, and it is visible from its first tick because state 0 advances itself into the
 * visible state. Returns true when this call built one.
 */
export function battleFaceBoxBuild(box: BattleFaceBox): boolean {
  if (box.slot !== null) return false;
  box.slot = box;
  box.state = FACE_BOX_STATE.VISIBLE;
  return true;
}

/**
 * The hide: the object's state field takes 3 (fightstg.s:24717-24719 for the message line's
 * owner, :16094-16098 for the actor's tear-down arm).
 */
export function battleFaceBoxSendDestroy(box: BattleFaceBox): void {
  box.state = FACE_BOX_STATE.DESTROY;
}

/**
 * The exe's child walk for this slot (F0x80018230 -> F0x80018140, exe/fns.s:8883, :8900-8905,
 * :8925-8931): a state-3 object is freed and the slot goes back to empty.
 */
export function battleFaceBoxStep(box: BattleFaceBox): boolean {
  if (box.slot !== null && box.state === FACE_BOX_STATE.DESTROY) {
    box.slot = null;
    box.state = FACE_BOX_STATE.CREATE;
    return false;
  }
  return box.slot !== null;
}

/** True when the box is on screen: the slot holds an object that is not in state 3. */
export function battleFaceBoxOnScreen(box: BattleFaceBox): boolean {
  return battleFaceBoxStep(box);
}

/** The facts the rule reads, all of them states of the battle HUD. */
export interface BattleFaceBoxEvents {
  /** the battle HUD is up at all. When it is not, the command-flow actor's tear-down arm
   *  has run and every child — the box included — has taken state 3 (fightstg.s:16094-16098). */
  hudUp: boolean;
  /** this side's command window is up (the original builds the box in the same arm). */
  menuUp: boolean;
  /** a battle message line is on screen (its owner is what hides the box). */
  lineUp: boolean;
}

/**
 * THE RULE, one call per frame. Up while the command menu is up, down from the moment a
 * message line is up, back at the next menu — because the line's owner sends the box to its
 * terminal state, the exe frees it and empties the slot, and the next build arm allocates a
 * new one. A HUD that is gone takes the box with it, as the actor's tear-down arm does.
 */
export function battleFaceBoxVisible(box: BattleFaceBox, ev: BattleFaceBoxEvents): boolean {
  if (!ev.hudUp || ev.lineUp) battleFaceBoxSendDestroy(box);
  else if (ev.menuUp) battleFaceBoxBuild(box);
  return battleFaceBoxStep(box);
}