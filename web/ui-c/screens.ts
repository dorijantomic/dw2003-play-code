// web/ui-c/screens.js -- look C kit: which composer each screen uses. One entry per screen family; the owner file passes it to the scope.
import { dx } from "./geometry.js";
import { composeGeneric } from "./generic.js";
import { composePauseHome } from "./home.js";
import { composePausePage, composeWindowPage, composeCapsule, composeListPage, cyclePulse } from "./pages.js";
import { composeSheetParts, composeReport as composeReportParts } from "./sheets.js";
import { isPauseHome, isSidebarPage, hasClip, CMFONT_DIR, STSTAT_DIR, STATUS_CLIPS } from "./claims.js";
import { composeNameEntry, composeMemcard, composeNet, composeWizard, composeMapPage, composeEnd, composeLanguage } from "./fullpages.js";
import { composeBook, composeQuests } from "./books.js";
import type { UiPart, UiRun } from './types.js';
interface ScreenContext {
  parts: (UiPart & { part: string })[];
  runs: UiRun[];
}



export const composeProbe = (c: ScreenContext): (UiPart & { part: string })[] => composeGeneric(c, {});

/** C4: the big faint word sits right of the stat window (470 dp), 600 dp down, 130 dp tall. */
export const STATUS_WORD = Object.freeze({ word: "STATUS", at: Object.freeze({ x: dx(470), y: 600 / 3 }), sizeDp: 130 });

/**
 * The status sheet family (status, See Digivolve, See Equipment, the equipment item grid). The cmfont money plate (26) drawn high on the
 * page is the EXP plate here (the money plate sits at the bottom of the other sidebar pages).
 */
export function composeStatusPage({ parts, runs }) {
    const sheet = parts.map((p: { part: string; y: number; }) => (p.part === "money" && p.y < 120 ? { ...p, part: "expPlate" } : p));
    return composePausePage({ parts: sheet, runs }, {
        word: STATUS_WORD.word, wordAt: STATUS_WORD.at, wordDp: STATUS_WORD.sizeDp, wall: false,
        extra: (ps, rs, used, out) => composeSheetParts(ps, rs, used, out),
    });
}

/**
 * The pause screen that is up: { id, compose } or null (a page not finished yet stays pixel). Decided from the frame's own draw calls
 * only: `entry` (the page the menu was opened on) is not a test, so backing out of any page to the home keeps look C.
 */
export function pickPauseScreen(calls, _entry: string | null) {
    if (isPauseHome(calls)) return { id: "home", compose: composePauseHome };
    // the ITEMS bag: the full-width list window (ststat 46), no party cards
    if (hasClip(calls, STSTAT_DIR, 46)) return { id: "bag", compose: (c: ScreenContext) => composeListPage(c, { word: "ITEMS" }) };
    // the MAP page: its place-name window (ststat 59) over the game's map picture
    if (hasClip(calls, STSTAT_DIR, 59)) return { id: "map", compose: composeMapPage };
    if (isSidebarPage(calls)) {
        if (STATUS_CLIPS.some((id) => hasClip(calls, STSTAT_DIR, id))) return { id: "status", compose: composeStatusPage };
        const word = hasClip(calls, CMFONT_DIR, 28) || hasClip(calls, CMFONT_DIR, 27) || hasClip(calls, CMFONT_DIR, 25) ? "ITEMS" : "PARTY";
        return { id: "sidebar", compose: (c) => composePausePage(c, { word }) };
    }
    // the QUESTS page (our own, engine/dw3/ui/native/pause-quests.ts): the list window (cmfont 36) and the description band (ststat 32)
    if (hasClip(calls, CMFONT_DIR, 36) || (hasClip(calls, STSTAT_DIR, 32) && hasClip(calls, CMFONT_DIR, 24))) return { id: "quests", compose: composeQuests };
    return null;
}

export const composeWindow = (c) => composeWindowPage(c, {});
/** The help counter: its cmfont 69 window carries the topic text (no cursor) = the C message band (T6). */
export const composeHelp = (c: ScreenContext) => composeWindowPage(c, { messageWindow: true });
/** The fight report (STFRPT): sheets.js, the highlight in the game's colour cycle. */
export const composeReport = (c, cfg = {}) => composeReportParts(c, { pulse: cyclePulse, ...cfg });
export { composeCapsule };

// ------------------------------------------------------------------------------------------------ full-screen pages (T7, fullpages.js)
/** Name entry: the partner chooser and the keyboard (NAME word). */
export const composeName = (c: ScreenContext): UiPart[] => composeNameEntry(c, { word: "NAME" });
/** The deck screens: the folder rename is the name keyboard (a keyboard part), every other deck page the window page. */
export const composeDeck = (c: { parts: (UiPart & { part: string })[]; runs: UiRun[] }): UiPart[] => (c.parts.some((p: { part: string; }) => p.part === "keyboard") ? composeNameEntry(c, { word: "NAME" }) : composeWindow(c));
/** The language page: its frames and backdrop claimed (claims.js cntselwn), the flags and words the game's pictures. */
export { composeMemcard, composeNet, composeWizard, composeMapPage, composeEnd, composeLanguage };

// ------------------------------------------------------------------------------------------------ our own screens (T9, books.js)
/** A book (web/book-host.js): `look` = the book's own cfg ({ rows: false } for the map book); the runs are uifont drawText (clut 7 = dim). */
export const composeBookScreen = (look = {}) => (c): UiPart[] => composeBook(c, { dimClut: true, ...look });
/** The Digivolve Demo setup page (web/menu.js, the one page that still draws through the old menu module): the sidebar page family. */
export const composeDemo = (c: ScreenContext): UiPart[] => composePausePage(c, {});
export { composeQuests };
