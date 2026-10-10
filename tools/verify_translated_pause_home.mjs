// Ordinary field START -> translated pause home -> translated page -> remembered home.
// Serve web on port 8742; run through tools/run-playwright.sh.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "captures/step-g-translated-pause-home-2026-10-01";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => { localStorage.setItem("assetMode", "authentic"); });
const errors = [], native = [], results = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/assets/native/**", (route) => { native.push(route.request().url()); route.abort(); });
const check = (label, valid, detail) => {
    const line = `${valid ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`;
    results.push(line); console.log(line);
};
const waitEntry = (entry) => page.waitForFunction((expected) => {
    const d = window.__status?.diagnostics?.();
    return d?.open && !d.pending && d.entry === expected && d.renderer.frames > 0;
}, entry, { timeout: 30000 });
const press = async (key) => { await page.keyboard.down(key); await page.waitForTimeout(100); await page.keyboard.up(key); };
const diag = () => page.evaluate(() => window.__status.diagnostics());
const homeReady = () => page.waitForFunction(() => {
    const s = window.__status?._session;
    return window.__status?.diagnostics?.().entry === "home" && s &&
        s.mem.read32(s.root + 0x10) === 3;
}, null, { timeout: 30000 });

try {
    await page.goto(`${baseUrl(8742)}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    // The default Asuka fixture can still be playing its scripted opening.
    // Settle that fixture so START reaches the field input path.
    await page.evaluate(() => {
        if (window.__cutscene?.isActive?.()) {
            window.__cutscene.start([], null, null);
            window.__cutscene.step(1);
        }
        const s = window.__state;
        s.party = ["p003pken", "p004kogu", "p006rna"];
        const stats = { level: 12, xp: 100, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            core: [50, 40, 30, 20, 10, 5], elements: [1, 2, 3, 4, 5, 6, 7] };
        s.partyStats = s.party.map(() => ({ ...stats }));
        s.partnerStats = s.partyStats[0];
    });
    await page.screenshot({ path: `${out}/before-field.png` });
    await press("i");
    await waitEntry("home");
    await homeReady();
    const first = await diag();
    check("START opens the translated first list", first.classes.includes(0x8001270c) && first.error === null,
        JSON.stringify({ entry: first.entry, classes: first.classes, error: first.error }));
    await page.screenshot({ path: `${out}/after-home.png` });
    await page.waitForTimeout(900);
    await press("ArrowDown");
    await page.waitForTimeout(150);
    await press("c");
    await waitEntry("sort");
    await page.waitForFunction(() => window.__status.diagnostics().classes.includes(0x800980b0), null, { timeout: 30000 });
    const sort = await diag();
    check("choosing SORT waits for the list to shut before opening its page", sort.classes.includes(0x800980b0),
        JSON.stringify({ entry: sort.entry, classes: sort.classes }));
    await page.screenshot({ path: `${out}/after-sort.png` });
    for (let n = 0; n < 12; n++) {
        if ((await diag()).entry === "home") break;
        await page.waitForTimeout(400);
        await press("Escape");
    }
    await waitEntry("home");
    await homeReady();
    const returned = await page.evaluate(() => ({
        row: window.__status._session?.mem.read32(window.__status._session.root + 0x58),
        open: window.__state.menuOpen,
    }));
    const cursor = await page.evaluate(() => {
        const s = window.__status._session, mem = s.mem;
        const slots = mem.read32(s.root + 0x24), icon = mem.read32(slots + 0x24);
        const block = mem.read32(icon + 0x24), child = mem.read32(block);
        return { icon, block, child, visible: mem.read32(icon + 0x64), state: mem.read32(icon + 0xc),
            registered: s.widgets.iconAddresses?.has(icon >>> 0), iconCount: s.widgets.iconAddresses?.size,
            glyph: child ? s.widgets.textWidgets().find((w) => w.addr === child)?.lines?.[0]?.bytes : null };
    });
    check("the returned list shows a live cursor", cursor.visible === 1 && cursor.child !== 0,
        JSON.stringify({ visible: cursor.visible, child: cursor.child }));
    check("Back returns to the remembered SORT row", returned.row === 1 && returned.open,
        JSON.stringify(returned));
    await page.screenshot({ path: `${out}/after-return.png` });
    await page.waitForTimeout(900);
    await press("Escape");
    await page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 30000 });
    const closed = await page.evaluate(() => ({ menuOpen: window.__state.menuOpen, statusOpen: window.__status.isOpen() }));
    check("Back closes the list and restores the field", !closed.menuOpen && !closed.statusOpen,
        JSON.stringify(closed));
    await page.screenshot({ path: `${out}/after-close.png` });
    check("production requested no executable assets", native.length === 0, native.join(", "));
    check("production had no page errors", errors.length === 0, errors.join(" | "));
    // `?legacyPause=1` used to select web/menu.js's own hand-written copy of the
    // pause list, a second list for one system of the original. It is gone
    // (2026-10-04): the switch is inert and the field opens the translated list,
    // which is what this now proves.
    const legacy = await browser.newPage();
    await legacy.addInitScript(() => { localStorage.setItem("assetMode", "authentic"); });
    await legacy.goto(`${baseUrl(8742)}/?skipTitle=1&noEncounters=1&legacyPause=1`, { waitUntil: "load" });
    await legacy.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await legacy.evaluate(() => {
        if (window.__cutscene?.isActive?.()) {
            window.__cutscene.start([], null, null);
            window.__cutscene.step(1);
        }
        const s = window.__state;
        s.party = ["p003pken", "p004kogu", "p006rna"];
        const stats = { level: 12, xp: 100, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            core: [50, 40, 30, 20, 10, 5], elements: [1, 2, 3, 4, 5, 6, 7] };
        s.partyStats = s.party.map(() => ({ ...stats }));
        s.partnerStats = s.partyStats[0];
    });
    await legacy.keyboard.press("i");
    await legacy.waitForFunction(() => window.__status?.diagnostics?.().entry === "home", null, { timeout: 30000 })
        .catch(() => {});
    await legacy.waitForTimeout(900);
    await legacy.screenshot({ path: `${out}/before-legacy-home.png` });
    const oldRoute = await legacy.evaluate(() => ({ open: window.__state.menuOpen,
        translatedOpen: window.__status.isOpen(), entry: window.__status.diagnostics().entry,
        classes: window.__status.diagnostics().classes }));
    check("the removed ?legacyPause=1 switch no longer selects a second list: START still opens the translated one",
        oldRoute.open && oldRoute.translatedOpen && oldRoute.entry === "home" &&
        oldRoute.classes.includes(0x8001270c), JSON.stringify(oldRoute));
    await legacy.close();
    writeFileSync(`${out}/verify-output.txt`, results.join("\n") + "\n");
    writeFileSync(`${out}/diagnostics.json`, JSON.stringify({ first, sort, returned, closed, native, errors }, null, 2) + "\n");
    if (results.some((line) => line.startsWith("FAIL"))) process.exitCode = 1;
} finally { await browser.close(); }
