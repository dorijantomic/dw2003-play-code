// The animation-INSTANCE allocator on the transformation driver's path:
// FIGHTSTG_F0x80084790, the wrapper the anim object's +0x184 binder
// (FIGHTSTG_F0x80087d00, engine/dw3/battle-anim-object.ts#animBindSlot) calls to
// build one layer-figure instance, and the builder FIGHTSTG_F0x80084560 it
// forwards to.
//
// Read from the overlay ASSEMBLY ~/ddw3/asm/dw2003/pro/fightstg.s against the
// committed words of web/assets/native/screens/pro_fightstg.bin (base 0x80082cb0):
//
//   FIGHTSTG_F0x80084790  fightstg.s L1746-L1760  the wrapper:
//       `addiu sp,-0x20; lw v1,0x30(sp); li v0,1; sw ra,0x18(sp);
//        sw a2,0x28(sp); sw a3,0x2c(sp); sw v0,0x14(sp); jal F0x80084560;
//        sw v1,0x10(sp); lw ra,0x18(sp); jr ra; addiu sp,0x20`.
//     It forwards a0-a3 unchanged, feeds the builder's FIFTH argument (+0x64)
//     from the caller's fifth (stack) argument, and forces the builder's SIXTH
//     argument (+0x60) to 1. (Its sibling FIGHTSTG_F0x800847c4 forwards the same
//     fifth argument but forces the sixth to 0 — that is
//     engine/dw3/battle-mesh.ts#createLayerFigureThunk, ported by the display-list
//     worker; this wrapper is the one the +0x184 binder uses.)
//
//   FIGHTSTG_F0x80084560  the builder itself, ALREADY PORTED as
//       engine/dw3/battle-mesh.ts#createLayerFigure (oracled against the original
//       by tests/engine/unit/battle-mesh-oracle.test.ts). It is REUSED here, not
//       re-derived: the wrapper's job is only the argument mapping, and the
//       builder's single genuine input — the pack record its first argument names
//       — is resolved through the SAME real port the driver already reaches for
//       the resource service, engine/dw3/resource-service.ts#packResolveHandle
//       (F0x800140d8, the pointer the resident image stores at 0x80044f5c).
//
// Why the builder must be re-wrapped rather than called with the host's default
// context: F0x80084560 reads the context record it resolves from its OWN first
// argument (the record's word 0 is the pack handle), so the port has to bind that
// handle into the context getter; battle-mesh's LayerFigureHost#context() takes
// no handle, so this wrapper closes over it. Everything the builder writes is
// produced by createLayerFigure, so the two cannot drift.

import {
  createLayerFigure,
  type LayerFigureArgs, type LayerFigureHost, type LayerFigureMemory,
} from "./battle-mesh.ts";

/** The wrapper the +0x184 binder calls (a direct `jal` target). */
export const ANIM_INSTANCE_WRAPPER = 0x80084790;
/** The builder the wrapper forwards to (already ported as createLayerFigure). */
export const ANIM_INSTANCE_BUILDER = 0x80084560;
/** The pack-record cell the builder's first argument resolves through (0x80044f5c). */
export const ANIM_INSTANCE_PACK_CELL = 0x80044f5c;
/** The sixth builder argument the wrapper forces (+0x60) — 1 here, 0 in F0x800847c4. */
export const ANIM_INSTANCE_ARG5 = 1;
/** The resident object factory the builder creates its figure through (F0x800143dc). */
export const ANIM_INSTANCE_FACTORY = 0x800143dc;
/** The blocking heap allocator the builder takes its layer-record array from. */
export const ANIM_INSTANCE_ALLOC_CELL = 0x8004b5f4;

/** A 32-bit reader/writer over the figure object and its layer records. */
export interface AnimInstanceMemory extends LayerFigureMemory {
  read32(addr: number): number;
}

/** The boundaries the reused builder rests on, all resident/device services. */
export interface AnimInstanceHost {
  /** `[0x80044f5c](handle)` — resolve the pack handle (real port: packResolveHandle). */
  resolvePack(handle: number): number;
  /** F0x800143dc(cb, size, extra, id) — the resident object factory. */
  createObject(cb: number, size: number, extra: number, id: number): number;
  /** `[0x8004b5f4](size, align)` — the blocking heap allocator. */
  heapAlloc(size: number, align: number): number;
}

/** The wrapper's five forwarded arguments (a0-a3 and the caller's stack word). */
export interface AnimInstanceArgs {
  /** $a0 — the record word whose high half is OR'd into the figure/layer words. */
  readonly w0: number;
  /** $a1 — stored at object+0x74. */
  readonly w1: number;
  /** $a2 — stored at object+0x68. */
  readonly t0: number;
  /** $a3 — stored at object+0x6c. */
  readonly t1: number;
  /** The wrapper's fifth (stack) argument — the builder's arg4 (object+0x64). */
  readonly slotBase: number;
}

/**
 * F0x80084790 — the builder argument block the wrapper builds: a0-a3 forwarded,
 * arg4 from the caller's stack word, arg5 forced to ANIM_INSTANCE_ARG5 (1).
 */
export function animInstanceArgs(a: AnimInstanceArgs): LayerFigureArgs {
  return {
    arg0: a.w0, arg1: a.w1, arg2: a.t0, arg3: a.t1,
    arg4: a.slotBase, arg5: ANIM_INSTANCE_ARG5,
  };
}

/**
 * F0x80084790 — build one animation-instance figure through the wrapper's
 * argument mapping, reusing the ported builder. The context getter resolves the
 * caller's pack handle through the host's resolvePack and reads the record's
 * flags (+0x0), count (+0x4) and 3 words per layer (+0x8) from memory.
 */
export function createAnimInstance(
  host: AnimInstanceHost,
  mem: AnimInstanceMemory,
  args: AnimInstanceArgs,
): number {
  const handle = args.w0 | 0;
  const figHost: LayerFigureHost = {
    context: () => {
      const rec = host.resolvePack(handle) >>> 0;
      const flags = mem.read32(rec >>> 0) | 0;
      const count = mem.read32((rec + 4) >>> 0) | 0;
      const words: number[] = [];
      for (let i = 0; i < count * 3; i++) words.push(mem.read32((rec + 8 + i * 4) >>> 0) | 0);
      return { flags, count, words };
    },
    createBuilder: (a0, a1, a2, a3) => host.createObject(a0, a1, a2, a3) | 0,
    allocate: (size, align) => host.heapAlloc(size, align) | 0,
  };
  return createLayerFigure(figHost, mem as LayerFigureMemory, animInstanceArgs(args)) | 0;
}
