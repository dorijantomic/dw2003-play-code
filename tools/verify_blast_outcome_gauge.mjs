// Playtest 2026-10-07 item 11(b) — the DV/Blast gauge must reset when the FIGHT ends
// while a Blast is still standing.
//
// Disc authority: the battle-outcome path runs the shared release `0x800A7328` on
// EVERY exit arm before the result byte is read (pro/wfightmn.s .L0x00002174, file
// 0x2174): while the acting combatant's +0x1A reservation is set it clears it and
// zeroes the gauge at `0x80042B1C + rosterKey*2 + 0x58` (wfightmn.s:1393-1421). Live
// confirmation in captures/blast-presentation-2026-07-14/README.md (blast_run3:
// "Woodmon died while Blast active -> b0 01->00, gauge->0"). The walker used to write
// the still-full gauge back at the win, so the next fight opened already charged.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_blast_outcome_gauge.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { readBattleLine } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}`;
const BASE = `${ROOT}/?skipTitle=1&map=s245&noEncounters=1`;
const OUT = process.argv[2] ?? "captures/playtest-2026-10-07-you";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line); results.push(line); if (!ok) failures++;
};

const member = (digimonId, level, hp, maxHp, mp, maxMp) => ({
    digimonId, level, xp: 0, tp: 30, hp, maxHp, mp, maxMp, dvGauge: 0,
    stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 }, bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
    for (const [k, v] of Object.entries({
        assetMode: "authentic", engineSchema: "2", digivolveDemo: "0", playerName: "Junior",
        charId: "p003pken", bits: "1000", party: JSON.stringify(["p003pken", "p009rena"]),
    })) localStorage.setItem(k, v);
    localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
    localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena]));
    localStorage.setItem("equipment", JSON.stringify([{}, {}]));
    localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10, 400, 400, 120, 120), rena: member(7, 10, 400, 400, 120, 120) });

const tap = async () => { await page.keyboard.down("Enter"); await page.waitForTimeout(90); await page.keyboard.up("Enter"); await page.waitForTimeout(60); };
const state = () => page.evaluate(() => {
    const b = window.__battleB?.() ?? null;
    return {
        state: b?.state ?? null, gauge: Math.round(b?.player?.gauge ?? 0),
        blast: b?.blast ? { active: !!b.blast.active } : null,
        storedLead: JSON.parse(localStorage.getItem("partnerStats") ?? "{}").dvGauge,
        active: !!window.__battle?.isActive?.(),
    };
});
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
        await window.__battle.start({ enemyId: 1, enemyLevel: 1, screenId: 200,
            onWin: () => {}, onFlee: () => {}, onLose: () => {} });
    });
    await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 30000 }).catch(() => {});
    await readBattleLine(page).catch(() => {});
    await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });
    await page.waitForTimeout(300);

    // Arm the Blast through the shipped trigger (the gauge is its prerequisite).
    await page.evaluate(() => { window.__battleB().player.gauge = 999; });
    await page.evaluate(() => window.__battleBlast());
    await page.waitForFunction(() => { const b = window.__battleB(); return b.blast?.active && !b.blastShow; }, null, { timeout: 15000 }).catch(() => {});
    const armed = await state();
    await shot("blast-outcome-before-armed");
    check("the Blast is standing and the gauge is charged",
        armed.blast?.active === true && armed.gauge >= 999, JSON.stringify(armed));

    // End the fight with the Blast still standing.
    await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
        if (!(await page.evaluate(() => !!window.__battle?.isActive?.()))) break;
        await tap();
        await page.waitForTimeout(350);
    }
    await shot("blast-outcome-after-win");
    const out = await state();
    check("the fight ended", out.active === false, JSON.stringify(out));
    check("the stored DV/Blast gauge was reset by the outcome", out.storedLead === 0,
        `storedLead=${out.storedLead}`);
    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
    check("run completed", false, e.message);
} finally {
    writeFileSync(`${OUT}/blast-outcome-gauge-output.txt`, results.join("\n") + "\n");
    console.log(`[blast-outcome] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
}
