// web/world-globe-book.js -- the pause MAP screen when OPTIONS > GAME > Map screen is New: the World Globe (web/world-globe-view.js)
// in a book (web/book-host.js) laid out like the other books: header bar "MAP" with the server's name, one wide panel holding the
// globe, the help band with your place and the keys. It opens from the pause list's MAP row (web/status-translated.js ->
// web/game/vars.js openBook) turned to your place on the server you are on, the "you are here" marker standing on it.
// All places show (the disc's page hides unexplored areas; that is not decided for the globe).
//
// Keys (web/ui-kit-input.js words; the keyboard and the pad's d-pad / left stick feed the same words): held arrows turn,
// held L1 / R1 (Q / E, the books' paging buttons) zoom in / out, Back (cross) leaves.
// If the globe cannot be drawn (its files fail to load), the book shuts at once and `onFail` makes the MAP row open the disc's page.
import { WORD } from "./ui-kit-input.js";
import { drawFooter, drawHeader, drawPanel, panelPixelHeight, withFold } from "./ui-kit.js";
import { drawText, textWidth } from "./uifont.js";
import { BAND_TEXT_W, fitByWidth } from "./text-fit.js";
import { artHook } from "./ui-c/capture.js";
import { globeStartView, stepGlobeView } from "./world-globe-map.js";
import type { Book, BookView } from "./types/screens.js";
import type { GlobeCamView, GlobeHereInput, GlobeServer, GlobeStageLike } from "./types/world-globe-map.js";

const PANEL_BANDS = 8;
/** One panel the width of the box (8 columns of 40 px), 154 px tall from under the header to the help band (y 40..194);
 *  the globe picture sits inside it, away from its frame (the GLOSSARY model panel's insets: 8 px at the sides, 6 above and below). */
export const GLOBE_LAYOUT = Object.freeze({
    panel: Object.freeze({ x: 0, y: 40, cols: 8, bands: PANEL_BANDS, pivot: Object.freeze([160, 40 + panelPixelHeight(PANEL_BANDS) / 2]) }),
    image: Object.freeze({ x: 8, y: 46, w: 304, h: panelPixelHeight(PANEL_BANDS) - 12 }),
});
const SERVER_NAME: Readonly<Record<GlobeServer, string>> = { asuka: "Asuka", amaterasu: "Amaterasu" };
const KEYS_HINT = "Arrows: turn   L1 / R1: zoom";
const LOADING = "Loading the globe...";
/** The words that move the globe while held. */
const MOVE_WORDS: readonly string[] = ["left", "right", "up", "down", WORD.prev, WORD.next];

export interface GlobeBookArgs {
    /** the globe (web/world-globe-view.js createGlobeStage); its renderer is already made (the MAP row checked) */
    stage: GlobeStageLike;
    /** where you stand, read once when the book opens */
    here: () => GlobeHereInput;
    /** the buttons held right now (web/game.js state.keys): a direction keeps turning while it stays down */
    held: () => Iterable<string>;
    /** the globe failed: the book shuts and the MAP row's own page (the disc's) opens instead */
    onFail: () => void;
}

/** The book, plus a look at its camera for the tests. */
export interface GlobeBook extends Book {
    view(): GlobeCamView;
}

export function createGlobeBook({ stage, here, held, onFail }: GlobeBookArgs): GlobeBook {
    const h = here();
    stage.open(h);
    let view: GlobeCamView = globeStartView(h.server, null), placed = false, failed = false;
    // a move word counts once it has acted (pressed or repeated, so a button held since the book opened does nothing) and
    // keeps counting while it stays down
    const active = new Set<string>();
    /** once the globe is in: turn to your place (nothing is drawn before, so this is no jump) */
    const settle = (): void => {
        if (placed || stage.status() !== "ready") return;
        view = globeStartView(h.server, stage.place());
        placed = true;
    };
    const placeName = h.name.replace(/\n/g, " / ");
    return {
        windows: ["title", "globe", "help"],
        wall: false,
        // look C (web/ui-c/books.js): no list rows, the globe is a picture on the art layer over the C panel
        look: Object.freeze({ rows: false }),
        view: () => view,
        act(buttons: ReadonlySet<string>) {
            if (stage.status() === "failed") {
                if (!failed) { failed = true; onFail(); }
                return "back";
            }
            if (buttons.has(WORD.back)) return "back";
            settle();
            const down = new Set(held());
            for (const w of MOVE_WORDS) {
                if (buttons.has(w)) active.add(w);
                else if (!down.has(w)) active.delete(w);
            }
            if (placed) {
                view = stepGlobeView(view, {
                    left: active.has("left"), right: active.has("right"), up: active.has("up"), down: active.has("down"),
                    zoomIn: active.has(WORD.prev), zoomOut: active.has(WORD.next),
                });
            }
            return null;
        },
        draw(ctx: CanvasRenderingContext2D, bv: BookView) {
            settle();
            const pt = bv.progress("title"), pg = bv.progress("globe"), ph = bv.progress("help");
            drawHeader(ctx, pt, h.server ? `MAP: ${SERVER_NAME[h.server]}` : "MAP");
            const P = GLOBE_LAYOUT.panel, I = GLOBE_LAYOUT.image;
            withFold(ctx, pg, P.pivot[0], P.pivot[1], "x", () => drawPanel(ctx, P.x, P.y, P.cols, P.bands));
            let drawn = false;
            if (pg >= 1) {
                // look C (web/ui-c): the globe goes on the scope's art canvas, over the C panel; outside a scope it is painted here
                const paint = (c: CanvasRenderingContext2D): void => { drawn = stage.draw(c, I.x, I.y, I.w, I.h, view); };
                if (!artHook(ctx, paint)) paint(ctx);
                if (!drawn) drawText(ctx, LOADING, I.x + (I.w - textWidth(LOADING)) / 2, I.y + (I.h - 12) / 2, { clut: 7 });
            }
            const line1 = placeName ? fitByWidth(`You are here: ${placeName}`, (s) => textWidth(s), BAND_TEXT_W) : "";
            drawFooter(ctx, ph, line1, drawn ? KEYS_HINT : "");
        },
        close() { stage.close(); },
    };
}
