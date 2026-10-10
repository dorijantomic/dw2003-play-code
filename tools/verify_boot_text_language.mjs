// The boot wizard must read its translated string tables through the shared
// text path on every step — the welcome message, the pack list, the name
// keyboard (which shows the account name) and the confirm panel. Routing a
// screen through the reveal window must not change WHICH decoder reads its
// strings: before the fix the name keyboard's account-name line came out as the
// console encoding ("めためた…") instead of the seeded "Junior".
//
// This drives the production wizard, reads the text the shared painter actually
// draws each step, and asserts no converted line falls back to Japanese. The
// keyboard's own character inventory is not converted, so a middle dot in it is
// allowed; kana, kanji and full-width forms are not.
//
//   tools/run-playwright.sh tools/verify_boot_text_language.mjs [outdir]
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
// Kana, kanji and full-width forms (the console encoding the raw decoder would
// show). U+30FB, the middle dot the keyboard inventory legitimately ships, is
// excluded by ending the katakana range at U+30FA.
const BAD = /[\u3041-\u30fa\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef\ufffd]/;

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

  // The text the shared painter draws this frame, on a scratch canvas.
  const texts = () => page.evaluate(async () => {
    const w = document.getElementById("game").contentWindow;
    const m = await import("./native-screen-text.js");
    const s = w.__state.packSelect._session;
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    return m.drawNativeTextWidgets(c.getContext("2d"), s.widgets.textWidgets(), { revealWindow: true })
      .texts.map((t) => t.replace(/\n/g, "\\n"));
  });
  const press = async () => {
    await page.evaluate(() => document.getElementById("game").contentWindow.__state.packSelect.confirm());
    await page.waitForTimeout(260);
  };

  let sawName = false;
  for (let step = 0; step < 32; step++) {
    await page.waitForTimeout(200);
    const t = await texts();
    const bad = t.filter((s) => BAD.test(s));
    if (bad.length)
      failed |= !check(`step ${step}: boot text is translated, not the console encoding`, false, bad.join(" | "));
    // The account name is the Latin word the name keyboard shows.
    if (t.some((s) => /^[A-Za-z]{3,}/.test(s.replace(/^\n+/, "")))) sawName = true;
    if (sawName && step > 0 && step % 8 === 0)
      await page.locator("#game").screenshot({ path: `${OUT}/wizard-name-entry-after.png` });
    if (!bad.length && broad(t)) check(`step ${step}: boot text translated`, true, t.join(" | "));
    await press();
  }
  failed |= !check("the wizard showed a Latin account name at its name keyboard", sawName);
  failed |= !check("no page errors", errors.length === 0, errors.join(" | "));
  writeFileSync(`${OUT}/boot-text-language.txt`, steps.join("\n") + "\n");
} finally {
  await browser.close();
}
function broad(t) { return t.length >= 3 && t.every((s) => !BAD.test(s)); }
process.exit(failed ? 1 : 0);
