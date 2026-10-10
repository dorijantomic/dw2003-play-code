// Focused production-route verifier for the native battle command menu
// (Phase 6.3 group 4 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js, starts a battle through the production entry
// (`window.__battle.start`), and drives the shipped pro/fightstg command list:
//   menu up -> Down Down -> confirm (row 2) -> back -> Up Up -> confirm (Fight)
// It asserts the overlay booted through the production host with no traps, that
// the row the overlay hands back is applied to the walker's selection, and that
// the confirm runs the walker's own command path (Fight -> PLAYER_ACT).
//
//   tools/run-playwright.sh tools/verify_native_battlecmd.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}`;
// The original-code list is the explicit research reference since Step F; the
// ordinary route is the translated list (tools/verify_translated_battlecmd.mjs).
const PLAIN = `${ROOT}/?skipTitle=1&map=s245&noEncounters=1`;
const BASE = `${PLAIN}&nativeBattleCmd=1`;
const LEGACY = `${PLAIN}&legacyBattleCmd=1`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-battlecmd-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();

const SEED = {
    partnerStats: {
        digimonId: 1, level: 12, xp: 0, tp: 30,
        hp: 60, maxHp: 60, mp: 21, maxMp: 25,
        stats: { str: 40, def: 30, spt: 25, wis: 20, spd: 30, chr: 10 },
        elemBonuses: {},
    },
    partyStats: null,
};

async function bootBattle(page, legacy = false) {
    // Seed BEFORE the game boots: the battle reads the stored partner stats.
    await page.addInitScript((seed) => {
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("partnerStats", JSON.stringify(seed.partnerStats));
        localStorage.setItem("partyStats", JSON.stringify([seed.partnerStats, null, null]));
        localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
        localStorage.setItem("bits", "1000");
        localStorage.setItem("inventory", "[]");
    }, SEED);
    await page.goto(legacy ? LEGACY : BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
        await window.__battle.start({
            enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
        });
    });
    // The opening line holds the command phase until it is read (the original arms the menu
    // from the instruction that first waits on the line's slot, `wfightmn.s:1494-1496`), so the
    // shared press reads it first. Under `legacy` the walker's own list is in play and the
    // ported list never opens, so only the phase is waited for.
    await waitForCommandMenu(page, { nativeList: !legacy });
    await page.waitForTimeout(1200); // let the overlay preload + boot
}

const read = (page) => page.evaluate(() => {
    const b = window.__battleB();
    return {
        state: b.state,
        menuSel: b.menuSel,
        message: b.message,
        notice: b.menuNotice ?? null,
        cmd: window.__battleCmdNative?.diagnostics?.() ?? null,
    };
});

// A held key press: the overlay reads the pad service each tick.
async function press(page, key, holdMs = 260) {
    await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(key);
    await page.waitForTimeout(450);
}

// ── before: the walker's own list under the rollback switch ─────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await bootBattle(page, true);
    const s = await read(page);
    check("legacy rollback keeps the walker's own list", s.cmd?.open !== true,
        `native=${JSON.stringify(s.cmd?.open)}`);
    await page.screenshot({ path: `${OUT}/before-legacy-command-list.png` });
    console.log("[verify] legacy command list captured");
    await page.close();
}

// ── after: the shipped pro/fightstg list through the real game ──────────────
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    // Resource 404s (model/audio banks the field route does not ship) are not
    // page errors; only script errors fail this check.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) {
        errors.push(`console: ${m.text()}`);
    }
});

await bootBattle(page);
// The battle boot pipeline (pro/wfightmn, tools/verify_native_wfightmn.mjs) runs
// first and owns the screen driver until it retires; the command list boots after
// it. Wait for the menu's own host before sampling the entry state.
await page.waitForFunction(
    () => window.__battleCmdNative?.diagnostics?.()?.host?.booted === true,
    null, { timeout: 20000 },
).catch(() => {});
let s = await read(page);
check("battle reaches the command phase", s.state === 2, `state=${s.state}`);
check("native command list booted", s.cmd?.host?.booted === true,
    `host=${s.cmd?.host?.module ?? "none"} pending=${s.cmd?.pending}`);
check("no traps on entry", (s.cmd?.host?.traps ?? -1) === 0, `traps=${s.cmd?.host?.traps}`);
await page.screenshot({ path: `${OUT}/01-native-command-list.png` });

// Down twice moves the overlay's highlight to row 2; confirm hands the row back.
await press(page, "ArrowDown");
await press(page, "ArrowDown");
await page.screenshot({ path: `${OUT}/02-row2-highlight.png` });
await press(page, "Enter", 320);
s = await read(page);
check("the overlay's chosen row is applied to the walker", s.menuSel === 2, `menuSel=${s.menuSel}`);
check("confirming row 2 ran the DV branch of the walker's own confirm",
    s.state === 13 || s.state === 2, `state=${s.state} notice=${s.notice}`);
check("no traps after the first confirm", (s.cmd?.host?.traps ?? -1) === 0);
await page.screenshot({ path: `${OUT}/03-dv-from-native-row.png` });

// Back to the list (DV leaves it up with the notice), then pick Fight.
if (s.state === 13) await press(page, "Escape");
await waitForCommandMenu(page);
await page.waitForTimeout(600);
await press(page, "ArrowUp");
await press(page, "ArrowUp");
// Read on the confirm frame: the walker's own confirm sets PLAYER_ACT and the
// attack message synchronously, before the action resolves into a result.
await page.keyboard.down("Enter");
await page.waitForTimeout(180);
await page.keyboard.up("Enter");
s = await read(page);
check("confirming Fight starts the walker's player action", s.state === 5,
    `state=${s.state} message=${s.message}`);
check("the attack message is the walker's own", /attacks!/.test(String(s.message ?? "")),
    `message=${s.message}`);
await page.waitForTimeout(1200);
s = await read(page);
check("no traps through the whole route", (s.cmd?.traps ?? -1) === 0,
    `traps=${s.cmd?.traps}`);
await page.screenshot({ path: `${OUT}/04-fight-committed.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
check("the overlay's own traps stayed at zero", (s.cmd?.traps ?? -1) === 0,
    `traps=${s.cmd?.traps}`);
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
