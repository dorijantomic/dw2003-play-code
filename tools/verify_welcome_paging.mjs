// The registration wizard's welcome message must PAGE, not stop at its first
// line. The message is one resource string (esnameet intro_message) whose
// [pause] control codes page it; the shared text-element path paints the
// element's own reveal window. This drives the production wizard (openPackSelect
// -> packselect-translated WizardRootSession, the same route the opening uses)
// and checks that pressing the button paints a DIFFERENT page of text, using a
// pixel signature of the message line only (the blinking name cursor sits to
// the right and is excluded).
//
//   python3 -m http.server 8741 --directory web   (or the running server)
//   tools/run-playwright.sh tools/verify_welcome_paging.mjs [outdir]
//
// Prints PASS/FAIL. Exits non-zero on failure.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "captures/playtest-2026-10-07-you";
mkdirSync(OUT, { recursive: true });
const steps = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line); steps.push(line); return ok;
};

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(`${baseUrl(8741)}/ui-lab.html?screen=packselect`);
  await page.waitForFunction(() => {
    const w = document.getElementById("game")?.contentWindow;
    return w && w.__state?.packSelect?._session;
  }, null, { timeout: 40000 });
  await page.waitForTimeout(4500);

  // One snapshot: the intro element's reveal window, and a signature of the
  // pixels our build actually paints in the message line.
  const snap = () => page.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    const s = w.__state.packSelect._session;
    let best = null;
    for (const t of s.widgets.textWidgets()) {
      if (!best || (t.lines?.[0]?.len ?? 0) > (best.lines?.[0]?.len ?? 0)) best = t;
    }
    const c = w.document.getElementById("game");
    const ctx = c.getContext("2d");
    const sc = c.width / 320;
    // The message line only: native x 60..185 (cursor at x>=189), y 53..71.
    const img = ctx.getImageData(Math.round(60 * sc), Math.round(53 * sc),
      Math.round(125 * sc), Math.round(18 * sc));
    let h = 2166136261;
    for (let i = 0; i < img.data.length; i += 4) {
      h ^= (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
      h = Math.imul(h, 16777619);
    }
    return { revealFirst: best?.revealFirst, revealEnd: best?.revealEnd,
             len: best?.lines?.[0]?.len, sig: (h >>> 0).toString(16) };
  });
  const press = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.evaluate(() => document.getElementById("game").contentWindow.__state.packSelect.confirm());
      await page.waitForTimeout(550);
    }
  };

  const p1 = await snap();
  await page.locator("#game").screenshot({ path: `${OUT}/welcome-page1-after.png` });
  await press(3);
  const p2 = await snap();
  await page.locator("#game").screenshot({ path: `${OUT}/welcome-page2-after.png` });
  await press(3);
  const p3 = await snap();
  await page.locator("#game").screenshot({ path: `${OUT}/welcome-page3-after.png` });

  console.log("page1", JSON.stringify(p1));
  console.log("page2", JSON.stringify(p2));
  console.log("page3", JSON.stringify(p3));

  failed |= !check("the message element pages past its first line",
    p2.revealFirst > p1.revealFirst, `revealFirst ${p1.revealFirst} -> ${p2.revealFirst}`);
  failed |= !check("the painted message text changes with the page",
    p1.sig !== p2.sig && p2.sig !== p3.sig, `signatures ${p1.sig} / ${p2.sig} / ${p3.sig}`);
  failed |= !check("no page errors", errors.length === 0, errors.join(" | "));
  writeFileSync(`${OUT}/welcome-paging.txt`, steps.join("\n") + "\n");
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
