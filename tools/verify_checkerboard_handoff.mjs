// The field->battle checkerboard handoff (fieldstg A28, F0x80089F7C).
//
// Boots the ordinary field route on a stage whose wild-encounter zone is live
// (s320; stage_encounters zone 0 has rate_level 4 and a non-empty slot list),
// stands the player on that zone, and fires the field->battle handoff with the
// step counter's own function (`window.__fieldToBattle`). Two captures from ONE
// build:
//   before  ?legacyBattleHandoff=1  the walker's old immediate battle start
//   after   (default)               the A28 checkerboard wipe over the field
// and it records the live wipe state (cells consumed, quads drawn) so the
// transition is proven, not merely asserted.
//
// NOTE ON THE BATTLE: on this debug route (?skipTitle) the walker's battle
// `start()` returns early before constructing the battle object
// (web/battle.js:3561/3564/3573 — the player profile / roster / enemy record
// build), so `battle.isActive()` stays false for BOTH handoffs here. That is a
// property of the debug route, not of this port; the visible difference the
// captures show is the wipe itself. On the ordinary route (no ?skipTitle) a
// battle does come up (tests/verify_ordinary_playthrough.mjs).
//
//   python3 -m http.server 8741 --directory web
//   tools/run-playwright.sh tools/verify_checkerboard_handoff.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "captures/checkerboard-handoff-2026-10-06";
mkdirSync(OUT, { recursive: true });
const ROOT = baseUrl(8741);

const b = await chromium.launch({
    args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
    ],
});
let failed = false;
const check = (ok, msg) => { if (!ok) failed = true; console.log(`${ok ? "ok" : "FAIL"}: ${msg}`); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const MAP = "s320";
const ZONE_XY = { x: 40, y: 40 };

async function open(query) {
    const page = await b.newPage({ viewport: { width: 900, height: 700 } });
    await page.bringToFront();
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
    await page.goto(`${ROOT}/?skipTitle=1&map=${MAP}${query}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
    await page.waitForTimeout(2000);
    // Seed a party the way the UI lab does (?skipTitle grants none) and stand the
    // player on the live zone, so the encounter route has a party and a roll.
    await page.evaluate((xy) => {
        const s = window.__state;
        s.party = [1, 7, 8]; s.packId = "A"; s.charId = "p003pken"; s.charIdx = 1;
        const block = (id, hp, mp) => ({ digimonId: id, level: 1, xp: 0, tp: 0, hp, maxHp: hp, mp, maxMp: mp, bonuses: {}, elemBonuses: {} });
        s.partnerStats = block(1, 86, 38); s.partyStats = [s.partnerStats, block(7, 80, 40), block(8, 90, 55)];
        s.x = xy.x; s.y = xy.y;
    }, ZONE_XY);
    await page.waitForTimeout(500);
    return page;
}

const pick = (page) => page.evaluate(async () => {
    await window.__encounter.ready();
    const id = window.__state.manifest.maps[window.__state.mapIdx].id;
    return window.__encounter.pick(id, window.__state.x, window.__state.y);
});

// ── before: the walker's own version (immediate battle start, no wipe) ───────
{
    const page = await open("&legacyBattleHandoff=1");
    await shot(page, "before-0-field");
    console.log("before: map=" + MAP + " pick=" + JSON.stringify(await pick(page)));
    await page.evaluate(() => window.__fieldToBattle());
    const immediate = await page.evaluate(() => ({ wipe28: window.__wipe28(), battle: !!window.__battle?.isActive?.() }));
    await page.waitForTimeout(400);
    await shot(page, "before-1-no-wipe");
    console.log("before: immediate=" + JSON.stringify(immediate));
    check(immediate.wipe28 === null, "before: no checkerboard wipe starts (the old cut)");
    await page.close();
}

// ── after: the A28 checkerboard handoff ──────────────────────────────────────
{
    const page = await open("");
    await shot(page, "after-0-field");
    console.log("after: map=" + MAP + " pick=" + JSON.stringify(await pick(page)));
    await page.evaluate(() => window.__fieldToBattle());
    // Let the wipe run a few frames, then HOLD it mid-run for a clean capture.
    const seen = [];
    for (let i = 0; i < 2; i++) { seen.push(await page.evaluate(() => window.__wipe28())); await page.waitForTimeout(60); }
    await page.evaluate(() => { window.__wipe28Hold = true; });
    await page.waitForTimeout(120);
    const held = await page.evaluate(() => window.__wipe28());
    await shot(page, "after-1-wipe-held");
    check(held && held.index > 0 && held.quads < 30, "after: a mid-run frame shows cells already consumed");
    // Release the hold and let it finish.
    await page.evaluate(() => { window.__wipe28Hold = false; });
    for (let i = 0; i < 10; i++) { seen.push(await page.evaluate(() => window.__wipe28())); await page.waitForTimeout(60); }
    const done = await page.waitForFunction(() => window.__wipe28() === null, null, { timeout: 8000 }).then(() => true).catch(() => false);
    const battleUp = await page.evaluate(() => !!window.__battle?.isActive?.());
    console.log("after samples:", JSON.stringify(seen), "held:", JSON.stringify(held));
    console.log("after: wipe completed =", done, "| battle active (see note) =", battleUp);
    check(seen.some((s) => s && s.quads === 30), "after: the wipe starts with all 30 cells drawn");
    check(seen.some((s) => s && s.quads < 30), "after: cells leave the grid as the schedule consumes them");
    check(done, "after: the checkerboard wipe completes");
    await page.close();
}

await b.close();
console.log(`wrote ${OUT}`);
if (failed) { console.log("checkerboard handoff check FAILED"); process.exit(1); }
console.log("checkerboard handoff OK");
