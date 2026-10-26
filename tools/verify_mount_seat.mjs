// verify_mount_seat.mjs — how much of the rider shows on the mount, in every facing, old draw vs the saddle split.
// Numbers only: the game canvas is read as pixel values, never looked at.
//
//   Run: tools/run-playwright.sh tools/verify_mount_seat.mjs     (server on 8770, like tools/verify_mount.mjs)
//
// For each facing and each mode (split off / on), three frames with the idle clock held:
//   A  the normal frame        B  the mount left out        C  the mount and the rider left out
// rider mask = pixels where B != C; visible = mask pixels where A == B (nothing drawn over them).
// "upper" is the same count over the top 60% of the mask's rows (head and body, the part that must show).
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.MQ_ROOT || `${baseUrl(8770)}/`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });

await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "3");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p005koet");
    localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    localStorage.removeItem("dw.fx.v1");
});
await page.goto(ROOT + "index.html?skipTitle=1&map=s330&noEncounters=1");
await page.waitForFunction(() => window.__state?.started && window.__quests?.defs?.length && window.__mount, null, { timeout: 90000 });
await page.waitForTimeout(600);
// every effect off (weather, particles, sway), so two frames differ only by what the probe leaves out
await page.evaluate(() => {
    for (const k of window.__fxKeys) window.__setFx(k, false);
    window.__setFx("mount", true);
    window.__quests.state.done["zz_mount"] = Date.now();
    window.__quests.save();
});
await page.waitForTimeout(200);
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.down("r"); await page.waitForTimeout(70); await page.keyboard.up("r");
await page.waitForFunction(() => window.__mount.state().mode === "riding" && window.__mount.assetLoaded(), null, { timeout: 15000 });
await page.evaluate(() => window.__mount.probe({ timeSec: 0 }));

const frame = () => page.evaluate(() => new Promise((res) => {
    // two animation frames so the probe change has been drawn
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const c = document.getElementById("game");
        res(Array.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data));
    }));
}));
const W = await page.evaluate(() => document.getElementById("game").width);

async function measure() {
    await page.evaluate(() => window.__mount.probe({ hideMount: false, hideRider: false }));
    await page.waitForTimeout(120);
    const A = await frame();
    await page.evaluate(() => window.__mount.probe({ hideMount: true, hideRider: false }));
    await page.waitForTimeout(120);
    const B = await frame();
    await page.evaluate(() => window.__mount.probe({ hideMount: true, hideRider: true }));
    await page.waitForTimeout(120);
    const C = await frame();
    await page.evaluate(() => window.__mount.probe({ hideMount: false, hideRider: false }));
    const same = (X, Y, i) => X[i] === Y[i] && X[i + 1] === Y[i + 1] && X[i + 2] === Y[i + 2];
    const rows = [];
    let mask = 0;
    for (let i = 0; i < B.length; i += 4) if (!same(B, C, i)) { mask++; rows.push((i / 4 / W) | 0); }
    if (!mask) return { mask: 0, visible: 0, upper: 0, upperMask: 0 };
    const top = Math.min(...rows), bot = Math.max(...rows), cutRow = top + 0.6 * (bot - top + 1);
    let visible = 0, upper = 0, upperMask = 0;
    for (let i = 0; i < B.length; i += 4) {
        if (same(B, C, i)) continue;
        const row = (i / 4 / W) | 0, up = row < cutRow, vis = same(A, B, i);
        if (vis) visible++;
        if (up) { upperMask++; if (vis) upper++; }
    }
    return { mask, visible, upper, upperMask, rows: bot - top + 1 };
}

const DIRS = ["down", "down-right", "right", "up-right", "up", "up-left", "left", "down-left"];
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) : "-") + "%";
console.log("facing       split OFF: all / upper          split ON: all / upper       seat (cell px)");
const on = [];
for (const dir of DIRS) {
    await page.evaluate((d) => { window.__state.dir = d; }, dir);
    await page.evaluate(() => window.__setFx("mountseat", false));
    const off = await measure();
    await page.evaluate(() => window.__setFx("mountseat", true));
    await page.waitForTimeout(100);
    const sp = await measure();
    const seat = await page.evaluate(() => window.__mount.rider());
    on.push({ dir, ...sp });
    console.log(`${dir.padEnd(12)} ${pct(off.visible, off.mask).padStart(5)} / ${pct(off.upper, off.upperMask).padStart(5)}`
        + `            ${pct(sp.visible, sp.mask).padStart(5)} / ${pct(sp.upper, sp.upperMask).padStart(5)}`
        + `      ${seat ? `x ${seat.seatX.toFixed(1)} y ${seat.seatY.toFixed(1)} dx ${seat.dx.toFixed(1)} lift ${seat.lift.toFixed(1)}` : "none"}`);
}
// PARTS=1: which body part covers the rider (split on): the upper-visible share with each part left out of the render
if (process.env.PARTS) {
    const PARTS = { torso: [15], neck: [16], head: [17], wings: [18, 19], forelegs: [20, 21, 22, 23], hindlegs: [24, 25, 26, 27], tail: [28, 29] };
    await page.evaluate(() => window.__setFx("mountseat", true));
    console.log("\nupper visible with one part left out (split on)\nfacing      " + Object.keys(PARTS).map((k) => k.padStart(9)).join(""));
    for (const dir of DIRS) {
        await page.evaluate((d) => { window.__state.dir = d; }, dir);
        const cells = [];
        for (const nodes of Object.values(PARTS)) {
            await page.evaluate((n) => window.__mount.probe({ hideNodes: n }), nodes);
            const r = await measure();
            cells.push(pct(r.upper, r.upperMask).padStart(9));
        }
        await page.evaluate(() => window.__mount.probe({ hideNodes: null }));
        console.log(dir.padEnd(12) + cells.join(""));
    }
}
for (const r of on) expect(r.mask > 200, `${r.dir}: the rider is drawn (${r.mask} canvas px)`);
await page.evaluate(() => window.__setFx("mountseat", false));
await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nmeasured");
process.exit(problems.length ? 1 : 0);
