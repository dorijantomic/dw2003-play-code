import { chromium } from "playwright";
import { spawn } from "node:child_process";

const server = spawn("python3", ["-m", "http.server", "8752"], { cwd: process.env.HOME + "/ddw3-walker/web" });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE ERROR:", m.text()); });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto("http://localhost:8752/sound-audit.html");
await page.waitForFunction(() => window.__audit && window.__audit.roster.length > 0, null, { timeout: 15000 });
const rosterLen = await page.evaluate(() => window.__audit.roster.length);
console.log("roster:", rosterLen);

// select Tyrannomon
await page.evaluate(() => {
  const r = window.__audit.roster.find((x) => x.names.includes("Tyrannomon"));
  return window.__audit.select(r);
});
await page.waitForFunction(() => document.querySelectorAll("#main table tr").length > 3);
const text = await page.evaluate(() => document.getElementById("main").innerText);
console.log("--- Tyrannomon page extract ---");
console.log(text.split("\n").slice(0, 40).join("\n"));
console.log("has COMEX114 (deep hit):", text.includes("COMEX114"));

// click the contact-resolution battle button and measure output amplitude
const amp = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.dataset.k === "comex114" && b.dataset.b === "1");
  if (!btn) return { err: "no comex114 button" };
  btn.click();
  await new Promise((r) => setTimeout(r, 300));
  const lp = window.__lastPlay;
  if (!lp) return { err: "no __lastPlay" };
  const a = lp.analyser;
  const buf = new Float32Array(a.fftSize);
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    a.getFloatTimeDomainData(buf);
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    await new Promise((r) => setTimeout(r, 60));
  }
  return { key: lp.key, rate: lp.rate, peak, ctxState: lp.src.context.state };
});
console.log("battle playback:", amp);

// sustained loop check: Kyubimon whirl comcd204 [41,49]
const loop = await page.evaluate(async () => {
  const r = window.__audit.roster.find((x) => x.pack === "m454kyk9");
  await window.__audit.select(r);
  const btn = [...document.querySelectorAll("button")].find((b) => b.dataset.k === "comcd204" && b.dataset.b === "1");
  if (!btn) return { err: "no comcd204 battle button" };
  btn.click();
  await new Promise((r) => setTimeout(r, 200));
  const lp = window.__lastPlay;
  const a = lp.analyser;
  const buf = new Float32Array(a.fftSize);
  let peakEarly = 0, peakLate = 0;
  for (let i = 0; i < 8; i++) { a.getFloatTimeDomainData(buf); for (const v of buf) peakEarly = Math.max(peakEarly, Math.abs(v)); await new Promise((r) => setTimeout(r, 50)); }
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 8; i++) { a.getFloatTimeDomainData(buf); for (const v of buf) peakLate = Math.max(peakLate, Math.abs(v)); await new Promise((r) => setTimeout(r, 50)); }
  return { sustained: lp.sustained, duration: lp.duration, peakEarly, peakLate };
});
console.log("loop playback:", loop);

await browser.close();
server.kill();
