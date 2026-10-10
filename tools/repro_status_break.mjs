// Repro: STATUS page -> open a Digimon (equipment/digivolve) -> back -> back.
// Run through tools/run-playwright.sh tools/repro_status_break.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.REPRO_SHOT || "/tmp/opencode/status-break";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = async (name) => {
    const d = await page.evaluate(() => ({
        status: window.__status?.diagnostics?.() ?? null,
        menuScreen: window.__menu?.screen ?? null,
        menuOpen: window.__state?.menuOpen ?? null,
    })).catch((e) => ({ error: e.message }));
    const s = d.status?.screen ?? {};
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(d, null, 1) + "\n");
    await page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b)).catch(() => {});
    console.log(name, JSON.stringify({
        open: d.status?.open, entry: d.status?.entry, frames: d.status?.renderer?.frames,
        traps: d.status?.host?.traps, state: d.status?.host?.frames,
        child: s.child ? s.child.toString(16) : s.child, childState: s.childState,
        unk10: s.childUnk10, unk14: s.childUnk14, unk18: s.childUnk18,
        packed: d.status?.packed, errs: errors.length,
    }));
    return d;
};
const press = async (key, ms = 120) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(400); };

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", "p006rna", null];
        window.__state.digimonNames = { p003pken: "Kotemon", p006rna: "Renamon" };
        window.__state.partnerStats = {
            digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
            stats: { str: 11, def: 12, spt: 13, wis: 14, spd: 15, chr: 16 }, elemBonuses: {},
        };
        window.__state.partyStats = [
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
            null,
        ];
        window.__state.inventory = [{ id: 40, qty: 1 }];
        window.__labOpen("menu");
    });
    await page.waitForTimeout(500);
    for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
    const t0 = Date.now();
    await press("Enter", 90);
    // The page folds in before it reads the pad: wait for the picker state (0xB).
    await page.waitForFunction(() => {
        const s = window.__status?.diagnostics?.()?.screen;
        return s?.childUnk10 === 11;
    }, null, { timeout: 30000 });
    console.log("interactive after", Date.now() - t0, "ms");
    await snap("1-picker");

    await press("Enter", 90);
    await page.waitForTimeout(900);
    await snap("2-after-circle");

    await press("c", 90);
    await page.waitForTimeout(900);
    await snap("3-after-cross");

    await press("c", 90);
    await page.waitForTimeout(900);
    await snap("4-after-cross-again");

    console.log("errors:", errors.length ? errors : "none");
} catch (e) {
    console.error("probe exception:", e.message);
    console.error("errors:", errors);
} finally {
    await browser.close();
}
