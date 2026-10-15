// tools/verify_save_slot1_roundtrip.mjs — the multi-slot round trip on the real
// route: save to card slot 1 (not the default slot 0) at the s235 save point,
// leave, reload, drive the title's Continue, move the chooser to slot 1 and load
// it back into the field.
//
// The journey verifier (tools/verify_journey.mjs) drives a save through the same
// save point but always writes the slot the chooser opens on (0) and explicitly
// leaves the second-save-slot corner out of scope; this is that corner. The
// trigger is the Guardromon's own on_close write (the exact `set_flag(0x9001, 0)`
// s235's dialogue state carries) — see tools/verify_native_save_point_event.mjs —
// and the screen is the production translated route (no ?nativeSave=1).
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_save_slot1_roundtrip.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { press, waitCardWindow, waitTitlePrompt } from "./memcard-continue.mjs";

const ROOT = `${baseUrl(8790)}`;
const OUT = process.argv[2] ?? "/tmp/save-slot1-roundtrip";
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
});

/** Every string the card is drawing, decoded the way the player reads it. */
async function pageText(page) {
    return page.evaluate(async () => {
        const { drawNativeTextWidgets } = await import("/native-screen-text.js");
        const widgets = window.__saveNative.textWidgets?.() ?? [];
        return drawNativeTextWidgets({ drawImage() {} }, widgets.filter((w) => w.visible)).texts ?? [];
    });
}
const cardText = async (page) => (await pageText(page)).join("|");

const windowState = (page) => page.evaluate(() => window.__saveNative?.diagnostics?.()?.state?.window ?? null);
const slotRaw = (page, i) => page.evaluate((n) => localStorage.getItem(`mcardSlot${n}`), i);

// ── boot 1: the save at the s235 save point, written to slot 1 ─────────────
await page.goto(`${ROOT}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
await page.evaluate(() => {
    const s = window.__state;
    s.playerName = "KAI";
    s.bits = 4242;
    s.playSeconds = 3725;
    for (const k of ["mcardSlot0", "mcardSlot1", "mcardSlot2", "mcardLastSlot"]) localStorage.removeItem(k);
    window.__labOpen("menu");
    window.__labClose();
});
const idx = await page.evaluate(() => window.__state.manifest.maps.findIndex((m) => m.id === "s235"));
await page.evaluate((i) => window.__setMap(i), idx);
await page.waitForFunction(() => window.__mapInfo?.().id === "s235", null, { timeout: 30000 });
await page.evaluate(() => { window.__gameSpeed = 8; });
await page.evaluate(() => window.__applyStoryFlag(36865, 0));
let opened = false;
for (let i = 0; i < 40 && !opened; i++) {
    await press(page, "Enter", 300);
    opened = await page.evaluate(() => !!window.__saveNative?.isOpen?.());
}
check("the save-point event opened the card on the production route", opened);
if (!opened) {
    console.log("[verify] page errors:", errors.slice(-4).join(" | "));
    await browser.close();
    process.exit(1);
}
await page.evaluate(() => { window.__gameSpeed = 1; });
await waitCardWindow(page, 2, 40000);

// The chooser opens on slot 0; move to slot 1 and write there.
await press(page, "Enter", 600);                       // the file card
await waitCardWindow(page, 0x21, 40000);
await page.screenshot({ path: `${OUT}/01-file-card-slot0.png` });
await press(page, "ArrowRight", 900);                  // the grid cursor to slot 1
await page.screenshot({ path: `${OUT}/02-file-card-slot1.png` });
await press(page, "Enter", 600);                       // write
await waitCardWindow(page, 0x1f5, 40000);              // "Saved."
await page.screenshot({ path: `${OUT}/03-saved.png` });
const d = await page.evaluate(() => window.__saveNative.diagnostics());
check("the screen wrote card slot 1 (not the default 0)",
    d.stores?.length === 1 && d.stores[0].slot === 1, JSON.stringify(d.stores));
await press(page, "Enter", 500);                       // dismiss "Saved."
await waitCardWindow(page, 0x21, 40000);
for (let i = 0; i < 10 && await page.evaluate(() => !!window.__saveNative?.isOpen?.()); i++) await press(page, "Escape", 900);
await page.waitForFunction(() => !window.__saveNative?.isOpen?.(), null, { timeout: 20000 }).catch(() => {});
// The commit (which slot was written) lands when the screen closes.
check("the screen reports the saved slot as 1",
    (await page.evaluate(() => window.__saveNative.diagnostics().savedSlot)) === 1);

const raw1 = await slotRaw(page, 1);
const raw0 = await slotRaw(page, 0);
const slot1 = raw1 ? JSON.parse(raw1) : null;
check("commit: slot 1 now holds the record", !!slot1?.record, String(raw1).slice(0, 60));
check("commit: slot 0 stays empty", raw0 === null, String(raw0).slice(0, 40));
check("commit: the record carries the save point's place index (43 = Asuka Inn)",
    slot1?.record?.placeIndex === 43, `placeIndex=${slot1?.record?.placeIndex}`);
check("commit: the record carries the name and the BIT",
    slot1?.record?.name === "KAI" && slot1?.record?.bits === 4242,
    `name=${slot1?.record?.name} bits=${slot1?.record?.bits}`);
check("commit: the opaque 0x26C4 image is stored beside it",
    Array.isArray(slot1?.image) && slot1.image.length === 0x26c4, `len=${slot1?.image?.length}`);
check("commit: the last-used slot is recorded as 1",
    (await page.evaluate(() => localStorage.getItem("mcardLastSlot"))) === "1");

// ── boot 2: reload, the title's Continue, load slot 1 back ─────────────────
await page.goto(`${ROOT}/?noEncounters=1`, { waitUntil: "load", timeout: 60000 });
// The first-launch visual-style chooser only appears while nothing is saved.
const chooserUp = await page.evaluate(() => {
    const el = document.getElementById("asset-mode-screen");
    return !!el && !el.hidden;
});
if (chooserUp) {
    await page.click("#asset-mode-authentic").catch(() => {});
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 60000 });
}
await page.waitForFunction(() => window.__cntyselNative?.active?.() === true
    && window.__cntyselNative.diagnostics().host?.state?.state1 === 7, null, { timeout: 60000 });
let picked = null;
for (let i = 0; i < 20 && !picked; i++) { await press(page, "i", 140); picked = await page.evaluate(() => window.__bootLanguage ?? null); }
await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 60000 });
await press(page, "i", 140);
await page.waitForFunction(() => window.__titleMovie?.()?.open === false, null, { timeout: 60000 });
await waitTitlePrompt(page, 60000);
await press(page, "i", 900);                            // prompt -> menu
await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20000 });
await press(page, "Enter", 900);                        // Continue
await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 40000 });
await waitCardWindow(page, 2, 40000);
await page.screenshot({ path: `${OUT}/04-continue-chooser.png` });

// The load list starts on slot 0: opening it must report "No data here."
await press(page, "Enter", 700);
await waitCardWindow(page, 0x21, 40000);
await press(page, "Enter", 1200);
const emptyText = await cardText(page);
check("load: the empty slot 0 says so", emptyText.includes("No data here."), emptyText.slice(0, 160));
check("load: nothing was restored from the empty slot",
    (await page.evaluate(() => window.__saveNative.diagnostics().loadedSlot)) === null);
await press(page, "Enter", 700);                        // dismiss
for (let i = 0; i < 8; i++) {
    if ((await windowState(page)) === 0x21) break;
    await press(page, "Enter", 700);
}
await press(page, "ArrowRight", 900);                   // the chooser to slot 1
await page.screenshot({ path: `${OUT}/05-load-file-card-slot1.png` });
const loadCardText = await cardText(page);
check("load: the slot-1 file card shows the saved record",
    loadCardText.includes("KAI") && loadCardText.includes("Asuka Inn"), loadCardText.slice(0, 200));
const nav = page.waitForNavigation({ timeout: 40000 }).catch(() => null);
await press(page, "Enter", 700);                        // load
await waitCardWindow(page, 0x1f6, 40000);               // "LOADED."
await page.screenshot({ path: `${OUT}/06-loaded.png` });
await press(page, "Enter", 700);                        // dismiss: the page reloads here
const navDone = await nav;
check("load: confirming slot 1 reloads the page", !!navDone);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
const restored = await page.evaluate(() => ({
    bits: window.__state.bits,
    name: window.__state.playerName,
    last: localStorage.getItem("mcardLastSlot"),
    slot0: localStorage.getItem("mcardSlot0"),
}));
check("load: slot 1's BIT came back", restored.bits === 4242, `bits=${restored.bits}`);
check("load: slot 1's name came back", restored.name === "KAI", `name=${restored.name}`);
check("load: the last-used slot stayed 1", restored.last === "1", `last=${restored.last}`);
check("load: slot 0 is still empty", restored.slot0 === null);
await page.screenshot({ path: `${OUT}/07-field-after-load.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
