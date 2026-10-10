// Ordinary DRI rename route on the translated naming screen, with executable
// assets forbidden. The player opens the rename desk with two partners, points
// at the second, types a name on the keyboard and confirms; a second visit is
// cancelled. Serve web/ on port 8742:  python3 -m http.server 8742 --directory web
//
//   tools/run-playwright.sh tools/verify_translated_naming.mjs [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NAME_ROOT || `${baseUrl(8742)}/`;
const OUT = process.argv[2] ?? ".dw3-research/part-d-2026-09-28/translated-naming";
mkdirSync(OUT, { recursive: true });
const KEYBOARD_CLASS = 0x80085078;
const TYPED = "ADC";

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
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken", "p004kogu"]));
    localStorage.setItem("bits", "5000");
});
const press = async (key, ms = 90) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(110);
};
const keyboard = () => page.evaluate((cls) => {
    const s = window.__nameEntryNative?._session;
    const task = s && [...s.tree.tasks.values()].find((t) => t.classId === cls);
    if (!task) return null;
    const o = task.address;
    const hex = [];
    for (let i = 0; i < 0x10; i++) hex.push(s.mem.read8(o + 0x78 + i).toString(16).padStart(2, "0"));
    return { col: s.mem.read32(o + 0x9c), row: s.mem.read32(o + 0xa0), name: hex.join(" ") };
}, KEYBOARD_CLASS);
const ready = () => page.waitForFunction(() => {
    const d = window.__nameEntryNative?.diagnostics?.();
    return d?.open === true && d.pending === false && d.tasks >= 2;
}, null, { timeout: 20000 });

try {
    await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 40000 });
    const [first, second] = await page.evaluate(() => window.__state.party.slice(0, 2));
    check("the walker has two partners", !!first && !!second, `party=${first},${second}`);
    await page.evaluate(([a, b]) => {
        window.__state.digimonNames = { ...(window.__state.digimonNames ?? {}), [a]: "FIRST", [b]: "ABC" };
    }, [first, second]);

    await page.evaluate(() => window.__applyStoryFlag(0x7c01, true));
    await ready();
    await page.waitForTimeout(4500); // the partner list folds in
    let d = await page.evaluate(() => window.__nameEntryNative.diagnostics());
    check("the DRI rename opened the translated naming screen", d.open && !d.error, JSON.stringify(d));
    check("the chooser points at the first partner", d.selected === 0, `selected=${d.selected}`);
    await page.screenshot({ path: `${OUT}/01-partner-list.png` });

    await press("ArrowDown", 140);
    d = await page.evaluate(() => window.__nameEntryNative.diagnostics());
    check("the second partner is selected", d.selected === 1, `selected=${d.selected}`);
    await press("Enter", 140);
    await page.waitForFunction((cls) => [...window.__nameEntryNative._session.tree.tasks.values()]
        .some((t) => t.classId === cls), KEYBOARD_CLASS, { timeout: 15000 });
    await page.waitForTimeout(1500);
    let k = await keyboard();
    check("the keyboard shows the second partner's name", (k?.name ?? "").startsWith("82 60 82 61 82 62"), `name=${k?.name}`);
    await page.screenshot({ path: `${OUT}/02-keyboard.png` });

    await press("Enter", 140);
    for (let i = 0; i < 3; i++) await press("ArrowRight", 90);
    await press("Enter", 140);
    k = await keyboard();
    check("typing changed the name to ADC", (k?.name ?? "").startsWith("82 60 82 63 82 62"), `name=${k?.name}`);
    for (let i = 0; i < 10; i++) await press("ArrowRight", 90);
    for (let i = 0; i < 5; i++) await press("ArrowDown", 90);
    k = await keyboard();
    check("the cursor reached OK", k?.col === 13 && k?.row === 6, `col=${k?.col} row=${k?.row}`);
    await page.screenshot({ path: `${OUT}/03-at-ok.png` });

    await press("Enter", 140);
    // The list returns after a confirmed name; leave it to close the visit.
    await page.waitForTimeout(4500);
    // Back is word bit 0x4000, reached with Escape or x (engine/systems/input-map.ts,
    // commit 173ebcf0). `c` reached that bit before 2026-10-03 and confirms now.
    await press("Escape", 140);
    await page.waitForFunction(() => window.__nameEntryNative?.isOpen?.() === false, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const done = await page.evaluate(([a, b]) => ({
        open: window.__nameEntryNative.isOpen(),
        second: window.__state.digimonNames?.[b] ?? null,
        first: window.__state.digimonNames?.[a] ?? null,
        stored: (() => { try { return JSON.parse(localStorage.getItem("digimonNames") ?? "{}")[b] ?? null; } catch { return null; } })(),
        results: window.__nameEntryNative.results(),
    }), [first, second]);
    console.log("[verify] after confirm and leave:", JSON.stringify(done));
    await page.screenshot({ path: `${OUT}/04-back-in-game.png` });
    check("the screen closed and control returned", done.open === false);
    check("the second partner's name is ADC", done.second === TYPED, `name=${done.second}`);
    check("the first partner keeps its name", done.first === "FIRST", `name=${done.first}`);
    check("the name was saved", done.stored === TYPED, `stored=${done.stored}`);
    check("exactly one name was confirmed", done.results.length === 1, JSON.stringify(done.results));

    // A second visit, cancelled at the list: nothing changes.
    await page.evaluate(() => window.__applyStoryFlag(0x7c01, true));
    await ready();
    await page.waitForTimeout(4500);
    // Back is word bit 0x4000, reached with Escape or x (engine/systems/input-map.ts,
    // commit 173ebcf0). `c` reached that bit before 2026-10-03 and confirms now.
    await press("Escape", 140);
    await page.waitForFunction(() => window.__nameEntryNative?.isOpen?.() === false, null, { timeout: 20000 });
    const cancelled = await page.evaluate(([a, b]) => ({
        result: window.__nameEntryNative.result(),
        second: window.__state.digimonNames?.[b] ?? null,
        first: window.__state.digimonNames?.[a] ?? null,
    }), [first, second]);
    check("cancel returns without accepting a name", cancelled.result.accepted === false, JSON.stringify(cancelled.result));
    check("cancel leaves both names alone", cancelled.second === TYPED && cancelled.first === "FIRST", JSON.stringify(cancelled));
    await page.screenshot({ path: `${OUT}/05-cancel-back-in-game.png` });

    check("no executable asset was requested", executableRequests.length === 0, executableRequests.join(", "));
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
    writeFileSync(`${OUT}/proof.json`, JSON.stringify({ execution: "translated", typed: TYPED,
        executableRequests, errors: pageErrors, failures }, null, 2) + "\n");
    if (failures) { console.error(`FAIL translated naming: ${failures} check(s) failed`); process.exitCode = 1; }
    else console.log(`PASS translated naming: DRI rename, second partner typed "${TYPED}", cancel leaves it; ${OUT}/proof.json`);
} catch (e) {
    console.error("FAIL translated naming: " + e.message);
    if (pageErrors.length) console.error(pageErrors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
