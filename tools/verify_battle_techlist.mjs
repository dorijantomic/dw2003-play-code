// In-battle TECH list: the translated pro/fightstg screen, read where it draws.
//
// Opens the opening's story battle, walks the command list down to Tech, and
// then asserts the geometry the original's F0x80095E40 / F0x80096048 /
// F0x80096314 produce: six rows at y = 69 + 14*i with the icon at x = 29 and the
// name at x = 42, the list window / MP plate / description pane cels at
// (8,62) / (163,33) / (11,188), the "L1"/"R1" hints at (26,159)/(128,159), the
// MP plate's four widgets at (172,58)/(216,58)/(217,58)/(251,58) and the
// description widgets at (20,194)/(256,208)/(299,208). It then presses Down
// past the last row (the original clamps, it does not wrap), presses both page
// keys on a single-page list (nothing moves) and cancels with the button the
// original tests (word bit 0x4000, BACK), which returns to the command list.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_battle_techlist.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BTL_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.BTL_SHOT || "/tmp/battle-techlist";
mkdirSync(OUT, { recursive: true });

const ROW_Y = [69, 83, 97, 111, 125, 139];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const member = (digimonId, level, xp) => ({
    digimonId, level, xp, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
    stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
    bonuses: {}, elemBonuses: {},
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(3, 5, 0)));
  localStorage.setItem("partyStats", JSON.stringify([member(3, 5, 0), member(7, 5, 0), member(8, 5, 0)]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
});

const tap = async (k, ms = 90) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
  await page.waitForTimeout(60);
};
const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};

const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) problems.push(msg);
};

/** The translated session's recorded picture calls and text-widget anchors. */
const readLayout = () => page.evaluate(() => {
  const screen = window.__battleTechNative;
  const session = screen?._session;
  if (!session) return null;
  const sprites = session.draw.calls
    .filter((c) => c.method === "drawSprite")
    .map((c) => ({ pack: c.args[0] >>> 0, cel: c.args[1], x: c.args[2], y: c.args[3] }));
  // F0x8001AE38 stores D0x8004de00 + kind*0x18 in +0x50 and the colour row in
  // +0xC0 (exe/fns.s:12070-12128, method +0x138 = F0x8001a1f4 at :11132-11134),
  // so a widget's face and its CLUT row both come straight out of the live object.
  const BANK = 0x8004dd74;
  const texts = session.widgets.textWidgets()
    .map((w) => ({
      x: w.penX, y: w.penY,
      kind: (w.font - BANK) / 0x18,
      clut: w.colour,
    }))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return {
    execution: screen.diagnostics().execution,
    ready: screen.diagnostics().ready,
    selection: screen.diagnostics().selection,
    rows: screen.diagnostics().rows,
    page: screen.diagnostics().page,
    moves: session.moves.length,
    sprites, texts,
  };
});

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 15_000;
  let launched = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      tb: window.__textbox?.isOpen?.() ?? false,
    }));
    if (st.battle) { launched = true; break; }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  expect(launched, "the s200 PRE launched the scripted battle");
  if (!launched) throw new Error("no battle");

  // The opening line ("Ambush!") holds the battle controller until it is read: the original arms
  // the command menu only from the script instruction that first reads the line's own slot and
  // returns while it is occupied (`wfightmn.s:1494-1496`), so there is no command list to press
  // until the player has read the line. `waitForCommandMenu` is that one press, shared with every
  // other battle check (tools/verify-battle-wait.mjs).
  await waitForCommandMenu(page);
  // The command list is the translated six-row screen (Fight / Tech / DV / Tag / Item / Run),
  // so one Down press from Fight is Tech. Each press is lost if the list is not reading the pad
  // yet.
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready, null, { timeout: 10_000 });
  await tap("ArrowDown");
  await shot("tech-command-row");
  for (let i = 0; i < 4; i++) {
    await tap("Enter");
    if (await page.evaluate(() => window.__battleB?.()?.state === 3)) break;
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 3, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__battleTechNative?.diagnostics?.().ready, null, { timeout: 10_000 });
  await shot("tech-list-open");

  const layout = await readLayout();
  expect(layout?.execution === "translated", `the list runs translated logic (${layout?.execution})`);
  expect(layout?.ready === true, "the screen is live and reading the pad");

  const icons = (layout?.sprites ?? []).filter((s) => s.pack === 0x02860000);
  expect(icons.length >= 1, `row icons drawn from CMFONT (${icons.length})`);
  expect(icons.every((s) => s.x === 29), `every row icon sits at x=29 (${icons.map((s) => s.x)})`);
  const iconY = icons.map((s) => s.y);
  expect(iconY.every((y, i) => y === ROW_Y[i]), `row icons at y = 69 + 14*i (${iconY})`);

  const chrome = (layout?.sprites ?? []).filter((s) => s.pack === 0x04550000);
  const celAt = (cel, x, y) => chrome.some((s) => s.cel === cel && s.x === x && s.y === y);
  expect(celAt(0x2a, 8, 62), "the list window (cel 0x2A) is at (8,62)");
  expect(celAt(0x29, 163, 33), "the MP plate (cel 0x29) is at (163,33)");
  expect(celAt(0x31, 11, 188), "the description pane (cel 0x31) is at (11,188)");

  const texts = layout?.texts ?? [];
  const has = (x, y) => texts.some((t) => t.x === x && t.y === y);
  expect(has(42, 69) && has(42, 139), "row names run x=42 from y=69 to y=139 (pitch 14)");
  expect(has(26, 159) && has(128, 159), 'the "L1"/"R1" hints sit at (26,159) and (128,159)');
  // The hints are kind-3 text elements whose colour row method +0x138 set to 2
  // (FIGHTSTG_F0x80096048, fightstg.s:19881-:19918): the number face's flat
  // white, not the amber of row 0. Read from the live widget's +0x50 and +0xC0.
  const hints = texts.filter((t) => (t.x === 26 && t.y === 159) || (t.x === 128 && t.y === 159));
  expect(hints.length === 2, `both page hints are live (${hints.length})`);
  expect(hints.every((t) => t.kind === 3),
    `both hints are kind 3 (${hints.map((t) => t.kind)})`);
  expect(hints.every((t) => t.clut === 2),
    `both hints read CLUT row 2 (${hints.map((t) => t.clut)})`);
  expect(has(172, 58) && has(216, 58) && has(217, 58) && has(251, 58),
    "the MP plate's MP label, value, slash and maximum sit at (172,58)/(216,58)/(217,58)/(251,58)");
  expect(has(20, 194) && has(256, 208) && has(299, 208),
    "the description title, MP label and cost sit at (20,194), (256,208) and (299,208)");

  // Down past the last row: the original clamps at the last row, it does not wrap.
  for (let i = 0; i < 8; i++) await tap("ArrowDown");
  const afterDown = await page.evaluate(() => window.__battleTechNative.diagnostics());
  expect(afterDown.selection === 0 || afterDown.selection >= 1,
    `Down eight times leaves a row selected (${afterDown.selection})`);
  const rows = afterDown.rows;
  expect(afterDown.selection === rows - 1,
    `Down eight times stops on the last row ${rows - 1} (selection ${afterDown.selection}, rows ${rows})`);
  await shot("tech-list-bottom-row");

  // Both page keys on a single-page list: the page does not move.
  await tap("q"); // L1
  await tap("e"); // R1
  const afterPage = await page.evaluate(() => window.__battleTechNative.diagnostics());
  expect(afterPage.page === 0, `L1/R1 on a one-page list keep page 0 (page ${afterPage.page})`);

  // Cancel is the button the original tests (word bit 0x4000 = BACK). On an English disc
  // the poll swaps the three face buttons (engine/systems/input-map.ts:44-52), so the
  // player's BACK is the physical Triangle, which is Escape or `x`; `c` is now CONFIRM
  // (0x2000) and would select the row instead of leaving the list.
  await tap("Escape");
  await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 5_000 })
    .then(() => expect(true, "Cross cancels the TECH list and returns to the command list"))
    .catch(() => expect(false, "Cross did not leave the TECH list"));

  await shot("tech-list-after-cancel");
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  try {
    console.log("DUMP", JSON.stringify(await page.evaluate(() => ({
      state: window.__battleB?.()?.state ?? null,
      tech: window.__battleTechNative?.diagnostics?.() ?? null,
    }))));
  } catch { /* page may be gone */ }
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}

console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exit(problems.length ? 1 : 0);