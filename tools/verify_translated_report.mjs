// Browser proof for the translated fight report (pro/stfgtrep), Step F of
// docs/plans/2026-09-28-translated-game-completion-plan.md.
//
// The screen after a won battle: one row per partner with the EXP count-up, the
// level-up, a newly unlocked form, the BIT payout and the item drop. Three runs
// through the real web/game.js and web/battle.js, each winning a real battle:
//   1. reference: `?nativeReport=1`, the original code through the MIPS
//      interpreter (the "before"). It needs the executable files under
//      assets/native/**.
//   2. ordinary route, no flags, every assets/native/** request denied FROM PAGE
//      LOAD. The translated FightReportSession must run the whole screen: the
//      count-up, the level-up page, the unlock page, the BIT page and the item
//      page, with the same message pages as the reference, then close.
//   3. rollback: `?legacyReport=1` shows the walker's hand-made inline report.
//
// The state check is the point of the authority decision (see
// web/fightreport-translated.js): the walker applies EXP and levels ONCE, before
// the screen opens; the screen replays the disc's rules on a private record and
// pays only the BIT and the item. So after the screen closes the walker's EXP,
// level and TP moved by exactly one battle's reward (not two), the private record
// the screen computed equals it, the BIT and the item were paid once, and the
// reference route left the walker in the same state.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_translated_report.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/step-f-translated-report-2026-09-30";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    results.push(line);
    if (!ok) failures++;
};

// Battle screen 5 = 2x Numemon lv27; its reward record is [dvexp 27, exp 268, bits 645].
const SCREEN = 5;
const START_BITS = 4321;
const progression = JSON.parse(readFileSync("web/assets/data/progression.json", "utf8"));
const digimon = JSON.parse(readFileSync("web/assets/data/digimon.json", "utf8")).digimon;
const [REWARD_DVEXP, REWARD_EXP, REWARD_BITS] = progression.battle_rewards[SCREEN];
const LU = progression.level_up;
const KOTEMON = digimon.find((d) => d.id === 1);
/** Total EXP that must be exceeded to reach `level` (web/battle.js levelUpThreshold). */
const threshold = (level) => {
    const tier = LU.exp_tier_bounds.findIndex((b) => level < b);
    return Math.floor(KOTEMON.growth_xp * (level ** 3 + 5 * level - 6) / 10) + LU.exp_tier_const[tier < 0 ? 3 : tier];
};
// A rookie lead, level 20, 100 EXP short of level 21: this battle's share crosses exactly one level.
const START_LEVEL = 20;
const START_XP = threshold(START_LEVEL + 1) - 100;
const LEAD = {
    digimonId: 1, level: START_LEVEL, xp: START_XP, tp: 10, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
    stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 }, bonuses: {}, elemBonuses: {},
};
const FINAL_XP = START_XP + REWARD_EXP;
const oneLevel = START_XP + 1 > threshold(START_LEVEL) && FINAL_XP > threshold(START_LEVEL + 1) && FINAL_XP <= threshold(START_LEVEL + 2);
check("scenario: the battle's EXP crosses exactly one level", oneLevel,
    `xp ${START_XP} -> ${FINAL_XP}, thresholds ${threshold(START_LEVEL + 1)} / ${threshold(START_LEVEL + 2)}`);

const ONLY = process.env.VERIFY_ONLY ?? "";
const want = (name) => ONLY === "" || ONLY.split(",").includes(name);
const browser = await chromium.launch();

async function openPage({ query = "", denyNative = false }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const net = { denied: [], allowed: [], data: [] };
    await page.route("**/assets/native/**", (route) => {
        if (denyNative) { net.denied.push(route.request().url()); return route.abort(); }
        net.allowed.push(route.request().url());
        return route.continue();
    });
    page.on("request", (req) => { if (/assets\/data\/(report\/|wizard\/|shop-banks\/|pause\/|shop_font)/.test(req.url())) net.data.push(req.url()); });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await page.addInitScript((seed) => {
        localStorage.setItem("assetMode", "authentic");
        localStorage.setItem("engineSchema", "2");
        localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken");
        localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
        localStorage.setItem("partyStats", JSON.stringify([seed.lead]));
        localStorage.setItem("equipment", JSON.stringify([{}]));
        localStorage.setItem("rosterOwned", "1");
        localStorage.setItem("bits", String(seed.bits));
        localStorage.setItem("inventory", "[]");
    }, { lead: LEAD, bits: START_BITS });
    await page.goto(`${BASE}${query}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started && window.__battle?.isActive, null, { timeout: 60000 });
    return { page, net, errors };
}

const hold = async (page, key, ms = 140) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(90);
};

/** Start the battle, force one item drop, and win it with the ordinary FIGHT command. */
async function winBattle(page) {
    await page.evaluate(async (screen) => { await window.__battle.startScreen(screen, null, null, null, { mapId: "s245" }); }, SCREEN);
    await page.waitForFunction(() => !!window.__battleB?.(), null, { timeout: 30000 });
    await page.waitForTimeout(600);
    const dropped = await page.evaluate(() => {
        const item = Object.values(window.__ITEM_BY_NAME).find((i) => i.id === 1);
        window.__dropInfo = item;
        return item;
    });
    // The walker's own record before this battle's rewards (the truth the report must agree with).
    const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__state.partnerStats)));
    await page.evaluate(() => { window.__gameSpeed = 4; });
    for (let guard = 0; guard < 160; guard++) {
        const phase = await page.evaluate(() => {
            const b = window.__battleB?.();
            if (!b) return "gone";
            if (b._loot && !b._loot.drops.length) b._loot.drops = [window.__dropInfo.name];
            if (b.state === 2 && b.enemy) b.enemy.hp = 1;
            return b._victoryPhase ?? b.state;
        });
        if (phase === "report" || phase === "gone") break;
        await hold(page, "Enter", 200);
    }
    await page.evaluate(() => { window.__gameSpeed = 1; });
    return { dropped, before };
}

/** A per-frame sampler of the report: the EXP shown, the row state and every distinct text set. */
async function installSampler(page) {
    await page.evaluate(async () => {
        const { drawNativeTextWidgets } = await import("/native-screen-text.js");
        const samples = { shown: [], texts: [], steps: [], seen: {} };
        window.__repSamples = samples;
        const decode = (widgets) => drawNativeTextWidgets({ drawImage() {} }, widgets.filter((w) => w.visible)).texts ?? [];
        const loop = () => {
            const r = window.__reportNative;
            if (r?.isOpen?.()) {
                const d = r.diagnostics();
                const widgets = r.textWidgets ? r.textWidgets() : (window.__nativeTextWidgets?.() ?? []);
                const texts = decode(widgets);
                const key = texts.join("|");
                if (samples.texts.length === 0 || samples.texts[samples.texts.length - 1] !== key) samples.texts.push(key);
                const shown = d.rows?.[0]?.shown;
                if (shown !== undefined && shown !== samples.shown[samples.shown.length - 1]) samples.shown.push(shown);
                const step = d.state?.step;
                if (step !== undefined && step !== samples.steps[samples.steps.length - 1]) samples.steps.push(step);
                const joined = key;
                for (const [name, re] of [["rows", /Kotemon\|LV/], ["levelup", /Level 21!/], ["unlock", /Digivolve learned/],
                    ["bits", /BIT gained/], ["item", /Balanced Pack/]]) {
                    if (re.test(joined)) samples.seen[name] = true;
                }
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    });
}

/** Drive the report with Confirm, capturing one picture per page type the first time it appears. */
async function walkReport(page, prefix) {
    const shots = [];
    const captured = new Set();
    let pressed = 0;
    const started = Date.now();
    while (Date.now() - started < 45000) {
        const info = await page.evaluate(() => ({
            open: window.__reportNative?.isOpen?.() ?? false, seen: { ...window.__repSamples.seen },
            shown: window.__repSamples.shown.slice(-1)[0] ?? null, target: window.__reportNative?.diagnostics?.()?.rows?.[0]?.target ?? null,
        }));
        if (!info.open) break;
        for (const name of Object.keys(info.seen)) {
            if (captured.has(name)) continue;
            captured.add(name);
            if (name !== "rows") await page.waitForTimeout(450); // let the typewriter finish the page
            const file = `${prefix}-${String(shots.length + 1).padStart(2, "0")}-${name}.png`;
            await page.screenshot({ path: `${OUT}/${file}` });
            shots.push(file);
        }
        // Confirm only turns message pages (and skips a typewriter); the count-up runs on its own.
        if (info.seen.rows) {
            await hold(page, "Enter", 130);
            pressed++;
        } else {
            await page.waitForTimeout(40);
        }
    }
    return { shots, pressed, captured: [...captured] };
}

const walkerState = (page) => page.evaluate(() => ({
    xp: window.__state.partnerStats.xp, level: window.__state.partnerStats.level, tp: window.__state.partnerStats.tp,
    bits: window.__state.bits, inventory: JSON.parse(JSON.stringify(window.__state.inventory)),
    ls: { bits: Number(localStorage.getItem("bits")), inventory: JSON.parse(localStorage.getItem("inventory") ?? "[]") },
    battleActive: !!window.__battle?.isActive?.(),
}));

/** Ordered message pages (texts with a line break) the screen showed. */
const messagePages = (samples) => {
    const seen = [];
    for (const key of samples.texts) {
        for (const text of key.split("|")) {
            if (text.includes("\n") && !seen.includes(text)) seen.push(text);
        }
    }
    return seen;
};

const expected = {
    xp: FINAL_XP, level: START_LEVEL + 1, tp: LEAD.tp + LU.tp_per_level, bits: START_BITS + REWARD_BITS,
};

// ── 1. before: the original code through the interpreter ───────────────────
let reference = null;
if (want("reference")) {
    const { page, net, errors } = await openPage({ query: "&nativeReport=1" });
    await installSampler(page);
    const { dropped } = await winBattle(page);
    await page.waitForFunction(() => window.__reportNative?.isOpen() === true, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__repSamples?.seen?.rows === true, null, { timeout: 20000 });
    const diag = await page.evaluate(() => window.__reportNative.diagnostics());
    const walked = await walkReport(page, "before");
    await page.waitForFunction(() => window.__reportNative?.isOpen() === false, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(900);
    const samples = await page.evaluate(() => window.__repSamples);
    const state = await walkerState(page);
    reference = { diag, walked, samples, state, pages: messagePages(samples), dropped };
    check("reference: the original-code screen ran (interpreter)", diag.host?.module === "pro/stfgtrep" && diag.execution === undefined,
        `module=${diag.host?.module}`);
    check("reference: it needed executable assets", net.allowed.length > 0, `${net.allowed.length} requests`);
    check("reference: it reached every page type", ["rows", "levelup", "unlock", "bits", "item"].every((n) => walked.captured.includes(n)),
        walked.captured.join(","));
    check("reference: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
}

// ── 2. the ordinary route, every executable asset denied from page load ─────
let translated = null;
if (want("ordinary")) {
    const { page, net, errors } = await openPage({ denyNative: true });
    await installSampler(page);
    const { before } = await winBattle(page);
    await page.waitForFunction(() => window.__reportNative?.isOpen() === true, null, { timeout: 20000 });
    const opened = await page.evaluate(() => window.__reportNative.diagnostics());
    check("ordinary: the screen is the translated session", opened.execution === "translated" && opened.host === null,
        `execution=${opened.execution} host=${opened.host}`);
    const walked = await walkReport(page, "after");
    await page.waitForFunction(() => window.__reportNative?.isOpen() === false, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(900);
    const finalDiag = await page.evaluate(() => window.__reportNative.diagnostics());
    const samples = await page.evaluate(() => window.__repSamples);
    const state = await walkerState(page);
    translated = { walked, samples, state, pages: messagePages(samples) };
    writeFileSync(`${OUT}/translated-diagnostics.json`, JSON.stringify({
        diagnostics: { ...finalDiag, summary: finalDiag.summary }, samples: { shown: samples.shown, steps: samples.steps }, pages: translated.pages,
        state, reference: reference ? { pages: reference.pages, state: reference.state } : null,
    }, null, 2) + "\n");

    check("ordinary: it ran, finished by itself and did not fail", finalDiag.failed === false && finalDiag.summary?.finished === true && finalDiag.ticks > 30,
        `failed=${finalDiag.failed} finished=${finalDiag.summary?.finished} ticks=${finalDiag.ticks} error=${finalDiag.error}`);
    check("ordinary: it reached every page type", ["rows", "levelup", "unlock", "bits", "item"].every((n) => walked.captured.includes(n)),
        walked.captured.join(","));
    if (reference) check("ordinary: its message pages are the reference's, in order",
        JSON.stringify(translated.pages) === JSON.stringify(reference.pages),
        `translated=${JSON.stringify(translated.pages)} reference=${JSON.stringify(reference.pages)}`);
    else console.log("pages", JSON.stringify(translated.pages));
    // The count-up is the disc's digit roll: every frame adds a repunit (1111 for a four-digit
    // total) modulo the digit count, ten steps, then snaps to the total.
    const shown = samples.shown;
    const spin = shown.filter((v) => v !== START_XP && v !== FINAL_XP);
    const repunit = 1111;
    const steps = spin.slice(1).map((v, i) => ((v - spin[i] + 10000) % 10000));
    check("ordinary: the EXP counts up from the pre-battle total, rolls its digits and lands on the reward",
        shown[0] === START_XP && shown[shown.length - 1] === FINAL_XP && spin.length >= 3 &&
        steps.every((d) => d % repunit === 0),
        `shown ${shown.slice(0, 7).join(",")}...${shown.slice(-2).join(",")} (${spin.length} rolling, steps ${steps.join(",")})`);
    const rec = finalDiag.summary?.records?.[0];
    check("ordinary: the screen's private record reached the level-up", rec?.level === expected.level && rec?.exp === expected.xp,
        `level=${rec?.level} exp=${rec?.exp}`);
    check("ordinary: the fold, level-up and count-up cues played",
        [0x40019, 0x4000b, 0x4001a].every((id) => finalDiag.summary?.sounds?.includes(id)),
        (finalDiag.summary?.sounds ?? []).map((id) => id.toString(16)).join(","));
    check("ordinary: the boot task set the display up (320x240, view kind 3 at 0x1000)",
        JSON.stringify(finalDiag.summary?.displayCalls?.slice(0, 2)) === JSON.stringify([
            { call: "displayReset", args: [] }, { call: "displayPacketSize", args: [0x14000] }]) &&
        finalDiag.summary.displayCalls.some((c) => c.call === "displayView" && c.args.join() === [0, 0, 320, 240, 3, 0x1000].join()),
        JSON.stringify(finalDiag.summary?.displayCalls));
    check("ordinary: it asked for the three text banks", JSON.stringify(finalDiag.summary?.loadedBanks) === JSON.stringify([0x57, 0x50, 0x6c]),
        JSON.stringify(finalDiag.summary?.loadedBanks));
    check("ordinary: the screen-return request was issued", JSON.stringify(finalDiag.summary?.transition) === "[0,0]",
        JSON.stringify(finalDiag.summary?.transition));

    // The authority decision: the walker changed exactly once, and agrees with the screen.
    check("state: EXP moved by exactly one battle's reward", state.xp === expected.xp && before.xp === START_XP,
        `xp ${before.xp} -> ${state.xp} (want ${expected.xp})`);
    check("state: the level and TP are the level-up's, applied once", state.level === expected.level && state.tp === expected.tp,
        `level ${state.level} (want ${expected.level}) tp ${state.tp} (want ${expected.tp})`);
    check("state: the walker and the screen's private record agree on EXP, level and TP",
        rec?.exp === state.xp && rec?.level === state.level && rec?.tp === state.tp,
        `screen ${rec?.exp}/${rec?.level}/${rec?.tp} walker ${state.xp}/${state.level}/${state.tp}`);
    check("state: the BIT was paid once by the screen", state.bits === expected.bits && state.ls.bits === expected.bits,
        `bits ${START_BITS} -> ${state.bits} (want ${expected.bits}) localStorage=${state.ls.bits}`);
    check("state: the dropped item was paid once",
        JSON.stringify(state.inventory) === JSON.stringify([{ id: 1, qty: 1 }]) && JSON.stringify(state.ls.inventory) === JSON.stringify([{ id: 1, qty: 1 }]),
        JSON.stringify(state.inventory));
    check("state: the battle ended and the field returned", state.battleActive === false, `active=${state.battleActive}`);
    if (reference) check("state: the reference route left the walker in the same state",
        JSON.stringify({ xp: reference.state.xp, level: reference.state.level, tp: reference.state.tp, bits: reference.state.bits, inventory: reference.state.inventory }) ===
        JSON.stringify({ xp: state.xp, level: state.level, tp: state.tp, bits: state.bits, inventory: state.inventory }),
        `reference ${JSON.stringify(reference.state)}`);
    check("ordinary: its data came from assets/data", net.data.length >= 8, `${net.data.length} requests`);
    check("ordinary: zero executable asset requests from page load", net.denied.length === 0 && net.allowed.length === 0,
        `denied=${net.denied.length}: ${net.denied.slice(0, 2).join(", ")}`);
    check("ordinary: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

// ── 3. rollback: the hand-made inline report, still one payout ─────────────
if (want("rollback")) {
    const { page, net, errors } = await openPage({ query: "&legacyReport=1", denyNative: true });
    await winBattle(page);
    await page.waitForTimeout(600);
    const during = await page.evaluate(() => ({ open: window.__reportNative?.isOpen?.() ?? null, phase: window.__battleB?.()?._victoryPhase ?? null }));
    check("rollback: the translated screen never opened", during.open === false, JSON.stringify(during));
    // Each inline page waits 1.35 s after it appears before Confirm turns it.
    for (let i = 0; i < 90 && (await page.evaluate(() => !!window.__battle?.isActive?.())); i++) { await hold(page, "Enter", 160); await page.waitForTimeout(140); }
    await page.waitForTimeout(700);
    const state = await walkerState(page);
    check("rollback: the inline report finished, EXP, BIT and the item were paid once",
        state.battleActive === false && state.xp === expected.xp && state.level === expected.level && state.bits === expected.bits &&
        JSON.stringify(state.inventory) === JSON.stringify([{ id: 1, qty: 1 }]),
        JSON.stringify(state));
    check("rollback: zero executable asset requests", net.denied.length === 0 && net.allowed.length === 0, `denied=${net.denied.length}`);
    check("rollback: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
