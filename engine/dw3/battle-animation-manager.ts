// The battle ANIMATION MANAGER's own method +0xe8
// (class FIGHTSTG_F0x800869a8, the FIGHTSTG_F0x800868c0 routine it installs at
// +0xe8), the manager the transformation driver fetches for class 0x15 and calls
// from its substates 0 and 11. Constructor-installed methods are absent from the
// disassembler's entry list, so it was read from the overlay ASSEMBLY
// ~/ddw3/asm/dw2003/pro/fightstg.s against the committed words of
// web/assets/native/screens/pro_fightstg.bin (base 0x80082cb0):
//
//   FIGHTSTG_F0x800869a8  fightstg.s L3988-L4011  the class-0x15 constructor:
//       F0x800143dc(0x80086304, 0xec, 4, 0x15) then `sw 0x800868c0, 0xe8(obj)`,
//       `sw a0, 0x50(obj)`, `sw a1, 0xac(obj)` (the object type word is 0x15).
//   FIGHTSTG_F0x800868c0  fightstg.s L3921-L3939  the +0xe8 method:
//       `lw v0,0x50(a0); beq v0,a1,ret; sw v0,0x54(a0); lw v0,0x28(a0);
//        sw a1,0x50(a0); li a1,2; sw a2,0xb0(a0); jalr v0; sw a3,0xac(a0)`.
//
// The method is a motion SELECTOR: it keeps the current motion id at +0x50, the
// previous motion id at +0x54, the selector's two arguments at +0xb0 and +0xac,
// and — only when the requested motion differs from the current one — restarts
// the manager through its OWN base-object +0x28 entry (FIGHTSTG_F0x80014274,
// installed by the resident factory F0x800143dc at fns.s L4898), called with
// state 2. A request for the motion already current does nothing at all.
//
// The +0x28 entry is the shared base-object set-state (engine/dw3/
// battle-effect-driver-host.ts#baseObjectSetState), so the port takes it as a
// callback; the manager routine itself is reproduced here, not stubbed.
//
// The transformation driver reaches this as `m3 = obj+0x58; H.call(m3, 0xe8, …)`
// in its substates 0 (motion 0x1c or 0x1f, args 0x20/0x20) and 11 (motion from
// the SFX source word, args 0x20/0x20).

/** The manager's current-motion word (+0x50): read by the select, written on a change. */
export const ANIM_MGR_MOTION = 0x50;
/** The manager's previous-motion word (+0x54): the old motion is parked here. */
export const ANIM_MGR_PREV_MOTION = 0x54;
/** The selector's second argument (+0xb0). */
export const ANIM_MGR_ARG2 = 0xb0;
/** The selector's third argument (+0xac). */
export const ANIM_MGR_ARG3 = 0xac;
/** The base-object set-state entry the select restarts the manager through (+0x28). */
export const ANIM_MGR_SET_STATE = 0x28;
/** The state the select passes to that entry (the original's `li $a1, 0x2`). */
export const ANIM_MGR_RESTART_STATE = 2;

export interface AnimManagerMemory {
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

export interface AnimManagerHost {
  /** obj+0x28(state) — the manager's own set-state entry (F0x80014274). */
  setState(mgr: number, state: number): void;
}

/**
 * FIGHTSTG_F0x800868c0 — the animation manager's +0xe8 motion selector.
 *
 * Read at fightstg.s L3921-L3939. There is NO -1/sentinel guard: an equal motion
 * (including the initial 0x50 == 0 when the manager is unstarted) returns before
 * any write, exactly as the original's `beq` does. The write order is
 * +0x54, +0x50, +0xb0, +0xac, then the set-state call's own writes, matching the
 * original's instruction order (the +0xac store sits in the jalr delay slot).
 */
export function animManagerSelectMotion(
  M: AnimManagerMemory,
  host: AnimManagerHost,
  mgr: number,
  motion: number,
  a2: number,
  a3: number,
): void {
  const cur = M.read32((mgr + ANIM_MGR_MOTION) >>> 0) | 0;
  if (cur === (motion | 0)) return;
  M.write32((mgr + ANIM_MGR_PREV_MOTION) >>> 0, cur);
  M.write32((mgr + ANIM_MGR_MOTION) >>> 0, motion | 0);
  M.write32((mgr + ANIM_MGR_ARG2) >>> 0, a2 | 0);
  M.write32((mgr + ANIM_MGR_ARG3) >>> 0, a3 | 0);
  host.setState(mgr | 0, ANIM_MGR_RESTART_STATE);
}
