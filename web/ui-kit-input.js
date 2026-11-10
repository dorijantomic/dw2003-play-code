// web/ui-kit-input.js -- what the new book screens (GLOSSARY, OPTIONS) read from the pad. One frame at a time.
//
// It reuses the game's own pause pad port, not a new one: `ui.MenuPadWords` (engine/dw3/ui/pad-words.ts) turns the held
// buttons into "pressed this frame" and "repeat fired this frame" exactly as the pause pages see them, and
// `ui.MenuDisplayClock` gives the displayed frames (50 per second). The held buttons are `state.keys` in web/game.js: the
// keyboard (web/game.js keydown) and the gamepad (web/input.js attachGamepad) both feed it with the same WORD-BIT names, so
// one reader serves both. In English the words are swapped from the physical buttons (engine/systems/input-map.ts
// PAD_FACE_WORD_SWAP): CONFIRM is the word "circle" (Enter, Space, Z, C; pad bottom button) and BACK is the word "cross"
// (Escape, X; pad top button). Q and E are "l1" and "r1"; Start (I) is "start".
//
// Rules:
//  * a direction repeats while held (first repeat 15 ticks after the press tick, then every 6, then every 4: the pause pad's
//    own 16 / 6 / 4 credit ladder); a face button, a shoulder or Start never repeats;
//  * a button that was already down when the screen opened (the Enter that chose the row) does nothing until it is let go.
import { ui, maskFromButtons, buttonsFromMask, isPadButton } from "./vendor/engine.js";

/** The only buttons that repeat while held. */
export const REPEATING = Object.freeze(["up", "down", "left", "right"]);
/** The word names this module is written in (see the header). */
export const WORD = Object.freeze({ confirm: "circle", back: "cross", prev: "l1", next: "r1", start: "start" });

export function createKitInput() {
    const clock = new ui.MenuDisplayClock();
    const words = new ui.MenuPadWords();
    let blocked = new Set();
    const api = {
        /** Call when the screen opens, with the buttons that are down right now. */
        reset(held = []) { blocked = new Set([...held].filter(isPadButton)); },
        /** One displayed frame at display tick `tick`: the set of buttons that act in it. */
        step(held, tick) {
            const down = new Set([...held].filter(isPadButton));
            for (const b of [...blocked]) if (!down.has(b)) blocked.delete(b);
            for (const b of blocked) down.delete(b);
            const { pressed, repeated } = words.update(maskFromButtons(down), tick);
            const act = new Set(buttonsFromMask(pressed));
            for (const b of buttonsFromMask(repeated)) if (REPEATING.includes(b)) act.add(b);
            return act;
        },
        /** `dt` seconds of real time: one Set of acting buttons per displayed frame that is due. */
        advance(dt, held) { return clock.advance(dt).map((frame) => api.step(held, frame.tick)); },
    };
    return api;
}
