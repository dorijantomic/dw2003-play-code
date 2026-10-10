// Browser proof for the translated memory-card save/load screen (pro/stgmcard),
// Step E of docs/plans/2026-09-28-translated-game-completion-plan.md.
//
// Two runs through the real web/game.js:
//   1. reference: `?nativeSave=1`, the original code through the MIPS interpreter
//      (the "before" pictures). It needs the executable files under assets/native/**.
//   2. ordinary route, no flags, every assets/native/** request denied FROM PAGE
//      LOAD: the translated MemcardSession runs the whole screen.
// Production scenario: open SAVE, choose a block, save to slot 0 (check the walker's
// storage is untouched until the screen closes), back out once and leave; change live
// state (BIT, an item); open SAVE again and decline the overwrite prompt (the slot is
// unchanged), then leave; open LOAD, try the empty slot ("No data here."), load slot 0
// and check that the page reloads with the saved BIT and without the later item.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_translated_save.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/step-e-translated-save-2026-09-30";
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
    page.on("request", (req) => { if (/assets\/data\/(memcard\/|shop-banks\/|shop_font)/.test(req.url())) net.data.push(req.url()); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await page.goto(`${BASE}${query}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    return { page, net, errors };
}

const press = async (page, key, wait = 700) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(110);
    await page.keyboard.up(key);
    await page.waitForTimeout(wait);
};

async function seedState(page) {
    await page.evaluate(() => {
        const s = window.__state;
        s.playerName = "KAI";
        s.bits = 4242;
        s.party = ["p006agum", "p009rena"];
        s.partyStats = [{ level: 7, xp: 100 }, { level: 5, xp: 50 }];
        s.playSeconds = 3725;
        s.inventory = [{ id: 1, qty: 2 }];
        for (const k of ["mcardSlot0", "mcardSlot1", "mcardSlot2", "mcardLastSlot"]) localStorage.removeItem(k);
    });
}

const windowState = (page) => page.evaluate(() => window.__saveNative.diagnostics().state?.window ?? null);
async function waitWindow(page, value, timeout = 20000) {
    await page.waitForFunction((v) => window.__saveNative.diagnostics().state?.window === v, value, { timeout });
}
async function pageText(page) {
    return page.evaluate(async () => {
        const { drawNativeTextWidgets } = await import("/native-screen-text.js");
        const widgets = window.__saveNative.textWidgets?.() ?? (window.__nativeTextWidgets?.() ?? []);
        return drawNativeTextWidgets({ drawImage() {} }, widgets.filter((w) => w.visible)).texts ?? [];
    });
}
const diag = (page) => page.evaluate(() => window.__saveNative.diagnostics());
const slotRaw = (page, i = 0) => page.evaluate((n) => localStorage.getItem(`mcardSlot${n}`), i);

// ── before: the reference route (original code through the interpreter) ────
{
    const { page, errors } = await openPage({ query: "&nativeSave=1" });
    await seedState(page);
    await page.evaluate(() => window.__labOpen("save"));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/before-01-reference-chooser.png` });
    await press(page, "Enter", 2200);
    await page.screenshot({ path: `${OUT}/before-02-reference-file-card.png` });
    await press(page, "Enter", 2500);
    await page.screenshot({ path: `${OUT}/before-03-reference-saved.png` });
    const d = await diag(page);
    check("reference: the original screen ran (host present)", !!d.host, `traps=${d.host?.traps}`);
    check("reference: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
}

// ── after: the production route, executables denied ─────────────────────────
const { page, net, errors } = await openPage({ denyNative: true });
await seedState(page);
const d0 = await page.evaluate(() => window.__saveNative.diagnostics().execution);
check("production: the translated screen is the default route", d0 === "translated", `execution=${d0}`);

// 1. SAVE to slot 0.
await page.evaluate(() => window.__labOpen("save"));
await waitWindow(page, 2);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/after-01-translated-chooser.png` });
check("production: the chooser shows the SAVE header and two card slots",
    (await pageText(page)).join("|").length > 0, (await pageText(page)).join("|").slice(0, 120));
await press(page, "Enter", 300);
await waitWindow(page, 0x21, 30000);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/after-02-translated-file-card.png` });
const cardText = (await pageText(page)).join("|");
check("production: the empty block shows the placeholder file card", cardText.length > 0, cardText.slice(0, 160));
await press(page, "Enter", 300);
await waitWindow(page, 0x1f5, 30000);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/after-03-translated-saved.png` });
let d = await diag(page);
check("production: the screen wrote slot 0 to its card", d.stores?.[0]?.slot === 0, JSON.stringify(d.stores));
check("production: the walker's storage is untouched until the screen closes", (await slotRaw(page, 0)) === null);
await press(page, "Enter", 300); // dismiss "Saved."
await waitWindow(page, 0x21, 30000);
// Cancel once (back to the chooser), then leave. The card's Back is logical
// button 0xE, the word bit 0x4000 (engine/dw3/ui/memcard-machine.ts
// MEMCARD_BUTTON_CANCEL); on the keyboard that bit is Escape or x
// (engine/systems/input-map.ts KEYBOARD_BINDINGS.triangle). `c` reached it
// until 2026-10-03 and now confirms (0x2000), so pressing it here drove the
// card in circles and the screen never closed.
await press(page, "Escape", 900);
for (let i = 0; i < 6 && (await page.evaluate(() => window.__saveNative.isOpen())); i++) await press(page, "Escape", 1100);
await page.waitForFunction(() => !window.__saveNative.isOpen(), null, { timeout: 15000 });
const raw = await slotRaw(page, 0);
const slot = raw ? JSON.parse(raw) : null;
check("commit: slot 0 now holds the record", !!slot?.record, String(raw).slice(0, 60));
check("commit: the record carries the BIT and the name", slot?.record?.bits === 4242 && slot?.record?.name === "KAI",
    `bits=${slot?.record?.bits} name=${slot?.record?.name}`);
check("commit: the opaque 0x26C4 image is stored beside it", Array.isArray(slot?.image) && slot.image.length === 0x26c4, `len=${slot?.image?.length}`);
check("commit: the walker's state snapshot is stored", slot?.data && Object.keys(slot.data).length > 0);
d = await diag(page);
check("commit: the screen reports the saved slot", d.savedSlot === 0, JSON.stringify(d.commit));

// 2. Change live state.
await page.evaluate(() => { window.__state.bits = 777; window.__state.inventory = [{ id: 1, qty: 2 }, { id: 2, qty: 5 }]; });

// 3. Overwrite case: decline.
await page.evaluate(() => window.__labOpen("save"));
await waitWindow(page, 2);
await press(page, "Enter", 300);
await waitWindow(page, 0x21, 30000);
await page.waitForTimeout(500);
const usedCard = (await pageText(page)).join("|");
check("overwrite: the file card shows the saved record", usedCard.includes("KAI") && usedCard.includes("4242"), usedCard.slice(0, 160));
await press(page, "Enter", 300);
await waitWindow(page, 0x28, 20000);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/after-04-translated-overwrite-prompt.png` });
await press(page, "ArrowDown", 400);
await press(page, "Enter", 900); // NO
check("overwrite: declining writes nothing", (await diag(page)).stores.length === 0);
for (let i = 0; i < 6 && (await page.evaluate(() => window.__saveNative.isOpen())); i++) await press(page, "Escape", 1100);
await page.waitForFunction(() => !window.__saveNative.isOpen(), null, { timeout: 15000 });
const again = JSON.parse(await slotRaw(page, 0));
check("overwrite: slot 0 is unchanged after declining", again.record.bits === 4242, `bits=${again.record.bits}`);

// 4. LOAD: the empty block refuses, slot 0 loads.
await page.evaluate(() => window.__labOpen("load"));
await waitWindow(page, 2);
await press(page, "Enter", 300);
await waitWindow(page, 0x21, 30000);
await press(page, "ArrowRight", 900);
await page.screenshot({ path: `${OUT}/after-05-translated-load-empty-block.png` });
await press(page, "Enter", 1500);
const emptyText = (await pageText(page)).join("|");
check("load: an empty block says so and nothing is restored", (await diag(page)).loadedSlot === null, emptyText.slice(0, 160));
await press(page, "Enter", 900); // dismiss
for (let i = 0; i < 8; i++) {
    const w = await windowState(page);
    if (w === 0x21) break;
    await press(page, "Enter", 700);
}
await press(page, "ArrowLeft", 900);
await page.screenshot({ path: `${OUT}/after-06-translated-load-card.png` });
await press(page, "Enter", 300);
await waitWindow(page, 0x1f6, 20000); // "LOADED."
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/after-07-translated-loaded.png` });
const nav = page.waitForNavigation({ timeout: 30000 }).catch(() => null);
await press(page, "Enter", 300);
const navDone = await nav;
check("load: confirming slot 0 reloads the page", !!navDone);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
const restored = await page.evaluate(() => ({
    bits: window.__state.bits, inventory: window.__state.inventory, last: localStorage.getItem("mcardLastSlot"),
    name: window.__state.playerName,
}));
check("load: the saved BIT is back (777 is gone)", restored.bits === 4242, `bits=${restored.bits}`);
check("load: the item bought after the save is gone", !(restored.inventory ?? []).some((x) => x.id === 2), JSON.stringify(restored.inventory));
check("load: the last-used slot is recorded", restored.last === "0", `last=${restored.last}`);

check("no executable asset was requested in production", net.allowed.length === 0 && net.denied.length === 0,
    `denied=${net.denied.length} allowed=${net.allowed.length}`);
check("the screen's data files were fetched", net.data.some((u) => /memcard\/tables\.bin/.test(u)));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
