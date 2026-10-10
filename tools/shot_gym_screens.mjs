// Capture every gym screen from the UI lab: the pod select, the drill grid,
// the TP amount, the confirm, a training rep and the result.
// Needs `python3 -m http.server 8742 --directory web` already running.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/gymshots";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

// The lab's stand-in party starts with no TP, and the gym refuses every
// drill without it, so the later screens are unreachable. Give it some.
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("gym");
  w.__labClose();
  for (const b of w.__state.partyStats ?? []) if (b) b.tp = 99;
  if (w.__state.partnerStats) w.__state.partnerStats.tp = 99;
  // (partnerStats may be null once the roster is built from partyStats)
});
await p.click('[data-scr="gym"]');
await p.waitForTimeout(1800);

// Read the game canvas's OWN pixels (640x480, an exact 2x of the 320x240 the
// game draws). Screenshotting the iframe element instead resamples 640 into
// the element's 642 CSS pixels, which duplicates a column beside every
// high-contrast edge -- that is where the "faint seam down the plates" in the
// 2026-09-04 captures came from. The plates have no seam.
const grab = async (path) => {
  const data = await p.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    const c = [...w.document.querySelectorAll("canvas")]
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return c.toDataURL("image/png");
  });
  writeFileSync(path, Buffer.from(data.split(",")[1], "base64"));
};
const shot = async (name) => {
  await p.waitForTimeout(900);
  await grab(`${out}/${name}.png`);
  console.log("shot", name);
};
const key = async (k, n = 1) => {
  for (let i = 0; i < n; i++) { await p.keyboard.press(k); await p.waitForTimeout(260); }
};

await shot("1-select");
await key("c");            // pick the pod
await shot("2-drills");
await key("c");            // pick the drill
await shot("3-tp");
await key("c");            // pick the TP amount
await shot("4-confirm");
await key("c");            // yes
await p.waitForTimeout(2600);
await shot("5-reps");
// The reps resolve on their own; the result window opens over the still-running
// scene. Walk the tail one step at a time so the result page is captured
// instead of being pressed straight through.
// The reps resolve on their own and the result page then WAITS for a press,
// so the tail is shot without pressing anything. Pressing through it is how an
// earlier run kept missing the result.
for (let i = 0; i < 16; i++) {
  await p.waitForTimeout(800);
  await grab(`${out}/6-tail-${String(i).padStart(2, "0")}.png`);
}
await shot("6-result");
console.log("shot tail");
await b.close();
