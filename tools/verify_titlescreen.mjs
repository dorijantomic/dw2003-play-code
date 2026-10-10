// Capture the native title screen from the real game module.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_titlescreen.mjs [out-dir]
//
// Shoots the prompt, the split, and the live menu on each option, printing the
// live state each time so the sequence can be checked without reading the
// image. Decoded 2026-08-14; see
// docs/research/ui/stdwtitl-title-menu-2026-08-14.md.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/titlescreen";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

await p.click('[data-scr="titlescreen"]');
const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");

const peek = () => frame.evaluate(() => {
  const t = window.__labTitle;
  return t && {
    phase: t.phase(), highlight: t.highlight(), box: t.boxAt(),
    optionY: t.optionY(), optionsShown: t.optionsShown(), clips: t.clips(),
  };
});

const shoot = async (tag) => {
  await canvas.screenshot({ path: `${out}/title-${tag}.png` });
  console.log(tag, JSON.stringify(await peek()));
};

// 0. the logo still sliding in (the sequence owner has not raised the menu).
//    Each click of the Lab's entry builds a fresh screen (web/game.js:1199), and
//    the reveal runs on the real clock — 0.98 s of it — so a screen opened while
//    the Lab was still loading its packs is already at the prompt by the time we
//    look. Ask for another screen and catch the one that is really mid-reveal.
const openLabTitle = async () => {
  await p.click('[data-scr="titlescreen"]');
  await frame.waitForFunction(() => !!window.__labTitle, null, { timeout: 5000 });
  // Let the Lab's own render loop draw the new screen before anyone looks at it.
  await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const revealing = () => frame.evaluate(
  () => ["slide", "glow", "intro"].includes(window.__labTitle?.phase?.()),
);
let caught = false;
for (let attempt = 0; attempt < 4 && !caught; attempt += 1) {
  await openLabTitle();
  caught = await revealing();
}
if (!caught) {
  console.error("FAIL: the title reveal finished before it could be captured");
  process.exitCode = 1;
}
await shoot("slide");

// 1. the prompt, after the slide and the glow have finished
await frame.waitForFunction(
  () => window.__labTitle?.phase() === "prompt",
  null,
  { timeout: 10000 },
);
await shoot("prompt");

// 2. START raises the split — the prompt does NOT answer the confirm button.
//    The prompt arm polls the pad's identity button table with code 3
//    (pro/stdwtitl.s:2689-2698, `li $a1, 0x3`), and code 3 IS pad bit 0x08 —
//    START. That is why `confirm()` here used to leave the screen on the prompt
//    and every capture below was the prompt again. The real order after START is:
//    six fields on the prompt's line, the box through three blinks four fields
//    apart, then the two options sliding apart over fifteen (stdwtitl.s:2671-2680,
//    :2728-2740, :2765). Each capture prints the phase it actually landed on.
await frame.evaluate(() => window.__labTitle.start());
await frame.waitForFunction(() => window.__labTitle?.phase() === "split", null, { timeout: 5000 });
await shoot("split");

// 3. the live menu, as it opens (the lower option is lit)
await frame.waitForFunction(() => window.__labTitle?.phase() === "menu", null, { timeout: 5000 });
await shoot("menu-lower");

// 4. move the box up to the other option
await frame.evaluate(() => window.__labTitle.up());
await p.waitForTimeout(120);
await shoot("menu-upper");
if ((await peek()).highlight !== 0) {
  console.error("FAIL: the box did not move to the upper option");
  process.exitCode = 1;
}

// 5. and the real thing: the game's own title screen, which renders the same
//    module into #title-canvas over the native background.
const g = await b.newPage({ viewport: { width: 1000, height: 700 } });
g.on("pageerror", (e) => console.log("PAGEERROR(game):", e.message));
await g.addInitScript(() => {
  try { localStorage.setItem("assetMode", "authentic"); } catch { /* private mode */ }
});
await g.goto(`${baseUrl(8742)}/index.html`, { waitUntil: "load" });
await g.waitForTimeout(5000);
await g.screenshot({ path: `${out}/title-ingame.png` });
console.log("ingame", JSON.stringify(await g.evaluate(() => ({
  nativeClass: document.getElementById("title-screen")?.classList.contains("native"),
  canvasShown: getComputedStyle(document.getElementById("title-canvas")).display,
}))));

await b.close();
