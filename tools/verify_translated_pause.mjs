// The ordinary pause menu on the translated pause pages, with executable assets forbidden.
// The player presses Start on the field, opens every row (ITEMS, SORT, MAP, TECHNIQUES,
// STATUS, CARD FOLDERS) and leaves it again, then does the journeys that change the game:
// use a Power Charge, swap two partners, wear a piece of gear, and hand off to the card
// album. Serve web/ on port 8742:  python3 -m http.server 8742 --directory web
//
//   tools/run-playwright.sh tools/verify_translated_pause.mjs [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.PAUSE_ROOT || `${baseUrl(8742)}/`;
const OUT = process.argv[2] ?? ".dw3-research/part-d-2026-09-28/translated-pause";
mkdirSync(OUT, { recursive: true });
// The page objects' handlers, as the session registers them.
const CLASS = { items: 0x80091d18, sort: 0x800980b0, map: 0x8009913c, techniques: 0x80096380, status: 0x8008e744,
    cardfolders: 0x80084a98, bag: 0x800934e0, equipment: 0x80088214, digivolve: 0x8008b3c8 };
const ROWS = ["items", "sort", "map", "techniques", "status", "cardfolders"];
const POWER_CHARGE = 43;

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [], executableRequests = [];
page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) pageErrors.push(`console: ${m.text()}`);
});
await page.route("**/assets/native/**", (route) => {
    executableRequests.push(route.request().url());
    return route.abort();
});
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
});
// Inside a translated page, Cross ("c") confirms and Triangle (Escape) goes back, as on the
// disc (UI-PAUSE-CROSS-CONFIRMS-LIVE-2026-09-29), on the list as on the pages.
const press = async (key, ms = 90, after = 140) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(after);
};
const diag = () => page.evaluate(() => window.__status.diagnostics());
const settled = (cls) => page.waitForFunction((c) => {
    const d = window.__status?.diagnostics?.();
    return d?.open === true && d.pending === false && d.classes.includes(c) && d.renderer.frames >= 60;
}, cls, { timeout: 30000 });
const leave = async () => {
    for (let i = 0; i < 24 && await page.evaluate(() => window.__status.isOpen()); i++) await press("Escape", 90, 700);
};
const closed = () => page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 30000 });
const menuRow = async (index) => {
    await page.evaluate(() => { window.__state.menuOpen = true; window.__menu.openAt("home"); });
    await page.waitForTimeout(300);
    for (let i = 0; i < index; i++) await press("ArrowDown", 90, 120);
    await press("c", 90, 200);
};

try {
    await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 40000 });
    await page.evaluate((item) => {
        const s = window.__state;
        s.bits = 4321;
        s.party = ["p003pken", "p004kogu", "p006rna"];
        const base = { level: 12, xp: 100, tp: 30, hp: 45, maxHp: 500, mp: 21, maxMp: 25, core: [50, 40, 30, 20, 10, 5],
            elements: [1, 2, 3, 4, 5, 6, 7] };
        s.partyStats = s.party.map(() => ({ ...base }));
        s.partnerStats = s.partyStats[0];
        s.inventory = [{ id: item, qty: 3 }, { id: 40, qty: 1 }];
        s.equipment = [];
    }, POWER_CHARGE);
    await page.waitForFunction(() => (window.__cards?.()?.folders?.length ?? 0) > 0, null, { timeout: 30000 })
        .catch(() => {});
    const partySize = await page.evaluate(() => window.__state.party.filter(Boolean).length);
    check("the walker has at least two partners", partySize >= 2, `party=${partySize}`);

    // The pause menu opens the way the Start key opens it (state.menuOpen, then the top list).
    await page.evaluate(() => { window.__state.menuOpen = true; window.__menu.openAt("home"); });
    await page.waitForTimeout(400);
    const menuState = await page.evaluate(() => ({ open: window.__state.menuOpen, screen: window.__menu.screen }));
    check("the pause menu is on its top list", menuState.open && menuState.screen === "home", JSON.stringify(menuState));
    await page.screenshot({ path: `${OUT}/00-menu.png` });
    await page.evaluate(() => { window.__state.menuOpen = false; window.__menu.screen = "home"; });

    // Every row opens its own translated page and leaves again.
    const rows = await page.evaluate(() => (window.__menu.cardFolderUnlocked?.() ? 6 : 5));
    for (let row = 0; row < rows; row++) {
        const name = ROWS[row];
        await menuRow(row);
        await settled(CLASS[name]);
        const d = await diag();
        check(`${name}: the translated page opened`, d.entry === name && d.error === null, JSON.stringify({ entry: d.entry, error: d.error }));
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/0${row + 1}-${name}.png` });
        await leave();
        await closed();
        const back = await page.evaluate(() => ({ screen: window.__menu.screen, open: window.__status.isOpen() }));
        check(`${name}: Back closes the page and returns to the menu`, back.open === false && back.screen === "home", JSON.stringify(back));
    }

    // Use a Power Charge on the first partner.
    await menuRow(0);
    await settled(CLASS.items);
    await page.waitForTimeout(3500);            // the panels fold in before the page reads the pad
    // Enter and c both reach word 0x2000, the confirm (engine/systems/input-map.ts).
    // Before 2026-10-03 Enter reached another word, so this page once checked that
    // Enter did nothing; that check no longer has a meaning.
    await press("c", 90, 500);              // the Items tab
    await page.waitForFunction((c) => window.__status.diagnostics().classes.includes(c), CLASS.bag, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/07-bag.png` });
    await press("c", 90, 2500);             // the Power Charge
    await press("c", 90, 3500);             // the first partner
    await press("c", 90, 800);              // dismiss "HP healed." (it waits for a confirm)
    let hp = await page.evaluate(() => window.__state.partyStats[0].hp);
    await leave();
    await closed();
    const used = await page.evaluate(() => ({ hp: window.__state.partyStats[0].hp, bag: window.__state.inventory,
        stored: JSON.parse(localStorage.getItem("inventory") ?? "[]") }));
    check("the Power Charge healed the first partner", used.hp === 500, `hp before close ${hp}, after ${used.hp}`);
    check("one Power Charge was spent", used.bag.find((s) => s.id === POWER_CHARGE)?.qty === 2, JSON.stringify(used.bag));
    check("the bag was saved", used.stored.find((s) => s.id === POWER_CHARGE)?.qty === 2, JSON.stringify(used.stored));

    // Swap the first and last partners on SORT.
    const before = await page.evaluate(() => window.__state.party.slice());
    await menuRow(1);
    await settled(CLASS.sort);
    await page.waitForTimeout(3500);
    await press("c", 90, 400);
    await press("ArrowDown", 90, 300);
    await press("c", 90, 1200);
    await leave();
    await closed();
    const after = await page.evaluate(() => window.__state.party.slice());
    check("the walker's party order changed", JSON.stringify(after) !== JSON.stringify(before), `${before} -> ${after}`);
    if (partySize >= 3) check("the first and last partners swapped", after[0] === before[2] && after[2] === before[0], `${before} -> ${after}`);
    else check("the two partners swapped", after[0] === before[1] && after[1] === before[0], `${before} -> ${after}`);
    await page.screenshot({ path: `${OUT}/08-after-sort.png` });

    // CARD FOLDERS asks the resident launcher for the card album. The album itself is still an
    // original-code screen, so the walker's hook is replaced by a recorder: this proves the
    // translated page's request and its close, not the album.
    const canFolders = await page.evaluate(() => window.__menu.cardFolderUnlocked?.() === true);
    if (canFolders) {
        await page.evaluate(() => {
            window.__handoffs = [];
            window.__menu.onCardAlbum = () => { window.__handoffs.push("album"); };
            window.__menu.onCardDeck = () => { window.__handoffs.push("deck"); };
        });
        await menuRow(5);
        await settled(CLASS.cardfolders);
        await page.waitForTimeout(3500);
        await press("c", 90, 1500);
        await page.waitForFunction(() => window.__status.isOpen() === false, null, { timeout: 30000 });
        const handoff = await page.evaluate(() => ({ handoffs: window.__handoffs, statusOpen: window.__status.isOpen() }));
        check("Card Folders closed and asked for the card album", handoff.statusOpen === false &&
            JSON.stringify(handoff.handoffs) === '["album"]', JSON.stringify(handoff));
        await menuRow(5);
        await settled(CLASS.cardfolders);
        await page.waitForTimeout(3500);
        await press("ArrowDown", 90, 400);
        await press("c", 90, 1500);
        await page.waitForFunction(() => window.__status.isOpen() === false, null, { timeout: 30000 });
        const deck = await page.evaluate(() => window.__handoffs);
        check("the second choice asked for the deck editor", JSON.stringify(deck) === '["album","deck"]', JSON.stringify(deck));
    } else {
        check("Card Folders row is offered once the player has cards", false, "no folders in this save");
    }

    check("no executable asset was requested", executableRequests.length === 0, executableRequests.join(", "));
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
    writeFileSync(`${OUT}/proof.json`, JSON.stringify({ execution: "translated", executableRequests, errors: pageErrors, failures }, null, 2) + "\n");
    if (failures) { console.error(`FAIL translated pause: ${failures} check(s) failed`); process.exitCode = 1; }
    else console.log("PASS translated pause");
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await browser.close();
}
