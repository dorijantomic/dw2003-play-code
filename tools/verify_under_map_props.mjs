// Capture the frames where the props that draw BEHIND the ground map-tile layer
// stand, so the under-map pass can be diffed against the old single pass.
//
// The field submits the ground at ordering-table bucket 7 and these props at 8
// or 10, so on hardware the map art covers them. We used to paint them over the
// flattened map. The measured prediction (tools/audit_point_sprite_depth.py) is
// that no shipped stage sees a difference, because these props sit entirely
// inside ground cut-outs -- this capture is how that prediction is falsifiable.
//
// Needs the web root served: python3 -m http.server 8742 --directory web  (or VERIFY_PORT=<port>)
// Run: tools/run-playwright.sh tools/verify_under_map_props.mjs <outdir> [stage:x:y ...]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const outDir = process.argv[2];
const shots = (process.argv.slice(3).length ? process.argv.slice(3) : [
  "s450:980:500", "s480:709:744", "s615:516:517", "s455:693:366", "s485:1037:464",
]).map((s) => { const [stage, x, y] = s.split(":"); return { stage, x: +x, y: +y }; });

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(`${baseUrl(8742)}/seam-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__seamLab?.ready(), null, { timeout: 30000 });

// Freeze before any map loads. Set after the fact, the records would already
// have advanced by however many frames the entry wipe happened to render.
const freeze = () => page.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__freezeProps = true;
});
await freeze();

for (const { stage, x, y } of shots) {
  await freeze();
  await page.evaluate((s) => window.__seamLab.setMapById(s), stage);
  await page.waitForTimeout(5000); // entry wipe and location title card
  await freeze();
  const png = await page.evaluate(async ([px, py, hideProps]) => {
    const f = document.getElementById("game"), w = f.contentWindow, d = f.contentDocument;
    if (w.__textbox) w.__textbox.dialogue = null;
    w.__hideProps = hideProps;      // the props ARE the subject here
    w.__state.x = px; w.__state.y = py; w.__state.dir = "down";
    w.__labCam(px, py);
    await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
    return d.getElementById("game").toDataURL("image/png");
  }, [x, y, process.env.HIDE_PROPS === "1"]);
  const out = `${outDir}/${stage}.png`;
  writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
  console.log("wrote", out);
}
await browser.close();
