// The pause home's CARD FOLDERS entry, all the way through: the pause's own
// CARD FOLDERS page (root 0x80084a98, translated) offers Card Album and Edit
// Folder, and each row must actually arrive somewhere and COME BACK onto that
// same page.
//
//   tools/run-playwright.sh tools/verify_cardfolders_native.mjs
//
// Before 2026-09-21 the two rows wrote the resident launcher request
// (0x80016B88 -> cells 0x8004B3FC/0x8004B404) and the page then waited for a
// screen this host cannot load: the page froze at state 0x39 and Back did
// nothing. web/status-translated.js now surfaces the request to web/game.js,
// which opens the album / folder editor.
//
// 2026-10-04: the way back changed. Closing either used to land on web/menu.js's
// own hand-drawn CARD FOLDERS panel (web/game.js `backToCardFolders`), so
// ordinary play carried a second copy of a pause page. On the disc the two card
// screens are separate SCREENS: the page reads its own choice at this+0x14 and
// calls the screen launcher with 0x1200 (album) or 0x400 (folder editor), then
// returns naming no page (F0x80084A34, pro/ststatus.s:1896-1911); the pause
// root's next step re-attaches to the STATUS screen (0x1000) or asks for it and
// writes its own cursor row into the page cell D0x8005CCF0 (F0x800132E0,
// exe/fns.s:3838-3868); and the STATUS host builds the page that cell names —
// still 5 (F0x800996EC, pro/ststatus.s:23202-23215, and D0x8005CCF0 has only
// those two writers, both in the root). So the return now reopens the translated
// page (web/pause-home.js returnToPauseCardFolders), and these checks read that
// instead of menu.js's screen. This file also stopped assuming the original-code
// route (?nativeStatus=1): on the default route `__status._host` is null and
// there are no traps to count.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.CF_SHOT
    || ".dw3-research/autonomous-plan/captures/phase6-cardfolders-2026-09-21";
mkdirSync(OUT, { recursive: true });

const problems = [];
let step = "start";
const ok = (cond, msg) => { if (!cond) problems.push(msg); return cond; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = () => page.evaluate(() => ({
    statusOpen: window.__status?.isOpen?.() ?? false,
    menuScreen: window.__menu?.screen ?? null,
    menuOpen: window.__state?.menuOpen ?? null,
    album: window.__cardAlbum?.isOpen?.() ?? false,
    deck: window.__cardDeck?.isOpen?.() ?? false,
    entry: window.__status?.diagnostics?.().entry ?? null,
    classes: window.__status?.diagnostics?.().classes ?? [],
    frames: window.__status?.diagnostics?.().renderer?.frames ?? 0,
    traps: window.__status?._host ? (window.__status.diagnostics().host?.traps ?? null) : null,
}));
const press = async (key, ms = 90, after = 450) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(after);
};
/** The pause list's own cursor row, read out of its RAM. */
const homeRow = () => page.evaluate(() => {
    const s = window.__status?._session;
    return s && window.__status?.diagnostics?.().entry === "home" ? (s.mem.read32(s.root + 0x58) | 0) : null;
});
/** The page reads input only once its folds are open, so confirm is retried. */
const confirmOpens = async (isOpen) => {
    for (let n = 0; n < 5; n++) {
        if (await page.evaluate(isOpen)) return true;
        await page.waitForTimeout(600);
        await press("c", 140, 900);
    }
    return page.evaluate(isOpen);
};
const walkHomeTo = async (want) => {
    for (let n = 0; n < 12; n++) {
        const row = await homeRow();
        if (row === want) return true;
        await press(row === null || row < want ? "ArrowDown" : "ArrowUp", 110, 260);
    }
    return (await homeRow()) === want;
};
const interactive = () => page.waitForFunction(
    () => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 },
);
const waitFor = (fn, timeout = 15000) => page.waitForFunction(fn, null, { timeout })
    .then(() => true).catch(() => false);

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    // The entry only exists once the player holds a folder (the starter deck).
    const folders = await waitFor(() => (window.__cards?.()?.folders?.length ?? 0) > 0, 30000);
    ok(folders, "the starter card folders never appeared");
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", null, null];
        window.__state.partnerStats = { digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25, stats: {}, elemBonuses: {} };
        window.__state.partyStats = [{ level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 }, null, null];
        window.__state.inventory = [];
        window.__sfxLog = [];
        // The pause pages speak in PACKED words (the seven resident ids), the
        // hand-drawn menus in sample names, so both entries are logged.
        for (const key of ["play", "playPacked"]) {
            const orig = window.__sfx[key].bind(window.__sfx);
            window.__sfx[key] = (name, ...rest) => { window.__sfxLog.push(name); return orig(name, ...rest); };
        }
        window.__labOpen("menu");
    });
    await page.waitForTimeout(400);

    step = "open CARD FOLDERS";
    await press("i", 140, 600);
    ok(await waitFor(() => window.__status?.diagnostics?.().entry === "home", 20000),
        "the field START did not open the pause list");
    await waitFor(() => window.__status?._session?.mem.read32(window.__status._session.root + 0x10) === 3, 20000);
    await interactive();
    ok(await walkHomeTo(5), `the cursor never reached CARD FOLDERS (row ${await homeRow()})`);
    await press("c", 120); // Cross confirms, as on the disc
    const opened = await waitFor(() => window.__status?.diagnostics?.().entry === "cardfolders"
        && (window.__status?.diagnostics?.().classes ?? []).includes(0x80084a98), 25000);
    ok(opened, "the CARD FOLDERS page did not open");
    await interactive();
    const page1 = await snap();
    ok(page1.classes.includes(0x80084a98), `the page root is not 0x80084a98: ${page1.classes}`);
    ok((page1.traps ?? 0) === 0, `traps on the launcher page: ${page1.traps}`);
    ok(page1.frames >= 60, "the launcher page never became interactive");
    writeFileSync(`${OUT}/1-launcher.png`, await page.locator("#game").screenshot());

    step = "Card Album row";
    await interactive();
    const albumUp = await confirmOpens(() => window.__cardAlbum?.isOpen?.() === true);
    ok(albumUp, "the Card Album did not open from the CARD FOLDERS page");
    const afterAlbum = await snap();
    ok(afterAlbum.statusOpen === false, "the page stayed open under the album");
    ok(afterAlbum.traps == null || afterAlbum.traps === 0, `traps handing off to the album: ${afterAlbum.traps}`);
    writeFileSync(`${OUT}/2-album.png`, await page.locator("#game").screenshot());

    step = "leave the album";
    // The Album is still the shipped pro/stcrdabm screen (its own translation is
    // unfinished): it samples the pad's held word once per frame and its Back is
    // the bit the walker's Escape carries.
    for (let i = 0; i < 12; i++) {
        if (await page.evaluate(() => window.__cardAlbum?.isOpen?.() !== true)) break;
        await press("Escape", 320, 700);
    }
    // The disc's answer: the STATUS screen comes back and its host opens the page
    // D0x8005CCF0 names, still CARD FOLDERS (see the header).
    const backPanel = await waitFor(() => window.__cardAlbum?.isOpen?.() !== true
        && window.__status?.isOpen?.() === true
        && window.__status?.diagnostics?.().entry === "cardfolders", 25000);
    const panel = await snap();
    ok(backPanel, `leaving the album did not return to the pause's CARD FOLDERS page: ${JSON.stringify(panel)}`);
    ok(panel.menuScreen !== "cardfolder", "web/menu.js's own CARD FOLDERS panel was shown");
    ok(panel.classes.includes(0x80084a98), `the returning page is not 0x80084a98: ${panel.classes}`);

    step = "Edit Folder row";
    await press("ArrowDown", 110, 500);
    const deckUp = await confirmOpens(() => window.__cardDeck?.isOpen?.() === true);
    ok(deckUp, "the folder editor did not open from the CARD FOLDERS page");
    const afterDeck = await snap();
    ok(afterDeck.statusOpen === false, "the page stayed open under the folder editor");
    writeFileSync(`${OUT}/3-folder-editor.png`, await page.locator("#game").screenshot());

    step = "leave the folder editor and the menu";
    // The Folder editor is still the shipped pro/stcrddek screen: same pad
    // sampling, same Back bit.
    for (let i = 0; i < 12; i++) {
        if (await page.evaluate(() => window.__cardDeck?.isOpen?.() !== true)) break;
        await press("Escape", 320, 700);
    }
    const panel2 = await waitFor(() => window.__cardDeck?.isOpen?.() === false
        && window.__status?.isOpen?.() === true
        && window.__status?.diagnostics?.().entry === "cardfolders", 25000);
    ok(panel2, "leaving the folder editor did not return to the pause's CARD FOLDERS page");
    await press("Escape", 120, 600);
    const home = await waitFor(() => window.__status?.diagnostics?.().entry === "home"
        && window.__status?._session?.mem.read32(window.__status._session.root + 0x10) === 3, 25000);
    const homeSnap = await snap();
    ok(home, "Back from the CARD FOLDERS page did not return to the pause list");
    ok(homeSnap.menuScreen !== "cardfolder", "web/menu.js's own CARD FOLDERS panel was shown on the way back");
    writeFileSync(`${OUT}/4-pause-home.png`, await page.locator("#game").screenshot());

    const sounds = await page.evaluate(() => window.__sfxLog);
    writeFileSync(`${OUT}/cardfolders-sounds.json`, JSON.stringify(sounds, null, 1) + "\n");
    ok(sounds.length > 0, "no sounds played on the whole path");
    ok(errors.length === 0, `page errors: ${errors.join(" | ")}`);
    writeFileSync(`${OUT}/verify-output.txt`, `${problems.length ? problems.join("\n") : "OK"}\n`);
} catch (e) {
    problems.push(`exception at [${step}]: ${e.message}`);
} finally {
    await browser.close();
}

if (problems.length) {
    console.error(`FAIL verify_cardfolders_native:\n- ${problems.join("\n- ")}`);
    process.exitCode = 1;
} else {
    console.log("verify_cardfolders_native: OK (CARD FOLDERS page -> Card Album -> back onto that page -> Edit Folder -> back onto that page -> pause list on row 5; one page, no hand-drawn copy)");
}
