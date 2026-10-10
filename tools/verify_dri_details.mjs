// tools/verify_dri_details.mjs — the Lab's Switch/picker Details view.
//
// Original: pressing Circle on a Switch list creates an F0x8008E8D0 detail object
// (F0x8008eabc; F0x80088b5c sets unk14=2). Its render F0x8008e4cc draws the SAME
// panel as the "{name} digivolve" screen: banner 0x20@(0x92,0xF), list window
// 0x22@(0x92,0x2A), stat panel 0x2A@(0x54,0x64) + cmfont 0x14@(0x5B,0x7F), name at
// (0x5B,0x6A), "Skill LV" at (0xEB,0x6A), six core values at (0x7D,0x7F+0xE*i),
// seven elements at (0xA7,...) and SIX TECH ICONS at (0xB4,0x8B+0xE*i) with names
// at (0xC2,0x8B+0xE*i). The walker used to draw an invented compact overlay
// (clip 0x2C@(0x92,0x7C), six STAT icons at 0xB4/0x99/0xC1). This check records the
// ordered text/clip calls of the real screen and asserts the decoded panel.
//
// Run: .opencode/autonomy/check-browser tools/verify_dri_details.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DRI_DETAILS_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DRI_DETAILS_SHOT || ".dw3-research/autonomous-plan/shots/dri-details";
mkdirSync(OUT, { recursive: true });

const lead = {
  digimonId: 9, level: 30, xp: 0, hp: 400, maxHp: 400, mp: 160, maxMp: 160,
  stats: { str: 90, def: 60, spt: 70, wis: 70, spd: 60, chr: 40 }, bonuses: {}, elemBonuses: {},
  equippedForms: [27, 39, 0],
  formLedger: [
    { id: 9, formLevel: 99, dvexp: 0, techSlots: [0x2069, 0, 0, 0, 0, 0] },
    { id: 27, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
    { id: 39, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
  ],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("rosterOwned", "1");
}, { lead });

const key = async (k) => {
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
  await page.waitForTimeout(60);
};
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));

// Record one draw pass through the real renderer: the ordered drawImage calls
// (with their native destinations) and the uiText trace, which drawText fills
// whether it renders through the bitmap font or the monospace fallback.
const recordDraw = () => page.evaluate(() => {
  const d = window.__dri;
  const ctx = document.querySelector("canvas#game").getContext("2d");
  const seq = [];
  const origDrawImage = ctx.drawImage.bind(ctx);
  ctx.drawImage = function patched(...args) {
    const [img, a0, a1, , , a4, a5] = args;
    const [sx, sy, dx, dy] = args.length >= 9 ? [a0, a1, a4, a5] : [0, 0, a0, a1];
    seq.push({ op: "clip", src: img && img.src ? String(img.src).split("/").pop() : "canvas",
      dx: Math.round(dx), dy: Math.round(dy) });
    return origDrawImage(...args);
  };
  const trace = new Set();
  globalThis.__uiTextTrace = trace;
  d.draw(ctx, 320, 240);
  globalThis.__uiTextTrace = undefined;
  ctx.drawImage = origDrawImage;
  return { seq, texts: [...trace] };
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const result = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.evaluate(async () => { await window.__dri.dataReady; });
  await page.waitForTimeout(300);

  await page.evaluate(() => window.__dri.openAction(0, window.__state, null));
  await page.waitForFunction(() => window.__dri.screen === "switch_from", null, { timeout: 5_000 });
  await page.waitForTimeout(200);

  result.picker = await page.evaluate(() => ({ screen: window.__dri.screen, details: window.__dri.details }));
  const before = await recordDraw();
  await shot("details-before");
  if (result.picker.details) fail("the details view was already open");
  if (before.texts.includes("Skill LV"))
    fail("the detail panel drew before Circle");

  await key("k");               // 0x1000 on the switch list opens Details
  result.opened = await page.evaluate(() => ({ screen: window.__dri.screen, details: window.__dri.details }));
  const after = await recordDraw();
  await shot("details-view");
  if (result.opened.details !== true) fail(`Circle did not open the details view: ${JSON.stringify(result.opened)}`);

  // The decoded panel's strings: banner header, "Skill LV", and the six TECH
  // names of the highlighted entry (Taomon, equipped slot 0).
  result.techNames = await page.evaluate(() => {
    const target = window.__dri.digimonById[27];
    return (target?.techs ?? []).slice(0, 6).map((id) => window.__dri.skillsById[id]?.name).filter(Boolean);
  });
  result.texts = after.texts.filter((t) => t === "Choose a digivolve." || t === "Skill LV" || result.techNames.includes(t));
  if (!after.texts.includes("Choose a digivolve.")) fail("the decoded panel header is missing");
  if (!after.texts.includes("Skill LV")) fail("the decoded stat panel is missing");
  for (const name of result.techNames)
    if (!after.texts.includes(name)) fail(`the tech row "${name}" did not draw`);

  // Anchors: the highlighted form's name/tech glyph clips at the decoded panel
  // coordinates, and the six tech icon clips at (0xB4, 0x8B+0xE*i).
  // Glyph cells carry their own dx/dy offsets inside the sheet, so allow a small
  // window around the decoded anchor instead of an exact cell origin.
  const clipNear = (x, y) => after.seq.some((c) => c.op === "clip"
    && Math.abs(c.dx - x) <= 10 && c.dy >= y - 4 && c.dy <= y + 12);
  if (!clipNear(0xeb, 0x6a)) fail("the stat panel's Skill LV glyph run is not near (0xEB,0x6A)");
  if (!clipNear(0xc2, 0x8b)) fail("the first tech name's glyph run is not near (0xC2,0x8B)");
  result.techClips = after.seq.filter((c) => c.op === "clip" && c.dx === 0xb4 && c.dy >= 0x8b && (c.dy - 0x8b) % 0x0e === 0).length;
  if (result.techClips < 1) fail(`no tech icon clips drew at 0xB4`);
  // The invented compact overlay's plate is gone.
  if (after.seq.some((c) => c.op === "clip" && c.dx === 0x92 && c.dy === 0x7c))
    fail("the old compact details plate still draws at (0x92,0x7C)");

  await key("x");               // 0x4000 (BACK) closes the detail view
  result.closed = await page.evaluate(() => ({ screen: window.__dri.screen, details: window.__dri.details }));
  if (result.closed.details) fail("Triangle did not close the details view");
  if (result.closed.screen !== "switch_from") fail(`closing details left the switch list: ${result.closed.screen}`);

  if (errors.length) fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, ...result }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
