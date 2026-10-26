// Probe: what does the mount's off-screen render actually contain? Numbers only.
//   tools/run-playwright.sh tools/_probe_mount_sprite.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => { if (/mount3d|WebGL|webgl/i.test(m.text())) console.log("console:", m.text().slice(0, 200)); });
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "3");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p005koet");
    localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    localStorage.removeItem("dw.fx.v1");
});
await page.goto(`${baseUrl(8770)}/index.html?skipTitle=1&map=s330&noEncounters=1`);
await page.waitForFunction(() => window.__state?.started && window.__quests?.defs?.length && window.__mount, null, { timeout: 90000 });
await page.waitForTimeout(400);

const gl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const g = c.getContext("webgl2") || c.getContext("webgl");
    if (!g) return "no webgl";
    const d = g.getExtension("WEBGL_debug_renderer_info");
    return { version: g.getParameter(g.VERSION), renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?" };
});
console.log("webgl:", JSON.stringify(gl));

await page.evaluate(() => {
    window.__setFx("mount", true);
    window.__quests.state.done["zz_mount"] = Date.now();
    window.__quests.save();
});
await page.keyboard.press("r");
await page.waitForTimeout(1200);
console.log("state:", JSON.stringify(await page.evaluate(() => window.__mount.state())));
console.log("rig:", JSON.stringify(await page.evaluate(() => window.__mount.loadedModel())));
console.log("sprite:", JSON.stringify(await page.evaluate(() => window.__mount.sprite())));
console.log("framebuffer:", JSON.stringify(await page.evaluate(() => window.__mount.framebuffer())));
console.log("selftest:", JSON.stringify(await page.evaluate(() => window.__mount.selfTest())));
console.log("sceneprobe:", JSON.stringify(await page.evaluate(() => window.__mount.sceneProbe())));
console.log("sprite up:", JSON.stringify(await page.evaluate(() => window.__mount.sprite({ dir: "up" }))));
console.log("sprite still:", JSON.stringify(await page.evaluate(() => window.__mount.sprite({ moving: false }))));
await browser.close();
