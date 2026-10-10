// Capture the HAND-AUTHORED name-entry keyboard (web/nameentry.js), for
// comparison against the rig framebuffer at web/assets/ref/keyboard.png.
//
// Since the native pro/stdgname screen became the production route, this check
// asks the lab for the `?legacyName=1` rollback (web/ui-lab.html forwards its
// query params to the game iframe). The native route's proofs are
// tools/verify_native_nameentry.mjs and tools/verify_opening_name.mjs.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_nameentry.mjs [out-dir]
//
// Prints the on-canvas rect of each decoded action key so the numbers can be
// checked without eyeballing the image.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/nameentry";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyName=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

await p.click('[data-scr="nameentry"]');
await p.waitForTimeout(1200);

const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");
await canvas.screenshot({ path: `${out}/nameentry.png` });
console.log("shot", `${out}/nameentry.png`);

const keys = await frame.evaluate(async () => {
  const r = await fetch("assets/data/stdgname_ui.json").then((x) => x.json());
  return r.grid.interactive.action_keys.keys.map((k) => ({
    role: k.role, row: k.row, col: k.col, x: k.x, y: k.y, w: k.w, h: k.h,
    clip: k.clip_english,
  }));
});
for (const k of keys) console.log(JSON.stringify(k));

await b.close();
