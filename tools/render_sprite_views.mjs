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
if (process.env.HOLD_ROOT) {
  // Hold the root bone where it starts the loop: the body's own drift (a hover bob on a longer cycle than the
  // wing beat) would jump at every wrap of a short field loop. The field clip adds its own bob.
  // Its tilt too: on the same long cycle, it swings the head and wings back and forth from the side.
  await page.evaluate((f0) => {
    const anim = window._model.bones[0].anim;
    for (const name of ["ch1", "ch2"]) {
      const ch = anim[name];
      const k = [...ch].reverse().find((x) => x[3] <= f0) ?? ch[0];
      anim[name] = [[k[0], k[1], k[2], 0], [k[0], k[1], k[2], 30000]];
    }
  }, loop[0]);
}
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
  // SPIN=<frame>: hold the pose at that frame and turn the root through one full forward roll over the n
  // pictures (Kunemon's rolling attack as his walk). The root keeps the lift the attack gives it there.
  const spin = process.env.SPIN ? Number(process.env.SPIN) : null;
  const root = spin == null ? null : await page.evaluate((f) => {
    const a = window._model.bones[0].anim;
    const at = (ch) => [...ch].reverse().find((k) => k[3] <= f) ?? ch[0];
    return { ch1: at(a.ch1), ch2: a.ch2[0] };
  }, spin);
  for (const [name, rel] of dirs) {
    await view({ theta: front + rel, phi: pitch });
    for (let i = 0; i < n; i++) {
      // mid-step samples: frame 0 itself is often the model's rest pose, not part of the loop
      let f = Math.round(loop[0] + (loop[1] - loop[0]) * (i + 0.5) / n);
      if (spin != null) {
        f = spin;
        await page.evaluate(({ r, ang }) => {
          const a = window._model.bones[0].anim;
          a.ch1 = [[r.ch1[0], r.ch1[1], r.ch1[2], 0], [r.ch1[0], r.ch1[1], r.ch1[2], 30000]];
          a.ch2 = [[ang, r.ch2[1], r.ch2[2], 0], [ang, r.ch2[1], r.ch2[2], 30000]];
        }, { r: root, ang: Math.round(4096 * i / n) });
        await page.evaluate((x) => window._mv.setFrame(x), f - 1);
        await page.waitForTimeout(50);
      }
      await page.evaluate((x) => window._mv.setFrame(x), f);
      await page.waitForTimeout(200);
      await snap(`${OUT}/${name}_${i + 1}.png`);
    }
  }
}
await browser.close();
console.log("done");
