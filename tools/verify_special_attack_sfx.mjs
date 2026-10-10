// Live-browser proof for the two sustained sounds of a special attack, through
// the REAL battle3d + audio.js in the REAL Battle Lab page.
//
// What it proves, per cast:
//   1. the per-element loop (SFSTDATA rec[+0x08] -> fightstg 0x800a2498 =
//      BT_LOOP0..7) starts when the element backdrop comes up and stops when the
//      backdrop goes down -- the same lifetime the original gives it, which keeps
//      the voice handle in the effect object at +0xe4 and stops it by (id, handle);
//   2. a sigEffect-0 special (the data-field fallback, SFSTDATA record 55, whose
//      sound field is -1) starts NO loop -- silence is the authentic result;
//   3. the signature whirl EX_AT_LP, opened by op10 type 89, is closed by op10
//      type 91 rather than by running out of buffer.
//
// Run:  tools/run-playwright.sh tools/verify_special_attack_sfx.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const PORT = Number(process.env.PORT || 8764);
const ROOT = path.resolve("web");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".wav": "audio/wav", ".css": "text/css" };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// Techs chosen from the shipped tables, not hardcoded lore: sigEffect 45 =
// thunder -> BT_LOOP4, sigEffect 34 = fire -> BT_LOOP0, sigEffect 0 -> silence.
const bd = JSON.parse(fs.readFileSync("web/assets/battle/backdrops/manifest.json", "utf8"));
const pick = (sig) => Number(Object.entries(bd.byTech).find(([, s]) => s === sig)[0]);
const CASES = [
  { label: "thunder special", tech: pick(45), want: "bt_loop4" },
  { label: "fire special", tech: pick(34), want: "bt_loop0" },
  { label: "data-field special (sig 0)", tech: pick(0), want: null },
];

const browser = await chromium.launch({ headless: true });
const fail = [];
const lines = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGE", e));
  await page.goto(`http://127.0.0.1:${PORT}/battle-lab.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__r && !!window.__sfx, { timeout: 30_000 });

  await page.evaluate(() => {
    window.__log = [];
    const sfx = window.__sfx;
    // Wrap the real player: every entry point the decoded paths use.
    for (const fn of ["playEffectLoop", "stopEffectLoop", "playSustained", "stopSustained"]) {
      const orig = sfx[fn].bind(sfx);
      sfx[fn] = (...a) => { window.__log.push({ fn, arg: a[0] ?? null, t: performance.now() }); return orig(...a); };
    }
    // And the raw Web Audio nodes, so a wrapper that never reaches a voice is caught.
    const P = AudioBufferSourceNode.prototype;
    const start0 = P.start, stop0 = P.stop;
    let n = 0;
    P.start = function (...a) { this.__id = ++n; window.__log.push({ fn: "node.start", id: this.__id, t: performance.now() }); return start0.apply(this, a); };
    P.stop = function (...a) { window.__log.push({ fn: "node.stop", id: this.__id ?? null, t: performance.now() }); return stop0.apply(this, a); };
    sfx.unlock();
  });
  await page.waitForTimeout(500);

  for (const c of CASES) {
    const res = await page.evaluate(async (tech) => {
      const sfx = window.__sfx;
      sfx.stopAll(); sfx.stopEffectLoop(); sfx.stopAllSustained();
      await new Promise((r) => setTimeout(r, 200));
      window.__log.length = 0;
      const op10 = [];
      window.__r.playerAttack(tech, { onHit: (rec) => op10.push(rec.type) });
      // Sample the live owners while the backdrop is up: BD_DELAY_MS is 850 and
      // BD_HOLD_MS 3800, so 2000 ms in is inside the window by a wide margin.
      await new Promise((r) => setTimeout(r, 2000));
      const during = { loop: sfx.debugEffectLoop(), sustained: sfx.debugSustained() };
      await new Promise((r) => setTimeout(r, 3400));
      const after = { loop: sfx.debugEffectLoop(), sustained: sfx.debugSustained() };
      return { op10, during, after, log: window.__log.slice() };
    }, c.tech);

    const { op10, during, after } = res;
    const nodeStarts = res.log.filter((e) => e.fn === "node.start").length;
    const opens = op10.filter((t) => t === 89).length;
    const closes = op10.filter((t) => t === 91).length;
    lines.push(`${c.label.padEnd(28)} tech=${c.tech} loop@2s=${during.loop || "-"} `
      + `loop@5.4s=${after.loop || "-"} whirl@2s=${during.sustained.join(",") || "-"} `
      + `whirl@5.4s=${after.sustained.join(",") || "-"} op10(89/91)=${opens}/${closes} nodes=${nodeStarts}`);

    if (c.want) {
      if (during.loop !== c.want) fail.push(`${c.label}: expected ${c.want} while the backdrop is up, got ${during.loop ?? "none"}`);
      if (after.loop) fail.push(`${c.label}: ${after.loop} still owns a voice after the backdrop went down`);
      if (!nodeStarts) fail.push(`${c.label}: no audio node ever started`);
    } else if (during.loop) {
      fail.push(`${c.label}: sig 0 carries no sound, but ${during.loop} started`);
    }
    // The clip's own markers decide: 89 opens the whirl, 91 closes it.
    if (opens && !during.sustained.includes("ex_at_lp") && !after.sustained.length)
      fail.push(`${c.label}: op10 89 fired but no whirl voice was ever held`);
    if (opens !== closes) fail.push(`${c.label}: clip emits ${opens} whirl opens and ${closes} closes`);
    if (after.sustained.length) fail.push(`${c.label}: whirl still ringing after the cast (${after.sustained.join(",")})`);
  }

  console.log(lines.join("\n"));
  fs.writeFileSync("/tmp/special_attack_sfx_report.txt",
    lines.join("\n") + "\n" + (fail.length ? "FAIL\n" + fail.join("\n") : "OK") + "\n");
  if (fail.length) { console.error("FAIL:\n" + fail.join("\n")); process.exitCode = 1; }
  else console.log("OK — the element loop and the whirl match the decoded lifetimes.");
} finally {
  await browser.close();
  server.close();
}
