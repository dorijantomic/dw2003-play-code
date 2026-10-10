// Headless proof that a Digimon's eyes actually blink in the walker.
//
// The disc keeps the eye open, half closed and shut as three spare rectangles on the
// Digimon's own texture page and copies one over the eye whenever the state changes —
// a VRAM-to-VRAM blit, FIGHTSTG_F0x8008b160 (claims
// smdldata-pool-slot-is-the-per-model-animated-texture-patch-list-2026-08-18 and
// fight-texture-patch-pictures-are-eye-states-and-loop-frames-2026-08-18). The walker
// does the same with texSubImage2D.
//
// The blink itself is six ticks long, so a wall-clock screenshot can never be relied
// on to catch it. This drives it through the same door the original has: the fighter
// state code that F0x8008b118 turns into a held eye variant. State 1 lets the blink
// run (open), state 2 holds half closed, states 4..11 hold shut. One capture per state,
// framed on the face, plus a pixel diff so the proof does not rest on the eye.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_texture_patches.mjs [output-directory]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = resolve(process.argv[2] ?? "/tmp/texture-patches");
await mkdir(outDir, { recursive: true });

const MODEL = process.env.MODEL ?? "m003agum";
// Half, then shut, then open. The order matters: the original only re-blits when the
// variant CHANGES, so the page as authored is what a player sees until the first blink.
// Ending on open therefore reaches variant 0 through a real copy rather than through the
// authored pixels, which are not byte-identical to it — the CLUT bake leaves the texels
// no face covers transparent, and a copy fills the whole rectangle.
// label, the state code, and the eye variant F0x8008b118 says that state must produce.
// Half, then shut, then open. The order matters: the original only re-blits when the
// variant CHANGES, so the page as authored is what a player sees until the first blink.
// Ending on open therefore reaches variant 0 through a real copy rather than through the
// authored pixels, which are not byte-identical to it — the CLUT bake leaves the texels
// no face covers transparent, and a copy fills the whole rectangle.
const STATES = [["half", 2, 1], ["shut", 4, 2], ["open", 1, 0]];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 700 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  page error:", m.text()); });

await page.goto(`${origin}/battle-lab.html`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__r, null, { timeout: 15000 });
await page.evaluate((model) => window.__r.setPlayerDigimon(model), MODEL);
// The page pixels and the placement table both land asynchronously.
await page.waitForFunction(
  () => window.__r.debugPatchState("player").entries > 0
     && window.__r.debugPatchState("player").page !== null,
  null, { timeout: 15000 });

const state = await page.evaluate(() => window.__r.debugPatchState("player"));
console.log(`${MODEL}: ${state.entries} patch(es), page ${state.page.width}x${state.page.height} `
          + `(scale ${state.page.scale})`);
assert.ok(state.entries > 0, "the model has an animated texture patch");

const shots = {};
const eyes = {};
for (const [label, code, want] of STATES) {
  const blitted = await page.evaluate(
    (c) => window.__r.debugHoldPatchState("player", c), code);

  // Read the eye back off the live GPU texture FIRST. State 1 lets the blink timer run,
  // so anything slow here (a screenshot is) can let the next blink land mid-check.
  const read = await page.evaluate(() => window.__r.debugReadPatchPixels("player", 0));
  assert.ok(read, "the destination rectangle could be read back");
  assert.equal(read.variant, want, `${label}: state ${code} must select variant ${want}`);
  assert.equal(read.mismatched, 0,
    `${label}: ${read.mismatched} bytes of the destination differ from variant ${read.variant}`);
  eyes[label] = createHash("sha256").update(Uint8Array.from(read.rgba)).digest("hex").slice(0, 12);
  console.log(`  ${label} (state ${code}): re-blitted ${blitted}, variant ${read.variant}, `
            + `${read.width}x${read.height} read back, 0 bytes wrong, eye ${eyes[label]}`);

  shots[label] = await page.locator("#cv").screenshot();
  await writeFile(resolve(outDir, `${MODEL}-${label}.png`), shots[label]);

  // Save the eye itself at texture resolution — this is the before/after that shows it.
  const png = await page.evaluate(({ w, h, rgba }) => {
    const c = document.createElement("canvas");
    c.width = w * 8; c.height = h * 8;
    const src = document.createElement("canvas");
    src.width = w; src.height = h;
    src.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL().split(",")[1];
  }, { w: read.width, h: read.height, rgba: read.rgba });
  await writeFile(resolve(outDir, `${MODEL}-eye-${label}.png`), Buffer.from(png, "base64"));
}

// Three states must put three different pictures on the texture. Screenshots alone
// cannot show this — the idle animation changes every frame either way — so compare
// the read-back eye pixels.
assert.notEqual(eyes.open, eyes.shut, `open ${eyes.open} vs shut ${eyes.shut}`);
assert.notEqual(eyes.open, eyes.half, `open ${eyes.open} vs half ${eyes.half}`);
assert.notEqual(eyes.half, eyes.shut, `half ${eyes.half} vs shut ${eyes.shut}`);
console.log(`OK — three distinct eyes written to ${outDir}`);

// Hand the fighter back to its own animation and check the state the renderer feeds the
// selector really is the model actor's +0x78: the timeline table plus one, 1 while idling
// (claim fightstg-model-actor-0x78-is-the-timeline-table-index-2026-08-18).
await page.evaluate(() => window.__r.debugHoldPatchState("player", null));
const idle = await page.evaluate(() => window.__r.debugPatchState("player"));
assert.equal(idle.animationId, 1, "an idling Digimon sits on timeline table 0, so +0x78 is 1");
console.log(`  released: animationId ${idle.animationId} (timeline table ${idle.timelineTable})`);

// And the opening camera: the shot number comes off the ENEMY's record and frames US.
await page.evaluate(() => window.__r.setEnemyDigimon("m222wood"));
await page.waitForTimeout(600);
const shot = await page.evaluate(() => window.__r.applyIntroCamera());
assert.ok(shot && shot.eye && shot.target, "the enemy's record names an opening shot");
console.log(`  intro camera from the enemy's record: eye ${shot.eye}, H ${shot.H}`);
await writeFile(resolve(outDir, `${MODEL}-intro-camera.png`),
                await page.locator("#cv").screenshot());

await browser.close();
