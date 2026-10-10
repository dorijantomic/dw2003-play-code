// The DRI evolution lab's "Digivolve / Select Action" object — its constructor,
// its lifecycle tick and its picker render — translated bit-exactly from the
// original pro/stgdglab bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/select-action.test.js runs the originals through
// engine/native and compares the ordered calls and object fields.
//
//   F0x8008A610 select_action_construct  allocate the 0x11C+0x4C object on the
//                                        shared tick F0x8008A51C, install the
//                                        show/hide methods, set fold scale 0x1000
//                                        and bucket 2 and store its parent.
//   F0x8008A51C select_action_lifecycle  the object's state machine: state 0 /
//                                        other destroys-and-folds, state 1 runs
//                                        the picker tick then the draw, state 2
//                                        waits for the fold, state 3 is a no-op.
//   F0x80089AEC select_action_draw       the picker render: below mode 0xA the
//                                        three submenu panes (folds +0x6C/
//                                        +0x7C/+0x8C), at 0xA and above the
//                                        per-slot pedestal tubes and the
//                                        selected portrait, plus the panel
//                                        folds +0x9C/+0xAC/+0xBC/+0xCC/+0xDC/
//                                        +0xEC.
//
// The draw context is F0x8001F648's 0xA0-byte struct at sp+0x10 (the engine
// vocabulary: sp+0x84=setOrigin, sp+0x8C=setLayer, sp+0x94=drawSprite,
// sp+0x98=paletteShift, sp+0x9C=setScale, sp+0xA4=setPos). [0x80044F5C] is the
// pack resolver (0x02C50000 = stdglabo, 0x02860000 = CMFONT), [0x8004B45C]
// maps a party position to a species/portrait row, [0x8004DE10+0x188] (==
// [0x8004DF98]) is the frame tick, [0x80048D34+0x2728] is the per-index card
// slot, [0x8008FD68] is the species animation-row array (7 u32 per species),
// [0x8008FD9C] is the fold status and [0x8008FD98] the fold start. All of those
// are host boundaries; the port preserves the exact order and guards.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

export const SELECT_ACTION_TICK = 0x80088b5c;
export const SELECT_ACTION_DRAW = 0x80089aec;
export const SELECT_ACTION_LIFECYCLE = 0x8008a51c;
export const SELECT_ACTION_CONSTRUCT = 0x8008a610;

/** stdglabo cs pack handle (lab chrome + chart portraits). */
export const SELECT_PACK_STDGLABO = 0x02c50000;
/** CMFONT cs pack handle. */
export const SELECT_PACK_CMFONT = 0x02860000;
/** [0x8008FD68]: species animation-row array, 7 u32 per species. */
export const SELECT_ANIM_TABLE_CELL = 0x8008fd68;
/** Species animation rows are 7 frames long. */
export const SELECT_ANIM_FRAMES = 7;
/** Frame-advance cadence for the selected portrait and each pedestal. */
export const SELECT_FRAME_PERIOD = 0x0c;
/** CLUT-row advance cadence. */
export const SELECT_CLUT_PERIOD = 0x0a;
/** CLUT row wraps at 4. */
export const SELECT_CLUT_MOD = 4;

/** Object/child fields the lifecycle and draw read or write. */
export const SELECT_FIELDS = {
    state: 0x0c,
    mode: 0x10,
    flag18: 0x18,
    parent: 0x50,
    layer: 0x58,
    bucket: 0x5c,
    foldA: 0x6c,
    foldB: 0x7c,
    foldC: 0x8c,
    foldD: 0x9c,
    foldE: 0xac,
    foldF: 0xbc,
    foldG: 0xcc,
    foldH: 0xdc,
    foldI: 0xec,
    slotFrame: 0xfc,
    pickFrame: 0x108,
    clut: 0x10c,
    frameTimer: 0xf4,
    clutTimer: 0xf8,
    destroy: 0x38,
} as const;

/** Parent-context fields. */
export const SELECT_PARENT_FIELDS = {
    count: 0x5c,
    selected: 0x64,
} as const;

/** Constructor-installed method slots. */
export const SELECT_METHOD_SHOW = 0x800886dc;
export const SELECT_METHOD_HIDE = 0x80088718;

export interface SelectMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** F0x80014504(cb, size, extra): the shared object allocator. */
export interface SelectConstructHost {
    alloc(callback: number, size: number, extra: number): number;
}

/** The lifecycle's host boundaries. */
export interface SelectLifecycleHost {
    /** F0x80088B5C(obj, arg1): the picker tick (translated separately). */
    selectTick(obj: number, arg1: number): void;
    /** F0x80089AEC(obj, arg1): the picker render. */
    selectDraw(obj: number, arg1: number): void;
    /** F0x80088808(obj, arg1): rebuild the widget lists. */
    buildLists(obj: number, arg1: number): void;
    /** obj->unk38(obj): the object's own advance/destroy method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** [0x8008FD9C](target): nonzero while the fold is running. */
    foldStatus(target: number): number;
}

/** The draw's host boundaries. */
export interface SelectDrawHost {
    initDrawContext(): void;
    setOrigin(x: number, y: number): void;
    setLayer(target: number, bucket: number): void;
    drawSprite(pack: number, clip: number, x: number, y: number): void;
    paletteShift(value: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
    /** [0x8004DE10+0x188] == [0x8004DF98]: free-running frame tick. */
    frameTick(): number;
    /** [0x80048D34+0x2728] == [0x8004B45C](index): the roster/card slot at
     *  `index`, negative when empty. The selected-position portrait and the
     *  per-pedestal loop call the same service. */
    rosterSlot(index: number): number;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

/**
 * F0x8008A610(parent): allocate and initialise the Select Action object.
 * Returns the new object.
 */
export function selectActionConstruct(
    mem: SelectMemory,
    host: SelectConstructHost,
    parent: number,
): number {
    const obj = host.alloc(SELECT_ACTION_LIFECYCLE, 0x11c, 0x4c) >>> 0;
    mem.write32(obj + 0x114, SELECT_METHOD_SHOW);
    mem.write32(obj + 0x118, SELECT_METHOD_HIDE);
    mem.write32(obj + SELECT_FIELDS.layer, 0x1000);
    mem.write32(obj + SELECT_FIELDS.bucket, 2);
    mem.write32(obj + SELECT_FIELDS.parent, parent >>> 0);
    return obj;
}

/**
 * F0x8008A51C(obj, arg1): the Select Action object's own tick / lifecycle.
 */
export function selectActionLifecycle(
    mem: SelectMemory,
    obj: number,
    arg1: number,
    host: SelectLifecycleHost,
): void {
    const state = s32(mem.read32(obj + SELECT_FIELDS.state));
    if (state === 1) {
        host.selectTick(obj, arg1);
        host.selectDraw(obj, arg1);
        return;
    }
    if (state === 2) {
        if (s32(host.foldStatus((obj + 0x94) >>> 0)) !== 0) {
            mem.write32(obj + SELECT_FIELDS.state, 1);
            if (s32(mem.read32(obj + SELECT_FIELDS.flag18)) === 0) {
                host.buildLists(obj, arg1);
            }
        }
        host.selectDraw(obj, arg1);
        return;
    }
    if (state === 3) return;
    host.callMethod(obj, SELECT_FIELDS.destroy, [obj]);
    mem.write32(obj + 0x64, 0xa);
    mem.write32(obj + 0x74, 0xa);
    mem.write32(obj + 0x84, 8);
    mem.write32(obj + 0x94, 0xa);
    mem.write32(obj + 0xa4, 0xa);
    mem.write32(obj + 0xb4, 0xa);
    mem.write32(obj + 0xc4, 0xa);
    mem.write32(obj + 0xd4, 8);
    mem.write32(obj + 0xe4, 8);
}

/**
 * F0x80089AEC(obj): the Select Action / Digivolve picker render.
 */
export function selectActionDraw(
    mem: SelectMemory,
    obj: number,
    host: SelectDrawHost,
): void {
    const r = (off: number): number => u32(mem.read32(obj + off));
    const s = (off: number): number => s32(mem.read32(obj + off));
    const parent = r(SELECT_FIELDS.parent);
    const pr = (off: number): number => mem.read32(parent + off);
    const ps = (off: number): number => s32(mem.read32(parent + off));
    const animBase = u32(mem.read32(SELECT_ANIM_TABLE_CELL));
    const anim = (slot: number, frame: number): number =>
        s32(mem.read32(animBase + (slot * SELECT_ANIM_FRAMES + frame) * 4));
    const pack = (handle: number): number => u32(host.packResolve(handle));

    host.initDrawContext();

    if (s(SELECT_FIELDS.mode) < 0xa) {
        host.setOrigin(0x280, 0x100);
        host.setLayer(r(SELECT_FIELDS.layer), r(SELECT_FIELDS.bucket));

        const foldA = s(SELECT_FIELDS.foldA);
        if (foldA !== 0) {
            if (foldA !== 0x1000) {
                host.setScale(u32(foldA), 0x1000, 0x1000);
                host.setPos(0x140, 0x15);
            }
            host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x20, 0x92, 0x0f);
        }
        const foldB = s(SELECT_FIELDS.foldB);
        if (foldB !== 0) {
            if (foldB !== 0x1000) {
                host.setScale(u32(foldB), 0x1000, 0x1000);
                host.setPos(0x140, 0x45);
            } else {
                host.setScale(0x1000, 0x1000, 0x1000);
            }
            host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x21, 0x92, 0x2a);
        }
        const foldC = s(SELECT_FIELDS.foldC);
        if (foldC !== 0) {
            if (foldC !== 0x1000) {
                host.setScale(u32(foldC), 0x1000, 0x1000);
                host.setPos(0x140, 0xd2);
            } else {
                host.setScale(0x1000, 0x1000, 0x1000);
            }
            host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x24, 0xc6, 0xc4);
        }
        return;
    }

    // --- mode 0xA and above: the picker (portrait, pedestals, panels) ---
    const species = s32(host.rosterSlot(ps(SELECT_PARENT_FIELDS.selected)));

    let tick = s32(host.frameTick());
    if (s32(tick - s(SELECT_FIELDS.frameTimer)) >= SELECT_FRAME_PERIOD) {
        mem.write32(obj + SELECT_FIELDS.frameTimer, u32(host.frameTick()));
        if (species >= 0) {
            const frame = s32(r(SELECT_FIELDS.pickFrame)) + 1;
            mem.write32(obj + SELECT_FIELDS.pickFrame, u32(frame));
            if (anim(species, frame) === -1 || frame >= SELECT_ANIM_FRAMES) {
                mem.write32(obj + SELECT_FIELDS.pickFrame, 0);
            }
        }
        let i = 0;
        while (i < ps(SELECT_PARENT_FIELDS.count)) {
            const slot = s32(host.rosterSlot(i));
            if (slot >= 0) {
                const frame = s32(mem.read32(obj + i * 4 + SELECT_FIELDS.slotFrame)) + 1;
                mem.write32(obj + i * 4 + SELECT_FIELDS.slotFrame, u32(frame));
                if (anim(slot, frame) === -1) {
                    mem.write32(obj + i * 4 + SELECT_FIELDS.slotFrame, 0);
                }
            }
            i += 1;
        }
    }

    tick = s32(host.frameTick());
    if (s32(tick - s(SELECT_FIELDS.clutTimer)) >= SELECT_CLUT_PERIOD) {
        mem.write32(obj + SELECT_FIELDS.clutTimer, u32(host.frameTick()));
        const clut = s32(r(SELECT_FIELDS.clut)) + 1;
        mem.write32(obj + SELECT_FIELDS.clut, u32(clut >= SELECT_CLUT_MOD ? 0 : clut));
    }

    host.setOrigin(0x280, 0x100);
    host.setLayer(r(SELECT_FIELDS.layer), r(SELECT_FIELDS.bucket));

    const foldH = s(SELECT_FIELDS.foldH);
    if (foldH !== 0) {
        if (foldH !== 0x1000) {
            host.setScale(u32(foldH), 0x1000, 0x1000);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
            host.setOrigin(0x140, 0);
            host.setLayer(r(SELECT_FIELDS.layer), u32(r(SELECT_FIELDS.bucket) - 1));
            host.paletteShift(r(SELECT_FIELDS.clut));
            host.drawSprite(
                pack(SELECT_PACK_CMFONT),
                0x0d,
                u32(ps(SELECT_PARENT_FIELDS.selected) * 0x30 + 0xa5),
                0x65,
            );
            host.setLayer(r(SELECT_FIELDS.layer), r(SELECT_FIELDS.bucket));
            host.paletteShift(0);
        }
        host.setOrigin(0x280, 0x100);
        let i = 0;
        while (i < ps(SELECT_PARENT_FIELDS.count)) {
            const slot = s32(host.rosterSlot(i));
            if (slot >= 0) {
                if (foldH !== 0x1000) host.setPos(u32(0xb4 + i * 0x30), 0x8a);
                host.drawSprite(
                    pack(SELECT_PACK_STDGLABO),
                    anim(slot, s32(mem.read32(obj + i * 4 + SELECT_FIELDS.slotFrame))),
                    u32(0xa5 + i * 0x30),
                    0x81,
                );
            }
            i += 1;
        }
    }

    const foldG = s(SELECT_FIELDS.foldG);
    if (foldG !== 0) {
        if (foldG !== 0x1000) {
            host.setScale(u32(foldG), 0x1000, 0x1000);
            host.setPos(0x140, 0x8a);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.setOrigin(0x140, 0);
        host.setLayer(r(SELECT_FIELDS.layer), u32(r(SELECT_FIELDS.bucket) - 1));
        host.drawSprite(pack(SELECT_PACK_CMFONT), 0x10, 0x90, 0x5f);
        host.setOrigin(0x140, 0);
        host.setLayer(r(SELECT_FIELDS.layer), r(SELECT_FIELDS.bucket));
        host.drawSprite(pack(SELECT_PACK_CMFONT), 0x11, 0x90, 0x5f);
        host.setOrigin(0x280, 0x100);
        host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x27, 0x90, 0x5f);
    }

    const foldD = s(SELECT_FIELDS.foldD);
    if (foldD !== 0) {
        if (foldD !== 0x1000) {
            host.setScale(u32(foldD), 0x1000, 0x1000);
            host.setPos(0, 0x2f);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        if (species >= 0) {
            host.drawSprite(
                pack(SELECT_PACK_STDGLABO),
                anim(species, s32(r(SELECT_FIELDS.pickFrame))),
                0x10,
                0x16,
            );
        }
        host.setOrigin(0x140, 0);
        host.drawSprite(pack(SELECT_PACK_CMFONT), 0x0e, 0, 0x13);
        host.setOrigin(0x280, 0x100);
        host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x1e, 0, 0x13);
    }

    host.setOrigin(0x280, 0x100);

    const foldE = s(SELECT_FIELDS.foldE);
    if (foldE !== 0) {
        if (foldE !== 0x1000) {
            host.setScale(u32(foldE), 0x1000, 0x1000);
            host.setPos(0x140, 0x1d);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x25, 0x8f, 0x0f);
    }

    const foldF = s(SELECT_FIELDS.foldF);
    if (foldF !== 0) {
        if (foldF !== 0x1000) {
            host.setScale(u32(foldF), 0x1000, 0x1000);
            host.setPos(0x140, 0x4e);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x20, 0x92, 0x43);
    }

    const foldI = s(SELECT_FIELDS.foldI);
    if (foldI !== 0) {
        if (foldI !== 0x1000) {
            host.setScale(u32(foldI), 0x1000, 0x1000);
            host.setPos(0, 0x5a);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(pack(SELECT_PACK_STDGLABO), 0x26, 0, 0x4d);
    }
}
