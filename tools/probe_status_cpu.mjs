// CPU profile of the slow first frames of the native pause page.
// tools/run-playwright.sh tools/probe_status_cpu.mjs
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
await page.evaluate(() => {
    window.__state.party = ["p003pken", "p006rna", null];
    window.__state.partnerStats = { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 };
    window.__state.partyStats = [
        { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        { level: 12, xp: 0, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25 },
        null,
    ];
    window.__labOpen("status", "status");
});
await page.waitForTimeout(7000);
const { profile } = await cdp.send("Profiler.stop");
writeFileSync("/tmp/opencode/status-cpu.cpuprofile", JSON.stringify(profile));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas?.[i] ?? 0) / 1000;
    const n = byId.get(profile.samples[i]);
    if (!n) continue;
    const f = n.callFrame;
    const key = `${f.functionName || "(anon)"} @ ${f.url.replace(/^.*\//, "")}:${f.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + dt);
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log(top.map(([k, v]) => `${Math.round(v)}ms  ${k}`).join("\n"));
await browser.close();
