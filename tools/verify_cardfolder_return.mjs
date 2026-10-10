// Leaving the Card Album puts the player back on the PAUSE's own CARD FOLDERS
// page — the disc's own panel, not web/menu.js's second drawing of it.
//
//   tools/run-playwright.sh tools/verify_cardfolder_return.mjs [outDir]
//
// Serve this worktree's web/ and point VERIFY_PORT at it. The walk must be the
// ordinary one: field START -> the pause list -> CARD FOLDERS -> the panel ->
// Card Album -> leave -> and then the panel again. On the old code the album's
// close callback was `menu.screen = "cardfolder"`, so this fails with
// menuScreen "cardfolder" and statusOpen false.
//
// Why the disc returns to that page (not to the top list, not to the field):
// the CARD FOLDERS page reads its own choice at this+0x14 and calls the screen
// launcher with 0x1200 (album) or 0x400 (folder editor), argument 0, then
// returns naming no page (F0x80084A34, pro/ststatus.s:1896-1911); the pause
// root's next step re-attaches to the STATUS screen (0x1000) or asks for it and
// writes its own cursor row into the page cell D0x8005CCF0 (F0x800132E0,
// exe/fns.s:3838-3868), and the STATUS host builds the page that cell names
// (F0x800996EC, pro/ststatus.s:23202-23215). D0x8005CCF0 has exactly two
// writers, both in that root (exe/fns.s:3404, :3864), so it still says 5.
// Back therefore walks out to the pause list on the CARD FOLDERS row, which is
// what the last two checks read.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "captures/card-folder-return-2026-10-04";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => { localStorage.setItem("assetMode", "authentic"); });
const errors = [], native = [], results = [];
page.on("pageerror", (e) => errors.push(e.message));
// The executable assets are WATCHED, not denied: the Card Album is still the
// shipped pro/stcrdabm screen (its own translation is unfinished work), so this
// walk cannot close the album with assets/native/** refused the way the pause
// verifiers do. What is asserted instead is that the PAUSE carries no
// original-code host (below) and that every executable request belongs to a card
// screen's own overlay — nothing else.
page.on("request", (r) => { if (/assets\/native\//.test(r.url())) native.push(r.url()); });
const check = (label, valid, detail) => {
    const line = `${valid ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`;
    results.push(line); console.log(line);
};
const press = async (key, ms = 120, after = 260) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(after);
};
const homeRow = () => page.evaluate(() => {
    const s = window.__status?._session;
    return s && window.__status?.diagnostics?.().entry === "home" ? (s.mem.read32(s.root + 0x58) | 0) : null;
});
/** Walk the pause list's own cursor to a row, reading the row out of its RAM. */
const walkTo = async (want) => {
    for (let n = 0; n < 12; n++) {
        const row = await homeRow();
        if (row === want) return true;
        await press(row === null || row < want ? "ArrowDown" : "ArrowUp", 110, 220);
    }
    return (await homeRow()) === want;
};
const snap = () => page.evaluate(() => ({
    statusOpen: window.__status?.isOpen?.() ?? false,
    entry: window.__status?.diagnostics?.().entry ?? null,
    classes: window.__status?.diagnostics?.().classes ?? [],
    frames: window.__status?.diagnostics?.().renderer?.frames ?? 0,
    menuScreen: window.__menu?.screen ?? null,
    menuOpen: window.__state?.menuOpen ?? null,
    album: window.__cardAlbum?.isOpen?.() ?? false,
    row: window.__status?._session?.mem.read32(window.__status._session.root + 0x58) ?? null,
}));
const waitEntry = (entry) => page.waitForFunction((want) => {
    const d = window.__status?.diagnostics?.();
    return d?.open && !d.pending && d.entry === want && d.renderer.frames > 0;
}, entry, { timeout: 30000 });
const waitFor = (fn, timeout = 20000) => page.waitForFunction(fn, null, { timeout }).then(() => true).catch(() => false);

try {
    await page.goto(`${baseUrl(8742)}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    const folders = await waitFor(() => (window.__cards?.()?.folders?.length ?? 0) > 0, 30000);
    check("the starter card folders exist, so the CARD FOLDERS row is on the list", folders);
    await page.evaluate(() => {
        if (window.__cutscene?.isActive?.()) { window.__cutscene.start([], null, null); window.__cutscene.step(1); }
        const s = window.__state;
        s.party = ["p003pken", "p004kogu", "p006rna"];
        const stats = { level: 12, xp: 100, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            core: [50, 40, 30, 20, 10, 5], elements: [1, 2, 3, 4, 5, 6, 7] };
        s.partyStats = s.party.map(() => ({ ...stats }));
        s.partnerStats = s.partyStats[0];
        s.inventory = [];
    });

    // 1. Field START -> the one pause list, cursor down to CARD FOLDERS.
    await press("i");
    await waitEntry("home");
    await page.waitForFunction(() => {
        const s = window.__status?._session;
        return window.__status?.diagnostics?.().entry === "home" && s && s.mem.read32(s.root + 0x10) === 3;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/1-pause-list.png` });
    const onRow5 = await walkTo(5);
    check("the cursor walks to CARD FOLDERS (row 5)", onRow5, `row ${await homeRow()}`);
    await press("c");
    const panel = await waitFor(() => window.__status?.diagnostics?.().entry === "cardfolders"
        && (window.__status?.diagnostics?.().classes ?? []).includes(0x80084a98), 30000);
    const opened = await snap();
    check("CARD FOLDERS opens the translated page (root 0x80084a98)", panel && opened.statusOpen,
        JSON.stringify({ entry: opened.entry, classes: opened.classes }));
    check("the hand-drawn panel is not shown on the way in", opened.menuScreen !== "cardfolder",
        `menuScreen ${opened.menuScreen}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/2-card-folders.png` });

    // 2. Card Album: the page's own confirm on its own choice row.
    await press("c");
    const albumUp = await waitFor(() => window.__cardAlbum?.isOpen?.() === true, 20000);
    const handed = await snap();
    check("confirming Card Album hands off to the album", albumUp && handed.album && !handed.statusOpen,
        JSON.stringify({ album: handed.album, statusOpen: handed.statusOpen }));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/3-card-album.png` });

    // 3. Leave the album. The Album is still the shipped pro/stcrdabm screen
    // (its own translation is unfinished work, so it reads the pad word through
    // the native-screen host and asks for its overlay): it samples the held pad
    // once per frame and its Back is the bit the walker's Escape carries.
    const nativeBeforeAlbum = native.length;
    for (let n = 0; n < 12; n++) {
        if (await page.evaluate(() => window.__cardAlbum?.isOpen?.() !== true)) break;
        await press("Escape", 320, 700);
    }
    const albumGone = await page.evaluate(() => window.__cardAlbum?.isOpen?.() !== true);
    const back = albumGone && await waitFor(() => window.__status?.isOpen?.() === true
        && window.__status?.diagnostics?.().entry === "cardfolders", 25000);
    const returned = await snap();
    returned.albumGone = albumGone;
    check("leaving the album reopens the translated CARD FOLDERS page", back && returned.statusOpen,
        JSON.stringify({ albumGone: returned.albumGone, entry: returned.entry,
            statusOpen: returned.statusOpen, frames: returned.frames }));
    check("the page is the disc's own, root 0x80084a98, not menu.js's drawing",
        (returned.classes ?? []).includes(0x80084a98) && returned.menuScreen !== "cardfolder",
        JSON.stringify({ classes: returned.classes, menuScreen: returned.menuScreen }));
    check("the party's panel is back, so the page really rebuilt", (returned.classes ?? []).length > 1,
        JSON.stringify({ classes: returned.classes }));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/4-back-on-card-folders.png` });

    // 4. Its own choice row starts on "Card Album": confirm with no direction
    //    pressed must open the album again, not the folder editor. That is the
    //    fresh page's own two-row toggle (+0x70, written only by Up/Down —
    //    pro/ststatus.s:1616, 1645 — read into +0x14 on confirm, `:1691-1699`).
    await press("c");
    const albumAgain = await waitFor(() => window.__cardAlbum?.isOpen?.() === true, 25000);
    check("the rebuilt page opens the Card Album on its first confirm", albumAgain,
        JSON.stringify(await snap()));
    await page.screenshot({ path: `${out}/5-album-again.png` });
    for (let n = 0; n < 12; n++) {
        if (await page.evaluate(() => window.__cardAlbum?.isOpen?.() !== true)) break;
        await press("Escape", 320, 700);
    }
    const again = await waitFor(() => window.__status?.isOpen?.() === true
        && window.__status?.diagnostics?.().entry === "cardfolders", 25000);
    check("leaving it a second time lands on that same page", again, JSON.stringify(await snap()));
    await page.screenshot({ path: `${out}/6-back-again.png` });

    // 5. Back out: the pause list returns on the CARD FOLDERS row (D0x8005CCF0).
    await press("Escape");
    const home = await waitFor(() => window.__status?.diagnostics?.().entry === "home"
        && window.__status?._session?.mem.read32(window.__status._session.root + 0x10) === 3, 25000);
    const list = await snap();
    check("Back returns to the pause list on the CARD FOLDERS row", home && list.row === 5,
        JSON.stringify({ entry: list.entry, row: list.row }));
    check("still the translated list, and menu.js's panel never appeared",
        (list.classes ?? []).includes(0x8001270c) && list.menuScreen !== "cardfolder",
        JSON.stringify({ classes: list.classes, menuScreen: list.menuScreen }));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/7-pause-list-row-5.png` });

    // 6. And Back again closes the pause, giving the field its START back.
    await press("Escape");
    const closed = await waitFor(() => window.__status?.isOpen?.() === false, 20000);
    const after = await snap();
    check("Back closes the pause and restores the field", closed && after.menuOpen === false,
        JSON.stringify({ statusOpen: after.statusOpen, menuOpen: after.menuOpen }));
    await page.screenshot({ path: `${out}/8-field-again.png` });

    // The pause runs TRANSLATED code: no original-code host behind it. The album
    // and the folder editor behind it still load their own overlay through the
    // native-screen host — that half of the card screens' translation is
    // unfinished work of its own — so the executable requests are named here
    // rather than hidden, and none of them may be anything but a screen overlay.
    const host = await page.evaluate(() => window.__status?._host ?? null);
    check("the pause has no original-code host behind it", host === null, JSON.stringify(host));
    check("every executable asset asked for is a card screen's own overlay",
        native.every((u) => /assets\/native\/screens\//.test(u)),
        native.filter((u) => !/screens\//.test(u)).join(", "));
    check("production had no page errors", errors.length === 0, errors.join(" | "));
    writeFileSync(`${out}/verify-output.txt`, `${results.join("\n")}\n`);
    writeFileSync(`${out}/snapshots.json`, `${JSON.stringify({ opened, handed, returned, list, after, nativeBeforeAlbum }, null, 2)}\n`);
    if (results.some((line) => line.startsWith("FAIL"))) process.exitCode = 1;
} finally { await browser.close(); }
