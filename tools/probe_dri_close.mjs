// Why does Back not close the native lab after a Switch? Watch the root's aux
// child slot and lifecycle across repeated Back presses.
//   tools/run-playwright.sh tools/probe_dri_close.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = "/tmp/opencode/dri-close";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const diag = (name) => page.evaluate(() => {
    const st = window.__dri;
    const read = (a) => st._host?.read?.(a, 4) >>> 0;
    const root = st.diagnostics()?.screen?.root ?? 0;
    const aux = root ? read(root + 0x24) : 0;
    return {
        open: st.isOpen(),
        root, rootLife: root ? read(root + 0xc) : null, rootUnk10: root ? read(root + 0x10) : null,
        rootUnk14: root ? read(root + 0x14) : null,
        auxChild: aux ? read(aux + 4) : null, auxFade: aux ? read(aux + 8) : null,
        fadeLife: aux ? (read(aux + 8) ? read(read(aux + 8) + 0xc) : 0) : null,
        party: [0, 1, 2].map((i) => read(0x80048d34 + 0x70 + i * 4)),
        objects: st.diagnostics()?.screen?.objects?.length ?? 0,
        frames: st.diagnostics()?.renderer?.frames ?? 0,
    };
}).then((d) => { console.log(name, JSON.stringify(d)); return d; });
const press = async (key, ms = 100) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(700); };

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.__state.rosterOwned = (1 << 0) | (1 << 6);
        window.__state.party = ["p003pken", null, null];
        window.__state.digimonNames = { p003pken: "Kotemon", p009rena: "Renamon" };
        window.__state.partnerStats = { digimonId: 1, level: 5, xp: 0, tp: 10, hp: 30, maxHp: 40, mp: 12, maxMp: 20, stats: {}, elemBonuses: {} };
        window.__state.partyStats = [window.__state.partnerStats, null, null];
        window.__state.equipment = [{ head: 215 }, {}, {}];
        window.__state.reserveStats = { p009rena: { digimonId: 7, level: 3, xp: 0, tp: 4, hp: 20, maxHp: 25, mp: 8, maxMp: 10, stats: {}, elemBonuses: {} } };
        window.__state.reserveEquipment = { p009rena: { right: 92 } };
        window.__labOpen("dri");
    });
    await page.waitForTimeout(2500);
    await diag("0-open");
    await press("Escape");
    await page.waitForTimeout(1500);
    await diag("1-escape-plain");
    await press("Escape");
    await page.waitForTimeout(1500);
    await diag("2-escape-again");
    await press("Escape");
    await page.waitForTimeout(2500);
    await diag("3-escape-third");
    console.log("errors:", errors.length ? errors.join(" | ") : "none");
} finally {
    await browser.close();
}
