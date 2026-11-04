// The game's own reaction bubbles over a friend's head — F2 -> Extras -> "The game's own
// reaction bubbles", OFF by default.
//
// With the switch on, two of multiplayer's eight emotes (web/multiplayer.js EMOTES) stop
// being a typed character and become the disc's own mark: FIELDCOM balloon id 0x35 with a
// glyph row from the game's own program table, exactly what it puts over an NPC
// (web/fieldcom.js drawIndicatorBubble — balloon + program row, both decoded from
// FIELDSTG.PRO). Only two of the eight emotes have a row in that table:
//
//   emote 1  "!"  -> KIND.exclaim, program 0  (one step: id 0, delay 60)
//   emote 3  "..." -> KIND.dots,  program 3  (four steps: 5, 6, 7, then 53 held for 60)
//
// The emote NUMBERS are the ones the game's own list uses — EMOTES = ["♥", "!", "?", "...",
// "♪", ":)", "GG", "zZ"] — so "!" is 1, not 0 (0 is the heart). The card that ordered this
// called it 0; the code says 1, and the feature is the "!" button, so 1.
//
// The other six keep their typed glyph, which is the honest fallback: the heart has no row
// (KIND.smoke 1 is a puff, not a heart), "?"/"♪"/":)"/"GG"/"zZ" have none either, and kinds
// 6..10 are the four direction arrows and the lift arrow — they mean "go this way" in a
// field script, not an emote. Nothing is invented here.
//
// Pure module: no canvas, no window, no imports (a node test pins it).

/** emote index -> FIELDCOM glyph-program row (the numbers in web/fieldcom.js KIND). */
export const EMOTE_BUBBLE = { 1: 0, 3: 3 };

/** The FIELDCOM glyph row for emote index `i`, or null when the disc has no mark for it. */
export function bubbleFor(i) {
    if (typeof i !== "number" || !Number.isInteger(i)) return null;
    return Object.prototype.hasOwnProperty.call(EMOTE_BUBBLE, i) ? EMOTE_BUBBLE[i] : null;
}

/** The FIELDCOM program clock from a page clock: 60 frames a second, ten engine ticks a frame (web/fieldcom.js TICKS_PER_FRAME).
 *  Written as ms * 60 / 1000 (not nowMs / (1000 / 60)) so exactly 1000 ms is exactly 60 frames — the division rounds to 59.999… */
export function bubbleTick(nowMs) {
    return Math.floor(nowMs * 60 / 1000) * 10;
}
