// The gym screen's rank-artwork bind, translated from pro/stgtrain F0x8008B8A4.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/gym-rank-pack-oracle.test.js runs the original through
// engine/native on the shipped pro_stgtrain.bin + resident.bin with the
// resident artwork context and the pack resolver recorded.
//
// DECODED: authority-2 closure `_asm/F0x8008b8a4.s` and the m2c body
// `exe-decomp/stgtrain_c/F0x8008b8a4.c`; claim
// `overlay-stgtrain-8008b8a4-role-2026-09-12` (verified) records the three
// calls and no writes. Researcher B's accepted `stgtrain-stgmcard-remaining-contract`
// names the roles: the drill/rank artwork TIM page is bound at VRAM (576, 256)
// and the training TIM pack (0x028D0000) is uploaded into it.
//
// Player-visible result: opening the gym binds its rank and drill artwork into
// the VRAM page the later draws read from. Without it those drawings have no
// texture. The body writes nothing and returns nothing;
// it builds a resident artwork context, sets its +0x24 slot to the VRAM
// rectangle (0x240, 0x100) and its +0x2C slot to the resolved 0x028D0000 pack.
// (The second call's a1 is the caller's leftover 0x100, as the asm shows.)

export interface GymArtworkHost {
    /** The resident F0x8001FFA8 context's `+0x24` method: bind the VRAM rectangle. */
    bindRect(slot: number, x: number, y: number): void;
    /** The same context's `+0x2C` method: upload the resolved pack. */
    bindPack(slot: number, pack: number, a1: number): void;
    /** `[0x80044F5C]` = F0x800140D8: resolve a pack handle to its image. */
    packResolve(handle: number): number;
}

/** The training artwork pack the gym binds. */
export const GYM_RANK_PACK = 0x028d0000;
/** The VRAM rectangle the rank/drill artwork page is bound to. */
export const GYM_RANK_VRAM = { x: 0x240, y: 0x100 } as const;
/** The context slots the two calls go through. */
export const GYM_ARTWORK_RECT_SLOT = 0x24;
export const GYM_ARTWORK_PACK_SLOT = 0x2c;
/** The leftover second argument the asm leaves in $a1 for the pack call. */
export const GYM_ARTWORK_PACK_A1 = 0x100;

/**
 * F0x8008B8A4(): bind the gym's rank artwork. Writes nothing; the work is the
 * two resident context calls.
 */
export function gymBindRankPack(host: GymArtworkHost): void {
    host.bindRect(GYM_ARTWORK_RECT_SLOT, GYM_RANK_VRAM.x, GYM_RANK_VRAM.y);
    host.bindPack(GYM_ARTWORK_PACK_SLOT, host.packResolve(GYM_RANK_PACK) >>> 0, GYM_ARTWORK_PACK_A1);
}
