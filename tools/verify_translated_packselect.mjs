// The opening's registration wizard on translated code, with executable assets
// forbidden. The real web/game.js opening on map s785 reaches the Online Center
// clerk; the player sits through the introduction, types the account name, picks
// starter pack B and answers YES; the walker records the account name, the pack
// and the granted partners. Serve web/ on port 8742:
//   python3 -m http.server 8742 --directory web
//
//   tools/run-playwright.sh tools/verify_translated_packselect.mjs [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.PACK_ROOT || `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? ".dw3-research/part-d-2026-09-28/translated-packselect";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], executableRequests = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});
await page.route("**/assets/native/**", (route) => {
    executableRequests.push(route.request().url());
    return route.abort();
});
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));

const press = async (key, ms = 160) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(140);
};
const task = (cls, off) => page.evaluate(([c, o]) => {
    const s = window.__packSelectNative?._session;
    const t = s && [...s.tree.tasks.values()].find((x) => x.classId === c);
    return t ? s.mem.read32(t.address + o) | 0 : null;
}, [cls, off]);
const KEYBOARD = 0x80085a70, PACK_LIST = 0x80087a30, CONFIRM = 0x80086eb8, CHROME = 0x80083774;
const waitFor = async (fn, ms = 90000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await fn()) return true;
        await page.waitForTimeout(150);
    }
    return false;
};

try {
    await page.goto(`${ROOT}/?skipTitle=1&map=s785&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.evaluate(() => { window.__gameSpeed = 8; });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        if (await page.evaluate(() => !!window.__state.packSelect)) break;
        await press("Enter", 120);
    }
    check("the opening reached the registration wizard", await page.evaluate(() => !!window.__state.packSelect));
    await waitFor(async () => (await task(CHROME, 0xc)) === 1, 30000);
    await page.screenshot({ path: `${OUT}/01-clerk-introduction.png` });

    // Sit through the clerk's introduction: confirm at each page break.
    for (let i = 0; i < 200 && (await task(KEYBOARD, 0x10)) !== 2; i++) {
        await press("Enter", 140);
    }
    await page.evaluate(() => { window.__gameSpeed = 1; });
    check("the account-name keyboard is live", (await task(KEYBOARD, 0x10)) === 2 && (await task(KEYBOARD, 0xc)) === 1);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/02-name-keyboard.png` });

    await press("Enter", 100);       // types A over the first letter
    await press("i", 100);           // Start jumps to OK
    await press("Enter", 140);       // accept the name
    check("the pack list opened", await waitFor(async () => (await task(PACK_LIST, 0xc)) === 1, 30000));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/03-pack-list.png` });
    await press("ArrowDown", 140);   // pack B
    check("pack B is highlighted", (await task(PACK_LIST, 0x6c)) === 1, `pack=${await task(PACK_LIST, 0x6c)}`);
    await page.screenshot({ path: `${OUT}/04-pack-b.png` });
    await press("Enter", 140);       // accept the pack
    check("the confirm panel opened", await waitFor(async () => (await task(CONFIRM, 0xc)) === 1 && (await task(CONFIRM, 0x10)) === 0, 30000));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/05-confirm.png` });
    await press("Enter", 140);       // YES
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/06-registering.png` });
    check("the wizard finished", await waitFor(async () => !(await page.evaluate(() => !!window.__state.packSelect)), 60000));

    const after = await page.evaluate(() => ({
        playerName: window.__state.playerName ?? null,
        packId: window.__state.packId ?? null,
        pending: window.__state.pendingParty ?? null,
        stored: localStorage.getItem("playerName"),
        storedPack: localStorage.getItem("packId"),
    }));
    console.log("[verify] after registration:", JSON.stringify(after));
    await page.screenshot({ path: `${OUT}/07-after.png` });
    check("the walker recorded pack B", after.packId === "B", `packId=${after.packId}`);
    check("the account name reached the walker", /^A/.test(after.playerName ?? "") && after.stored === after.playerName,
        `playerName=${after.playerName}`);
    check("the granted partners are pack B's", Array.isArray(after.pending) && after.pending.length === 3, JSON.stringify(after.pending));
    check("no executable asset was requested", executableRequests.length === 0, executableRequests.join(", "));
    check("no page errors", errors.length === 0, errors.join(" | "));
    writeFileSync(`${OUT}/proof.json`, JSON.stringify({ execution: "translated", after, executableRequests, errors, failures }, null, 2) + "\n");
    if (failures) { console.error(`FAIL translated registration: ${failures} check(s) failed`); process.exitCode = 1; }
    else console.log(`PASS translated registration: name, pack B and YES; ${OUT}/proof.json`);
} catch (e) {
    console.error("FAIL translated registration: " + e.message);
    if (errors.length) console.error(errors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
