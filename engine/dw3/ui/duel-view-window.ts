// The card duel's view-window and resolving-card presentation — family E of the
// layer beneath the nine mode updates. Two routines, read from the overlay
// assembly (authority 2):
//
//   F0x800A1DB8 waitViewWindowOpen  — ask the board view to open its window,
//                                     then report whether it has finished
//   F0x800A1E60 presentResolvingCard — show the card being resolved: a big
//                                     banner over the played slot, then a
//                                     settle, and only then report done
//
// Source (assembly): exe-decomp/cardgame.norm.s
//   F0x800a1db8 @.L0x0001f108, F0x800a1e60 @.L0x0001f1b0. F0x800A1E60 is a
//   6-state jump table at D0x80083a50 whose arms are F0x800a1eb4 (0), F0x800a1f60
//   (1), F0x800a2050 (2), F0x800a20a8 (3), F0x800a2160 (4, immediate return) and
//   F0x800a212c (5). The m2c body `exe-decomp/cardgame_c/F0x800a1e60.c` merges
//   the arms into one switch correctly, and its state-0 banner argument is
//   `...->unk50 + 1`: the arm reloads `$a2` to 1 at 0x800A1F18 before the
//   jalr's delay slot, so the delay-slot `addu $a3, $a3, $a2` adds 1 to the
//   card-table halfword. This port takes the assembly, verified by the oracle.
//
// What the player sees. When a played card resolves the board holds up a big
// banner over that card for 35 frames — or cuts it short the moment a button is
// pressed after 20 — then the card settles onto the resolution stack before the
// duel moves on (waitViewWindowOpen gates the window first: the board must
// report itself ready before the card is shown).
//
// The view's own method slots (EC8/EA8/EAC/EB0/F1C/F24) and the resident frame
// delta and random-bit services are host edges here, exactly as the board view's
// own queues treat their slots: their bodies are separate routines.

export interface DuelViewWindowMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The duel's presentation state fields this family reads and writes. */
export const DUEL_WINDOW = {
    /** The waiting-spinner step / the effect state counter (s32). */
    state: 0x4e8,
    /** The per-state frame timer (s32). */
    timer: 0x4ec,
    /** The board-view request flag word (read as a byte). */
    request: 0x498,
    /** Two request bytes waitViewWindowOpen raises. */
    requestA: 0x49d,
    requestB: 0x499,
    /** How many cards have been played this turn (signed byte). */
    playCount: 0x575,
    /** The played-card history, stride 8, from `duel+0x580`. */
    historyBase: 0x580,
    /** The duel's own card table (stride 2, 0-based ids). */
    cardTable: 0x50,
    /** The board view hangs off the caller's scene context at +0x18. */
    viewSlot: 0x18,
} as const;

/** The view's own state the window reports on (`view+0x64`). */
export const VIEW_WINDOW_READY = 0x64;

/** The two timers the resolving card's later states wait out. */
export const PRESENT_HOLD_FRAMES = 0x23;
export const PRESENT_SHORT_FRAMES = 0x14;
export const PRESENT_SETTLE_FRAMES = 8;
export const PRESENT_TAIL_FRAMES = 0xf;
/** The pending-step latch the RNG may jump the hold to. */
export const PRESENT_RNG_SKIP = 0x23;
/** The played-history array the banner's arguments are read from. */
export const PRESENT_HISTORY_BASE = 0x800a5d84;
/** The packed sound the settle raises. */
export const PRESENT_SOUND = 0x8004603c;

export interface DuelViewWindowHost {
    /** `view+0xEC8(view)` = F0x8009C2D0: open the board view's window. */
    openViewWindow(view: number): void;
    /** `view+0xEAC(view, kind, a2, a3, w, h)` = F0x8009BEAC: open a title banner. */
    openInfoBanner(view: number, kind: number, a2: number, a3: number, w: number, h: number): void;
    /** `view+0xEB0(view, kind)` = F0x8009BF5C: write the banner record. */
    writeBannerRecord(view: number, kind: number): void;
    /** `view+0xF24(view, index, span, from, to)` = F0x8009C938: the slot tween. */
    scaleSlot(view: number, index: number, span: number, from: number, to: number): void;
    /** `view+0xEA8(view, index)` = F0x8009BE78: close the centre plate. */
    closePlate(view: number, index: number): void;
    /** `view+0xF1C(view, index)` = F0x8009CE28: start the slot's settle. */
    settleSlot(view: number, index: number): void;
    /** `(*0x8004DF9C)()`: the resident per-frame delta. */
    frameDelta(): number;
    /** `(*0x8005BBF8)(0)`: the resident random word (the RNG function cell). */
    randomValue(): number;
    /** `(*0x8005BBD8)(0, 0xD)`: the shift for the random bit. */
    randomShift(): number;
    /** `(*0x80055C48)(id)`: play a packed sound. */
    playSound(id: number): void;
}

/**
 * F0x800A1DB8(duel, scene): the first call asks the board view to open — raising
 * the request bytes, calling view+0xEC8 once, and stepping the state counter.
 * Afterwards it reports ready (1) only when the view is in mode 2 and the duel
 * has no outstanding request.
 */
export function waitViewWindowOpen(
    mem: DuelViewWindowMemory, host: DuelViewWindowHost, duel: number, scene: number,
): number {
    if ((mem.read32(duel + DUEL_WINDOW.state) | 0) === 0) {
        mem.write8(duel + DUEL_WINDOW.requestA, 1);
        mem.write8(duel + DUEL_WINDOW.requestB, 1);
        const view = mem.read32(scene + DUEL_WINDOW.viewSlot) | 0;
        host.openViewWindow(view);
        mem.write32(duel + DUEL_WINDOW.state, (mem.read32(duel + DUEL_WINDOW.state) | 0) + 1);
    }
    let ready = 0;
    const view = mem.read32(scene + DUEL_WINDOW.viewSlot) | 0;
    if (mem.read16s(view + VIEW_WINDOW_READY) === 2 && (mem.read8(duel + DUEL_WINDOW.request) & 0xff) === 0) {
        ready = 1;
    }
    return ready;
}

/**
 * F0x800A1E60(duel, scene): the resolving card's presentation machine. State 0
 * opens the banner over the just-played card's slot and blanks the fifteen board
 * slots' text timers; state 1 holds the banner (the RNG may skip the hold short)
 * and then writes the banner record, tweens the slot to full size and closes the
 * plate; state 2 settles it; state 3 slides it off; state 4 returns; state 5
 * counts the tail and reports 1 when the whole present is over.
 */
export function presentResolvingCard(
    mem: DuelViewWindowMemory, host: DuelViewWindowHost, duel: number, scene: number,
): number {
    const state = mem.read32(duel + DUEL_WINDOW.state) | 0;
    const view = mem.read32(scene + DUEL_WINDOW.viewSlot) | 0;
    switch (state) {
        case 0: {
            mem.write32(duel + DUEL_WINDOW.state, 1);
            mem.write32(duel + DUEL_WINDOW.timer, 0);
            const play = mem.read8s(duel + DUEL_WINDOW.playCount);
            const rec = duel + (play - 1) * 8;
            const card = mem.read16s(rec + DUEL_WINDOW.historyBase) | 0;
            const selector = mem.read8(rec + DUEL_WINDOW.historyBase + 4) & 0xff;
            const language = mem.read32(0x8005ccb0) | 0;
            const table = PRESENT_HISTORY_BASE + selector * 4 + language * 8;
            // `li $a2, 1` at 0x800A1F18 is reloaded before the jalr's delay
            // slot, so the arm's `addu $a3, $a3, $a2` adds 1 to the card table's
            // halfword (m2c's `...->unk50 + 1` is correct). The card table entry
            // is 0-based; the banner takes the 1-based id.
            const entry = duel + card * 2;
            const arg3 = (mem.read16s(entry + DUEL_WINDOW.cardTable) + 1) | 0;
            host.openInfoBanner(
                view, 2, 1, arg3,
                mem.read16s(table) | 0, mem.read16s(table + 2) | 0,
            );
            for (let i = 0; i < 0xf; i++) mem.write16(view + 0x12e + i * 0x4c, 0);
            return 0;
        }
        case 1: {
            if ((mem.read32(duel + DUEL_WINDOW.timer) | 0) >= PRESENT_SHORT_FRAMES) {
                const value = host.randomValue() | 0;
                const shift = host.randomShift() | 0;
                if (((value >> shift) & 1) !== 0) mem.write32(duel + DUEL_WINDOW.timer, PRESENT_RNG_SKIP);
            }
            const t = ((mem.read32(duel + DUEL_WINDOW.timer) | 0) + (host.frameDelta() | 0)) | 0;
            mem.write32(duel + DUEL_WINDOW.timer, t);
            if (t >= PRESENT_HOLD_FRAMES) {
                const play = mem.read8s(duel + DUEL_WINDOW.playCount);
                host.writeBannerRecord(view, 2);
                host.scaleSlot(view, (play + 0xb) | 0, 8, 0x1400, 0x1400);
                host.closePlate(view, (play - 1) | 0);
                mem.write32(duel + DUEL_WINDOW.state, 2);
                mem.write32(duel + DUEL_WINDOW.timer, 0);
                host.playSound(PRESENT_SOUND);
                return 0;
            }
            return 0;
        }
        case 2: {
            const t = ((mem.read32(duel + DUEL_WINDOW.timer) | 0) + (host.frameDelta() | 0)) | 0;
            mem.write32(duel + DUEL_WINDOW.timer, t);
            if (t >= PRESENT_SETTLE_FRAMES) {
                const play = mem.read8s(duel + DUEL_WINDOW.playCount);
                host.settleSlot(view, (play + 0xb) | 0);
                mem.write32(duel + DUEL_WINDOW.state, 3);
                mem.write32(duel + DUEL_WINDOW.timer, 0);
            }
            return 0;
        }
        case 3: {
            const t = ((mem.read32(duel + DUEL_WINDOW.timer) | 0) + (host.frameDelta() | 0)) | 0;
            mem.write32(duel + DUEL_WINDOW.timer, t);
            if (t >= PRESENT_TAIL_FRAMES) {
                const play = mem.read8s(duel + DUEL_WINDOW.playCount);
                host.scaleSlot(view, (play + 0xb) | 0, 4, 0, 0);
                mem.write32(duel + DUEL_WINDOW.state, 5);
                mem.write32(duel + DUEL_WINDOW.timer, 0);
                host.playSound(PRESENT_SOUND);
            }
            return 0;
        }
        case 4:
            return 0;
        case 5: {
            const t = ((mem.read32(duel + DUEL_WINDOW.timer) | 0) + (host.frameDelta() | 0)) | 0;
            mem.write32(duel + DUEL_WINDOW.timer, t);
            return t >= PRESENT_TAIL_FRAMES ? 1 : 0;
        }
        default:
            return 0;
    }
}
