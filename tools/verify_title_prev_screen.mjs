// tools/verify_title_prev_screen.mjs — the Japanese attract loop reads the
// previous screen code, and every route into the title records what it left.
//
// Decoded: stdwtitl's choice dispatcher F0x80086834 reads the launcher's
// previous-screen word (0x8004B400, through the getter 0x80016B58 at slot
// 0x8004B448) and launches 0xE01 unless it already reads 0xE01
// (pro/stdwtitl.s .L0x00003CA0-.L0x00003CEC; ledger UI-TITLE-ATTRACT-LOOP-2026-08-14).
//
// The route this checks is the one a stale record used to get wrong: watch the
// first opening movie, back out of the memory card, and let the title time out
// again. The screen being left is the CARD (0xC00), not the movie, so the
// faithful answer is MOVIEOP2 (0xE01) — before the fix the walker reused the
// movie's code and launched MOVIEOPN (0xE02) instead.
//
// Server: python3 -m http.server 8742 --directory web
// Run:    VERIFY_PORT=8742 tools/run-playwright.sh tools/verify_title_prev_screen.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { press, cardIsOpen, waitTitlePrompt } from "./memcard-continue.mjs";

const OUT = process.env.PREV_SHOT || ".bunny-scratch/title-prev-screen";
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); else console.log("  ok:", m); };
const evidence = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
const executable = [];
const failedResponses = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url()}`); });
await page.route("**/assets/native/**", (route) => {
    executable.push(route.request().url());
    return route.abort();
});
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.removeItem("saveSlots");
});

const movie = () => page.evaluate(() => window.__titleMovie?.() ?? null);
const waitMovieOpen = (timeout = 45_000) =>
    page.waitForFunction(() => (window.__titleMovie?.().open === true ? window.__titleMovie() : false),
        null, { timeout }).then((h) => h.jsonValue()).catch(() => null);
const titleNow = () => page.evaluate(() => {
    const t = window.__titleState?.();
    return { phase: t?.phase?.() ?? null, highlight: t?.highlight?.() ?? null,
        done: t?.isDone?.() ?? null, result: t?.result?.() ?? null,
        native: document.getElementById("title-screen")?.className ?? null,
        card: !!window.__saveNative?.isOpen?.(), started: !!window.__state?.started };
});
const skipMovie = async () => {
    console.log("  step: pressing START to skip the movie", JSON.stringify(await titleNow()));
    await page.keyboard.press("i", { delay: 80 });
    await waitTitlePrompt(page);
    console.log("  step: back at the prompt", JSON.stringify(await titleNow()));
};

try {
    // The Japanese route: the screen cannot select JPN by pad (its side pane is
    // never opened), so the debug language byte stands in for the boot choice.
    await page.goto(`${baseUrl(8742)}/index.html?skipLanguage=1&language=0&noEncounters=1`);
    await waitTitlePrompt(page);
    check((await page.evaluate(() => window.__state?.languageByte)) === 0,
        "the Japanese language byte is set");

    // First timeout: the record is unset, so MOVIEOP2 plays (0xE01).
    const first = await waitMovieOpen();
    check(first?.code === 0xe01,
        `the first idle timeout launched MOVIEOP2 (0xE01) — got ${first && "0x" + first.code.toString(16)}`);
    await skipMovie();
    await page.screenshot({ path: `${OUT}/01-after-first-movie.png` });

    // Back out of the memory card: the screen being left is the card (0xC00).
    // On the Japanese layout the poll does NOT swap the face buttons, so the
    // confirm bit (0x2000, the title menu's bit 13) is the physical Circle:
    // `k` on the keyboard. The English confirm key (Enter, the physical Cross)
    // reaches 0x4000 on this layout and must do nothing at the menu.
    await waitTitlePrompt(page);
    await page.keyboard.press("i", { delay: 80 });
    await page.waitForFunction(() => window.__titleState?.().phase?.() === "menu", null, { timeout: 20_000 });
    const menu = await titleNow();
    check(menu.highlight === 1, `the menu opens on Continue (highlight ${menu.highlight})`);
    await page.keyboard.press("Enter", { delay: 80 });
    await page.waitForTimeout(800);
    check((await titleNow()).phase === "menu",
        "the English confirm key does nothing on the Japanese layout (the disc's own swap)");
    await press(page, "k", 900);
    await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 40_000 });
    const card = await page.evaluate(() => ({
        mode: window.__saveNative?.diagnostics?.().mode ?? null,
        transition: window.__saveNative?.diagnostics?.().summary?.transition ?? null,
    }));
    check(card.mode === "load", `Continue opened the card in LOAD mode (${card.mode})`);
    // The card's Back is word bit 0x4000: the physical Triangle on the English
    // layout (Escape, memcard-continue.mjs leaveCard) but the physical Cross
    // here, since the Japanese poll does not swap the face buttons.
    for (let i = 0; i < 8 && await cardIsOpen(page); i++) await press(page, "Enter", 900);
    await page.waitForFunction(() => !window.__saveNative?.isOpen?.(), null, { timeout: 20_000 });
    await waitTitlePrompt(page);
    check((await page.evaluate(() => window.__memcardExitScreen)) === 0xe00,
        "the card's exit selector was 0xE00, the title screen");
    check((await page.evaluate(() => window.__state?.started ?? false)) === false,
        "backing out of the card did not start a game");

    // The second timeout: the previous screen is the card, NOT the movie — so
    // MOVIEOP2 plays again (0xE01). A stale record launched MOVIEOPN (0xE02).
    const second = await waitMovieOpen();
    check(second?.code === 0xe01,
        `after the card return the idle timeout launched MOVIEOP2 (0xE01) — got ${second && "0x" + second.code.toString(16)}`);
    const stream = await page.waitForFunction(
        () => window.__titleMovie?.().file || false, null, { timeout: 15_000 })
        .then((h) => h.jsonValue()).catch(() => "");
    check(String(stream).endsWith("movieop2.mp4"),
        `the stream is the row's own asset (${stream})`);
    await page.screenshot({ path: `${OUT}/02-after-card-return.png` });
    evidence.push({ first: first?.code, second: second?.code, card });

    check(executable.length === 0, `no executable asset was requested (${executable.length})`);
    check(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    check(failedResponses.length === 0, `no failed asset (${failedResponses.slice(0, 2).join(" | ")})`);
    writeFileSync(`${OUT}/proof.json`, JSON.stringify({ evidence, executable, failedResponses, errors, failures }, null, 2) + "\n");
} catch (e) {
    failures.push(`check threw: ${e.message}`);
} finally {
    await browser.close();
}

if (failures.length) {
    console.error("\nFAILED:");
    for (const m of failures) console.error(" -", m);
    process.exit(1);
}
console.log("\nOK: the card return records the card, and the Japanese title times out to MOVIEOP2");
