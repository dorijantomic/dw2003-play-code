// Phase 3/4 shop interaction: the native item shop's real cursor moves under the
// host pad-input service. Boots pro/stitshop through the lab's real entry point,
// checks the screen the player meets first (the BUY/SELL menu), presses confirm
// the way a player does, and then checks that the merchant's own cursor reacts to
// the d-pad: Down moves the selection and the selected-row panel text changes,
// R1 flips the page, and Back leaves the list.
//
// The keys are the walker's own bindings (tools/native-screen-shop-lab.mjs), and
// the pad word each one reaches is the merchant's own pressed word read through
// the controller service cell at +0x3f4 — so a key that stopped being confirm,
// or an edge the runtime stopped deriving, fails here rather than in the game.
//
// Env: NATIVE_SCREEN_SHOT. Run:
//   VERIFY_PORT=8837 tools/run-playwright.sh tools/verify_native_shop_interaction.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import {
    SHOP_KEYS,
    bootShopLab,
    openBuyList,
    pressKey,
    rootState,
    selectedRowPanel,
    visibleTexts,
    waitBuySellRows,
} from "./native-screen-shop-lab.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-shop-interaction";
const MODULE = "pro/stitshop";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

/** The page indicator under the list: "1 / 2" then "2 / 2". */
async function pageTab() {
    const rows = await visibleTexts(page);
    const bits = rows.filter((w) => w.y === 96).map((w) => w.text);
    return bits.join(" ");
}

try {
    await bootShopLab(page, ROOT, MODULE);

    // 1. The screen the player meets: the shop name, the wallet, and BUY / SELL.
    await waitBuySellRows(page);
    const menu = await visibleTexts(page);
    const menuNames = menu.map((w) => w.text);
    await page.screenshot({ path: `${OUT}/shop-menu.png` });

    // 2. One confirm press opens the item list.
    const listState = await openBuyList(page);
    const list = await visibleTexts(page);
    const listNames = list.filter((w) => w.y >= 30 && w.y <= 90).map((w) => w.text);
    const description = list.filter((w) => w.y >= 150).map((w) => w.text);
    const panelBefore = await selectedRowPanel(page);
    const tabBefore = await pageTab();
    await page.screenshot({ path: `${OUT}/shop-list.png` });

    // 3. Down moves the merchant's cursor and the selected row's panel with it.
    await pressKey(page, SHOP_KEYS.down);
    const panelAfterDown = await selectedRowPanel(page);
    await page.screenshot({ path: `${OUT}/shop-down.png` });

    // 4. R1 flips to the second page of stock.
    await pressKey(page, SHOP_KEYS.r1);
    const tabAfterR1 = await pageTab();
    const namesAfterR1 = (await visibleTexts(page)).filter((w) => w.y >= 30 && w.y <= 90).map((w) => w.text);
    await page.screenshot({ path: `${OUT}/shop-page2.png` });

    // 5. Back leaves the list; the merchant is back on its BUY/SELL menu.
    await pressKey(page, SHOP_KEYS.back);
    let backOnMenu = false;
    try {
        await waitBuySellRows(page);
        backOnMenu = true;
    } catch {
        backOnMenu = false;
    }
    const afterBack = await visibleTexts(page);
    await page.screenshot({ path: `${OUT}/shop-back.png` });

    writeFileSync(
        `${OUT}/shop-interaction.json`,
        JSON.stringify({ menuNames, listNames, panelBefore, panelAfterDown, tabBefore, tabAfterR1, namesAfterR1, listState, errors }, null, 1) + "\n",
    );
    console.log("menu:", JSON.stringify(menuNames));
    console.log("list:", JSON.stringify(listNames));
    console.log("panel before/after Down:", JSON.stringify(panelBefore), JSON.stringify(panelAfterDown));
    console.log("page tab before/after R1:", JSON.stringify(tabBefore), JSON.stringify(tabAfterR1));
    const state = await page.evaluate(() => window.__nativeScreen());

    // This check pins the shop's real DATA/text path (the producer/consumer
    // result) AND the pad path the 2026-10-04 sweep found missing: the overlay's
    // own stock table fills the list, the selection panel and description resolve
    // from the item record, and the cursor's own d-pad and shoulder buttons move
    // it through the controller-input record the original reads.
    const problems = [];
    if (state.traps !== 0) problems.push(`traps=${state.traps}`);
    if (!menuNames.some((t) => t.includes("Armory"))) problems.push(`menu has no shop name (${menuNames.join(", ")})`);
    if (!menuNames.includes("BUY") || !menuNames.includes("SELL")) problems.push(`menu is not the BUY/SELL menu (${menuNames.join(", ")})`);
    if (!listNames.includes("Short Sword")) problems.push(`list names missing (${listNames.join(", ")})`);
    if (!listNames.includes("Dagger")) problems.push("list missing the second stock row");
    if (!listNames.includes("Hide Helmet")) problems.push("list missing the last visible stock row");
    if (!panelBefore.length) problems.push("no selected-row panel text");
    if (!description.length) problems.push("no item description text");
    if (JSON.stringify(panelBefore) === JSON.stringify(panelAfterDown)) {
        problems.push(`Down did not move the selected row (${JSON.stringify(panelBefore)})`);
    }
    if (tabBefore === tabAfterR1) problems.push(`R1 did not flip the page (${tabBefore})`);
    if (!namesAfterR1.includes("Leather Coat")) problems.push(`second page is not the second page (${namesAfterR1.join(", ")})`);
    if (!backOnMenu) problems.push(`Back did not leave the list (${afterBack.map((w) => w.text).join(", ")})`);
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native shop content:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(
            `PASS native shop content: menu=[${menuNames.join(" ")}] list=${listNames.length} names ` +
                `(${listNames[0]}...) panel=${JSON.stringify(panelAfterDown[0] ?? "")} desc=${description.length} lines ` +
                `page=${tabBefore}->${tabAfterR1} traps=0; shot ${OUT}/shop-list.png`,
        );
    }
} finally {
    await browser.close();
}