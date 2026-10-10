// Phase 3/4 producer->screen proof: the host save-context seed reaches the native
// gym and fight-report screens. The original reads the party context at
// 0x80048D34 (party map ctx+0x70, roster records 0x80049494 + slot*0x3DC); this
// seeds it through window.__nativeScreenSeedParty and asserts the screen's own
// text widgets then draw the seeded numbers. Offsets:
// docs/research/battle/digimon-cur-stats-helpers.md.
//
// Run: .opencode/autonomy/check-browser tools/verify_native_screen_party_seed.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-party-seed";
mkdirSync(OUT, { recursive: true });
const SEED = {
    positions: [0, 1, 2],
    stats: [
        { slot: 0, level: 12, tp: 30, hp: 45, maxHp: 60, mp: 20, maxMp: 25, exp: 3456 },
        { slot: 1, level: 7, tp: 11, hp: 33, maxHp: 44, mp: 12, maxMp: 18, exp: 999 },
        { slot: 2, level: 3, tp: 4, hp: 22, maxHp: 30, mp: 8, maxMp: 9, exp: 55 },
    ],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

async function texts(module) {
    await page.evaluate((m) => window.__nativeScreenBoot(m), module);
    await page.evaluate((s) => window.__nativeScreenSeedParty(s), SEED);
    await page.waitForFunction((m) => { const s = window.__nativeScreen(); return s.module === m && s.booted && s.frames >= 45; }, module, { timeout: 10000 });
    const state = await page.evaluate(() => window.__nativeScreen());
    const dump = await page.evaluate(() => window.__nativeScreenTextDump());
    const out = [];
    for (const w of dump) for (let i = 0; i < w.decoded.length; i++) {
        const t = w.decoded[i]?.text;
        if (t && t.length) out.push(t);
    }
    await page.screenshot({ path: `${OUT}/${module.replace("/", "_")}.png` });
    return { state, texts: out };
}

try {
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector('button[data-scr="nativescreen"]', { timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/, { timeout: 10000 });
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });

    const problems = [];
    const gym = await texts("pro/stgtrain");
    for (const want of ["12", "45", "60", "20", "25", "30"]) {
        if (!gym.texts.includes(want)) problems.push(`gym missing seeded value ${want} (${gym.texts.join("|")})`);
    }
    if (gym.state.traps !== 0) problems.push(`gym traps=${gym.state.traps}`);

    const report = await texts("pro/stfgtrep");
    for (const want of ["12", "3456", "7", "999", "3", "55"]) {
        if (!report.texts.includes(want)) problems.push(`report missing seeded value ${want} (${report.texts.join("|")})`);
    }
    if (report.state.traps !== 0) problems.push(`report traps=${report.state.traps}`);

    writeFileSync(`${OUT}/party-seed.json`, JSON.stringify({ seed: SEED, gym, report, errors }, null, 1) + "\n");
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native party seed:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(`PASS native party seed: gym drew 12/45/60/20/25/30, report drew 12/3456/7/999/3/55, 0 traps; shots ${OUT}/`);
    }
} finally {
    await browser.close();
}
