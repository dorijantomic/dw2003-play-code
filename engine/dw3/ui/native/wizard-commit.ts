// The starter-pack commit the registration wizard performs at its hand-off,
// translated from the resident EXE F0x80016DC0 (reached through [0x8004B450]).
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/wizard-commit.test.js runs the original against this port.
//
// For pack A, B or C the three roster slots of its membership row (byte table at
// 0x8004B490, three bytes a pack: {0,6,7}, {2,3,6}, {1,5,7}) become the party
// map, each member's roster record is marked owned (+0x760 = slot + 3), and the
// chosen pack id is stored in the u32 at 0x8004B374.
import { PARTY_CONTEXT, PARTY_MAP, ROSTER_STRIDE } from "../../party-context.ts";

export const STARTER_MEMBERS = 0x8004b490;
export const STARTER_PACK_ID = 0x8004b374;

export interface StarterCommitMemory {
    read8(addr: number): number;
    write32(addr: number, value: number): void;
}

/** F0x80016DC0(pack): commit a starter pack's three members. */
export function commitStarterPack(mem: StarterCommitMemory, pack: number): void {
    for (let i = 0; i < 3; i++) {
        const member = mem.read8((STARTER_MEMBERS + Math.imul(pack, 3) + i) >>> 0);
        mem.write32(PARTY_MAP + i * 4, member);
        mem.write32((PARTY_CONTEXT + Math.imul(member, ROSTER_STRIDE) + 0x760) >>> 0, member + 3);
    }
    mem.write32(STARTER_PACK_ID, pack | 0);
}
