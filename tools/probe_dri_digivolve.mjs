// Drive the native lab's Digivolve submenu with real keys: picker -> Select
// Action -> Change digivolve type grid -> pick a form -> confirm, and watch the
// roster record's equipped triple and current form.
//   tools/run-playwright.sh tools/probe_dri_digivolve.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = "/tmp/opencode/dri-digivolve";
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
        const root = st.diagnostics()?.screen?.root ?? 0;
        const aux = root ? read(root + 0x24) : 0;
        const child = aux ? read(aux + 4) : 0;
        return {
            open: st.isOpen(),
            rootLife: root ? read(root + 0xc) : null,
            auxChild: child,
            childCb: child ? read(child + 0x48).toString(16) : null,
            childState: child ? read(child + 0x10) : null,
            frames: st.diagnostics()?.renderer?.frames,
            traps: st.diagnostics()?.host?.traps,
            rec0: {
                form: read(0x80049494 + 4, 4),
                equipped: [0, 1, 2].map((i) => read(0x80049494 + 0x50 + i * 2, 2)),
                ledger: [0, 1, 2, 3, 4].map((i) => read(0x80049494 + 0x58 + i * 0x14, 2)),
                techs0: [0, 1, 2, 3, 4, 5].map((i) => read(0x80049494 + 0x58 + 0x08 + i * 2, 2)),
            },
            walker: { digimonId: window.__state.partnerStats?.digimonId,
                equippedForms: window.__state.partnerStats?.equippedForms,
                ledger: (window.__state.partnerStats?.formLedger ?? []).map((r) => r.id) },
        };
    });
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(d, null, 1) + "\n");
    await page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b)).catch(() => {});
    console.log(name, JSON.stringify(d));
    return d;
};
const press = async (key, ms = 100) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(800); };

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        const s = window.__state;
        s.rosterOwned = 0xff;
        s.party = ["p003pken", "p009rena", "p004kogu"];
        s.digimonNames = { p003pken: "Kotemon", p009rena: "Renamon", p004kogu: "Kumamon" };
        s.partnerStats = {
            digimonId: 9, level: 30, xp: 0, tp: 20, hp: 300, maxHp: 400, mp: 100, maxMp: 160,
            stats: { str: 50, def: 40, spt: 45, wis: 44, spd: 42, chr: 20 }, elemBonuses: {},
            equippedForms: [9, 27, 0],
            formLedger: [
                { id: 9, formLevel: 5, dvexp: 100, techSlots: [3, 0x2000 | 5, 0x4000 | 7, 0, 0, 0x8000 | 53] },
                { id: 27, formLevel: 5, dvexp: 100, techSlots: [4, 0, 0, 0, 0, 0] },
                { id: 39, formLevel: 5, dvexp: 100, techSlots: [5, 0, 0, 0, 0, 0] },
                { id: 11, formLevel: 5, dvexp: 100, techSlots: [6, 0, 0, 0, 0, 0] },
            ],
        };
        s.partyStats = [s.partnerStats, { digimonId: 7, level: 10, xp: 0, tp: 5, hp: 100, maxHp: 120, mp: 40, maxMp: 50, stats: {}, elemBonuses: {} }, null];
        s.equipment = [{ head: 215 }, {}, {}];
        s.reserveStats = {};
        s.reserveEquipment = {};
        window.__labOpen("dri");
    });
    await page.waitForTimeout(2500);
    await snap("0-root");
    await press("ArrowDown");   // Digivolve row
    await press("Enter");       // picker
    await snap("1-picker");
    await press("Enter");       // "See whose digivolve" -> submenu
    await snap("2-submenu");
    await press("Enter", 150);  // open the highlighted form -> Select Action
    await page.waitForTimeout(1500);
    await snap("3-grid");
    await press("ArrowDown");   // move to another acquired form
    await snap("4-grid-cursor");
    await press("Enter", 150);  // confirm -> submenu?
    await page.waitForTimeout(1500);
    await snap("5-confirm");
    await press("Enter", 150);  // submenu row 0 = Change digivolve type
    await page.waitForTimeout(1500);
    await snap("6-after-submenu-enter");
    await press("ArrowDown");
    await snap("7-grid-cursor");
    await press("Enter", 150);
    await page.waitForTimeout(1500);
    await snap("8-after-confirm");
    console.log("errors:", errors.length ? errors.join(" | ") : "none");
} finally {
    await browser.close();
}
