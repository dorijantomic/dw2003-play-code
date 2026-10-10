// The card duel's pile-count badge pops, translated from pro/cardgame:
//   F0x80096CF0 pileCountBadgePopTick — one badge's scale ramp
//   F0x80096E24 pileCountBadgesPopAll — pump all three badges
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/pile-badges-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the plate
// draw and the frame delta recorded.
//
// DECODED: authority-2 closures `_asm/F0x80096cf0.s` and `_asm/F0x80096e24.s`
// and the accepted cardgame-executed-symbol-map row (the shipping browser
// behaviour is engine/systems/card-view.ts stepPlates/stepScaleRamp).
//
// Each badge is a 0xC-byte entry at view+0xDC0 + i*0xC:
//   +0x02 s16 scale      (published)
//   +0x04 s16 counter    (counts down by the frame delta)
//   +0x06 s16 duration
//   +0x08 s16 state      0 idle, 1 grow-down, 2 held at full, 3 shrink-up
// State 0 does nothing. State 2 holds scale 0x1000. State 3 counts down and
// shrinks scale to (counter<<12)/duration, clearing to state 0 when the counter
// runs out. State 1 (and any other nonzero value) publishes
// 0x1000 - (counter<<12)/duration first, then counts down and latches to state 2
// when the counter runs out. The plate draw F0x80096C20 is not in the idle
// census, so it goes through the host.

export interface PileBadgeMemory {
    read16s(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface PileBadgeHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** F0x80096C20(view, param, index, entry): draw the badge. */
    drawPileBadgePlate(view: number, param: number, index: number, entry: number): void;
}

export const PILE_BADGE_BASE = 0xdc0;
export const PILE_BADGE_STRIDE = 0x0c;
export const PILE_BADGE_COUNT = 3;
export const PILE_BADGE = { scale: 0x02, counter: 0x04, duration: 0x06, state: 0x08 } as const;
export const PILE_BADGE_FULL_SCALE = 0x1000;

const s16 = (v: number): number => (v << 16) >> 16;

/** The entry address for badge `index`. */
export function pileBadgeEntry(view: number, index: number): number {
    return (view + PILE_BADGE_BASE + index * PILE_BADGE_STRIDE) >>> 0;
}

/** F0x80096E24(view, param): pump all three badge entries. */
export function pileCountBadgesPopAll(
    mem: PileBadgeMemory, view: number, param: number, host: PileBadgeHost,
): void {
    for (let i = 0; i < PILE_BADGE_COUNT; i++) {
        pileCountBadgePopTick(mem, view, param, i, pileBadgeEntry(view, i), host);
    }
}

/** F0x80096CF0(view, param, index, entry): one badge's scale ramp. */
export function pileCountBadgePopTick(
    mem: PileBadgeMemory, view: number, param: number, index: number, entry: number, host: PileBadgeHost,
): void {
    const state = s16(mem.read16s(entry + PILE_BADGE.state));
    if (state === 0) return;
    if (state === 2) {
        mem.write16(entry + PILE_BADGE.scale, PILE_BADGE_FULL_SCALE);
        host.drawPileBadgePlate(view, param, index, entry);
        return;
    }
    if (state === 3) {
        const counter = (mem.read16s(entry + PILE_BADGE.counter) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(entry + PILE_BADGE.counter, counter);
        if (s16(counter) <= 0) mem.write16(entry + PILE_BADGE.state, 0);
        const duration = s16(mem.read16s(entry + PILE_BADGE.duration));
        const level = Math.trunc((s16(mem.read16s(entry + PILE_BADGE.counter)) << 12) / duration);
        mem.write16(entry + PILE_BADGE.scale, level & 0xffff);
        host.drawPileBadgePlate(view, param, index, entry);
        return;
    }
    // state 1 and every other nonzero value: publish the partial scale first,
    // then count down and latch to state 2 when the counter runs out.
    const startCounter = s16(mem.read16s(entry + PILE_BADGE.counter));
    const duration = s16(mem.read16s(entry + PILE_BADGE.duration));
    const level = Math.trunc((startCounter << 12) / duration);
    mem.write16(entry + PILE_BADGE.scale, (PILE_BADGE_FULL_SCALE - level) & 0xffff);
    const counter = (mem.read16s(entry + PILE_BADGE.counter) - (host.frameDelta() | 0)) & 0xffff;
    mem.write16(entry + PILE_BADGE.counter, counter);
    if (s16(counter) <= 0) mem.write16(entry + PILE_BADGE.state, 2);
    host.drawPileBadgePlate(view, param, index, entry);
}
