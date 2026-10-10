// Focused production-route verifier for the native Card Shop (pro/stcrdshp,
// Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js, opens the card shop through the lab entry point
// with a real shop id, and drives the shipped pro/stcrdshp overlay with real
// key events. It asserts:
//   * the native overlay booted (module pro/stcrdshp), 0 traps, bridge active;
//   * the shop id reached the launcher cell the screen reads (0x8004B404) and
//     the screen resolved that shop's own stock record — the six-card set the
//     overlay's table at 0x8008CDD4 carries for id 0x31;
//   * Cross opens the buy window and it is populated from that stock;
//   * Back closes the shop and returns control to the game.
//
//   .opencode/autonomy/check-browser tools/verify_native_cardshop.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.CARDSHOP_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.CARDSHOP_SHOT || "/tmp/opencode/native-cardshop-verify";
mkdirSync(OUT, { recursive: true });

const SHOP_ID = 0x31;
const LAUNCHER_CELL = 0x8004b404;
const MONEY = 0x80048da0;
// The overlay's own stock record for 0x31 (0x8008CDD4 + 0, third word).
const EXPECTED_STOCK = [65, 235, 277, 194, 204, 59];

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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

await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("bits", "20000");
    localStorage.setItem("cardCollection", JSON.stringify({
        owned: [[1, 1], [2, 1], [3, 1]], seen: [1, 2, 3],
        folders: [], activeFolder: 0, packs: [],
    }));
});

await page.goto(`${ROOT}?skipTitle=1&noEncounters=1&nativeCardShop=1`, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => window.__state?.started && typeof window.__labOpen === "function", { timeout: 40000 });
console.log("[verify] game booted");

// The native screen samples the pad's held word once per frame.
const hold = async (key, ms = 280) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(200);
};

await page.evaluate((id) => window.__labOpen("cardshop", id), SHOP_ID);
await page.waitForFunction(() => window.__cardShopNative?.isOpen?.() === true, { timeout: 15000 });
await page.waitForFunction(() => {
    const d = window.__cardShopNative?.diagnostics?.();
    return d?.host?.module === "pro/stcrdshp" || (d && !d.pending && d.host);
}, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);

let diag = await page.evaluate(() => window.__cardShopNative?.diagnostics?.() ?? null);
console.log("[verify] shop:", JSON.stringify(diag?.host ? {
    module: diag.host.module, traps: diag.host.traps, objects: diag.host.objects,
    frames: diag.host.frames, bridge: diag.host.bridgeEnabled,
} : diag));
check("card shop opens through game.js", diag?.open === true, `open=${diag?.open}`);
check("native root booted", diag?.host?.module === "pro/stcrdshp", `module=${diag?.host?.module}`);
check("no traps on entry", (diag?.host?.traps ?? -1) === 0, `traps=${diag?.host?.traps}`);
check("bridge active on the shop", !!diag?.host?.bridgeEnabled, `bridge=${diag?.host?.bridgeEnabled}`);

const seeded = await page.evaluate(([cell, money]) => ({
    launcher: window.__nativeScreenRead(cell, 4) >>> 0,
    bits: window.__nativeScreenRead(money, 4) >>> 0,
    state: window.__nativeScreenRead(0x800b0000 + 0x10, 4) >>> 0,
}), [LAUNCHER_CELL, MONEY]);
check("shop id reached the launcher cell", seeded.launcher === SHOP_ID, `launcher=0x${seeded.launcher.toString(16)}`);
check("BIT reached the screen's money cell", seeded.bits === 20000, `bits=${seeded.bits}`);
check("root menu is up", seeded.state === 3, `state=${seeded.state}`);

writeFileSync(`${OUT}/01-root.png`, await page.screenshot());

// Cross on "Buy One Card" opens the buy window; it resolves the shop's stock.
await hold("Enter");
await page.waitForTimeout(700);
const buy = await page.evaluate(() => {
    const rd = (a, s) => window.__nativeScreenRead(a, s) >>> 0;
    const objs = (window.__nativeScreenObjects?.() ?? []).filter((o) => o.alive);
    const bw = objs.find((o) => o.cb === 0x80087a2c);
    if (!bw) return { found: false, objects: objs.length };
    const cards = [];
    for (let i = 0; i < 6; i++) cards.push(rd(bw.addr + 0x74 + i * 4, 4));
    return { found: true, objects: objs.length, count: rd(bw.addr + 0xa4, 4), cards };
});
console.log("[verify] buy window:", JSON.stringify(buy));
check("Cross opened the buy window", buy.found === true, JSON.stringify(buy));
check("buy window resolved the shop's own six-card stock",
    JSON.stringify(buy.cards) === JSON.stringify(EXPECTED_STOCK),
    `${JSON.stringify(buy.cards)} vs ${JSON.stringify(EXPECTED_STOCK)}`);

writeFileSync(`${OUT}/02-buy.png`, await page.screenshot());

// Buy the first stock card: select it, open the confirm plate, then BUY.
const bitsNow = () => page.evaluate(() => window.__nativeScreenRead(0x80048da0, 4) >>> 0);
const bitsBefore = await bitsNow();
for (let i = 0; i < 6; i++) {
    await hold("Enter", 380);
    if ((await bitsNow()) < bitsBefore) break;
}
const bitsAfter = await bitsNow();
check("the purchase spent BIT", bitsAfter < bitsBefore, `bits ${bitsBefore} -> ${bitsAfter}`);
const spent = bitsBefore - bitsAfter;
check("the spent amount is the card's price (10000)", spent === 10000, `spent=${spent}`);

// The screen's grant reaches the walker's collection on close. BACK is word
// bit 0x4000, which the one pad map reaches with Escape or x
// (engine/systems/input-map.ts `padWordButton`, commit 173ebcf0); `c` is the
// confirm bit, so the old press only re-confirmed the root row.
const firstCard = EXPECTED_STOCK[0];
for (let i = 0; i < 8; i++) {
    const stillOpen = await page.evaluate(() => window.__cardShopNative?.isOpen?.() === true);
    if (!stillOpen) break;
    await hold("x", 300);
    await page.waitForTimeout(400);
}
await page.waitForFunction(() => window.__cardShopNative?.isOpen?.() === false, { timeout: 15000 })
    .catch(() => {});
await page.waitForTimeout(500);
const closed = await page.evaluate(() => window.__cardShopNative?.isOpen?.() === false);
check("Back closes the card shop", closed, `open=${!closed}`);

const after = await page.evaluate((id) => ({
    bits: window.__state.bits,
    owned: window.__cards?.()?.owned?.get(id) ?? 0,
}), firstCard);
console.log("[verify] after close:", JSON.stringify(after));
check("the walker's BIT carries the purchase", after.bits === bitsAfter, `bits=${after.bits}`);
check("the walker's collection gained the bought card", after.owned >= 1, `card ${firstCard} owned=${after.owned}`);
check("no uncaught page errors during the route", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
if (resourceMisses.length) console.log(`[verify] note: ${resourceMisses.length} resource miss(es), e.g. ${resourceMisses[0]}`);

writeFileSync(`${OUT}/03-after.png`, await page.screenshot());

await browser.close();
console.log(failures === 0 ? "\nverify_native_cardshop: OK" : `\nverify_native_cardshop: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
