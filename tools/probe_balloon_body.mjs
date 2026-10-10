// Before/after capture of the legacy field balloon BODY side (web/textbox.js
// drawBalloon). The "before" is the committed HEAD textbox.js, served by
// intercepting the module request, so the comparison is a true before/after of
// the same scenario — no debug flag added to the shipped file.
//
//   python3 -m http.server 8788 --directory web &
//   VERIFY_PORT=8788 tools/run-playwright.sh tools/probe_balloon_body.mjs [outdir]
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = baseUrl(8788);
const OUT = process.argv[2] ?? "captures/balloon-body-side-2026-10-09";
mkdirSync(OUT, { recursive: true });
const OLD = execSync("git show HEAD:web/textbox.js", { maxBuffer: 32 * 1024 * 1024 }).toString();

// Speaker at native (221,110) — the reference frame's speaker — scaled x2 onto
// the 640x480 canvas, so the measured native box compares with
// web/assets/ref/s415_bulbmon_dialogue_ref.png directly.
const SPK = { x: 221, y: 110 };

async function capture(browser, patchOld, mode, name) {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    if (patchOld)
        await page.route("**/textbox.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: OLD }));
    await page.addInitScript(() => { try { localStorage.setItem("assetMode", "authentic"); } catch { /* blocked */ } });
    await page.goto(`${ROOT}/?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started && window.__legacyTextbox, null, { timeout: 60000 });
    await page.evaluate(({ m, sx, sy }) => {
        window.__legacyTextbox.open(
            { name: "Junior", pages: [["What the...?", "Is that a Digimon?!"]] },
            null,
            () => ({ x: sx * 2, y: sy * 2, mode: m }),
        );
    }, { m: mode, sx: SPK.x, sy: SPK.y });
    await page.waitForTimeout(400);
    await page.locator("canvas").first().screenshot({ path: `${OUT}/${name}.png` });
    const bb = await page.evaluate(() => {
        const cv = document.querySelector("canvas");
        const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, n = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (Math.abs(d[i] - 216) <= 6 && Math.abs(d[i + 1] - 232) <= 6 && Math.abs(d[i + 2] - 248) <= 6) {
                const p = i / 4, x = p % cv.width, y = (p / cv.width) | 0;
                n++;
                if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
            }
        }
        return { n, minx, miny, maxx, maxy };
    });
    await page.close();
    const nat = bb.n ? `x ${(bb.minx / 2).toFixed(0)}..${(bb.maxx / 2).toFixed(0)} y ${(bb.miny / 2).toFixed(0)}..${(bb.maxy / 2).toFixed(0)}` : "none";
    console.log(`  ${name}: body-fill native ${nat}`);
    return bb;
}

const browser = await chromium.launch();
for (const mode of [0, 2]) {
    console.log(`mode ${mode} (speaker ${SPK.x},${SPK.y}):`);
    await capture(browser, true, mode, `body-before-m${mode}`);
    await capture(browser, false, mode, `body-after-m${mode}`);
}

// 3-up for mode 0: before | after | original PS1 reference.
const b64 = (p) => readFileSync(p).toString("base64");
const ref = b64("web/assets/ref/s415_bulbmon_dialogue_ref.png");
const before = b64(`${OUT}/body-before-m0.png`);
const after = b64(`${OUT}/body-after-m0.png`);
const cmp = await browser.newPage({ viewport: { width: 1500, height: 520 } });
await cmp.setContent(`<body style="margin:0;background:#222;color:#ccc;font:12px monospace">
<div style="display:flex">
<figure style="margin:4px">BEFORE (HEAD textbox.js, mode 0)<br><img src="data:image/png;base64,${before}" width=480 height=360></figure>
<figure style="margin:4px">AFTER (this fix)<br><img src="data:image/png;base64,${after}" width=480 height=360></figure>
<figure style="margin:4px">ORIGINAL PS1 (mode 0)<br><img src="data:image/png;base64,${ref}" width=480 height=360 style="image-rendering:pixelated"></figure>
</div></body>`);
await cmp.waitForFunction(() => [...document.images].every((i) => i.complete));
await cmp.screenshot({ path: `${OUT}/body-before-after-reference.png` });
await browser.close();
console.log(`captured -> ${OUT}/`);
