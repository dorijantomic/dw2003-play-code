// Focused production-route verifier for the native training gym (Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js, opens the gym through the lab entry point, and
// drives the shipped pro/stgtrain overlay with real key events:
//   pod select -> partner -> drill -> TP amount -> confirm -> session -> result
//   -> leave (Triangle)
// It asserts the RAM contract (group cell, seeded roster records), the readback
// into walker state (trained stats + spent TP) and a clean return to the field.
// A second page with ?legacyGym=1 captures the old hand-authored screen as the
// "before" side of the acceptance pair.
//
//   tools/run-playwright.sh tools/verify_native_gym.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

// `nativeGym=1` is the reference route this verifier is written for: the shipped
// pro/stgtrain overlay behind web/gym-native.js. Without it game.js hands out
// the TRANSLATED gym (web/gym-translated.js, covered by
// tools/verify_translated_gym.mjs) and `__gym._host` — the overlay's own RAM
// bridge — does not exist. GYM_NATIVE_BASE overrides the whole URL.
const BASE = process.env.GYM_NATIVE_BASE
    || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeGym=1`;
const LEGACY = `${BASE}&legacyGym=1`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-gym-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();

async function openGym(page) {
    await page.evaluate(() => {
        // A single partner with known numbers; the second pedestal empty.
        window.__state.bits = 5000;
        window.__state.party = ["p003pken"];
        window.__state.partnerStats = {
            digimonId: 1, level: 12, xp: 0, tp: 30,
            hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            stats: { str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16 },
            elemBonuses: {},
        };
        window.__state.partyStats = [null];
        window.__state.inventory = [{ id: 40, qty: 1 }]; // SilverID -> a known rank group
        window.__labOpen("gym");
    });
    await page.waitForTimeout(2500);
}

async function gymState(page) {
    return page.evaluate(() => ({
        open: window.__gym.isOpen(),
        diag: window.__gym.diagnostics?.() ?? null,
        tp: window.__state.partnerStats?.tp,
        hp: window.__state.partnerStats?.hp,
        maxHp: window.__state.partnerStats?.maxHp,
        str: window.__state.partnerStats?.stats?.str,
        level: window.__state.partnerStats?.level,
    }));
}

// ── before: the hand-authored screen at the same spot ───────────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(LEGACY, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
    await openGym(page);
    await page.screenshot({ path: `${OUT}/before-legacy-gym.png` });
    console.log("[verify] legacy gym captured");
    await page.close();
}

// ── after: the native route through the real game ───────────────────────────
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

async function press(key, waitMs = 600) {
    await page.keyboard.down(key);
    await page.waitForTimeout(70);
    await page.keyboard.up(key);
    await page.waitForTimeout(waitMs);
}

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, { timeout: 60000 });
console.log("[verify] game booted");
await openGym(page);

let s = await gymState(page);
check("gym opens through game.js", s.open === true);
check("native root booted", s.diag?.host?.booted === true, `module=${s.diag?.host?.module}`);
check("no traps on entry", (s.diag?.host?.traps ?? -1) === 0);
check("renderer drew clips without dropping any",
    (s.diag?.renderer?.clips ?? 0) > 0 && (s.diag?.renderer?.skipped ?? -1) === 0,
    `clips=${s.diag?.renderer?.clips} skipped=${s.diag?.renderer?.skipped}`);

// The seed reached RAM: the HUD reads the record, so the record must match.
const seeded = await page.evaluate(() => {
    const read = (a, n) => window.__gym._host.read(a, n);
    const rec = 0x80049494;
    return {
        group: read(0x8004b404, 4),
        level: read(rec + 0x24, 2),
        tp: read(rec + 0x26, 2),
        hp: read(rec + 0x28, 2),
        maxHp: read(rec + 0x2a, 2),
        core0: read(rec + 0x30, 2),
        core5: read(rec + 0x3a, 2),
        pos0: read(0x80048d34 + 0x70, 4),
        pos1: read(0x80048d34 + 0x74, 4),
    };
});
check("group cell seeded for the greeter rank", seeded.group >= 0, `group=${seeded.group}`);
check("roster record carries the party (LV 12 / TP 30 / HP 45/50)",
    seeded.level === 12 && seeded.tp === 30 && seeded.hp === 45 && seeded.maxHp === 50,
    JSON.stringify(seeded));
check("core block seeded (STR 11 .. CHR 16)",
    seeded.core0 === 11 && seeded.core5 === 16, `core0=${seeded.core0} core5=${seeded.core5}`);
check("party map seeded, empty pedestal is -1",
    seeded.pos0 === 0 && seeded.pos1 === 0xffffffff, `pos0=${seeded.pos0} pos1=${seeded.pos1}`);
await page.screenshot({ path: `${OUT}/01-pod-select.png` });

// pod select -> partner -> drill list
await press("Enter", 1200);
await page.screenshot({ path: `${OUT}/02-drill-list.png` });
// The drill list's per-drill icons come from STTRNG0. Without that pack pinned
// in the manifest's packs map the renderer drops every icon draw and the list
// is an empty box (the 2026-09-21 regression), so assert the pack is in use.
const artPacks = await page.evaluate(() => ({ ...window.__gym._host.renderer.stats.byPack }));
check("drill list draws the per-drill icon sheet", (artPacks.sttrng0 ?? 0) > 0, JSON.stringify(artPacks));
// drill -> TP amount -> confirm -> session
await press("Enter", 1200);
await page.screenshot({ path: `${OUT}/03-tp-amount.png` });
await press("Enter", 1200);
await page.screenshot({ path: `${OUT}/04-confirm.png` });
await press("Enter", 1200); // Yes -> the session runs
await page.screenshot({ path: `${OUT}/05-session.png` });
// The screen charges the TP as the session starts (the record, not the walker:
// the copy back happens on close).
const spent = await page.evaluate(() => window.__gym._host?.read(0x80049494 + 0x26, 2));
check("session charged the roster record's TP (30 -> 29)", spent === 29, `record TP=${spent}`);

// ── the result path ─────────────────────────────────────────────────────────
// The session ends in the result panel (F0x80088070 / F0x8008706C) whose
// message window (F0x800897B8) waits for its local message widgets to report
// "finished typing". The host serves that poll (web/gym-native.js
// seedHostServed) because the screen's message registry is empty in this host,
// so the window advances, writes the result text (rendered from the resident
// text widgets) and rolls the stat through F0x800866CC.
const objs = () => page.evaluate(() => {
    const rt = window.__gym._host?.rt;
    return (rt?.world?.objects ?? []).map((o) => ({ cb: o.cb >>> 0, life: rt.mem.read32(o.addr + 0xc) >>> 0 }));
});
const recordStr = () => page.evaluate(() => window.__gym._host?.read(0x80049494 + 0x30, 2));
const rootState = () => page.evaluate(() => {
    const rt = window.__gym._host?.rt;
    const o = rt?.world?.objects?.[0];
    return o ? rt.mem.read32(o.addr + 0x10) >>> 0 : null;
});

// The workout plays first: the result panel object is created early, but the
// roll only lands when the host-held message gate opens at the win pose
// (~14 s: intro + three reps with the TRANIN script durations). Wait for the
// roll, which is the real end of the session.
let strAfter = await recordStr();
for (let i = 0; i < 60 && !(strAfter > 11); i++) {
    await page.waitForTimeout(500);
    strAfter = await recordStr();
}
await page.screenshot({ path: `${OUT}/06-result.png` });
check("the workout plays before the result (roll waits for the animation)", strAfter > 11,
    `record STR=${strAfter}`);
check("result panel is up", (await objs()).some((o) => o.cb === 0x80087f28));
// The per-rep feedback row (ring on a hit, X on a miss) is host-drawn; every rep
// must have shown its marker by the time the roll lands.
const marks = await page.evaluate(() => {
    const s = window.__gym.diagnostics().scene;
    return { shown: s.shown, reps: s.reps, results: s.results };
});
check("every rep showed its marker during the workout",
    marks.shown === marks.results.length && marks.shown > 0, JSON.stringify(marks));

check("result rolls the trained stat on the record (STR 11 -> higher)", strAfter > 11, `record STR=${strAfter}`);

let dismissed = false;
for (let i = 0; i < 8 && !dismissed; i++) {
    await press("Enter", 900);
    dismissed = (await rootState()) === 5; // back at pod select
}
await page.screenshot({ path: `${OUT}/07-back-to-pod-select.png` });
check("result panel clears and the pod select returns", dismissed, `root+0x10=0x${(await rootState()).toString(16)}`);

// ── leave the gym: Cross at pod select (0x4000) ─────────────────────────────
// 0x4000 is logical button 0x0E in the original's flow machine
// (exe-decomp/stgtrain_c/F0x8008517c.c:126) and the keyboard reaches it with
// Escape or x (engine/systems/input-map.ts:234). `c` reached it before 173ebcf0
// and has been on the confirm bit since.
const walkerBefore = await page.evaluate(() => window.__state.partnerStats?.stats?.str ?? null);
let closed = false;
for (let i = 0; i < 10 && !closed; i++) {
    await press("Escape", 900);
    closed = await page.evaluate(() => window.__gym.isOpen() !== true);
}
await page.screenshot({ path: `${OUT}/08-back-to-field.png` });
check("Cross at pod select closes the gym", closed);

const committed = await page.evaluate(() => window.__state.partnerStats?.stats?.str ?? null);
check("the trained stat reaches walker state on close", committed !== null && committed > (walkerBefore ?? 0),
    `walker STR=${committed} (record STR=${strAfter})`);
check("no page errors during the route", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(failures === 0
    ? "\nverify_native_gym: OK (pod select -> drill -> TP -> session -> result -> stat -> leave)"
    : `\nverify_native_gym: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
