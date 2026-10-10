// Draw the native screen's live text widgets through the existing UI font
// renderer (web/uifont.js), which is the same CMFONTTM atlas + EXE glyph tables
// the original text service reads (docs/research/ui/screen-render-contract.md).
//
// Phase 2/4 bridge. The text service F0x800197a4 writes its own prims and never
// calls ctx+0x84, so its output is not in the picture draw-intent stream; the
// widgets it draws are tracked through the interpreter's object list instead
// (web/native-screen.js nativeTextWidgets).
//
// Byte codec (corrected by the screen-text-widget answer, authority 2 asm
// fns.s L14433-14534 + codepoint.rs): a single byte c>=4 indexes the basic
// glyph table at c-4 (0x04+d digits, 0x0e+n A-Z, 0x28+n a-z); the TWO-byte pair
// `0x01, N` is extended glyph N-1 (NOT 0x81 — that is a single-byte kana and
// the extractor's docstring was wrong). Space is extended index 0, i.e.
// `0x01, 0x01`. Extended tokens come from the shipped uifont charset so uifont
// resolves them; unresolved codes are counted, never guessed.

import { drawText, fontReady } from "./uifont.js";
import { ui } from "./vendor/engine.js";
const { decodeTextToken } = ui;

const FONT_BANK_BASE = 0x8004dd74; // *(0x8004de00); kind stride 0x18

// Glyph index -> charset token (charset entries with t==="e" for extended and
// t==="b" for basic), built from the same asset uifont.js reads. The decoder
// returns a basic code 0x04..0xE9 or an extended code 0x01..0x72; the stepper
// maps them to basic index code-4 and extended index code-1.
const extTokens = {};
const basicTokens = {};
fetch("assets/ui/uifont.json")
    .then((r) => r.json())
    .then((j) => {
        for (const [token, info] of Object.entries(j.chars || {})) {
            if (!info) continue;
            if (info.t === "e") extTokens[info.i] = token;
            else if (info.t === "b") basicTokens[info.i] = token;
        }
    })
    .catch(() => {});

// `0x02,N` is a control token; its byte length comes from the original's table
// D0x8004ddd4[N] (data.rs:4072-4085): 0=1, 1=newline=2, 2=pause=3, 3=clear=2,
// 4=no-op=5, 5=inline value substitution=3, 6=trigger=3, 7/9=2, 8=name=3, 10=0.
// The stepper F0x8001a48c consumes these; only 0x01,N and 0x03 are single-token
// forms (0x03 is a one-byte placeholder, NOT a two-byte pair).
const TOKEN_LEN = [1, 2, 3, 2, 5, 3, 3, 2, 3, 2, 0];

/**

 * `slots` = the widget's other line-record decoded strings, indexed by record
 * (F0x8001aa10 renders widget+0x5C+N*0xC inline for 0x02,0x05,N).
 */
export function decodeNativeText(bytes, slots = []) {
    let out = "";
    const unknown = [];
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 0x00) break;
        if (b === 0x01) {
            // two-byte extended pair: next byte N -> ext glyph N-1
            const n = bytes[++i];
            if (n === undefined) {
                unknown.push(0x01);
                break;
            }
            const token = extTokens[n - 1];
            if (token === undefined) {
                unknown.push(0x100 | n);
                out += "\uFFFD";
            } else {
                out += token;
            }
        } else if (b === 0x02) {
            const n = bytes[i + 1];
            if (n === undefined) {
                unknown.push(0x02);
                break;
            }
            const len = TOKEN_LEN[n] ?? 2;
            if (n === 1) out += "\n"; // newline
            else if (n === 5) out += slots[bytes[i + 2]] ?? ""; // 0x02,0x05,slot
            else if (n === 2) break; // pause: the drawer stops this element
            // 0 (1 byte), 3 clear, 4/6/7/8/9: no glyph in these strings
            i += Math.max(1, len) - 1;
        } else if (b === 0x03) {
            // one-byte placeholder (font base glyph); no text
        } else if (b >= 0x04 && b <= 0x0d) out += String.fromCharCode(0x30 + (b - 0x04));
        else if (b >= 0x0e && b <= 0x27) out += String.fromCharCode(0x41 + (b - 0x0e));
        else if (b >= 0x28 && b <= 0x41) out += String.fromCharCode(0x61 + (b - 0x28));
        else if (basicTokens[b - 4] !== undefined) out += basicTokens[b - 4];
        else {
            unknown.push(b);
            out += "\uFFFD";
        }
    }
    return { text: out, unknown };
}

/**
 * Decode a line whose record +0xA convert flag is set, through the translated
 * resident decoder F0x8001D264 (`engine/dw3/ui/text-decode.ts`). In this mode
 * every byte >= 4 is the lead of a two-byte Shift-JIS pair, 0x0A is a one-byte
 * newline, and a table miss draws basic glyph 0 without being an unknown.
 *
 * `limit` is the number of SOURCE bytes to consume — the element's reveal
 * window — so a converted line can be paged exactly like a raw one. Omit it to
 * decode to the line's own end token, the pre-window behaviour.
 */
export function decodeConvertedText(reader, ptr, font, slots = [], limit = Infinity) {
    let out = "";
    const unknown = [];
    let cursor = ptr;
    for (let guard = 0; guard < 4096; guard++) {
        if (cursor - ptr >= limit) break;
        const v = decodeTextToken(reader, cursor, 1, font) >>> 0;
        const type = (v >> 8) & 0xff;
        const code = v & 0xff;
        if (type === 4) break;
        if (type === 0) {
            const token = basicTokens[code - 4];
            if (token === undefined) {
                unknown.push(v);
                out += "\uFFFD";
            } else out += token;
            cursor += 2;
            continue;
        }
        if (type === 1) {
            const token = extTokens[code - 1];
            if (token === undefined) {
                unknown.push(v);
                out += "\uFFFD";
            } else out += token;
            cursor += 2;
            continue;
        }
        if (type === 3) {
            // A pair outside both tables draws the blank glyph; the original
            // does not call it unknown.
            cursor += 2;
            continue;
        }
        if (type === 2) {
            if (code === 1) {
                out += "\n";
                cursor += 1;
                continue;
            }
            if (code === 5) {
                out += slots[reader.read8(cursor + 2)] ?? "";
                cursor += 3;
                continue;
            }
            if (code === 2) break;
            cursor += Math.max(1, TOKEN_LEN[code] ?? 2);
            continue;
        }
        cursor += 1;
    }
    return { text: out, unknown };
}

function kindOf(w) {
    const k = (w.font - FONT_BANK_BASE) / 0x18;
    if (Number.isInteger(k) && k >= 1 && k <= 3) return k;
    // Naming installs an overlay-local font record with its own offsets. Match
    // its texture coordinates to the resident face rather than clamping its
    // pointer to the smallest face.
    const sample = w.read32(w.font + 4) + 10 * 11;
    for (let kind = 1; kind <= 3; kind++) {
        const base = w.read32(FONT_BANK_BASE + kind * 0x18 + 4) + 10 * 11;
        if ([0, 1, 2, 5, 6].every(i => w.read8(sample + i) === w.read8(base + i))) return kind;
    }
    return null;
}

/**
 * The bytes the translated drawer paints for a widget: line 0 from the reveal
 * start (+0xA6) up to the reveal end (+0xA4), clamped to the line
 * (engine/dw3/ui/text-drawer.ts drawTextElement). A typewriter shows the part
 * revealed so far, and a page after a wait or a clear starts at its own byte.
 */
export function revealedRun(w) {
    const bytes = w.lines?.[0]?.bytes ?? [];
    const first = Math.max(0, Math.min(bytes.length, w.revealFirst | 0));
    const end = Math.max(first, Math.min(bytes.length, w.revealEnd | 0));
    return bytes.slice(first, end);
}

/**
 * Decode one visible widget line, honouring the element's own reveal window:
 * with `revealWindow` only the `first`..`end` bytes of the line's buffer are
 * decoded (the pair that makes text page), otherwise the whole line.
 *
 * The per-line DECODER CHOICE must not depend on the window. A line whose
 * record carries the convert flag is read by the converted (translated) decoder
 * whether or not a window is painted; a line that is not converted is read by
 * the raw decoder. Making the window force the raw decoder is exactly the
 * regression that turned the wizard's name-entry text back into the console
 * encoding: the window is a playback detail, not a change of string source.
 */
export function decodeWidgetLine(w, line, slots = [], { revealWindow = false } = {}) {
    const bytes = line.bytes ?? [];
    const range = (limit) => {
        const first = Math.max(0, Math.min(limit, w.revealFirst | 0));
        const end = Math.max(first, Math.min(limit, w.revealEnd | 0));
        return [first, end];
    };
    const converted = line.flag !== 0 && typeof w.read8 === "function" && line.ptr >= 0x80000000;
    if (!converted) {
        const [first, end] = revealWindow ? range(bytes.length) : [0, bytes.length];
        return decodeNativeText(bytes.slice(first, end), slots);
    }
    if (!revealWindow) return decodeConvertedText(w, line.ptr, w.font, slots);
    const [first, end] = range(bytes.length);
    return decodeConvertedText(w, line.ptr + first, w.font, slots, end - first);
}

/**
 * Draw every visible text widget's non-empty lines.
 * `opts.revealWindow` paints only each widget's revealed run (the conversation
 * box); without it, the whole of line 0 is painted (the other screens). Returns counters plus the
 * decoded texts so a check can assert real strings, not just call counts.
 */
export function drawNativeTextWidgets(ctx, widgets, opts = {}) {
    const stats = { ready: fontReady(), widgets: widgets.length, lines: 0, drawn: 0, unknown: 0, texts: [] };
    if (!fontReady()) return stats;
    for (const w of widgets) {
        if (!w.visible) continue;
        const kind = kindOf(w);
        if (kind === null) { stats.unknown += 1; continue; }
        // Decode every line first so a 0x02,0x05,N substitution can render the
        // referenced line record's own string inline.
        const plain = w.lines.map((l) => (l.bytes && l.len ? decodeNativeText(l.bytes).text : ""));
        // Records 1–5 are insert values, not additional visible text lines.
        // Newlines are authored inside line 0 (text-drawer.ts TEXT_DRAW.line0).
        for (const line of w.lines.slice(0, 1)) {
            if (!line.bytes || !line.len) continue;
            const { text, unknown } = decodeWidgetLine(w, line, plain, opts);
            stats.lines += 1;
            stats.unknown += unknown.length;
            if (!text || text === "\uFFFD") continue;
            // +0xBC != 0 => the run ends at penX (right-aligned number field).
            const x = w.alignWidth ? w.penX - w.alignWidth : w.penX;
            const parts = text.split("\n");
            for (let k = 0; k < parts.length; k++) {
                if (!parts[k]) continue;
                drawText(ctx, parts[k], x, w.penY + k * w.lineHeight, {
                    kind, clut: w.colour,
                    cellWidth: w.fixedPitch ? w.cellWidth : null,
                    glyphMetrics: (info) => {
                        if (!info) return {};
                        const rec = w.read32(w.font + (info.t === "b" ? 4 : 8)) + info.i * 11;
                        const signed = n => (n << 24) >> 24;
                        return { dx: signed(w.read8(rec + 7)), dy: signed(w.read8(rec + 8)), adv: w.read8(rec + 9) };
                    },
                });
            }
            stats.drawn += 1;
            stats.texts.push(text);
        }
    }
    return stats;
}
