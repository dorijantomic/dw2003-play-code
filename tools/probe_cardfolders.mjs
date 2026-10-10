// Does the native CARD FOLDERS launcher page hand off to the Album / folder
// editor in production, or is choosing a row a dead end?
//   tools/run-playwright.sh tools/probe_cardfolders.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = process.env.CF_SHOT || "/tmp/opencode/cardfolders";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const snap = async (name) => {
    const d = await page.evaluate(() => {
        const st = window.__status;
        const base = { open: st?.isOpen?.() ?? false, menuScreen: window.__menu?.screen ?? null,
            menuOpen: window.__state?.menuOpen, frames: st?.diagnostics?.().renderer?.frames ?? 0,
            traps: st?.diagnostics?.().host?.traps ?? null, last: st?.diagnostics?.().lastDiagnostic ?? null,
            album: window.__cardAlbum?.isOpen?.() ?? null, deck: window.__cardDeck?.isOpen?.() ?? null };
        if (!st?._host?.rt) return { ...base, transition: null };
        const read = (a) => st._host.read(a, 4) >>> 0;
        const root = st._host.rt.world.objects[0]?.addr ?? 0;
        const aux = root ? read(root + 0x24) : 0;
        const child = aux ? read(aux + 4) : 0;
        return { ...base, root, aux, child,
            childState: child ? read(child + 0xc) : null,
            childUnk10: child ? read(child + 0x10) : null,
            childUnk14: child ? read(child + 0x14) : null,
            transitionA: read(0x8004b3fc), transitionB: read(0x8004b404),
            objects: st._host.rt.world.objects.map((o) => ({ addr: o.addr >>> 0, cb: o.cb >>> 0, alive: o.alive })),
        };
    });
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(d, null, 1) + "\n");
    await page.locator("#game").screenshot().then((b) => writeFileSync(`${OUT}/${name}.png`, b)).catch(() => {});
    console.log(name, JSON.stringify(d));
    return d;
};
const press = async (key, ms = 100) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(500); };
const interactive = () => page.waitForFunction(() => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 });

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.waitForFunction(() => (window.__cards?.()?.folders?.length ?? 0) > 0, null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => {
        window.__state.bits = 4321;
        window.__state.party = ["p003pken", null, null];
        window.__state.digimonNames = { p003pken: "Kotemon" };
        window.__state.partnerStats = { digimonId: 1, level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25, stats: {}, elemBonuses: {} };
        window.__state.partyStats = [{ level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 }, null, null];
        window.__state.inventory = [];
        window.__labOpen("menu");
    });
    await page.waitForTimeout(500);
    await snap("0-menu");
    for (let i = 0; i < 5; i++) await press("ArrowDown", 70);
    await press("Enter", 90);
    await interactive();
    await snap("1-cardfolders-page");
    await press("Enter", 90);   // Album row
    await page.waitForTimeout(1500);
    await snap("2-after-album");
    await press("Escape");      // leave the album -> walker CARD FOLDERS panel
    await page.waitForTimeout(1200);
    await snap("3-back-from-album");
    await press("ArrowDown", 70);
    await press("Enter", 90);   // Edit Folder row
    await page.waitForTimeout(1500);
    await snap("4-after-editfolder");
    await press("Escape");      // leave the folder editor
    await page.waitForTimeout(1200);
    await snap("5-after-back");
    console.log("errors:", errors.length ? errors.join(" | ") : "none");
} finally {
    await browser.close();
}
