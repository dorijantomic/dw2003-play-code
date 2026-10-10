// THE CAPTURE IS THE ORACLE.
//
// web/assets/ref/cardduel/*.png are real rig frames of the disc playing the
// card duel (run 1, 2026-08-05, 50Hz, 320x240). This drives the walker to the
// same beats and reports the WHOLE-FRAME pixel difference against each one, so
// the divergences can be worked largest first instead of screen by screen.
//
// It reports, per beat: how many of the 76,800 pixels differ, and the bounding
// box and pixel count of each connected region of difference, biggest first.
// A region is what to go and fix; the number is whether it got fixed.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: tools/run-playwright.sh tools/diff_cardduel_vs_disc.mjs [beat]
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const only = process.argv[2] ?? null;

const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("cardduel"); w.__labDuel.open(null, "Opponent", null, 13);
});
await p.waitForTimeout(1200);

// The diff itself runs in the page, where the reference PNG can be decoded and
// the duel drawn into the same 320x240 buffer.
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__diff = async (refName) => {
    const shot = w.document.createElement("canvas");
    shot.width = 320; shot.height = 240;
    const sg = shot.getContext("2d");
    sg.imageSmoothingEnabled = false;
    w.__labDuel.draw(sg, 320, 240);

    const img = new w.Image();
    img.src = `assets/ref/cardduel/${refName}.png`;
    await img.decode();
    const ref = w.document.createElement("canvas");
    ref.width = 320; ref.height = 240;
    const rg = ref.getContext("2d");
    rg.drawImage(img, 0, 0);

    const a = sg.getImageData(0, 0, 320, 240).data;
    const c = rg.getImageData(0, 0, 320, 240).data;
    const bad = new Uint8Array(320 * 240);
    let n = 0;
    for (let i = 0, q = 0; q < bad.length; q++, i += 4) {
      if (a[i] !== c[i] || a[i + 1] !== c[i + 1] || a[i + 2] !== c[i + 2]) { bad[q] = 1; n++; }
    }
    // Connected regions of difference, 4-way, iterative flood fill.
    const seen = new Uint8Array(bad.length);
    const regions = [];
    const stack = [];
    for (let q = 0; q < bad.length; q++) {
      if (!bad[q] || seen[q]) continue;
      let x0 = 320, x1 = -1, y0 = 240, y1 = -1, count = 0;
      stack.push(q); seen[q] = 1;
      while (stack.length) {
        const t = stack.pop();
        const x = t % 320, y = (t / 320) | 0;
        count++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && bad[t - 1] && !seen[t - 1]) { seen[t - 1] = 1; stack.push(t - 1); }
        if (x < 319 && bad[t + 1] && !seen[t + 1]) { seen[t + 1] = 1; stack.push(t + 1); }
        if (y > 0 && bad[t - 320] && !seen[t - 320]) { seen[t - 320] = 1; stack.push(t - 320); }
        if (y < 239 && bad[t + 320] && !seen[t + 320]) { seen[t + 320] = 1; stack.push(t + 320); }
      }
      regions.push({ count, x0, y0, x1, y1 });
    }
    regions.sort((u, v) => v.count - u.count);
    return { n, regions: regions.slice(0, 8) };
  };
});

const press = async (k, ms = 250) => {
  await p.evaluate(() => document.getElementById("game").contentWindow.focus());
  await p.keyboard.press(k);
  await p.waitForTimeout(ms);
};
const st = () => p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  return {
    open: d.openingScreen?.() ?? null,
    phase: d.phaseKey?.() ?? null,
    stage: d.play?.stage ?? null,
    hand: d.duel?.player.hand.length ?? 0,
  };
});
const until = async (fn, n = 40, ms = 250) => {
  for (let i = 0; i < n; i++) { if (fn(await st())) return true; await press("Enter", ms); }
  return false;
};

async function report(beat, ref) {
  const { n, regions } = await p.evaluate((r) => window.__diff ? null : null, null)
    ?? await p.evaluate(async (r) => await document.getElementById("game").contentWindow.__diff(r), ref);
  const pct = (100 * n / 76800).toFixed(1);
  console.log(`\n=== ${beat}  vs  ${ref}.png — ${n} of 76800 pixels differ (${pct}%)`);
  for (const g of regions) {
    console.log(`    ${String(g.count).padStart(6)} px  x ${g.x0}..${g.x1}  y ${g.y0}..${g.y1}`);
  }
}

// The beats, in the order the duel reaches them.
const beats = [
  ["challenge", "challenge", async () => true],
  ["folder chooser", "folder-choose", async () => { await press("Enter"); return true; }],
  ["start phase", "start-phase", async () => { await press("Enter"); return true; }],
  ["board after the deal", "board-dealt", async () => {
    await until((s) => s.hand >= 6);
    await until((s) => s.stage === "ask");
    // The question box covers the lower board; the browser beat leaves it clear.
    await p.evaluate(() => {
      const d = document.getElementById("game").contentWindow.__labDuel;
      if (d.play) { d.play.frozen = false; d.play.ask = 0; }
    });
    await press("Enter", 400);
    return true;
  }],
];

for (const [beat, ref, go] of beats) {
  if (only && !beat.includes(only)) continue;
  await go();
  await report(beat, ref);
}
await b.close();
