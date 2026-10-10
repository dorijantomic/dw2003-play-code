// Probe: where does the bit-exact TRANSLATED balloon renderer put the window
// (the frameFill quad) and the text widgets, per mode? Empirical ground truth
// for the legacy-renderer body-side fix.
//   python3 -m http.server 8788 --directory web &
//   VERIFY_PORT=8788 tools/run-playwright.sh tools/probe_balloon_geom.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = baseUrl(8788);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
await page.addInitScript(() => { try { localStorage.setItem("assetMode", "authentic"); } catch { /* blocked */ } });
await page.goto(`${ROOT}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started && window.__dialogueBox, null, { timeout: 60000 });

for (const mode of [0, 1, 2, 3]) {
    await page.evaluate(async (m) => {
        await window.__dialogueBox.open(
            { esdmg: "esdmg400", entry: 4, index: 4 },
            { kind: "say", plain: false, balloonMode: m, actor: { x: 221, y: 110, actorId: 1 } },
            null, undefined, {},
        );
    }, mode);
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => {
        const s = window.__dialogueBox._session;
        const d = s.drawIntents();
        const raw = (d.raw ?? []).map((r) => ({ kind: r.kind, intent: r.intent }));
        const fill = raw.find((r) => r.kind === "frameFill");
        const tw = s.textWidgets().map((w) => ({
            addr: w.addr >>> 0,
            kind: s.mem.read32(w.addr + 0x54) | 0,
            x: s.mem.read16(w.addr + 0xb0) | 0,
            y: s.mem.read16(w.addr + 0xb2) | 0,
        }));
        const st = s.state?.() ?? {};
        return { fill: fill?.intent ?? null, tw, st };
    });
    const f = info.fill;
    console.log(`\n=== mode ${mode} (speaker 221,110) state=${JSON.stringify(info.st)} ===`);
    if (f) console.log(`  frameFill corners=${JSON.stringify(f.corners)} uv=${JSON.stringify(f.uv)}`);
    for (const w of info.tw) console.log(`  textWidget kind=${w.kind} x=${w.x} y=${w.y}`);
}
await browser.close();
