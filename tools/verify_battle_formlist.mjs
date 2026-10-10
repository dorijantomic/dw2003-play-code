// In-battle Digivolve form list: the translated pro/fightstg screen, read where
// it draws.
//
// Opens the opening's story battle, walks the command list down to DV, and then
// asserts the geometry F0x80094298 (the row names), F0x8009B0C8 (the list model)
// and F0x80094AD0 (page zero's thirteen numbers) produce: one row per form at
// x = 187 and y = 146 + 19*i, the form the Digimon is already in drawn grey
// (palette 7), the selection bar at (168,147), the panel's two column captions at
// (34,171)/(56,171) and its thirteen numbers in two columns — six at x = 60 and
// seven at x = 126, rows 14 apart from y = 82, every one clamped to 999. It then
// presses Down past the last row (the original clamps, it does not wrap), pages
// with L1/R1 over the panel's three pages (both directions wrap), confirms the
// grey row (the original does nothing at all) and confirms another row, which
// commits the Digivolve through the walker's own path.
//
// Server: python3 -m http.server 8791 --directory web
// Run:    VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_battle_formlist.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BFL_ROOT || `${baseUrl(8791)}/`;
const OUT = process.env.BFL_SHOT || ".bunny-scratch/formlist-shot";
mkdirSync(OUT, { recursive: true });

const ROW_Y = (i) => 146 + 19 * i;
const TECH_Y = (i) => 81 + 14 * i;
// Page zero's thirteen numbers are placed by the overlay's own 40-byte table at
// 0x800A350C: thirteen (x, y, slot) triples, which F0x80094AD0 walks three bytes
// at a time (`lbu $a2,($s0)` / `lbu $a3,0x1($s0)` / `lbu $v0,0x2($s0)`,
// `addiu $s0,0x3`, `slti $v0,$s2,0xd`). They are read out of the shipped
// overlay here rather than written down, so this check asks the disc the same
// question the screen does — six numbers at x 60 and seven at x 126, rows 14
// apart from y 82, and the right column running on to y 166.
const OVERLAY_BASE = 0x80082cb0;
const PAGE0_TABLE = 0x800a350c;
const PAGE0_ROWS = 13;
const overlay = new Uint8Array(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens/pro_fightstg.bin")));
const page0Table = Array.from({ length: PAGE0_ROWS }, (_, i) => {
  const at = PAGE0_TABLE - OVERLAY_BASE + i * 3;
  return { x: overlay[at], y: overlay[at + 1], slot: overlay[at + 2] };
});
const LEFT_X = page0Table[0].x;
const RIGHT_X = page0Table[6].x;
// The marker strip the selection bar is copied out of: the shared list model's
// source rectangle is the eight bytes at 0x800A3654, and the strip lives in VRAM
// at (0, 0xF4), 156x12.
const STRIP = { x: 0, y: 0xf4, w: 156, h: 12 };
const formTables = new Uint8Array(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data/battlecmd/form-tables.bin")));
const blitRect = [0, 1, 2, 3].map((i) => formTables[32 + i * 2] | (formTables[32 + i * 2 + 1] << 8));
// Three technique ids the seeded form knows: one plain, two loaded. Every one is a
// NAMED technique, quoted from web/assets/data/digimon.json's `skills`, because the
// game's technique-name bank leaves its low slots as the single letter "a": bank
// 0xA2's indices 1..52 are one byte each (the technique table gives those ids to the
// BASIC attacks, which the game never names, and digimon.json marks every one of
// them `tech_basic`), and so are the unused slots above 219. A row seeded with one of
// those draws "a" and proves nothing, so the check reads each name back out of the
// widget and compares it with the walker's own technique data.
const SKILLS = new Map(JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data/digimon.json"),
  "utf8")).skills.map((s) => [s.id, s]));

// The ids the list's rows carry are the GAME's form ids, not the walker's own
// (digimon.json, 1..55): the list reads the disc's 55 profile records at
// 0x8003EF5C, and every id it is handed goes through one mapping into that
// table's own numbering. The expected ids are read out of the table here rather
// than written down, so this check asks the same question the screen does.
const DIGIMON_JSON = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data/digimon.json");
const gameFormId = (walkerId) => {
  const EXE_IMAGE_BASE = 0x80010000, PROFILE_TABLE = 0x8003ef5c, STRIDE = 0x58;
  const image = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens/resident.bin"));
  const at = PROFILE_TABLE - EXE_IMAGE_BASE + (walkerId - 1) * STRIDE;
  return image[at] | (image[at + 1] << 8);
};

const named = (id) => {
  const skill = SKILLS.get(id & 0x1fff);
  if (!skill || skill.tech_basic) throw new Error(`${id} is not a named technique`);
  return skill.name;
};
const SHARED = 0x41, LOADED_A = 0x35, LOADED_B = 0x40;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(({ kunai, fire, bubble }) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  // A level-5 Monmon with one acquired, equipped form, so the list has two rows
  // and the current form has a second row to move to. The acquired form carries
  // three techniques, one of them loaded (0x4000) and one of them shared with a
  // third form, so pages one and two have something to draw and differ.
  const member = (digimonId, level, formLedger, equippedForms) => ({
    digimonId, level, xp: 0, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
    stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
    bonuses: {}, elemBonuses: {}, formLedger, equippedForms,
  });
  localStorage.setItem("partnerStats",
    JSON.stringify(member(3, 5, [
      { id: 3, formLevel: 2, techSlots: [0x8000 | kunai, 0, 0, 0, 0, 0] },
      { id: 9, formLevel: 4, dvexp: 90, techSlots: [kunai, 0x4000 | fire, 0x4000 | bubble, 0, 0, 0] },
      { id: 10, formLevel: 3, techSlots: [0x4000 | kunai, 0, 0, 0, 0, 0] },
    ], [9, 10, 0])));
  localStorage.setItem("partyStats", JSON.stringify([
    member(3, 5, [
      { id: 3, formLevel: 2, techSlots: [0x8000 | kunai, 0, 0, 0, 0, 0] },
      { id: 9, formLevel: 4, dvexp: 90, techSlots: [kunai, 0x4000 | fire, 0x4000 | bubble, 0, 0, 0] },
      { id: 10, formLevel: 3, techSlots: [0x4000 | kunai, 0, 0, 0, 0, 0] },
    ], [9, 10, 0]),
    member(7, 5, [], []),
    member(8, 5, [], []),
  ]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, { kunai: SHARED, fire: LOADED_A, bubble: LOADED_B });

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
const readLayout = () => page.evaluate(async () => {
  const { decodeNativeText } = await import("/native-screen-text.js");
  const screen = window.__battleFormNative;
  const session = screen?._session;
  if (!session) return null;
  const sprites = session.draw.calls
    .filter((c) => c.method === "drawSprite")
    .map((c) => ({ pack: c.args[0] >>> 0, cel: c.args[1], x: c.args[2], y: c.args[3] }));
  const widgets = session.widgets.textWidgets();
  const texts = widgets
    .map((w) => ({ x: w.penX, y: w.penY, colour: w.colour }))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  // The text the panel's technique rows really show, decoded by the painter's own
  // codec out of the bytes the +0x114 call installed, so a wrong bank, a wrong
  // language or a masked id all show up here rather than as a lone letter.
  const rows = widgets.filter((w) => w.penX === 38)
    .sort((a, b) => a.penY - b.penY)
    .map((w) => ({
      y: w.penY, colour: w.colour,
      name: w.lines?.[0]?.bytes?.length ? decodeNativeText(w.lines[0].bytes).text : "",
    }));
  return {
    execution: screen.diagnostics().execution,
    ready: screen.diagnostics().ready,
    selection: screen.diagnostics().selection,
    rows: screen.diagnostics().rows,
    page: screen.diagnostics().page,
    species: screen.diagnostics().species,
    panelBlock: screen.diagnostics().panelBlock,
    panelRows: screen.diagnostics().panelRows,
    panelHeadline: screen.diagnostics().panelHeadline,
    moves: session.moves.map((m) => ({ ...m })),
    stripSource: screen.diagnostics().stripSource,
    lastDiagnostic: screen.diagnostics().lastDiagnostic,
    sprites, texts, techRows: rows,
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

  // The battle's opening line ("Ambush!") has to be read before the command list exists at all:
  // the original arms the menu from the script instruction that first waits on the line's own
  // slot (`wfightmn.s:1494-1496`). One shared press does that, then waits for the list.
  await waitForCommandMenu(page);
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready, null, { timeout: 10_000 });
  // The command list is Fight / Tech / DV / Tag / Item / Run, so two Downs from
  // Fight is DV.
  await tap("ArrowDown");
  await tap("ArrowDown");
  await shot("form-command-row");
  for (let i = 0; i < 4; i++) {
    await tap("Enter");
    if (await page.evaluate(() => window.__battleB?.()?.state === 13)) break;
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 13, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__battleFormNative?.diagnostics?.().ready, null, { timeout: 10_000 });
  await shot("form-list-open");

  const layout = await readLayout();
  expect(layout?.execution === "translated", `the list runs translated logic (${layout?.execution})`);
  expect(layout?.ready === true, "the screen is live and reading the pad");
  expect(layout?.rows >= 2, `the acting Digimon is offered its forms (rows ${layout?.rows})`);
  expect(JSON.stringify(layout?.species?.slice(0, 3)) === JSON.stringify([3, 9, 10].map(gameFormId)),
    `row 0 is the current form and the next two its acquired ones (${layout?.species})`);

  // One name per row, at x = 187 and y = 146 + 19*i.
  const names = (layout?.texts ?? []).filter((t) => t.x === 187);
  expect(names.length === layout?.rows,
    `one row name per form at x=187 (${names.map((t) => t.y)})`);
  expect(names.every((t, i) => t.y === ROW_Y(i)),
    `row names at y = 146 + 19*i (${names.map((t) => t.y)})`);
  // The form the Digimon is already in is grey (palette 7); the other row is not.
  expect(names[0]?.colour === 7, `the current form's row is grey (palette ${names[0]?.colour})`);
  expect(names.slice(1).every((t) => t.colour === 0),
    `the other rows are the normal palette (${names.slice(1).map((t) => t.colour)})`);

  // The per-row highlight cel 0x24 sits at (167,146) with pitch 19, and the
  // selection bar blit lands on the selected row.
  const highlight = (layout?.sprites ?? []).filter((s) => s.cel === 0x24 && s.pack === 0x04550000);
  expect(highlight.length >= layout?.rows,
    `a highlight cel per row (${highlight.map((s) => `${s.x},${s.y}`).join(" ")})`);
  expect(highlight.every((s, i) => s.x === 167 && s.y === ROW_Y(i)),
    `highlight cels at (167,146) with pitch 19 (${highlight.map((s) => `${s.x},${s.y}`).join(" ")})`);
  expect((layout?.moves ?? []).length > 0,
    `the selection bar is blitted (${(layout?.moves ?? []).length} VRAM copies)`);
  // The bar is one 12x12 marker copied out of the strip the battle loader
  // uploaded at VRAM (0, 0xF4). Its source rectangle is the overlay's own eight
  // bytes at 0x800A3654 — the x halfword is the counter's `*12`, the other three
  // are the file's — so a copy whose source lies outside the strip is a screen
  // whose data load ran over that rectangle, and the bar is simply not painted.
  const copies = layout?.moves ?? [];
  expect(copies.length > 0 && copies.every((m) => m.srcY === blitRect[1] && m.h === blitRect[3]
      && m.w === blitRect[2] && m.srcX >= STRIP.x && m.srcX + m.w <= STRIP.x + STRIP.w),
    `every copy is the file's own cell out of the marker strip (${copies.map((m) => `${m.srcX},${m.srcY} ${m.w}x${m.h}`).join(" ")}) vs ${blitRect}`);
  expect(layout?.lastDiagnostic == null,
    `the screen raised no strip warning (${layout?.lastDiagnostic})`);

  // Page zero: two captions at (34,171) and (56,171), and the thirteen numbers
  // where the overlay's own table at 0x800A350C puts them.
  const texts = layout?.texts ?? [];
  const has = (x, y) => texts.some((t) => t.x === x && t.y === y);
  expect(has(34, 171) && has(56, 171), "page zero's two column captions sit at (34,171) and (56,171)");
  const left = texts.filter((t) => t.x === LEFT_X);
  const right = texts.filter((t) => t.x === RIGHT_X);
  // A rebuilt panel's widgets leave with it: the original stops ticking the panel
  // it dropped, so its numbers stop being drawn.
  expect(left.length === 6, `six numbers in the left column at x=${LEFT_X} (${left.map((t) => t.y)})`);
  expect(right.length === 7, `seven numbers in the right column at x=${RIGHT_X} (${right.map((t) => t.y)})`);
  expect(left.every((t, i) => t.y === page0Table[i].y),
    `left column rows 14 apart from y=82 (${left.map((t) => t.y)})`);
  expect(right.every((t, i) => t.y === page0Table[i + 6].y),
    `right column rows sit in y 82..166 (${right.map((t) => t.y)})`);
  // Every number is right-aligned at its own x: F0x80094AD0 calls +0x148(1) on
  // each widget, which is F0x8001A25C measuring the run into +0xBC, and the draw
  // starts at penX - that width (fns.s:11173-11208).
  expect(page0Table.every((row) => has(row.x, row.y)),
    `a number at each of the thirteen table positions (${page0Table.map((r) => `${r.x},${r.y}`).join(" ")})`);
  const slots = page0Table.map((r) => r.slot);
  expect(slots.join(",") === "6,7,8,9,10,11,12,13,14,15,16,17,18",
    `the table's own slot column is 6..18 (${slots.join(",")})`);

  // The panel's own label cels: the two page arrows beside the L1/R1 captions
  // (PGFGTC00 0x1F at (24,171) and 0x20 at (72,171), F0x80094878), and page zero's
  // two chrome cels (CMFONT 0x23 at (24,81) and PGFGTC00 0x25 at (16,74),
  // F0x80094A00). The arrows blink on the display counter's bit 4, so they are
  // read over several ticks rather than from one frame.
  const cel = (sprites, pack, id) => sprites.filter((s) => s.pack === pack && s.cel === id);
  const sprites = layout?.sprites ?? [];
  expect(cel(sprites, 0x02860000, 0x23).some((s) => s.x === 24 && s.y === 81),
    "page zero's icon cel 0x23 sits at (24,81)");
  expect(cel(sprites, 0x04550000, 0x25).some((s) => s.x === 16 && s.y === 74),
    "page zero's corner cel 0x25 sits at (16,74)");
  let arrows = [];
  for (let i = 0; i < 6 && !(cel(arrows, 0x04550000, 0x1f).length && cel(arrows, 0x04550000, 0x20).length); i++) {
    await page.waitForTimeout(120);
    arrows = (await readLayout())?.sprites ?? [];
  }
  expect(cel(arrows, 0x04550000, 0x1f).some((s) => s.x === 24 && s.y === 171),
    "the left page arrow cel 0x1F sits at (24,171)");
  expect(cel(arrows, 0x04550000, 0x20).some((s) => s.x === 72 && s.y === 171),
    "the right page arrow cel 0x20 sits at (72,171)");

  // Down past the last row: the original clamps at the last row, it does not wrap.
  for (let i = 0; i < 8; i++) await tap("ArrowDown");
  const afterDown = await page.evaluate(() => window.__battleFormNative.diagnostics());
expect(afterDown.selection === afterDown.rows - 1,
    `Down eight times stops on the last row ${afterDown.rows - 1} (selection ${afterDown.selection}, rows ${afterDown.rows})`);
await shot("form-list-bottom-row");
  // Up once more onto the acquired form, so the technique pages below are the
  // ones a player is looking at when they consider digging into it.
  await tap("ArrowUp");
  await page.waitForTimeout(150);
  const onAcquired = await page.evaluate(() => window.__battleFormNative.diagnostics());
  expect(onAcquired.selection === 1, `the cursor is on the acquired form (row ${onAcquired.selection})`);

  // The panel has three pages and both directions wrap. R1 (pad bit 0x800) is the
  // next page and L1 (0x400) the previous one, in the PlayStation pad's own bit
  // order (R1 is bit 11, L1 bit 10).
  const pages = [];
  for (let i = 0; i < 3; i++) {
    await tap("e"); // R1, next page
    pages.push(await page.evaluate(() => window.__battleFormNative.diagnostics().page));
  }
  expect(JSON.stringify(pages) === JSON.stringify([1, 2, 0]),
    `R1 walks 1,2,0 and wraps (${pages})`);
  await tap("q"); // L1, previous page
  const back = await page.evaluate(() => window.__battleFormNative.diagnostics().page);
  expect(back === 2, `L1 from page 0 wraps back to page 2 (page ${back})`);
  await tap("q");
  const back2 = await page.evaluate(() => window.__battleFormNative.diagnostics().page);
  expect(back2 === 1, `L1 again steps down to page 1 (page ${back2})`);
  await shot("form-list-page-one");

  // Page one (F0x8009506C) lists the cursor row's own six technique words, taken
  // from that form's 0x14-byte roster entry, with the caption from bank 0x7F word
  // 0x19 and the form's level at (147,169). Rows are at x = 38, y = 81 + 14*i.
  const one = await readLayout();
  const techX = 38;
  const names1 = (one?.texts ?? []).filter((t) => t.x === techX);
  expect(names1.length === 6, `page one builds six technique rows (${names1.map((t) => t.y)})`);
  expect(names1.every((t, i) => t.y === TECH_Y(i)),
    `page one rows 14 apart from y=81 (${names1.map((t) => t.y)})`);
  expect((one?.texts ?? []).some((t) => t.x === 90 && t.y === 169),
    "page one shows the caption at (90,169)");
  expect((one?.texts ?? []).some((t) => t.x === 147 && t.y === 169),
    `page one shows the form level at (147,169) (${one?.panelHeadline})`);
  expect(one?.panelHeadline === 4, `the headline is the acquired form's level 4 (${one?.panelHeadline})`);
  expect(JSON.stringify(one?.panelRows) === JSON.stringify([SHARED, 0x4000 | LOADED_A, 0x4000 | LOADED_B, 0, 0, 0]),
    `page one lists that form's own three techniques (${(one?.panelRows ?? []).map((w) => w.toString(16))})`);
  // THE NAMES THEMSELVES. F0x80094D50 asks bank 0xA2 at `word & 0x1FFF`
  // (fightstg.s .L0x80094e80, the delay slot of the widget's +0x114 call), so each
  // row must show the name the walker's technique data gives that id.
  const own1 = one?.techRows ?? [];
  expect(own1.slice(0, 3).map((r) => r.name).join("|")
      === [SHARED, 0x4000 | LOADED_A, 0x4000 | LOADED_B].map((w) => named(w)).join("|"),
    `page one names its three techniques (${JSON.stringify(own1.slice(0, 3).map((r) => r.name))})`);
  expect(own1.slice(3).every((r) => r.name === ""),
    `page one's three empty rows draw nothing (${JSON.stringify(own1.slice(3).map((r) => r.name))})`);
  // Each listed technique gets its CMFONT icon cel at (24, 81 + 14*i).
  const icons1 = (one?.sprites ?? []).filter((s) => s.pack === 0x02860000 && s.x === 24);
  expect(icons1.length === 3 && icons1.every((s, i) => s.y === TECH_Y(i)),
    `a technique icon per listed row (${icons1.map((s) => s.cel).join(" ")})`);
  // A loaded technique is drawn in palette 4, the plain rows in palette 0.
  const rowColors = names1.slice(0, 3).map((t) => t.colour);
  expect(rowColors[0] === 0 && rowColors[1] === 4 && rowColors[2] === 4,
    `the loaded techniques are palette 4 (${rowColors})`);

  await tap("e");
  const two = await readLayout();
  expect(two?.page === 2, `R1 reached page two (${two?.page})`);
  await shot("form-list-page-two");

  // Page two (F0x80095138) is what the OTHER equipped forms have loaded: only the
  // words carrying 0x4000, masked to their 13-bit id and deduped. The third form
  // loaded the shared technique alone, and the cursor's own form is excluded, so
  // page two shows just that one row beside the same level — and because the mask
  // drops 0x4000 the row can never take palette 4 on this page.
  expect(two?.panelHeadline === 4, `page two keeps the cursor's level (${two?.panelHeadline})`);
  expect(JSON.stringify(two?.panelRows) === JSON.stringify([SHARED, 0, 0, 0, 0, 0]),
    `page two lists only what another form has loaded (${(two?.panelRows ?? []).map((w) => w.toString(16))})`);
  const names2 = (two?.texts ?? []).filter((t) => t.x === techX);
  expect(names2.length === 6 && names2.every((t, i) => t.y === TECH_Y(i)),
    `page two builds the same six rows (${names2.map((t) => t.y)})`);
  expect(names2[0]?.colour === 0,
    `page two's masked row is the plain palette (${names2.slice(0, 1).map((t) => t.colour)})`);
  const own2 = two?.techRows ?? [];
  expect(own2[0]?.name === named(SHARED) && own2.slice(1).every((r) => r.name === ""),
    `page two names the one technique it lists (${JSON.stringify(own2.map((r) => r.name))})`);

  await tap("e");
  await page.waitForTimeout(250);
  const zero = await page.evaluate(() => window.__battleFormNative.diagnostics());
  expect(zero.page === 0, `the panel is back on page 0 (page ${zero.page})`);
  await shot("form-list-page-zero");

  // Page zero's three grey flags are the roster's own buff counters at panel
  // +0x8A, +0x8C and +0x8E, which F0x80017174 subtracts from STR, DEF and SPD
  // and which grey page zero's first, second and fifth numbers. Nothing is
  // debuffed here, so all three are zero and none of the numbers is grey.
  const zeroLayout = await readLayout();
  let block = zeroLayout?.panelBlock ?? null;
  for (let i = 0; i < 20 && !block; i++) {
    await page.waitForTimeout(60);
    block = (await readLayout())?.panelBlock ?? null;
  }
  const flags = [19, 20, 21].map((i) => block?.[i] ?? -1);
  expect(flags.every((f) => f === 0), `the three buff counters are clear (${flags})`);
  const nums = (zeroLayout?.texts ?? []).filter((t) => t.x === LEFT_X).slice(0, 6);
  expect(nums.length === 6 && nums.every((t) => t.colour !== 6),
    `nothing on page zero is grey (${nums.map((t) => t.colour)})`);
  expect(nums.map((t) => t.y).join(",") === page0Table.slice(0, 6).map((r) => r.y).join(","),
    `page zero still lists the six core numbers (${nums.map((t) => t.y)})`);

  // Confirming the row the Digimon is already in does nothing at all: no close,
  // no pending action, still the form list.
  await tap("ArrowUp");
  await page.waitForTimeout(150);
  const onCurrent = await page.evaluate(() => window.__battleFormNative.diagnostics());
  expect(onCurrent.selection === 0, `the cursor is back on the current form (${onCurrent.selection})`);
  await tap("Enter");
  await page.waitForTimeout(300);
  const refused = await page.evaluate(() => ({
    state: window.__battleB?.()?.state ?? null,
    open: window.__battleFormNative?.diagnostics?.().open ?? false,
  }));
  expect(refused.state === 13 && refused.open,
    `confirming the form the Digimon is already in does nothing (state ${refused.state}, open ${refused.open})`);
  await shot("form-list-confirm-refused");

  // Confirming another row answers with that species id and commits the
  // Digivolve through the walker's own path.
  // Read the numbers on both sides of the commit. The original's commit
  // (wfightmn.s:1680-1692) stores one halfword — the live form id at
  // `0x800A4470 + 0x20*actor` + 0x00 — and nothing else; the numbers a changed
  // form fights with are re-derived on every read by F0x8009EC94
  // (fightstg.s .L0x8009ed84-.L0x8009ed90), which ADDS the live form's own
  // species-record STR..SPD on top of the roster's numbers while the two forms
  // differ. So the stored numbers must not move and the effective ones must be
  // the stored five plus the new form's own five, read here out of the disc's
  // own profile record rather than written down.
  const readNumbers = () => page.evaluate(async () => {
    const mod = await import("/battle.js");
    const b = window.__battleB();
    const p = b.playerRecords[b.activePlayerIndex];
    const e = mod.effStats(p);
    return {
      form: p.profile?.id, saved: p.savedSpeciesId ?? null,
      stored: [p.str, p.def, p.spt, p.wis, p.spd],
      effective: [e.str, e.def, e.spt, e.wis, e.spd],
      hp: p.hp, mp: p.mp,
    };
  });
  const before = await readNumbers();
  await tap("ArrowDown");
  await page.waitForTimeout(150);
  await tap("Enter");
  await page.waitForTimeout(60);
  const committed = await page.evaluate(() => {
    const b = window.__battleB?.() ?? null;
    return {
      state: b?.state ?? null,
      pending: b?.pendingAction?.type ?? null,
      formId: b?.pendingAction?.formId ?? null,
      form: b?.playerRecords?.[b?.activePlayerIndex ?? 0]?.profile?.id ?? null,
      chosen: window.__battleFormNative?.diagnostics?.().chosen ?? null,
    };
  });
  expect(committed.chosen === 9,
    `the screen answered with the chosen species id (${committed.chosen})`);
  expect(committed.pending === "dv" && committed.formId === 9,
    `the battle queued the Digivolve into form ${committed.formId} (${committed.pending})`);
  expect(committed.state !== 13,
    `the form list closed on confirm (state ${committed.state})`);
  // The Digimon really is in the chosen form afterwards.
  await page.waitForFunction(() =>
    window.__battleB?.()?.playerRecords?.[window.__battleB?.()?.activePlayerIndex ?? 0]?.profile?.id === 9,
    null, { timeout: 10_000 }).catch(() => {});
  const form = await page.evaluate(() => {
    const b = window.__battleB?.() ?? null;
    return b?.playerRecords?.[b?.activePlayerIndex ?? 0]?.profile?.id ?? null;
  });
  expect(form === 9, `the Digimon digivolved into form ${form}`);
  await shot("form-list-after-confirm");

  // What confirm did to the numbers, which is the whole of part two of the job.
  const after = await readNumbers();
  expect(JSON.stringify(after.stored) === JSON.stringify(before.stored),
    `confirm wrote no stat: stored ${after.stored} is still ${before.stored}`);
  expect(after.hp === before.hp && after.mp === before.mp,
    `confirm wrote no HP or MP (${before.hp}/${before.mp} -> ${after.hp}/${after.mp})`);
  expect(after.saved === before.saved && after.saved !== after.form,
    `the record's own form is the one the numbers belong to (${after.saved} vs ${after.form})`);
  // The new form's own five base stats, out of the disc's profile record: the row
  // the profile table at 0x8003EF5C holds for walker id 9, which is game form
  // id 386, at +0x02..+0x0A.
  const profiles = new Uint8Array(readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data/digimon_profiles.bin")));
  const at = (9 - 1) * 0x58;
  expect((profiles[at] | (profiles[at + 1] << 8)) === gameFormId(9),
    `the disc's row for walker 9 is form ${gameFormId(9)}`);
  const added = [0, 1, 2, 3, 4].map((i) => profiles[at + 2 + i * 2] | (profiles[at + 3 + i * 2] << 8));
  expect(JSON.stringify(after.effective)
      === JSON.stringify(before.stored.map((v, i) => v + added[i])),
    `the effective numbers are the stored five plus the new form's own ${added} `
      + `(${before.stored} -> ${after.effective})`);

  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  try {
    console.log("DUMP", JSON.stringify(await page.evaluate(() => ({
      state: window.__battleB?.()?.state ?? null,
      form: window.__battleFormNative?.diagnostics?.() ?? null,
    }))));
  } catch { /* page may be gone */ }
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}

console.log(problems.length ? `FAILED ${problems.length}` : "PASS");