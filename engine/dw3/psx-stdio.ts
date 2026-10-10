// The Psy-Q stdout byte/flush pair and the printf producer, translated from
// the resident EXE (exe/fns).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/psx-stdio-oracle.test.js runs the original addresses through
// engine/native and compares the column counter, the 0x20-byte stdout buffer,
// the stored count and every fwrite call.
//
// DECODED: fns.s:26530-27177 (wrapper 0x800283FC, formatter 0x8002843C,
// putchar 0x80028B2C, flush 0x80028C28), read instruction by instruction
// against the checked C. These are the edges behind every %d/%s/%x console
// diagnostic the GPU/driver paths print; they execute on pro/cardgame,
// pro/soundtst and pro/stagslct (turn349-coverage.json).

import type { NativeMemory } from "../native/memory.ts";
type PsxMemory = Pick<NativeMemory, "read8" | "read32" | "write8" | "write32">;

/** The 0x20-byte stdout line buffer fwrite sends. */
export const STDOUT_BUFFER = 0x80081200;
/** Stored byte count; >= 0x20 flushes in putchar, > 0 flushes in flushStdout. */
export const STDOUT_COUNT = 0x8005604c;
/** Column counter the tab expansion and '\n' reset use. */
export const STDOUT_COLUMN = 0x80056048;
/** The ctype table whose bit mask 0x97 marks a countable char, bit 4 a digit. */
export const CTYPE_TABLE = 0x80055e19;
/** fwrite(fd=1, buffer, count) — the port takes it through the host. */
export const STDOUT_FD = 1;

/** The host boundary both translated routines reach; never re-enter the interpreter. */
export interface PsxStdioHost {
    fwrite(fd: number, buffer: number, count: number): void;
}

function isCountable(mem: PsxMemory, ch: number): boolean {
    return (mem.read8(CTYPE_TABLE + (ch & 0xff)) & 0x97) !== 0;
}

function isDigitChar(mem: PsxMemory, ch: number): boolean {
    return ch < 0x80 && (mem.read8(CTYPE_TABLE + (ch & 0xff)) & 4) !== 0;
}

function emit(mem: PsxMemory, ch: number, host: PsxStdioHost): void {
    const count = mem.read32(STDOUT_COUNT) | 0;
    if (count >= 0x20) {
        host.fwrite(STDOUT_FD, STDOUT_BUFFER, count);
        mem.write32(STDOUT_COUNT, 0);
    }
    mem.write8(STDOUT_BUFFER + (mem.read32(STDOUT_COUNT) >>> 0), ch & 0xff);
    mem.write32(STDOUT_COUNT, (mem.read32(STDOUT_COUNT) >>> 0) + 1);
}

/**
 * F0x80028B2C putchar(ch), fns.s:27098-27159. Signed-char semantics: tab (9)
 * expands spaces until the column counter's low 3 bits clear; '\n' (10) emits
 * '\r', zeroes the column counter and then emits the '\n' itself; every other
 * char whose ctype entry has any of 0x97 increments the column. Then the
 * shared buffer tail: flush at count >= 0x20, store the (original full-word)
 * char, count += 1.
 */
export function putchar(mem: PsxMemory, ch: number, host: PsxStdioHost): void {
    const c = (ch << 24) >> 24;
    if (c === 9) {
        do {
            putchar(mem, 0x20, host);
        } while ((mem.read32(STDOUT_COLUMN) & 7) !== 0);
        return;
    }
    if (c === 0xa) {
        putchar(mem, 0xd, host);
        mem.write32(STDOUT_COLUMN, 0);
        emit(mem, ch, host);
        return;
    }
    if (isCountable(mem, ch & 0xff)) {
        mem.write32(STDOUT_COLUMN, (mem.read32(STDOUT_COLUMN) >>> 0) + 1);
    }
    emit(mem, ch, host);
}

/**
 * F0x80028C28(), fns.s:27163-27177. fwrite the stored bytes (count > 0) and
 * zero the counter; a zero count writes nothing.
 */
export function flushStdout(mem: PsxMemory, host: PsxStdioHost): void {
    const count = mem.read32(STDOUT_COUNT) | 0;
    if (count > 0) {
        host.fwrite(STDOUT_FD, STDOUT_BUFFER, count);
        mem.write32(STDOUT_COUNT, 0);
    }
}

// ── the printf producer: wrapper F0x800283FC + formatter F0x8002843C ──
//
// DECODED: fns.s:26530-27067, every arm read in assembly. Dispatch table
// D0x80010528 (rows code*4, fns.s:535-655) was parsed mechanically:
//   0x00->end 0x80028a6c; 0x20 space; 0x23 '#'; 0x2a '*'; 0x2b '+'; 0x2d '-';
//   0x2e '.'; 0x30 '0'; 0x31..39 digits; 0x44 'D' long+rescan; 0x4c 'L'
//   long2+rescan; 0x4f 'O' long1->octal; 0x55 'U' long1->decimal; 0x58 'X'
//   uppercase->hex body; 0x63 'c'; 0x64/69 d/i signed; 0x68 'h'; 0x6c 'l';
//   0x6e 'n'; 0x6f 'o'; 0x70 'p'; 0x73 's'; 0x75 'u'; 0x78 'x'; everything
//   else -> default (print the byte, acc+1).

/** Lowercase digit chars (D0x800104f8). */
const DIGITS_LOWER = "0123456789abcdef";
/** Uppercase digit chars (D0x80010514, selected by %X). */
const DIGITS_UPPER = "0123456789ABCDEF";
/** The substitute string %s prints for a NULL pointer (D0x8001050c). */
export const PRINTF_NULL_STRING = 0x8001050c;
/** The GPU-timeout format the driver failure path prints (D0x800104b8). */
export const PRINTF_GPU_TIMEOUT_FMT = 0x800104b8;
/** Conversion dispatch table at D0x80010528 (one word per code < 0x79). */
export const PRINTF_DISPATCH = 0x80010528;

/** The formatter needs 16-bit stores (%n with h) on top of the byte/flush pair. */
export interface PrintfMemory extends PsxMemory {
    write16(addr: number, value: number): void;
}

interface NumericState {
    code: number;         // the conversion char (second prefix byte)
    flags: number;        // s3: 1='l'/'D'/'O'/'U' 2='L' 4='h' 8='#' 0x10='-' 0x20='0' 0x40=hex prefix
    sign: number;         // s8 (0 / 0x20 / 0x2b / 0x2d)
    fieldWidth: number;   // sp44
    digitLen: number;     // s6
    payload: number[];    // bytes at s2 (digits or %c/%s characters)
    precisionPad: number; // sp3c
    trailingZeros: number;// sp40 (always 0 in this build; kept for the guard)
    prefix: boolean;      // s3 & 0x40
    upperTable: boolean;  // sp48 == D0x80010514
}

/**
 * F0x8002843C(1, format, argCursor), fns.s:26550-27067. The Psy-Q printf
 * core the wrapper reaches and the GPU failure paths print through. The
 * return value is the CONVERSION accumulator (literal bytes do not count,
 * fns.s:27048-27055 vs the default arm at 27048). NULL format returns 0
 * without a flush; non-null completion flushes (0x80028a6c -> 0x80028c28).
 */
export function printfFormat(
    mem: PrintfMemory,
    fmt: number,
    argCursor: number,
    host: PsxStdioHost,
): number {
    if (fmt === 0) return 0;
    let p = fmt >>> 0;
    let args = argCursor >>> 0;
    let acc = 0; // sp38
    const nextArg = (): number => {
        const v = mem.read32(args) | 0;
        args = (args + 4) >>> 0;
        return v;
    };
    for (;;) {
        const lit = mem.read8(p);
        if (lit === 0) break; // -> end arm: flush + return acc
        if (lit !== 0x25) {
            putchar(mem, lit, host);
            p = (p + 1) >>> 0;
            continue;
        }
        // ── flag scan (0x800284b8..0x8002862c) ──
        let flags = 0;
        let precision = -1;
        let sign = 0;
        let fieldWidth = 0;
        p = (p + 1) >>> 0;
        scan: for (;;) {
            const c = mem.read8(p);
            switch (c) {
                case 0x20: if (sign === 0) sign = 0x20; p = (p + 1) >>> 0; continue;
                case 0x23: flags |= 8; p = (p + 1) >>> 0; continue;
                case 0x2a: { // '*' width: arg, negated if negative, then '-' flag
                    const w = nextArg();
                    if (w < 0) { fieldWidth = -w; flags |= 0x10; }
                    else fieldWidth = w;
                    p = (p + 1) >>> 0;
                    continue;
                }
                case 0x2b: sign = 0x2b; p = (p + 1) >>> 0; continue;
                case 0x2d: flags |= 0x10; p = (p + 1) >>> 0; continue;
                case 0x2e: { // '.' precision
                    p = (p + 1) >>> 0;
                    let v = 0;
                    if (mem.read8(p) === 0x2a) { v = nextArg(); p = (p + 1) >>> 0; }
                    else {
                        // 0x80028558: peek current; continue only while ctype & 4
                        while (isDigitChar(mem, mem.read8(p))) {
                            v = v * 10 - 0x30 + mem.read8(p);
                            p = (p + 1) >>> 0;
                        }
                    }
                    precision = v < 0 ? -1 : v; // negative star -> -1 (0x800285a4-0x800285b0)
                    continue;
                }
                case 0x30: flags |= 0x20; p = (p + 1) >>> 0; continue;
                case 0x31: case 0x32: case 0x33: case 0x34:
                case 0x35: case 0x36: case 0x37: case 0x38: case 0x39: {
                    // 0x800285bc: do-while over the CURRENT char, check NEXT
                    let v = 0;
                    do {
                        v = v * 10 - 0x30 + mem.read8(p);
                        p = (p + 1) >>> 0;
                    } while (isDigitChar(mem, mem.read8(p)));
                    fieldWidth = v | 0;
                    continue;
                }
                // NOTE: D/O/U/X are NOT here - their table rows point at
                // flag arms that FALL THROUGH into the conversion bodies
                // (0x8002864c/0x800286d0/0x80028778/0x800287b0). Only L
                // re-scans (j with the ori in its delay slot).
                case 0x4c: flags |= 2; p = (p + 1) >>> 0; continue; // L -> bit2, rescan
                case 0x68: flags |= 4; p = (p + 1) >>> 0; continue; // h
                case 0x6c: flags |= 1; p = (p + 1) >>> 0; continue; // l
                default: break scan;
            }
        }
        // ── conversion dispatch (table row, code < 0x79) ──
        const code = mem.read8(p);
        if (code >= 0x79) {
            acc = (acc + 1) | 0;
            putchar(mem, code, host);
            p = (p + 1) >>> 0;
            continue;
        }
        const longBit = (flags & 1) !== 0;
        const halfBit = (flags & 4) !== 0;
        const halfLoad = halfBit && !longBit;
        switch (code) {
            case 0x00: { // dispatch row 0: the NUL after '%' -> end arm
                flushStdout(mem, host);
                return acc;
            }
            case 0x25: { // '%' hits the default arm: print '%', acc+1
                acc = (acc + 1) | 0;
                putchar(mem, 0x25, host);
                p = (p + 1) >>> 0;
                continue;
            }
            case 0x63: { // c (0x80028630): low byte of the arg, digitLen 1
                const raw = nextArg();
            const st: NumericState = {
                    code, payload: [raw & 0xff], flags, sign, fieldWidth,
                    digitLen: 1, precisionPad: 0, trailingZeros: 0,
                    prefix: false, upperTable: false,
                };
                acc = (acc + emitNumeric(mem, host, st)) | 0;
                p = (p + 1) >>> 0;
                continue;
            }
            case 0x6e: { // n (0x80028694): store acc, no output
                const ptr = nextArg() >>> 0;
                if (halfLoad) mem.write16(ptr, acc & 0xffff);
                else mem.write32(ptr, acc | 0);
                p = (p + 1) >>> 0;
                continue;
            }
            case 0x73: { // s (0x80028718)
                let ptr = nextArg() >>> 0;
                if (ptr === 0) ptr = PRINTF_NULL_STRING;
                let len: number;
                if (precision >= 0) {
                    const found = boundedScan(mem, ptr, precision);
                    len = found === 0 ? precision : Math.min(precision, (found - ptr) | 0);
                } else {
                    len = 0;
                    while (mem.read8((ptr + len) >>> 0) !== 0) len++;
                }
                sign = 0;
                const st: NumericState = {
                    code: 0x73,
                    payload: stringBytes(mem, ptr, len),
                    flags, sign, fieldWidth,
                    digitLen: len, precisionPad: 0, trailingZeros: 0,
                    prefix: false, upperTable: false,
                };
                acc = (acc + emitNumeric(mem, host, st)) | 0;
                p = (p + 1) >>> 0;
                continue;
            }
            default:
                break;
        }
        // ── numeric conversions (d/i/D o/O p u/U x/X) ──
        let base: number;
        let digits: string;
        let value = 0;
        let prefix = false;
        switch (code) {
            case 0x44: case 0x64: case 0x69: { // D=flag-then-fallthrough + d/i (0x8002864c/0x80028650)
                base = 10; digits = DIGITS_LOWER;
                value = halfLoad ? sext16(mem.read32(args) | 0) : (mem.read32(args) | 0);
                args = (args + 4) >>> 0;
                if (value < 0) { value = -value | 0; sign = 0x2d; }
                break;
            }
            case 0x4f: case 0x6f: { // O/o (0x800286d0/0x800286d4): long-flag ori falls through
                base = 8; digits = DIGITS_LOWER;
                value = halfLoad ? sext16(mem.read32(args) | 0) : (mem.read32(args) | 0);
                args = (args + 4) >>> 0;
                sign = 0;
                break;
            }
            case 0x70: { // p (0x80028708): full word, base 16, sign cleared
                base = 16; digits = DIGITS_LOWER;
                value = mem.read32(args) | 0;
                args = (args + 4) >>> 0;
                sign = 0;
                break;
            }
            case 0x55: case 0x75: { // U/u (0x80028778/0x8002877c): long then fall, no negation
                base = 10; digits = DIGITS_LOWER;
                value = halfLoad ? sext16(mem.read32(args) | 0) : (mem.read32(args) | 0);
                args = (args + 4) >>> 0;
                sign = 0;
                break;
            }
            case 0x58: case 0x78: { // X/x (0x800287bc; X picks the upper table first)
                base = 16; digits = code === 0x58 ? DIGITS_UPPER : DIGITS_LOWER;
                value = halfLoad ? sext16(mem.read32(args) | 0) : (mem.read32(args) | 0);
                args = (args + 4) >>> 0;
                sign = 0;
                if ((flags & 8) !== 0 && value !== 0) { prefix = true; flags |= 0x40; }
                break;
            }
            default: { // any other mapped row behaves as the default arm
                acc = (acc + 1) | 0;
                putchar(mem, code, host);
                p = (p + 1) >>> 0;
                continue;
            }
        }
        // shared numeric head (0x80028808): precision pad + clear zero-flag
        let precisionPad = 0;
        if (precision >= 0) { precisionPad = precision; flags &= ~0x20; }
        // digit generation (0x80028830): do-while divu, backward build
        const digitsChars: number[] = [];
        if (value !== 0 || precisionPad !== 0) {
            let v = value >>> 0;
            do {
                digitsChars.unshift(digits.charCodeAt(v % base));
                v = (v / base) | 0;
            } while (v !== 0);
        }
        // '#' octal: prepend '0' when the last generated digit isn't one
        let octalPrefix: boolean;
        if ((flags & 8) !== 0 && base === 8) {
            const last = digitsChars.length > 0 ? digitsChars[digitsChars.length - 1] : -1;
            if (last !== 0x30) { digitsChars.push(0x30); octalPrefix = true; }
        }
        const st: NumericState = {
            code,
            payload: digitsChars, flags, sign, fieldWidth,
            digitLen: digitsChars.length, precisionPad, trailingZeros: 0,
            prefix, upperTable: false,
        };
        acc = (acc + emitNumeric(mem, host, st)) | 0;
        p = (p + 1) >>> 0;
    }
    flushStdout(mem, host);
    return acc;
}

const sext16 = (v: number): number => (v << 16) >> 16;
// half loads are lh (sign-extending) in every arm; long/plain are lw.
const sext16Arg = sext16;

/** Ordered emitter, 0x800288a8-0x80028a68: the exact putchar order. */
function emitNumeric(mem: PsxMemory, host: PsxStdioHost, a: NumericState): number {
    const prefix = a.prefix;
    const contentLen = a.digitLen + (a.sign ? 1 : 0) + (prefix ? 2 : 0);
    const field = a.precisionPad > contentLen ? a.precisionPad : contentLen;
    // left spaces: !(flags & 0x30) && width > field
    if ((a.flags & 0x30) === 0 && a.fieldWidth > field) {
        for (let i = field; i < a.fieldWidth; i++) putchar(mem, 0x20, host);
    }
    if (a.sign) putchar(mem, a.sign, host);
    if (prefix) {
        putchar(mem, 0x30, host);
        putchar(mem, a.code, host); // 'x' or 'X'
    }
    if ((a.flags & 0x30) === 0x20 && a.fieldWidth > field) {
        for (let i = field; i < a.fieldWidth; i++) putchar(mem, 0x30, host);
    }
    for (let i = contentLen; i < a.precisionPad; i++) putchar(mem, 0x30, host);
    for (const d of a.payload) putchar(mem, d, host);
    for (let i = a.trailingZeros; i > 0; i--) putchar(mem, 0x30, host);
    if ((a.flags & 0x10) !== 0 && a.fieldWidth > field) {
        for (let i = field; i < a.fieldWidth; i++) putchar(mem, 0x20, host);
    }
    return a.fieldWidth > field ? a.fieldWidth : field;
}

/** F0x80028ADC memchr(ptr, 0, n): byte offset of the NUL, 0 when absent. */
function boundedScan(mem: PsxMemory, ptr: number, n: number): number {
    for (let i = 0; i < n; i++) {
        if (mem.read8((ptr + i) >>> 0) === 0) return (ptr + i) >>> 0;
    }
    return 0;
}

function stringBytes(mem: PsxMemory, ptr: number, len: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push(mem.read8((ptr + i) >>> 0));
    return out;
}

/**
 * F0x800283FC(fmt, a1, a2, a3, ...stack), fns.s:26530-26548. Spreads the four
 * register arguments into the argument block (its 0x18 frame puts them at
 * incoming sp+0x04/08/0c/0x10-equivalents) and calls the formatter with the
 * cursor at the first one; fifth and later original arguments are already
 * contiguous after them in the incoming caller's stack. The port takes the
 * full flat argument word list in call order.
 */
/**
 * F0x800283FC(fmt, a1, a2, a3, ...stack), fns.s:26530-26548. Spreads the four
 * register arguments into the argument block (cursor+0..0xc) and calls the
 * formatter with the cursor at the first one; fifth and later original
 * arguments are already contiguous after them. The port writes the flat word
 * list into the given block (the wrapper's own frame write, on the port's
 * scratch block) and formats from there.
 */
export function printfWrap(
    mem: PrintfMemory,
    fmt: number,
    blockAddr: number,
    args: readonly number[],
    host: PsxStdioHost,
): number {
    for (let i = 0; i < args.length; i++) {
        mem.write32((blockAddr + i * 4) >>> 0, (args[i] ?? 0) | 0);
    }
    return printfFormat(mem, fmt, blockAddr >>> 0, host);
}
