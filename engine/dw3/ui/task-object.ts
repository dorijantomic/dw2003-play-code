// The universal DDW3 UI object — the base every other UI class extends.
//
// DECODED: ledger UI-TASKOBJ-STATEMACHINE-001 (exe/fns F0x800143dc, tail-called
// by the named factory F0x80014504). The object carries a FOUR-LEVEL NESTED
// state machine in fields +0xc/+0x10/+0x14/+0x18 (state0..state3) and a 10-entry
// default method table at +0x28..+0x4c:
//
//   +0x28 setState0   sets state0 and zeroes state1/2/3
//   +0x2c setState1   sets state1 and zeroes state2/3
//   +0x30 setState2   sets state2 and zeroes state3
//   +0x34 setState3   sets state3
//   +0x38 advance0    increments state0 and zeroes state1/2/3   (575 call sites)
//   +0x3c advance1    increments state1 and zeroes state2/3
//   +0x40 advance2    increments state2 and zeroes state3       (720 call sites)
//   +0x44 advance3    increments state3
//   +0x48             the caller-supplied per-instance handler
//
// The nesting rule is the whole point: setting or advancing a level always
// zeroes every level BELOW it. Screens rely on this to reset a sub-step when
// the step above changes, without clearing it by hand.

/** The four nested step counters every UI object carries. */
export interface TaskState {
  state0: number;
  state1: number;
  state2: number;
  state3: number;
}

export function createTaskState(): TaskState {
  return { state0: 0, state1: 0, state2: 0, state3: 0 };
}

/** +0x28 — set the main step; every deeper level resets. */
export function setState0(t: TaskState, v: number): void {
  t.state0 = v;
  t.state1 = 0;
  t.state2 = 0;
  t.state3 = 0;
}

/** +0x2c — set the sub-step; levels 2 and 3 reset. */
export function setState1(t: TaskState, v: number): void {
  t.state1 = v;
  t.state2 = 0;
  t.state3 = 0;
}

/** +0x30 — set level 2; level 3 resets. */
export function setState2(t: TaskState, v: number): void {
  t.state2 = v;
  t.state3 = 0;
}

/** +0x34 — set level 3. Nothing below it to clear. */
export function setState3(t: TaskState, v: number): void {
  t.state3 = v;
}

/** +0x38 — advance the main step. The most-called UI slot in the game. */
export function advance0(t: TaskState): void {
  setState0(t, t.state0 + 1);
}

/** +0x3c — advance the sub-step. */
export function advance1(t: TaskState): void {
  setState1(t, t.state1 + 1);
}

/** +0x40 — advance level 2. */
export function advance2(t: TaskState): void {
  setState2(t, t.state2 + 1);
}

/** +0x44 — advance level 3. */
export function advance3(t: TaskState): void {
  setState3(t, t.state3 + 1);
}
