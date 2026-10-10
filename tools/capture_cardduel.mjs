// Capture the walker's card duel screen at each phase, for comparison against
// the original-game reference strip in web/assets/ref/cardduel/ (built by
// tools/build_cardduel_refs.py from the 2026-08-05 rig screenshots).
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: tools/run-playwright.sh tools/capture_cardduel.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardduel";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

await p.click('[data-scr="cardduel"]');
await p.waitForTimeout(1500);
// The duel opens on the CHALLENGE screen, then the folder chooser, which is
// the order the rig capture shows (frame 510, then frame 612). Confirm through
// the challenge and take folder 1.
async function press(key = "Enter", settle = 800) {
  await p.evaluate(() => document.getElementById("game").contentWindow.focus());
  await p.keyboard.press(key);
  await p.waitForTimeout(settle);
}

const phaseOf = () => p.evaluate(() => document.getElementById("game").contentWindow.__labDuel?.phaseKey?.() ?? null);

// Draw the duel into a native 320x240 buffer (the screen's own resolution, so
// draw() runs at scale 1) — that makes every shot pixel-comparable with the rig
// captures in web/assets/ref/cardduel/. Element screenshots of the live canvas
// also come back blank under this headless build.
async function shot(name) {
  const url = await p.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    const c = w.document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    w.__labDuel.draw(g, 320, 240);
    return c.toDataURL("image/png");
  });
  writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  console.log("shot", name, "phase =", await phaseOf());
}

await shot("00-challenge");
await press();
await shot("01-chooser");
await press();
await shot("02-open");
// Step the duel forward; the screen refuses input while the board animates, so
// give each press time to settle before the next.
for (let i = 3; i <= 8; i++) {
  await press("Enter", 2500);
  await shot(`${String(i).padStart(2, "0")}-step`);
}
await b.close();
