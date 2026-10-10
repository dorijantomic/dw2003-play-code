// Focused reference-route verifier for the native item shop (Phase 6.1 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js, opens the Asuka Armory through the lab entry
// point, and drives the shipped pro/stitshop overlay with real key events:
//   main menu -> BUY -> list -> quantity 2 -> Buy -> Equip? No,
//   back to the menu -> SELL -> Weapons -> quantity 1 -> Sell,
//   back out and leave; then an unaffordable buy on a second visit.
// It asserts the canonical state round-trip (bits + bag), localStorage, and
// that a reload sees the accepted transactions.
//
//   tools/run-playwright.sh tools/verify_native_shop.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const URL = `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeShop=1`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-shop-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

async function state() {
    return page.evaluate(() => ({
        bits: window.__state.bits,
        inv: window.__state.inventory,
        open: window.__shop.isOpen(),
        diag: window.__shop.diagnostics?.() ?? null,
    }));
}
async function press(key, waitMs = 550) {
    await page.keyboard.down(key);
    await page.waitForTimeout(70);
    await page.keyboard.up(key);
    await page.waitForTimeout(waitMs);
}
async function pressUntilOpen(key, want, tries, waitMs = 550) {
    for (let i = 0; i < tries; i++) {
        await press(key, waitMs);
        const s = await state();
        if (s.open === want) return s;
    }
    return state();
}

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
console.log("[verify] game booted");

// ── visit 1: buy 2 Short Swords, then sell 1 ────────────────────────────────
await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [{ id: 92, qty: 3 }]; // ShortSword x3, sell 100
    localStorage.setItem("inventory", JSON.stringify(window.__state.inventory));
    localStorage.setItem("bits", "10000");
    window.__labOpen("shop", 0); // Asuka Armory (shop_id 0)
});
await page.waitForTimeout(2000);
let s = await state();
check("shop opens through game.js", s.open === true);
check("native root booted", s.diag?.host?.booted === true, `module=${s.diag?.host?.module}`);
check("no traps on entry", (s.diag?.host?.traps ?? -1) === 0);
const bridged = new Map((s.diag?.host?.bridged ?? []).map((b) => [b.key, b.invocations]));
const bridgedCount = (key) => bridged.get(key) ?? 0;
check("root constructor ran translated", bridgedCount("pro/stitshop:0x8008c118") > 0,
    `invocations=${bridgedCount("pro/stitshop:0x8008c118")}`);
check("root labels builder uses translated code", bridgedCount("pro/stitshop:0x8008b524") > 0);
await page.screenshot({ path: `${OUT}/01-main-menu.png` });

// BUY
await press("c", 900); // main menu -> BUY list
await page.screenshot({ path: `${OUT}/02-buy-list.png` });
await press("k", 900); // Circle (logical 0x0C, word bit 0x1000): the Effects cards
await page.screenshot({ path: `${OUT}/02a-weapon-effects.png` });
check("Circle opens the partner Effects cards",
    await page.evaluate(() => window.__shop.diagnostics()?.renderer?.seen?.includes(8) === true));
await press("k", 900); // and the same button puts the description back
await press("c", 900); // select Short Sword -> quantity spinner
await press("ArrowUp", 500); // quantity 1 -> 2
await page.screenshot({ path: `${OUT}/03-quantity.png` });
{
    // The quantity screen shows the full chrome: header/BIT plates (bucket 1),
    // the "How many?" plate, spinner and item icons. Both packs and the whole
    // plate set must be present, painted far bucket (backdrop 7) first.
    const d = await state();
    const rr = d.diag?.renderer ?? null;
    check("renderer drew both packs", !!rr && (rr.byPack.stshop ?? 0) > 0 && (rr.byPack.cmfont ?? 0) > 0,
        rr ? `stshop=${rr.byPack.stshop ?? 0} cmfont=${rr.byPack.cmfont ?? 0}` : "no stats");
    check("renderer dropped no clips", !!rr && rr.skipped === 0, rr ? `skipped=${rr.skipped} of ${rr.clips}` : "no stats");
    // The shop's greeting fade opens on its first picture (pro/stitshop
    // F0x8008b60c places the backdrop and both header plates there), so the
    // host must hold that frame back until both of the screen's sheets have
    // landed. A frame held back is `awaiting`; a frame the host let through
    // short is `skipped`. Neither may happen, and the host must have spent no
    // ticks waiting at all by the time the route reaches the quantity screen.
    check("no frame was painted short or deferred for a sheet",
        !!rr && rr.awaiting === 0 && rr.paintedFrames === rr.frames,
        rr ? `frames=${rr.frames} painted=${rr.paintedFrames} awaiting=${rr.awaiting}` : "no stats");
    check("the shop waited for its sheets instead of drawing over the field",
        d.diag?.host?.packsReady === true && d.diag?.host?.packWaitFrames >= 0,
        `packsReady=${d.diag?.host?.packsReady} packWaitFrames=${d.diag?.host?.packWaitFrames}`);
    check("plates and backdrop reached the paint list",
        !!rr && [0, 1, 2, 3, 9, 11, 20].every((id) => rr.seen.includes(id)),
        rr ? `seen=${rr.seen.join(",")}` : "no stats");
    const buckets = (rr?.paintOrder ?? []).map((p) => p.bucket);
    let ordered = buckets.length > 0;
    for (let i = 1; i < buckets.length; i++) if (buckets[i] > buckets[i - 1]) ordered = false;
    check("paint order runs far bucket to near", ordered, `paintOrder=${buckets.join(",")}`);
}
await press("c", 900); // -> Buy/No plate (total 400 BIT)
await page.screenshot({ path: `${OUT}/04-buy-confirm.png` });
await press("c", 1400); // Buy -> commit + Equip? plate
await page.screenshot({ path: `${OUT}/05-equip-offer.png` });
await press("ArrowDown", 400); // Equip? -> No
await press("c", 1200); // back to the list
let mem = await page.evaluate(() => ({
    bits: window.__shop._host?.read(0x80048d34 + 0x6c, 4),
    held92: window.__shop._host?.read(0x80048d34 + 0x7c + 92, 1),
}));
check("native buy: bits 10000 -> 9600", mem.bits === 9600, `bits=${mem.bits}`);
check("native buy: ShortSword 3 -> 5", mem.held92 === 5, `held=${mem.held92}`);

// back to the menu: cancel out of the list. The shipped code reads its cancel
// from the decoded pad map (Triangle, keyboard Escape); the release's own on-screen
// hint icons do not match it (they show a triangle for Back), so the walk uses
// the code, not the glyph.
s = await pressUntilOpen("Escape", true, 6, 700);
await page.screenshot({ path: `${OUT}/06-back-at-menu.png` });

// SELL: menu -> SELL -> Weapons category -> list -> select -> qty -> Sell
await press("ArrowDown", 500); // cursor SELL
await press("c", 900); // SELL -> category menu
await page.screenshot({ path: `${OUT}/07-sell-categories.png` });
await press("ArrowDown", 500); // Items -> Weapons
await press("c", 1200); // Weapons list
await page.screenshot({ path: `${OUT}/08-sell-list.png` });
await press("c", 900); // select ShortSword -> qty
await press("c", 900); // qty 1 -> Sell/No plate
await page.screenshot({ path: `${OUT}/09-sell-confirm.png` });
await press("c", 1400); // Sell
await page.screenshot({ path: `${OUT}/10-after-sell.png` });
mem = await page.evaluate(() => ({
    bits: window.__shop._host?.read(0x80048d34 + 0x6c, 4),
    held92: window.__shop._host?.read(0x80048d34 + 0x7c + 92, 1),
}));
check("native sell: bits 9600 -> 9700", mem.bits === 9700, `bits=${mem.bits}`);
check("native sell: ShortSword 5 -> 4", mem.held92 === 4, `held=${mem.held92}`);

// leave the shop (cancel back to the menu, then cancel the menu)
await press("c", 700); // list -> category
await press("c", 700); // category -> menu
s = await pressUntilOpen("Escape", false, 8, 900);
check("leaving closes the shop", s.open === false, `open=${s.open}`);
check("readback: bits 9700 in game state", s.bits === 9700, `bits=${s.bits}`);
check("readback: bag ShortSword 4",
    Array.isArray(s.inv) && s.inv.length === 1 && s.inv[0].id === 92 && s.inv[0].qty === 4,
    JSON.stringify(s.inv));
const persisted = await page.evaluate(() => ({
    bits: localStorage.getItem("bits"),
    inv: localStorage.getItem("inventory"),
}));
check("localStorage bits=9700", persisted.bits === "9700", persisted.bits);
check("localStorage bag carries ShortSword x4",
    persisted.inv?.includes('"id":92') && persisted.inv?.includes('"qty":4'), persisted.inv);
check("no page errors during the route", errors.length === 0, errors.join(" | "));

// ── reload: the accepted transactions persist ───────────────────────────────
await page.reload({ waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
let after = await page.evaluate(() => ({
    bits: window.__state.bits,
    inv: window.__state.inventory,
}));
check("reload: bits 9700", after.bits === 9700, `bits=${after.bits}`);
check("reload: bag ShortSword x4",
    Array.isArray(after.inv) && after.inv.some((x) => x.id === 92 && x.qty === 4),
    JSON.stringify(after.inv));

// ── visit 2: the unaffordable refusal ───────────────────────────────────────
await page.evaluate(() => {
    window.__state.bits = 50; // Short Sword costs 200
    window.__labOpen("shop", 0);
});
await page.waitForTimeout(1800);
await press("c", 900); // BUY list
await press("c", 900); // select -> quantity
await press("c", 900); // -> Buy/No (price 200 > 50)
await press("c", 1400); // Buy -> refusal plate
await page.screenshot({ path: `${OUT}/11-refusal.png` });
mem = await page.evaluate(() => ({ bits: window.__shop._host?.read(0x80048d34 + 0x6c, 4) }));
check("unaffordable buy does not change bits", mem.bits === 50, `bits=${mem.bits}`);
// the reject plate dismisses and returns to the list
await press("c", 1200);
await page.screenshot({ path: `${OUT}/12-after-refusal.png` });
s = await pressUntilOpen("Escape", false, 10, 900); // cancel list, cancel menu, leave
check("unaffordable visit leaves cleanly", s.open === false);
check("wallet still 50 after the refusal", s.bits === 50, `bits=${s.bits}`);
check("no page errors on the refusal visit", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(failures === 0 ? "\nverify_native_shop: OK" : `\nverify_native_shop: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
