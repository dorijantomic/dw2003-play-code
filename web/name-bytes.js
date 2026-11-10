// The screen text codec's ENCODE half, on its own so the translated screens can
// reach it without touching the native-screen driver.
//
// a single byte 0x04+d = digit, 0x0e+n = A-Z, 0x28+n = a-z; the two-byte pair
// 0x01,0x01 is the extended space (web/native-screen-text.js is the DECODE half,
// a canvas renderer). Names the pause pages show are read as raw strings out of
// the roster record (record +0x08), so they use this codec.
//
// Import-free on purpose: nothing here loads the interpreter, the overlays or
// any other original code, so a translated screen may import it directly.
// web/native-screen.js re-exports it for the native screens that already do.

/** Encode a display name into the screen text codec, capped at `maxBytes`
 *  (default 23 = the roster record's name field). */
export function encodeNativeScreenText(s, maxBytes = 23) {
    const out = [];
    for (const ch of String(s ?? "")) {
        const c = ch.charCodeAt(0);
        if (ch >= "0" && ch <= "9") out.push(0x04 + (c - 0x30));
        else if (ch >= "A" && ch <= "Z") out.push(0x0e + (c - 0x41));
        else if (ch >= "a" && ch <= "z") out.push(0x28 + (c - 0x61));
        else if (ch === "'" || ch === "-" || ch === ".") out.push(0x01, 0x01); // unknown: space
        else out.push(0x01, 0x01);
        if (out.length >= maxBytes) break;
    }
    return out.slice(0, maxBytes);
}
