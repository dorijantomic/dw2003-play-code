// The native Digimon Lab through the real game page: seed a party plus one
// reserve partner, open the desk, and watch what the shipped overlay draws.
//   tools/run-playwright.sh tools/probe_dri_production.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = "/tmp/opencode/dri-production";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = async (name) => {
    const d = await page.evaluate(() => {
        const st = window.__dri;
        const read = (a, size = 4) => st._host?.read?.(a, size) ?? null;
        return {
            open: st.isOpen(), pending: st._pending,
            diag: (() => { const x = st.diagnostics(); return { traps: x.host?.traps, frames: x.renderer?.frames,
                clips: x.renderer?.clips, byPack: x.renderer?.byPack, screen: x.screen, last: x.lastDiagnostic }; })(),
            party: [0, 1, 2].map((i) => read(0x80048d34 + 0x70 + i * 4)),
            recs: [0, 6].map((slot) => ({
                slot,
                owned: read(0x80049494 + slot * 0x3dc, 4),
                form: read(0x80049494 + slot * 0x3dc + 4, 4),
                level: read(0x80049494 + slot * 0x3dc + 0x24, 2),
                hp: read(0x80049494 + slot * 0x3dc + 0x28, 2),
                equipped: [0, 1, 2].map((i) => read(0x80049494 + slot * 0x3dc + 0x50 + i * 2, 2)),
                ledger0: read(0x80049494 + slot * 0x3dc + 0x58, 2),
            })),
        };
    });
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(d, null, 1) + "\n");
    await page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b)).catch(() => {});
    console.log(name, JSON.stringify(d));
    return d;
};
const press = async (key, ms = 100) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(600); };

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.rosterOwned = (1 << 0) | (1 << 6); // Kotemon + Renamon
        window.__state.party = ["p003pken", null, null];
        window.__state.digimonNames = { p003pken: "Kotemon", p009rena: "Renamon" };
        window.__state.partnerStats = {
            digimonId: 1, level: 5, xp: 0, tp: 10, hp: 30, maxHp: 40, mp: 12, maxMp: 20,
            stats: { str: 5, def: 6, spt: 7, wis: 8, spd: 9, chr: 10 },
            elemBonuses: {}, equippedForms: [9], formLedger: [
                { id: 9, formLevel: 3, dvexp: 60, techSlots: [3, 0x2000 | 5, 0x4000 | 7, 0, 0, 0x8000 | 53] },
            ],
        };
        window.__state.partyStats = [window.__state.partnerStats, null, null];
        window.__state.equipment = [{ head: 215 }, {}, {}];
        window.__state.reserveStats = {
            p009rena: { digimonId: 7, level: 3, xp: 0, tp: 4, hp: 20, maxHp: 25, mp: 8, maxMp: 10, stats: {}, elemBonuses: {} },
        };
        window.__state.reserveEquipment = { p009rena: { right: 92 } };
        window.__labOpen("dri");
    });
    await page.waitForTimeout(2500);
    await snap("1-open");
    await press("Enter");   // Select Action row 0 = Switch Digimon
    await snap("2-switch");
    await press("Enter");   // pedestal 0 -> "Switch with who"
    await snap("3-switch-with");
    await press("ArrowDown"); // the reserve candidate
    await press("Enter");     // confirm the swap
    await page.waitForTimeout(1200);
    await snap("4-after-switch");
    await press("Escape");    // back at the root: Back
    await page.waitForTimeout(2500);
    const closed = await page.evaluate(() => ({
        open: window.__dri.isOpen(),
        party: window.__state.party,
        reserveStats: Object.keys(window.__state.reserveStats ?? {}),
        reserveEquip: Object.keys(window.__state.reserveEquipment ?? {}),
        equipment: window.__state.equipment,
        charId: window.__state.charId,
    }));
    console.log("closed", JSON.stringify(closed));
    console.log("errors:", errors.length ? errors.join(" | ") : "none");
} finally {
    await browser.close();
}
