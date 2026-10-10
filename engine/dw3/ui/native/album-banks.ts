// The card album's text-bank loading pair, translated bit-exactly from the
// original pro/stcrdabm overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/album-banks.test.js runs the original through
// engine/native and compares the ordered request/poll calls and the pending
// result.
//
// Before the album screen can draw its labels it asks the resident text service
// for a fixed set of banks and waits until none is still loading:
//
//   F0x800856A8  build the request context (F0x8001FFA8), set its origin
//                (0x280,0), resolve the album text pack 0x06060000 through
//                [0x80044F5C] and install it, then request banks
//                0x7F6..0x7FA, save+0x16, save+0x1D, save+0x24.
//   F0x800857A0  for the same list, poll [0x80044F3C]; return 1 as soon as any
//                is still pending, else 0 at the end.
//
// "save" is *(s32*)0x8005CCA8, the save-global block. The request context,
// the pack getter and the two resident services are host boundaries; the port
// preserves the exact call order and arguments. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

/** The save-global block; its +0x16/+0x1D/+0x24 hold dynamic bank ids. */
export const ALBUM_BANKS_SAVE_PTR = 0x8005cca8;
/** The album text pack requested into the context. */
export const PACK_ALBUM_TEXT = 0x06060000;

/** The fixed bank ids, in request and poll order. */
export const ALBUM_TEXT_BANKS: ReadonlyArray<number> = [0x7f6, 0x7f7, 0x7f8, 0x7f9, 0x7fa];

export interface AlbumBanksMemory {
    read32(addr: number): number;
}

export interface AlbumBanksHost {
    /** F0x8001FFA8(ctx): create the text-request context. */
    beginRequestContext(): void;
    /** ctx+0x24(x, y): the context's set-origin slot. */
    requestContextOrigin(x: number, y: number): void;
    /** ctx+0x2C(packPtr): the context's set-pack slot. */
    requestContextPack(packPtr: number): void;
    /** [0x80044F5C](handle) -> pack pointer. */
    packResolve(handle: number): number;
    /** [0x80044F44](bankId): begin loading a bank. */
    requestBank(bankId: number): void;
    /** [0x80044F3C](bankId): nonzero while the bank is still loading. */
    pollBank(bankId: number): number;
}

function dynamicBanks(mem: AlbumBanksMemory): number[] {
    const save = mem.read32(ALBUM_BANKS_SAVE_PTR) | 0;
    return [save + 0x16, save + 0x1d, save + 0x24];
}

/** F0x800856A8: request the album text banks. */
export function albumRequestTextBanks(mem: AlbumBanksMemory, host: AlbumBanksHost): void {
    host.beginRequestContext();
    host.requestContextOrigin(0x280, 0);
    host.requestContextPack(host.packResolve(PACK_ALBUM_TEXT));
    for (const id of ALBUM_TEXT_BANKS) host.requestBank(id);
    for (const id of dynamicBanks(mem)) host.requestBank(id);
}

/** F0x800857A0: 1 while any album text bank is still loading, else 0. */
export function albumTextBanksPending(mem: AlbumBanksMemory, host: AlbumBanksHost): number {
    for (const id of ALBUM_TEXT_BANKS) {
        if ((host.pollBank(id) | 0) !== 0) return 1;
    }
    const save = mem.read32(ALBUM_BANKS_SAVE_PTR) | 0;
    if ((host.pollBank(save + 0x16) | 0) !== 0) return 1;
    if ((host.pollBank(save + 0x1d) | 0) !== 0) return 1;
    return (host.pollBank(save + 0x24) | 0) !== 0 ? 1 : 0;
}
