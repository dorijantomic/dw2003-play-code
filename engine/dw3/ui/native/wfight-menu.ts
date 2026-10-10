// The world fight menu actor, translated bit-exactly from the original
// pro/wfightmn bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/wfight-menu.test.js runs the original through
// engine/native and compares the ordered calls and fields.
//
//   F0x800A6414 wfightMenuFactory  build the 0x54 actor.
//   F0x800A5ECC wfightMenuTick     the actor tick: state 0/>=4 calls +0x38 then
//                                  drives the obj+0x14 load/release table
//                                  (sub != 1) or, for sub 1, loads or waits on
//                                  the eight world/name banks and calls +0x28(3);
//                                  state 1 runs the same; state 2/3 idle.
//
// Every resident resource/context service and every actor method is a host
// boundary; the port preserves the exact call order, guards and table order.
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** The actor handler and size the factory allocates. */
export const WFIGHT_MENU_HANDLER = 0x800a5ecc;
export const WFIGHT_MENU_SIZE = 0x54;
/** The global whose value is the world/name string bank base. */
export const WFIGHT_MENU_STRING_BASE = 0x8005cca8;
/** The two direct banks and the eight name banks (as base-relative offsets). */
export const WFIGHT_BANK_A = 0x286;
export const WFIGHT_BANK_B = 0x455;
export const WFIGHT_NAME_OFFSETS = [0x7f, 0x4e, 0xa2, 0x9b, 0x6a, 0x63] as const;
/** The five menu packs the load/release table works on. */
export const WFIGHT_PACKS = [0x456, 0x79e, 0x7ae, 0x7e1, 0x7e3] as const;
/** The per-case context origins and the case 1 pack handles. */
export const WFIGHT_CASE_ORIGIN = { 2: 0x140, 3: 0x1c0, 4: 0x200, 5: 0x240 } as const;
export const WFIGHT_CASE1_PACKS = [0x04560001, 0x04560000] as const;

export interface WfightMenuMemory {
    read32(addr: number): number;
}

export interface WfightMenuHost {
    /** F0x80014504(cb, size, 0): allocate the actor. */
    allocateActor(): number;
    /** [0x80044B38+0x404](id): nonzero while the resource is loading. */
    resourceLoaded(id: number): number;
    /** [0x80044B38+0x40C](id): load a resource/bank. */
    loadResource(id: number): void;
    /** [0x80044B38+0x418](id): release a resource/bank. */
    releaseResource(id: number): void;
    /** [0x80044B38+0x414](id): the resource/string base for id. */
    resourceBase(id: number): number;
    /** [0x80044B38+0x424](handle): resolve a pack handle. */
    packResolve(handle: number): number;
    /** F0x8001FFA8(): build a menu/sound context. */
    initMenuContext(): void;
    /** ctx+slot(a1, a2): call one of the context methods. */
    contextMethod(slot: number, args: number[]): void;
    /** target+slot(a1, a2): an actor method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x800A6414(): build the world fight menu actor. */
export function wfightMenuFactory(host: WfightMenuHost): number {
    return host.allocateActor();
}

/** F0x800A5ECC(obj): the world fight menu actor tick. */
export function wfightMenuTick(
    mem: WfightMenuMemory,
    obj: number,
    host: WfightMenuHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state !== 1) {
        if (state < 2 || state >= 4) {
            host.callMethod(obj, 0x38, []);
        } else {
            return;
        }
    }

    const sub = mem.read32(obj + 0x10) | 0;
    if (sub === 1) {
        const base = mem.read32(WFIGHT_MENU_STRING_BASE) | 0;
        const banks = [WFIGHT_BANK_A, WFIGHT_BANK_B, ...WFIGHT_NAME_OFFSETS.map((o) => (base + o) | 0)];
        if ((mem.read32(obj + 0x14) | 0) === 1) {
            for (const id of banks) {
                if ((host.resourceLoaded(id) | 0) !== 0) return;
            }
            host.callMethod(obj, 0x28, [3]);
            return;
        }
        for (const id of banks) host.loadResource(id);
        host.callMethod(obj, 0x40, []);
        return;
    }

    switch (mem.read32(obj + 0x14) | 0) {
        case 0:
            for (const id of WFIGHT_PACKS) host.loadResource(id);
            host.callMethod(obj, 0x40, []);
            return;
        case 1:
            if ((host.resourceLoaded(WFIGHT_PACKS[0]) | 0) !== 0) return;
            host.initMenuContext();
            host.contextMethod(0x24, [0x200, 0]);
            host.contextMethod(0x2c, [host.packResolve(WFIGHT_CASE1_PACKS[0])]);
            host.contextMethod(0x24, [0, 0xf4]);
            host.contextMethod(0x20, [host.packResolve(WFIGHT_CASE1_PACKS[1])]);
            host.callMethod(obj, 0x40, []);
            return;
        case 2:
        case 3:
        case 4:
        case 5: {
            const idx = mem.read32(obj + 0x14) | 0;
            const id = WFIGHT_PACKS[idx - 1] ?? 0;
            if ((host.resourceLoaded(id) | 0) !== 0) return;
            host.initMenuContext();
            host.contextMethod(0x24, [WFIGHT_CASE_ORIGIN[idx as 2 | 3 | 4 | 5] ?? 0, 0x100]);
            host.contextMethod(0x2c, [host.resourceBase(id)]);
            host.callMethod(obj, 0x40, []);
            return;
        }
        case 6:
            for (const id of WFIGHT_PACKS) host.releaseResource(id);
            host.callMethod(obj, 0x3c, []);
            return;
        default:
            for (const id of WFIGHT_PACKS) host.loadResource(id);
            host.callMethod(obj, 0x40, []);
            return;
    }
}
