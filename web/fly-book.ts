// web/fly-book.js -- the FLY screen (web/book-host.js book): the visited fly points in the QUESTS list window. Rules: web/fly-points.js.
// Up / down move, confirm (circle) chooses and shuts the book (web/game.js then flies once the pause list is gone), Back (cross) leaves.
import { WORD } from "./ui-kit-input.js";
import { LIST_WINDOW, drawHeader, drawHelpBox, drawListWindow, listRowY } from "./ui-kit.js";
import { drawCursor, drawText } from "./uifont.js";
import { FLY_ROW_LABEL, NO_PLACE_LINE, createFlyModel } from "./fly-points.js";
import type { FlyPlace } from "./fly-points.js";

/** What the book is handed: the sound kit, `data()` for the places, `choose(place)` for the pick. */
interface FlyBookArgs {
    sfx?: { play?: (name: string) => void } | null;
    data: () => { places: FlyPlace[] };
    choose?: (place: FlyPlace) => void;
}

/** `data()` = { places } read when it opens; `choose(place)` is called with the chosen { id, label } just before the book shuts. */
export function createFlyBook({ sfx = null, data, choose }: FlyBookArgs = {} as FlyBookArgs) {
    const model = createFlyModel(data().places);
    return {
        windows: ["title", "list", "help"],
        wall: false,
        model,
        act(buttons) {
            if (buttons.has(WORD.back)) return "back";
            if (buttons.has(WORD.confirm) && model.current()) { choose?.(model.current()!); return "back"; }
            const d = buttons.has("up") ? -1 : buttons.has("down") ? 1 : 0;
            if (d && model.move(d)) sfx?.play?.("system02");
            return null;
        },
        draw(ctx, view) {
            const pt = view.progress("title"), pl = view.progress("list"), ph = view.progress("help");
            drawHeader(ctx, pt, FLY_ROW_LABEL);
            drawListWindow(ctx, pl, Math.max(2, model.count()));
            if (pl >= 1) {
                model.places().forEach((p, i) => drawText(ctx, p.label, LIST_WINDOW.textX, listRowY(i)));
                if (model.count()) drawCursor(ctx, view.ticks * 2, LIST_WINDOW.cursorX, listRowY(model.index()));
            }
            drawHelpBox(ctx, ph, model.count() ? "Choose where your partner flies you." : NO_PLACE_LINE);
        },
    };
}
