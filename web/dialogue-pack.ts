// Builds a one-line text pack in the format of the disc's own dialogue files (web/assets/data/dialogue-box/estalk0N.bin),
// so a line written for the extra quests can be shown by the game's own translated conversation box: the same balloon,
// the same bitmap font, the same opening wipe and sounds as a real NPC's line.
//
// Format (read from the disc files; tests/ and tools/verify_dialogue_pack.mjs round-trip real entries through it):
//   pack  = u32 count, then count+1 u32 offsets (relative to the pack start), then NUL-terminated strings
//   line  = 02 07 <name> 02 07 <text> 02 02 02 00
//   text  = letters/digits as single bytes (0-9 = 04..0d, A-Z = 0e.., a-z = 28..), word space = 01 01,
//           line break = 02 01, page break = 02 02 02 02 03, and a few punctuation codes (PUNCT below)
// Characters the disc text has no code for are dropped, never guessed.

const PUNCT = {
    " ": [0x01, 0x01], ".": [0x01, 0x05], ",": [0x01, 0x04], "'": [0x01, 0x13], "-": [0x01, 0x1a],
    ":": [0x01, 0x07], "\"": [0x01, 0x14], "!": [0xe7], "?": [0xe6],
};

/** One character -> its bytes (empty when the disc text has no code for it). */
export function encodeChar(ch) {
    const c = ch.charCodeAt(0);
    if (ch >= "0" && ch <= "9") return [0x04 + (c - 0x30)];
    if (ch >= "A" && ch <= "Z") return [0x0e + (c - 0x41)];
    if (ch >= "a" && ch <= "z") return [0x28 + (c - 0x61)];
    if (ch === "’") return PUNCT["'"];
    return PUNCT[ch] ?? [];
}

const encodeText = (s) => [...s].flatMap(encodeChar);

/** Wrap one paragraph into lines of at most `width` characters (words are never split unless longer than a line). */
export function wrap(text, width = 22) {
    const lines = [];
    let line = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        if (!line) line = word;
        else if (line.length + 1 + word.length <= width) line += " " + word;
        else { lines.push(line); line = word; }
        while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width); }
    }
    if (line) lines.push(line);
    return lines;
}

/** Text -> pages of at most `perPage` lines each: [[line, ...], ...]. A blank line starts a new page; a single newline breaks the line. */
export function paginate(text, { width = 22, perPage = 3 } = {}) {
    const pages = [];
    for (const para of String(text).split(/\n\s*\n/)) {
        const lines = para.split("\n").flatMap((l) => wrap(l, width));     // a single newline is a hard line break
        for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
    }
    return pages.length ? pages : [[""]];
}

/** Pages -> the bytes of one line (name tab + text). */
export function encodeLine(name, pages) {
    const out = [0x02, 0x07, ...encodeText(String(name ?? "").slice(0, 20)), 0x02, 0x07];
    pages.forEach((page, p) => {
        if (p > 0) out.push(0x02, 0x02, 0x02, 0x02, 0x03);
        page.forEach((line, i) => { if (i > 0) out.push(0x02, 0x01); out.push(...encodeText(line)); });
    });
    out.push(0x02, 0x02, 0x02, 0x00);
    return Uint8Array.from(out);
}

/** A whole pack holding that one line as entry 0 (the form `dialogueBox.open({ pack, index: 0 }, ...)` takes). */
export function buildPack(name, pages) {
    const line = encodeLine(name, pages);
    const first = 4 + 4 * 2;                         // count, then two offsets
    const bytes = new Uint8Array(first + line.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, true);
    view.setUint32(4, first, true);
    view.setUint32(8, bytes.length - 1, true);       // the end of the last string
    bytes.set(line, first);
    return bytes;
}

/** The inverse, for tests: the bytes of a line -> { name, pages } (null if it uses a code this module does not know). */
export function decodeLine(bytes) {
    const rev = new Map(Object.entries(PUNCT).map(([ch, b]) => [b.join(","), ch]));
    let i = 0;
    const take = () => {
        let s = "";
        const pages = [[""]];
        for (; i < bytes.length; ) {
            const c = bytes[i];
            if (c === 0x02 && bytes[i + 1] === 0x07) break;
            if (c === 0x02 && bytes[i + 1] === 0x01) { pages.at(-1).push(""); i += 2; continue; }
            if (c === 0x02 && bytes[i + 1] === 0x02 && bytes[i + 2] === 0x02 && bytes[i + 3] === 0x02 && bytes[i + 4] === 0x03) { pages.push([""]); i += 5; continue; }
            if (c === 0x02 && bytes[i + 1] === 0x02 && bytes[i + 2] === 0x02 && (bytes[i + 3] === 0x00 || i + 3 >= bytes.length)) { i += 3; break; }
            let ch = null;
            if (c >= 0x04 && c <= 0x0d) ch = String.fromCharCode(0x30 + c - 0x04);
            else if (c >= 0x0e && c <= 0x27) ch = String.fromCharCode(0x41 + c - 0x0e);
            else if (c >= 0x28 && c <= 0x41) ch = String.fromCharCode(0x61 + c - 0x28);
            if (ch !== null) { pages.at(-1)[pages.at(-1).length - 1] += ch; i += 1; continue; }
            const two = rev.get(`${c},${bytes[i + 1]}`);
            if (two !== undefined) { pages.at(-1)[pages.at(-1).length - 1] += two; i += 2; continue; }
            const one = rev.get(String(c));
            if (one !== undefined) { pages.at(-1)[pages.at(-1).length - 1] += one; i += 1; continue; }
            return null;
        }
        return pages;
    };
    if (bytes[0] !== 0x02 || bytes[1] !== 0x07) return null;
    i = 2;
    let name = "";
    for (; i < bytes.length && !(bytes[i] === 0x02 && bytes[i + 1] === 0x07); i++) {
        const c = bytes[i];
        if (c >= 0x0e && c <= 0x27) name += String.fromCharCode(0x41 + c - 0x0e);
        else if (c >= 0x28 && c <= 0x41) name += String.fromCharCode(0x61 + c - 0x28);
        else if (c >= 0x04 && c <= 0x0d) name += String.fromCharCode(0x30 + c - 0x04);
        else if (c === 0x01 && bytes[i + 1] === 0x01) { name += " "; i++; }
        else return null;
    }
    i += 2;
    const pages = take();
    return pages ? { name, pages } : null;
}
