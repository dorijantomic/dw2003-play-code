// The text widget's visible-window rescan and the first control handlers,
// translated from the resident EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-window-oracle.test.js runs each original address through
// engine/native and compares the widget/scratch words and the return value.
//
// DECODED: F0x80019FB0 (the +0x128 visible-window rescan) and the handler-table
// entries F0x8001A6E8 (indices 0/7/9), F0x8001A73C (index 1, the page/wait
// opcode) and F0x8001A82C (index 2, the "set text" opcode). The dispatch table
// D0x8004DCA0, the cursor-advance table D0x8004DDD4 and the drawer's arm
// mapping are documented in the accepted text-residue-contract answer.

import { decodeTextToken } from "./text-decode.ts";
import { ADVANCE_TABLE_CELL } from "./text-measure.ts";

export interface TextWindowMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** Widget fields the rescan and these handlers touch. */
export const TEXT_WINDOW = {
    state: 0xc,
    state2: 0x10,
    selected: 0x14,
    cursor: 0x18,
    font: 0x50,
    line0: 0x5c,
    line0Length: 0x62,
    flag: 0x66,
    revealEnd: 0xa4,
    revealCursor: 0xa6,
    unkA8: 0xa8,
    lineWidth: 0xaa,
    penX: 0xb8,
    penY: 0xba,
    unkBF: 0xbf,
    fixedPitch: 0xc2,
} as const;

/** Line record fields (line 0 at widget+0x5C, siblings at +0xC stride). */
export const TEXT_LINE = { buffer: 0x0, length: 0x6, cursor: 0x8, flag: 0xa } as const;

const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;

/**
 * F0x80019FB0(self): the +0x128 visible-window rescan. Runs only while the
 * widget is in state 1; walks tokens from the reveal cursor, counting operand-1
 * page breaks against widget+0xBF and adding operand-5 substitution widths,
 * then writes the end offset to widget+0xA4.
 */
export function rescanVisibleWindow(mem: TextWindowMemory, self: number): number {
    if ((mem.read32(self + TEXT_WINDOW.state) | 0) !== 1) return 1;
    const table = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
    const font = mem.read32(self + TEXT_WINDOW.font) >>> 0;
    const buffer = mem.read32(self + TEXT_WINDOW.line0) >>> 0;
    let cursor = s16(mem.read16(self + TEXT_WINDOW.revealCursor));
    let substitutions = 0; // s5
    let pages = 0; // s4
    let running = 1; // s1
    for (;;) {
        const token = decodeTextToken(
            mem,
            (buffer + cursor) >>> 0,
            mem.read8(self + TEXT_WINDOW.flag) & 0xff,
            font,
        );
        const type = (token >>> 8) & 0xff;
        if (type === 1) {
            cursor += 2;
        } else if (type < 2) {
            cursor += s16(mem.read16(self + TEXT_WINDOW.flag)) !== 0 ? 2 : 1;
        } else if (type === 2) {
            const operand = mem.read8(buffer + cursor + 1) & 0xff;
            if (operand === 2) {
                if ((mem.read8(buffer + cursor + 2) & 0xff) < 5) running = 0;
                cursor += (mem.read32(table + 8) | 0); // table[2]
            } else if (operand < 3) {
                if (operand === 1) {
                    pages += 1;
                    if (!(pages < (mem.read8(self + TEXT_WINDOW.unkBF) & 0xff))) {
                        running = 0;
                    } else {
                        cursor += (mem.read32(table + 4) | 0); // table[1]
                    }
                } else {
                    cursor += (mem.read32(table + operand * 4) | 0);
                }
            } else if (operand === 3) {
                running = 0;
            } else if (operand === 5) {
                const index = mem.read8(buffer + cursor + 2) & 0xff;
                if (index >= 6) {
                    running = 0;
                } else {
                    substitutions += s16(mem.read16(self + index * 0xc + TEXT_WINDOW.line0Length));
                    cursor += (mem.read32(table + 0x14) | 0); // table[5]
                }
            } else {
                cursor += (mem.read32(table + operand * 4) | 0);
            }
        } else if (type === 4) {
            running = 0;
        } else {
            cursor += s16(mem.read16(self + TEXT_WINDOW.flag)) !== 0 ? 2 : 1;
        }
        if (running !== 0) continue;
        mem.write16(self + TEXT_WINDOW.revealEnd, (cursor + substitutions) & 0xffff);
        // The original's v0 still holds the value it just stored.
        return (cursor + substitutions) | 0;
    }
}

/**
 * F0x8001A6E8(self, line, tok) — handler-table indices 0/7/9. Operand 7 moves
 * the reveal cursor two bytes past the current one; every other operand runs
 * the rescan. Returns 0.
 */
export function textHandlerEntry0(mem: TextWindowMemory, self: number, line: number): number {
    const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
    const cursor = s16(mem.read16(line + TEXT_LINE.cursor));
    const operand = mem.read8(buffer + cursor + 1) & 0xff;
    if (operand !== 0 && operand === 7) {
        mem.write16(self + TEXT_WINDOW.revealCursor, (cursor + 2) & 0xffff);
    } else {
        rescanVisibleWindow(mem, self);
    }
    return 0;
}

/**
 * F0x8001A73C(self, line, tok) — handler-table index 1, the page/wait opcode.
 * Bumps the scratch line counter; the first call records the line cursor, and
 * once the widget's page budget is spent it publishes the reveal cursor and
 * runs the rescan. Returns 0x8004 while pages remain, 0x8000 when done.
 */
export function textHandlerWait(
    mem: TextWindowMemory,
    self: number,
    line: number,
    tok: number,
): number {
    const counter = (mem.read16(tok + 0x18) + 1) & 0xffff;
    mem.write16(tok + 0x18, counter);
    const signed = s16(counter);
    if (signed === 1) {
        mem.write32(tok + 0x10, (s16(mem.read16(line + TEXT_LINE.cursor)) + 2) | 0);
    } else if (!(signed < (mem.read8(self + TEXT_WINDOW.unkBF) & 0xff))) {
        mem.write16(self + TEXT_WINDOW.revealCursor, mem.read16(tok + 0x10));
        const budget = mem.read8(self + TEXT_WINDOW.unkBF) & 0xff;
        if (!(budget < 2)) {
            mem.write8(self + TEXT_WINDOW.unkBF, (budget - 1) & 0xff);
            rescanVisibleWindow(mem, self);
            mem.write8(self + TEXT_WINDOW.unkBF, (mem.read8(self + TEXT_WINDOW.unkBF) + 1) & 0xff);
        }
        return 0x8000;
    }
    // reset: new line
    mem.write16(self + TEXT_WINDOW.penX, 0);
    if ((mem.read8(self + TEXT_WINDOW.fixedPitch) & 0xff) !== 0) {
        mem.write16(self + TEXT_WINDOW.penY, (mem.read16(self + TEXT_WINDOW.penY) + mem.read16(self + 0xb6)) & 0xffff);
    } else {
        const font = mem.read32(self + TEXT_WINDOW.font) >>> 0;
        const delta = s8(mem.read8(font + 1));
        mem.write16(self + TEXT_WINDOW.penY, (mem.read16(self + TEXT_WINDOW.penY) + delta) & 0xffff);
    }
    return 0x8004;
}

/**
 * F0x8001A82C(self, line, tok) — handler-table index 2, the "set text" opcode:
 * a control byte below 5 switches the widget to state 2 and selects the text
 * index; otherwise it returns 0x8003 untouched.
 */
export function textHandlerSetText(mem: TextWindowMemory, self: number, line: number): number {
    const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
    const cursor = s16(mem.read16(line + TEXT_LINE.cursor));
    const operand = mem.read8(buffer + cursor + 2) & 0xff;
    if (operand >= 5) return 0x8003;
    mem.write32(self + TEXT_WINDOW.state, 2);
    mem.write32(self + TEXT_WINDOW.state2, 1);
    if (((operand - 1) >>> 0) < 4) {
        mem.write32(self + TEXT_WINDOW.selected, operand);
    } else {
        mem.write32(self + TEXT_WINDOW.selected, 0);
    }
    mem.write32(self + TEXT_WINDOW.cursor, (s16(mem.read16(line + TEXT_LINE.cursor)) + 2) | 0);
    return 0;
}

/**
 * F0x8001A8B4(self, line) — handler-table index 3, the page scanner. Publishes
 * the reveal window at self+0xA4 first (the line cursor + 2 when the widget has
 * a measured line width, else the line length), then walks tokens: control
 * operands 5/8 record the cursor and jump the line cursor past the end, other
 * control operands advance it by the halfword advance table, basic/ext/invalid
 * jump past the end, and a type-4 end token pulls the reveal cursor back one and
 * returns 3. The loop ends when the line cursor reaches the length (return 0).
 */
export function textHandlerPageScan(mem: TextWindowMemory, self: number, line: number): number {
    if (s16(mem.read16(self + TEXT_WINDOW.lineWidth)) === 0) {
        mem.write16(self + TEXT_WINDOW.revealEnd, mem.read16(line + TEXT_LINE.length));
    } else {
        mem.write16(self + TEXT_WINDOW.revealEnd, (mem.read16(line + TEXT_LINE.cursor) + 2) & 0xffff);
    }
    const length = s16(mem.read16(line + TEXT_LINE.length));
    for (;;) {
        if (!(s16(mem.read16(line + TEXT_LINE.cursor)) < length)) return 0;
        const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
        const rawCursor = mem.read16(line + TEXT_LINE.cursor);
        const token = decodeTextToken(
            mem,
            (buffer + s16(rawCursor)) >>> 0,
            mem.read8(line + TEXT_LINE.flag) & 0xff,
            mem.read32(self + TEXT_WINDOW.font) >>> 0,
        );
        const type = (token >>> 8) & 0xff;
        if (type === 2) {
            const operand = mem.read8(buffer + s16(rawCursor) + 1) & 0xff;
            if (operand === 5 || operand === 8) {
                mem.write16(self + TEXT_WINDOW.revealCursor, rawCursor);
                mem.write16(line + TEXT_LINE.cursor, (length + 1) & 0xffff);
            } else {
                const table = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
                const step = mem.read16(table + operand * 4); // the u16 read of the u32 table
                mem.write16(line + TEXT_LINE.cursor, (rawCursor + step) & 0xffff);
            }
        } else if (type < 3) {
            mem.write16(self + TEXT_WINDOW.revealCursor, rawCursor);
            mem.write16(line + TEXT_LINE.cursor, (length + 1) & 0xffff);
        } else if (type === 4) {
            mem.write16(self + TEXT_WINDOW.revealCursor, (rawCursor - 1) & 0xffff);
            return 3;
        } else {
            mem.write16(self + TEXT_WINDOW.revealCursor, rawCursor);
            mem.write16(line + TEXT_LINE.cursor, (length + 1) & 0xffff);
        }
    }
}

/** F0x8001AA08(self, line, tok) — handler-table index 4, a pure no-op: 0x8003. */
export function textHandlerNoop(): number {
    return 0x8003;
}

/**
 * F0x8001AB30(self, line, tok) — handler-table index 6, the line switch: with
 * byte 2 of the current token below 0xFF, switches the widget to state 2, stores
 * that byte as the selected index, writes 0xFF over it and clears widget+0xA8;
 * returns 0x8000. At or above 0xFF it returns 0x8003 untouched.
 */
export function textHandlerSetLine(mem: TextWindowMemory, self: number, line: number): number {
    const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
    const cursor = s16(mem.read16(line + TEXT_LINE.cursor));
    const operand = mem.read8(buffer + cursor + 2) & 0xff;
    if (operand >= 0xff) return 0x8003;
    mem.write32(self + TEXT_WINDOW.state, 2);
    mem.write32(self + TEXT_WINDOW.state2, 0);
    mem.write32(self + TEXT_WINDOW.selected, operand);
    mem.write8(buffer + cursor + 2, 0xff);
    mem.write16(self + TEXT_WINDOW.unkA8, 0);
    return 0x8000;
}

// ── the token stepper and the last two handlers ─────────────────────────────
//
// F0x8001A48C step(self, line, tok, cursorPtr) is the drawer's per-token step:
// it dispatches on tok+0x16 (the token type), writes the glyph record pointer to
// tok+0xC and advances *cursorPtr. Type 2 calls the control-handler table
// D0x8004DCA0 (10 words, index = the operand byte after the control code); its
// return feeds the drawer's five-arm table D0x8001025C. The two handlers that
// were missing (F0x8001AA10 next-glyph and F0x8001ABA4 player name) are here too,
// so the table is complete and the stepper can compose it.

import { setWidgetStringIndexed, type WidgetLineHost } from "./text-widget-line.ts";
import { widgetSetLineFromSource, type TextWidgetResourceHost } from "./text-widget-resource.ts";

/** The literal F0x8001AA10 installs when the sibling line has no buffer. */
export const TEXT_LITERAL_EXT_MESSAGE = 0x80010234;
/** The player-name source F0x8001ABA4 installs. */
export const TEXT_LITERAL_PLAYER_NAME = 0x80048d88;
/** The token scratch fields the stepper reads and writes. */
export const TEXT_TOKEN = { code: 0x14, type: 0x16, glyph: 0xc } as const;

/** The host the stepper's handlers need (the line setters' allocator + lookup). */
export type TextStepperHost = TextWidgetResourceHost;

const advanceCursor = (mem: TextWindowMemory, cursor: number, line: number): void => {
    mem.write16(cursor, (mem.read16(cursor) + (s16(mem.read16(line + TEXT_LINE.flag)) !== 0 ? 2 : 1)) & 0xffff);
};

/**
 * F0x8001A48C. Returns the stepper code the drawer's arm table consumes:
 * 1 = glyph emitted, 3 = loop check, and for control tokens the handler's own
 * code (0x8000/0x8003/0x8004, or a nested stepper code).
 */
export function stepToken(
    mem: TextWindowMemory,
    host: TextStepperHost,
    self: number,
    line: number,
    tok: number,
    cursor: number,
): number {
    const type = s16(mem.read16(tok + TEXT_TOKEN.type));
    const font = mem.read32(self + TEXT_WINDOW.font) >>> 0;
    if (type === 4) {
        mem.write8(self + 0xc3, 1);
        mem.write16(cursor, (mem.read16(cursor) + 1) & 0xffff);
        return 3;
    }
    if (type === 0) {
        const code = s16(mem.read16(tok + TEXT_TOKEN.code));
        mem.write32(tok + TEXT_TOKEN.glyph, (mem.read32(font + 4) + code * 0xb - 0x2c) >>> 0);
        advanceCursor(mem, cursor, line);
        return 1;
    }
    if (type === 1) {
        const code = mem.read8(tok + TEXT_TOKEN.code) & 0xff;
        const extCount = s16(mem.read16(font + 0x16));
        const glyph = !(extCount < code) && !(code <= 0)
            ? (mem.read32(font + 8) + code * 0xb - 0xb) >>> 0
            : mem.read32(font + 4) >>> 0;
        mem.write32(tok + TEXT_TOKEN.glyph, glyph);
        mem.write16(cursor, (mem.read16(cursor) + 2) & 0xffff);
        return 1;
    }
    if (type !== 2) {
        // type 3 and anything >= 5: the blank glyph
        mem.write32(tok + TEXT_TOKEN.glyph, mem.read32(font + 4) >>> 0);
        advanceCursor(mem, cursor, line);
        return 1;
    }
    // type 2: control
    if (s16(mem.read16(line + TEXT_LINE.flag)) !== 0) {
        const code = mem.read8(tok + TEXT_TOKEN.code) & 0xff;
        if (code === 1) {
            const result = textHandlerWait(mem, self, line, tok);
            mem.write16(cursor, (mem.read16(cursor) + 1) & 0xffff);
            return result & 0xffff7fff;
        }
        return textHandlerEntry0(mem, self, line) | 0;
    }
    const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
    const operand = mem.read8(buffer + s16(mem.read16(cursor)) + 1) & 0xff;
    const entry0 = (m: TextWindowMemory, _h: TextStepperHost, s: number, l: number): number => textHandlerEntry0(m, s, l);
    const handler = HANDLER_TABLE[operand < HANDLER_TABLE.length ? operand : 0] ?? entry0;
    const result = handler(mem, host, self, line, tok) | 0;
    if ((result & 0x8000) === 0) return result & 0xffff7fff;
    const table = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
    const step = mem.read16(table + operand * 4);
    mem.write16(cursor, (mem.read16(cursor) + step) & 0xffff);
    return result & 0xffff7fff;
}

/**
 * F0x8001AA10(self, line, tok) — handler index 5, the next-glyph opcode: picks
 * the sibling line record the control byte names, installs the out-of-range
 * literal when that line has no buffer, otherwise decodes its next token and
 * runs the stepper on it. Returns 0x8000 for a nested control token, 0x8003 when
 * the line is exhausted, or the nested stepper's code with 1 remapped to 2 when
 * the widget has no measured width.
 */
export function textNextGlyph(
    mem: TextWindowMemory,
    host: TextStepperHost,
    self: number,
    line: number,
    tok: number,
): number {
    const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
    const cursor = s16(mem.read16(line + TEXT_LINE.cursor));
    const n = mem.read8(buffer + cursor + 2) & 0xff;
    const record = (self + n * 0xc + TEXT_WINDOW.line0) >>> 0;
    if ((mem.read32(record) | 0) === 0) {
        setWidgetStringIndexed(mem, host, self, TEXT_LITERAL_EXT_MESSAGE, n);
        return 0x8003;
    }
    const recCursor = s16(mem.read16(record + TEXT_LINE.cursor));
    if (!(recCursor < s16(mem.read16(record + TEXT_LINE.length)))) return 0x8003;
    const token = decodeTextToken(
        mem,
        (mem.read32(record) + recCursor) >>> 0,
        mem.read8(record + TEXT_LINE.flag) & 0xff,
        mem.read32(self + TEXT_WINDOW.font) >>> 0,
    );
    mem.write16(tok + TEXT_TOKEN.code, token & 0xffff);
    const type = (token >>> 8) & 0xff;
    mem.write16(tok + TEXT_TOKEN.type, type);
    if (type === 2) return 0x8000;
    const result = stepToken(mem, host, self, record, tok, (record + TEXT_LINE.cursor) >>> 0);
    if (s16(mem.read16(self + TEXT_WINDOW.lineWidth)) !== 0) return result;
    return result === 1 ? 2 : result;
}

/**
 * F0x8001ABA4(self, line, tok) — handler index 8, the player-name opcode: for a
 * line index below 6, installs the player-name buffer on that line through
 * F0x800196E4 and marks the operand byte as consumed; returns 0x8003.
 */
export function textHandlerPlayerName(
    mem: TextWindowMemory,
    host: TextStepperHost,
    self: number,
    line: number,
): number {
    const cursor = s16(mem.read16(line + TEXT_LINE.cursor));
    const n = mem.read8(mem.read32(line + TEXT_LINE.buffer) + cursor + 2) & 0xff;
    if (n >= 6) return 0x8003;
    widgetSetLineFromSource(mem, host, self, TEXT_LITERAL_PLAYER_NAME, -1, n);
    // The original re-reads the record's buffer after the install (line 0's
    // buffer has just been reallocated), then stamps the operand byte.
    const buffer = mem.read32(line + TEXT_LINE.buffer) >>> 0;
    mem.write8(buffer + cursor + 2, 6);
    return 0x8003;
}

/** The ten handler slots of D0x8004DCA0 (index = the operand byte). */
const HANDLER_TABLE: readonly ((
    mem: TextWindowMemory, host: TextStepperHost, self: number, line: number, tok: number,
) => number)[] = [
    (m, _h, s, l) => textHandlerEntry0(m, s, l),
    (m, _h, s, l, t) => textHandlerWait(m, s, l, t),
    (m, _h, s, l) => textHandlerSetText(m, s, l),
    (m, _h, s, l) => textHandlerPageScan(m, s, l),
    () => textHandlerNoop(),
    textNextGlyph,
    (m, _h, s, l) => textHandlerSetLine(m, s, l),
    (m, _h, s, l) => textHandlerEntry0(m, s, l),
    textHandlerPlayerName,
    (m, _h, s, l) => textHandlerEntry0(m, s, l),
];

// ── the reveal tick (the typewriter's per-frame callback) ───────────────────

import { PAD_BLOCK } from "../../systems/pad-block.ts";

/** The pad service block (F0x80018854 / F0x80018980 live in its cell block). */
export { PAD_BLOCK as PAD_SERVICE_BLOCK };
/** The logical-button id table the pad sub-arm indexes with widget+0x14. */
export const LOGICAL_BUTTON_TABLE = 0x8004dccc;

/** What the reveal tick needs from the host. */
export interface TextRevealHost {
    /** F0x800197A4: the drawer (the last text-family port). */
    draw(self: number): void;
    /** [D0x80055C48](id): the packed-sound boundary, called once per character. */
    playPackedSound(id: number): void;
    /** The shared pad service's button word (cell PAD_CELL_PRESSED). */
    padButtonWord(): number;
    /** The shared pad service's logical id -> bit lookup (cell PAD_CELL_BUTTON_MAP). */
    logicalButtonBit(id: number): number;
    /** [D0x8004B5DC+0x10]: the heap free. */
    free(ptr: number): void;
}

/**
 * F0x8001AC14(self): the per-frame object callback the text element installs at
 * object+0x48. It latches the state once, then:
 *   state 1 — the typewriter: no draw when +0xC1 is zero; with a positive delay
 *     and a clear pause byte it increments +0xA8 and, once the accumulator
 *     passes the delay, resets it, bumps the revealed count +0xA4, plays the
 *     packed sound at +0xC8 (when non-zero) and draws;
 *   state 2 — the wait: sub-mode +0x10 == 1 waits for the logical pad button
 *     named by D0x8004DCCC[+0x14] (on press: stamp byte 5 at
 *     line0.buffer[+0x18], set +0xA8 = +0xAA, state = 1), otherwise it draws
 *     first and counts +0x14 frames before returning to state 1;
 *   state 3 — frees the six line-record buffers through the heap free;
 *   anything else — F0x800142AC advanceState (+0xC += 1, +0x10/+0x14/+0x18 = 0).
 * Nothing here reads a wall clock; call it exactly once per frame.
 */
/** F0x80014274 setState(self, v): +0xC = v and +0x10/+0x14/+0x18 = 0. */
function setWidgetState(mem: TextWindowMemory, self: number, v: number): void {
    mem.write32(self + TEXT_WINDOW.state, v | 0);
    mem.write32(self + TEXT_WINDOW.state2, 0);
    mem.write32(self + TEXT_WINDOW.selected, 0);
    mem.write32(self + TEXT_WINDOW.cursor, 0);
}

/** F0x800142AC advanceState(self): +0xC += 1 and +0x10/+0x14/+0x18 = 0. */
function advanceWidgetState(mem: TextWindowMemory, self: number): void {
    setWidgetState(mem, self, (mem.read32(self + TEXT_WINDOW.state) | 0) + 1);
}

export function textRevealTick(mem: TextWindowMemory, host: TextRevealHost, self: number): void {
    const state = mem.read32(self + TEXT_WINDOW.state) | 0;
    if (state === 1) {
        if ((mem.read8(self + 0xc1) & 0xff) === 0) return;
        const delay = s16(mem.read16(self + 0xaa));
        if (delay <= 0 || (mem.read8(self + 0xc3) & 0xff) !== 0) {
            host.draw(self);
            return;
        }
        const acc = (mem.read16(self + 0xa8) + 1) & 0xffff;
        mem.write16(self + 0xa8, acc);
        if (!(delay < s16(acc))) {
            host.draw(self);
            return;
        }
        mem.write16(self + 0xa8, 0);
        mem.write16(self + 0xa4, (mem.read16(self + 0xa4) + 1) & 0xffff);
        const sound = mem.read32(self + 0xc8) | 0;
        if (sound !== 0) host.playPackedSound(sound);
        host.draw(self);
        return;
    }
    if (state === 2) {
        if ((mem.read32(self + TEXT_WINDOW.state2) | 0) === 1) {
            const word = host.padButtonWord() | 0;
            const id = mem.read32(LOGICAL_BUTTON_TABLE + (mem.read32(self + TEXT_WINDOW.selected) | 0) * 4) | 0;
            const bit = host.logicalButtonBit(id) | 0;
            if (((word >> bit) & 1) !== 0) {
                const buffer = mem.read32(self + TEXT_WINDOW.line0) >>> 0;
                mem.write8((buffer + (mem.read32(self + TEXT_WINDOW.cursor) | 0)) >>> 0, 5);
                mem.write16(self + 0xa8, mem.read16(self + 0xaa));
                setWidgetState(mem, self, 1);
            }
            host.draw(self);
            return;
        }
        host.draw(self);
        const acc = (mem.read16(self + 0xa8) + 1) & 0xffff;
        mem.write16(self + 0xa8, acc);
        const frames = mem.read32(self + TEXT_WINDOW.selected) | 0;
        if (!(frames < s16(acc))) return;
        mem.write16(self + 0xa8, 0);
        setWidgetState(mem, self, 1);
        return;
    }
    if (state === 3) {
        for (let i = 0; i < 6; i++) {
            const ptr = mem.read32(self + TEXT_WINDOW.line0 + i * 0xc) >>> 0;
            if (ptr !== 0) host.free(ptr);
        }
        return;
    }
    // F0x800142AC advanceState: the default arm for 0, negative and >= 4.
    advanceWidgetState(mem, self);
}
