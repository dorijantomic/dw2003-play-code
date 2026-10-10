/**
 * THE BATTLE RESULT-PAGE CHOOSER — one routine, five arms, ported.
 *
 * `FIGHTSTG_F0x8008cb70` (~/ddw3/asm/dw2003/pro/fightstg.s:10141-:10656) is the machine that
 * decides which line the battle box shows for a blow that has just landed. It is the tick
 * handler of the object the overlay builds at `FIGHTSTG_F0x8008d37c` (`:10659-:10671`,
 * `F0x80014504(0x8008CB70, 0x80, 4)`): the allocator's FIRST argument is the object's tick
 * routine, and the child runner calls it as `lw $v0, 0x48($obj); lw $a1, 0x24($obj); jalr $v0`
 * (~/ddw3/asm/dw2003/exe/fns.s:8877-:8879) — so `$a0` is the object and `$a1` is the
 * four-byte block the allocator's third argument reserved. `0x8008cb70` reads its kind byte
 * off `self+0x50` and writes the object it built into `*($s2)`, which is that block's first
 * word.
 *
 * **The five arms, in the order step 1 tests them** (`.L0x8008ce28` onward, the page is
 * built at `:10320` and each arm is one `beqz`/`beq` further down):
 *
 * | arm | gate | page kind | what the player reads |
 * |---|---|---|---|
 * | `multi_hit` | header `+0x41` = queue slot 9 | **16** | `<name> 3 X 2 = 45 damage!` |
 * | `instant_death` | header `+0x3E` = queue slot 6 | **none** | nothing at all |
 * | `cross_slash` | header `+0x5B` = queue slot 35 | **4** | `<name> <n> damage!` |
 * | `damage` | header `+0x30` set | **4** | `<name> <n> damage!` |
 * | `evade` | header `+0x30` clear | **2** | `<name> Evade!` |
 *
 * Line numbers: slot 9 at `:10245`/`:10254`, slot 6 at `:10256`-`:10279`, slot 35 at
 * `:10380`-`:10404`, `+0x30` at `:10405`-`:10437`.
 *
 * **The instant-death arm is the whole point of this port.** The original writes the beaten
 * member's current HP to zero (`sh $zr, 0x8($v1)` in the `jal` delay slot, `:10375`), puts the
 * page object it already allocated into its state 3 (`:10377`-`:10379`), and falls through to
 * the drain with `self+0x58` still zero — so it never calls the page's `+0xac` show method
 * with any payload, and never writes a kind. Page state 3 is `0x800A4548`(`0x8009e510`), which
 * zeroes the panel's own two state words and re-runs the panel machine (`:10114`-`:10117`): the
 * line box is reset and nothing is drawn. **A KO by an instant-death move prints no result
 * line at all**, and the damage line for that same blow is suppressed with it, because this arm
 * is tested BEFORE the `+0x30` arms.
 *
 * The heal and cure page (kind 8, and kind 0x8d which the 22-arm bound at `:23389` rejects into
 * the empty arm) is the SAME routine's entry state, not one of these five: it is reached with
 * `self+0x0c == 0`, applies the record through `[0x800A445C]` = `FIGHTSTG_F0x8009e0cc` and is
 * ported by `engine/dw3/battle-damage-terms.ts`'s category-4 handler, not from here.
 */

/** The 37-slot result-event queue the battle header carries at `+0x38 .. +0x5C`. */
export const RESULT_QUEUE = Object.freeze({
    /** `F0x80091534` reads the first slot here (`:14965`). */
    FIRST_OFFSET: 0x38,
    /** `0x38 + 0x24`, and the drain's own bound is `slti $v0, $s0, 0x25` (`:15270`). */
    LAST_OFFSET: 0x5c,
    SLOT_COUNT: 0x5c - 0x38 + 1,
    /** `+0x41` — the multi-hit applier `F0x8009d4b8`. */
    MULTI_HIT: 9,
    /** `+0x3E` — the instant-death KO byte `F0x8009d470` writes. */
    INSTANT_DEATH: 6,
    /** `+0x5B` — Cross Slash's own slot, and no other technique's. */
    CROSS_SLASH: 35,
});

/** The header byte that says a blow landed at all (`lbu $v0, 0x30($s1)`, `:10405`). */
export const RESULT_HEADER_LANDED_OFFSET = 0x30;

/** The five arms, in the order `FIGHTSTG_F0x8008cb70` step 1 tests them. */
export const RESULT_PAGE_ARMS = Object.freeze([
    "multi_hit", "instant_death", "cross_slash", "damage", "evade",
] as const);

export type ResultPageArm = (typeof RESULT_PAGE_ARMS)[number];

/** The message kind each arm asks the page for. `0` means the original asks for none. */
export const RESULT_PAGE_ARM_KIND: Readonly<Record<ResultPageArm, number>> = Object.freeze({
    multi_hit: 16,
    instant_death: 0,
    cross_slash: 4,
    damage: 4,
    evade: 2,
});

/** The header offset each queue-slot arm is read at, in the same order. */
export const RESULT_PAGE_ARM_HEADER_OFFSET: Readonly<Record<ResultPageArm, number | null>> =
    Object.freeze({
        multi_hit: RESULT_QUEUE.FIRST_OFFSET + RESULT_QUEUE.MULTI_HIT,
        instant_death: RESULT_QUEUE.FIRST_OFFSET + RESULT_QUEUE.INSTANT_DEATH,
        cross_slash: RESULT_QUEUE.FIRST_OFFSET + RESULT_QUEUE.CROSS_SLASH,
        damage: null,
        evade: null,
    });

/** `esmfight[0x1d]` — the word the evasion arm puts on line two (`:10427` `li $v1, 0x1d`). */
export const RESULT_PAGE_EVADE_WORD = 0x1d;

/**
 * What the walker knows about one blow, in the terms the chooser's own gates use.
 *
 * Every field is a gate the original tests; none of them is a walker's own reason. `dispatch`
 * is the acting technique record's own byte `+0x0A` — the column the disc ships as
 * `fight_tech_table.json`'s `dispatch` — because that byte IS the queue slot index
 * (`sb $a0, 0x38($v0)` with `$v0 = header + byte`, `:27538`-`:27552`).
 */
export interface ResultPageFacts {
    /** the acting technique record's byte `+0x0A`, or null when there is no record. */
    dispatch?: number | null;
    /** the multi-hit applier ran: header `+0x41`, queue slot 9. */
    multiHit?: boolean;
    /** the instant-death roll landed: header `+0x3E`, queue slot 6. */
    instantDeath?: boolean;
    /** header `+0x30`: a blow landed. */
    landed?: boolean;
}

export interface ResultPageChoice {
    /** which of the five arms won. */
    arm: ResultPageArm;
    /** the message kind the original asks for; `0` when it asks for no page. */
    kind: number;
    /** the queue slot that chose the arm, or null when the arm is the `+0x30` test. */
    slot: number | null;
    /** true when the original prints NO line for this blow. */
    silent: boolean;
    /** the `esmfight` index the arm writes into `payload[0]`, when it writes one. */
    index: number | null;
}

/**
 * Which page the original puts up for one blow.
 *
 * The five `beqz`/`beq` tests of `FIGHTSTG_F0x8008cb70` step 1, in order, each one
 * pre-empting the next. The instant-death arm sits SECOND, which is why a KO prints nothing
 * and takes the damage line down with it.
 */
export function chooseResultPage(facts: ResultPageFacts): ResultPageChoice {
    const dispatch = facts.dispatch == null ? null : Math.trunc(Number(facts.dispatch)) | 0;
    const arm: ResultPageArm =
        facts.multiHit ? "multi_hit"
            : facts.instantDeath ? "instant_death"
                : dispatch === RESULT_QUEUE.CROSS_SLASH ? "cross_slash"
                    : facts.landed ? "damage"
                        : "evade";
    const slot = arm === "multi_hit" ? RESULT_QUEUE.MULTI_HIT
        : arm === "instant_death" ? RESULT_QUEUE.INSTANT_DEATH
            : arm === "cross_slash" ? RESULT_QUEUE.CROSS_SLASH
                : null;
    return {
        arm,
        kind: RESULT_PAGE_ARM_KIND[arm],
        slot,
        silent: RESULT_PAGE_ARM_KIND[arm] === 0,
        index: arm === "evade" ? RESULT_PAGE_EVADE_WORD : null,
    };
}

/**
 * The queue slot a technique record owns, or null when its byte names no slot.
 *
 * The byte is the slot index and the queue is 37 wide, so a byte of 0..36 is inside it and
 * anything else is not — the original never stores outside `+0x38 .. +0x5C`.
 */
export function resultQueueSlot(dispatch: number | null | undefined): number | null {
    if (dispatch == null) return null;
    const slot = Math.trunc(Number(dispatch)) | 0;
    return slot >= 0 && slot < RESULT_QUEUE.SLOT_COUNT ? slot : null;
}