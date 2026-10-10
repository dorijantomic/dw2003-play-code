// Focused production-route verifier for the memory card's DECODED trigger: the
// title's Continue choice (Phase 6.3 group 1 / 6.5 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The original's save-point caller is untraced, but the LOAD direction has a
// decoded one: stdwtitl's choice dispatcher launches code 0x2D7 for Start and
// 0xC00 for Continue (docs/research/ui/stdwtitl-title-menu-2026-08-14.md), and
// 0xC00 is the memory card in LOAD mode. This checks that the shipped title's
// Continue opens the shipped pro/stgmcard screen in load mode over a seeded
// walker slot — and that backing out of it returns to the TITLE, because that
// is the selector the card's own root writes when LOAD mode closes with nothing
// loaded (pro/stgmcard.s 0x4dc4-0x4e2c -> 0xE00). It does not start a game.
//
// The screens are the production ones: no `?nativeSave=1` / `?nativeTitle=1`, so
// the card is the translated MemcardSession and the title is the translated
// TitleSession. (`?nativeSave=1` still reaches the same two exits through
// web/save-native.js; see tools/verify_translated_save.mjs for the card itself.)
//
//   tools/run-playwright.sh tools/verify_native_save_continue.mjs [outdir]
//
// Setup: `python3 -m http.server <port> --directory web`, VERIFY_PORT set.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { leaveCard, press, waitCardWindow, waitTitlePrompt } from "./memcard-continue.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-save-continue";
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
page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});

// A walker save plus one memory-card slot, in the walker's own shapes: the slot's
// record is buildRecord's field set (web/save.js); the image is left out, so the
// load itself is not what this check proves.
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("bits", "1000");
    localStorage.setItem("mcardSlot0", JSON.stringify({
        record: { name: "KAI", areaIndex: 1, placeIndex: 4, bits: 4242, hours: 0, minutes: 2, seconds: 5, partyTypes: [3, 9, 10], partyLevels: [12, 13, 14] },
        data: {},
        savedAt: Date.now(),
    }));
});

// The boot country/language screen (code 0x1600) precedes the title; this
// check is about the title's Continue, so skip it.
await page.goto(`${ROOT}/?noEncounters=1&skipLanguage=1`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => typeof window.__titleState === "function", { timeout: 60000 });
// The shipped title's own prompt, then START (its logical 3) for the menu, whose
// default highlight is the lower option: Continue.
await waitTitlePrompt(page);
await press(page, "i", 900);      // prompt -> menu
await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20000 });
await press(page, "Enter", 900);  // Continue (the default highlight)

const opened = await page.waitForFunction(
    () => window.__saveNative?.diagnostics?.()?.mode === "load",
    null, { timeout: 15000 },
).then(() => true).catch(() => false);
let s = await page.evaluate(() => {
    const d = window.__saveNative?.diagnostics?.() ?? null;
    return {
        open: window.__saveNative?.isOpen?.() ?? false,
        mode: d?.mode ?? null,
        execution: d?.execution ?? null,
        traps: d?.traps ?? null,
    };
});
check("the title's Continue opens the memory card in LOAD mode", opened, `mode=${s.mode}`);
check("the card is translated code, not the interpreter", s.execution === "translated",
    `execution=${s.execution}`);
check("no traps on entry", (s.traps ?? -1) === 0, `traps=${s.traps}`);

// The screen must have settled on its chooser before a confirm means anything;
// then the card's own check runs and the file card shows the seeded record.
await waitCardWindow(page, 2).catch(() => {});
await press(page, "Enter", 600);
await page.waitForTimeout(1200);
let card = "";
for (let i = 0; i < 8; i++) {
    // The translated screen's own text widgets, decoded the way a player reads
    // them (web/native-screen-text.js drawNativeTextWidgets).
    const text = await page.evaluate(async () => {
        const { drawNativeTextWidgets } = await import("/native-screen-text.js");
        const widgets = window.__saveNative?.textWidgets?.() ?? [];
        return drawNativeTextWidgets({ drawImage() {} }, widgets.filter((w) => w.visible)).texts ?? [];
    });
    card = text.join("|").replace(/\s+/g, " ");
    if (card.includes("KAI") || card.includes("4242")) break;
    await page.waitForTimeout(700);
}
check("the file card shows the seeded walker slot", card.includes("KAI") || card.includes("4242"),
    card.slice(0, 200));
await page.screenshot({ path: `${OUT}/01-continue-load-screen.png` });

// Cancel (this screen's Back is pad bit 0xE, the cross key). What the screen
// hands back is its own exit selector, and in LOAD mode with nothing loaded the
// decoded answer is 0xE00 — the TITLE SCREEN (pro/stgmcard.s 0x4dc4-0x4e2c). So
// the player lands on the title again, not in a game they did not load.
await leaveCard(page);
await page.waitForTimeout(1000);
const after = await page.evaluate(() => ({
    saveOpen: window.__saveNative?.isOpen?.() ?? null,
    started: !!window.__state?.started,
    phase: window.__titleState?.()?.phase?.() ?? null,
    titleHidden: document.getElementById("title-screen")?.hidden ?? null,
    exitScreen: window.__memcardExitScreen ?? null,
    transition: window.__saveNative?.diagnostics?.()?.summary?.transition ?? null,
}));
check("cancelling the load closes the screen", after.saveOpen === false, `open=${after.saveOpen}`);
check("cancelling does NOT start the game", after.started === false, `started=${after.started}`);
check("the card's exit selector was 0xE00, the title screen",
    after.exitScreen === 0xe00 && JSON.stringify(after.transition) === "[3584,0]",
    `selector=${after.exitScreen} transition=${JSON.stringify(after.transition)}`);
check("the title is back on its Press Start prompt",
    after.titleHidden === false && after.phase === "prompt",
    JSON.stringify({ hidden: after.titleHidden, phase: after.phase }));
await page.screenshot({ path: `${OUT}/02-after-cancel.png` });

// And Continue works a second time from the title that came back.
await press(page, "i", 900);
await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20000 });
await press(page, "Enter", 900);
await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 40000 }).catch(() => {});
await waitCardWindow(page, 2).catch(() => {});
const again = await page.evaluate(() => ({
    open: !!window.__saveNative?.isOpen?.(),
    mode: window.__saveNative?.diagnostics?.()?.mode ?? null,
    window: window.__saveNative?.diagnostics?.()?.state?.window ?? null,
}));
check("Continue opens the card again from the title that came back",
    again.open && again.mode === "load" && again.window === 2, JSON.stringify(again));
check("no traps through the route", (await page.evaluate(() => window.__saveNative?.diagnostics?.()?.traps ?? -1)) === 0);
await page.screenshot({ path: `${OUT}/03-continue-again.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
