// Focused production-route verifier for the native Card Duel (pro/cardgame,
// Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js with ?nativeDuel=1, opens the duel through the lab
// entry point with the ordinary launcher parameter, and drives the shipped
// pro/cardgame overlay with real key events. It asserts:
//   * the native overlay booted (module pro/cardgame), 0 traps, bridge active;
//   * the opponent index reaches the launcher cell the root tick reads
//     (0x8004B404) and the pre-duel "Card Battle Challenge" frame is drawn
//     (mode 10, effect opcode 0xA6);
//   * Circle (Enter) dismisses the banner, picks the folder in the chooser
//     (deck built: duel+0x5A4 = 40 cards) and reaches the board's Draw Phase
//     (mode 4) with zero traps;
//   * before/after captures land in the outdir.
//
//   .opencode/autonomy/check-browser tools/verify_native_duel.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.
//
// Contract: research answer cardduel-challenge-to-board (accepted 2026-09-22),
// measured corrections in .dw3-research/autonomous-plan/phase6-route-inventory.md.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DUEL_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DUEL_SHOT || "/tmp/opencode/native-duel-verify";
mkdirSync(OUT, { recursive: true });

const LAUNCHER_CELL = 0x8004b404;
const DUEL_CB = 0x800a2f00;
const MODE = 0x2f8;
const EFFECT_ACTIVE = 0x2f4;
const OPCODE = 0x420;
const BANNER_STEP = 0x422;
const DECK_SIZE = 0x5a4;
const DUEL_WON = 0x80048ac0;
const OPPONENT = 1;

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(`pageerror: ${e.message}`); });
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
    localStorage.setItem("bits", "5000");
    const starter = Array.from({ length: 40 }, (_, i) => i + 1);
    localStorage.setItem("cardCollection", JSON.stringify({
        owned: starter.map((id) => [id, 1]), seen: starter,
        folders: [
            { name: "Alpha", cards: starter.slice() },
            { name: "Beta", cards: starter.slice() },
            { name: "Gamma", cards: starter.slice() },
        ],
        activeFolder: 0, packs: [],
    }));
});

try {
    await page.goto(`${ROOT}index.html?skipTitle=1&noEncounters=1&nativeDuel=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 40000 });
    console.log("[verify] game booted");

    await page.evaluate((id) => window.__labOpen("cardduel", id), OPPONENT);
    await page.waitForFunction(() => window.__cardDuelNative?.isOpen?.() === true, { timeout: 15000 });
    await page.waitForFunction(() => window.__nativeScreenObjects?.().some((o) => o.cb === 0x800a2f00), null, { timeout: 20000 });
    console.log("[verify] native duel booted");

    const snap = () => page.evaluate((f) => {
        const rd = (a, s) => window.__nativeScreenRead(a, s) >>> 0;
        const duel = window.__nativeScreenObjects().find((o) => o.cb === f.cb);
        const d = window.__cardDuelNative?.diagnostics?.();
        return {
            frames: d?.host?.frames ?? 0, traps: d?.host?.traps ?? 0,
            objects: d?.host?.objects ?? 0, draws: d?.host?.drawIntents ?? 0,
            bridge: d?.host?.bridgeEnabled ?? false, module: d?.host?.module ?? null,
            open: d?.open ?? false, launcher: rd(f.launcher, 4),
            mode: rd(duel.addr + f.mode, 1), effectActive: rd(duel.addr + f.active, 1),
            opcode: rd(duel.addr + f.opcode, 1), deck: rd(duel.addr + f.deck, 2),
            won: rd(f.won, 4),
        };
    }, { cb: DUEL_CB, launcher: LAUNCHER_CELL, mode: MODE, active: EFFECT_ACTIVE, opcode: OPCODE, deck: DECK_SIZE, won: DUEL_WON });

    // The banner is armed by mode 10 after the ~44-frame spinner handshake; the
    // opcode is written on the arm's second step, so wait for the banner itself
    // (0xA6) and not just the mode.
    await page.waitForFunction((f) => {
        const rd = (a, s) => window.__nativeScreenRead(a, s) >>> 0;
        const duel = window.__nativeScreenObjects?.().find((o) => o.cb === f.cb);
        return duel && rd(duel.addr + f.mode, 1) === 10 && rd(duel.addr + f.opcode, 1) === f.banner;
    }, { cb: DUEL_CB, mode: MODE, opcode: OPCODE, banner: 0xa6 }, { timeout: 15000 });
    // The banner's plate and its text fade in over roughly a second; capture the
    // settled frame so the before image shows "Card Battle Challenge" rather than
    // the empty field behind it.
    await page.waitForTimeout(1600);
    const banner = await snap();
    console.log("[verify] banner:", JSON.stringify(banner));
    await page.screenshot({ path: `${OUT}/01-banner.png` });

    check("native duel opens through game.js", banner.open === true, `open=${banner.open}`);
    check("native root booted (pro/cardgame)", banner.module === "pro/cardgame", `module=${banner.module}`);
    check("mixed-mode bridge active", banner.bridge === true, `bridge=${banner.bridge}`);
    check("zero traps at the pre-duel banner", banner.traps === 0, `traps=${banner.traps}`);
    check("launcher cell carries the opponent index", banner.launcher === OPPONENT, `0x8004B404=${banner.launcher}`);
    check("banner mode 10 with effect opcode 0xA6", banner.mode === 10 && banner.opcode === 0xa6,
        `mode=${banner.mode} opcode=0x${banner.opcode.toString(16)}`);
    check("the banner draws the screen's own pictures", banner.draws > 5000, `intents=${banner.draws}`);

    // Circle (Enter) advances the banner; the chooser confirms with Circle too.
    let board = banner;
    for (let i = 0; i < 30; i++) {
        await page.keyboard.down("Enter");
        await page.waitForTimeout(220);
        await page.keyboard.up("Enter");
        await page.waitForTimeout(110);
        board = await snap();
        if (board.mode === 4) break;
    }
    console.log("[verify] board:", JSON.stringify(board));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/02-board.png` });

    check("Circle advances the banner and chooser to the board", board.mode === 4, `mode=${board.mode}`);
    check("the folder choice built the 40-card deck", board.deck === 40, `duel+0x5A4=${board.deck}`);
    check("zero traps through the board", board.traps === 0, `traps=${board.traps}`);
    check("the board draws the duel field", board.draws > banner.draws, `intents=${banner.draws} -> ${board.draws}`);
    check("the result cell starts at 0", board.won === 0, `0x80048AC0=${board.won}`);
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    console.log(`[verify] captures: ${OUT}/01-banner.png, ${OUT}/02-board.png`);
    if (failures) {
        console.error(`FAIL native duel: ${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        console.log("PASS native duel: banner -> chooser -> board, 0 traps");
    }
} catch (e) {
    console.error("FAIL native duel: " + e.message);
    if (pageErrors.length) console.error(pageErrors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
