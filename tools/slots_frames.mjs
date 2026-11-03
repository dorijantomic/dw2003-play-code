// Frames of the built arenas from 7 fixed cameras (default director view + 6 free-camera poses), time frozen.
//   OUT=<dir>   save   <dir>/<arena>_<pose>.rgba.gz           (run this on the code BEFORE a refactor)
//   BASE=<dir>  compare with those frames: per pose max byte diff and differing bytes (0 / 0 = identical)
//   [ARENAS=meft1008,meft1013,meft1002]  VERIFY_PORT=8090 tools/verify-lock.sh tools/run-playwright.sh tools/slots_frames.mjs
// Used by tools/verify_slots.mjs (check 1). Numbers only.
import fs from "node:fs";
import zlib from "node:zlib";
import { launch } from "./verify-launch.mjs";
import { openViewer, grab, diff } from "./verify_slots_frame.mjs";

export const POSES = [
  ["default", null],
  ["az0", [[0, 500, 1500], [0, 900, 12000]]],
  ["az90", [[1500, 500, 0], [12000, 900, 0]]],
  ["az180", [[0, 500, -1500], [0, 900, -12000]]],
  ["az270", [[-1500, 500, 0], [-12000, 900, 0]]],
  ["high", [[0, 5000, 9000], [0, 0, 0]]],
  ["low", [[6000, 300, 0], [-6000, -800, 0]]],
];

/** every pose of one arena: [{ pose, buf }] */
export async function arenaFrames(browser, arena, { before = null } = {}) {
  const { page, ctx, errors } = await openViewer(browser, arena);
  await page.waitForTimeout(2500);
  if (before) await before(page);
  const out = [];
  for (const [pose, cam] of POSES) {
    if (cam) {
      await page.evaluate(async ([eye, look]) => {
        const sel = document.getElementById("cam");
        if (sel.value !== "free") { sel.value = "free"; await window.__tools.setFreeCam(true); }
        window.__tools.freeCam.set(eye, look);
      }, cam);
    }
    out.push({ pose, buf: await grab(page, 3) });
  }
  await ctx.close();
  return { frames: out, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ARENAS = (process.env.ARENAS || "meft1008,meft1013,meft1002").split(",");
  const OUT = process.env.OUT, BASE = process.env.BASE;
  if (!OUT && !BASE) { console.error("set OUT=<dir> (save) or BASE=<dir> (compare)"); process.exit(2); }
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  let bad = 0;
  for (const arena of ARENAS) {
    const { frames, errors } = await arenaFrames(browser, arena);
    for (const { pose, buf } of frames) {
      if (OUT) fs.writeFileSync(`${OUT}/${arena}_${pose}.rgba.gz`, zlib.gzipSync(buf, { level: 6 }));
      if (BASE) {
        const f = `${BASE}/${arena}_${pose}.rgba.gz`;
        if (!fs.existsSync(f)) { console.log(`${arena} ${pose}: no base frame`); bad++; continue; }
        const d = diff(buf, zlib.gunzipSync(fs.readFileSync(f)));
        if (d.count) bad++;
        console.log(`${arena} ${pose}: max diff ${d.max}, differing bytes ${d.count}`);
      }
    }
    console.log(`${arena}: ${frames.length} poses, page errors ${errors.length}${errors.length ? " " + errors[0] : ""}`);
  }
  await browser.close();
  if (BASE) console.log(bad ? `FRAMES DIFFER in ${bad} poses` : "FRAMES IDENTICAL");
}
