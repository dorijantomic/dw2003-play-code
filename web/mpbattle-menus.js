// EXPERIMENT: the game's own battle menu screens and message box, for the many-vs-many fight (not original game content).
//
// The one-on-one battle draws its command list, TECH list, ITEM list, Digivolve form list, TAG list and its message line through
// translated pro/fightstg screens (web/battle*-translated.js). Those screens only need a 2D canvas, a language, and button
// presses, so the many-vs-many fight opens the very same ones over its 3D scene: the same panels, fonts, cursor, sounds, row
// greying and page arrows, with the game's own message window for what happens.
//
// What the fight screen gets from here:
//   open(mode, seed)   mode: "cmd" | "tech" | "item" | "form" | "tag"; the seed is what the one-on-one battle hands the same screen
//   update(dt)         null, or { mode, value } on the frame the player confirms (value -2 = cancelled), or { mode, failed: true }
//   press(button)      a pad button as a single press (up down left right circle cross triangle l1 r1)
//   say(lines, opts)   put lines in the message window, one page per line ("Name: text" shows the name above the text)
//   draw(ctx, w, h)    paint whichever is up, scaled from the game's 320 x 240 picture
import { ui, BattleMessageSession } from "./vendor/engine.js";
import { createBattleCommandTranslated } from "./battlecmd-translated.js";
import { createBattleTechTranslated } from "./battletech-translated.js";
import { createBattleItemTranslated } from "./battleitem-translated.js";
import { createBattleFormTranslated } from "./battleform-translated.js";
import { createBattleTagTranslated } from "./battletag-translated.js";
import { battleMsgPaint, battleMsgText } from "./battlemsg-translated.js";
import { loadPack } from "./screenpack.js";
import { drawText as uiDrawText, fontReady } from "./uifont.js";

const NATIVE_W = 320, NATIVE_H = 240;
const PAGE_MS = 1250;          // how long one line of the log stays in the window
const PAGE_FAST_MS = 800;      // when a lot happened at once

export function createMenus({ sfx = null, languageByte = () => 2 } = {}) {
    const getState = () => ({ languageByte: languageByte(), keys: new Set() });
    const widgets = {
        cmd: createBattleCommandTranslated(sfx, { getState }),
        tech: createBattleTechTranslated(sfx, { getState }),
        item: createBattleItemTranslated(sfx, { getState }),
        form: createBattleFormTranslated(sfx, { getState }),
        tag: createBattleTagTranslated(sfx, { getState }),
    };
    for (const w of Object.values(widgets)) { try { w.preload?.(); } catch { /* it loads on first open */ } }
    const packs = { pgfgc00: loadPack("pgfgc00"), cmfont: loadPack("cmfont") };
    const msg = new BattleMessageSession({ textOf: battleMsgText, paint: () => {} });
    const clock = new ui.MenuDisplayClock();
    let mode = null;
    let pages = [], page = null, pageLeft = 0, hold = false, ms = PAGE_MS;

    const TAG = /([^]*)/g;
    // a log line -> a page: the game's own call (kind 4 "{1} damage!", kind 2 "Evade!" ...) when the line is one of its bank strings,
    // else the whole sentence on a single line
    const pageOf = (raw) => {
        const tags = [...String(raw ?? "").matchAll(TAG)];
        const text = String(raw ?? "").replace(TAG, "");
        const i = text.indexOf(": ");
        const name = i > 0 && i <= 18 ? text.slice(0, i) : null, body = name ? text.slice(i + 2) : text;
        if (name && tags.length === 1) {
            const [idx, ...nums] = tags[0][1].split(",").map(Number);
            if (idx === 0x0b && nums.length === 1) return { spec: { kind: 4, payload: [0, nums[0]], name, slots: [String(nums[0])] } };
            if (!nums.length && body === battleMsgText(0x7f, idx)) return { spec: { kind: 2, payload: [idx], name } };
        }
        return { lines: [text] };
    };
    const showPage = (p) => { page = p; if (p.spec) msg.openOriginal(p.spec); else msg.open(p.lines); };

    return {
        get mode() { return mode; },
        isOpen: () => mode != null,
        failed: (m = mode) => !!widgets[m]?.failed(),
        open(m, seed) {
            if (mode && mode !== m) widgets[mode].close();
            mode = m;
            const w = widgets[m];
            if (m === "cmd") w.open(seed?.row | 0, seed ?? {}); else w.open(seed ?? {});
            return true;
        },
        close() { if (mode) { widgets[mode].close(); mode = null; } },
        press(button) { if (mode) widgets[mode].press(button); },
        /** Show log lines in the window, a page each. opts.hold keeps the last page up. */
        say(lines, opts = {}) {
            pages = [].concat(lines).filter((l) => l != null && l !== "").map(pageOf);
            hold = !!opts.hold;
            page = null; pageLeft = 0;
            if (!pages.length) { msg.open([]); return; }
            if (pages.length > 8) pages = pages.slice(-8);
            ms = opts.ms ?? (pages.length > 4 ? PAGE_FAST_MS : PAGE_MS);
        },
        clearSay() { pages = []; page = null; msg.open([]); hold = false; },
        /** True while log lines are still going through the window. */
        busy: () => pages.length > 0 || (!!page && !hold && pageLeft > 0),
        update(dt) {
            for (const f of clock.advance(dt)) msg.tick(f.tick, 0);
            if (!mode) {                                    // message window paging (never while a menu is up)
                if (!page && pages.length) { showPage(pages.shift()); pageLeft = ms; }
                else if (page) {
                    pageLeft -= dt * 1000;
                    if (pageLeft <= 0 && pages.length) { showPage(pages.shift()); pageLeft = ms; }
                    else if (pageLeft <= 0 && !hold) { page = null; msg.open([]); }
                }
                return null;
            }
            const w = widgets[mode];
            if (w.failed()) { const m = mode; mode = null; return { mode: m, failed: true }; }
            const v = w.update(null, dt);
            if (v === null || v === undefined) return null;
            const m = mode;
            w.close(); mode = null;
            return { mode: m, value: v };
        },
        draw(ctx, cw, ch) {
            ctx.save();
            ctx.scale(cw / NATIVE_W, ch / NATIVE_H);
            if (mode) {
                const w = widgets[mode];
                if (w.active()) {
                    if (mode === "tag") w.draw(ctx, NATIVE_W); else w.draw(ctx, NATIVE_W, NATIVE_H);
                }
            } else if (page && msg.active && !msg.finished) {
                const nativeText = (text, x, y, opts = {}) => {
                    if (fontReady()) return uiDrawText(ctx, String(text), x, y, opts);
                    ctx.fillStyle = "#f2f2f2"; ctx.font = "10px monospace"; ctx.textBaseline = "top"; ctx.fillText(String(text), x, y);
                };
                const frame = msg.frame();
                battleMsgPaint(ctx, { ...frame, prompt: null }, nativeText, packs);   // (nobody closes it with a button: it pages itself)
            }
            ctx.restore();
        },
        diagnostics: () => ({ mode, page, queued: pages.length, widgets: Object.fromEntries(Object.entries(widgets).map(([k, w]) => [k, { open: w.isOpen(), active: w.active(), failed: w.failed() }])) }),
    };
}
