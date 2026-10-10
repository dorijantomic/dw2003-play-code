// tools/memcard-continue.mjs — driving the title's Continue choice, and the card
// round trip that choice opens, shared by every check that reloads the page and
// comes back in through the title.
//
// Nothing here fakes a screen: each function drives the real web/game.js and the
// real translated memory-card screen (engine/dw3/ui/memcard-session.ts, the
// browser adapter web/save-translated.js). This file only holds the key and
// window choreography that six scripts would otherwise repeat.
//
// The route the original takes, and the one these helpers walk:
//   title prompt -> menu -> Continue (the lower option, always lit) ->
//   the card in LOAD mode (launch code 0xC00) ->
//     * pick a file and confirm  -> the slot is restored and the page reloads
//       into the field (`resumeAfterLoad`), or
//     * Back out with nothing loaded -> the card's own exit selector is 0xE00
//       (pro/stgmcard.s 0x4dc4-0x4e2c) and the TITLE SCREEN comes back. It
//       does not start a game.
//
// A load replaces the page, so `waitForLoadedGame` resolves after the reload.

/** One press. The card samples the pad's HELD word once a frame, so every
 *  helper press holds the key across frames rather than tapping it. */
export async function press(page, key, waitMs = 700) {
    await page.keyboard.down(key);
    await page.waitForTimeout(140);
    await page.keyboard.up(key);
    await page.waitForTimeout(waitMs);
}

/** The card's own window step (web/native-session.js state 2 / diagnostics). */
export const cardWindow = (page) =>
    page.evaluate(() => window.__saveNative?.diagnostics?.()?.state?.window ?? null);
export const cardIsOpen = (page) =>
    page.evaluate(() => !!window.__saveNative?.isOpen?.());

/** Wait for the card to reach one of its own windows. */
export async function waitCardWindow(page, value, timeout = 30_000) {
    await page.waitForFunction((v) => window.__saveNative?.diagnostics?.()?.state?.window === v,
        value, { timeout });
}

/**
 * Every string the card is drawing right now, decoded the way a player reads it.
 * `__nativeScreenTextDump` is the overlay's own text-widget walk, so this is the
 * same text on both routes (the reference overlay and the translated session
 * build the same widget list).
 */
export const cardText = (page) => page.evaluate(() =>
    (window.__nativeScreenTextDump?.() ?? [])
        .map((w) => w.decoded.map((x) => x.text).join("|"))
        .filter((t) => t.trim())
        .join(" "));

/**
 * Poll the drawn text until it carries `needle`.
 *
 * A screen draws its committed file card a frame or two AFTER the write lands,
 * and the overlay route has no window id to poll (its `diagnostics()` publishes
 * the host, not the screen object's state — `state.window` is the translated
 * session's own field). Reading the text once at a fixed delay therefore caught
 * the block chooser roughly one run in three. The assertion itself is unchanged:
 * the card still has to be drawing that string, only now it is read at the first
 * frame that shows it rather than at an arbitrary one.
 */
export async function waitCardText(page, needle, timeout = 20_000) {
    await page.waitForFunction((n) =>
        (window.__nativeScreenTextDump?.() ?? [])
            .some((w) => w.decoded.some((x) => (x.text ?? "").includes(n))),
        needle, { timeout }).catch(() => {});
    return cardText(page);
}

/** The title's "Press Start Button" prompt. */
export async function waitTitlePrompt(page, timeout = 60_000) {
    await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout });
}

/**
 * Continue: the prompt, then the menu (whose default highlight is the lower
 * Continue option), then the card in LOAD mode. Resolves once the card's slot
 * chooser (window 2) is up.
 */
export async function openContinueCard(page) {
    await waitTitlePrompt(page);
    await press(page, "i", 900);
    await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20_000 });
    await press(page, "Enter", 900);
    await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 40_000 });
    await waitCardWindow(page, 2);
}

/**
 * Leave the card the way a player does — its own Back, pressed until the screen
 * is gone. Every Back is a screen step, so this never assumes one press is
 * enough (the chooser, the file card and the prompts each take their own).
 */
export async function leaveCard(page, tries = 8) {
    // The title fades out for 650ms before the card opens (web/game.js
    // closeTitle), so a Back pressed straight after the choice lands on nothing
    // and the screen is still up afterwards. Wait for the card first.
    await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 5_000 }).catch(() => {});
    // The card's Back is logical button 0xE (engine/dw3/ui/memcard-machine.ts
    // MEMCARD_BUTTON_CANCEL), which is word bit 0x4000, and on the keyboard that
    // bit is Escape or x (engine/systems/input-map.ts). `c` reached it until
    // 2026-10-03 and now reaches 0x2000, the confirm bit, so it drove the card
    // in circles and this loop never saw the screen close.
    for (let i = 0; i < tries && await cardIsOpen(page); i++) await press(page, "Escape", 900);
    await page.waitForFunction(() => !window.__saveNative?.isOpen?.(), null, { timeout: 20_000 });
}

/**
 * Back out of the Continue card and check the title came back rather than the
 * game. Returns what the player is looking at, for the caller's assertions.
 */
export async function backOutToTitle(page) {
    await leaveCard(page);
    await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 20_000 });
    await page.waitForTimeout(500);
    return page.evaluate(() => ({
        titleHidden: document.getElementById("title-screen")?.hidden ?? null,
        phase: window.__titleState?.()?.phase?.() ?? null,
        started: !!window.__state?.started,
        exitScreen: window.__memcardExitScreen ?? null,
        transition: window.__saveNative?.diagnostics?.()?.summary?.transition ?? null,
    }));
}

/**
 * Drive a SAVE-mode card to a write and leave. `open` puts the card up in SAVE
 * mode (the caller owns the trigger: a save point's own event, or the lab's
 * entry, which calls the same openMemoryCard("save")). Resolves with the walker
 * slot that now holds the save, so the caller can load that one back.
 */
export async function saveToCard(page, open, { timeout = 40_000 } = {}) {
    await open();
    await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout });
    await waitCardWindow(page, 2);
    await press(page, "Enter", 500);            // the block's file card
    await waitCardWindow(page, 0x21, timeout);
    await press(page, "Enter", 500);            // write
    await waitCardWindow(page, 0x1f5, timeout);
    await press(page, "Enter", 500);            // dismiss "Saved."
    await page.waitForFunction(
        (v) => window.__saveNative?.diagnostics?.()?.state?.window === v, 0x21, { timeout });
    const slot = await page.evaluate(() => {
        const d = window.__saveNative.diagnostics();
        return d?.stores?.[0]?.slot ?? d?.savedSlot ?? null;
    });
    await leaveCard(page);
    return slot;
}

/**
 * Load the slot the card is showing and wait for the reload that a load
 * performs. From the chooser: one confirm opens the file the screen is on (it
 * opens on the last-used file, which is the one a save just wrote), the next
 * confirms the load, and the last dismisses "LOADED." — which is where the
 * walker restores the slot's snapshot and reloads into the field.
 */
export async function loadFromCard(page, { timeout = 60_000 } = {}) {
    await press(page, "Enter", 700);            // chooser -> the file card
    await waitCardWindow(page, 0x21, timeout);
    const reload = page.waitForNavigation({ timeout }).catch(() => null);
    await press(page, "Enter", 700);            // load
    await waitCardWindow(page, 0x1f6, timeout);   // "LOADED."
    await press(page, "Enter", 700);            // dismiss it: the page reloads here
    await reload;
    await page.waitForFunction(() => window.__state?.started, null, { timeout });
}

/** The whole second boot of a check: title -> Continue -> back out -> title. */
export async function continueAndBackOut(page) {
    await page.waitForFunction(() => {
        const t = document.querySelector("#title-screen");
        return t && !t.hidden;
    }, null, { timeout: 30_000 });
    await openContinueCard(page);
    return backOutToTitle(page);
}