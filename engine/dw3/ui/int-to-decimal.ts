// The resident integer-to-decimal-ASCII formatter, translated bit-exactly.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/int-to-decimal-oracle.test.js runs the original F0x80019508
// through engine/native and compares every written byte.
//
// DECODED: ledger UI-WIDGETCLASS-AE38-SETTERS-001 and the widget-setter family
// claim. F0x80019508 is a plain itoa with NO NUL terminators and NO padding: the
// caller zero-fills the buffer, this writes only the digit bytes. For a value
// <= 0 it writes the single byte '0' (0x30) and touches nothing else. The widget
// number setter F0x800195B0 calls it, then subtracts 0x2C from every emitted
// byte to reach the game's digit glyph codes (0x04..0x0D).
//
// The digit-count loop multiplies its place value by ten in 32-BIT arithmetic,
// so for values of 1e9 or more the place wraps (10^9 -> 0x540BE400 ->
// 0x4876E800 -> -0x2B5A8000 ...) and the count legitimately overruns the true
// digit count; the write loop then puts the digits at the top of that span. The
// oracle covers 2147483647 so the port reproduces the wrap, not a "fixed" itoa.

export interface ByteWriter {
    write8(addr: number, value: number): void;
}

/**
 * F0x80019508(dest, value): write the decimal ASCII digits of `value` into
 * `dest` starting at byte 0, with no terminator and no sign.
 */
export function intToDecimalAscii(mem: ByteWriter, dest: number, value: number): void {
    const v = value | 0;
    if (v <= 0) {
        mem.write8(dest, 0x30);
        return;
    }
    // Count digit slots: strip the low digits place by place. `place` wraps to
    // 32 bits exactly as the original's shift/add sequence does.
    let stripped = v;
    let digits = 0;
    let place = 10;
    do {
        digits += 1;
        stripped -= stripped % place;
        place = (place * 10) | 0;
    } while (stripped !== 0);
    // Emit digits from the last slot backwards, as the original does.
    let rest = v;
    do {
        const rem = rest % 10;
        rest = (rest - rem) / 10;
        digits -= 1;
        mem.write8(dest + digits, rem + 0x30);
    } while (rest !== 0);
}
