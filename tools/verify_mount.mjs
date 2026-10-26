// verify_mount.mjs — drive the real game headless and read the mount layer's STATE (never a picture).
//
//   Server: python3 -m http.server 8770 --directory web   (build first: python3 tools/build_quests.py --with-drafts)
//   Run:    tools/run-playwright.sh tools/verify_mount.mjs
//
// What it checks, all as numbers:
//   1. off by default: F2 -> Extras -> Mount is false, r does nothing, the player does not move a pixel
//   2. on + quest done: r mounts (the p002plyl step-on clip), the mount model loads (4 legs, head on -Z)
//   3. riding is 3x: the same 1.2 s of ArrowRight covers ~3x the ground it does on foot
//   4. the followers are hidden while riding and put back on walkable ground next to the mount on dismount
//   5. collision holds at 3x: the player never stands in a blocked cell, even driven into a wall for 2 s
//   6. switching the layer off mid-ride is a clean dismount (no mount, speed 1, followers back)
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.MQ_ROOT || `${baseUrl(8770)}/`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); problems.push("pageerror: " + e.message); });

const st = () => page.evaluate(() => {
    const m = window.__mount?.state?.() ?? null;
    return {
        mount: m, x: window.__state?.x ?? null, y: window.__state?.y ?? null, dir: window.__state?.dir ?? null,
        map: window.__mapInfo?.().id ?? null, followers: (window.__followers ?? []).map((f) => ({ x: f.x, y: f.y })),
        flag: window.__fx?.mount === true,
    };
});
const hold = async (key, ms) => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(80);
};
const tap = async (key) => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.down(key);
    await page.waitForTimeout(70);
    await page.keyboard.up(key);
    await page.waitForTimeout(120);
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

await page.addInitScript(() => {
    const put = (k, v) => { if (localStorage.getItem(k) == null) localStorage.setItem(k, v); };
    put("assetMode", "authentic");
    put("engineSchema", "2");
    put("progressOrdinal", "3");
    put("playerName", "Junior");
    put("charId", "p005koet");
    put("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    localStorage.removeItem("dw.fx.v1");                 // the panel's own defaults: mount OFF
});
await page.goto(ROOT + "index.html?skipTitle=1&map=s330&noEncounters=1");
await page.waitForFunction(() => window.__state?.started && window.__quests?.defs?.length && window.__mount, null, { timeout: 90000 });
await page.waitForTimeout(600);

// ── 1. off by default ────────────────────────────────────────────────────────────────────────
const a0 = await st();
expect(a0.flag === false, "F2 -> Extras -> Mount is OFF by default");
expect(a0.mount.mode === "idle", `the mount layer starts idle (${a0.mount.mode})`);
await tap("r");
await page.waitForTimeout(300);
const a1 = await st();
expect(a1.mount.mode === "idle", "r does nothing while the layer is off");
expect(a1.x === a0.x && a1.y === a0.y, `and the player did not move (${a0.x},${a0.y} -> ${a1.x},${a1.y})`);

// ── 2. on, quest done, ride ──────────────────────────────────────────────────────────────────
await page.evaluate(() => {
    window.__setFx("mount", true);
    window.__quests.state.done["zz_mount"] = Date.now();      // the quest layer's own store, never a story flag
    window.__quests.save();
});
await page.waitForTimeout(150);
const b0 = await st();
expect(b0.mount.enabled === true && b0.mount.unlocked.includes("unimon"),
    `switched on, the quest unlocks Unimon (unlocked ${JSON.stringify(b0.mount.unlocked)})`);
expect(b0.mount.asset === false, "the model is not fetched before the first ride");

await tap("r");
const b1 = await st();
expect(b1.mount.mode === "mounting", `r starts the climb on (${b1.mount.mode})`);
expect(b1.mount.freezesInput === true, "the step-on clip holds the field");
await page.waitForTimeout(900);
const b2 = await st();
expect(b2.mount.mode === "riding", `19 frames later the player is riding (${b2.mount.mode})`);
expect(b2.mount.speed === 3, `riding speed factor ${b2.mount.speed}`);
expect(b2.mount.hidesFollowers === true, "the followers are hidden while riding");
expect(b2.mount.asset === true, "the DW2 model loaded in the browser");
const rig = await page.evaluate(() => window.__mount.loadedModel());
if (rig) {
    expect(rig.legs === 4, `the loaded rig has four measured legs (${rig.legs})`);
    expect(JSON.stringify(rig.forward) === JSON.stringify([0, 0, -1]), `head forward on -Z (${JSON.stringify(rig.forward)})`);
} else expect(false, "no rig read back from the loaded model");

// the sprite itself, as numbers: it is not an empty canvas, it is palette-quantised, and two gait phases differ
const sprite = await page.evaluate(() => window.__mount.sprite({ phaseA: 0.1, phaseB: 0.6 }));
if (sprite) {
    expect(sprite.w === 112 && sprite.h === 104, `the sprite cell is MOUNT_VIEW (${sprite.w}x${sprite.h})`);
    expect(sprite.solid > 400, `the mount is actually drawn (${sprite.solid} solid pixels)`);
    expect(sprite.colors <= 17, `the pixel pass left at most the 16-colour palette + outline (${sprite.colors} colours)`);
    expect(sprite.changed > 20, `the legs move between two gait phases (${sprite.changed} pixels changed)`);
} else expect(false, "no sprite rendered");

// pick the freest of the four directions from where the player stands, so a run is not cut short by a wall
const dirs = [["ArrowRight", 1, 0], ["ArrowLeft", -1, 0], ["ArrowDown", 0, 1], ["ArrowUp", 0, -1]];
async function freestFrom(x, y) {
    let best = null;
    for (const [key, dx, dy] of dirs) {
        let free = 0;
        for (let i = 1; i <= 120; i++) {
            const ok = await page.evaluate(([px, py]) => window.__mount.canStand(px, py), [x + dx * i * 3, y + dy * i * 3]);
            if (!ok) break;
            free = i;
        }
        if (!best || free > best.free) best = { key, dx, dy, free };
    }
    return best;
}

// ── 3. speed: the same hold on foot and in the saddle ───────────────────────────────────────
const MS = 400;                      // short enough that the 3x run stays inside the scanned free corridor
// off the saddle first: the walk run must be a walk
await tap("r");
await page.waitForTimeout(500);
const d0 = await st();
expect(d0.mount.mode === "idle", `dismounted (${d0.mount.mode})`);
expect(d0.mount.speed === 1, "on foot again, speed factor 1");
expect(d0.mount.hidesFollowers === false, "the followers are shown again");
const near = d0.followers.filter((f) => f && dist(f, d0) <= 48);
expect(near.length === d0.followers.length, `every follower is back within 48 px (${near.length}/${d0.followers.length})`);
let partyFree = true;
for (const f of d0.followers) partyFree = partyFree && await page.evaluate(([x, y]) => window.__mount.canStand(x, y), [f.x, f.y]);
expect(partyFree, "every follower stands on ground the foot box can stand on");

const wStart = await st();
const best = await freestFrom(wStart.x, wStart.y);
expect(best.free > 8, `open ground found for the speed run (${best.key}, ${best.free} sampled steps)`);
await hold(best.key, MS);
const wEnd = await st();
const walkDist = dist(wStart, wEnd);
expect(walkDist > 0, `the player walks on foot (${walkDist.toFixed(1)} px in ${MS} ms)`);

// back to the start of the run (a debug teleport, so both runs cover the same ground) and ride it
await page.evaluate(([x, y]) => window.__teleport(x, y), [wStart.x, wStart.y]);
await page.waitForTimeout(150);
await tap("r");
await page.waitForTimeout(900);
const r0 = await st();
expect(r0.mount.mode === "riding", `mounted for the speed run (${r0.mount.mode})`);
await hold(best.key, MS);
const r1 = await st();
const rideDist = dist(r0, r1);
const ratio = walkDist > 0 ? rideDist / walkDist : 0;
expect(rideDist > 0, `the rider moves (${rideDist.toFixed(1)} px in ${MS} ms)`);
expect(ratio > 2.4 && ratio < 3.6, `riding covers ~3x the ground of walking (${ratio.toFixed(2)}x)`);

// ── 4. collision at 3x: drive into a wall for 2 s, never inside a blocked cell ──────────────
const c0 = await st();
expect(c0.mount.mode === "riding", `still in the saddle for the wall drive (${c0.mount.mode})`);
let inside = 0, samples = 0;
for (const [key] of dirs) {
    await page.keyboard.down(key);
    for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(100);
        const s = await st();
        samples++;
        const ok = await page.evaluate(([x, y]) => window.__mount.canStand(x, y), [s.x, s.y]);
        if (!ok) inside++;
    }
    await page.keyboard.up(key);
    await page.waitForTimeout(60);
}
expect(inside === 0, `no sampled ride position was inside a wall (${inside}/${samples} blocked)`);

// ── 5. switching the layer off mid-ride is a clean dismount ─────────────────────────────────
const e0 = await st();
expect(e0.mount.mode === "riding", `still riding before the switch (${e0.mount.mode})`);
await page.evaluate(() => window.__setFx("mount", false));
await page.waitForTimeout(300);
const e1 = await st();
expect(e1.mount.mode === "idle", `switching Mount off dismounts cleanly (${e1.mount.mode})`);
expect(e1.mount.speed === 1 && e1.mount.hidesFollowers === false, "speed 1 and the followers back after the switch");
const near2 = e1.followers.filter((f) => f && dist(f, e1) <= 48);
expect(near2.length === e1.followers.length, `the party is back beside the player (${near2.length}/${e1.followers.length})`);

// and with the switch off, r is dead again
const f0 = await st();
await tap("r");
await page.waitForTimeout(250);
const f1 = await st();
expect(f1.mount.mode === "idle" && f1.x === f0.x && f1.y === f0.y, "with the layer off again, r does nothing at all");

await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nall mount checks passed");
process.exit(problems.length ? 1 : 0);
