// The one Digimon picture: the eight-row frame table the disc copies into every
// overlay, and the twelve-instruction loop that walks a row.
//
// The original has no shared module either. Each overlay that shows a partner
// standing on a pedestal pastes the same loop into its own draw routine; only the
// picture pack, the anchor, the pitch and the step cadence differ, and those stay
// with the screen. What is shared is the table and the walk, and both live here.
//
// DECODED (all read again from the shipped disassembly for this port):
//   pro/ststatus.s:10081-10089  the ×7 row stride and the word load, with
//                                `lui $a0,0x800a / lw -0x5098($a0)` = the table
//                                cell 0x8009AF68, whose pointer is 0x8009A9C0
//   pro/ststatus.s:10090-10095  `li $v0,-1` / `beq` / `slti $v0,$a1,0x7` /
//                                `sw $zr` — the end marker and the 7-word cap
//   pro/ststatus.s:10057-10062  `slti $v0,0xd` on `vsync - timer`: 13 frames
//   pro/stgdglab.s:8490-8503    the Lab's candidate picture: 12 frames, and the
//                                same cap test
//   pro/stgdglab.s:8520-8534    the Lab's party figures: 12 frames, and NO cap
//                                test — only the -1 marker restarts the row
// The eight rows, read out of the overlay's own data words
// (pro/ststatus.s:24396-24451, `.L0x00017d10`): seven words each, `-1` padding
// to seven, and row 8 is already different data, so the table is eight rows.
//
// WHAT THE ROW INDEX MEANS — settled 2026-10-03, ledger claim
// `digimon-picture-row-is-the-roster-slot-2026-10-03`. The row IS the ROSTER SLOT
// (0 Kotemon, 1 Kumamon, 2 Monmon, 3 Agumon, 4 Veemon, 5 Guilmon, 6 Renamon,
// 7 Patamon), which is also digimon.json id − 1. All four readers reach the same
// 0..7 number three different ways, and all three were read for this:
//
//   pause / STATUS cards and the fight report
//     `[0x80048D34]+0x2718` = F0x80016D94 (`exe/fns.s:7506-7516`):
//     `sltiu $v0,$a0,0x3` / `beqz` → −1 for a position of 3 or more, otherwise
//     `lw $v0,0x70($v1)` — the party position's word in the `u32[3]` at ctx+0x70.
//     That word is a roster slot: it is what the caller hands the stats producer
//     at ctx+0x2734 as its record index (`pro/ststatus.s:10074-10077` reads the
//     service into `$v0` and then does `sll $v1,$v0,3` / `subu $v1,$v0`, ×7, so
//     the return value IS the row), and F0x80016DC0 (`exe/fns.s:7520-7548`)
//     fills ctx+0x70 with the three roster slots of the chosen starter pack.
//   Digimon Lab tubes
//     `[0x80048D34]+0x2728` = F0x80016FD8 (`exe/fns.s:7672-7686`): the same
//     ctx+0x70 word, scaled by the 0x3DC record stride, read at record+0x760 and
//     `addiu $v0,-0x3` — the field F0x80016DC0 wrote as `slot+3`, so the result
//     is that same roster slot again. `pro/stgdglab.s:8318-8324` puts it straight
//     into the ×7 row stride and `bltz`s past the pedestal when it is negative.
//   memory card
//     `pro/stgmcard.s:882-893`: `lw $v0,($s0)` / `addiu $v0,-0x3` — the save
//     record's own starter byte (3..10) minus three, the SAME 0..7 ordinal
//     (docs/research/ui/stgmcard-decoded-2026-08-05.md §3: byte 3..10 = digimon
//     id 1..8).
//
// So `STARTER_PICTURE_ROW` below is not the walker's guess: it is the roster slot
// that the original asks for, keyed by the digimon.json id one higher.

/** Words per row, `-1` included: `sll $v1,$v0,3` + `subu` is ×7, then ×4 bytes. */
export const DIGIMON_PICTURE_ROW_WORDS = 7;
/** Rows in the table; row 8 is different data. */
export const DIGIMON_PICTURE_ROWS = 8;
/** The row's end marker, `li $v0,-0x1`. */
export const DIGIMON_PICTURE_END = -1;
/** The number of pictures the eight rows use: 29 cells, 0..28. */
export const DIGIMON_PICTURE_CLIPS = 29;

/**
 * EXTRA: the new partners (roster slots 8.., engine/dw3/roster.ts) have no row in the disc's
 * table, whose ninth row is already other data. Their pictures are numbered from this base,
 * 0x10 per slot (slot 8 = 0x400.., slot 9 = 0x410..), and walk this frame order; the browser
 * draws them from the partner's own picture sheet, or nothing while it has none.
 */
export const NEW_PARTNER_PICTURE_BASE = 0x400;
export const NEW_PARTNER_PICTURE_ROW: readonly number[] = [0, 1, 2, 1];
const FIRST_NEW_ROW = 8;
const LAST_NEW_ROW = 15;
const isNewPartnerRow = (row: number): boolean => row >= FIRST_NEW_ROW && row <= LAST_NEW_ROW;
/** A new partner's picture for `row` (its roster slot) at counter `counter`. */
export function newPartnerPicture(row: number, counter: number): number {
    const n = NEW_PARTNER_PICTURE_ROW.length;
    return NEW_PARTNER_PICTURE_BASE + (row - FIRST_NEW_ROW) * 0x10 + NEW_PARTNER_PICTURE_ROW[((counter % n) + n) % n]!;
}

/**
 * The table, in the overlay's own row order (`ststatus.s:24396`), byte-identical
 * to the copies at stgdglab 0x8008F4C4, stplnmet 0x80089A8C, stdgname 0x80087A90,
 * stgmcard 0x80088204, stfgtrep 0x8008905C and stcrddek 0x8008B6FC, and to the
 * `portrait_animation_clips` of web/assets/data/dri_tables.json. The stfgtrep copy
 * is in the overlay's DATA segment and is not in `exe/fns.s` or the disassembly;
 * `web/assets/data/report/tables.bin` (base 0x80086A88, shipped from the loaded
 * overlay image) holds it and `tests/digimon-picture-report.test.js` checks the two
 * are byte-identical, so the report cannot drift from this table.
 */
export const DIGIMON_PICTURE_TABLE: readonly (readonly number[])[] = [
    [7, 8, 9, 10, 9, 8, -1],
    [14, 15, 16, 15, -1, -1, -1],
    [11, 12, 13, 12, -1, -1, -1],
    [3, 4, 5, 6, 5, 4, -1],
    [25, 26, 27, 28, 27, 26, -1],
    [0, 1, 2, 1, -1, -1, -1],
    [17, 18, 19, 20, 19, 18, -1],
    [21, 22, 23, 24, 23, 22, -1],
];

/**
 * The row the ORIGINAL reaches for, keyed by the walker's starter id (web/party.js
 * `CHARID_TO_DIGID`: 1 Kotemon, 2 Kumamon, 3 Monmon, 4 Agumon, 5 Veemon, 6 Guilmon,
 * 7 Renamon, 8 Patamon). Decoded, not a guess: the row IS the roster slot, and
 * `engine/dw3/roster.ts` `rosterSlotDigimonId(slot)` is `slot + 1`, so the row is
 * the id minus one — see the header. Built from that rule rather than written out,
 * so this table and the roster table cannot disagree.
 */
export const STARTER_PICTURE_ROW: Readonly<Record<number, number | undefined>> = Object.freeze(
    Object.fromEntries(
        Array.from({ length: DIGIMON_PICTURE_ROWS }, (_unused, slot) => [slot + 1, slot]),
    ),
);

/** The picture row a digimon.json starter id names, or undefined for a non-starter. */
export function starterPictureRow(digimonId: number): number | undefined {
    return STARTER_PICTURE_ROW[digimonId];
}

/**
 * The picture row a ROSTER SLOT names. This is the decoded identity the four
 * original readers implement (`[0x80048D34]+0x2718`, `+0x2728`, the memory card's
 * stored byte less three): slot 0 is Kotemon's row, slot 7 Patamon's, and a slot
 * outside 0..7 — or the -1 the two services return for an empty pedestal — has no
 * row, which is why the Lab's sites guard with `bltz` and the pause screen does not.
 */
export function rosterSlotPictureRow(slot: number): number | undefined {
    return slot >= 0 && (slot < DIGIMON_PICTURE_ROWS || isNewPartnerRow(slot)) ? slot : undefined;
}

/** One row's picture numbers without the `-1` padding: the loop's own run. */
export function digimonPictureRow(row: number): number[] {
    if (isNewPartnerRow(row)) return NEW_PARTNER_PICTURE_ROW.map((_, i) => newPartnerPicture(row, i));
    const words = DIGIMON_PICTURE_TABLE[row];
    if (!words) return [];
    const out: number[] = [];
    for (const word of words) {
        if (word === DIGIMON_PICTURE_END) break;
        out.push(word);
    }
    return out;
}

/** One picture for `row` at `frame`, wrapping inside the row, or -1 past its end. */
export function digimonPictureClip(row: number, frame: number): number {
    const frames = digimonPictureRow(row);
    if (frames.length === 0) return DIGIMON_PICTURE_END;
    return frames[((frame % frames.length) + frames.length) % frames.length] ?? DIGIMON_PICTURE_END;
}

/** The cell, counter word and cadence memory the walk needs. */
export interface PictureFramesMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/**
 * One run of figures under one timer word. The pause screen has one (the three
 * cards, counters at +0x60 stride 4); the Lab's Switch screen has two under the
 * same timer — the highlighted candidate at +0xD8 and the party figures at +0xCC
 * stride 4 — and the two do not restart a row the same way.
 */
export interface PictureFramesGroup {
    /** The first subject's counter word; the original strides these by 4. */
    counterBase: number;
    /** How many counters, i.e. how many figures this group walks. */
    count: number;
    /**
     * The row of subject `index`, asked only once the cadence has elapsed, exactly
     * as the original asks its party map only then.
     */
    rowAt(index: number): number;
    /**
     * true where the original guards the row with `bltz` and leaves a subject
     * whose row is negative alone (both Lab sites); false at the pause screen,
     * which walks its cards whatever the party map holds and so draws whatever
     * word sits before the table when a card has no Digimon in it.
     */
    skipNegativeRow: boolean;
    /**
     * The counter value that starts the row again, or `undefined` where the original
     * has no cap and only the `-1` marker restarts it. Seven at the pause screen's
     * cards and the Lab's highlighted candidate (`slti $v0,$a1,0x7`), eight at the
     * fight report's picture (`((next < 8) == 0)`), undefined at the Lab's party
     * figures. All three are the original's own test, read per screen.
     */
    wrapAt?: number;
}

export interface PictureFramesOptions {
    mem: PictureFramesMemory;
    /**
     * The overlay's cell holding the table's pointer: the pause screen's
     * 0x8009AF68, the Lab's 0x8008FD68. Optional when `tableBase` is given.
     */
    tableCell?: number;
    /**
     * The table's OWN address, for the one reader that indexes it directly instead
     * of through a pointer cell: the fight report's `lui $v1,0x8009 / addiu $v1,
     * -0x6fa4` = 0x8008905C (`pro/stfgtrep.s:914-916`). It must not be given with
     * `tableCell`; the shared loop reads a cell only when there is one to read.
     */
    tableBase?: number;
    /** The object's cadence word (`slti $v0,0xd` on `vsync - timer`). */
    timer: number;
    /** Vsyncs per step: 13 in the pause overlay, 12 in the Lab's Switch screen. */
    cadence: number;
    /**
     * `[0x8004DE10+0x188]`: the current frame count. The original reads the cell
     * twice — once to test the cadence and once, after the test passes, to stamp
     * the timer — and this is called the same number of times.
     */
    frame(): number;
    /** The runs of figures, walked in this order under the one timer. */
    groups: readonly PictureFramesGroup[];
}

/**
 * Where the table lives for one reader: the overlay's own address when it indexes
 * the rows directly, or the pointer cell's word when it loads a cell first.
 */
function digimonPictureTable(options: PictureFramesOptions): number {
    if (options.tableBase !== undefined) return options.tableBase | 0;
    if (options.tableCell === undefined) {
        throw new Error("digimon pictures need a table cell or a table base");
    }
    return options.mem.read32(options.tableCell) | 0;
}

/**
 * The twelve instructions every reader shares: when the cadence has elapsed, walk
 * each subject's row one word on, and start that row again at the `-1` marker or
 * at its seventh word. The stored counter is the frame the screen then draws.
 * One timer gates every group, as it does in F0x8008C954 and F0x8008AD98.
 */
export function advanceDigimonPictures(options: PictureFramesOptions): void {
    const { mem, timer, cadence, groups } = options;
    if (options.frame() - (mem.read32(timer) | 0) < cadence) return;
    mem.write32(timer, options.frame() >>> 0);
    const table = digimonPictureTable(options);
    for (const group of groups) {
        for (let i = 0; i < group.count; i++) {
            const row = group.rowAt(i) | 0;
            if (row < 0 && group.skipNegativeRow) continue;
            const counter = (group.counterBase + 4 * i) >>> 0;
            const next = (mem.read32(counter) | 0) + 1;
            mem.write32(counter, next >>> 0);
            if (isNewPartnerRow(row)) {
                if (next >= NEW_PARTNER_PICTURE_ROW.length) mem.write32(counter, 0);
                continue;
            }
            const word = mem.read32((table + (row * DIGIMON_PICTURE_ROW_WORDS + next) * 4) >>> 0) | 0;
            if (word === DIGIMON_PICTURE_END || (group.wrapAt !== undefined && next >= group.wrapAt)) {
                mem.write32(counter, 0);
            }
        }
    }
}

/**
 * The picture a subject is showing now: the table word its counter points at,
 * where the table is reached through a pointer cell (the pause screen, the Lab).
 */
export function digimonPictureAt(
    mem: PictureFramesMemory,
    tableCell: number,
    row: number,
    counter: number,
): number {
    return digimonPictureAtBase(mem, mem.read32(tableCell) | 0, row, counter);
}

/**
 * The same read where the overlay indexes the table's own address (the fight
 * report's 0x8008905C). One implementation of the word load either way.
 */
export function digimonPictureAtBase(
    mem: PictureFramesMemory,
    tableBase: number,
    row: number,
    counter: number,
): number {
    if (isNewPartnerRow(row | 0)) return newPartnerPicture(row | 0, counter | 0);
    return mem.read32((tableBase + (row * DIGIMON_PICTURE_ROW_WORDS + (counter | 0)) * 4) >>> 0) | 0;
}