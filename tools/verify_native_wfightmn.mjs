// Focused production-route verifier for the battle boot pipeline (pro/wfightmn,
// Phase 6.3 group 4 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// pro/wfightmn is a data overlay: its manifest root is the battle SETUP/asset
// machine F0x800A5ECC, which requests the battle's scene banks, waits for each
// through the cache service, deactivates them, requests the eight text banks and
// retires (SET_STATE 3). It draws nothing, so there is no capture to compare —
// the proof is that the pipeline runs, its bank requests reach the resident
// cache, and it retires cleanly while a real battle starts.
//
//   tools/run-playwright.sh tools/verify_native_wfightmn.mjs [outdir]
//
// The ordinary route now runs the translated loader (tools/verify_translated_wfight.mjs);
// this verifier keeps the original-code loader as the research reference, so it opens
// the battle with `?nativeWfight=1`.
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-wfightmn-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

/** The banks the loader's own pipeline requests (wfightmn-overlay-map §machine 1). */
const LOADER_BANKS = [1110, 1950, 1966, 2017, 2019, 646, 1109, 0x286];

const browser = await chromium.launch();

const SEED = `
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify({ digimonId: 1, level: 12, xp: 0, tp: 30, hp: 60, maxHp: 60, mp: 21, maxMp: 25, stats: { str: 40, def: 30, spt: 25, wis: 20, spd: 30, chr: 10 }, elemBonuses: {} }));
  localStorage.setItem("partyStats", JSON.stringify([null, null, null]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
`;

async function startBattle(page) {
    await page.addInitScript(SEED);
    await page.goto(`${ROOT}/?skipTitle=1&map=s245&noEncounters=1&nativeWfight=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
        await window.__battle.start({
            enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
        });
    });
    // The opening line holds the command phase until it is read (the original arms the menu
    // from the instruction that first waits on the line's slot, `wfightmn.s:1494-1496`), so the
    // shared press reads it first.
    await waitForCommandMenu(page);
}

// ── before: the rollback switch skips the pipeline ──────────────────────────
{
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    await page.addInitScript(SEED);
    await page.goto(`${ROOT}/?skipTitle=1&map=s245&noEncounters=1&legacyWfight=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await page.waitForTimeout(400);
    await page.evaluate(async () => {
        await window.__battle.start({
            enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
        });
    });
    // Under `legacyWfight=1` the boot pipeline is skipped, so the ported list never boots and
    // only the phase itself is waited for.
    await waitForCommandMenu(page, { nativeList: false });
    const off = await page.evaluate(() => window.__battleWfightmn?.diagnostics?.() ?? null);
    check("legacyWfight=1 skips the boot pipeline", off === null || off.done === false || off.framesAlive === 0,
        `diag=${JSON.stringify(off)}`);
    console.log("[verify] rollback switch observed");
    await page.close();
}

// ── after: the ordinary battle runs the shipped pipeline ────────────────────
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});

await startBattle(page);
// The loader retires within a few dozen frames; sample until it reports done.
await page.waitForFunction(() => window.__battleWfightmn?.isDone?.() === true, null, { timeout: 20000 })
    .catch(() => {});
const d = await page.evaluate(() => window.__battleWfightmn?.diagnostics?.() ?? null);
check("the battle boot pipeline ran from an ordinary battle", (d?.framesAlive ?? 0) > 0,
    `framesAlive=${d?.framesAlive}`);
check("the original pro/wfightmn loader is the pipeline", d?.host === null || d?.host?.module === "pro/wfightmn",
    `host=${d?.host?.module ?? "retired"}`);
check("it retired by itself (SET_STATE 3)", d?.done === true || d?.open === false, `done=${d?.done} open=${d?.open}`);
check("no traps through the pipeline", (d?.traps ?? -1) === 0, `traps=${d?.traps}`);
const served = (d?.bankIds ?? []).filter((id) => LOADER_BANKS.includes(id));
check("its bank requests reached the resident cache", served.length > 0,
    `cache ids seen=${JSON.stringify(d?.bankIds)} served=${JSON.stringify(served)}`);

// The battle must still reach its command phase (the pipeline released the slot).
await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 20000 }).catch(() => {});
const st = await page.evaluate(() => ({
    state: window.__battleB?.()?.state,
    cmd: window.__battleCmdNative?.diagnostics?.()?.execution ?? null,
}));
check("the battle still reaches its command phase after the pipeline", st.state === 2, `state=${st.state}`);
check("the (translated) command list still opens afterwards", st.cmd === "translated", `execution=${st.cmd}`);

await page.screenshot({ path: `${OUT}/01-battle-with-pipeline.png` });
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
