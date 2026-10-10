// In-battle joke menu: what a confused partner is shown, read where it draws.
//
// The confused command list is NOT a second widget: pro/fightstg's sequencer
// sub-state 3 spawns a different owner (FIGHTSTG_F0x8009AB74, tick 0x8009a898,
// built at fightstg.s:16382-16385) which hands the SAME factory F0x8009B0C8 its
// own config 0x800A3634 (:24619-24620) and builds its six rows with
// FIGHTSTG_F0x8009A2DC (:24216-24270). So the player sees the ordinary command
// list's furniture -- the icon cel 0x22 at x 0x10, the names at x 0x24 and
// y 0x6d + 0x13*i, the pulsing marker from the same strip -- carrying the eight
// joke commands 0x6B..0x72 in shuffled order instead of Fight/Tech/DV/Tag/Item/Run.
// No row is greyed: F0x8009A2DC never reads the ailment byte the command list's
// F0x80093CF4 greys on. Confirming hands the row to the owner, which rolls
// F0x800A1910; this check pins the menu and the pick, and the gag it produces.
//
// Server: python3 -m http.server 8815 --directory web
// Run:    VERIFY_PORT=8815 FSB_SHOT=.bunny-scratch/shots tools/run-playwright.sh tools/verify_battle_jokemenu.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";
import { JOKE_COMMANDS, JOKE_FLAVOR } from "../web/vendor/engine.js";

const ROOT = process.env.BJB_ROOT || `${baseUrl(8815)}/`;
const OUT = process.env.BJB_SHOT || process.env.FSB_SHOT || ".bunny-scratch/jokemenu-shot";
mkdirSync(OUT, { recursive: true });

// pro/fightstg's own geometry: the six rows at x 0x24 and y 0x6d + 0x13*i, the
// row icon at x 0x10 with the same y step, and the marker's VRAM copies landing on
// 0x6e + row*0x13 (F0x8009ABD8 reads +0x60/+0x64 out of the config).
const ROW_X = 0x24;
const ROW_Y = (i) => 0x6d + i * 0x13;
const ICON_X = 0x10;
const ICON_CEL = 0x22;

const browser = await chromium.launch({ headless: true });
// The battle canvas is wider than the game's own 640x480 layout box, so give the
// page room: the captures then show the whole picture the player sees.
const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
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

// A press the game can see, held across frames as a player holds it.
const tap = async (k, ms = 90) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
  await page.waitForTimeout(60);
};
const shot = async (name) => {
  // The battle canvas is clipped by the page layout in a 640x480 viewport, so
  // capture the canvas itself: that is the picture the player sees.
  writeFileSync(`${OUT}/${name}.png`, await page.locator("#game").screenshot());
  console.log("shot", name);
};

const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) problems.push(msg);
};

/** The ported list's own picture calls, text anchors and marker copies. */
const readLayout = () => page.evaluate(() => {
  const screen = window.__battleCmdNative;
  const session = screen?._session;
  if (!session) return null;
  const diagnostics = screen.diagnostics();
  return {
    execution: diagnostics.execution,
    ready: diagnostics.ready,
    selection: diagnostics.selection,
    chosen: diagnostics.chosen,
    joke: diagnostics.joke,
    seed: diagnostics.seed,
    sprites: session.draw.calls
      .filter((c) => c.method === "drawSprite")
      .map((c) => ({ pack: c.args[0] >>> 0, cel: c.args[1], x: c.args[2], y: c.args[3] })),
    texts: session.widgets.textWidgets()
      .map((w) => ({ x: w.penX, y: w.penY, colour: w.colour, len: (w.lines[0]?.bytes ?? []).filter((b) => b !== 0).length }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x)),
    moves: session.moves.map((m) => ({ srcX: m.srcX, srcY: m.srcY, dstX: m.dstX, dstY: m.dstY })),
  };
});

let failed = null;
const fail = async (msg) => {
  failed = msg;
  console.error("FAIL:", msg);
  try {
    writeFileSync(`${OUT}/failure-state.json`, JSON.stringify(await page.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      state: window.__battleB?.()?.state ?? null,
      pending: window.__battleB?.()?.pendingAction ?? null,
    })), null, 2));
    await shot("failure");
  } catch { /* page may be gone */ }
};

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
  if (!launched) await fail("the s200 PRE never launched the scripted battle");
  // The opening line has to be read before the command menu is armed (verify-battle-wait.mjs).
  await waitForCommandMenu(page);

  // The ordinary command list first, so the joke list is measured against it.
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready, null, { timeout: 10_000 });
  const plain = await readLayout();
  const plainMenu = await page.evaluate(() => window.__battle?.peek?.()?.menu ?? null);
  expect(plain?.execution === "translated", `the command list runs translated logic (${plain?.execution})`);
  expect(JSON.stringify(plainMenu) === JSON.stringify(["Fight", "Tech", "DV", "Tag", "Item", "Run"]),
    `the ordinary list is the six commands (${JSON.stringify(plainMenu)})`);
  await shot("command-list");

  // Confuse the acting Digimon. power 255 puts F0x800A1910's threshold above the
  // random operand's 127 ceiling, so the confirm is the gag every time
  // (battle-confusion.ts confusionGagRoll, fightstg.s:32143-32160).
  await page.evaluate(() => {
    window.__battleB().player.ailments.confuse = { power: 255 };
  });
  await page.evaluate(() => { window.__battleCmdNative.close(); });
  await page.waitForTimeout(120);
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready, null, { timeout: 10_000 });

  const layout = await readLayout();
  const menu = await page.evaluate(() => window.__battle?.peek?.()?.menu ?? null);
  const perm = await page.evaluate(() => (window.__battleB().confusedMenu ?? []).map((j) => j.jokeIndex));
  console.log("joke rows", JSON.stringify(menu), "indices", JSON.stringify(perm));
  await shot("joke-list");

  expect(layout?.execution === "translated", `the joke list runs translated logic (${layout?.execution})`);
  expect(layout?.seed?.jokeIndices?.length === 6,
    `the list was opened with the shuffle's six joke indices (${JSON.stringify(layout?.seed?.jokeIndices)})`);
  expect(menu?.length === 6, `the player is shown six rows (${JSON.stringify(menu)})`);
  expect(menu?.every((label) => JOKE_COMMANDS.includes(label)),
    `every row is one of the eight joke commands (${JSON.stringify(menu)})`);
  expect(new Set(perm).size === 6, `the six rows are six different jokes (${JSON.stringify(perm)})`);
  expect(layout?.selection === 0,
    `the joke list opens on its first row, as F0x8009AB74 stores 0 (+0x50) (${layout?.selection})`);

  // The shared widget's furniture: six names at x 0x24, y 0x6d + 0x13*i, and the
  // row icon cel 0x22 at x 0x10 on the same pitch.
  const names = (layout?.texts ?? []).filter((t) => t.x === ROW_X);
  expect(names.length === 6, `six name widgets at x=${ROW_X} (${names.map((t) => t.y).join(",")})`);
  expect(names.every((t, i) => t.y === ROW_Y(i)),
    `the rows sit at y = 0x6d + 0x13*i (${names.map((t) => t.y).join(",")})`);
  expect(names.every((t) => t.len > 0), "every row carries text");
  expect(names.every((t) => t.colour === 0),
    `no joke row is greyed, whatever the ailment byte is (${names.map((t) => t.colour).join(",")})`);
  const icons = (layout?.sprites ?? []).filter((s) => s.pack === 0x04550000 && s.cel === ICON_CEL);
  expect(icons.length === 6 && icons.every((s, i) => s.x === ICON_X && s.y === ROW_Y(i)),
    `the shared row icon cel 0x${ICON_CEL.toString(16)} at x=${ICON_X}, same pitch (${icons.map((s) => `${s.x},${s.y}`).join(" ")})`);
  expect((layout?.moves ?? []).length > 0,
    `the pulsing marker is blitted onto the joke rows (${(layout?.moves ?? []).length} copies)`);
  expect((layout?.moves ?? []).every((m) => m.dstX === 0x11 && m.srcY === 0xf4),
    "the marker comes from the same 12x12 strip at the same x");

  // The cursor moves with the widget, one row at a time.
  await tap("ArrowDown");
  const moved = await readLayout();
  expect(moved?.selection === 1, `Down moves to the second joke row (${moved?.selection})`);
  await shot("joke-list-row2");

  // Confirm: the owner takes the row, the roll decides, and the walker either
  // attacks or prints that joke's line (fightstg.s:24680-24695, :24718-24773).
  // Record every line the battle shows from here, because the gag line is gone
  // again as soon as the enemy's turn takes over the panel.
  await page.evaluate(() => {
    window.__seen = [];
    // The gag is printed by the battle's own message box (FIGHTSTG_F0x8009a734 through
    // the shared VM arm 7), so record the panel's OWN two lines, not just b.message:
    // `message` keeps the walker's fallback sentence for ?legacyBattleMsg=1.
    window.__seenTimer = setInterval(() => {
      const peek = window.__battle?.peek?.();
      const lines = peek?.messageLine?.frame?.lines ?? null;
      const text = lines
        ? JSON.stringify(lines)
        : (peek?.message ?? "");
      if (text && window.__seen[window.__seen.length - 1] !== text) window.__seen.push(text);
    }, 25);
  });
  const pick = perm[1];
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state !== 2, null, { timeout: 10_000 });
  // The pick becomes the battle's pending action at once; the gag line is printed
  // when the player's own action plays out, so keep recording until it is up.
  const pending = await page.evaluate(() => window.__battleB().pendingAction);
  await page.waitForFunction(
    () => (window.__seen ?? []).some((m) => {
      const lines = (() => { try { return JSON.parse(String(m)); } catch { return null; } })();
      return Array.isArray(lines) && lines[1] !== "";
    }),
    null, { timeout: 10_000 }).catch(() => {});
  const after = await page.evaluate(() => {
    window.clearInterval(window.__seenTimer);
    return {
      state: window.__battleB().state,
      seen: window.__seen ?? [],
      panel: window.__battle?.peek?.()?.messageLine?.frame ?? null,
      listOpen: window.__battleCmdNative?.isOpen?.() ?? null,
      diag: window.__battleCmdNative?.diagnostics?.() ?? null,
    };
  });
  // The two lines the panel actually held at some point.
  after.gag = null;
  for (const row of after.seen) {
    try {
      const lines = JSON.parse(String(row));
      if (Array.isArray(lines) && lines[1]) { after.gag = lines; break; }
    } catch { /* the pre-gag single-line fallback */ }
  }
  after.pending = pending;
  console.log("after confirm", JSON.stringify({ state: after.state, pending: after.pending,
    listOpen: after.listOpen, chosen: after.diag?.chosen, joke: after.diag?.joke, seen: after.seen }));
  await shot("joke-list-confirmed");
  expect(after.listOpen === false, "the ported list closed on the confirm");
  expect(after.diag?.chosen === 1,
    `the owner answered with the confirmed row (${after.diag?.chosen})`);
  expect(after.pending?.type === "confused",
    `the roll made the Digimon act confused, not attack (${after.pending?.type})`);
  expect(JOKE_FLAVOR[pick].includes(after.pending?.flavor),
    `the printed line belongs to joke ${pick} ${JSON.stringify(JOKE_FLAVOR[pick])} (${JSON.stringify(after.pending?.flavor)})`);
  // F0x8009a734 (:24505-24595): line 1 is the acting Digimon's NAME (esmfight 0x16, the
  // bare {1} the shared tail fills) and line 2 the joke's phrase off its table at
  // 0x800a35e4. The original never says "is confused!" here.
  expect(after.gag, `the panel held a two-line gag (${JSON.stringify(after.seen)})`);
  expect(after.gag[0], `line 1 is the acting Digimon's name (${JSON.stringify(after.gag)})`);
  expect(after.gag[1], after.pending?.flavor,
    `line 2 is that joke's phrase from the disc bank (${JSON.stringify(after.gag)})`);
  expect(!String(after.gag.join(" ")).includes("is confused"),
    `the gag does not read "is confused!" (${JSON.stringify(after.gag)})`);
  // F0x8009a3b4 is the ordinary message draw with its fields at +0x14, so the gag is
  // drawn in the battle's own box: PGFGTC00 cel 0x31 at native (11, 188).
  expect(after.panel?.panel, `the window picture was up (${JSON.stringify(after.panel)})`);
  expect(after.panel.panel.cel, 0x31);
  expect([after.panel.panel.x, after.panel.panel.y], [11, 188]);
  expect([after.panel.panel.w, after.panel.panel.h], [296, 38]);
  expect(after.panel.prompt, "the press-Circle glyph blinks beside the second line");
  expect([after.panel.prompt.cel, after.panel.prompt.x, after.panel.prompt.y], [0x0a, 291, 208]);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed && problems.length === 0, plainMenu, menu, perm, pick,
    selected: layout?.selection, texts: layout?.texts, icons,
    moves: (layout?.moves ?? []).length, pending: after.pending, seen: after.seen,
    gag: after.gag, panel: after.panel?.panel ?? null, prompt: after.panel?.prompt ?? null,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed || problems.length ? 1 : 0);