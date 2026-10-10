// Focused check for the last two rollback switches (Phase 6.5 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md): "rollback
// switches, if retained, are off by default and tested explicitly".
//
// Twelve of the fourteen `?legacy…=1` switches already appear in tool checks that
// drive them; this covers `legacyStatus` and `legacyTitle`, which were only
// asserted off-by-default by tests/native-route-defaults.test.js:
//
//   status — default: the translated pause/status page (web/status-translated.js,
//            diagnostics() with no `host`); `?nativeStatus=1` runs the shipped
//            pro/ststatus page as a research reference; `?legacyStatus=1` rolls
//            back to the walker's hand-authored page, where `status` is null and
//            no native screen boots.
//   title  — default: the translated title (web/titlescreen.js, no diagnostics);
//            `?nativeTitle=1` runs the shipped pro/stdwtitl; `?legacyTitle=1` is
//            the same translated title today and boots no native screen.
//
//   tools/run-playwright.sh tools/verify_native_rollbacks.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`, VERIFY_PORT=<port>.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-rollbacks-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const SEED = `
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify({ digimonId: 1, level: 12, xp: 0, tp: 30, hp: 60, maxHp: 60, mp: 21, maxMp: 25, stats: { str: 40, def: 30, spt: 25, wis: 20, spd: 30, chr: 10 }, elemBonuses: {} }));
  localStorage.setItem("partyStats", JSON.stringify([null, null, null]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
`;

const browser = await chromium.launch();

async function statusRun(page, route) {
    await page.addInitScript(SEED);
    const url = `${ROOT}/?skipTitle=1&map=s245&noEncounters=1${route}`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.evaluate(() => window.__labOpen("status"));
    await page.waitForTimeout(2200);
    return page.evaluate(() => ({
        statusIsNull: window.__status === null,
        hasDiagnostics: typeof window.__status?.diagnostics === "function",
        module: window.__status?.diagnostics?.()?.host?.module ?? null,
        booted: window.__status?.diagnostics?.()?.host?.booted ?? null,
        hasHost: typeof window.__status?.diagnostics?.()?.host !== "undefined",
        nativeObjects: window.__nativeScreenObjects?.()?.length ?? 0,
        menuScreen: window.__menu?.screen ?? null,
    }));
}

// ── status: the default route is the translated page, no original-code host ──
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const s = await statusRun(page, "");
    check("status default is the translated page", s.hasDiagnostics === true);
    check("status default boots no original-code host", s.hasHost === false,
        `module=${s.module}`);
    await page.screenshot({ path: `${OUT}/01-status-translated.png` });
    await page.close();
}

// ── status: nativeStatus=1 runs the shipped pro/ststatus as the reference ───
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const s = await statusRun(page, "&nativeStatus=1");
    check("nativeStatus=1 selects the original-code page", s.hasDiagnostics === true);
    check("nativeStatus=1 boots the shipped pro/ststatus", s.module === "pro/ststatus" && s.booted === true,
        `module=${s.module} booted=${s.booted}`);
    await page.screenshot({ path: `${OUT}/02-status-reference.png` });
    await page.close();
}

// ── status: legacyStatus=1 selects the walker's own list ────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const s = await statusRun(page, "&legacyStatus=1");
    check("legacyStatus=1 leaves no native status adapter", s.statusIsNull === true, `statusIsNull=${s.statusIsNull}`);
    check("legacyStatus=1 boots no native screen", s.nativeObjects === 0, `objects=${s.nativeObjects}`);
    await page.screenshot({ path: `${OUT}/03-status-legacy.png` });
    await page.close();
}

// ── title: the default route is the translated title ─────────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(SEED);
    await page.goto(`${ROOT}/?noEncounters=1&skipLanguage=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__titleState === "function", { timeout: 60000 });
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => ({
        hasDiagnostics: typeof window.__titleState()?.diagnostics === "function",
        nativeObjects: window.__nativeScreenObjects?.()?.length ?? 0,
    }));
    check("title default is the translated screen", t.hasDiagnostics === false);
    check("title default boots no native screen", t.nativeObjects === 0, `objects=${t.nativeObjects}`);
    await page.screenshot({ path: `${OUT}/04-title-translated.png` });
    await page.close();
}

// ── title: nativeTitle=1 runs the shipped pro/stdwtitl as the reference ─────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(SEED);
    await page.goto(`${ROOT}/?noEncounters=1&skipLanguage=1&nativeTitle=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__titleState === "function", { timeout: 60000 });
    await page.waitForFunction(() => window.__titleState()?.diagnostics?.()?.host?.booted === true, { timeout: 40000 })
        .catch(() => {});
    const t = await page.evaluate(() => {
        const d = window.__titleState()?.diagnostics?.() ?? null;
        return { hasDiagnostics: typeof window.__titleState()?.diagnostics === "function", module: d?.host?.module ?? null, booted: d?.host?.booted ?? null };
    });
    check("nativeTitle=1 selects the original-code screen", t.hasDiagnostics === true);
    check("nativeTitle=1 boots the shipped pro/stdwtitl", t.module === "pro/stdwtitl" && t.booted === true,
        `module=${t.module} booted=${t.booted}`);
    await page.screenshot({ path: `${OUT}/05-title-reference.png` });
    await page.close();
}

// ── title: legacyTitle=1 selects the walker's own title ─────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(SEED);
    await page.goto(`${ROOT}/?noEncounters=1&skipLanguage=1&legacyTitle=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__titleState === "function", { timeout: 60000 });
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => ({
        hasDiagnostics: typeof window.__titleState()?.diagnostics === "function",
        nativeObjects: window.__nativeScreenObjects?.()?.length ?? 0,
    }));
    check("legacyTitle=1 leaves the walker's own title", t.hasDiagnostics === false, `hasDiagnostics=${t.hasDiagnostics}`);
    check("legacyTitle=1 boots no native screen", t.nativeObjects === 0, `objects=${t.nativeObjects}`);
    await page.screenshot({ path: `${OUT}/06-title-legacy.png` });
    await page.close();
}

console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
