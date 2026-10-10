// Shared driver for the native screen lab's merchant (pro/stitshop).
//
// The three stitshop checks each used to assume the merchant's item list was
// already on screen: they booted the overlay, waited N frames, and asserted on
// that picture. The original does not do that. Its own root state table
// (`pro/stitshop.s`, the 24 words at file `0x4E8` = RAM `0x80083198`, dispatched
// at file `0x8C78`-`0x8CA8`) runs 0 and 1 as the greeting fade, 2 as the header,
// and **3 as the BUY/SELL menu**; only the confirm press in state 3
// (`stitshop.s:9146`, `li $a1, 0xd` at `:9205`) stores `+0x10 = 0x14` (`:9220`)
// and reaches the arm that spawns the list. A player meets a two-row BUY/SELL
// menu first and presses to get into the list, so a check that skips the press
// is checking a screen the player never sees.
//
// This module is that press, once: boot the lab's real entry point, wait for the
// merchant's own root state word to say BUY/SELL, press the same confirm key the
// walker's own confirm key reaches (word bit 0x2000, logical button 0x0d), and
// wait for the list to be on screen. Every stitshop check drives the shop
// through here instead of hand-rolling its own frames and its own key.

/** The merchant's root state word (`+0x10`), the same one the dispatcher reads. */
export const SHOP_ROOT_BUY_SELL_STATE = 3;

/** Word bit / logical button pairs the merchant asks for, with the line that
 *  asks. Used by the checks that assert WHICH bit a key reached. */
export const SHOP_BUTTONS = {
    up: { bit: 0x0010, logical: 0x4, line: "stitshop.s:9153" },
    right: { bit: 0x0020, logical: 0x5, line: "stitshop.s:5640" },
    down: { bit: 0x0040, logical: 0x6, line: "stitshop.s:9169" },
    left: { bit: 0x0080, logical: 0x7, line: "stitshop.s:5589" },
    l1: { bit: 0x0400, logical: 0xb, line: "stitshop.s:5305" },
    r1: { bit: 0x0800, logical: 0xa, line: "stitshop.s:5319" },
    /** the third face button: the effects card, "[circle] Button: Effects" */
    effects: { bit: 0x1000, logical: 0xc, line: "stitshop.s:1348" },
    /** CONFIRM — the sound is 0x8004503C (`ori $a0, 0x503c`, :9218) */
    confirm: { bit: 0x2000, logical: 0xd, line: "stitshop.s:9205" },
    /** BACK — the sound is 0x800450BD (`ori $a0, 0x50bd`, :9242) */
    back: { bit: 0x4000, logical: 0xe, line: "stitshop.s:9229" },
};

/** The walker's own keyboard bindings for the buttons a check presses, so a
 *  check never has to remember which key the game listens for. */
export const SHOP_KEYS = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    l1: "q",
    r1: "e",
    effects: "k",
    confirm: "Enter",
    back: "Escape",
};

/** Navigate to the lab and boot the merchant's real root constructor. */
export async function bootShopLab(page, root, module = "pro/stitshop") {
    await page.goto(`${root}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector('button[data-scr="nativescreen"]', { timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/, { timeout: 10000 });
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
    await page.evaluate((m) => window.__nativeScreenBoot(m), module);
    await page.waitForFunction(
        (m) => { const s = window.__nativeScreen?.(); return !!s && s.module === m && s.booted && s.frames >= 30; },
        module,
        { timeout: 15000 },
    );
}

/** The lab's own frame counter. */
export function frames(page) {
    return page.evaluate(() => window.__nativeScreen().frames);
}

/** Wait for at least `n` more lab frames. */
export async function tickTo(page, n, timeout = 15000) {
    await page.waitForFunction((k) => window.__nativeScreen().frames >= k, n, { timeout });
}

/** Press one key as a player does: the real key event, then the key stays down
 *  for `forFrames` published frames of the held word and the service lets go of it.
 *
 *  WHY FRAMES AND NOT MILLISECONDS. The merchant's item list steps one row on the
 *  pressed edge and on every auto-repeat (pro/stitshop.s:5547 Down, the repeat arm
 *  at :5561, the step at :5577), and the console's poll counts that repeat in
 *  frames: `(now - lastTick + credit) / D != 0` with D the halfword at
 *  D0x8004B7D0+0x3D4 (exe/fns.s:9784, :9786), set to 16 by the block initialiser
 *  when the caller passes 0 (fns.s:9042-9043). This driver used to hold the key
 *  for 90 ms of wall clock, which is 5 frames at 52 fps and 11 at 124 fps — so a
 *  check's "press" turned into a hold, crossed the 16-frame repeat and moved the
 *  cursor two rows, on a machine whose frame rate had nothing to do with the game.
 *  `forFrames` is the press. */
export async function pressKey(page, key, { forFrames = 1, settle = 10 } = {}) {
    const at = await frames(page);
    await page.keyboard.down(key);
    const armed = await page.evaluate((n) => window.__nativeScreenReleaseAfter(n), forFrames);
    if (!armed) throw new Error(`no pad button reached the screen for key ${key}`);
    await page.waitForFunction(() => !window.__nativeScreenReleasePending(), null, { timeout: 5000 });
    await page.keyboard.up(key);
    await tickTo(page, at + settle);
}

/** Every text widget that is on screen and carries a string. */
export function visibleTexts(page) {
    return page.evaluate(() =>
        window.__nativeScreenTextDump()
            .filter((w) => w.visible && w.lines.some((l) => l.len > 0))
            .map((w) => ({
                x: w.penX,
                y: w.penY,
                text: w.lines
                    .map((l, i) => (l.len > 0 ? w.decoded?.[i]?.text ?? "" : ""))
                    .filter(Boolean)
                    .join("|"),
            })),
    );
}

/** The merchant's own root state word. */
export function rootState(page) {
    return page.evaluate(() => {
        const root = window.__nativeScreenObjects()[0]?.addr;
        return root ? window.__nativeScreenRead(root + 0x10, 4) : null;
    });
}

/** Wait until the merchant has settled on its BUY/SELL menu. */
export async function waitBuySellMenu(page) {
    await page.waitForFunction(
        (want) => {
            const root = window.__nativeScreenObjects()[0]?.addr;
            return !!root && window.__nativeScreenRead(root + 0x10, 4) === want;
        },
        SHOP_ROOT_BUY_SELL_STATE,
        { timeout: 20000 },
    );
}

/** Wait until the merchant's BUY/SELL menu is on screen: the two rows sit at
 *  x 190, y 47 (BUY) and y 61 (SELL) (`web/shop.js:745-746`, rows x=0xBE=190,
 *  y=0x2F=47 / 0x3D=61). The greeting fade draws the header first. */
export async function waitBuySellRows(page) {
    await page.waitForFunction(
        () => window.__nativeScreenTextDump().some((w) => w.visible && w.penY === 61 && w.penX === 190),
        null,
        { timeout: 20000 },
    );
}

/** Wait until the merchant's BUY item list is on screen. The stock rows are the
 *  left column at x 0x37 and the first row is y 0x24 = 36, which no other
 *  merchant widget uses (the BUY/SELL menu's rows are at x 190/176, y 47/61). */
export async function waitBuyList(page) {
    await page.waitForFunction(
        () => window.__nativeScreenTextDump().some((w) => w.visible && w.penY === 36 && w.penX >= 50 && w.penX <= 60),
        null,
        { timeout: 20000 },
    );
}

/** Wait until the list has finished settling. Two things arrive after the stock
 *  rows, in this order: the selected row's band (name, "Equip n", held count) at
 *  y 110-120, then the item's description at y >= 150. Both are the merchant
 *  reading the item record for whatever the cursor is on, and both are what a
 *  press changes, so a check that reads them before they are there is reading a
 *  half-built screen. */
export async function settleBuyList(page) {
    await page.waitForFunction(
        () => window.__nativeScreenTextDump().some((w) => w.visible && w.penY >= 110 && w.penY <= 120),
        null,
        { timeout: 20000 },
    );
    await page.waitForFunction(
        () => window.__nativeScreenTextDump().some((w) => w.visible && w.penY >= 150),
        null,
        { timeout: 20000 },
    );
}

/** The step a player takes to reach the item list: one confirm press in the
 *  BUY/SELL menu. Returns the state word the merchant ended up in. */
export async function openBuyList(page) {
    await waitBuySellMenu(page);
    await pressKey(page, SHOP_KEYS.confirm);
    await waitBuyList(page);
    await settleBuyList(page);
    return rootState(page);
}

/** The selected row's panel: the name, price, "Equip n" and held count the
 *  merchant prints under the list for whatever the cursor is on. */
export function selectedRowPanel(page) {
    return visibleTexts(page).then((rows) =>
        rows.filter((w) => w.y >= 110 && w.y <= 120).map((w) => w.text),
    );
}