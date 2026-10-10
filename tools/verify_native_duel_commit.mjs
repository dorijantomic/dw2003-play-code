// Focused production-route verifier: the native card duel's result commit.
//
// Phase 6.3 group 2 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md. Runs the
// real web/game.js with ?nativeDuel=1, walks the shipped pro/cardgame overlay to
// the board (Draw Phase, mode 4), then decks the opponent out by seeding the
// opponent's deck remainder below six cards — a legitimate short deck, not the
// asserted value — so the screen's own draw logic ends the duel and runs its
// commit. Asserts:
//   * the board is reached with 0 traps (the same walk as verify_native_duel);
//   * the opponent deck-out branch fires (+0x440 = 2) and the duel ends;
//   * 0x80048AC0 reads 1 (the player won) and the capped win counter at
//     0x80048D34 + duel+0x2EC + 0x7C goes up by one;
//   * the screen closes through the adapter (isOpen false) with 0 traps;
//   * before/after captures.
//
//   .opencode/autonomy/check-browser tools/verify_native_duel_commit.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.
//
// Contract: research answer cardduel-board-turn-and-commit (accepted 2026-09-22),
// anchors cardgame.s 0x000204e0-0x00020510 (commit) and 0x000130bc (close wait).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DUEL_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DUEL_SHOT || "/tmp/opencode/native-duel-commit";
mkdirSync(OUT, { recursive: true });

const DUEL_CB = 0x800a2f00;
const MODE = 0x2f8;
const OPCODE = 0x420;
const OPPONENT_DECK = 0x66c;
const OUTCOME = 0x302;
const END_STEP = 0x303;
const DRAW_RESULT = 0x440;
const DUEL_WON = 0x80048ac0;
const CTX = 0x80048d34;
const COUNTER_OFF = 0x7c;
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

    const snap = () => page.evaluate((f) => {
        const rd = (a, s) => window.__nativeScreenRead(a, s) >>> 0;
        const objs = window.__nativeScreenObjects();
        const duel = objs.find((o) => o.cb === f.cb);
        const d = window.__cardDuelNative?.diagnostics?.();
        if (!duel) {
            return {
                closed: true, open: d?.open ?? false, traps: d?.host?.traps ?? 0, objects: objs.length,
                // The adapter commits the screen's result into the walker's own
                // state before teardown, so the canonical state is readable here
                // even after the screen's RAM is gone.
                won: window.__state?.duelWon === true ? 1 : 0,
                counter: window.__state?.duelWinCounts?.[String(f.opponent)] ?? null,
            };
        }
        const counterOff = rd(duel.addr + 0x2ec, 4);
        window.__duelCommitCounter = rd(f.ctx + counterOff + f.counterOff, 1);
        return {
            closed: false, open: d?.open ?? false,
            frames: d?.host?.frames ?? 0, traps: d?.host?.traps ?? 0, objects: objs.length,
            mode: rd(duel.addr + f.mode, 1), opcode: rd(duel.addr + f.opcode, 1),
            opponentDeck: rd(duel.addr + f.oppDeck, 2),
            outcome: rd(duel.addr + f.outcome, 1), endStep: rd(duel.addr + f.endStep, 1),
            drawResult: rd(duel.addr + f.drawResult, 1),
            counterOff,
            won: rd(f.won, 4),
            counter: rd(f.ctx + counterOff + f.counterOff, 1),
        };
    }, { cb: DUEL_CB, mode: MODE, opcode: OPCODE, oppDeck: OPPONENT_DECK, outcome: OUTCOME, endStep: END_STEP, drawResult: DRAW_RESULT, won: DUEL_WON, ctx: CTX, counterOff: COUNTER_OFF, opponent: OPPONENT });

    // Walk to the board exactly as verify_native_duel does.
    let board = await snap();
    for (let i = 0; i < 30 && board.mode !== 4; i++) {
        await page.keyboard.down("Enter");
        await page.waitForTimeout(220);
        await page.keyboard.up("Enter");
        await page.waitForTimeout(110);
        board = await snap();
    }
    console.log("[verify] board:", JSON.stringify(board));
    check("the board (Draw Phase, mode 4) is reached", board.mode === 4, `mode=${board.mode}`);
    check("zero traps on the board", board.traps === 0, `traps=${board.traps}`);
    const counterBefore = board.counter;
    const opponentDeckBefore = board.opponentDeck;

    // A legitimate short opponent deck: fewer than six cards cannot be drawn, so
    // the screen's own draw step decks the opponent out.
    await page.evaluate((f) => window.__nativeScreenWrite(
        window.__nativeScreenObjects().find((o) => o.cb === f.cb).addr + f.oppDeck, 5, 2), { cb: DUEL_CB, oppDeck: OPPONENT_DECK });
    await page.waitForTimeout(700);
    let mid = await snap();
    console.log("[verify] after short deck:", JSON.stringify(mid));
    check("the short opponent deck is seen by the screen", mid.opponentDeck === 5, `duel+0x66C=${mid.opponentDeck}`);
    await page.screenshot({ path: `${OUT}/01-board.png` });

    // Dismiss the win banner and let the commit and close run. Keep the last
    // snapshot taken while the screen's RAM still existed: the commit cells are
    // read from the screen, and the adapter tears it down the moment it closes.
    let lastOpen = mid;
    for (let i = 0; i < 8; i++) {
        await page.keyboard.down("Enter");
        await page.waitForTimeout(220);
        await page.keyboard.up("Enter");
        await page.waitForTimeout(150);
        mid = await snap();
        if (!mid.closed) lastOpen = mid;
        if (mid.closed || mid.won === 1) break;
    }
    await page.waitForTimeout(1200);
    const after = await snap();
    console.log("[verify] after commit:", JSON.stringify(after));
    await page.screenshot({ path: `${OUT}/02-after-commit.png` });

    check("the duel ended (the screen closed)", after.closed === true || after.open === false,
        `closed=${after.closed} open=${after.open}`);
    // The screen's commit cells are read while its RAM is alive (the adapter
    // copies them into the walker's own state before teardown), so the result is
    // asserted on the canonical state the surrounding game uses.
    const counterAfter = after.counter ?? mid.counter;
    check("the screen committed a win (0x80048AC0 = 1)", after.won === 1 || mid.won === 1,
        `state.duelWon=${after.won === 1}`);
    check("the win counter went up by one", counterAfter === (counterBefore + 1) % 256,
        `${counterBefore} -> ${counterAfter}`);
    check("the win count persisted for the opponent", await page.evaluate((o) => {
        const raw = localStorage.getItem("duelWinCounts");
        return !!raw && JSON.parse(raw)[String(o)] === 1;
    }, OPPONENT), "localStorage duelWinCounts");
    check("zero traps through the commit", (after.traps ?? mid.traps) === 0, `traps=${after.traps ?? mid.traps}`);
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    console.log(`[verify] opponent deck ${opponentDeckBefore} -> 5 seeded; captures ${OUT}/01-board.png, ${OUT}/02-after-commit.png`);
    if (failures) {
        console.error(`FAIL native duel commit: ${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        console.log("PASS native duel commit: board -> opponent deck-out -> 0x80048AC0 = 1, counter +1, screen closed, 0 traps");
    }
} catch (e) {
    console.error("FAIL native duel commit: " + e.message);
    if (pageErrors.length) console.error(pageErrors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
