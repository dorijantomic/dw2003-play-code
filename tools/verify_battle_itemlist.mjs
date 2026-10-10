// In-battle ITEM list: the translated pro/fightstg screen, read where it draws.
//
// Opens the opening's story battle, walks the command list down to Item, and then
// asserts the geometry the original's F0x8009543C / F0x8009563C / F0x800957B4
// produce: seven rows at y = 69 + 14*i with the icon at x = 29 and the name at
// x = 42, the list window / quantity pane / description pane cels at (8,62) /
// (166,160) / (11,188), the page arrows at (16,169) and (144,169), the
// "L1"/"R1" hints at (26,169)/(128,169), the quantity figure at (172,165) and its
// caption at (198,165) and the description title at (20,194). It then presses
// Down past the last row (the original clamps, it does not wrap), presses both
// page keys on a single-page list (nothing moves) and cancels with the button the
// original tests (Cross), which returns to the command list.
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_battle_itemlist.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BTIL_ROOT || `${baseUrl(Number(process.env.VERIFY_PORT) || 8741)}/`;
const OUT = process.env.BTIL_SHOT || ".bunny-scratch/battle-itemlist";
mkdirSync(OUT, { recursive: true });

const ROW_Y = [69, 83, 97, 111, 125, 139, 153];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
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
  // Four HP charges and two battle disks: enough for one page, so the page keys
  // have nothing to do and Down can be pressed past the last row.
  localStorage.setItem("inventory", JSON.stringify([
    { id: 43, qty: 3 }, { id: 44, qty: 1 }, { id: 45, qty: 2 }, { id: 46, qty: 1 },
    { id: 66, qty: 9 }, { id: 67, qty: 1 },
  ]));
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
// The battle canvas is scaled to the window, so crop the shot to it: the full
// page would show the debug panel and a corner of the 3D scene instead.
const shot = async (name) => {
  const box = await page.locator("#stage canvas").first().boundingBox().catch(() => null);
  const png = box
    ? await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } })
    : await page.screenshot();
  writeFileSync(`${OUT}/${name}.png`, png);
  console.log("shot", name);
};

const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) problems.push(msg);
};

/** The translated session's recorded picture calls and text-widget anchors. */
const readLayout = () => page.evaluate(() => {
  const screen = window.__battleItemNative;
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
    count: screen.diagnostics().count,
    ids: screen.diagnostics().ids,
    sounds: screen.diagnostics().sounds,
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
  // The command list is the translated six-row screen (Fight / Tech / DV /
  // Tag / Item / Run), so four Down presses from Fight is Item. Each press is
  // lost if the command list is not reading the pad yet.
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready, null, { timeout: 10_000 });
  for (let i = 0; i < 4; i++) await tap("ArrowDown");
  await shot("item-command-row");
  for (let i = 0; i < 4; i++) {
    await tap("Enter");
    if (await page.evaluate(() => window.__battleB?.()?.state === 4)) break;
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 4, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready, null, { timeout: 10_000 });
  await shot("item-list-open");

  const layout = await readLayout();
  expect(layout?.execution === "translated", `the list runs translated logic (${layout?.execution})`);
  expect(layout?.ready === true, "the screen is live and reading the pad");
  expect(JSON.stringify(layout?.ids) === JSON.stringify([43, 44, 45, 46, 66, 67]),
    `the six carried items are listed in id-table order (${JSON.stringify(layout?.ids)})`);
  expect(layout?.count === 6, `the list counted six items (${layout?.count})`);

  const icons = (layout?.sprites ?? []).filter((s) => s.pack === 0x02860000);
  expect(icons.length === 6, `one row icon per item from CMFONT (${icons.length})`);
  expect(icons.every((s) => s.x === 29), `every row icon sits at x=29 (${icons.map((s) => s.x)})`);
  const iconY = icons.map((s) => s.y);
  expect(iconY.every((y, i) => y === ROW_Y[i]), `row icons at y = 69 + 14*i (${iconY})`);

  const chrome = (layout?.sprites ?? []).filter((s) => s.pack === 0x04550000);
  const celAt = (cel, x, y) => chrome.some((s) => s.cel === cel && s.x === x && s.y === y);
  expect(celAt(0x27, 8, 62), "the list window (cel 0x27) is at (8,62)");
  expect(celAt(0x28, 166, 160), "the quantity pane (cel 0x28) is at (166,160)");
  expect(celAt(0x31, 11, 188), "the description pane (cel 0x31) is at (11,188)");

  const texts = layout?.texts ?? [];
  const has = (x, y) => texts.some((t) => t.x === x && t.y === y);
  expect(has(42, 69) && has(42, 139), "row names run x=42 from y=69 to y=139 (pitch 14)");
  expect(has(26, 169) && has(128, 169), 'the "L1"/"R1" hints sit at (26,169) and (128,169)');
  // The hints are kind-3 text elements whose colour row method +0x138 set to 2
  // (FIGHTSTG_F0x8009563C, fightstg.s:19216-:19252): the number face's flat
  // white, not the amber of row 0. Read from the live widget's +0x50 and +0xC0.
  const hints = texts.filter((t) => (t.x === 26 && t.y === 169) || (t.x === 128 && t.y === 169));
  expect(hints.length === 2, `both page hints are live (${hints.length})`);
  expect(hints.every((t) => t.kind === 3),
    `both hints are kind 3 (${hints.map((t) => t.kind)})`);
  expect(hints.every((t) => t.clut === 2),
    `both hints read CLUT row 2 (${hints.map((t) => t.clut)})`);
  expect(has(172, 165) && has(198, 165),
    "the quantity figure and its caption sit at (172,165) and (198,165)");
  expect(has(20, 194), "the description title bar sits at (20,194)");

  // Down past the last row: the original clamps at the last row, it does not wrap.
  for (let i = 0; i < 8; i++) await tap("ArrowDown");
  const afterDown = await page.evaluate(() => window.__battleItemNative.diagnostics());
  const rows = afterDown.rows;
  expect(afterDown.selection === rows - 1,
    `Down eight times stops on the last row ${rows - 1} (selection ${afterDown.selection}, rows ${rows})`);
  await shot("item-list-bottom-row");
  // The blips the original plays: the row move is 0x4001B.
  expect((afterDown.sounds ?? []).includes(0x4001b),
    `the row move played the original's 0x4001B blip (${JSON.stringify(afterDown.sounds)})`);

  // Both page keys on a single-page list: the page does not move.
  await tap("q"); // L1
  await tap("e"); // R1
  const afterPage = await page.evaluate(() => window.__battleItemNative.diagnostics());
  expect(afterPage.page === 0, `L1/R1 on a one-page list keep page 0 (page ${afterPage.page})`);

  // Cancel is the button the original tests: pad word 0x4000, which x and Escape reach
  // (engine/systems/input-map.ts; c reached it before 2026-10-03).
  await tap("x");
  await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 5_000 })
    .then(() => expect(true, "Cross cancels the ITEM list and returns to the command list"))
    .catch(() => expect(false, "Cross did not leave the ITEM list"));

  await shot("item-list-after-cancel");
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  try {
    console.log("DUMP", JSON.stringify(await page.evaluate(() => ({
      state: window.__battleB?.()?.state ?? null,
      item: window.__battleItemNative?.diagnostics?.() ?? null,
    }))));
  } catch { /* page may be gone */ }
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}

console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exit(problems.length ? 1 : 0);