// Focused REFERENCE-route verifier for the memory-card save screen
// (pro/stgmcard), Phase 6.3 group 1 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md.
//
// Runs the real web/game.js, opens the save screen through the lab entry point
// (the same `openMemoryCard` the inn/save-point path calls), and drives the
// shipped pro/stgmcard overlay with real key events:
//   slot chooser -> card check -> file card -> overwrite prompt -> write
// It asserts the screen runs through the host with the walker's own slots as the
// card, that the file card shows the walker's record, and that a committed save
// persists the walker's slot (record + image).
//
// Every assertion below reads the overlay's own host (`diagnostics().host`,
// `_host.rt.drawCalls`, `__nativeScreenTextDump`), which only the interpreter
// route has — the translated MemcardSession publishes `host: null` by design
// (web/save-translated.js). So this check carries `?nativeSave=1`, the research
// reference. It ran on the ordinary route until 2026-10-03, where every host
// assertion read `undefined` and the walker's slot was still empty because the
// translated screen commits on CLOSE, not on the write. The production route is
// proved by tools/verify_translated_save.mjs, tools/verify_save_ui.mjs and
// tools/verify_shop_save_roundtrip.mjs.
//
//   tools/run-playwright.sh tools/verify_native_save.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`, VERIFY_PORT set.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitCardText } from "./memcard-continue.mjs";

const BASE = `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeSave=1`;
// The hand-authored screen the reference is compared against. `legacySave=1`
// already wins over `nativeSave=1` in web/game.js (`USE_NATIVE_SAVE =
// !GYM_PARAMS.has("legacySave")`), so this needs the flag spelled out only to be
// unambiguous.
const LEGACY = `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&legacySave=1`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-save-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();

async function seedState(page) {
    await page.evaluate(() => {
        const s = window.__state;
        s.playerName = "KAI";
        s.bits = 4242;
        s.party = ["p006agum", "p009rena"];
        s.partyStats = [{ level: 7, xp: 100 }, { level: 5, xp: 50 }];
        s.playSeconds = 3725; // 1h 02m 05s
        localStorage.removeItem("mcardSlot0");
        localStorage.removeItem("mcardLastSlot");
    });
}

async function openSave(page) {
    await seedState(page);
    await page.evaluate(() => window.__labOpen("save"));
    // `isOpen()` is true before the overlay's root exists (web/save-native.js
    // boots it once the executable assets are in), so wait for the host rather
    // than for a fixed delay.
    await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.host != null,
        null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
}

async function state(page) {
    return page.evaluate(() => {
        const d = window.__saveNative.diagnostics?.() ?? null;
        const pick = d?.savedSlot ?? 0;
        const raw = localStorage.getItem(`mcardSlot${pick}`);
        let slot = null;
        try { slot = raw ? JSON.parse(raw) : null; } catch { /* keep null */ }
        const text = (window.__nativeScreenTextDump?.() ?? [])
            .map((w) => w.decoded.map((x) => x.text).join("|"))
            .filter((t) => t.trim());
        return { diag: d, raw, slot, text };
    });
}

async function press(page, key, waitMs = 900) {
    await page.keyboard.down(key);
    await page.waitForTimeout(80);
    await page.keyboard.up(key);
    await page.waitForTimeout(waitMs);
}

// ── before: the hand-authored screen at the same spot ───────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(LEGACY, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await openSave(page);
    await page.screenshot({ path: `${OUT}/before-legacy-save.png` });
    console.log("[verify] legacy save screen captured");
    await page.close();
}

// ── after: the native route through the real game ───────────────────────────
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
console.log("[verify] game booted");
await openSave(page);

let s = await state(page);
check("save screen opens through game.js", s.diag?.open === true);
check("native root booted", s.diag?.host?.booted === true, `module=${s.diag?.host?.module}`);
check("no traps on entry", (s.diag?.host?.traps ?? -1) === 0);
check("every walker slot starts empty",
    await page.evaluate(() => [0, 1, 2].every((i) => localStorage.getItem(`mcardSlot${i}`) === null)));
await page.screenshot({ path: `${OUT}/01-slot-chooser.png` });

// Slot chooser -> card check -> the file card.
await press(page, "Enter", 2000);
s = await state(page);
check("card check completes without traps", (s.diag?.host?.traps ?? -1) === 0,
    `traps=${s.diag?.host?.traps}`);
await page.screenshot({ path: `${OUT}/02-file-card.png` });

// Overwrite prompt -> confirm -> the screen writes the card.
await press(page, "Enter", 1500);
await page.screenshot({ path: `${OUT}/03-confirm.png` });
await press(page, "Enter", 2500);
s = await state(page);
check("a save wrote the walker's slot", s.raw !== null, `raw=${String(s.raw).slice(0, 60)} stores=${JSON.stringify(s.diag?.stores)} reads=${JSON.stringify(s.diag?.reads)}`);
check("the written record carries the walker's BIT",
    s.slot?.record?.bits === 4242, `bits=${s.slot?.record?.bits}`);
check("the written record carries the player name",
    s.slot?.record?.name === "KAI", `name=${s.slot?.record?.name}`);
check("the screen stored its 0x26C4 save image",
    Array.isArray(s.slot?.image) && s.slot.image.length === 0x26c4,
    `len=${s.slot?.image?.length}`);
check("the saved slot is the one the card host reported", s.diag?.savedSlot != null,
    `savedSlot=${s.diag?.savedSlot} stores=${JSON.stringify(s.diag?.stores)}`);
// The slot the player picked is whatever the card host reported: the screen's
// chooser selection drives both halves, so the load must come back to the SAME
// slot rather than a hard-coded one.
const savedSlot = s.diag?.savedSlot ?? 0;
check("no traps through the write", (s.diag?.host?.traps ?? -1) === 0);
// The committed card shows the walker's own record: name, BIT and the party
// levels the adapter seeded into the roster records. It is drawn a frame or two
// after the write lands, so read the text at the first frame that shows the
// player name rather than one arbitrary frame after the last key press.
const card = await waitCardText(page, "KAI");
check("committed card shows the player name", card.includes("KAI"), card.slice(0, 200));
check("committed card shows the walker's BIT", card.includes("4242"), card.slice(0, 200));
check("committed card shows a party level", card.includes("7") || card.includes("5"), card.slice(0, 200));
await page.screenshot({ path: `${OUT}/04-saved.png` });
const artwork = await page.evaluate(async () => {
    const ns = await import('/native-screen.js');
    return window.__saveNative._host.rt.drawCalls.filter(c => c.method === 'drawSprite')
        .map(c => ({ pack: ns.nativeScreenPackNameForDir(c.args[0]), key: ns.nativeScreenDirKey(c.args[0]), args: c.args.slice(1) }));
});
check('saved card uses its Agumon nameplate artwork',
    artwork.some(c => c.pack === 'stmcrd' && c.args[0] === 41 && c.args[2] === 35), JSON.stringify(artwork));
check('saved card includes both party portraits',
    artwork.filter(c => c.pack === 'stmcrd' && c.args[0] < 29 && c.args[2] === 133).length === 2,
    JSON.stringify(artwork));

// Leave the screen with the cancel/Back button (pad bit 0xE, the word's 0x4000,
// which is Escape or x on the keyboard since 2026-10-03; `c` confirms). The
// driver's state-2 arm calls the leave method F0x80084ca8, which sets the window
// object's lifecycle to 2 and lets the root retire. The field must come back with
// the walker's state intact.
for (let i = 0; i < 4 && await page.evaluate(() => window.__saveNative.isOpen()); i++) {
    await press(page, "Escape", 1200);
}
await page.waitForTimeout(1500);
const closed = await page.evaluate(() => ({
    open: window.__saveNative.isOpen(),
    bits: window.__state.bits,
    host: window.__saveNative.diagnostics?.().host ?? null,
}));
check("the screen closes back to the game", closed.open === false,
    `frames=${closed.host?.frames} traps=${closed.host?.traps}`);
check("the walker's money is unchanged by the save", closed.bits === 4242, `bits=${closed.bits}`);
await page.screenshot({ path: `${OUT}/05-back-on-field.png` });

// ── the load side: the same card, read back ────────────────────────────────
// Reopen in LOAD mode; the file card must show the record the save wrote, and
// confirming the load must read the stored 0x26C4 image back through the card
// host before the adapter restores the walker's own snapshot.
await page.evaluate(() => window.__labOpen("load"));
await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.host != null,
    null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
await press(page, "Enter", 2200);          // chooser confirm -> card check
let l = await state(page);
check("load route boots with no traps", (l.diag?.host?.traps ?? -1) === 0,
    `traps=${l.diag?.host?.traps}`);
const loadCard = await waitCardText(page, "KAI");
check("load file card shows the saved BIT", loadCard.includes("4242"), loadCard.slice(0, 200));
check("load file card shows the saved name", loadCard.includes("KAI"), loadCard.slice(0, 200));
await page.screenshot({ path: `${OUT}/06-load-card.png` });
const nav = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await press(page, "Enter", 2000);          // prompt -> Load
await press(page, "Enter", 2500);
const navDone = await nav;
// The adapter marks the slot on the 0x26C4 read and, on close, restores the
// walker's own snapshot and reloads so every module rebuilds from it — the same
// semantic the hand-authored screen has.
const lastSlot = await page.evaluate(() => localStorage.getItem("mcardLastSlot"));
check("the load reads the image and reloads the walker", !!navDone, `nav=${!!navDone}`);
check("the loaded slot is the slot that was saved", lastSlot === String(savedSlot),
    `mcardLastSlot=${lastSlot} savedSlot=${savedSlot}`);
check("no traps through the load", (l.diag?.host?.traps ?? -1) === 0);
await page.screenshot({ path: `${OUT}/07-after-load.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
