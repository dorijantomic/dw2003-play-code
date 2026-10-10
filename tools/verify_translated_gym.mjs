// Browser proof for the translated training gym (pro/stgtrain), Step E of
// docs/plans/2026-09-28-translated-game-completion-plan.md.
//
// Two runs through the real web/game.js:
//   1. reference: `?nativeGym=1`, the original code through the MIPS interpreter
//      (the "before" pictures). It needs the executable files under assets/native/**.
//   2. ordinary route, no flags, every assets/native/** request denied FROM PAGE
//      LOAD: the translated GymSession runs the whole screen, sprite actors included.
// Production scenario (a Kotemon with 30 TP, the greeter's rank group 3):
//   enter the gym; pick the partner, the first drill (STR) and TP 1; answer Yes; run the three
//   reps; read the summary; leave. The walker's partner block is untouched until the screen
//   closes; afterwards TP dropped by exactly the cost and STR rose by exactly the sum the
//   screen's own gain plates showed, committed once. Then: cancel at the drill list (nothing
//   changes); and a partner with 0 TP is refused at the TP list (nothing changes).
//
// KEYS. Enter opens, `Escape` goes back, on the word bits the screens read. The
// original's gym flow machine reads logical button 0x0D to open the drill list
// and logical 0x0E to leave the screen
// (exe-decomp/stgtrain_c/F0x8008517c.c:116 and :126, ported at
// engine/dw3/ui/gym-flow.ts:156-166), and the walker's one pad table sends word
// bit 0x2000 to Enter/space/z/c and word bit 0x4000 to Escape/x
// (engine/systems/input-map.ts:225 and :234). So "leave the screen" is `Escape`
// here, not `c`: since 173ebcf0 `c` sits on the confirm bit.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_translated_gym.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/step-e-translated-gym-2026-09-30";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    results.push(line);
    if (!ok) failures++;
};

const browser = await chromium.launch();

async function openPage({ query = "", denyNative = false }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const net = { denied: [], allowed: [], data: [] };
    await page.route("**/assets/native/**", (route) => {
        if (denyNative) { net.denied.push(route.request().url()); return route.abort(); }
        net.allowed.push(route.request().url());
        return route.continue();
    });
    page.on("request", (req) => { if (/assets\/data\/(gym\/|shop_font|shop_catalog|shop_item|shop_desc)/.test(req.url())) net.data.push(req.url()); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    // The visual-style chooser is a first-run prompt; answer it before load so captures are clean.
    await page.addInitScript(() => { try { localStorage.setItem("assetMode", "authentic"); } catch { /* storage may be blocked */ } });
    await page.goto(`${BASE}${query}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    return { page, net, errors };
}

const press = async (page, key, wait = 500) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(110);
    await page.keyboard.up(key);
    await page.waitForTimeout(wait);
};

/** A single Kotemon with known numbers. */
async function seedPartner(page, { tp = 30 } = {}) {
    await page.evaluate((tpValue) => {
        const s = window.__state;
        s.bits = 5000;
        s.party = ["p003pken"];
        s.partnerStats = {
            digimonId: 1, level: 12, xp: 0, tp: tpValue, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            stats: { str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16 }, elemBonuses: {},
        };
        s.partyStats = [null];
        s.inventory = [{ id: 40, qty: 1 }];
        localStorage.removeItem("partnerStats");
    }, tp);
}
const partner = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__state.partnerStats)));

// ── before: the reference route (original code through the interpreter) ────
{
    const { page, errors } = await openPage({ query: "&nativeGym=1" });
    await seedPartner(page);
    await page.evaluate(() => window.__gym.open(window.__state, null, 3, 573));
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/before-01-pod-select.png` });
    const d = await page.evaluate(() => window.__gym.diagnostics());
    check("reference: the original screen ran (host present)", !!d.host, `traps=${d.host?.traps}`);
    await press(page, "Enter", 2500);
    await page.screenshot({ path: `${OUT}/before-02-drill-list.png` });
    await press(page, "Enter", 2500);
    await page.screenshot({ path: `${OUT}/before-03-tp-list.png` });
    await press(page, "Enter", 2500);
    await press(page, "Enter", 6000);
    await page.screenshot({ path: `${OUT}/before-04-workout.png` });
    const stepOf = () => page.evaluate(() => {
        const rt = window.__gym._host?.rt;
        const o = rt?.world.objects.find((x) => x.alive && (x.cb >>> 0) === 0x80087f28);
        return o ? rt.mem.read32(o.addr + 0x10) : null;
    });
    for (let i = 0; i < 80 && (await stepOf()) !== 6; i++) await page.waitForTimeout(700);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/before-05-result.png` });
    check("reference: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
}

// ── after: the production route, executables denied ─────────────────────────
const { page, net, errors } = await openPage({ denyNative: true });
const diag = () => page.evaluate(() => window.__gym.diagnostics());
const gymState = async () => (await diag()).state;
async function waitFor(fn, what, timeout = 40000, arg = null) {
    try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); return true; } catch {
        check(`wait: ${what}`, false, JSON.stringify((await diag()).state));
        return false;
    }
}
const tick = async (n = 1) => { for (let i = 0; i < n; i++) await page.waitForTimeout(120); };
const screenText = () => page.evaluate(async () => {
    const { drawNativeTextWidgets } = await import("/native-screen-text.js");
    const widgets = window.__gym.textWidgets?.() ?? [];
    return drawNativeTextWidgets({ drawImage() {} }, widgets.filter((w) => w.visible)).texts ?? [];
});

await seedPartner(page);
check("production: the translated screen is the default route", (await page.evaluate(() => window.__gym.diagnostics().execution)) === "translated");
const before = await partner(page);

// 1. The full workout.
await page.evaluate(() => window.__gym.open(window.__state, null, 3, 573));
await waitFor(() => window.__gym.diagnostics().state?.flow === 5, "the pod select");
await tick(6);
await page.screenshot({ path: `${OUT}/after-01-pod-select.png` });
let d = await diag();
check("production: the screen booted through the recorded display service",
    d.displayCalls.some((c) => c.call === "displayView") && d.tasks >= 2, `calls=${d.displayCalls.length} tasks=${d.tasks}`);
check("production: the rank group is the greeter's (3)", d.group === 3, `group=${d.group}`);
check("production: the walker is untouched while the screen is open", (await partner(page)).tp === 30);
await press(page, "Enter", 300);
await waitFor(() => window.__gym.diagnostics().state?.flow === 0xb, "the drill list");
await waitFor(() => { const s = window.__gym.diagnostics().state; return s && s.picker !== 0; }, "the picker object");
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/after-02-drill-list.png` });
await press(page, "Enter", 300);
await waitFor(() => { const s = window.__gym.diagnostics().state; return s && s.confirm !== 0; }, "the confirm panel");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/after-03-tp-list.png` });
const tpText = (await screenText()).join("|");
check("production: the TP list prints its three choices", /1/.test(tpText) && /10/.test(tpText), tpText.slice(0, 120));
await press(page, "Enter", 300); // TP 1
await page.waitForTimeout(2500);
await press(page, "Enter", 300); // Yes
await waitFor(() => window.__gym.diagnostics().state?.session !== 0, "the training window");
check("production: the TP cost reached the screen's record only", (await diag()).records[0].tp === 29 && (await partner(page)).tp === 30,
    `record=${(await diag()).records[0].tp} walker=${(await partner(page)).tp}`);
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/after-04-workout.png` });
d = await diag();
check("production: the workout scene is drawn by the translated actors", (d.primitives?.sprites ?? 0) > 0,
    `sprites=${d.primitives?.sprites} quads=${d.primitives?.quads} uploads=${d.uploads}`);
// Step 5 waits for a confirm press before it composes the result message (step 6).
for (let i = 0; i < 180; i++) {
    const step = (await diag()).training?.step;
    if (step === 6) break;
    if (step === 5) await press(page, "Enter", 400); else await page.waitForTimeout(700);
}
check("production: the result message opened", (await diag()).training?.step === 6, JSON.stringify((await diag()).training));
await page.waitForTimeout(2500);
const shownTraining = (await diag()).training;
const summaryText = (await screenText()).join("|");
await page.screenshot({ path: `${OUT}/after-05-result.png` });
const gained = shownTraining.gains.reduce((a, b) => a + b, 0);
check("production: the summary prints the gain the reps rolled", summaryText.includes(String(gained)) || gained === 0, `gain=${gained} text=${summaryText.slice(0, 160)}`);
check("production: the walker is still untouched before the screen closes", (await partner(page)).stats.str === 11);
// Dismiss the message and leave.
for (let i = 0; i < 14 && (await gymState())?.session !== 0; i++) await press(page, "Enter", 500);
await waitFor(() => window.__gym.diagnostics().state?.flow === 5, "back at the pod select");
await press(page, "Escape", 900);
await waitFor(() => !window.__gym.isOpen(), "the screen to close", 30000);
const after = await partner(page);
check("commit: TP dropped by exactly the cost", after.tp === before.tp - 1, `tp ${before.tp} -> ${after.tp}`);
check("commit: STR rose by exactly the screen's gain", after.stats.str === before.stats.str + gained, `str ${before.stats.str} -> ${after.stats.str} (screen ${gained})`);
check("commit: no other stat moved", ["def", "spt", "wis", "spd", "chr"].every((k) => after.stats[k] === before.stats[k]), JSON.stringify(after.stats));
check("commit: max HP / max MP / level unchanged", after.maxHp === 50 && after.maxMp === 25 && after.level === 12);
const summary = await page.evaluate(() => window.__gym.diagnostics().summary);
check("commit: the screen closed by itself and committed once", summary?.finished === true && (await page.evaluate(() => window.__gym._committed)) === 1);
check("commit: the screen asked for its exit sound", summary?.sounds?.includes(0x60840002));
check("commit: the partner block was persisted", JSON.parse(await page.evaluate(() => localStorage.getItem("partnerStats") ?? "null"))?.tp === after.tp);
await writeFileSync(`${OUT}/translated-diagnostics.json`, JSON.stringify({ before, after, training: shownTraining, summaryText, summary }, null, 2));

// 2. Cancel once: nothing changes.
await page.evaluate(() => window.__gym.open(window.__state, null, 3, 573));
await waitFor(() => window.__gym.diagnostics().state?.flow === 5, "the pod select (cancel run)");
await press(page, "Enter", 300);
await waitFor(() => { const s = window.__gym.diagnostics().state; return s && s.picker !== 0; }, "the picker (cancel run)");
await page.waitForTimeout(1800);
await press(page, "Escape", 300);
await waitFor(() => window.__gym.diagnostics().state?.flow === 5, "back at the pod select (cancel run)");
await press(page, "Escape", 900);
await waitFor(() => !window.__gym.isOpen(), "the cancel run to close", 30000);
const cancelled = await partner(page);
check("cancel: nothing changed", JSON.stringify(cancelled) === JSON.stringify(after), JSON.stringify(cancelled.stats));

// 3. Not enough TP.
await seedPartner(page, { tp: 0 });
await page.evaluate(() => window.__gym.open(window.__state, null, 3, 573));
await waitFor(() => window.__gym.diagnostics().state?.flow === 5, "the pod select (refusal run)");
await press(page, "Enter", 300);
await waitFor(() => { const s = window.__gym.diagnostics().state; return s && s.picker !== 0; }, "the picker (refusal run)");
await page.waitForTimeout(1800);
await press(page, "Enter", 300);
await waitFor(() => { const s = window.__gym.diagnostics().state; return s && s.confirm !== 0; }, "the confirm panel (refusal run)");
await page.waitForTimeout(2500);
await press(page, "Enter", 300); // TP 1 with 0 TP
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/after-06-not-enough-tp.png` });
const refusalText = (await screenText()).join("|");
check("refusal: the panel shows the refusal line", refusalText.length > 0, refusalText.slice(0, 120));
check("refusal: no training window opened and nothing was charged", (await gymState())?.session === 0 && (await diag()).records[0].tp === 0);
await press(page, "Enter", 900);
await press(page, "Escape", 900);
for (let i = 0; i < 4 && (await page.evaluate(() => window.__gym.isOpen())); i++) await press(page, "Escape", 1200);
await waitFor(() => !window.__gym.isOpen(), "the refusal run to close", 30000);
const refused = await partner(page);
check("refusal: the partner's TP and stats are unchanged", refused.tp === 0 && refused.stats.str === 11, JSON.stringify(refused.stats));

check("no executable asset was requested in production", net.allowed.length === 0 && net.denied.length === 0,
    `denied=${net.denied.length} allowed=${net.allowed.length}`);
check("the screen's data files were fetched", net.data.some((u) => /gym\/tables\.bin/.test(u)) && net.data.some((u) => /gym\/tranin\//.test(u)));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
