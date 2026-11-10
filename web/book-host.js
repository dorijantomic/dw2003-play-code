// web/book-host.js -- runs ONE book screen (GLOSSARY, OPTIONS) over the pause menu's way out and back.
//
// How a book is opened: the pause list's row ends the list with { kind: "book", book, row } (engine/dw3/ui/
// pause-root-session.ts), web/status-translated.js calls opts.onBook(book, row), and web/game.js calls open(book, backToPause).
// The host then owns the screen the way the Card Album does (web/game.js menu.onCardAlbum): the field is frozen under it,
// every press is the book's, and when it shuts the pause list comes back on the row the player left.
//
// A book is: {
//   windows: ["title", "body", ...]      the folds, opened in this order, shut in reverse (web/ui-kit.js createFoldChain)
//   wall: boolean                        true = the drifting status wall behind it (full-screen pages); false = the dimmed field
//   act(buttons: Set<string>): "back" | null     one displayed frame's acting buttons (web/ui-kit-input.js); "back" shuts the book
//   tick?(): void                        one displayed frame, after act
//   draw(ctx, view): void                view = { progress(windowName), ticks, dt }, dt = seconds of the last frame; drawn in the 320 x 240 box
//   close?(): void                       the host is dropping the book (shut for good, or a lab reset)
// }
import { createKitInput, WORD } from "./ui-kit-input.js";
import { createFoldChain, dimField, SFX_OPEN, SFX_CLOSE } from "./ui-kit.js";
import { createStatusBackdrop } from "./status-backdrop.js";
import { isPadButton } from "./vendor/engine.js";

/** After the book has shut, wait for the player to let go of the pad (at most this many displayed frames) before the pause list returns. */
export const RELEASE_WAIT_FRAMES = 25;

export function createBookHost({ sfx = null, factories = {}, fx = () => (typeof window !== "undefined" ? window.__fx : null), setFx = (k, v) => window.__setFx?.(k, v), setFxMany = (o) => window.__setFxMany?.(o) } = {}) {
    const input = createKitInput();
    const backdrop = createStatusBackdrop();
    let book = null, chain = null, onBack = null;
    let ticks = 0, closing = false, waited = 0, lastDt = 0;

    const host = {
        isOpen: () => book !== null,
        /** Open `name` (a key of `factories`). `held` is the pad set right now (the confirm that chose the row is still down). */
        open(name, back = null, held = []) {
            const make = factories[name];
            if (!make || book) return false;
            book = make({ sfx, fx, setFx, setFxMany, host });
            onBack = back; ticks = 0; closing = false; waited = 0;
            chain = createFoldChain(book.windows, {
                onStart: (_name, opening) => sfx?.playPacked?.(opening ? SFX_OPEN : SFX_CLOSE),
            });
            input.reset(held);
            backdrop.reset();
            chain.open();
            return true;
        },
        /** Force it shut at once (a lab reset). */
        close() { book?.close?.(); book = null; chain = null; onBack = null; },
        /** One real frame: `dt` seconds, `held` = web/game.js state.keys. */
        update(dt, held) {
            if (!book) return;
            lastDt = dt;
            backdrop.update(dt);
            for (const act of input.advance(dt, held)) {
                ticks++;
                chain.tick();
                if (!closing && chain.phase() === "open") {
                    if (book.act(act) === "back") { closing = true; sfx?.play?.("system01"); chain.close(); }
                    book.tick?.();
                } else if (closing && chain.phase() === "shut") {
                    const down = [...held].some(isPadButton);
                    if (down && ++waited < RELEASE_WAIT_FRAMES) continue;
                    const back = onBack;
                    host.close();
                    // the buttons still down: the pause list must ignore them until they are let go (status-translated blockUntilReleased)
                    back?.([...held].filter(isPadButton));
                    return;
                }
            }
        },
        /** Paint over everything else. `viewW` x `viewH` is the canvas (640 x 480), `padL` the wide-screen pad each side. */
        draw(ctx, viewW, viewH, padL = 0, sidesByField = false) {
            if (!book) return;
            ctx.save();
            // sidesByField (wide overworld): the field cover dims the strips (web/game.js drawWideSideCovers), so the dim and the wall stop at the box.
            dimField(ctx, viewW, viewH, sidesByField ? 0 : padL, book.wall ? 1 : 0.5);
            // Same space as the native pause screen (web/game.js: ctx is the 640 x 480 box, the wide-screen strips lie outside
            // it at -padL and viewW + padL). Never stretch: one scale for both axes, box centred in the view.
            const k = Math.min(viewW / 320, viewH / 240);
            ctx.translate((viewW - 320 * k) / 2, (viewH - 240 * k) / 2);
            ctx.scale(k, k);
            if (book.wall) {
                if (sidesByField) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 320, 240); ctx.clip(); }
                backdrop.draw(ctx, 320, 240);
                if (sidesByField) ctx.restore();
            }
            book.draw(ctx, { progress: (n) => chain.folds[n].progress(), ticks, dt: lastDt });
            ctx.restore();
        },
    };
    return host;
}

export { WORD };
