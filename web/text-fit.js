// web/text-fit.js -- fit text to a pixel width by MEASURING it, never by counting characters. Pure: the caller passes the
// measuring function (web/uifont.js textWidth, which falls back to 7 px a letter until the font has loaded).
//
// Why: the QUESTS page cut its lines at 36 characters (web/quests.js) and the description band's one-line sentence ran off the
// right edge; the font is proportional, so a character count is wrong in both directions.

/** Longest start of `text` that fits `maxW` px, cut at a word end when one fits (never an ellipsis: the pause font has none). */
export function fitByWidth(text, widthOf, maxW) {
    const s = String(text ?? "").trim();
    if (widthOf(s) <= maxW) return s;
    const words = s.split(/\s+/);
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (widthOf(next) > maxW) break;
        line = next;
    }
    if (line) return line;
    let cut = s;                                   // one word wider than the box: cut letters
    while (cut.length > 1 && widthOf(cut) > maxW) cut = cut.slice(0, -1);
    return cut;
}

/** `text` broken into lines no wider than `maxW` px, on spaces. A word wider than the box gets a line of its own, cut to fit. */
export function wrapByWidth(text, widthOf, maxW) {
    const out = [];
    let line = "";
    for (const word of String(text ?? "").split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (widthOf(next) <= maxW) { line = next; continue; }
        if (line) out.push(line);
        line = fitByWidth(word, widthOf, maxW);
    }
    if (line) out.push(line);
    return out;
}

/** The description band's text area: x 20 to the right edge of the 320 box with a 20 px margin (ststat clip 0x20, web/ui-kit.js FOOTER). */
export const BAND_TEXT_W = 280;

/** `text` as at most `n` lines of `maxW` px (the help box has two): wrapped, and only if it still needs more is the last line cut. */
export function wrapToLines(text, widthOf, maxW, n = 2) {
    const lines = wrapByWidth(text, widthOf, maxW);
    if (lines.length <= n) return lines;
    return [...lines.slice(0, n - 1), fitByWidth(lines.slice(n - 1).join(" "), widthOf, maxW)];
}
