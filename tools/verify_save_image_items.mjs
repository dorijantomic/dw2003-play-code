// What the player sees now that the memory-card image carries the WHOLE bag.
//
// The save block at 0x80048D34 is copied whole onto the card (pro/stgmcard driver
// state 0x33, stgmcard.s:3514-3560) and restored whole on a load (state 0x47,
// stgmcard.s:3250-3300), and the two item count arrays live inside it at
// base+0x7C+id and base+0x20F+id for every id 1..402. Until 2026-10-03 the walker
// seeded only ids < 256, so SniperSuit up — OverLoad 330, Goggles 332, Glasses 331,
// HackSystem 328, the seven enemy drops — was written as 0 and read back as 0, and
// the post-battle payout read base+0x7C+(id & 0xff), i.e. item 74's byte for
// OverLoad 330 (stfgtrep.s:2844-2884 never masks the id).
//
// Three steps through the real web/game.js, all on the ordinary translated route
// with every assets/native/** request denied FROM PAGE LOAD:
//   1. SAVE a bag holding OverLoad 330 x5 and Goggles 332 x3 with a pair of Goggles
//      worn, then read the card's own 0x26C4 image back out of localStorage and
//      check the four bytes at the original's offsets.
//   2. LOAD that card, in the same browser profile, and confirm both counts and the
//      worn Goggles are still there afterwards.
//   3. In a fresh profile, win a real battle whose drop is OverLoad 330 while five
//      are carried: the results screen must open and the count must become six.
//
//   VERIFY_PORT=8922 tools/run-playwright.sh tools/verify_save_image_items.mjs
// The tree under test is chosen with SAVE_IMAGE_ROOT (a port) and SAVE_IMAGE_SHOT
// (an output directory), so the same script runs against a pre-change tree.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.SAVE_IMAGE_ROOT || `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&noEncounters=1`;
const OUT = process.env.SAVE_IMAGE_SHOT || "captures/save-image-items-2026-10-03";
mkdirSync(OUT, { recursive: true });

/** The block's two arrays, as the original addresses them, minus the base for indexing. */
const HELD = 0x7c;
const WORN = 0x20f;
const IMAGE_SIZE = 0x26c4;
/** OverLoad 330 and Goggles 332, both accessories in the band the old guard cut. */
const OVERLOAD = 330;
const GOGGLES = 332;
const SEED_BAG = [[OVERLOAD, 5], [GOGGLES, 3], [66, 2]];
/** The lead wears a pair of Goggles. */
const SEED_EQUIPMENT = [{ acc0: GOGGLES }, {}, {}];
/** Battle screen 5 = 2x Numemon lv27; used only so a real fight can be won. */
const SCREEN = 5;

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
/** Never leave a browser behind: this box is shared and a leak starves the next run. */
const closeBrowser = () => browser.close().catch(() => {});
process.on("exit", () => { browser.close().catch(() => {}); });
process.on("SIGINT", () => { closeBrowser().finally(() => process.exit(130)); });

/**
 * Seed the bag into a profile. The sentinel lives in sessionStorage, which a page
 * reload keeps but the save screen's storage restore does not touch, so the load in
 * step 2 is not quietly undone by the seed running again on the reload.
 */
async function seedProfile(page, { clearSlots }) {
    await page.addInitScript(([bag, gear, clear]) => {
        if (sessionStorage.getItem("__bagSeeded")) return;
        sessionStorage.setItem("__bagSeeded", "1");
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("rosterOwned", "33");
        const stats = {level:12,xp:210,hp:150,maxHp:180,mp:35,maxMp:40,digimonId:9,equippedForms:[9],
            formLedger:[{id:9,formLevel:7,dvexp:60,preservedByte:77,techSlots:[0xe069,0x206b,0,0,0,0]}]};
        localStorage.setItem("partyStats",JSON.stringify([stats]));
        localStorage.setItem("partnerStats",JSON.stringify(stats));
        localStorage.setItem("reserveStats",JSON.stringify({p008giru:{...stats,level:15,xp:450}}));
        localStorage.setItem("reserveEquipment",JSON.stringify({p008giru:{acc0:330}}));
        localStorage.setItem("inventory", JSON.stringify(bag.map(([id, qty]) => ({ id, qty }))));
        localStorage.setItem("equipment", JSON.stringify(gear));
        if (clear) {
            for (const k of ["mcardSlot0", "mcardSlot1", "mcardSlot2", "mcardLastSlot"]) {
                localStorage.removeItem(k);
            }
        }
    }, [SEED_BAG, SEED_EQUIPMENT, clearSlots]);
}

async function watch(page) {
    const denied = [];
    await page.route("**/assets/native/**", (route) => { denied.push(route.request().url()); return route.abort(); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    return { denied, errors };
}

const press = async (page, key, wait = 700) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(110);
    await page.keyboard.up(key);
    await page.waitForTimeout(wait);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const bag = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__state.inventory)));
const gear = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__state.equipment ?? [])));
const qty = (rows, id) => rows.filter((r) => r.id === id).reduce((n, r) => n + (r.qty ?? 1), 0);
const waitWindow = (page, value, timeout = 45000) =>
    page.waitForFunction((v) => window.__saveNative.diagnostics().state?.window === v, value, { timeout });

// ── 1 & 2, one profile: SAVE, then LOAD the card that was just written ──────
{
    const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
    const saver = await context.newPage();
    await seedProfile(saver, { clearSlots: true });
    const { denied, errors } = await watch(saver);
    await saver.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await saver.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });

    check("the ordinary route runs the translated card screen, no original code",
        await saver.evaluate(() => window.__saveNative.diagnostics().execution) === "translated");
    check("no original-code asset was fetched", denied.length === 0, denied.slice(0, 2).join(" "));
    check("the bag starts with OverLoad x5, Goggles x3 and a worn pair of Goggles",
        qty(await bag(saver), OVERLOAD) === 5 && qty(await bag(saver), GOGGLES) === 3
        && JSON.stringify((await gear(saver))[0]) === JSON.stringify({ acc0: GOGGLES }),
        JSON.stringify(await bag(saver)));

    await saver.evaluate(() => window.__labOpen("save"));
    try {
        await waitWindow(saver, 2);
    } catch (e) {
        // A screen that threw while opening never reaches the chooser; say so.
        const d = await saver.evaluate(() => window.__saveNative?.diagnostics?.() ?? null);
        console.log(`   chooser never appeared: ${JSON.stringify({ failed: d?.failed, error: d?.error })}`);
        await shot(saver, "99-chooser-stuck");
        throw e;
    }
    await saver.waitForTimeout(500);
    await shot(saver, "01-save-chooser");
    await press(saver, "Enter", 2200);
    await shot(saver, "02-save-file-card");
    await press(saver, "Enter", 1800);
    await waitWindow(saver, 0x1f5, 30000);   // the "Saved." result strip
    await saver.waitForTimeout(500);
    await shot(saver, "03-save-saved");
    // The card write reaches the walker's storage when the screen closes.
    await press(saver, "Enter", 900);        // dismiss the result
    await waitWindow(saver, 0x21, 30000);
    // Back out: Triangle is the card screens' BACK button (`x` / Escape).
    for (let i = 0; i < 8 && (await saver.evaluate(() => window.__saveNative.isOpen())); i++) {
        await press(saver, "x", 1200);
    }
    await shot(saver, "04-save-written");

    const image = await saver.evaluate(() => JSON.parse(localStorage.getItem("mcardSlot0") ?? "null")?.image ?? null);
    check("the card wrote a 0x26C4-byte image", Array.isArray(image) && image.length === IMAGE_SIZE,
        image ? `${image.length} bytes` : "no slot written");
    if (image) {
        check(`image[0x7C+${OVERLOAD}] = 5 (OverLoad, how many you carry)`,
            image[HELD + OVERLOAD] === 5, `got ${image[HELD + OVERLOAD]}`);
        check(`image[0x7C+${GOGGLES}] = 3 (Goggles)`,
            image[HELD + GOGGLES] === 3, `got ${image[HELD + GOGGLES]}`);
        check(`image[0x20F+${GOGGLES}] = 1 (how many are worn)`,
            image[WORN + GOGGLES] === 1, `got ${image[WORN + GOGGLES]}`);
        check("image[0x7C+66] = 2 (a low id still lands)",
            image[HELD + 66] === 2, `got ${image[HELD + 66]}`);
        const view = new DataView(Uint8Array.from(image).buffer);
        check("the card holds the reserve partner's level and experience",
            view.getUint16(0x760+5*0x3dc+0x24,true)===15 && view.getUint32(0x760+5*0x3dc+0x20,true)===450);
        check("the card holds the lead's current form and loaded technique flags",
            view.getUint32(0x764,true)!==0 && view.getUint16(0x7c0,true)===0xe069 && image[0x7bb]===77);
        check("the card holds the lead's and reserve partner's worn gear",
            view.getUint16(0x760+0x3d0,true)===332 && view.getUint16(0x760+5*0x3dc+0x3d0,true)===330);
        check("the format id and checksum are the original's",
            image[2] === 4 && image[0] === image.slice(4).reduce((a, b) => a ^ b, 0));
    }
    check("no page errors while saving", errors.length === 0, errors.slice(0, 2).join(" | "));
    await saver.close();

    // The load, same profile, so the card written above is the one it reads.
    const loader = await context.newPage();
    const loadErrors = [];
    loader.on("pageerror", (e) => loadErrors.push(`pageerror: ${e.message}`));
    await loader.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await loader.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    const before = await bag(loader);
    check("the live bag before the load holds OverLoad and Goggles",
        qty(before, OVERLOAD) === 5 && qty(before, GOGGLES) === 3, JSON.stringify(before));
    await loader.evaluate(() => {
        const card=JSON.parse(localStorage.getItem("mcardSlot0"));
        card.data.inventory="[]";
        card.data.partyStats="[]";
        card.data.reserveStats="{}";
        localStorage.setItem("mcardSlot0",JSON.stringify(card));
        window.__labOpen("load");
    });
    await waitWindow(loader, 2);
    await loader.waitForTimeout(500);
    await press(loader, "Enter", 2200);
    await shot(loader, "05-load-file-card");
    await press(loader, "Enter", 1800);
    for (let i = 0; i < 10; i++) await press(loader, "Enter", 1500);
    // A load restores the snapshot and reloads the page into it.
    await loader.waitForTimeout(2500);
    const after = await bag(loader);
    const afterGear = await gear(loader);
    check("after loading the card, OverLoad is still x5", qty(after, OVERLOAD) === 5, JSON.stringify(after));
    check("after loading the card, Goggles are still x3", qty(after, GOGGLES) === 3, JSON.stringify(after));
    check("and the worn Goggles are still on the lead",
        JSON.stringify(afterGear[0]) === JSON.stringify({ acc0: GOGGLES }), JSON.stringify(afterGear[0]));
    const restored = await loader.evaluate(() => ({party:window.__state.partyStats,reserves:window.__state.reserveStats}));
    check("loading restores forms and the reserve partner from the card image",
        restored.party?.[0]?.formLedger?.[0]?.techSlots?.[0]===0xe069 && restored.reserves?.p008giru?.level===15);
    // The pause EQUIP tab is where a player reads the bag.
    await loader.evaluate(() => {
        window.__state.menuOpen = true;
        window.__menu.openAt("items");
        window.__menu.itemMode = "list";
        window.__menu.itemCat = 3;
        window.__menu.itemCursor = 0;
    });
    await loader.waitForTimeout(900);
    await shot(loader, "06-items-tab-after-load");
    const tab = await loader.evaluate(() => window.__menu.itemList(window.__state).map((r) => [r.id, r.qty]));
    check("the pause EQUIP tab lists both accessories after the load",
        tab.some((r) => r[0] === OVERLOAD && r[1] === 5) && tab.some((r) => r[0] === GOGGLES && r[1] === 3),
        JSON.stringify(tab));
    check("no page errors while loading", loadErrors.length === 0, loadErrors.slice(0, 2).join(" | "));
    await loader.close();
    await context.close();
}

// ── 3. a battle that drops OverLoad 330, in a fresh profile ────────────────
{
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    // This is a bag-payout fixture, not a random battle outcome check. Keep
    // hit/flee choices repeatable so an unrelated escape cannot skip the report.
    await page.addInitScript(() => { Math.random = () => 0.5; });
    await seedProfile(page, { clearSlots: true });
    const { errors } = await watch(page);
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    check("the battle profile starts with OverLoad x5 carried", qty(await bag(page), OVERLOAD) === 5);
    await page.evaluate(async (screen) => {
        await window.__battle.startScreen(screen, null, null, null, { mapId: "s245" });
    }, SCREEN);
    await page.waitForFunction(() => !!window.__battleB?.(), null, { timeout: 30000 });
    await page.waitForTimeout(600);
    // Force the drop to be OverLoad, as a disc enemy that drops it would.
    const dropped = await page.evaluate(() => {
        const item = Object.values(window.__ITEM_BY_NAME).find((i) => i.id === 330);
        window.__dropInfo = item;
        window.__gameSpeed = 4;
        return item?.id ?? 0;
    });
    check("the forced drop is OverLoad 330", dropped === OVERLOAD, `id ${dropped}`);
    for (let guard = 0; guard < 240; guard++) {
        const phase = await page.evaluate(() => {
            const b = window.__battleB?.();
            if (!b) return "gone";
            if (b._loot && !b._loot.drops.length) b._loot.drops = [window.__dropInfo.name];
            if (b.state === 2 && b.enemy) b.enemy.hp = 1;
            return b._victoryPhase ?? b.state;
        });
        if (phase === "report" || phase === "gone") break;
        await press(page, "Enter", 150);
    }
    await page.evaluate(() => { window.__gameSpeed = 1; });
    // The results screen loads its data before it reports open; give it time.
    await page.waitForFunction(() => window.__reportNative?.isOpen?.() === true, null, { timeout: 10000 })
        .catch(() => {});
    // Walk the results screen with Confirm until it retires.
    const started = Date.now();
    let sawReport = false;
    let reportDiag = null;
    while (Date.now() - started < 60000) {
        const info = await page.evaluate(() => ({
            open: window.__reportNative?.isOpen?.() ?? false,
            failed: window.__reportNative?.diagnostics?.()?.failed ?? false,
            error: window.__reportNative?.diagnostics?.()?.error ?? null,
        }));
        if (!info.open) break;
        // A screen that threw while opening is not a screen that opened: the
        // pre-change build refused a drop of OverLoad 330 outright.
        if (!sawReport && !info.failed) { await page.waitForTimeout(600); await shot(page, "07-report-open"); }
        sawReport = sawReport || !info.failed;
        reportDiag = info;
        if (info.failed) break;
        await press(page, "Enter", 300);
    }
    await page.waitForTimeout(800);
    await shot(page, "08-after-report");
    const final = await bag(page);
    check("the results screen opened for a drop of OverLoad 330", sawReport,
        reportDiag?.error ? `it failed to open: ${reportDiag.error}` : "");
    check("the drop was added to the five already carried: OverLoad is x6",
        qty(final, OVERLOAD) === 6, JSON.stringify(final));
    check("no unrelated item took the drop",
        qty(final, OVERLOAD - 256) === 0 && qty(final, 74) === 0, JSON.stringify(final));
    check("no page errors through the battle", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
