// Player-visible check: the fixed still sprites, BOTH members, in ORDINARY play.
//
// The two registry members that pin one decoration to a fixed map point and run
// a cycling palette plus a one-shot burst 32px above it:
//
//   s310 id 852 (0x354)  the A.o.A. Headquarters machine at (620, 252)
//   s311 id 838 (0x346)  the Amaterasu-side twin at (271, 411)
//
// Both are drawn by the translated system (engine/systems/stage-fixed-sprite.ts)
// instead of the original overlay machine code. Decode:
// docs/research/field/stage-object-registry-2026-10-04.md section 10.2
//
// Boots each room with NO research flags - no ?nativeStages, so the original
// overlay machine code is NOT running - fires the member the way the stage
// script does (the SETANIM line wstag310's event 821 / wstag311's event 982
// run), and reports for each: how many sprites exist, which clips and palette
// values they cycle through, how many layer jobs they queue, and whether their
// pixels reach the canvas. Frame series are written for the eye.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_fixed_sprites.mjs [outdir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || ".bunny-scratch/fixed-sprites";
const FRAMES = Number(process.env.FRAMES || 20);
const MEMBERS = [
    { stage: "s310", id: 852, x: 620, y: 252 },
    { stage: "s311", id: 838, x: 271, y: 411 },
];
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

try {
  for (const m of MEMBERS) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const logs = [];
    page.on("console", (c) => logs.push(`${c.type()}: ${c.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`${baseUrl(8963)}/?skipTitle=1&map=${m.stage}`);
      const style = page.locator("#asset-mode-authentic");
      if (await style.isVisible().catch(() => false)) await style.click();
      await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
      await page.waitForTimeout(1200);

      // Park the camera on the decoration so its box is on the canvas, then
      // read a checksum over that box: the floor under it is opaque, so only a
      // change in the box proves the sprite actually drew.
      const setup = await page.evaluate(async ([x, y]) => {
          const so = await import("/stage-objects.js");
          const ns = await import("/native-stage.js");
          window.__state.x = x;
          window.__state.y = y;
          return { native: ns.nativeStage(location.pathname.split("map=")[1]) !== null,
                   stage: so.stageObjectState(location.pathname.split("=")[1] ?? "") };
      }, [m.x, m.y]);

      const read = async () =>
          page.evaluate(async ([stage, x, y]) => {
              const so = await import("/stage-objects.js");
              const st = so.stageObjectState(stage);
              const o = st.fixedSprites?.[0] ?? null;
              // The box is over the decoration's own fixed point, so it is
              // measurable before the member is constructed too - which is
              // exactly what makes the before/after comparison meaningful.
              let box = null;
              if (window.__lastCam) {
                  const c = document.querySelector("canvas");
                  const g = c.getContext("2d");
                  const z = window.__lastCam.zoom || 1;
                  const sx = Math.round((x - window.__lastCam.x) * z);
                  const sy = Math.round((y - 32 - window.__lastCam.y) * z);
                  const w = Math.round(64 * z);
                  const h = Math.round(80 * z);
                  if (sx >= 0 && sy >= 0 && sx + w <= c.width && sy + h <= c.height) {
                      const d = g.getImageData(sx, sy, w, h).data;
                      let sum = 0;
                      for (let i = 0; i < d.length; i += 4) {
                          sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
                      }
                      box = sum;
                  }
              }
              const ps = (await (await fetch("/assets/data/point_sprites.json")).json())[stage];
              const rect = o?.frontClip
                  ? (ps.sprites[`${o.frontClip}@${o.ctr}`] ?? ps.sprites[String(o.frontClip)])
                  : null;
              return { state: st, box, rect: rect ? rect[0] : null };
          }, [m.stage, m.x, m.y]);

      // BEFORE: nothing constructed, which is what the shipped game showed
      // before this port. Wait until the parked camera has actually put the
      // decoration's box on the canvas, so the checksum is comparable.
      await page.waitForFunction(
          ([x, y]) => {
              const cam = window.__lastCam;
              if (!cam) return false;
              const c = document.querySelector("canvas");
              const z = cam.zoom || 1;
              const sx = (x - cam.x) * z;
              const sy = (y - 32 - cam.y) * z;
              return sx >= 0 && sy >= 0 && sx + 64 * z <= c.width && sy + 80 * z <= c.height;
          },
          [m.x, m.y],
          { timeout: 15000 },
      );
      const before = await read();
      await page.screenshot({ path: `${OUT}/${m.stage}-before.png` });

      // Fire it the way the stage script does.
      const fired = await page.evaluate(async ([stage, id]) => {
          const so = await import("/stage-objects.js");
          return so.fireStageObject(stage, id, 821);
      }, [m.stage, m.id]);
      await page.waitForTimeout(120);

      const samples = [];
      for (let i = 0; i < FRAMES; i++) {
          samples.push(await read());
          if (i % 2 === 0) {
              await page.screenshot({ path: `${OUT}/${m.stage}-f${String(i).padStart(2, "0")}.png` });
          }
          await page.waitForTimeout(120);
      }

      const live = samples.map((s) => s.state.fixedSprites?.[0] ?? null).filter(Boolean);
      const ctrs = [...new Set(live.map((o) => o.ctr))].sort((a, b) => a - b);
      const bursts = [...new Set(live.map((o) => o.burstClip).filter((c) => c !== 0))]
          .sort((a, b) => a - b);
      const jobs = Math.max(0, ...live.map((o) => o.jobs));
      const boxes = samples.map((s) => s.box).filter((v) => typeof v === "number");
      // Frames whose palette value differs must differ on the canvas too.
      const byCtr = new Map();
      for (const s of samples) {
          const o = s.state.fixedSprites?.[0];
          if (typeof s.box === "number" && o) byCtr.set(o.ctr, s.box);
      }
      const paletteChanged = byCtr.size > 1 && new Set(byCtr.values()).size === byCtr.size;
      const changedFromBefore = before.box !== null
          && boxes.some((v) => v !== before.box);
      const rects = [...new Set(samples.map((s) => s.rect && `${s.rect.w}x${s.rect.h}`))];
      const ok = fired === true && live.length === FRAMES && jobs > 0 && !setup.native
          && paletteChanged && changedFromBefore && rects.length === 1 && rects[0] !== null;
      results.push({
        member: `${m.stage} id ${m.id}`, fired, sprites: live.length, jobs,
        paletteValues: ctrs, burstClips: bursts, atlasRect: rects[0] ?? null,
        boxBefore: before.box, boxesDiffer: [...new Set(boxes)].length,
        nativeRuntime: setup.native, verdict: ok ? "OK" : "FAIL",
      });
      console.log(`--- ${m.stage} id ${m.id} ---`);
      console.log("FIRED", fired, "SPRITES_ALIVE", `${live.length}/${FRAMES}`, "JOBS", jobs);
      console.log("PALETTE_VALUES", ctrs.join(","), "BURST_CLIPS", bursts.join(","));
      console.log("CTR_SEQUENCE", live.map((o) => o.ctr).join(","));
      console.log("ATLAS_RECT", rects[0], "BOX_BEFORE", before.box,
          "DISTINCT_BOXES", [...new Set(boxes)].length, "NATIVE", setup.native);
      console.log("VERDICT", ok ? "OK" : "FAIL");
      for (const l of logs) console.log(`  [${m.stage}] ${l}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log("=== SUMMARY ===");
for (const r of results) console.log(JSON.stringify(r));
const allOk = results.length === MEMBERS.length && results.every((r) => r.verdict === "OK");
console.log("ALL_MEMBERS_OK", allOk);
process.exit(allOk ? 0 : 1);
