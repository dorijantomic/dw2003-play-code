// What pack pointer does the pause page hand to the card pack uploader
// F0x8001fe38? tools/run-playwright.sh tools/probe_status_pack.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
const out = await page.evaluate(async () => {
    window.__state.party = ["p003pken", "p006rna", null];
    window.__state.partnerStats = { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 };
    window.__state.partyStats = [
        { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        null,
    ];
    window.__labOpen("status", "status");
    const rt = window.__status._host.rt;
    const calls = [];
    const mem = rt.mem;
    rt.cpu.setStub(0x8001fe38, (c) => {
        const pack = c.reg(4) >>> 0;
        const ra = c.reg(31) >>> 0;
        calls.push({ pack: "0x" + pack.toString(16), ra: "0x" + ra.toString(16), w0: "0x" + (mem.read32(pack) >>> 0).toString(16) });
        return 0;
    });
    await new Promise((r) => setTimeout(r, 4000));
    const s = window.__status.diagnostics();
    return { childUnk10: s.screen?.childUnk10, calls: calls.slice(0, 12), count: calls.length };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
