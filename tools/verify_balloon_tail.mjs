// Headless proof that the field speech balloon's TAIL is drawn from the
// extracted CMFONTCS art (G23), not an invented triangle.
//
// It drives the LEGACY balloon renderer (web/textbox.js `drawBalloon`) — the
// renderer the G23 ledger row cites, and the one that lacked the tail. Run it
// twice, once default (the decoded CMFONTCS clip 3/5/4/6 sprite) and once with
// `?legacyBalloonTail=1` (the old chrome triangle), and it also builds a
// side-by-side with the original PS1 reference capture.
//
//   python3 -m http.server 8788 --directory web
//   VERIFY_PORT=8788 tools/run-playwright.sh tools/verify_balloon_tail.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "captures/balloon-tails-2026-10-09";
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); if (!ok) failures++; };

// CMFONTCS clip 3's own palette (the tail band). The reference capture shows the
// tail on screen as exactly these, so their presence IS the tail.
const CLIP3 = [[160, 208, 208], [120, 160, 168], [88, 112, 120]];

async function shotBalloon(browser, query, name) {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem("assetMode", "authentic"); } catch { /* blocked */ } });
    await page.goto(`${ROOT}/?skipTitle=1&noEncounters=1${query}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started && window.__textbox, null, { timeout: 60000 });
    // Open a legacy anchored balloon (mode 0) with a fixed anchor near screen centre.
    await page.evaluate(() => {
        window.__textbox.open(
            { name: "Junior", pages: [["What the...?", "Is that a Digimon?!"]] },
            null,
            () => ({ x: 300, y: 420, mode: 0 }),
        );
    });
    await page.waitForTimeout(400);
    await page.locator("canvas").first().screenshot({ path: `${OUT}/${name}.png` });
    // Sample the canvas under the anchor for the tail band colours.
    const counts = await page.evaluate(async (clip3) => {
        const cv = document.querySelector("canvas");
        const ctx = cv.getContext("2d");
        const d = ctx.getImageData(0, Math.floor(cv.height * 0.5), cv.width, Math.floor(cv.height / 2)).data;
        const near = (a, b) => Math.abs(a - b) <= 4;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
            for (const [r, g, b] of clip3) if (near(d[i], r) && near(d[i + 1], g) && near(d[i + 2], b)) { n++; break; }
        }
        return n;
    }, CLIP3);
    await page.close();
    return { counts, errors };
}

const browser = await chromium.launch();
const after = await shotBalloon(browser, "", "tail-after");
check("tail sprite present (default)", after.counts > 20, `clip3-palette pixels under the balloon = ${after.counts}`);
check("no page errors (default)", after.errors.length === 0, after.errors.slice(0, 2).join(" | "));

const before = await shotBalloon(browser, "&legacyBalloonTail=1", "tail-before");
check("legacy triangle has no tail-sprite palette", before.counts < 20, `clip3-palette pixels = ${before.counts}`);

// side-by-side: ours (after) | original reference
const mine = readFileSync(`${OUT}/tail-after.png`).toString("base64");
const ref = readFileSync("web/assets/ref/s415_bulbmon_dialogue_ref.png").toString("base64");
const cmp = await browser.newPage({ viewport: { width: 1000, height: 500 } });
await cmp.setContent(`<body style="margin:0;background:#222;color:#ccc;font:12px monospace">
<div style="display:flex"><figure style="margin:4px">our balloon (tail)<br><img id=a src="data:image/png;base64,${mine}" width=480 height=360></figure>
<figure style="margin:4px">original PS1 reference<br><img id=b src="data:image/png;base64,${ref}" width=480 height=360 style="image-rendering:pixelated"></figure></div></body>`);
await cmp.waitForFunction(() => [...document.images].every((i) => i.complete));
await cmp.screenshot({ path: `${OUT}/tail-vs-reference.png` });
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
