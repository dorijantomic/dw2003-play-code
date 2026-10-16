// Photograph a battle model (web/model-viewer.html) from the field sprite's directions, every frame of
// one animation, on flat green: a reference sheet to hand an image generator ("redraw this as pixel art").
//
// Server: python3 -m http.server <port> --directory web (VERIFY_PORT)
// Run:    tools/sprite-views.sh <model> [outdir] [frames]   (this script, then tools/sprite_views_sheet.py)
//   or     tools/run-playwright.sh tools/render_sprite_views.mjs <model> <outdir> [frames] [--probe]
//   --probe: one picture per 45 degrees, to check the model's front.
// The loop: a battle model's idle (its stance) is the first stretch of its animation, ending where the root
// bone comes back to its frame-0 pose. LOOP=start:end overrides it. ZOOM, PITCH and FRONT tune the camera.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const probe = process.argv.includes("--probe");
const [model = "m217pdev", OUT = "/tmp/sprite-views", framesArg = "8"] = args;
const front = Number(process.env.FRONT ?? 0);        // camera angle that sees the model's face
const pitch = Number(process.env.PITCH ?? 0.3);     // radians above the horizon (field camera)
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${model}`);
await page.waitForFunction(() => window._model && window._mv, null, { timeout: 60000 });
await page.waitForTimeout(800);
const loop = process.env.LOOP ? process.env.LOOP.split(":").map(Number) : await page.evaluate(() => {
  const ch = window._model.bones?.[0]?.anim?.ch1 ?? [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const back = ch.find((k) => k[3] >= 20 && same(k, ch[0] ?? []));
  return [0, back ? back[3] : 60];
});
console.log("loop:", loop.join(".."));
await page.evaluate(() => { window._mv.clear = [0, 1, 0, 1]; document.getElementById("overlay").style.display = "none"; });

const canvas = page.locator("#c");
const snap = async (file) => writeFileSync(file, await canvas.screenshot());
// The viewer fits its camera to the model; ZOOM is a multiple of that fitted distance, so it suits any model.
const fitted = await page.evaluate(() => window._mv.getCamera());
const zoomDist = fitted.dist * Number(process.env.ZOOM ?? 0.6);
const view = (cam) => page.evaluate((t) => window._mv.setCamera(t), { dist: zoomDist, ...cam });

if (process.env.FRAMES) {
  // the front view over a frame range: "start:end:step", to find the animation's loop
  const [a, b, st] = process.env.FRAMES.split(":").map(Number);
  await view({ theta: front, phi: pitch });
  for (let f = a; f <= b; f += st) {
    await page.evaluate((x) => window._mv.setFrame(x), f);
    await page.waitForTimeout(150);
    await snap(`${OUT}/f_${String(f).padStart(4, "0")}.png`);
  }
} else if (probe) {
  await page.evaluate((f) => window._mv.setFrame(f), loop[0]);
  for (let k = 0; k < 8; k++) {
    await view({ theta: k * Math.PI / 4, phi: pitch });
    await page.waitForTimeout(250);
    await snap(`${OUT}/probe_${k * 45}.png`);
  }
} else {
  // The five drawn directions; the game mirrors the other three. Camera angle relative to the face.
  // A larger camera angle turns the model's face toward the screen's left.
  const dirs = [["1_down", 0], ["2_down-left", Math.PI / 4], ["3_left", Math.PI / 2], ["4_up-left", 3 * Math.PI / 4], ["5_up", Math.PI]];
  const n = Number(framesArg);
  for (const [name, rel] of dirs) {
    await view({ theta: front + rel, phi: pitch });
    for (let i = 0; i < n; i++) {
      // mid-step samples: frame 0 itself is often the model's rest pose, not part of the loop
      const f = Math.round(loop[0] + (loop[1] - loop[0]) * (i + 0.5) / n);
      await page.evaluate((x) => window._mv.setFrame(x), f);
      await page.waitForTimeout(200);
      await snap(`${OUT}/${name}_${i + 1}.png`);
    }
  }
}
await browser.close();
console.log("done");
