// Does the renderer's arena-tint sink actually paint the arena background?
//
// The ported effect-tint feed FIGHTSTG_F0x800861f4 fixes the arena view's (0x1000)
// background colour (view+0x12C). The renderer half is web/battle3d.js#setArenaTint,
// applied in render() to the arena background quad (the sky when the arena is up, the
// void when a signature/transformation replaces it). The ported feed reaches it through
// engine/dw3/battle-effect-driver-host.ts#createTransformationSchedule's `arenaTint` sink.
//
// This drives the real Battle Lab through `r.setArenaTint(r,g,b)` and pins the frame, so
// the same moment is compared across colours. It proves the sink PAINTS (a set colour
// changes the frame) and that clearing it restores the renderer's own default — the
// question "does the renderer half work, and what does the colour do" answered with pixels.
//
// Run:  PORT=8745 tools/run-playwright.sh tools/verify_arena_tint.mjs
//       (needs a web/ server, e.g. python3 -m http.server 8745 --directory web)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OUT_DIR = process.env.OUT_DIR || "captures/arena-tint-2026-10-07";
const PORT = Number(process.env.PORT || 8745);
const URL = process.env.LAB_URL || `http://127.0.0.1:${PORT}/battle-lab.html`;
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__r, null, { timeout: 30000 });
await page.waitForTimeout(3000);
// Freeze the lab's own animation loop so the pinned frame is not overwritten.
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.evaluate(() => {
  window.__r.setCameraMode("game");      // the fixed PS1 camera: no time term
  window.__r.setPlayerVisible(false);    // the bobbing actors are not under test
  window.__r.setEnemyVisible(false);
});

/** A corner pixel of the frame just rendered — the arena background. */
async function cornerPixel() {
  const url = await page.evaluate(() => window.__r.debugCaptureFrame());
  return page.evaluate(async (u) => {
    const img = new Image(); img.src = u; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const p = x.getImageData(3, 3, 1, 1).data;
    return [p[0], p[1], p[2], p[3]];
  }, url);
}

async function frame(tag, setTint) {
  await page.evaluate((args) => {
    if (args === undefined) window.__r.setArenaTint();
    else window.__r.setArenaTint(args[0], args[1], args[2]);
  }, setTint);
  await page.evaluate(() => window.__r.render(0));
  const url = await page.evaluate(() => window.__r.debugCaptureFrame());
  const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  fs.writeFileSync(path.join(OUT_DIR, `${tag}.png`), buf);
  const px = await cornerPixel();
  const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  return { tag, tint: setTint ?? null, corner: px, sha, bytes: buf.length };
}

// Turn the setter on for every capture by first setting a colour, so the default frame
// below is captured with the sink ARMED but cleared — the renderer's own background.
await page.evaluate(() => window.__r.setArenaTint());
const rows = [];
rows.push(await frame("00-default", undefined));       // sink cleared -> renderer default
rows.push(await frame("01-tint-orange", [255, 128, 0]));
rows.push(await frame("02-tint-cyan", [12, 200, 255]));
rows.push(await frame("03-tint-black", [0, 0, 0]));
rows.push(await frame("04-cleared-again", undefined));  // must equal 00

await browser.close();

const byTag = Object.fromEntries(rows.map((r) => [r.tag, r]));
fs.writeFileSync(path.join(OUT_DIR, "captures.json"), JSON.stringify({ url: URL, rows }, null, 2));

for (const r of rows) console.log(`${r.tag.padEnd(18)} corner ${JSON.stringify(r.corner).padEnd(22)} ${r.sha} ${r.bytes}B`);

const ok = byTag["00-default"].sha !== byTag["01-tint-orange"].sha
  && byTag["01-tint-orange"].sha !== byTag["02-tint-cyan"].sha
  && byTag["00-default"].sha === byTag["04-cleared-again"].sha;
console.log(ok
  ? "OK: setArenaTint changes the arena background, and clearing it restores the default."
  : "FAIL: the arena-tint sink did not paint, or did not restore.");
if (errors.length) { console.log("page errors:", errors.slice(0, 5).join(" ;; ")); }
process.exit(ok && errors.length === 0 ? 0 : 1);
