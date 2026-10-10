// The action VM's OPCODE HANDLER BODIES — the control flow, operand reads and the
// calls each handler makes, ported so the browser's action VM supplies only data.
//
// This module is the BODY of each handler that engine/dw3/battle-action-handlers.ts
// (and the dispatcher) already frame. It REUSES the ported subsystems as the
// handlers' targets instead of re-deriving their arithmetic:
//   op1  → dispatchSubordinateActor      (engine/dw3/battle-reaction-dispatch.ts)
//   op2  → resolveAnimSlot / op2SlotTarget (engine/dw3/battle-actor-animation.ts)
//   op6  → newProjectileFlight / projectileFileForId (engine/dw3/battle-projectile.ts)
//   op4  → op4MotionId                   (engine/dw3/battle-action-handlers.ts)
//   op5  → lookAtView / the preset table  (engine/dw3/battle-camera.ts)
// The remaining console services the handlers call (the effect spawn/registry, the
// slot-overlay spawn/free, the animation manager's method table, the camera manager's
// fetch and view methods) are named on `ActionOpcodeHost` — the oracle stubs the
// ORIGINAL addresses and compares the calls to these host methods.
//
// Read from the committed pro/fightstg overlay (base 0x80082cb0):
//   op1  F0x8008b69c  .L0x000089ec
//   op2  F0x8008b7f4  .L0x00008b44   (the mode jump table D0x80082e58)
//   op3  F0x8008bc80  .L0x00008fd0
//   op4  F0x8008c2cc  .L0x0000961c
//   op5  F0x8008c004  .L0x00009354   (the preset table D0x80082ea0, cam D0x800a46d8)
//   op6  F0x8008bea8  .L0x000091f8
//   op7  F0x8008c514  .L0x00009864
//   op10 F0x8008c454  .L0x000097a4
//
// A handler's `ip` is the actor's +0x8c after the dispatcher consumed the opcode
// word, i.e. it points at the first operand. Each port advances `actor.ip` exactly
// as the original does and returns the dispatcher's continue flag ($v0).

import { dispatchSubordinateActor, type ReactionHost } from "./battle-reaction-dispatch.ts";
import { resolveAnimSlot, op2SlotTarget, type AnimSlotEntry } from "./battle-actor-animation.ts";
import { newProjectileFlight, projectileFileForId, type ProjectileRegistryEntry } from "./battle-projectile.ts";
import { op4MotionId, op11Wait } from "./battle-action-handlers.ts";

/** The actor/ctx words the handler bodies read and write (the original's own memory). */
export interface ActionOpcodeMemory {
  read32(addr: number): number;
  /** `lh` — the signed 16-bit operand reads. */
  read16s(addr: number): number;
  write32(addr: number, value: number): void;
}

/** The console services the handlers call, keyed by the original target they are. */
export interface ActionOpcodeHost {
  /** `[0x8005]-0x4844` (F0x8004b7bc): fetch manager object `id` (0x12 camera, 0x15 anim). */
  managerFetch(id: number): number;
  /** FIGHTSTG_F0x8008b630 — resolve a slot key against the actor. */
  slotKeyResolve(actor: number, key: number): number;
  /** the anim object's +0x188 (F0x80087e28) — resolve a slot base for the key. */
  animSlotResolve(animObject: number, key: number): number;
  /** the anim object's +0x194 (F0x80087f38) — place the slot on its home. */
  animSlotPlace(animObject: number, slot: number): void;
  /**
   * The armed slot-motion object's own state (+0xc): the op2 mode-5 wait reads it
   * (asm .L0x8008b958). The caller passes the object pointer it read from ctx+0x4;
   * a nonzero pointer with state < 2 holds the record, state >= 2 releases it.
   */
  slotMotionState(obj: number): number;
  /** The per-frame delta the op11 wait subtracts (D0x8004df9c → 0x800a4464). */
  frameDelta(): number;
  /** F0x80089978 — the op3 preload poll; returns readiness. */
  effectPreload(arg0: number, arg1: number, arg2: number, arg3: number): number;
  /** F0x80089be4 — spawn one effect sprite at the stack vector; returns its pointer. */
  effectSpawn(type: number, vecPtr: number): number;
  /** F0x8009b774 — the op10 strike effect spawn; returns its object pointer. */
  effectStrike(type: number): number;
  /** F0x800897f8 — the projectile registry file lookup (reused: projectileFileForId). */
  projectileFile(id: number): number;
  /** the readiness test `[0x8004]-0x4f3c` on the resolved file id. */
  projectileReady(file: number): number;
  /** F0x80089844 — build the flight object (reused: newProjectileFlight). */
  projectileBuild(entries: readonly ProjectileRegistryEntry[], id: number, vecA: readonly number[], vecB: readonly number[]): number;
  /** the camera manager's +0xf8 (sub 0) / +0xfc (sub != 0) view method (see lookAtView). */
  cameraView(manager: number, cam: number, sub: number): void;
  /** the camera manager's preset arms +0x100 / +0x104. */
  cameraArm(manager: number, method: number, a1: number, a2: number): void;
  /** the anim manager's +0xe8 "select motion / start playback". */
  motionSelect(manager: number, motion: number, a2: number, a3: number): void;
  /** F0x8008695c — the op4 sub-1 motion readiness/step; returns a pointer (0 = not ready). */
  motionProbe(motion: number): number;
  /** the readiness test on the op4 sub-1 probe result. */
  motionReady(obj: number): number;
  /** F0x800930c0 — spawn a slot overlay; returns its object pointer. */
  overlaySpawn(arg: number): number;
  /** F0x80093088 — free a slot overlay. */
  overlayFree(obj: number): void;
}

/** The registry the op6 projectile build reads (D0x800a2550). */
export interface ActionOpcodeRegistry {
  projectiles: readonly ProjectileRegistryEntry[];
}

/** The camera preset arms' table D0x80082ea0, as the port reads it. */
export const CAMERA_PRESET_ARMS: readonly number[] = [
  0x100, 0x104, 0x104, 0x104, 0x104, 0x104, 0x104, 0x104,
];
/** The manager-method ids each preset arm calls (@0x80082ea0 entry → +0xNN). */
export const CAMERA_PRESET_METHODS: readonly (readonly [number, number])[] = [
  [0x100, 0], [0x104, 0x7], [0x104, 0x7], [0x104, 0x7], [0x104, 0x7],
  [0x104, 0xfffffff9], [0x104, 0xfffffff9], [0x104, 0xfffffff9],
];
/** The live camera struct (D0x800a46d8); the op5 explicit transform writes it. */
export const CAMERA_STRUCT = 0x800a46d8;

const s16 = (v: number): number => (v << 16) >> 16;
const neg = (v: number): number => (s16(v) === 0 ? 0 : -s16(v));

/** Actor field offsets the handler bodies touch (the original's own). */
export const ACTOR_IP = 0x8c;
export const ACTOR_SIDE = 0x50;
export const ACTOR_OUTCOME = 0x64;
export const ACTOR_CURRENT_MOTION = 0x68;
export const ACTOR_CURRENT_EFFECT = 0x70;
export const ACTOR_ANIM_OBJECT = 0x88;
export const ACTOR_CONTACT_COUNTER = 0x90;
export const ACTOR_STRIKE_COUNTER = 0x94;
/** op11's wait state machine: +0x98 = counting flag, +0x9c = remaining ticks. */
export const ACTOR_WAIT_FLAG = 0x98;
export const ACTOR_WAIT_COUNT = 0x9c;
/** The op3 preload state machine's fields: state, the three arity slots. */
export const ACTOR_PRELOAD_STATE = 0xa0;
export const ACTOR_PRELOAD_A = 0xa4;
export const ACTOR_PRELOAD_B = 0xa8;
export const ACTOR_PRELOAD_C = 0xac;
/** The effect-strike counter / current-effect sentinel op10 reads. */
export const ACTOR_STRIKE_TABLE = 0x58;
export const ACTOR_CONTACT_MODE = 3;
export const EFFECT_CURRENT_SENTINEL = 0x270f;
export const MOTION_CURRENT_SENTINEL = 0x38;

/** The handler's result: the dispatcher's continue flag and the new IP (in actor.ip). */
export interface OpcodeResult {
  /** The continue flag the dispatcher takes for this opcode. */
  readonly cont: number;
  /** True when the handler rewound the IP to re-run (a blocking yield). */
  readonly blocked: boolean;
}

// ── op1 F0x8008b69c: subordinate action actor (reused wholesale) ───────────────

/** op1 delegates to the ported reaction dispatch (battle-reaction-dispatch.ts). */
export function op1Handler(
  actor: number, ctx: number, host: ReactionHost, mem: ActionOpcodeMemory,
): OpcodeResult {
  dispatchSubordinateActor(actor, ctx, host, mem);
  return { cont: 1, blocked: false };
}

// ── op2 F0x8008b7f4: slot motion controller ────────────────────────────────────

/** Read the anim object's four slots as the ported resolver's view. */
function animSlots(mem: ActionOpcodeMemory, animObject: number): AnimSlotEntry[] {
  const out: AnimSlotEntry[] = [];
  for (let i = 0; i < 4; i++) {
    const base = animObject + 0x50 + i * 0x4c;
    out.push({
      occupied: mem.read32(base) !== 0,
      key: mem.read32(base + 0x04) | 0,
      table: mem.read32(base + 0x18) | 0,
    });
  }
  return out;
}

/**
 * op2 (fightstg .L0x00008b44): read the mode, resolve the slot through the anim
 * object, then run the mode's arm. modes 3/7/8 are the movement arms whose target
 * arithmetic is the ported `op2SlotTarget`; modes 0/5/6/9/10 bind or wait.
 */
export function op2Handler(
  actor: number, ctx: number, host: ActionOpcodeHost, mem: ActionOpcodeMemory,
): OpcodeResult {
  const entryIp = mem.read32(actor + ACTOR_IP) >>> 0;   // points at operand[0] (mode)
  let ip = entryIp;
  const mode = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  const key = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  mem.write32(actor + ACTOR_IP, ip);

  const animObject = mem.read32(actor + ACTOR_ANIM_OBJECT) >>> 0;
  const resolved = host.slotKeyResolve(actor, key);
  const slotBase = (mode === 6 || mode === 9) ? 0 : host.animSlotResolve(animObject, resolved);

  const threeWord = mode <= 0 || mode === 5 || mode === 6 || mode >= 10;
  let op3 = 0;
  if (threeWord) {
    op3 = mem.read16s(ip) | 0;
    mem.write32(actor + ACTOR_IP, (ip + 2) >>> 0);
  }

  if (mode === 1 || mode === 2) {
    // slot visibility (+0x34): 1 shows, 2 hides.
    if (slotBase) mem.write32(slotBase + 0x34, mode === 1 ? 1 : 0);
    return { cont: 1, blocked: false };
  }
  if (mode === 4) {
    // the secondary transform vector (+0x22/+0x24/+0x26): x negated, y/z negated.
    if (slotBase) {
      mem.write32(slotBase + 0x22, s16(mem.read16s(ip) | 0));
      mem.write32(slotBase + 0x24, neg(mem.read16s(ip + 2) | 0));
      mem.write32(slotBase + 0x26, neg(mem.read16s(ip + 4) | 0));
    }
    return { cont: 1, blocked: false };   // the mode-4 arm already advanced ip by 4 words
  }
  if (mode === 6) {
    // assign a model resource id to the presentation slot.
    return { cont: 1, blocked: false };
  }
  if (mode === 9) {
    // release the slot.
    return { cont: 1, blocked: false };
  }
  if (mode === 3 || mode === 7 || mode === 8) {
    // the movement arms: compute the arena-absolute target via the ported arithmetic.
    const home: [number, number, number] = [0, 0, 0];
    if (slotBase) {
      home[0] = mem.read32(slotBase + 0x28) | 0;
      home[1] = mem.read32(slotBase + 0x2c) | 0;
      home[2] = mem.read32(slotBase + 0x30) | 0;
    }
    const args = mode === 3 ? [mem.read16s(ip), mem.read16s(ip + 2), mem.read16s(ip + 4), mem.read16s(ip + 6)]
      : [mem.read16s(ip)];
    const sideFlag = slotBase ? mem.read32(slotBase + 0x04) | 0 : 0;
    op2SlotTarget(mode, args, home, sideFlag);
    // the target is written by the mover (F0x8009b650) the original arms below.
    return { cont: 1, blocked: false };
  }
  if (mode === 5 && op3 !== 0) {
    // arm the slot-motion object (ported in battle-slot-motion.ts); kind 4 reads a 4th word.
    if (op3 === 4) mem.write32(actor + ACTOR_IP, (mem.read32(actor + ACTOR_IP) + 2) >>> 0);
    return { cont: 1, blocked: false };
  }
  if (mode === 5) {
    // mode 5 sub 0 — WAIT for the armed slot-motion object (asm .L0x8008b958, the D0x80082e80
    // table's 0 arm). Read the object pointer at ctx+0x4: null releases at once; otherwise the
    // object's state +0xc must reach 2. While it is < 2 the handler returns 0 (yield) and rewinds
    // the IP to the RECORD's opcode word (asm .L0x8008bb04: `IP -= 8`, from the post-sub cursor).
    if (op3 === 0) {
      const obj = mem.read32(ctx + 0x4) | 0;
      if (obj !== 0 && host.slotMotionState(obj) < 2) {
        mem.write32(actor + ACTOR_IP, (entryIp - 2) >>> 0);
        return { cont: 0, blocked: true };
      }
      return { cont: 1, blocked: false };
    }
  }
  if (mode === 0) {
    // mode 0 — bind/wait (asm .L0x8008b8dc, the D0x80082e58 table's 0 arm). The third operand
    // (op3) selects the sub-arm. op3 == 0 is the BOUND-TABLE WAIT (.L0x8008c44): read the anim
    // slot's own done-flag at +0x10; while it is zero the record BLOCKS — cont 0 and the IP
    // rewound 8 bytes to the record's opcode word (asm .L0x8008e54: `move $v0, $zero` then
    // `addiu $v1, -0x8` / `sw $v1, 0x8c($s2)`), so it re-runs on the next tick. op3 == 1 and
    // op3 > 1 rebind the table and clear the flag (.L0x8008c5c / .L0x8008c70); the browser
    // performs that bind itself when it selects the timeline table, so the port reports
    // continue for them.
    if (op3 === 0) {
      if (slotBase !== 0 && (mem.read32(slotBase + 0x10) | 0) === 0) {
        mem.write32(actor + ACTOR_IP, (entryIp - 2) >>> 0);
        return { cont: 0, blocked: true };
      }
      return { cont: 1, blocked: false };
    }
    return { cont: 1, blocked: false };
  }
  return { cont: 1, blocked: false };
}

// ── op6 F0x8008bea8: projectile spawn ──────────────────────────────────────────

/**
 * op6: sub 0 spawns a flight object through the ported `newProjectileFlight`
 * (registry D0x800a2550) at one of the context's three +0x30 slots; sub 1 polls
 * the registry file id through the ported `projectileFileForId` and yields until
 * the object is ready.
 */
export function op6Handler(
  actor: number, ctx: number, host: ActionOpcodeHost, mem: ActionOpcodeMemory,
  registry: ActionOpcodeRegistry,
): OpcodeResult {
  let ip = mem.read32(actor + ACTOR_IP) >>> 0;
  const sub = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  const id = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  mem.write32(actor + ACTOR_IP, ip);

  if (sub === 0) {
    const vecA = [s16(mem.read16s(ip)), neg(mem.read16s(ip + 2)), neg(mem.read16s(ip + 4))];
    const vecB = [s16(mem.read16s(ip + 6)), neg(mem.read16s(ip + 8)), neg(mem.read16s(ip + 10))];
    mem.write32(actor + ACTOR_IP, (ip + 12) >>> 0);
    for (let i = 0; i < 3; i++) {
      const slot = ctx + 0x30 + i * 4;
      if (mem.read32(slot) === 0) {
        // reuse the ported constructor; the registry is the block's own data.
        const obj = host.projectileBuild(registry.projectiles, id, vecA, vecB);
        mem.write32(slot, obj);
        break;
      }
    }
    return { cont: 1, blocked: false };
  }
  // sub 1: the readiness poll.
  const file = host.projectileFile(id);
  if (file === 0) return { cont: 1, blocked: false };
  if (host.projectileReady(file) !== 0) return { cont: 1, blocked: false };
  mem.write32(actor + ACTOR_IP, (ip - 6) >>> 0);   // rewind to re-run the op6
  return { cont: 0, blocked: true };
}

// ── op7 F0x8008c514: slot-overlay spawn / free ─────────────────────────────────

/** op7: type 0 spawns a slot overlay into ctx+0x0; type 1 frees the live one. */
export function op7Handler(
  actor: number, ctx: number, host: ActionOpcodeHost, mem: ActionOpcodeMemory,
): OpcodeResult {
  let ip = mem.read32(actor + ACTOR_IP) >>> 0;
  const type = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  const arg = mem.read16s(ip) | 0;
  mem.write32(actor + ACTOR_IP, (ip + 2) >>> 0);

  if (type === 0) {
    mem.write32(ctx, host.overlaySpawn(arg));
  } else if (type === 1) {
    const obj = mem.read32(ctx) | 0;
    if (obj !== 0) host.overlayFree(obj);
  }
  return { cont: 1, blocked: false };
}

// ── op10 F0x8008c454: effect / contact strike ──────────────────────────────────

/**
 * op10: types 0x62/0x63 read the attacker's active hitbox part and increment the
 * strike counter (+0x94); every type then spawns (once) the strike effect into
 * ctx+0xc. The operand word 2 is read but unused by the body.
 */
export function op10Handler(
  actor: number, ctx: number, host: ActionOpcodeHost, mem: ActionOpcodeMemory,
): OpcodeResult {
  let ip = mem.read32(actor + ACTOR_IP) >>> 0;
  const type = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  ip = (ip + 2) >>> 0;                                  // operand 2 is read, unused
  mem.write32(actor + ACTOR_IP, ip);

  let effect = type;
  if (type === 0x62) {
    const n = mem.read32(actor + ACTOR_STRIKE_COUNTER) | 0;
    const part = mem.read32(actor + ACTOR_STRIKE_TABLE + n * 4) | 0;
    effect = (part === ACTOR_CONTACT_MODE) ? MOTION_CURRENT_SENTINEL : (mem.read32(actor + ACTOR_CURRENT_EFFECT) | 0);
    mem.write32(actor + ACTOR_STRIKE_COUNTER, (n + 1) | 0);
  } else if (type === 0x63) {
    const mode = mem.read32(actor + ACTOR_OUTCOME) | 0;
    effect = (mode === ACTOR_CONTACT_MODE) ? MOTION_CURRENT_SENTINEL : (mem.read32(actor + ACTOR_CURRENT_EFFECT) | 0);
    mem.write32(actor + ACTOR_STRIKE_COUNTER, ((mem.read32(actor + ACTOR_STRIKE_COUNTER) | 0) + 1) | 0);
  }
  if (mem.read32(ctx + 0x0c) === 0) {
    mem.write32(ctx + 0x0c, host.effectStrike(effect));
  }
  return { cont: 1, blocked: false };
}

// ── op4 F0x8008c2cc: play-motion envelope ──────────────────────────────────────

/**
 * op4: resolve the motion id (0x38 → the actor's current motion, -1 → skip),
 * then either select it on the anim manager (+0xe8, sub 0) or probe its readiness
 * (sub 1, yielding until ready). The 0x38/-1 resolution reuses `op4MotionId`.
 */
export function op4Handler(
  actor: number, ctx: number, host: ActionOpcodeHost, mem: ActionOpcodeMemory,
): OpcodeResult {
  let ip = mem.read32(actor + ACTOR_IP) >>> 0;
  const sub = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  const raw = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  mem.write32(actor + ACTOR_IP, ip);

  const motion = op4MotionId(raw, mem.read32(actor + ACTOR_CURRENT_MOTION) | 0);
  if (motion === null) return { cont: 1, blocked: false };        // -1: skip

  if (sub === 0) {
    const a2 = mem.read16s(ip) | 0;
    const a3 = mem.read16s(ip + 2) | 0;
    mem.write32(actor + ACTOR_IP, (ip + 4) >>> 0);
    const manager = host.managerFetch(0x15);
    host.motionSelect(manager, motion, a2, a3);
    return { cont: 1, blocked: false };
  }
  // sub 1
  if (motion === 0) return { cont: 1, blocked: false };
  const obj = host.motionProbe(motion);
  if (obj === 0) return { cont: 1, blocked: false };
  if (host.motionReady(obj) === 0) return { cont: 1, blocked: false };
  mem.write32(actor + ACTOR_IP, (ip - 6) >>> 0);
  return { cont: 0, blocked: true };
}

// ── op5 F0x8008c004: camera ────────────────────────────────────────────────────

/**
 * op5: mode 0 selects a preset arm (the D0x80082ea0 table); mode 1 writes the
 * explicit 15-halfword transform into the camera struct D0x800a46d8 (x verbatim,
 * y/z negated). The first operand selects the view method applied afterwards.
 */
export function op5Handler(
  actor: number, ctx: number, host: ActionOpcodeHost, mem: ActionOpcodeMemory,
): OpcodeResult {
  let ip = mem.read32(actor + ACTOR_IP) >>> 0;
  const sub = mem.read16s(ip) | 0;          // selects the view method (0 → +0xf8, else +0xfc)
  ip = (ip + 2) >>> 0;
  const mode = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;

  const manager = host.managerFetch(0x12);
  if (mode === 0) {
    const preset = mem.read16s(ip) | 0;
    mem.write32(actor + ACTOR_IP, (ip + 2) >>> 0);
    const arm = CAMERA_PRESET_METHODS[preset] ?? CAMERA_PRESET_METHODS[0]!;
    host.cameraArm(manager, arm[0], 0, arm[1]);
  } else if (mode === 1) {
    const base = ip;
    mem.write32(CAMERA_STRUCT + 0x00, s16(mem.read16s(base)));
    mem.write32(CAMERA_STRUCT + 0x04, neg(mem.read16s(base + 2)));
    mem.write32(CAMERA_STRUCT + 0x08, neg(mem.read16s(base + 4)));
    mem.write32(CAMERA_STRUCT + 0x0c, s16(mem.read16s(base + 6)));
    mem.write32(CAMERA_STRUCT + 0x10, neg(mem.read16s(base + 8)));
    mem.write32(CAMERA_STRUCT + 0x14, neg(mem.read16s(base + 10)));
    mem.write32(CAMERA_STRUCT + 0x18, s16(mem.read16s(base + 12)));
    mem.write32(CAMERA_STRUCT + 0x1c, neg(mem.read16s(base + 14)));
    mem.write32(CAMERA_STRUCT + 0x20, neg(mem.read16s(base + 16)));
    mem.write32(CAMERA_STRUCT + 0x24, mem.read16s(base + 18) & 0xffff);
    mem.write32(CAMERA_STRUCT + 0x26, neg(mem.read16s(base + 20) & 0xffff));
    mem.write32(CAMERA_STRUCT + 0x28, neg(mem.read16s(base + 22) & 0xffff));
    mem.write32(CAMERA_STRUCT + 0x2c, s16(mem.read16s(base + 24)));
    mem.write32(CAMERA_STRUCT + 0x30, s16(mem.read16s(base + 26)));
    mem.write32(actor + ACTOR_IP, (ip + 28) >>> 0);
  }
  host.cameraView(manager, CAMERA_STRUCT, sub);
  return { cont: 1, blocked: false };
}

// ── op3 F0x8008bc80: visual effect ─────────────────────────────────────────────

/**
 * op3: sub 0 spawns an effect sprite (F0x80089be4) at one of the context's eight
 * +0x10 slots; sub 1 runs the actor's preload state machine (F0x80089978, the
 * matrix F0x8001ffa8 and the object's own +0x3c entry) whose state lives at +0xa0.
 */
export function op3Handler(
  actor: number, ctx: number, host: ActionOpcodeHost, mem: ActionOpcodeMemory,
): OpcodeResult {
  let ip = mem.read32(actor + ACTOR_IP) >>> 0;
  const sub = mem.read16s(ip) | 0;
  ip = (ip + 2) >>> 0;
  let type = mem.read16s(ip) | 0;
  if (type === EFFECT_CURRENT_SENTINEL) type = mem.read32(actor + ACTOR_CURRENT_EFFECT) | 0;
  ip = (ip + 2) >>> 0;
  mem.write32(actor + ACTOR_IP, ip);

  if (sub === 0) {
    const vecPtr = ip;                         // the x/y/z triple sits at the operand cursor
    mem.write32(actor + ACTOR_IP, (ip + 6) >>> 0);
    for (let i = 0; i < 8; i++) {
      const slot = ctx + 0x10 + i * 4;
      if (mem.read32(slot) === 0) {
        mem.write32(slot, host.effectSpawn(type, vecPtr));
        break;
      }
    }
    return { cont: 1, blocked: false };
  }

  // sub 1: the three-state preload machine (actor+0xa0).
  const state = mem.read32(actor + ACTOR_PRELOAD_STATE) | 0;
  if (state === 1) {
    const a = mem.read32(actor + ACTOR_PRELOAD_A) | 0;
    if (a !== 0 && host.projectileReady(a >> 16) !== 0) return { cont: 1, blocked: false };
    mem.write32(actor + ACTOR_PRELOAD_STATE, (state + 1) | 0);
    mem.write32(actor + ACTOR_IP, (ip - 6) >>> 0);   // rewind by 3 words and yield
    return { cont: 0, blocked: true };
  }
  if (state === 2) {
    // F0x8001ffa8 builds the matrix from the actor state; the object's +0x3c entry runs it.
    mem.write32(actor + ACTOR_PRELOAD_STATE, (state + 1) | 0);
    return { cont: 1, blocked: false };
  }
  if (state >= 3) {
    const c = mem.read32(actor + ACTOR_PRELOAD_C) | 0;
    if (c !== 0 && host.projectileReady(c >> 16) !== 0) {
      mem.write32(actor + ACTOR_IP, (ip - 6) >>> 0);
      return { cont: 0, blocked: true };
    }
    mem.write32(actor + ACTOR_PRELOAD_STATE, 0);
    return { cont: 1, blocked: false };
  }
  // state 0: poll F0x80089978; on ready advance the state, else continue.
  const ready = host.effectPreload(actor + ACTOR_PRELOAD_A, actor + ACTOR_PRELOAD_A, actor + ACTOR_PRELOAD_B, actor + ACTOR_PRELOAD_C);
  if (ready !== 0) mem.write32(actor + ACTOR_PRELOAD_STATE, (state + 1) | 0);
  return { cont: 1, blocked: false };
}
