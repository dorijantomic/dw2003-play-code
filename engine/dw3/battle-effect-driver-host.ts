// The production host for the transformation driver FIGHTSTG_F0x80089cd8
// (engine/dw3/battle-effect-driver.ts): the seam the driver's fifteen step bodies
// and four construct-stage bodies call through, now bound to real ports.
//
// PORTED IN THIS MODULE (read from the disc):
//   • the driver object's own base-object entries +0x28/+0x38/+0x3c/+0x40 — the
//     shared object-family state methods (exe/fns.s F0x80014274/ac/c8/e0).
//   • the layer object's +0x110/+0x114 — F0x8001e0b0/bc (`sh a1,0(a0)` /
//     `sh a1,4(a0)`).
//   • the effect spawn F0x80089be4 via `spawnEffectObject`
//     (engine/dw3/battle-effect-spawn.ts).
//   • the slot-overlay spawn FIGHTSTG_F0x800930c0 (`slotOverlaySpawn`) — the driver's
//     substates 5 and 7 allocate a 0x58-byte class-0x80092f7c object and store
//     0xff/arg at its +0x50. It was the last host-supplied battle-overlay routine on
//     the path; oracled against the original words by
//     tests/engine/unit/battle-slot-overlay-oracle.test.ts.
//
// REUSED (a port another worker already wrote; no second copy here):
//   • the animation-instance builder F0x80084560 — engine/dw3/battle-mesh.ts
//     (createLayerFigure), reached through the FIGHTSTG_F0x80084790 wrapper
//     (engine/dw3/battle-anim-instance.ts).
//   • the anim object's +0x188 slot resolve (F0x80087e28) and +0x194 home
//     placement (F0x80087f38) — engine/dw3/battle-actor-animation.ts.
//   • the anim object's +0x180/+0x184/+0x18c/+0x190 (F0x80087c70/87d00/87e7c/
//     87ee4) — the new engine/dw3/battle-anim-object.ts.
//   • the camera manager's +0xf8/+0xfc/+0x100/+0x104 (F0x80092244/922b4/9257c/
//     923b4) — the new engine/dw3/battle-camera-manager.ts.
//   • the resource/cache service +0x404/+0x40c/+0x424 (F0x80013a6c/13c30/140d8,
//     the pointers the resident image stores at 0x80044f3c/44/5c) —
//     engine/dw3/resource-service.ts (cachePoll / cacheAcquire / packResolveHandle).
//   • the display-service layer lookup [0x8004de10+0x17c] = F0x8001da84 —
//     engine/dw3/display-service.ts (findRegisteredHandleByKey).
//   • the sound/render context F0x8001ffa8 and its arms (F0x8001fd1c/fd28/fd3c/
//     ff9c/fe38) — engine/dw3/ui/card-view.ts, the card-view helper context the
//     context actually is, read from the resident image.
//   • the anim manager's own +0xe8 motion selector FIGHTSTG_F0x800868c0
//     (engine/dw3/battle-animation-manager.ts#animManagerSelectMotion).
//   • the animation-instance allocator FIGHTSTG_F0x80084790, which reuses the
//     ported builder F0x80084560 (engine/dw3/battle-anim-instance.ts#createAnimInstance
//     over engine/dw3/battle-mesh.ts#createLayerFigure).
//   • the object registry [0x8004b7bc] — a named service (the action VM's handlers
//     take the same boundary).
//
// GENUINE RUNTIME BOUNDARIES (named services, not stubs that do nothing): the
// object registry, the class-object allocator F0x80014504, the resident object
// factory F0x800143dc, the blocking heap allocator [0x8004b5f4], the sound cells,
// the frame-delta cell, the model-record getter, the actor-state object, the
// disc-transfer and heap services the cache service sits on, and the card-view
// helper's VRAM/allocator sheet. The host throws on any (handle, offset) it does
// not own, so a caller can enumerate the driver's whole call graph.

import {
  spawnEffectObject, EFFECT_OBJECT_CLASS, EFFECT_OBJECT_SIZE, EFFECT_OBJECT_TAG,
  type EffectSpawnMemory,
} from "./battle-effect-spawn.ts";
import {
  effectDriverProgramBody,
  EFFECT_DRIVER_CELL_OBJ_GET, EFFECT_DRIVER_CELL_DF9C, EFFECT_DRIVER_CELL_4570,
  EFFECT_DRIVER_LAYER_REGISTRY, EFFECT_DRIVER_SFX_SOURCE, EFFECT_DRIVER_SFX_SOURCE2,
  EFFECT_DRIVER_SFX_OFFSET_TABLE,
  type EffectDriverHost,
} from "./battle-effect-driver.ts";
import {
  slotOverlayStep, type SlotOverlayStepHost, type SlotOverlayStepMemory,
} from "./battle-slot-overlay.ts";
import {
  findAnimSlotIndex, animSlotHome, type AnimSlotEntry,
} from "./battle-actor-animation.ts";
import {
  animBindSlot, animRenameSlotKey, animSlotModel,
  readAnimSlots, animSlotBaseOf, type AnimObjectHost, type AnimObjectMemory,
} from "./battle-anim-object.ts";
import { animManagerSelectMotion, type AnimManagerHost, type AnimManagerMemory } from "./battle-animation-manager.ts";
import { createAnimInstance, type AnimInstanceHost } from "./battle-anim-instance.ts";
import {
  effectTintFeed, type EffectFeedObject, type EffectTintFeedSink,
} from "./battle-effect-tint.ts";
import {
  cameraManagerCopyRecord, cameraManagerBlend, cameraManagerResetShot, cameraManagerCannedShot,
  type CameraManagerHost, type CameraManagerMemory,
} from "./battle-camera-manager.ts";
import { cachePoll, cacheAcquire, packResolveHandle, type CacheSlotMemory, type CacheServiceHost } from "./resource-service.ts";
import { findRegisteredHandleByKey, type DisplayServiceMemory } from "./display-service.ts";
import {
  cardViewHelperInit, cardViewHelperPublish, cardViewHelperSetPairA,
  cardViewHelperSetScratchSize, cardViewHelperUploadPack, CARD_HELPER_CELL,
  type CardViewMemory, type PackUploadHost,
} from "./ui/card-view.ts";

const RES = 0x80044b38;
const LAYER_REG = 0x8004de10;

/**
 * A byte-readable view over the object the effect-tint feed reads (the anim manager,
 * which the original passes to FIGHTSTG_F0x800861f4 as its own first argument — see
 * `fightstg.s:3780` / `:3874`, `move $a0, $s1` then `jal FIGHTSTG_F0x800861f4`).
 */
export interface TintFeedMemory {
  read32(addr: number): number;
  read8(addr: number): number;
}

/**
 * Run the ported effect-tint feed FIGHTSTG_F0x800861f4 (engine/dw3/battle-effect-tint.ts)
 * over the manager object at `mgr` and route the arena view's (0x1000) background colour
 * to `sink`. This is the one place the colour is produced, shared by the production host
 * (below) and the ordinary transformation route (`createTransformationSchedule`) so the
 * feed is not re-implemented on either path. The feed's pose passes and owner submit are
 * the manager's own display submission, which no host here models; only the view colour —
 * the arena's background/clear colour, view+0x12C — is routed.
 *
 * The colour is the effect object's own element colour: `(byte +0xdc, +0xde, +0xe0)` when
 * the word at +0xdc (or the signed halfword at +0xe0) is non-zero, otherwise the (1,1,1)
 * white default (asm `li $a1,1`).
 */
export function feedArenaTint(
  mem: TintFeedMemory, mgr: number, sink?: (r: number, g: number, b: number) => void,
): void {
  const m = mgr | 0;
  const obj: EffectFeedObject = {
    base: m,
    readWord: (off) => mem.read32((m + off) >>> 0) | 0,
    readByte: (off) => mem.read8((m + off) >>> 0) | 0,
    readCell: (addr) => mem.read32(addr >>> 0) | 0,
  };
  const feedSink: EffectTintFeedSink = {
    pose: () => {},
    submit: () => {},
    view: () => ({ setTint: (r, g, b) => { sink?.(r | 0, g | 0, b | 0); } }),
  };
  effectTintFeed(obj, m, feedSink);
}

/** The driver object's own base-object method slots (F0x80014274/ac/c8/e0). */
export const BASE_OBJ_SET_STATE = 0x28;
export const BASE_OBJ_NEXT_STATE = 0x38;
export const BASE_OBJ_NEXT_SUBSTATE = 0x3c;
export const BASE_OBJ_NEXT_STAGE = 0x40;

/** The context F0x8001ffa8's ported arms (engine/dw3/ui/card-view.ts). */
export const CONTEXT_SET_GLOBAL = 0x1c;
export const CONTEXT_SET_DIMS = 0x24;
export const CONTEXT_SET_SIZE = 0x30;
export const CONTEXT_EMIT = 0x2c;
export const CONTEXT_FLAG_OFF = 0x18;
export const CONTEXT_FLAG = 0xa800;

export interface EffectDriverMem {
  read32(addr: number): number;
  read16u(addr: number): number;
  read16s(addr: number): number;
  read8(addr: number): number;
  write32(addr: number, value: number): void;
  write16(addr: number, value: number): void;
  write8(addr: number, value: number): void;
}

/** F0x80014274(obj, state): set +0x0c, clear +0x10/+0x14/+0x18. */
export function baseObjectSetState(M: EffectDriverMem, obj: number, state: number): void {
  M.write32(obj + 0x0c, state | 0);
  M.write32(obj + 0x10, 0); M.write32(obj + 0x14, 0); M.write32(obj + 0x18, 0);
}
/** F0x800142ac(obj): +0x0c++, clear +0x10/+0x14/+0x18. */
export function baseObjectNextState(M: EffectDriverMem, obj: number): void {
  M.write32(obj + 0x0c, ((M.read32(obj + 0x0c) | 0) + 1) | 0);
  M.write32(obj + 0x10, 0); M.write32(obj + 0x14, 0); M.write32(obj + 0x18, 0);
}
/** F0x800142c8(obj): +0x10++, clear +0x14/+0x18. */
export function baseObjectNextSubstate(M: EffectDriverMem, obj: number): void {
  M.write32(obj + 0x10, ((M.read32(obj + 0x10) | 0) + 1) | 0);
  M.write32(obj + 0x14, 0); M.write32(obj + 0x18, 0);
}
/** F0x800142e0(obj): +0x14++, clear +0x18. */
export function baseObjectNextStage(M: EffectDriverMem, obj: number): void {
  M.write32(obj + 0x14, ((M.read32(obj + 0x14) | 0) + 1) | 0);
  M.write32(obj + 0x18, 0);
}
/** F0x8001e0b0(layer, x): store the layer's +0 halfword. */
export function layerSetX(M: EffectDriverMem, layer: number, x: number): void { M.write16(layer + 0x0, x | 0); }
/** F0x8001e0bc(layer, y): store the layer's +0x4 halfword. */
export function layerSetY(M: EffectDriverMem, layer: number, y: number): void { M.write16(layer + 0x4, y | 0); }

// ── the slot-overlay spawn (FIGHTSTG_F0x800930c0) ────────────────────────────
//
// The last routine on the transformation driver's path that the host still
// supplied from outside. Read from the overlay ASSEMBLY
// (~/ddw3/asm/dw2003/pro/fightstg.s L16723-L16742) against the committed words of
// web/assets/native/screens/pro_fightstg.bin (base 0x80082cb0, file offset 0x10410):
//
//   addiu sp,-0x18; move s0,a0; lui a0,0x8009; addiu a0,0x2f7c; li a1,0x58;
//   jal F0x80014504; move a2,zr; li v1,0xff; div zr,v1,s0; mflo v1; nop;
//   sw v1,0x50(v0); ... jr ra
//
// It allocates a 0x58-byte object of class 0x80092f7c (the slot-overlay class the
// driver's substates 5 and 7 wait on) through F0x80014504, then stores the SIGNED
// quotient 0xff / arg at object+0x50. The disassembler's three-operand `div`
// pseudo-instruction means `v1 = v1 / s0` (LO), the divisor being the caller's
// argument. Its oracle runs the ORIGINAL words through engine/native and
// discriminates with a mutation that fails.

/** The slot-overlay class the spawn allocates (0x80092f7c). */
export const SLOT_OVERLAY_CLASS = 0x80092f7c;
/** The slot-overlay object size (0x58). */
export const SLOT_OVERLAY_SIZE = 0x58;
/** The field the spawn writes (object+0x50). */
export const SLOT_OVERLAY_FIELD = 0x50;

/** The two boundaries the slot-overlay spawn rests on. */
export interface SlotOverlayHost {
  /** F0x80014504(classDesc, size, tag) — the resident class-object allocator. */
  allocObject(classDesc: number, size: number, tag: number): number;
  write32(addr: number, value: number): void;
}

/**
 * The console's signed `div` quotient (LO), byte-for-byte what engine/native's
 * MIPS core computes, including the divide-by-zero and the INT_MIN/-1 cases.
 */
export function mipsDiv(numerator: number, divisor: number): number {
  const a = numerator | 0, b = divisor | 0;
  if (b === 0) return a >= 0 ? -1 : 1;
  if (a === -0x80000000 && b === -1) return -0x80000000;
  return (a / b) | 0;
}

/** FIGHTSTG_F0x800930c0 — allocate the slot overlay and store 0xff/arg at +0x50. */
export function slotOverlaySpawn(host: SlotOverlayHost, arg: number): number {
  const obj = host.allocObject(SLOT_OVERLAY_CLASS, SLOT_OVERLAY_SIZE, 0) | 0;
  host.write32((obj + SLOT_OVERLAY_FIELD) >>> 0, mipsDiv(0xff, arg | 0));
  return obj;
}

/**
 * The genuine runtime boundaries the driver's ports still rest on. Every member is a
 * subsystem the original reaches through a global cell or a device, not the driver's
 * own code.
 */
export interface EffectDriverServices {
  /** [0x8004b7bc](id): the object registry lookup (0x14 anim, 0x12 camera, 0x15 anim manager). */
  objectFetch(id: number): number;
  /**
   * F0x80014504(classDesc, size, tag): the resident class-object allocator. Both the
   * effect spawner (class 0x80089a24) and the slot-overlay spawn (class 0x80092f7c,
   * FIGHTSTG_F0x800930c0) allocate through it, so it is one service.
   */
  allocObject(classDesc: number, size: number, tag: number): number;
  /** 0x80055c54 / 0x80055c60 / 0x80055c48: the two SFX cells and the SFX play. */
  sfxCellA(): number;
  sfxCellB(): number;
  sfxPlay(word: number): void;
  /** [0x8004df9c]: the frame delta. */
  frameDelta(): number;
  /** [0x800a4570](id): the model-record getter. */
  resourceGet(id: number): number;
  /**
   * The arena view's clear colour, set through the ported effect-tint feed
   * FIGHTSTG_F0x800861f4 (engine/dw3/battle-effect-tint.ts). The anim/motion
   * manager's own rebuild (F0x80086304, the driver's +0xe8 path) calls the feed
   * twice to set view 0x1000's colour from the effect object's own element colour;
   * the renderer supplies this sink and paints r,g,b. Optional: a host with no
   * renderer simply does not paint.
   */
  arenaTint?(r: number, g: number, b: number): void;
  /** F0x8001ffa8's own storage: the 0x34-byte sound/render context the driver builds. */
  contextAlloc(): number;
  // ── the anim-object path's resident/device boundaries ──
  /**
   * F0x800143dc(cb, size, extra, id): the resident object factory. The
   * animation-instance port (engine/dw3/battle-anim-instance.ts) creates its
   * figure object through it; a resident fns service, not an overlay routine.
   */
  createObject(cb: number, size: number, extra: number, id: number): number;
  /** [0x8004b5f4](size, align): the blocking heap allocator (layer records). */
  heapAlloc(size: number, align: number): number;
  /** [0x8004b600](ptr, 0x4c): clear one slot's bytes. */
  clearSlot(ptr: number, bytes: number): void;
  // ── the resource/cache service's device boundaries ──
  cacheAlloc(size: number, tag: number): number;
  cacheStartTransfer(id: number, buffer: number): void;
  cacheClock(): number;
  cacheBusyGate(): number;
  // ── the card-view helper's VRAM/allocator sheet (the context's +0x2c upload) ──
  loadImage(x: number, y: number, w: number, h: number, data: number): void;
  allocScratch(size: number, tag: number): number;
  free(ptr: number): void;
  drawSync(): void;
  resourceGetBase(discId: number): number;
  callViewMethod(view: number, arg: number): number;
}

/**
 * The production `EffectDriverHost`. It identifies a method handle by the driver's
 * own stored sub-manager fields (obj+0x50/+0x54/+0x58, written by the construct
 * stage's objectFetch calls) and the layer/context handles it builds, and it routes
 * every call to a real port. Any (handle, offset) it does not own throws.
 */
export class ProductionEffectDriverHost {
  private readonly layers = new Set<number>();
  private readonly contexts = new Set<number>();
  private readonly M: EffectDriverMem;
  private readonly services: EffectDriverServices;
  private readonly obj: number;
  private readonly animHost: AnimObjectHost;
  private readonly camHost: CameraManagerHost;
  private readonly cacheHost: CacheServiceHost & { clock(): number; busyGate(): number };
  private readonly packHost: PackUploadHost;

  constructor(M: EffectDriverMem, services: EffectDriverServices, obj: number) {
    this.M = M;
    this.services = services;
    this.obj = obj | 0;
    this.animHost = {
      resourceGet: (h) => this.services.resourceGet(h) | 0,
      allocAnimInstance: (w0, w1, t0, t1, slotBase) =>
        createAnimInstance(this.animInstanceBoundaries(), this.animMem(), { w0, w1, t0, t1, slotBase }) | 0,
      clearSlot: (p, n) => this.services.clearSlot(p, n),
      childSetState: (child, state) => baseObjectSetState(M, child, state),
    };
    this.camHost = {
      objectFetch: (id) => this.services.objectFetch(id) | 0,
      resourceGet: (h) => this.services.resourceGet(h) | 0,
      baseSetState: (mgr, state) => baseObjectSetState(M, mgr, state),
    };
    this.cacheHost = {
      alloc: (size, tag) => this.services.cacheAlloc(size, tag) | 0,
      startTransfer: (id, buffer) => this.services.cacheStartTransfer(id, buffer),
      clock: () => this.services.cacheClock() | 0,
      busyGate: () => this.services.cacheBusyGate() | 0,
    };
    this.packHost = {
      resourceGetBase: (discId) => this.services.resourceGetBase(discId) | 0,
      loadImage: (x, y, w, h, data) => this.services.loadImage(x, y, w, h, data),
      findRegisteredHandleByKey: (key) => findRegisteredHandleByKey(this.viewMem(), key) | 0,
      callViewMethod: (view, arg) => this.services.callViewMethod(view, arg) | 0,
      allocScratch: (size, tag) => this.services.allocScratch(size, tag) | 0,
      free: (p) => this.services.free(p),
      drawSync: () => this.services.drawSync(),
    };
  }

  private animMem(): AnimObjectMemory { return this.M as unknown as AnimObjectMemory; }
  private mgrMem(): AnimManagerMemory { return this.M as unknown as AnimManagerMemory; }
  private mgrHost(): AnimManagerHost {
    return { setState: (m, st) => baseObjectSetState(this.M, m, st) };
  }
  /** The boundaries the ported animation-instance allocator rests on. */
  private animInstanceBoundaries(): AnimInstanceHost {
    return {
      resolvePack: (handle) => packResolveHandle(this.cacheMem(), handle | 0, this.cacheHost) | 0,
      createObject: (cb, size, extra, id) => this.services.createObject(cb, size, extra, id) | 0,
      heapAlloc: (size, align) => this.services.heapAlloc(size, align) | 0,
    };
  }
  private camMem(): CameraManagerMemory { return this.M as unknown as CameraManagerMemory; }
  private cacheMem(): CacheSlotMemory {
    return {
      read16: (a) => this.M.read16u(a), read32: (a) => this.M.read32(a),
      write16: (a, v) => this.M.write16(a, v), write32: (a, v) => this.M.write32(a, v),
    };
  }
  private viewMem(): DisplayServiceMemory {
    return {
      read16: (a) => this.M.read16u(a), read32: (a) => this.M.read32(a),
      write32: (a, v) => this.M.write32(a, v), write16: (a, v) => this.M.write16(a, v),
      write8: (a, v) => this.M.write8(a, v),
    };
  }
  private cardMem(): CardViewMemory {
    return {
      read8: (a) => this.M.read8(a), read16: (a) => this.M.read16u(a), read32: (a) => this.M.read32(a),
      write8: (a, v) => this.M.write8(a, v), write16: (a, v) => this.M.write16(a, v),
      write32: (a, v) => this.M.write32(a, v),
    };
  }

  read(handle: number, offset: number): number { return this.M.read32((handle + offset) >>> 0); }
  read16u(handle: number, offset: number): number { return this.M.read16u((handle + offset) >>> 0); }
  read16s(handle: number, offset: number): number { return this.M.read16s((handle + offset) >>> 0); }
  write(handle: number, offset: number, value: number): void { this.M.write32((handle + offset) >>> 0, value | 0); }
  write16(handle: number, offset: number, value: number): void { this.M.write16((handle + offset) >>> 0, value | 0); }

  private anim(): number { return this.M.read32((this.obj + 0x50) >>> 0) | 0; }
  private camera(): number { return this.M.read32((this.obj + 0x54) >>> 0) | 0; }
  private animMgr(): number { return this.M.read32((this.obj + 0x58) >>> 0) | 0; }

  call(handle: number, offset: number, args: readonly number[]): number {
    const h = handle | 0, o = offset | 0;
    const a1 = args[1] ?? 0, a2 = args[2] ?? 0, a3 = args[3] ?? 0;
    if (h === (this.obj | 0)) {
      if (o === BASE_OBJ_SET_STATE) { baseObjectSetState(this.M, h, a1); return 0; }
      if (o === BASE_OBJ_NEXT_STATE) { baseObjectNextState(this.M, h); return 0; }
      if (o === BASE_OBJ_NEXT_SUBSTATE) { baseObjectNextSubstate(this.M, h); return 0; }
      if (o === BASE_OBJ_NEXT_STAGE) { baseObjectNextStage(this.M, h); return 0; }
    }
    if (this.layers.has(h)) {
      if (o === 0x110) { layerSetX(this.M, h, a1); return 0; }
      if (o === 0x114) { layerSetY(this.M, h, a1); return 0; }
    }
    if (this.contexts.has(h)) {
      // The context is the card-view helper context (F0x8001ffa8) whose arms are
      // ported in engine/dw3/ui/card-view.ts; each arm reads the published singleton.
      if (o === CONTEXT_SET_GLOBAL) { cardViewHelperPublish(this.cardMem(), h); return 0; }
      if (o === CONTEXT_SET_DIMS) { cardViewHelperSetPairA(this.cardMem(), args[0] ?? 0, a1); return 0; }
      if (o === CONTEXT_SET_SIZE) { cardViewHelperSetScratchSize(this.cardMem(), args[0] ?? 0); return 0; }
      if (o === CONTEXT_EMIT) { cardViewHelperUploadPack(this.cardMem(), this.packHost, args[0] ?? 0); return 0; }
    }
    const anim = this.anim();
    if (anim !== 0 && h === anim) {
      if (o === 0x184) { animBindSlot(this.animMem(), this.animHost, h, a1, a2, a3); return 0; }
      if (o === 0x188) return this.reuseAnimResolve(h, a1) | 0;
      if (o === 0x18c) { animRenameSlotKey(this.animMem(), this.animHost, h, a1, a2); return 0; }
      if (o === 0x190) return animSlotModel(this.animMem(), h, a1) | 0;
      if (o === 0x194) { this.reuseAnimPlace(h, a1); return 0; }
    }
    const cam = this.camera();
    if (cam !== 0 && h === cam) {
      if (o === 0xf8) { cameraManagerCopyRecord(this.camMem(), this.camHost, h, a1); return 0; }
      if (o === 0xfc) { cameraManagerBlend(this.camMem(), this.camHost, h, a1, a2, a3); return 0; }
      if (o === 0x100) return cameraManagerResetShot(this.camMem(), this.camHost, h) | 0;
      if (o === 0x104) return cameraManagerCannedShot(this.camMem(), this.camHost, h, a1, a2) | 0;
    }
    const mgr = this.animMgr();
    if (mgr !== 0 && h === mgr) {
      if (o === 0xe8) {
        // The anim manager's own +0xe8 (FIGHTSTG_F0x800868c0) — now a real port; its
        // only callee is the manager's own +0x28 base-object set-state.
        animManagerSelectMotion(this.mgrMem(), this.mgrHost(), h, a1, a2, a3);
        // The manager's rebuild F0x80086304 is where the original calls the effect
        // tint feed; run the port here so the arena colour travels the ordinary
        // route (via the services' arenaTint sink) instead of a hand-set fill.
        this.feedArenaTint(h);
        return 0;
      }
    }
    if (h === (RES | 0)) {
      if (o === 0x404) return cachePoll(this.cacheMem(), args[0] ?? 0, this.cacheHost) | 0;
      if (o === 0x40c) { cacheAcquire(this.cacheMem(), args[0] ?? 0, this.cacheHost); return 0; }
      if (o === 0x424) return packResolveHandle(this.cacheMem(), args[0] ?? 0, this.cacheHost) | 0;
    }
    if (h === (LAYER_REG | 0) && o === 0x17c) {
      // F0x8001e0b0's caller: [0x8004de10+0x17c](key) -> the layer object (F0x8001da84).
      return this.registerLayer(findRegisteredHandleByKey(this.viewMem(), args[0] ?? 0) | 0);
    }
    // The base object-family entries (+0x28/+0x38/+0x3c/+0x40) exist on every object
    // and are handled for any handle, after the more specific tables above.
    if (o === BASE_OBJ_SET_STATE) { baseObjectSetState(this.M, h, a1); return 0; }
    if (o === BASE_OBJ_NEXT_STATE) { baseObjectNextState(this.M, h); return 0; }
    if (o === BASE_OBJ_NEXT_SUBSTATE) { baseObjectNextSubstate(this.M, h); return 0; }
    if (o === BASE_OBJ_NEXT_STAGE) { baseObjectNextStage(this.M, h); return 0; }
    throw new Error(`effect driver host: unhandled method call handle=0x${(h >>> 0).toString(16)} off=0x${(o >>> 0).toString(16)}`);
  }

  /**
   * Run the ported effect-tint feed FIGHTSTG_F0x800861f4 over the anim manager object: the
   * manager's rebuild F0x80086304 is where the original sets the arena view's (0x1000) clear
   * colour from the effect object's own element colour. The manager's pose passes and owner
   * submit are its display submission, which this host does not model; only the view colour
   * is routed, through the shared `feedArenaTint` (see its doc).
   */
  private feedArenaTint(mgr: number): void {
    feedArenaTint(this.M, mgr | 0, this.services.arenaTint);
  }

  private reuseAnimResolve(anim: number, key: number): number {
    // F0x80087e28: the first matching slot's base (anim + idx*0x4c + 0x50), or 0.
    const idx = findAnimSlotIndex(readAnimSlots(this.animMem(), anim), key | 0);
    return idx < 0 ? 0 : animSlotBaseOf(anim, idx);
  }

  private reuseAnimPlace(anim: number, slotId: number): void {
    // F0x80087f38: resolve the slot, read the model record's hover/stand-off through
    // the resource service, and write the placement (reuse animSlotHome, which is the
    // shared arenaPlacement port). The home triple is a copy of the live triple.
    const slot = this.reuseAnimResolve(anim, slotId);
    if (slot === 0) return;
    const rec = this.services.resourceGet(this.M.read32((slot + 0x14) >>> 0) | 0) | 0;
    const hover = this.M.read16u((rec + 0x18) >>> 0) | 0;
    const standoff = this.M.read16u((rec + 0x10) >>> 0) | 0;
    const p = animSlotHome(hover, standoff, slotId | 0);
    const pairs: readonly (readonly [number, number])[] = [
      [0x1c, p.x], [0x1e, p.y], [0x20, p.z], [0x22, p.rotX], [0x24, p.rotY], [0x26, p.rotZ],
      [0x28, p.x], [0x2a, p.y], [0x2c, p.z], [0x2e, p.rotX], [0x30, p.rotY], [0x32, p.rotZ],
    ];
    for (const [off, v] of pairs) this.M.write16((slot + off) >>> 0, v | 0);
  }

  callCell(addr: number, args: readonly number[]): number {
    const a = addr >>> 0, a0 = args[0] ?? 0;
    switch (a) {
      case 0x8004b7bc: return this.services.objectFetch(a0) | 0;
      case 0x80055c54: return this.services.sfxCellA() | 0;
      case 0x80055c60: return this.services.sfxCellB() | 0;
      case 0x80055c48: this.services.sfxPlay(a0); return 0;
      case 0x8004df9c: return this.services.frameDelta() | 0;
      case 0x800a4570: return this.services.resourceGet(a0) | 0;
      // 0x80044f44 is the resource service's +0x40c slot (the resident image's own
      // pointer), i.e. F0x80013c30 cacheAcquire — the same routine the driver reaches
      // as RES+0x40c. It is a REAL PORT, not a boundary.
      case 0x80044f44: cacheAcquire(this.cacheMem(), a0, this.cacheHost); return 0;
      default:
        throw new Error(`effect driver host: unhandled cell call 0x${a.toString(16)}`);
    }
  }

  callDirect(addr: number, args: readonly number[]): number {
    const a = addr >>> 0;
    if (a === 0x800930c0) {
      // FIGHTSTG_F0x800930c0 — the slot-overlay spawn is now a PORT, not a service.
      return slotOverlaySpawn({
        allocObject: (c, s, t) => this.services.allocObject(c, s, t) | 0,
        write32: (p, v) => this.M.write32(p >>> 0, v | 0),
      }, args[0] ?? 0) | 0;
    }
    if (a === 0x8001ffa8) return this.contextFill(args);
    throw new Error(`effect driver host: unhandled direct call 0x${a.toString(16)}`);
  }

  /** F0x80089be4(type, table): the ported effect spawner. */
  spawn(type: number, table: number): number {
    return spawnEffectObject(
      this.M as unknown as EffectSpawnMemory,
      {
        allocEffectObject: () =>
          this.services.allocObject(EFFECT_OBJECT_CLASS, EFFECT_OBJECT_SIZE, EFFECT_OBJECT_TAG) | 0,
        setObjectState: (obj, state) => baseObjectSetState(this.M, obj, state),
      },
      type, table,
    );
  }

  /** F0x8001ffa8(): build the sound/render (card-view helper) context at a host slot. */
  contextFill(_args: readonly number[]): number {
    const ctx = this.services.contextAlloc() | 0;
    cardViewHelperInit(this.cardMem(), ctx);
    this.contexts.add(ctx);
    return ctx;
  }

  /** Note a layer handle the registry returned so its +0x110/+0x114 route here. */
  registerLayer(layer: number): number {
    if ((layer | 0) !== 0) this.layers.add(layer | 0);
    return layer | 0;
  }
}

export { LAYER_REG as EFFECT_DRIVER_HOST_LAYER_REGISTRY, RES as EFFECT_DRIVER_HOST_RESOURCE_SERVICE, CARD_HELPER_CELL };

// ── the ported driver's OWN spawn schedule (the transformation's observable output) ──
//
// The ordinary transformation's Evolve effects are spawned by the driver
// FIGHTSTG_F0x80089cd8 at the closes of substates 2, 3 and 8. This function runs the
// PORTED driver bodies (engine/dw3/battle-effect-driver.ts, through an EffectDriverHost
// whose scripted returns mirror the disc's subsystem responses) one substate per frame
// and records every F0x80089be4 spawn, in frames. It is what the ordinary route's
// `evolEffectsDue` now consults, instead of a frozen walker frame table.
//
// The first two spawns are STATIC disc timers (substate 1's 0xb4 gate, substate 3's
// 0xf0/(2*delta) counter); the third sits behind the slot-overlay child the driver's
// substates 5 and 7 wait on. That child's own progress is the class
// FIGHTSTG_F0x80092f7c, which is now a PORT (engine/dw3/battle-slot-overlay.ts
// #slotOverlayStep) — the schedule ticks the real state machine instead of a
// hand-written counter. The object's own base entries (+0x28/+0x38/+0x3c) are the
// shared base-object family `baseObj` already models; the class's display-list
// submission F0x80092e18 writes nothing the gate reads. The object-FREE is NOT a
// boundary: it is the resident object-lifecycle family (F0x80018140's +0x4c
// teardown = F0x80014308, the destructor the allocator installs, triggered by the
// walk F0x80018230's writeback), already ported and oracled — see the block below.

/** The frame-delta the schedule is computed at (one driver tick per frame). */
export const TRANSFORM_SCHEDULE_DELTA = 1;
// The slot overlay's own rate (0xff / its spawn arg) and readiness gate (0xff) now
// live with the class port, which reads them from the object:
// SLOT_OVERLAY_RATE / SLOT_OVERLAY_GATE in engine/dw3/battle-slot-overlay.ts.

// ── the object-FREE: the resident object-walk's reap writeback ───────────────
//
// The slot-overlay object is not freed by the class, and not by anything in the
// fightstg overlay. It is freed by the RESIDENT object-lifecycle family, reached
// through constructor-installed pointers, and it is already a port:
//
//   • the spawn allocates out of the driver object's own child array: the driver
//     object is built by FIGHTSTG_F0x8008a7f4 with `F0x80014504(class 0x80089cd8,
//     0x74, extra=0x18)` — the allocator F0x800143dc then writes a 6-slot child
//     array at obj+0x24 with its count at obj+0x20 (exe/fns.s:0x80014428-0x80014450).
//     Driver step 5 stores the slot-overlay object at out+0, i.e. child-array slot
//     0 (FIGHTSTG_F0x800930c0's return into `($s4)` where `$s4 = $a1 = obj+0x24`,
//     fightstg.s:0x8008a2fc-0x8008a304); step 7 polls that same slot (L7542).
//   • the resident walk F0x80018230 (exe/fns.s:8914, bound to the cell D0x8004b7c4)
//     walks the parent's +0x20 count over its +0x24 array each frame; for every
//     live slot it calls F0x80018140 (exe/fns.s:8850) and writes the stepper's
//     RETURN VALUE back over the slot (fns.s:8929-8931).
//   • F0x80018140 reads the child's +0x0c at the TOP of its turn; if it reads 3 it
//     calls the child's own constructor-installed teardown at +0x4c — F0x80014308,
//     the destructor F0x800143dc wrote at obj+0x4c (fns.s:0x800144b4-0x800144bc) —
//     and returns 0 (fns.s:8883, 8900-8905). That 0 is the writeback that empties
//     the slot.
//
// So the slot the driver waits on is emptied on the frame AFTER the class's tick
// read state 3 at the top of its turn — one frame after the class reaches 3. That
// is exactly the ordering the schedule below reproduces; the whole family is a
// port already (engine/dw3/ui/translated-task-tree.ts, engine/native/runtime.ts
// `objectLifecycle`) and is oracled against the shipped resident words by
// tests/lane-b/task-slot-lifetime.test.js. `objectWalkReapSlot` below is the
// schedule's faithful application of that rule to the one slot it models; it is a
// port of the resident writeback, not a hand-modelled boundary. Nothing here is
// invented: every step is a resident word.

/** The state word that retires an object in the resident walk (F0x80018140, +0x0c == 3). */
export const OBJECT_LIFECYCLE_DEAD = 3;

/** The two memory words the reap writeback touches. */
export interface ObjectWalkMemory {
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

/**
 * F0x80018140 + F0x80018230's reap rule applied to one live child slot: given the
 * state the walk read at the top of the child's turn, empty the slot when that
 * state was 3 (F0x80018140 ran the +0x4c teardown and returned 0). Returns whether
 * it emptied the slot.
 */
export function objectWalkReapSlot(
  M: ObjectWalkMemory,
  slotAddr: number,
  stateAtTop: number,
): boolean {
  if ((stateAtTop | 0) !== OBJECT_LIFECYCLE_DEAD) return false;
  const slot = slotAddr >>> 0;
  if ((M.read32(slot) | 0) === 0) return false;
  M.write32(slot, 0);
  return true;
}

export interface TransformationSpawn {
  /** The frame the spawn sits at, relative to the driver program's start. */
  readonly frame: number;
  /** The effect id passed to F0x80089be4 (0x3E8..0x3F0). */
  readonly type: number;
  /** The spawn table pointer (EFFECT_DRIVER_SPAWN_POS_ORIGIN / CENTRE / NEG). */
  readonly table: number;
}

export interface TransformationScheduleOptions {
  /** obj+0x8: 0 = manual DV (0x3E8/0x3E9/0x3EB), nonzero = Blast (0x3EF/0x3F0). */
  readonly flag: number;
  /** Frames per driver tick ([0x8004df9c]); defaults to one. */
  readonly frameDelta?: number;
  /** Whether to model the slot-overlay child's readiness; false stalls the third spawn. */
  readonly overlayReady?: boolean;
  /** Safety cap on the frame loop. */
  readonly maxFrames?: number;
  /**
   * The arena view's background colour (view+0x12C), routed from the PORTED effect-tint
   * feed FIGHTSTG_F0x800861f4 via `feedArenaTint` when the driver's substates 0/11 call the
   * anim manager's +0xe8 (the manager's rebuild F0x80086304, where the original runs the
   * feed). This is the colour the renderer paints as the arena background. Optional: a
   * caller with no renderer simply does not paint.
   */
  readonly arenaTint?: (r: number, g: number, b: number) => void;
}

/**
 * Run the PORTED transformation driver over its program and return the effects it
 * spawns, in frame order. Deterministic: the same disc constants and the same scripted
 * subsystem responses every call.
 */
export function createTransformationSchedule(opts: TransformationScheduleOptions): TransformationSpawn[] {
  const flag = opts.flag | 0;
  const delta = opts.frameDelta ?? TRANSFORM_SCHEDULE_DELTA;
  const overlayReady = opts.overlayReady !== false;
  const maxFrames = opts.maxFrames ?? 2000;

  const OBJ = 0x80100000, OUT = 0x80120000;
  const M1 = 0x80110000, M2 = 0x80111000, M3 = 0x80112000;
  const H1 = 0x80141000, R = 0x80140000, LA = 0x80130000, VA = 0x80150000;
  const OV = 0x80160000;

  const m = new Map<number, number>();
  const r32 = (a: number): number => m.get(a >>> 0) ?? 0;
  const w32 = (a: number, v: number): void => { m.set(a >>> 0, v | 0); };
  const w16 = (a: number, v: number): void => { m.set(a >>> 0, v & 0xffff); };
  const r8 = (a: number): number => {
    const w = r32((a >>> 0) & ~3) >>> 0;
    return (w >>> (((a >>> 0) & 3) * 8)) & 0xff;
  };
  const tintMem: TintFeedMemory = { read32: (a) => r32(a >>> 0) | 0, read8: (a) => r8(a) };

  // The seeded world, mirroring tests/engine/unit/battle-effect-driver-timing.test.ts.
  w32(OBJ + 0x04, 0x11); w32(OBJ + 0x08, flag);
  w32(OBJ + 0x0c, 1); w32(OBJ + 0x10, 0); w32(OBJ + 0x14, 0); w32(OBJ + 0x18, 0);
  w32(OBJ + 0x50, M1); w32(OBJ + 0x54, M2); w32(OBJ + 0x58, M3);
  w32(M3 + 0x0c, 0);
  w16(M1 + 0x2a, 0x1111); w16(M1 + 0x2c, 0x0004);
  w16(R + 0x2a, 0x2222); w16(R + 0x2c, 0x0008); w16(VA + 0x02, 0x1234);
  w32(OUT + 0x00, 0); w32(OUT + 0x10, 0);
  w32(EFFECT_DRIVER_SFX_OFFSET_TABLE + 0x08, 0x100);
  w32(EFFECT_DRIVER_SFX_OFFSET_TABLE + 0x14, 0x200);
  w32(EFFECT_DRIVER_SFX_SOURCE, 0x11); w32(EFFECT_DRIVER_SFX_SOURCE2, 0x22);

  const spawns: TransformationSpawn[] = [];
  let frame = 0;

  const objGet = (id: number): number => (id >>> 0) === 0x14 ? M1 : (id >>> 0) === 0x12 ? M2 : (id >>> 0) === 0x15 ? M3 : 0;
  const baseObj = (handle: number, off: number, a1: number): void => {
    if (off === 0x28) { w32(handle + 0x0c, a1); w32(handle + 0x10, 0); w32(handle + 0x14, 0); w32(handle + 0x18, 0); }
    else if (off === 0x38) { w32(handle + 0x0c, (r32(handle + 0x0c) + 1) | 0); w32(handle + 0x10, 0); w32(handle + 0x14, 0); w32(handle + 0x18, 0); }
    else if (off === 0x3c) { w32(handle + 0x10, (r32(handle + 0x10) + 1) | 0); w32(handle + 0x14, 0); w32(handle + 0x18, 0); }
    else { w32(handle + 0x14, (r32(handle + 0x14) + 1) | 0); w32(handle + 0x18, 0); }
  };
  const methodRet = (h: number, o: number): number => {
    if ((h >>> 0) === M1 && (o >>> 0) === 0x188) return H1;
    if ((h >>> 0) === M2 && (o >>> 0) === 0x104) return R;
    if ((h >>> 0) === EFFECT_DRIVER_LAYER_REGISTRY && (o >>> 0) === 0x17c) return LA;
    return 0;
  };
  const cellRet = (a: number): number => {
    if ((a >>> 0) === EFFECT_DRIVER_CELL_DF9C) return delta;
    if ((a >>> 0) === EFFECT_DRIVER_CELL_4570) return VA;
    return 0;
  };

  // The slot-overlay child — the CLASS FIGHTSTG_F0x80092f7c, now ticked through the
  // port (engine/dw3/battle-slot-overlay.ts). Its base entries are the schedule's own
  // base-object family; its display-list submission is a no-op here (the gate reads
  // only +0x0c/+0x10/+0x54).
  const ovHost: SlotOverlayStepHost = {
    frameDelta: (): number => delta,
    nextState: (o) => baseObj(o, 0x38, 0),
    nextSubstate: (o) => baseObj(o, 0x3c, 0),
    setState: (o, s) => baseObj(o, 0x28, s),
    present: () => {},
  };
  const ovMem: SlotOverlayStepMemory = { read32: r32, write32: (a, v) => w32(a, v) };
  let ovSpawnedAt = -1;
  const tickOverlay = (): void => {
    if (!overlayReady || ovSpawnedAt < 0 || frame <= ovSpawnedAt) return;
    const stateAtTop = r32(OV + 0x0c) | 0;
    // F0x80018140 calls the child's class tick (+0x48) after reading +0x0c at the
    // top of the turn...
    slotOverlayStep(ovMem, ovHost, OV);
    // ...then the resident walk F0x80018230 writes the stepper's return (0 once the
    // state read at the top was 3) back over the driver's child-array slot 0 — the
    // out+0 driver step 7 waits on (fightstg.s L7542). This is the FREE, and it is a
    // port of the resident rule, not a modelled boundary; see the block above.
    objectWalkReapSlot(ovMem, OUT + 0x00, stateAtTop);
  };

  const H: EffectDriverHost = {
    read: (h, o) => r32(h + o),
    read16u: (h, o) => r32(h + o) & 0xffff,
    read16s: (h, o) => ((r32(h + o) & 0xffff) << 16) >> 16,
    write: (h, o, v) => w32(h + o, v),
    write16: (h, o, v) => w16(h + o, v),
    call: (h, o, args) => {
      const off = o | 0;
      if (off === 0x28 || off === 0x38 || off === 0x3c || off === 0x40) {
        baseObj(h | 0, off, args[1] ?? 0);
        return 0;
      }
      if ((h >>> 0) === M3 && off === 0xe8) {
        // The manager's +0xe8 (FIGHTSTG_F0x800868c0) triggers the manager's own rebuild
        // F0x80086304, where the original runs the effect-tint feed FIGHTSTG_F0x800861f4
        // (fightstg.s:3780/:3874, each `move $a0, $s1; jal FIGHTSTG_F0x800861f4`). The
        // ordinary transformation route runs the PORTED feed here — the same shared
        // `feedArenaTint` the production host uses — and routes the arena view's colour
        // (view+0x12C) to `opts.arenaTint`. The colour does not affect the spawn schedule.
        feedArenaTint(tintMem, M3, opts.arenaTint);
        return 0;
      }
      return methodRet(h, off);
    },
    callCell: (a, args) => {
      if ((a >>> 0) === EFFECT_DRIVER_CELL_OBJ_GET) return objGet(args[0] ?? 0);
      return cellRet(a);
    },
    callDirect: (a, args) => {
      if ((a >>> 0) === 0x800930c0) {
        ovSpawnedAt = frame;
        // The real spawn (FIGHTSTG_F0x800930c0): allocate the 0x58 object and store
        // 0xff/arg at +0x50 (the per-frame rate the class's step reads).
        slotOverlaySpawn({
          allocObject: () => { w32(OV + 0x0c, 0); w32(OV + 0x10, 0); w32(OV + 0x54, 0); return OV; },
          write32: (p, v) => w32(p, v),
        }, args[0] ?? 0);
        return OV;
      }
      if ((a >>> 0) === 0x8001ffa8) return 0x801a0000;
      return 0;
    },
    spawn: (id, table) => { spawns.push({ frame, type: id | 0, table: table >>> 0 }); return 0x80170000 + spawns.length * 0x100; },
    contextFill: () => 0x801a0000,
  };

  for (frame = 0; frame < maxFrames; frame++) {
    tickOverlay();
    if ((r32(OBJ + 0x0c) | 0) !== 1) break;
    effectDriverProgramBody(r32(OBJ + 0x10) | 0, H, OBJ, OUT);
    if ((r32(OBJ + 0x0c) | 0) === 3) break;
  }
  return spawns;
}
