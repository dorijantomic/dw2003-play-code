// Focused production-route verifier for the ORDINARY-PLAY hand-off of the
// native post-fight results screen (pro/stfgtrep, Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// This is the route a player actually takes: win a fight, and the original
// results screen appears instead of the hand-drawn one. It starts a real
// battle through the game's own battle API, wins it with the ordinary FIGHT
// command (the enemy's HP is shortened only to make the fight quick), and then
// asserts:
//   * the victory report phase opened the native pro/stfgtrep overlay, 0 traps;
//   * the screen's own reward table paid the BIT for that battle id;
//   * leaving the screen returned to the field and the BIT persisted.
//
//   .opencode/autonomy/check-browser tools/verify_native_report_play.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.REPORT_PLAY_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.REPORT_PLAY_SHOT || "/tmp/opencode/native-report-play";
mkdirSync(OUT, { recursive: true });

// Battle screen 5 = 2x Numemon lv27; its reward record is [27, 268, 645].
const SCREEN = 5;
const REWARD_BITS = 645;
const START_BITS = 4321;

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const lead = {
    digimonId: 39, level: 60, xp: 0, tp: 10, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
    stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
    bonuses: {}, elemBonuses: {},
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Uncaught exceptions are the real signal. Resource 404s are excluded: the
// battle models for this encounter ship without slot_map.json (a pre-existing
// asset gap unrelated to this route).
const pageErrors = [];
const resourceMisses = [];
page.on("pageerror", (e) => { pageErrors.push(`pageerror: ${e.message}`); });
page.on("response", (r) => { if (r.status() >= 400) resourceMisses.push(`${r.status()} ${r.url()}`); });
page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("Failed to load resource")) return;
    pageErrors.push(`console: ${text}`);
});

await page.addInitScript((seed) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
    localStorage.setItem("partyStats", JSON.stringify([seed.lead]));
    localStorage.setItem("equipment", JSON.stringify([{}]));
    localStorage.setItem("rosterOwned", "1");
    localStorage.setItem("bits", String(seed.bits));
}, { lead, bits: START_BITS });

await page.goto(`${ROOT}?skipTitle=1&noEncounters=1&nativeReport=1`, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => window.__state?.started && window.__battle?.isActive, { timeout: 40000 });
console.log("[verify] game booted");

const bitsNow = () => page.evaluate(() => window.__state.bits);
const battleInfo = () => page.evaluate(() => {
    const b = window.__battleB?.();
    return b ? { state: b.state, phase: b._victoryPhase ?? null, screenId: b.screenId ?? null } : null;
});
const reportInfo = () => page.evaluate(() => ({
    open: window.__reportNative?.isOpen() ?? null,
    diag: window.__reportNative?.diagnostics?.() ?? null,
}));

const before = await bitsNow();
console.log("[verify] bits before:", before);

// The native screen samples the pad's held word once per frame, so a key must
// stay down across at least one game frame (a quick press can fall between).
const hold = async (key, ms = 260) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(160);
};

// Start a real battle through the game's own battle API.
await page.evaluate(async (screen) => {
    await window.__battle.startScreen(screen, null, null, null, { mapId: "s245" });
}, SCREEN);
await page.waitForFunction(() => !!window.__battleB?.(), null, { timeout: 20000 });
await page.waitForTimeout(600);
check("battle started", (await battleInfo()) !== null, JSON.stringify(await battleInfo()));

// Win it with the ordinary FIGHT command. The enemy HP is shortened only to
// keep the fight short; the victory flow itself is the production one.
await page.evaluate(() => { window.__gameSpeed = 4; });
let guard = 0;
while (guard++ < 120) {
    const info = await battleInfo();
    if (!info) break;
    if (info.phase === "report") break;
    const st = await page.evaluate(() => {
        const b = window.__battleB?.();
        if (b && b.state === 2 && b.enemy) b.enemy.hp = 1;
        return b?.state ?? null;
    });
    void st;
    await hold("Enter");
}
await page.evaluate(() => { window.__gameSpeed = 1; });
await page.waitForTimeout(600);

// The victory report phase should have handed over to the native overlay.
// `open` goes true the moment the battle asks for the screen; the overlay's
// root only exists once its executable assets have loaded (fightreport-native.js
// `boot()` runs from the first update frame, and `_pending` until then). Reading
// the diagnostics the instant `open` flips therefore measured the LOADING state,
// not the screen — so wait for the host itself before asserting anything about
// it. Cold runs used to report module=undefined / traps=undefined here.
await page.waitForFunction(() => window.__reportNative?.diagnostics?.()?.host != null,
    null, { timeout: 60000 }).catch(() => {});
let ri = await reportInfo();
console.log("[verify] report:", JSON.stringify(ri.diag?.host ? {
    module: ri.diag.host.module, traps: ri.diag.host.traps,
    objects: ri.diag.host.objects, frames: ri.diag.host.frames,
    bridge: ri.diag.host.bridgeEnabled,
} : ri.diag));
check("victory report opened the native screen", ri.open === true, `open=${ri.open}`);
check("native root booted", ri.diag?.host?.module === "pro/stfgtrep", `module=${ri.diag?.host?.module}`);
check("no traps on the victory report", (ri.diag?.host?.traps ?? -1) === 0, `traps=${ri.diag?.host?.traps}`);
check("bridge active on the victory report", !!ri.diag?.host?.bridgeEnabled, `bridge=${ri.diag?.host?.bridgeEnabled}`);

// The report's first page is the "EXP gained" one: the corner badge, the partner
// row and the esfgtrpt page string in the bottom message panel. The overlay builds
// that page over its own opening frames — the message widget is still empty when
// the host first appears — so WAIT for it (measured: it lands ~1.1s / ~43 frames
// after `open`, with no key pressed) instead of measuring the half-built page.
// Reading it early is why the bottom-panel check used to report an empty list.
await page.waitForFunction(
    () => window.__nativeTextWidgets().some((w) => w.visible && w.penY === 194 && w.lines[0].len > 0),
    null, { timeout: 30000 }).catch(() => {});
const readTextProof = () => page.evaluate(async () => {
    const { drawNativeTextWidgets } = await import('/native-screen-text.js');
    const widgets = window.__nativeTextWidgets();
    const stats = drawNativeTextWidgets({ drawImage() {} }, widgets);
    const footer = [];
    drawNativeTextWidgets({ drawImage: (...a) => footer.push(a.slice(5)) },
        widgets.filter(w => w.visible && w.penY === 194));
    return { texts: stats.texts, unknown: stats.unknown, footer,
        // (penX, penY) of every visible widget, so a failure names the row it drew.
        pens: widgets.filter(w => w.visible).map(w => [w.penX, w.penY]),
        // The decoded message bar: clip 29, 296x38 at (11,188)
        // (docs/research/ui/stfgtrep-decoded-2026-07-12.md "Chrome facts").
        fits: footer.length > 0 && footer.every(([x,y,w,h]) => x >= 11 && x+w <= 307 && y >= 188 && y+h <= 226) };
});
writeFileSync(`${OUT}/01-victory-report.png`, await page.screenshot());
const textProof = await readTextProof();
check('the visible report includes Kotemon', textProof.texts.includes('Kotemon'), JSON.stringify(textProof.texts));
check("reward text stays inside the bottom panel", textProof.fits, JSON.stringify(textProof.footer));
writeFileSync(`${OUT}/text-proof.json`, JSON.stringify(textProof, null, 2));

// Walk the report with confirm; it fades and closes on its own, then the
// battle ends and the field comes back.
for (let i = 0; i < 16; i++) {
    ri = await reportInfo();
    if (ri.open !== true) break;
    await hold("Enter");
}
await page.waitForFunction(() => window.__reportNative?.isOpen() === false, { timeout: 15000 })
    .catch(() => {});
await page.waitForTimeout(900);

const after = await bitsNow();
const delta = (after ?? 0) - (before ?? 0);
check("screen reward table paid the BIT once", delta === REWARD_BITS,
    `bits ${before} -> ${after} (delta ${delta})`);
const battleOver = await page.evaluate(() => !window.__battle?.isActive?.());
check("battle ended and the field returned", battleOver, `active=${!battleOver}`);
const lsBits = await page.evaluate(() => Number(localStorage.getItem("bits")));
check("localStorage carries the paid BIT", lsBits === after, `localStorage=${lsBits}`);
check("no uncaught page errors during the route", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
if (resourceMisses.length) console.log(`[verify] note: ${resourceMisses.length} resource miss(es), e.g. ${resourceMisses[0]}`);

writeFileSync(`${OUT}/02-field-after.png`, await page.screenshot());

await browser.close();
console.log(failures === 0 ? "\nverify_native_report_play: OK" : `\nverify_native_report_play: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
