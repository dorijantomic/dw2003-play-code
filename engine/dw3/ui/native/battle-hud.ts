// The in-fight HP plate's party status markers, HP bar fill and HP number row,
// translated from the original pro/fightstg HUD routine.
//
//   FIGHTSTG_F0x800934f0  the whole HUD draw. Seven of its blocks are ported here:
//     battleHudDrawPlateFrames .L0x80093568-.L0x8009359c  the two plate pictures
//     battleHudBuildNames      .L0x800935a4 / F0x80093364  the two name elements
//     battleHudDrawPartyPips   .L0x80093950-.L0x80093a44  the party status markers
//     battleHudHpBarLength     .L0x800936b4-.L0x800936d4  the bar length in 128ths
//     battleHudHpGradient      .L0x80093714-.L0x800937dc  the quarter-HP colour branch
//     battleHudHpNumberRows    .L0x800935cc-.L0x80093684  the two HP number widgets
//     battleHudDvGauge         .L0x80093820-.L0x8009392c  the DV/Blast gauge
//
//   FIGHTSTG_F0x80093a74  the HUD's own tick. Its BUILD arm (mode 0) is ported as
//     battleHudBuildSeparator .L0x80093ac4-.L0x80093b1c  the gate reset and the
//                                                     slash between the HP numbers
//
// Every constant is exported verbatim from the assembly and every host service is
// a boundary, so the oracle in tests/lane-b/battle-hud.test.js can run the
// original through engine/native and compare the ordered calls.
//
// Byte order. A colour word is quoted as the PlayStation keeps it: the PS1 is
// little-endian and its colour triple is R, G, B from the lowest address up, so
// 0x00287100 is R 0x00, G 0x71, B 0x28 — #007128. (The extracted overlay image in
// web/assets/native/screens/pro_fightstg.bin is word-swapped for the interpreter in
// engine/native, which is why the constants here are the ORIGINAL little-endian
// words and the oracle loads the swapped bytes on purpose.)

// ---------------------------------------------------------------- addresses
/** FIGHTSTG_F0x800934f0 — the in-battle HUD draw. */
import { persistentRosterSlot } from "../../party-context.ts";
export const BATTLE_HUD_DRAW = 0x800934f0;
/**
 * .L0x800a34c0 — six halfwords, three per side. Side 0 (the player's party) reads
 * halfwords 0..2 = 271, 282, 293; side 1 (the enemy) reads halfwords 3..5 = 37, 26,
 * 15, because .L0x80093a30 advances the halfword cursor by 6 bytes (addiu $s4,$s4,6).
 */
export const BATTLE_HUD_PIP_X = 0x800a34c0;
/**
 * The six halfwords of 0x800a34c0 as the original ships them, read out of the
 * overlay's own data: the player's three markers at 271, 282 and 293 and the
 * enemy's at 37, 26 and 15. The port reads them from memory like the original
 * does; this copy is what a caller seeds when it has no overlay image loaded.
 */
export const BATTLE_HUD_PIP_XS: readonly number[] = Object.freeze([271, 282, 293, 37, 26, 15]);
/** .L0x8009398c / .L0x80093a1c — `lh $a2, 0x34c0+2*i`, drawn at `li $a3, 0x30`. */
export const BATTLE_HUD_PIP_X_STRIDE = 2;
/** .L0x80093a1c: `addiu $a3, $zero, 0x30` — the literal marker y. */
export const BATTLE_HUD_PIP_Y = 0x30;
/** .L0x80093a30: `addiu $s4, $s4, 6` — 6 bytes = 3 halfwords between the sides. */
export const BATTLE_HUD_PIP_SIDE_STRIDE = 3;
/** .L0x80093a24: `slti $v0, $s0, 0x3` — three markers per side. */
export const BATTLE_HUD_PIP_COUNT = 3;
/** .L0x80093a38: `slti $v0, $s2, 0x2` — two sides. */
export const BATTLE_HUD_PIP_SIDES = 2;
/** .L0x800939ec: `addiu $a1, $a1, 0xc` — the active member's cel base. */
export const BATTLE_HUD_PIP_CEL_ACTIVE = 0x0c;
/** .L0x800939f0: `addiu $a1, $a1, 0x3c` — every other member's cel base. */
export const BATTLE_HUD_PIP_CEL_INACTIVE = 0x3c;
/**
 * .L0x80093980-.L0x8009398c — the member's combatant record, `addu $s1, $s6, $v0` with
 * `sll $v0, $s0, 0x5` (index*0x20) over the base 0x800a4470; the side adds 0x60
 * (.L0x80093a40 `addiu $s3, $s3, 0x60`), so the enemy records start at 0x800a44d0.
 */
export const BATTLE_HUD_RECORDS = 0x800a4470;
/** .L0x8009396c: `sll $v0, $s0, 0x5`. */
export const BATTLE_HUD_RECORD_STRIDE = 0x20;
/** .L0x80093a40: `addiu $s3, $s3, 0x60` — the second side's record base. */
export const BATTLE_HUD_SIDE_STRIDE = 0x60;
/** .L0x8009395c: `lh $v0, 0xd6($s7)` with s7 = 0x800a4460. */
export const BATTLE_HUD_SIDE_MODE = 0x800a4536;
/**
 * .L0x80093968 / .L0x80093978 — the marker loop is skipped outright when this
 * halfword is 4 or more, the member index is above zero and the side is the enemy
 * (`bgtz $s2, .L0x80093a44` leaves the whole routine).
 */
export const BATTLE_HUD_SIDE_MODE_DRAW_ALL = 4;
/** .L0x800939d4-.L0x800939dc: `lw $v0, 8(s7 + s2*4)` — the active slot of each side. */
export const BATTLE_HUD_ACTIVE_SLOT = 0x800a4468;
/** .L0x80093990: `lh $v0, ($s1)` — record +0x00, non-zero marks the slot as present. */
export const BATTLE_HUD_RECORD_PRESENT = 0x00;
/** .L0x800939a0: `lbu $v0, 0x1c($s1)` — the ailment byte; set means "afflicted". */
export const BATTLE_HUD_RECORD_AILMENT = 0x1c;
/** .L0x800939b0: `lh $v1, 8($s1)` — the member's current HP. */
export const BATTLE_HUD_RECORD_HP = 0x08;
/** .L0x800939c0: `lh $v0, 6($s1)` — the member's maximum HP. */
export const BATTLE_HUD_RECORD_MAX_HP = 0x06;
/** The three marker states the loop derives, in the order .L0x800939a8-.L0x800939cc tests them. */
export const BATTLE_HUD_PIP_STATE_AFFLICTED = 3;
export const BATTLE_HUD_PIP_STATE_DOWN = 2;
export const BATTLE_HUD_PIP_STATE_HURT = 1;
export const BATTLE_HUD_PIP_STATE_FULL = 0;
/** .L0x80093568-.L0x8009359c: the pack handle `[0x80044F5C](0x04550000)`, PGFGTC00. */
export const BATTLE_HUD_PACK = 0x04550000;

// ------------------------------------------------------------ HP bar lengths
/**
 * .L0x800936b8-.L0x800936c0 — `sll $v0, $a0, 7` then `div $zero, $v0, $v1` against the
 * s16 maximum at record +0x06: the length in 128ths of the full bar.
 */
export function battleHudHpBarLength(hp: number, maxHp: number): number {
    const shown = hp | 0;
    const max = maxHp | 0;
    if (max === 0) return 0;
    const len = Math.trunc(Math.imul(shown, 0x80) / max);
    // .L0x800936c4/.L0x800936cc: only a member that is still standing gets the floor.
    if (shown > 0 && len < 4) return 3;
    return len;
}

/**
 * .L0x800936e0-.L0x80093710 — the fill quad's moving edge. Vertices 0 and 2 sit at
 * x 175 and vertices 1 and 3 at x 303 (`.L0x800936e0 lhu $v0, 0x3470`), and the
 * routine writes `175 + length` into the two right-hand vertices, so the player's
 * bar drains from its outer (right) end; the enemy quad at 0x800a3480 holds
 * vertices 0/2 at 143 and 1/3 at 15 and writes `143 - length`, so that one drains
 * from its outer (left) end. Both close toward the middle of the screen.
 */
export const BATTLE_HUD_HP_QUAD_PLAYER = 0x800a3470;
export const BATTLE_HUD_HP_QUAD_ENEMY = 0x800a3480;
/**
 * The two fill quads as the overlay ships them: eight halfwords each, four vertices
 * in GPU order (x, y), read out of the overlay's own data at 0x800a3470 and
 * 0x800a3480. Both are 128 wide and six rows tall (37..43); the enemy's runs from
 * x 15 to x 143, so its vertex 1 is LEFT of its vertex 0.
 */
export const BATTLE_HUD_HP_QUAD_PLAYER_HALFWORDS: readonly number[] =
    Object.freeze([175, 37, 303, 37, 175, 43, 303, 43]);
export const BATTLE_HUD_HP_QUAD_ENEMY_HALFWORDS: readonly number[] =
    Object.freeze([143, 37, 15, 37, 143, 43, 15, 43]);
/**
 * Which way the bar's ramp runs on screen, read off the quad's own vertex order:
 * +1 when vertex 1 is right of vertex 0 (the player's bar, dark at 175 and bright
 * at 303) and -1 when it is left (the enemy's, bright at 15 and dark at 143).
 * `side` is 0 for the player and 1 for the enemy.
 */
export function battleHudHpBarRamp(side: number): number {
    const quad: readonly number[] = side === 1
        ? BATTLE_HUD_HP_QUAD_ENEMY_HALFWORDS : BATTLE_HUD_HP_QUAD_PLAYER_HALFWORDS;
    return (quad[2] as number) > (quad[0] as number) ? 1 : -1;
}
/**
 * .L0x800936e0 and .L0x800936e4 read the quad's two fixed edges (`lhu $v0, 0x3470`
 * and `lhu $v1, 8($s6)`), and .L0x800936f0 / .L0x800936f8 write the two moving ones
 * (`sh $v0, 4($s6)` and `sh $v1, 0xc($s6)`).
 */
export const BATTLE_HUD_HP_EDGE_OFFSET = 0x00;
export const BATTLE_HUD_HP_EDGE_STRIDE = 0x08;
export const BATTLE_HUD_HP_MOVING_OFFSET = 0x04;
export const BATTLE_HUD_HP_MOVING_STRIDE = 0x08;
/** The full bar is 128 wide: 175 + 128 = 303 (vertex 1's shipped x1) and 143 - 128 = 15. */
export const BATTLE_HUD_HP_FULL = 128;

/**
 * .L0x80093714-.L0x80093724 — the quarter test. `lhu $v0, 6($s1)` then
 * `sll $v0,$v0,0x10 / sra $v0,$v0,0x12` sign-extends the 16-bit maximum and divides
 * it by four; `slt $v0, $v0, $v1` against the displayed HP at HUD +0x60 picks the
 * branch, and `beqz $v0, .L0x8009378c` sends an equal quarter to the second pair.
 */
export function battleHudHpGradient(shownHp: number, maxHp: number): number {
    const quarter = (maxHp << 16) >> 18;
    return quarter < (shownHp | 0) ? BATTLE_HUD_GRADIENT_HEALTHY : BATTLE_HUD_GRADIENT_LOW;
}
/** .L0x8009372c-.L0x80093780 — the pair at 0x800a3490 / 0x800a3494, above a quarter. */
export const BATTLE_HUD_GRADIENT_HEALTHY = 0x800a3490;
/** .L0x8009378c-.L0x800937dc — the pair at 0x800a3498 / 0x800a349c, at or below. */
export const BATTLE_HUD_GRADIENT_LOW = 0x800a3498;

/**
 * The polygon is an UNTEXTURED, Gouraud-shaded quad. F0x8009e77c patches the word
 * count `8` into `prim+0x3` and the GPU command into the top byte of the first
 * colour word: `.L0x8009e838 li $v0, 0x38 / sb $v0, 0x7($a0)`, and `.L0x8009e844`
 * swaps in `0x3a` — the same quad, semi-transparent — when the caller's fifth
 * argument is set. 0x38 is POLY_G4 — a Gouraud-shaded quad, carrying four vertex
 * colours and nothing else.
 */
export const BATTLE_HUD_POLY_G4 = 0x38;
export const BATTLE_HUD_POLY_G4_SEMI = 0x3a;
/** The byte F0x8009e77c `.L0x8009e834` writes at prim+0x3: the primitive's word count. */
export const BATTLE_HUD_POLY_WORDS = 0x08;
/**
 * F0x8009e77c `.L0x8009e7f0`-.L0x8009e830 — the four words of the block it is handed
 * land at `prim+0x4`, `+0xc`, `+0x14` and `+0x1c`, which are exactly the four
 * POLY_G4 vertex-colour offsets, in vertex order 0, 1, 2, 3.
 */
export const BATTLE_HUD_VERTEX_COLOUR_OFFSETS: readonly number[] =
    Object.freeze([0x04, 0x0c, 0x14, 0x1c]);
/**
 * The four words each branch copies into the 16-byte block at $sp+0xb0. The
 * healthy branch (.L0x8009372c-.L0x80093788) stores its first word at $sp+0xb0 and
 * $sp+0xb8 and its second at $sp+0xb4 and $sp+0xbc; the low branch
 * (.L0x8009378c-.L0x800937dc) stores the same way. So each branch paints a ramp
 * ACROSS the bar with one colour on both left-hand vertices and the other on both
 * right-hand ones — the first word on vertices 0 and 2, the second on 1 and 3.
 */
export const BATTLE_HUD_GRADIENT_STEP = 4;
export function battleHudGradientWord(base: number, index: number): number {
    return BATTLE_HUD_GRADIENT_WORDS[
        (base - BATTLE_HUD_GRADIENT_HEALTHY) / BATTLE_HUD_GRADIENT_STEP + index] as number;
}
/** 0x800a3490, 0x800a3494, 0x800a3498, 0x800a349c as the original stores them. */
export const BATTLE_HUD_GRADIENT_WORDS = Object.freeze([
    0x00287100, // healthy ramp, vertices 0 and 2 (the left column of the player's bar): #007128
    0x003ec800, // healthy ramp, vertices 1 and 3 (the right column): #00c83e
    0x001637b3, // low ramp, vertices 0 and 2: #b33716
    0x000d37ff, // low ramp, vertices 1 and 3: #ff370d
]);

/**
 * One vertex colour word as R, G, B. The PS1 is little-endian and a vertex colour
 * runs R, G, B from the lowest address up, so the red byte is the word's LOW byte:
 * 0x00287100 is R 0x00, G 0x71, B 0x28 — #007128.
 */
export function battleHudGradientRgb(base: number, index: number): readonly [number, number, number] {
    const word = battleHudGradientWord(base, index);
    return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff];
}

/** The four vertex colours the quad is drawn with, in vertex order 0..3. */
export function battleHudBarVertexWords(shownHp: number, maxHp: number): number[] {
    const table = battleHudHpGradient(shownHp, maxHp);
    return [0, 1, 2, 3].map((v) => battleHudGradientWord(table, v & 1) >>> 0);
}

/** The same four vertex colours as R, G, B triples, in vertex order 0..3. */
export function battleHudBarVertexRgb(shownHp: number, maxHp: number): [number, number, number][] {
    const table = battleHudHpGradient(shownHp, maxHp);
    return [0, 1, 2, 3].map((v) => [...battleHudGradientRgb(table, v & 1)]);
}

// ------------------------------------------------------------- number widgets
/** .L0x800935cc-.L0x800935d8: `F0x8001ae38(0x1005, 3, 0x10b, 0x1a)` — the shown HP. */
export const BATTLE_HUD_NUMBER_SHOWN = { x: 0x10b, y: 0x1a } as const;
/** .L0x80093628-.L0x80093634: `F0x8001ae38(0x1005, 3, 0x12e, 0x1a)` — the maximum. */
export const BATTLE_HUD_NUMBER_MAX = { x: 0x12e, y: 0x1a } as const;
/** .L0x800935d0 / .L0x8009362c: the `3` argument — the number kind. */
export const BATTLE_HUD_NUMBER_KIND = 3;
/** .L0x800935e0 / .L0x80093638: the built widget's slot in the HUD object. */
export const BATTLE_HUD_SLOT_SHOWN = 0x10;
export const BATTLE_HUD_SLOT_MAX = 0x0c;
/** .L0x800935f0 / .L0x80093660: `lw $v0, 0x118($a0)` — set the value. */
export const BATTLE_HUD_NUMBER_SET = 0x118;
/** .L0x80093608 / .L0x80093678: `lw $v0, 0x148($a0)` — reveal it. */
export const BATTLE_HUD_NUMBER_SHOW = 0x148;
/** .L0x800935ec: `lw $a2, 0x60($t1)` — the eased HP the bar is drawing. */
export const BATTLE_HUD_DISPLAYED_HP = 0x60;

/**
 * .L0x80093568-.L0x8009359c — the two plate pictures the plate is built out of,
 * drawn before anything else in the routine: cel 0 (the enemy's) at (8, 15) and cel 1
 * (the player's) at (161, 15). The pack is the one F0x800934f0 resolved on entry
 * (`.L0x800934f0 lw $v0, 0x4f5c($v0)` over `lui $a0, 0x455`), kept in $s8.
 */
export const BATTLE_HUD_PLATE_POSITIONS: readonly { cel: number; x: number; y: number }[] =
    Object.freeze([
        Object.freeze({ cel: 0x00, x: 0x08, y: 0x0f }),
        Object.freeze({ cel: 0x01, x: 0xa1, y: 0x0f }),
    ]);

export function battleHudDrawPlateFrames(host: BattleHudHost): BattleHudPlate[] {
    const pack = host.packResolve(BATTLE_HUD_PACK);
    const drawn: BattleHudPlate[] = [];
    for (const p of BATTLE_HUD_PLATE_POSITIONS) {
        host.drawSprite(pack, p.cel, p.x, p.y);
        drawn.push({ pack, cel: p.cel, x: p.x, y: p.y });
    }
    return drawn;
}

export interface BattleHudPlate {
    pack: number;
    cel: number;
    x: number;
    y: number;
}

// -------------------------------------------------------------------- hosts
export interface BattleHudMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface BattleHudHost {
    /** `[0x80044F5C](handle)`: resolve the battle chrome pack. */
    packResolve(handle: number): number;
    /** ctx+0x94(pack, cel, x, y): the sprite draw F0x800934f0 calls through $sp+0x94. */
    drawSprite(pack: number, cel: number, x: number, y: number): void;
    /**
     * `[0x800a4550](layer, 1, quad, &block)` — F0x8009e950 into F0x8009e77c. `words`
     * is the four words the routine copied into its 16-byte block: the four vertex
     * colours of the POLY_G4 it is drawing, at prim+0x4, +0xc, +0x14 and +0x1c.
     */
    drawQuad(quad: number, words: number[]): void;
    /** F0x8001AE38(target, kind, x, y): build a text element. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** element+slot(args): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** `[0x8004df98]()` — the monotonic frame tick the gauge's four-phase cycle reads. */
    tick(): number;
    /**
     * The gauge's combatant index. `.L0x80093850 jalr $v0` calls
     * `[0x8004b44c]([0x800a4468])` — the active party slot through the accessor the
     * party records come from — and `.L0x80093874 move_ $s0, $v0`, sitting in that
     * call's DELAY slot (so it stores the value $v0 already held, before the frame
     * cel's own sprite draw runs), takes its return value. `.L0x80093880 sll $s0, 0x1`
     * doubles it, `.L0x80093884 addu $s0, 0x80042b1c` adds the table base and
     * `.L0x80093888 lhu $v0, 0x58($s0)` reads that entry: the eight-entry u16 Blast
     * gauge array at 0x80042b74, indexed by combatant
     * (docs/research/battle/battle-ram-layout.md:113). The oracle's stub returns 0.
     */
    gaugeSlotIndex(): number;
    /**
     * `[0x80044f4c]([0x8005cca8] + bank)` — the base of one text family, the bank the
     * enemy name and the separator come out of.
     */
    resourceBase(id: number): number;
    /**
     * `[0x8004b44c]([0x800a4468])` — the roster SLOT the active party member is stored
     * in, which is the index `0x8004949c + slot*0x3dc` is built from. The ledger calls
     * this the party-record resolver (bank 0x60 / charisma claim); the oracle's stub
     * returns 0.
     */
    rosterSlot(activePartyIndex: number): number;
    /**
     * `[0x800a37fc](enemyId)` — the enemy's 70-byte stat record (resource `0x1cf`,
     * `F0x8009b8d0`), or 0 when the id is not in the table. The plate's enemy name is
     * bank `0x4e` line `record + 0x06`.
     */
    enemyStatsBlock(enemyId: number): number;
}

/**
 * .L0x80093950-.L0x80093a44 — the party status markers, both sides, three slots each.
 *
 * The loop runs two nested loops. The outer one walks the sides ($s2 = 0, 1) with a
 * halfword cursor into the x table ($s4 += 6) and a record base ($s3 += 0x60); the
 * inner one walks the three member slots ($s0). A slot is skipped when the side
 * marker halfword at 0x800a4536 is 4 or more, the index is above zero and the side is
 * the enemy — `bgtz $s2, .L0x80093a44` leaves the whole routine, so a plain fight
 * draws one enemy marker and up to three player ones.
 *
 * A slot with nothing in its record (+0x00 clear) draws nothing. Otherwise the cel
 * state is 3 while the ailment byte (+0x1c) is set, else 2 when the member's HP
 * (+0x08) is 0, else 1 when that HP differs from the maximum (+0x06), else 0; and the
 * drawn cel is `state + 0x0c` when the slot is the side's active one (the word at
 * 0x800a4468 + side*4) and `state + 0x3c` otherwise, at the slot's own x and y 0x30.
 *
 * The oracle compares this against the original's ordered draws, so the state rule,
 * the active-slot test and the x table are all pinned by the original rather than by
 * this comment.
 */
export function battleHudDrawPartyPips(mem: BattleHudMemory, host: BattleHudHost): BattleHudPip[] {
    const pack = host.packResolve(BATTLE_HUD_PACK);
    const mode = mem.read16(BATTLE_HUD_SIDE_MODE) | 0;
    const drawn: BattleHudPip[] = [];
    let sideRecord = 0;
    let sideHalf = 0;
    for (let side = 0; side < BATTLE_HUD_PIP_SIDES; side++) {
        for (let index = 0; index < BATTLE_HUD_PIP_COUNT; index++) {
            // .L0x80093964-.L0x80093978: only a mode of 4+ skips, and only the
            // enemy side's later members — which leaves the routine entirely.
            if (mode >= BATTLE_HUD_SIDE_MODE_DRAW_ALL && index > 0 && side > 0) return drawn;
            const record = BATTLE_HUD_RECORDS + sideRecord + index * BATTLE_HUD_RECORD_STRIDE;
            if ((mem.read16(record + BATTLE_HUD_RECORD_PRESENT) | 0) === 0) continue;
            const state = battleHudPipState(mem, record);
            const active = (mem.read32(BATTLE_HUD_ACTIVE_SLOT + side * 4) | 0) === index;
            const cel = state + (active ? BATTLE_HUD_PIP_CEL_ACTIVE : BATTLE_HUD_PIP_CEL_INACTIVE);
            const x = mem.read16(
                BATTLE_HUD_PIP_X + (sideHalf + index) * BATTLE_HUD_PIP_X_STRIDE) | 0;
            host.drawSprite(pack, cel, x, BATTLE_HUD_PIP_Y);
            drawn.push({ side, index, cel, x, y: BATTLE_HUD_PIP_Y, state, active });
        }
        sideHalf += BATTLE_HUD_PIP_SIDE_STRIDE;
        sideRecord += BATTLE_HUD_SIDE_STRIDE;
    }
    return drawn;
}

/** .L0x800939a0-.L0x800939cc — the four-way marker state test. */
export function battleHudPipState(mem: BattleHudMemory, record: number): number {
    if ((mem.read8(record + BATTLE_HUD_RECORD_AILMENT) & 0xff) !== 0) {
        return BATTLE_HUD_PIP_STATE_AFFLICTED;
    }
    const hp = mem.read16(record + BATTLE_HUD_RECORD_HP) | 0;
    if (hp === 0) return BATTLE_HUD_PIP_STATE_DOWN;
    return hp !== (mem.read16(record + BATTLE_HUD_RECORD_MAX_HP) | 0)
        ? BATTLE_HUD_PIP_STATE_HURT : BATTLE_HUD_PIP_STATE_FULL;
}

export interface BattleHudPip {
    side: number;
    index: number;
    cel: number;
    x: number;
    y: number;
    state: number;
    active: boolean;
}

/**
 * .L0x800935cc-.L0x80093684 — the two HP numbers on the player's plate: the eased HP
 * the bar is showing at (267, 26) and the roster partner's maximum at (302, 26).
 * Each element is built once (`bnez $v1, .L0x800935e4`), then fed with
 * `+0x118(element, 0, value)` and revealed with `+0x148(element, 1)`.
 *
 * `hud` is the object at $sp[0xe8] whose +0x60 holds the eased HP, `arg1` the HUD's
 * widget block whose +0x10 and +0x0c hold the two elements, and `record` the active
 * party member's combatant record.
 */
export function battleHudHpNumberRows(
    mem: BattleHudMemory,
    hud: number,
    arg1: number,
    record: number,
    host: BattleHudHost,
): number[] {
    let shown = mem.read32(arg1 + BATTLE_HUD_SLOT_SHOWN) >>> 0;
    if (shown === 0) {
        shown = host.createTextElement(
            BATTLE_HUD_LAYER, BATTLE_HUD_NUMBER_KIND,
            BATTLE_HUD_NUMBER_SHOWN.x, BATTLE_HUD_NUMBER_SHOWN.y) >>> 0;
        mem.write32(arg1 + BATTLE_HUD_SLOT_SHOWN, shown);
    }
    const shownHp = mem.read32(hud + BATTLE_HUD_DISPLAYED_HP) | 0;
    host.callMethod(shown, BATTLE_HUD_NUMBER_SET, [0, shownHp]);
    host.callMethod(shown, BATTLE_HUD_NUMBER_SHOW, [1]);
    let max = mem.read32(arg1 + BATTLE_HUD_SLOT_MAX) >>> 0;
    if (max === 0) {
        max = host.createTextElement(
            BATTLE_HUD_LAYER, BATTLE_HUD_NUMBER_KIND,
            BATTLE_HUD_NUMBER_MAX.x, BATTLE_HUD_NUMBER_MAX.y) >>> 0;
        mem.write32(arg1 + BATTLE_HUD_SLOT_MAX, max);
    }
    const maxHp = mem.read16(record + BATTLE_HUD_RECORD_MAX_HP) | 0;
    host.callMethod(max, BATTLE_HUD_NUMBER_SET, [0, maxHp]);
    host.callMethod(max, BATTLE_HUD_NUMBER_SHOW, [1]);
    return [shownHp, maxHp];
}

/** .L0x800935cc / .L0x80093628: the `0x1005` draw layer every element is built on. */
export const BATTLE_HUD_LAYER = 0x1005;

/**
 * .L0x800936e0-.L0x80093710 — write the fill quad's moving edge for one side.
 * The player's edge grows right from 175, the enemy's shrinks left from 143.
 */
export function battleHudHpBarFill(mem: BattleHudMemory, side: number, length: number): number {
    const base = side === 0 ? BATTLE_HUD_HP_QUAD_PLAYER : BATTLE_HUD_HP_QUAD_ENEMY;
    const grow = side === 0;
    const first = mem.read16(base + BATTLE_HUD_HP_EDGE_OFFSET) | 0;
    const second = mem.read16(base + BATTLE_HUD_HP_EDGE_OFFSET + BATTLE_HUD_HP_EDGE_STRIDE) | 0;
    const near = grow ? first + length : first - length;
    const far = grow ? second + length : second - length;
    mem.write16(base + BATTLE_HUD_HP_MOVING_OFFSET, near & 0xffff);
    mem.write16(base + BATTLE_HUD_HP_MOVING_OFFSET + BATTLE_HUD_HP_MOVING_STRIDE, far & 0xffff);
    return near;
}

/**
 * .L0x80093688-.L0x80093814 — one fighter's whole bar block: the length, the quad's
 * moving edge and the four vertex colours the quad service is handed.
 * `side` is 0 for the player (the right-hand edge moves left) and 1 for the enemy
 * (its left-hand edge moves right); `.L0x800936d8 bnez $s3` picks between the two.
 *
 * The four colours are the branch's first word on vertices 0 and 2 and its second
 * word on vertices 1 and 3 (.L0x80093740-.L0x80093780 and .L0x80093798-.L0x800937d8
 * store word 0 at $sp+0xb0 and $sp+0xb8, word 1 at $sp+0xb4 and $sp+0xbc).
 */
export function battleHudHpBar(
    mem: BattleHudMemory,
    host: BattleHudHost,
    side: number,
    shownHp: number,
    maxHp: number,
): BattleHudBar {
    const length = battleHudHpBarLength(shownHp, maxHp);
    battleHudHpBarFill(mem, side, length);
    const gradient = battleHudHpGradient(shownHp, maxHp);
    const words = battleHudBarVertexWords(shownHp, maxHp);
    host.drawQuad(side === 0 ? BATTLE_HUD_HP_QUAD_PLAYER : BATTLE_HUD_HP_QUAD_ENEMY, words);
    return { side, length, gradient, words };
}

export interface BattleHudBar {
    side: number;
    /** 128ths of the full 128-pixel bar. */
    length: number;
    /** The gradient table the quarter-HP test selected. */
    gradient: number;
    /** The four vertex colours copied into the block the quad service reads. */
    words: number[];
}

// --------------------------------------------------------------- DV / Blast gauge
/**
 * .L0x80093878-.L0x80093888 — `lui $v0, 0x8004 / addiu $v0, 0x2b1c`, then `sll $s0, 0x1`
 * and `addu $s0, $v0`, so the gauge is the halfword at 0x80042b74 + 2 * (the combatant
 * index `[0x8004b44c]` returned, see `gaugeSlotIndex`). 0x80042b74 is the eight-entry
 * per-combatant Blast gauge (docs/research/battle/battle-ram-layout.md:113).
 */
export const BATTLE_HUD_DV_GAUGE_TABLE = 0x80042b1c;
/** .L0x80093880: `sll $s0, 0x1` — the index stride is two bytes. */
export const BATTLE_HUD_DV_GAUGE_STRIDE = 2;
/** .L0x80093888: `lhu $v0, 0x58($s0)` — the gauge field inside each entry. */
export const BATTLE_HUD_DV_GAUGE_OFFSET = 0x58;
/** .L0x800938b8: `addiu $a2, $t0, 0x34a0` — the black quad the gauge's trough uses. */
export const BATTLE_HUD_DV_QUAD = 0x800a34a0;
/** .L0x800938c0: `addiu $a3, 0x34b0` — its four vertex colours. */
export const BATTLE_HUD_DV_QUAD_BLOCK = 0x800a34b0;
/**
 * .L0x800a34a0 as the overlay ships it: eight halfwords, four vertices in GPU order
 * (x, y) — (265,62) (305,62) (265,70) (305,70), i.e. the 40x8 trough under the gauge.
 * The routine overwrites vertices 0 and 2, which are the left column.
 */
export const BATTLE_HUD_DV_QUAD_HALFWORDS: readonly number[] =
    Object.freeze([265, 62, 305, 62, 265, 70, 305, 70]);
/** .L0x800a34b0: four zero words, so the trough is black on every vertex. */
export const BATTLE_HUD_DV_QUAD_WORDS: readonly number[] = Object.freeze([0, 0, 0, 0]);
/** .L0x800938dc: `sh $v0, 0x34a0($t0)` — vertex 0's x. */
export const BATTLE_HUD_DV_QUAD_LEFT_OFFSET = 0x00;
/** .L0x800938e4: `sh $v0, 0x8($a2)` — vertex 2's x, in the branch's delay slot. */
export const BATTLE_HUD_DV_QUAD_LEFT_STRIDE = 0x08;
/** .L0x8009385c-.L0x80093864 and .L0x80093924-.L0x8009392c: both frame cels sit here. */
export const BATTLE_HUD_DV_FRAME_X = 0x104;
export const BATTLE_HUD_DV_FRAME_Y = 0x3d;
/** .L0x8009390c: `li $a2, 0x109` — the fill's left edge, where the trough starts. */
export const BATTLE_HUD_DV_X = 0x109;
/** .L0x8009391c: `li $a3, 0x3e` — the fill's top row, the trough's top row. */
export const BATTLE_HUD_DV_Y = 0x3e;
/** .L0x80093898 / .L0x800938f0: `slti $v0, $a0, 0x3e8` — the full gauge. */
export const BATTLE_HUD_DV_FULL = 1000;
/** .L0x8009385c: `li $a1, 0x1e` — the frame drawn before the trough. */
export const BATTLE_HUD_DV_FRAME_CEL_OUTER = 0x1e;
/** .L0x80093924: `li $a1, 0xb` — the frame drawn after the fill. */
export const BATTLE_HUD_DV_FRAME_CEL_INNER = 0x0b;
/** .L0x80093900: `addiu $a1, $s1, 0x33` — the fill while the gauge is below full. */
export const BATTLE_HUD_DV_FILL_CEL_FILLING = 0x33;
/** .L0x80093908: `addiu $a1, $s1, 0x37` — the fill at the full gauge. */
export const BATTLE_HUD_DV_FILL_CEL_FULL = 0x37;
/** .L0x80093854: `andi $s1, $v1, 0x3` — the phase keeps two bits of the shifted tick. */
export const BATTLE_HUD_DV_PHASE_MASK = 3;
/**
 * .L0x800938a4/.L0x800938a8 — `lui $v0, 0x51eb / ori $v0, 0x851f` is the fixed-point
 * reciprocal the left edge is computed with, and .L0x80093850-... divides by 25:
 * 0x51eb851f / 2^35 is 0.0400000000007, and `.L0x800938cc sra $v0, $t1, 0x3` shifts the
 * high word down by three with .L0x800938d0 `subu $v0, $v1` against `sra $v1, 0x1f`
 * (the dividend's sign), which is a division truncated toward zero.
 */
export const BATTLE_HUD_DV_GAUGE_DIVISOR = 25;

/** .L0x80093820-.L0x8009382c and .L0x8009383c: `lui $v0,0x8005 / lw $v0, -0x2068`. */
export const BATTLE_HUD_DV_TICK_PTR = 0x8004df98;
/** .L0x80093848: `lui $v0, 0x8005 / lw $v0, -0x4bb4` — called, result discarded. */
export const BATTLE_HUD_DV_SPECIES_PTR = 0x8004b44c;

/**
 * .L0x8009383c and .L0x80093854 — the four-phase cycle: the tick is shifted right by
 * two and the low two bits kept, so the cel steps once every four frames and the
 * gauge's own value never changes the phase.
 */
export function battleHudDvPhase(tick: number): number {
    return ((tick | 0) >> 2) & BATTLE_HUD_DV_PHASE_MASK;
}

/** .L0x800938a0-.L0x800938d8 — `x = 265 + trunc(gauge / 25)`, a 0..40 pixel left edge. */
export function battleHudDvLeftEdge(gauge: number): number {
    const g = Math.trunc(Number(gauge) || 0);
    return BATTLE_HUD_DV_X + Math.trunc(g / BATTLE_HUD_DV_GAUGE_DIVISOR);
}

/**
 * .L0x800938f0-.L0x80093908 — the fill cel: base 0x33 below the full gauge and 0x37 at
 * it, plus the phase.
 */
export function battleHudDvFillCel(gauge: number, phase: number): number {
    const full = (Math.trunc(Number(gauge) || 0)) >= BATTLE_HUD_DV_FULL;
    return (full ? BATTLE_HUD_DV_FILL_CEL_FULL : BATTLE_HUD_DV_FILL_CEL_FILLING) + (phase | 0);
}

/**
 * .L0x800938e8-.L0x800938f4 — the black trough is submitted only while the gauge is
 * below 1000; at 1000 and above the branch goes straight to the full fill cel.
 */
export function battleHudDvShowsBacking(gauge: number): boolean {
    return (Math.trunc(Number(gauge) || 0)) < BATTLE_HUD_DV_FULL;
}

/**
 * The eight halfwords the quad holds after the routine's write: the shipped trough with
 * its left column moved to 265 + trunc(gauge/25), so the black rectangle covers exactly
 * the unfilled remainder.
 */
export function battleHudDvQuadHalwords(gauge: number): number[] {
    const left = battleHudDvLeftEdge(gauge);
    const out = [...BATTLE_HUD_DV_QUAD_HALFWORDS] as number[];
    out[BATTLE_HUD_DV_QUAD_LEFT_OFFSET / 2] = left;
    out[BATTLE_HUD_DV_QUAD_LEFT_OFFSET / 2 + BATTLE_HUD_DV_QUAD_LEFT_STRIDE / 2] = left;
    return out;
}

/**
 * .L0x80093820-.L0x8009392c — the DV/Blast gauge, four draw calls in this order.
 *
 *   1. the outer frame, cel 0x1e at (260, 61);
 *   2. below a full gauge, the black trough on the quad at 0x800a34a0 with its left
 *      column written to 265 + trunc(gauge/25) and four zero vertex colours;
 *   3. the fill, cel 0x33 + phase while filling or 0x37 + phase at full, at (265, 62);
 *   4. the inner frame, cel 0x0b at (260, 61), over the fill.
 *
 * The combatant index that selects the gauge entry comes from
 * `[0x8004b44c]([0x800a4468])` (see `gaugeSlotIndex`).
 */
export function battleHudDvGauge(mem: BattleHudMemory, host: BattleHudHost): BattleHudDvFrame {
    const pack = host.packResolve(BATTLE_HUD_PACK);
    const phase = battleHudDvPhase(host.tick());
    host.drawSprite(pack, BATTLE_HUD_DV_FRAME_CEL_OUTER,
        BATTLE_HUD_DV_FRAME_X, BATTLE_HUD_DV_FRAME_Y);
    const slot = Math.trunc(host.gaugeSlotIndex()) || 0;
    const gauge = mem.read16(
        BATTLE_HUD_DV_GAUGE_TABLE + slot * BATTLE_HUD_DV_GAUGE_STRIDE
        + BATTLE_HUD_DV_GAUGE_OFFSET) & 0xffff;
    const backing = battleHudDvShowsBacking(gauge);
    const halfwords = [...BATTLE_HUD_DV_QUAD_HALFWORDS] as number[];
    if (backing) {
        const left = battleHudDvLeftEdge(gauge);
        mem.write16(BATTLE_HUD_DV_QUAD + BATTLE_HUD_DV_QUAD_LEFT_OFFSET, left & 0xffff);
        mem.write16(BATTLE_HUD_DV_QUAD + BATTLE_HUD_DV_QUAD_LEFT_STRIDE, left & 0xffff);
        halfwords[BATTLE_HUD_DV_QUAD_LEFT_OFFSET / 2] = left;
        halfwords[BATTLE_HUD_DV_QUAD_LEFT_OFFSET / 2 + BATTLE_HUD_DV_QUAD_LEFT_STRIDE / 2] = left;
        host.drawQuad(BATTLE_HUD_DV_QUAD, [...BATTLE_HUD_DV_QUAD_WORDS]);
    }
    const fillCel = battleHudDvFillCel(gauge, phase);
    host.drawSprite(pack, fillCel, BATTLE_HUD_DV_X, BATTLE_HUD_DV_Y);
    host.drawSprite(pack, BATTLE_HUD_DV_FRAME_CEL_INNER,
        BATTLE_HUD_DV_FRAME_X, BATTLE_HUD_DV_FRAME_Y);
    return {
        pack, gauge, slot, phase, backing, halfwords,
        words: [...BATTLE_HUD_DV_QUAD_WORDS],
        outerCel: BATTLE_HUD_DV_FRAME_CEL_OUTER, fillCel,
        innerCel: BATTLE_HUD_DV_FRAME_CEL_INNER,
    };
}

export interface BattleHudDvFrame {
    pack: number;
    /** The gauge halfword the routine read. */
    gauge: number;
    /** The combatant index `[0x8004b44c]` returned for the active party slot. */
    slot: number;
    /** `(tick >> 2) & 3`. */
    phase: number;
    /** false at the full gauge, where the black trough is not submitted. */
    backing: boolean;
    /** The trough quad's eight halfwords after the write. */
    halfwords: number[];
    /** The trough's four vertex colours: four zero words. */
    words: number[];
    outerCel: number;
    fillCel: number;
    innerCel: number;
}

// ------------------------------------------------------------------ name plates
//
// FIGHTSTG_F0x80093364 builds the two name elements on the plate. The draw calls it
// every frame (`.L0x800935a4 jal FIGHTSTG_F0x80093364`), and each side rebuilds only
// when the side's ACTIVE SLOT word has moved since the last call
// (`.L0x80093390 beq` and `.L0x80093414 beq`); the two gate words are written from
// the same two active-slot cells at the end of the routine (`.L0x800934bc`-
// `.L0x800934c8`), so the second side's cache lands even when only the first changed.

/** .L0x80093388 / .L0x8009340c: the two "rebuild because the active slot moved" caches. */
export const BATTLE_HUD_NAME_GATE_PLAYER = 0x50;
export const BATTLE_HUD_NAME_GATE_ENEMY = 0x54;
/** .L0x80093398 / .L0x80093448: the widget block's two name slots. */
export const BATTLE_HUD_SLOT_NAME_PLAYER = 0x00;
export const BATTLE_HUD_SLOT_NAME_ENEMY = 0x04;
/** .L0x80093aec: the widget block's third slot, the slash element. */
export const BATTLE_HUD_SLOT_SEPARATOR = 0x08;
/** .L0x800933a8 / .L0x8009345c: `li $a1, 0x1` — a name is a kind 1 text element. */
export const BATTLE_HUD_NAME_KIND = 1;
/** .L0x800933ac / .L0x800933b0: `F0x8001ae38(0x1005, 1, 0xae, 0x15)` = (174, 21). */
export const BATTLE_HUD_NAME_PLAYER = { x: 0xae, y: 0x15 } as const;
/** .L0x80093460 / .L0x80093468: `F0x8001ae38(0x1005, 1, 0x11, 0x15)` = (17, 21). */
export const BATTLE_HUD_NAME_ENEMY = { x: 0x11, y: 0x15 } as const;
/**
 * .L0x800933f4 / .L0x8009349c / .L0x80093b10 — `lw $v0, 0x114($a0)`, the setter both
 * names and the separator use. It is F0x800194e8, which tail-calls F0x800196e4 with the
 * line forced to 0 (ledger claim UI-WIDGETCLASS-AE38-SETTERS-001): with a non-negative
 * index the first argument is a text-bank base and the string is that bank's line; with
 * -1 the first argument is a literal NUL-terminated string pointer.
 */
export const BATTLE_HUD_SET_STRING = 0x114;
/** The literal-string index F0x800196e4 recognises. */
export const BATTLE_HUD_SET_STRING_LITERAL = -1;
/**
 * .L0x8009347c / .L0x80093af0 — `lui $v0, 0x8006 / lw $a0, -0x3358($v0)`, the word
 * every bank id is added to before it reaches the service.
 */
export const BATTLE_HUD_STRING_BASE = 0x8005cca8;
/** .L0x80093480 / .L0x80093af8: `lw $v0, 0x4f4c($v1)` over `lui $v1, 0x8004`. */
export const BATTLE_HUD_TEXT_SERVICE = 0x80044f4c;
/**
 * .L0x800933c0-.L0x800933d4 — `lui $s0, 0x8005 / addiu $s0, -0x72cc` gives 0x80048d34
 * and `lw $v0, 0x2718($s0)` reads the roster-slot resolver out of it, which is
 * `[0x8004b44c]`; the `jalr`'s delay slot `addiu $s0, 0x768` then raises that same
 * 0x80048d34 to **0x8004949c**, and the species word it returns is scaled by 988
 * (`sll 0x5 / subu / sll 0x3 / subu / sll 0x2`).
 */
export const BATTLE_HUD_ROSTER_RESOLVER = 0x8004b44c;
/** .L0x800933d4 + .L0x800933e0..e8: `0x80048d34 + 0x768` — the persistent roster. */
export const BATTLE_HUD_ROSTER = 0x8004949c;
/** .L0x800933d8-.L0x800933e8 — the index stride, 988 = 0x3dc bytes. */
export const BATTLE_HUD_ROSTER_STRIDE = 0x3dc;
/**
 * .L0x80093418-.L0x80093430 — `lui $v1, 0x8004 / addiu $v1, 0x2b1c` with the active
 * enemy's slot scaled by 12 (`sll 0x1 / addu / sll 0x2`), then `lw $a0, 0x18($v0)`:
 * the enemy's id out of the per-combatant descriptor the battle setup fills.
 */
export const BATTLE_HUD_ENEMY_ID_TABLE = 0x80042b1c;
export const BATTLE_HUD_ENEMY_ID_OFFSET = 0x18;
export const BATTLE_HUD_ENEMY_ID_STRIDE = 12;
/** .L0x80093456 — `lw $v0, 0x37fc($v0)` over `lui $v0, 0x800a`: the enemy-id resolver. */
export const BATTLE_HUD_ENEMY_STATS_RESOLVER = 0x800a37fc;
/** .L0x80093498: `lh $a2, 0x6($s0)` — the name id inside the enemy's stat record. */
export const BATTLE_HUD_ENEMY_NAME_ID = 0x06;
/** .L0x8009348c: `addiu $a0, 0x4e` — the Digimon-name bank. */
export const BATTLE_HUD_BANK_ENEMY_NAME = 0x4e;
/** .L0x80093b04: `addiu $a0, 0x7f` — the bank that also holds the battle words. */
export const BATTLE_HUD_BANK_SEPARATOR = 0x7f;
/** .L0x80093b1c: `li $a2, 0x10` — line 16, which is the single glyph `/`. */
export const BATTLE_HUD_SEPARATOR_INDEX = 0x10;
/** .L0x80093ad8-.L0x80093ae4: `F0x8001ae38(0x1005, 3, 0x10c, 0x1a)` = (268, 26). */
export const BATTLE_HUD_SEPARATOR = { x: 0x10c, y: 0x1a } as const;
/** .L0x80093ad6: `li $a1, 0x3` — the separator is built as a kind 3 element. */
export const BATTLE_HUD_SEPARATOR_KIND = 3;
/**
 * .L0x80093ac8 / .L0x80093ad0 — `li $v0, -0x1` stored into both gates immediately
 * before the name builder runs, so the build that follows always rebuilds both.
 */
export const BATTLE_HUD_GATE_RESET = 0xffffffff;

/** `[0x8005cca8] + bank` through `[0x80044f4c]` — the text-bank base for one family. */
export function battleHudTextBank(mem: BattleHudMemory, bank: number, host: BattleHudHost): number {
    return host.resourceBase(((mem.read32(BATTLE_HUD_STRING_BASE) | 0) + (bank | 0)) | 0);
}

export interface BattleHudNames {
    player: BattleHudNameElement | null;
    enemy: BattleHudNameElement | null;
    /** The two gate words after the routine's closing store loop. */
    playerGate: number;
    enemyGate: number;
}

export interface BattleHudNameElement {
    element: number;
    /** true when this call rebuilt the text rather than reusing the cached slot. */
    rebuilt: boolean;
    /** The first argument the setter was given: a bank base, or a roster record. */
    source: number;
    /** The second argument: the bank line, or -1 for a literal string. */
    index: number;
}

/**
 * FIGHTSTG_F0x80093364 (`hud`, `widget`, `host`) — the two name elements, rebuilt only
 * when the side's active slot has moved.
 *
 * The player's name is the roster record's own NUL-terminated string: the routine
 * resolves the active party slot through `[0x8004b44c]`, addresses
 * `0x8004949c + slot*0x3dc` and calls the setter with that pointer and **-1**, which
 * the setter installs as a literal — that is the nickname, or whatever the roster holds
 * when the Digimon has not been renamed. The enemy's name is a bank line: the active
 * enemy's id comes out of the descriptor at `0x80042b34 + slot*12`, the id resolver
 * `[0x800a37fc]` returns the enemy's stat record, and its halfword at +0x06 is the
 * line index into bank `0x4e`.
 *
 * The enemy's ELEMENT is created before the stat record is null-tested
 * (`.L0x80093448 bnez` sits above `move_ $s0, $v0`, and `.L0x80093470 beqz $s0` below
 * the creation), so a null record leaves an element in the slot with no text.
 */
export function battleHudBuildNames(
    mem: BattleHudMemory,
    hud: number,
    widget: number,
    host: BattleHudHost,
): BattleHudNames {
    const out: BattleHudNames = { player: null, enemy: null, playerGate: 0, enemyGate: 0 };
    const activePlayer = mem.read32(BATTLE_HUD_ACTIVE_SLOT) | 0;
    if ((mem.read32(hud + BATTLE_HUD_NAME_GATE_PLAYER) | 0) !== activePlayer) {
        let element = mem.read32(widget + BATTLE_HUD_SLOT_NAME_PLAYER) >>> 0;
        if (element === 0) {
            element = host.createTextElement(BATTLE_HUD_LAYER, BATTLE_HUD_NAME_KIND,
                BATTLE_HUD_NAME_PLAYER.x, BATTLE_HUD_NAME_PLAYER.y) >>> 0;
            mem.write32(widget + BATTLE_HUD_SLOT_NAME_PLAYER, element);
        }
        const source = persistentRosterSlot(host.rosterSlot(activePlayer)) | 0;
        host.callMethod(element, BATTLE_HUD_SET_STRING,
            [source, BATTLE_HUD_SET_STRING_LITERAL]);
        out.player = { element, rebuilt: true, source, index: BATTLE_HUD_SET_STRING_LITERAL };
    }
    const activeEnemy = mem.read32(BATTLE_HUD_ACTIVE_SLOT + 4) | 0;
    if ((mem.read32(hud + BATTLE_HUD_NAME_GATE_ENEMY) | 0) !== activeEnemy) {
        const idAddr = BATTLE_HUD_ENEMY_ID_TABLE + BATTLE_HUD_ENEMY_ID_OFFSET
            + activeEnemy * BATTLE_HUD_ENEMY_ID_STRIDE;
        const stats = host.enemyStatsBlock(mem.read32(idAddr) | 0) >>> 0;
        let element = mem.read32(widget + BATTLE_HUD_SLOT_NAME_ENEMY) >>> 0;
        if (element === 0) {
            element = host.createTextElement(BATTLE_HUD_LAYER, BATTLE_HUD_NAME_KIND,
                BATTLE_HUD_NAME_ENEMY.x, BATTLE_HUD_NAME_ENEMY.y) >>> 0;
            mem.write32(widget + BATTLE_HUD_SLOT_NAME_ENEMY, element);
        }
        if (stats !== 0) {
            const bank = battleHudTextBank(mem, BATTLE_HUD_BANK_ENEMY_NAME, host);
            const index = mem.read16(stats + BATTLE_HUD_ENEMY_NAME_ID) | 0;
            host.callMethod(element, BATTLE_HUD_SET_STRING, [bank, index]);
            out.enemy = { element, rebuilt: true, source: bank, index };
        } else {
            out.enemy = { element, rebuilt: true, source: 0, index: 0 };
        }
    }
    // .L0x800934ac-.L0x800934d4: two iterations over 0x800a4468 and 0x800a446c, four
    // bytes apart, each landing in the gate 0x50 or 0x54 further along.
    mem.write32(hud + BATTLE_HUD_NAME_GATE_PLAYER, mem.read32(BATTLE_HUD_ACTIVE_SLOT) >>> 0);
    mem.write32(hud + BATTLE_HUD_NAME_GATE_ENEMY, mem.read32(BATTLE_HUD_ACTIVE_SLOT + 4) >>> 0);
    out.playerGate = mem.read32(hud + BATTLE_HUD_NAME_GATE_PLAYER) | 0;
    out.enemyGate = mem.read32(hud + BATTLE_HUD_NAME_GATE_ENEMY) | 0;
    return out;
}

/**
 * FIGHTSTG_F0x80093a74 mode 0 (`.L0x80093abc`-.L0x80093b1c`) — the plate's BUILD arm,
 * for the two names and the separator.
 *
 * The two gate words are set to -1 first, so the name builder that follows always
 * rebuilds both sides; then the separator element is created at (268, 26) with NO
 * existence test — the original overwrites the slot unconditionally — and its line 16
 * of bank `0x7f`, the single glyph `/`, is installed. It is the slash between the two
 * HP numbers.
 *
 * All three elements are on layer `0x1005`, the battle UI layer, whose origin is (0, 0)
 * (docs/research/battle/battle-decode-census.md:354), so an element's x and y are screen
 * positions. The two HP numbers are right-anchored on their own x and the separator is
 * not: a widget whose `+0x148` has been called with 1 measures its string and draws the
 * text ENDING at its x (docs/research/ui/stgtrain-decoded-2026-07-11.md:857-861), and the
 * per-frame draw calls `+0x148(element, 1)` on both numbers (`.L0x80093610`, `.L0x80093680`)
 * while the build arm never calls it on the separator, whose string never changes. So the
 * shown HP ends at 267, the slash starts at 268 and the maximum ends at 302.
 */
export function battleHudBuildSeparator(
    mem: BattleHudMemory,
    hud: number,
    widget: number,
    host: BattleHudHost,
): { names: BattleHudNames; element: number; bank: number; index: number } {
    mem.write32(hud + BATTLE_HUD_NAME_GATE_PLAYER, BATTLE_HUD_GATE_RESET);
    mem.write32(hud + BATTLE_HUD_NAME_GATE_ENEMY, BATTLE_HUD_GATE_RESET);
    const names = battleHudBuildNames(mem, hud, widget, host);
    const element = host.createTextElement(BATTLE_HUD_LAYER, BATTLE_HUD_SEPARATOR_KIND,
        BATTLE_HUD_SEPARATOR.x, BATTLE_HUD_SEPARATOR.y) >>> 0;
    mem.write32(widget + BATTLE_HUD_SLOT_SEPARATOR, element);
    const bank = battleHudTextBank(mem, BATTLE_HUD_BANK_SEPARATOR, host);
    host.callMethod(element, BATTLE_HUD_SET_STRING, [bank, BATTLE_HUD_SEPARATOR_INDEX]);
    return { names, element, bank, index: BATTLE_HUD_SEPARATOR_INDEX };
}
