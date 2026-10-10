// The pause screen host's startup family, translated bit-exactly from the
// original pro/ststatus bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/pause-host.test.js runs the original through
// engine/native and compares the ordered calls and fields.
//
//   F0x80099A80 pause_host_factory   build the host object (0x78 bytes, 8 extra),
//                                     seed +0x50 = 0x1000, pick the 0x79A/0x79C
//                                     pack set by [0x8009B6EC], load its two ids.
//   F0x80099894 pause_host_tick      the lifecycle: state 0 asks for the banks then
//                                     waits for them and the two host packs, builds
//                                     the menu/sound context and calls +0x38;
//                                     state 1 runs the sub-screen dispatch then the
//                                     backdrop; state 2 waits then goes to 1;
//                                     state 3 idles.
//   F0x800996EC pause_screen_factory_dispatch  pick the sub-screen builder from
//                                     0x8009A988 (fallback F0x80091E4C) into
//                                     arg1+4, or open it (F0x8001345C) into arg1.
//   F0x800997D4 pause_backdrop_draw  the darkened backdrop: a 0x60-step scroll
//                                     counter on +0x54/+0x58 drawn as sprite 0x1D.
//   F0x80099B6C text_banks_request  load the seven pause text/string banks.
//   F0x80099C64 text_banks_busy     true while any of those seven is still loading.
//
// Every resident service, the menu/sound context, the draw context and the
// widget/object methods are host boundaries; the port preserves the exact call
// order, guards and arithmetic. This is lane B (engine/dw3/ui/native/**); lane A
// owns the shared engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** The shared global whose value is the pause string bank base. */
export const PAUSE_STRING_BASE = 0x8005cca8;
/** The seven pause text/string bank offsets. */
export const PAUSE_BANKS = [0xb0, 0x6a, 0x63, 0x4e, 0x47, 0xa2, 0x9b] as const;
/** The two host packs loaded by the factory, and the menu variant selector. */
export const PAUSE_VARIANT_FN = 0x8009b6ec;
export const PAUSE_FACTORY_PACKS_A = [0x079a0000, 0x079a, 0x799] as const;
export const PAUSE_FACTORY_PACKS_B = [0x079c0000, 0x079c, 0x79b] as const;
export const PAUSE_VARIANT_A = [0x079a0001, 0x079a0002] as const;
export const PAUSE_VARIANT_B = [0x079c0001, 0x079c0002] as const;
/** The sub-screen selection state and dispatch table. */
export const PAUSE_SELECT_STATE = 0x8005ccf0;
export const PAUSE_BUILDER_TABLE = 0x8009a988;
/** The request/ready/resource/context services. */
export const PAUSE_BANK_REQUEST = 0x8009b5d0;
export const PAUSE_BANK_READY = 0x8009b5d4;

export interface PauseMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PauseHost {
    /** [0x80044B38+0x404](id): nonzero while the resource is loading. */
    resourceLoaded(id: number): number;
    /** [0x80044B38+0x40C](id): load a resource/bank. */
    loadResource(id: number): void;
    /** [0x80044B38+0x424](handle): resolve a pack handle to its pointer. */
    packResolve(handle: number): number;
    /** [0x8009B5D0](1): request the text banks. */
    requestBanks(flag: number): void;
    /** [0x8009B5D4](1): nonzero while the banks are loading. */
    banksReady(flag: number): number;
    /** F0x8001FFA8(): build the menu/sound context. */
    initMenuContext(): void;
    /** ctx+slot(a1, a2): call one of the menu/sound context methods. */
    contextMethod(slot: number, args: number[]): void;
    /** F0x80014504(cb, size, extra): allocate the host object. */
    createHostObject(): number;
    /** [0x8009B6EC](): the menu variant flag. */
    menuVariant(): number;
    /** F0x8001F648(): build the stack draw context. */
    initDrawContext(): void;
    /** ctx+0x7C(x, y): set the draw layer. */
    setLayer(x: number, y: number): void;
    /** ctx+0x74(x, y): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x84(pack, id, x, y): draw a sprite. */
    drawSprite(pack: number, id: number, x: number, y: number): void;
    /** fn(obj, a): call a builder function pointer. */
    callFunction(fn: number, obj: number, arg: number): number;
    /** F0x80091E4C(obj, a): the fallback builder. */
    fallback(obj: number, arg: number): number;
    /** F0x8001345C(value, a): open the selected sub-screen. */
    openSubScreen(value: number, arg: number): number;
    /** target+slot(a1, a2): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x80099B6C(): load the seven pause text banks. */
export function textBanksRequest(mem: PauseMemory, host: PauseHost): void {
    host.initMenuContext();
    host.contextMethod(0x24, [0x280, 0x100]);
    host.contextMethod(0x2c, [host.packResolve(0x04050000)]);
    const base = mem.read32(PAUSE_STRING_BASE) | 0;
    for (const off of PAUSE_BANKS) host.loadResource((base + off) | 0);
}

/** F0x80099C64(): nonzero while any of the seven pause banks is still loading. */
export function textBanksBusy(mem: PauseMemory, host: PauseHost): number {
    const base = mem.read32(PAUSE_STRING_BASE) | 0;
    for (const off of PAUSE_BANKS) {
        if ((host.resourceLoaded((base + off) | 0) | 0) !== 0) return 1;
    }
    return 0;
}

/** F0x800997D4(): draw the pause backdrop. */
export function pauseBackdropDraw(mem: PauseMemory, obj: number, host: PauseHost): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x50) | 0, 7);
    host.setOrigin(0x280, 0x100);
    if (mem.read32(obj + 0x58) !== 0) {
        const next = (mem.read32(obj + 0x54) + 1) | 0;
        mem.write32(obj + 0x54, next < 0x60 ? next : 0);
        mem.write32(obj + 0x58, 0);
    } else {
        mem.write32(obj + 0x58, 1);
    }
    const scroll = mem.read32(obj + 0x54) | 0;
    host.drawSprite(host.packResolve(0x04040000), 0x1d, scroll, scroll);
}

/** F0x80099A80(): build the pause host object and load its two packs. */
export function pauseHostFactory(mem: PauseMemory, host: PauseHost): number {
    const obj = host.createHostObject();
    mem.write32(obj + 0x50, 0x1000);
    const variant = host.menuVariant() | 0;
    mem.write32(obj + 0x60, variant);
    if (variant === 0) {
        mem.write32(obj + 0x6c, PAUSE_FACTORY_PACKS_A[0]);
        mem.write32(obj + 0x64, PAUSE_FACTORY_PACKS_A[1]);
        mem.write32(obj + 0x70, PAUSE_VARIANT_A[0]);
        mem.write32(obj + 0x74, PAUSE_VARIANT_A[1]);
        mem.write32(obj + 0x68, PAUSE_FACTORY_PACKS_A[2]);
    } else {
        mem.write32(obj + 0x6c, PAUSE_FACTORY_PACKS_B[0]);
        mem.write32(obj + 0x64, PAUSE_FACTORY_PACKS_B[1]);
        mem.write32(obj + 0x70, PAUSE_VARIANT_B[0]);
        mem.write32(obj + 0x74, PAUSE_VARIANT_B[1]);
        mem.write32(obj + 0x68, PAUSE_FACTORY_PACKS_B[2]);
    }
    host.loadResource(mem.read32(obj + 0x64) | 0);
    host.loadResource(mem.read32(obj + 0x68) | 0);
    return obj;
}

/** F0x800996EC(obj, arg1): create or open the pause sub-screen. */
export function pauseScreenFactoryDispatch(
    mem: PauseMemory,
    obj: number,
    arg1: number,
    host: PauseHost,
): void {
    const sub = mem.read32(obj + 0x10) | 0;
    if (sub !== 1) {
        const hi = mem.read32(PAUSE_SELECT_STATE + 4) | 0;
        const lo = mem.read32(PAUSE_SELECT_STATE) | 0;
        const index = ((hi * 7 + lo) | 0) >>> 0;
        const fn = mem.read32(PAUSE_BUILDER_TABLE + index * 4) | 0;
        mem.write32(arg1 + 0x4, fn !== 0 ? host.callFunction(fn, obj, hi) : host.fallback(obj, hi));
        mem.write32(obj + 0x10, (sub + 1) | 0);
        return;
    }
    if ((mem.read32(arg1 + 0x4) | 0) === 0) {
        mem.write32(arg1 + 0x0, host.openSubScreen(mem.read32(obj + 0x50) | 0, mem.read32(PAUSE_SELECT_STATE) | 0));
        host.callMethod(obj, 0x28, [2]);
    }
}

/** F0x80099894(obj, arg1): the pause screen host tick. */
export function pauseHostTick(mem: PauseMemory, obj: number, arg1: number, host: PauseHost): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        pauseScreenFactoryDispatch(mem, obj, arg1, host);
        pauseBackdropDraw(mem, obj, host);
        return;
    }
    if (state === 2) {
        if ((mem.read32(arg1) | 0) === 0) mem.write32(obj + 0x0c, 1);
        pauseBackdropDraw(mem, obj, host);
        return;
    }
    if (state === 3) return;

    const sub = mem.read32(obj + 0x10) | 0;
    if (sub !== 1) {
        host.requestBanks(1);
        mem.write32(obj + 0x10, (sub + 1) | 0);
        return;
    }
    if ((host.banksReady(1) | 0) !== 0) return;
    if ((host.resourceLoaded(mem.read32(obj + 0x64) | 0) | 0) !== 0) return;
    if ((host.resourceLoaded(mem.read32(obj + 0x68) | 0) | 0) !== 0) return;

    host.initMenuContext();
    host.contextMethod(0x24, [0x380, 0x100]);
    host.contextMethod(0x2c, [host.packResolve(mem.read32(obj + 0x70) | 0)]);
    host.contextMethod(0x24, [0x300, 0x100]);
    host.contextMethod(0x2c, [host.packResolve(mem.read32(obj + 0x74) | 0)]);
    host.contextMethod(0x24, [0x280, 0]);
    host.contextMethod(0x28, [0x140, 0x100]);
    host.contextMethod(0x2c, [host.packResolve(mem.read32(obj + 0x6c) | 0)]);
    host.callMethod(obj, 0x38, []);
}
