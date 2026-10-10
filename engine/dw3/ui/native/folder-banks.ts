// The card folder's text-bank loading pair, translated bit-exactly from the
// original pro/stcrddek overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/folder-banks.test.js runs the original through
// engine/native and compares the ordered request/poll calls and the pending
// result. This is the folder-screen twin of album-banks.ts, so it reuses that
// module's host shape.
//
//   F0x8008A100  build the request context (F0x8001FFA8), set its origin
//                (0x280,0), resolve the folder text pack 0x06420000 through
//                [0x80044F5C] and install it, then request banks
//                0x7F6..0x7FA, save+0x16, save+0x1D, save+0x32, save+0x86,
//                0x771.
//   F0x8008A21C  poll the same list through [0x80044F3C]; return 1 as soon as
//                any is still pending, and only for the last id (0x771) return
//                its own boolean.
//
// "save" is *(s32*)0x8005CCA8. This is lane B (engine/dw3/ui/native/**);
// lane A owns the shared engine/dw3/ui/index.ts barrel and the registry.

import type { AlbumBanksHost, AlbumBanksMemory } from "./album-banks.ts";

export type FolderBanksMemory = AlbumBanksMemory;
export type FolderBanksHost = AlbumBanksHost;

/** The save-global block; its +0x16/+0x1D/+0x32/+0x86 hold dynamic bank ids. */
export const FOLDER_BANKS_SAVE_PTR = 0x8005cca8;
/** The folder text pack requested into the context. */
export const PACK_FOLDER_TEXT = 0x06420000;

/** The fixed bank ids, in request and poll order. */
export const FOLDER_TEXT_BANKS: ReadonlyArray<number> = [0x7f6, 0x7f7, 0x7f8, 0x7f9, 0x7fa];

function dynamicBanks(mem: FolderBanksMemory): number[] {
    const save = mem.read32(FOLDER_BANKS_SAVE_PTR) | 0;
    return [save + 0x16, save + 0x1d, save + 0x32, save + 0x86];
}

/** F0x8008A100: request the folder text banks. */
export function folderRequestTextBanks(mem: FolderBanksMemory, host: FolderBanksHost): void {
    host.beginRequestContext();
    host.requestContextOrigin(0x280, 0);
    host.requestContextPack(host.packResolve(PACK_FOLDER_TEXT));
    for (const id of FOLDER_TEXT_BANKS) host.requestBank(id);
    for (const id of dynamicBanks(mem)) host.requestBank(id);
    host.requestBank(0x771);
}

/** F0x8008A21C: 1 while any folder text bank is still loading, else 0. */
export function folderTextBanksPending(mem: FolderBanksMemory, host: FolderBanksHost): number {
    for (const id of dynamicBanks(mem)) {
        if ((host.pollBank(id) | 0) !== 0) return 1;
    }
    return (host.pollBank(0x771) | 0) !== 0 ? 1 : 0;
}
