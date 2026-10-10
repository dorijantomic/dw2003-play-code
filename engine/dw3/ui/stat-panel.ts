// The thirteen-number panel one shared walk, asked for by four screens.
//
// The original has no such module: each overlay pasted the same walk into its own
// populate routine, and the only differences are which block halfword each widget
// takes, whether the value is capped, and where the three grey marks and the
// enable pass land in the call order. Those differences are data here, not copies.
//
//   screen                     routine        reads                  cap  grey marks  enable
//   pause STATUS sheet         F0x8008C1C0    block +0x0C..+0x24      999  after pass   pass, then clear
//   gym left plate             F0x80084064    +0x0C x6, +0x18 x7      none between   inline, then clear
//   Lab Digivolve detail       F0x80087248    +0x0C..+0x24 x13        999  before pass  pass
//   Lab roster picker pane     F0x8008D9BC    the same, + species base 999  between     inline
//
// DECODED: pro/ststatus.s:9843-9988 (F0x8008C1C0), pro/stgtrain.s:842-948
// (F0x80084064), exe-decomp/stgdglab_c/F0x80087248.c:80-114 and
// exe-decomp/stgdglab_c/F0x8008d9bc.c:110-178. The block itself is the
// 0x2C-byte projection `F0x80017174` writes (engine/dw3/effective-stats.ts);
// the three flags are the counters it subtracts from STR, DEF and SPD
// (`F0x80017174`'s `subtractFloor` at buf+0x26/+0x28/+0x2A).

/** Thirteen numbers: STR DEF SPT WIS SPD CHR, then the seven element values. */
export const STAT_PANEL_COUNT = 13;
/** The six core statistics come first; the other seven are the elements. */
export const STAT_CORE_COUNT = 6;
/**
 * Block offset of the first core statistic. The whole panel is the thirteen
 * signed halfwords from here to +0x24, in widget order.
 */
export const STAT_PANEL_OFFSET = 0x0c;
/** `li $a2, 0x3e7`: the value every capping screen shows instead of 1000 or more. */
export const STAT_PANEL_CAP = 999;
/** The three conditional-stat flags, in the order the producer subtracts them. */
export const STAT_FLAG_OFFSETS: readonly number[] = [0x26, 0x28, 0x2a];
/** Which widget of the thirteen each flag greys: STR, DEF and SPD. */
export const STAT_FLAG_WIDGETS: readonly number[] = [0, 1, 4];
/** `li $a1, 0x6`: the mark that greys a number out. */
export const STAT_FLAG_MARK = 6;
/** Which of the six core widgets each flag belongs to, -1 for the rest. */
const STAT_FLAG_BY_WIDGET = [0, 1, -1, -1, 2, -1];
/** `move_ $a1, $zr`: the mark every widget is cleared to before the flags land. */
export const STAT_MARK_CLEAR = 0;

/** The block halfwords, read unsigned as the game's own memory hands them over. */
export interface StatPanelMemory {
    read16(addr: number): number;
}

/** The thirteen widgets and the three widget calls the original makes on them. */
export interface StatPanelTarget {
    /** Widget `index` of the thirteen (0 = STR, 6 = the first element). */
    widget(index: number): number;
    /** Widget +0x118: render `value` on a line. */
    setNumber(widget: number, value: number): void;
    /** Widget +0x148: measure and show. */
    setEnabled(widget: number, on: number): void;
    /** Widget +0x138: the mark (0 clear, 1 up, 5 down, 6 greyed out). */
    setMark(widget: number, code: number): void;
}

/**
 * Where the original's enable pass runs, and whether it clears each widget's
 * mark on the way:
 *   `inline-clear` the gym: per widget, right after its number (F0x80084064)
 *   `inline`       the Lab's picker: per widget, no clear (F0x8008D9BC)
 *   `after-clear`  the pause sheet: a second pass over all thirteen (F0x8008C1C0)
 *   `after`        the Lab's Digivolve pane: a second pass, no clear (F0x80087248)
 *   `none`         the Lab's roster picker: it enables its own fourteen widgets
 *                  in one pass at the end (F0x8008D9BC), so the walk only numbers
 */
export type StatPanelPass = "inline-clear" | "inline" | "after-clear" | "after" | "none";

export interface StatPanelOptions {
    /** false for the gym alone: F0x80084064 never tests the value against 999. */
    cap: boolean;
    /**
     * Where the three grey marks land: `inline-core` tests each of the six core
     * numbers as it is written (the Lab's picker, F0x8008D9BC), `between` splits
     * the two runs of six and seven (the gym, F0x80084064), `before-pass` puts
     * them in front of the enable pass (the Lab's Digivolve pane, F0x80087248) and
     * `caller` leaves them to the caller, which is the pause sheet: its marks land
     * after the level line it writes in between, so it calls
     * {@link greyStatPanel} itself.
     */
    marks: "inline-core" | "between" | "before-pass" | "caller";
    pass: StatPanelPass;
    /**
     * Thirteen values added to the block's before the cap, which only the Lab's
     * roster picker does (F0x8008D9BC adds the species record's own base values,
     * read as UNSIGNED halfwords at profile+0x02..+0x1A).
     */
    addend?: readonly number[] | null | undefined;
}

const s16 = (v: number): number => ((v & 0xffff) << 16) >> 16;

/**
 * The one walk. Six core statistics, the three grey marks where the caller says
 * they belong, the seven element values, then the enable pass in the caller's
 * order. Every screen above produces the same thirteen numbers from the same
 * block; only `cap` and the ordering flags differ.
 */
export function fillStatPanel(
    mem: StatPanelMemory,
    target: StatPanelTarget,
    block: number,
    options: StatPanelOptions,
): void {
    const { cap, marks, pass } = options;
    const addend = options.addend;
    const inline = pass === "inline" || pass === "inline-clear";
    const clear = pass === "inline-clear" || pass === "after-clear";
    const number = (index: number): void => {
        const base = s16(mem.read16(block + STAT_PANEL_OFFSET + 2 * index));
        let value = addend ? base + (Number(addend[index]) | 0) : base;
        if (cap && value >= STAT_PANEL_CAP + 1) value = STAT_PANEL_CAP;
        const widget = target.widget(index);
        target.setNumber(widget, value);
        if (inline) {
            target.setEnabled(widget, 1);
            if (clear) target.setMark(widget, STAT_MARK_CLEAR);
        }
        if (marks === "inline-core" && index < STAT_FLAG_BY_WIDGET.length) {
            const flag = STAT_FLAG_BY_WIDGET[index] ?? -1;
            if (flag >= 0) markFlag(mem, target, block, flag);
        }
    };
    const grey = (): void => greyStatPanel(mem, target, block);
    for (let i = 0; i < STAT_CORE_COUNT; i++) number(i);
    if (marks === "between") grey();
    for (let i = STAT_CORE_COUNT; i < STAT_PANEL_COUNT; i++) number(i);
    if (pass === "after") {
        if (marks === "before-pass") grey();
        for (let i = 0; i < STAT_PANEL_COUNT; i++) target.setEnabled(target.widget(i), 1);
    }
    if (pass === "after-clear") {
        for (let i = 0; i < STAT_PANEL_COUNT; i++) {
            const widget = target.widget(i);
            target.setEnabled(widget, 1);
            target.setMark(widget, STAT_MARK_CLEAR);
        }
    }
}

/**
 * The three grey marks on their own: STR, DEF and SPD go grey when the producer
 * counted a stat the training subtracted (`F0x80017174`'s `subtractFloor` at
 * block+0x26/+0x28/+0x2A, then `li $a1,0x6`). Every screen calls this from its
 * own place in the call order; {@link fillStatPanel} calls it for the three that
 * place it itself.
 */
export function greyStatPanel(mem: StatPanelMemory, target: StatPanelTarget, block: number): void {
    for (let f = 0; f < STAT_FLAG_OFFSETS.length; f++) markFlag(mem, target, block, f);
}

/** One flag's mark: the widget goes grey when the producer counted that stat. */
function markFlag(mem: StatPanelMemory, target: StatPanelTarget, block: number, flag: number): void {
    const offset = STAT_FLAG_OFFSETS[flag];
    const widget = STAT_FLAG_WIDGETS[flag];
    if (offset === undefined || widget === undefined) return;
    if (s16(mem.read16(block + offset)) !== 0) {
        target.setMark(target.widget(widget), STAT_FLAG_MARK);
    }
}

