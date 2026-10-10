// In-battle TAG partner list: the translated pro/fightstg screen, read where it draws.
//
// Opens the opening's story battle with the third party member knocked out,
// walks the command list down to Tag, and then asserts the geometry F0x800970C0
// / F0x800972C8 / F0x80096FE4 produce: the two partner rows with their name
// plates at (36, 76+32*i), "HP" at (108, 78+32*i), "/" at (153, 78+32*i), the
// current and maximum HP at x=152 and x=187, "MP" at (108, 92+32*i), and the
// HP/MP plate cel 0x30 at (90, 69+31*i). It checks the knocked-out partner's
// name is the grey palette 7 while the live one keeps palette 0, presses Down
// past the last row (the original clamps, it does not wrap), circles the
// knocked-out partner (the original refuses the confirm and says nothing), and
// cancels with the button the original tests (Cross). A second battle opens
// the list with the forced flag instead: Cross must then do nothing, the
// knocked-out row is still refused, and a live partner still answers.
//
// KEYS. The screen reads word bits, not key names: Circle is word bit 0x2000
// (fightstg.s:21264) and Cross is word bit 0x4000 (fightstg.s:21298), and the
// walker's one pad table puts Enter/space/z/c on 0x2000 and Escape/x on 0x4000
// (engine/systems/input-map.ts:225 and :234). So "Circle" below is Enter and
// "Cross" is Escape. `c` has sat on the confirm bit since 173ebcf0, so the
// cancels in this file must not use it.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_battle_taglist.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BTL_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.BTL_SHOT || "/tmp/battle-taglist";
mkdirSync(OUT, { recursive: true });

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
  // The third party member (the second partner row) is knocked out: 0 HP.
  const member = (digimonId, level, xp, hp = 200) => ({
    digimonId, level, xp, tp: 10, hp, maxHp: 200, mp: 80, maxMp: 80,
    stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
    bonuses: {}, elemBonuses: {},
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(3, 5, 0)));
  localStorage.setItem("partyStats", JSON.stringify([
    member(3, 5, 0), member(7, 5, 0), member(8, 5, 0, 0),
  ]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
});

const tap = async (k, ms = 90) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
  await page.waitForTimeout(60);
};
const tapOn = async (pg, k, ms = 90) => {
  await pg.keyboard.down(k);
  await pg.waitForTimeout(ms);
  await pg.keyboard.up(k);
  await pg.waitForTimeout(60);
};
const shot = async (name) => {
  const url = await page.evaluate(() => document.getElementById("game").toDataURL("image/png"));
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  console.log("shot", name);
};

const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) problems.push(msg);
};

/** The translated session's recorded picture calls and text-widget anchors. */
const readLayout = () => page.evaluate(() => {
  const screen = window.__battleTagNative;
  const session = screen?._session;
  if (!session) return null;
  const sprites = session.draw.calls
    .filter((c) => c.method === "drawSprite")
    .map((c) => ({ pack: c.args[0] >>> 0, cel: c.args[1], x: c.args[2], y: c.args[3] }));
  const texts = session.widgets.textWidgets()
    .map((w) => ({ x: w.penX, y: w.penY, palette: w.colour }))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return {
    execution: screen.diagnostics().execution,
    ready: screen.diagnostics().ready,
    selection: screen.diagnostics().selection,
    rows: screen.diagnostics().rows,
    candidates: screen.diagnostics().candidates,
    panels: screen.diagnostics().panels,
    sprites, texts,
  };
});

/** Walk the command list down to Tag and confirm it, waiting for the list. */
const openTagList = async () => {
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready,
    null, { timeout: 10_000 });
  for (let i = 0; i < 3; i++) await tap("ArrowDown");
  for (let i = 0; i < 4; i++) {
    await tap("Enter");
    if (await page.evaluate(() => window.__battleB?.()?.state === 11)) break;
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 11, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().ready,
    null, { timeout: 10_000 });
};

/** Load the map, let the opening's story battle start, and wait for the menu. */
const boot = async (pg = page) => {
  await pg.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await pg.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
  await pg.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 15_000;
  let launched = false;
  while (Date.now() < deadline) {
    const st = await pg.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      tb: window.__textbox?.isOpen?.() ?? false,
    }));
    if (st.battle) { launched = true; break; }
    if (st.tb) await pg.keyboard.press("Enter");
    await pg.waitForTimeout(40);
  }
  await pg.evaluate(() => { window.__gameSpeed = 1; });
  if (!launched) throw new Error("no battle");
  // The battle's opening line ("Ambush!") has to be read before the command list exists at all:
  // the original arms the menu from the script instruction that first waits on the line's own
  // slot (`wfightmn.s:1494-1496`). One shared press does that, then waits for the list.
  await waitForCommandMenu(pg);
};

try {
  await boot();
  expect(await page.evaluate(() => !!window.__battle?.isActive?.()),
    "the s200 PRE launched the scripted battle");
  // The command list is the translated six-row screen (Fight / Tech / DV /
  // Tag / Item / Run), so three Downs from Fight is Tag.
  await openTagList();
  await shot("tag-command-row");
  await shot("tag-list-open");

  const layout = await readLayout();
  expect(layout?.execution === "translated", `the list runs translated logic (${layout?.execution})`);
  expect(layout?.ready === true, "the screen is live and reading the pad");
  expect(layout?.rows === 2, `two partner rows are offered (${layout?.rows})`);
  expect(JSON.stringify(layout?.candidates) === "[1,2]",
    `the rows are the two members that are not the actor (${JSON.stringify(layout?.candidates)})`);

  const chrome = (layout?.sprites ?? []).filter((s) => s.pack === 0x04550000);
  const plates = chrome.filter((s) => s.cel === 0x30);
  console.log("  plates", JSON.stringify(plates), "panels", JSON.stringify(layout?.panels));
  expect(plates.length === layout?.panels?.filter((v) => v !== 0).length,
    `one HP/MP plate per row that passes the compatibility test (${plates.length})`);
  expect(plates.every((s) => s.x === 90), `every plate sits at x=90 (${plates.map((s) => s.x)})`);
  expect(plates.every((s, i) => s.y === 69 + 31 * i), `plates run y = 69 + 31*i (${plates.map((s) => s.y)})`);

  const texts = layout?.texts ?? [];
  const has = (x, y) => texts.some((t) => t.x === x && t.y === y);
  expect(has(36, 76) && has(36, 108), "the two name plates sit at (36,76) and (36,108)");
  expect(has(108, 78) && has(153, 78) && has(152, 78) && has(187, 78),
    "row 0's HP label, slash, current and maximum sit at (108,78)/(153,78)/(152,78)/(187,78)");
  expect(has(108, 110) && has(153, 110) && has(152, 110) && has(187, 110),
    "row 1's HP widgets sit 32 lower");
  expect(has(108, 92) && has(152, 92) && has(187, 92),
    "row 0's MP label, current and maximum sit at (108,92)/(152,92)/(187,92)");
  expect(has(108, 124) && has(152, 124) && has(187, 124),
    "row 1's MP widgets sit 32 lower");

  // The knocked-out partner's name is grey (widget+0x138 with palette 7), the
  // live partner's keeps palette 0.
  const nameAt = (y) => texts.find((t) => t.x === 36 && t.y === y);
  expect(nameAt(76)?.palette === 0 && nameAt(108)?.palette === 7,
    `the knocked-out partner's name is grey (row 0 ${nameAt(76)?.palette}, row 1 ${nameAt(108)?.palette})`);
  await shot("tag-list-grey-row");

  // Down past the last row: the original clamps at the last row, it does not wrap.
  for (let i = 0; i < 4; i++) await tap("ArrowDown");
  const afterDown = await page.evaluate(() => window.__battleTagNative.diagnostics());
  expect(afterDown.selection === afterDown.rows - 1,
    `Down four times stops on the last row ${afterDown.rows - 1} (selection ${afterDown.selection})`);
  await shot("tag-list-bottom-row");

  // Up back to the top and over it: the original is silent at the top, not wrapping.
  for (let i = 0; i < 4; i++) await tap("ArrowUp");
  const afterUp = await page.evaluate(() => window.__battleTagNative.diagnostics());
  expect(afterUp.selection === 0, `Up four times stops on the first row (selection ${afterUp.selection})`);

  // Circle on the knocked-out row: the original's HP check refuses, and says
  // nothing at all — the list stays up and the cursor stays where it was.
  await tap("ArrowDown");
  await tap("Enter");
  await page.waitForTimeout(300);
  const afterKnocked = await page.evaluate(() => ({
    diag: window.__battleTagNative.diagnostics(),
    state: window.__battleB?.()?.state ?? null,
  }));
  expect(afterKnocked.diag.open && afterKnocked.state === 11 && afterKnocked.diag.chosen === null,
    `Circle on the knocked-out row keeps the list up (open ${afterKnocked.diag.open}, state ${afterKnocked.state}, chosen ${afterKnocked.diag.chosen})`);
  expect(afterKnocked.diag.selection === 1,
    `the cursor stays on the knocked-out row (${afterKnocked.diag.selection})`);
  await shot("tag-list-knocked-refused");

  // Cancel is the button the original tests (pad bit 0x4000 = Cross).
  await tap("Escape");
  await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 5_000 })
    .then(() => expect(true, "Cross cancels the TAG list and returns to the command list"))
    .catch(() => expect(false, "Cross did not leave the TAG list"));
  await shot("tag-list-after-cancel");

  // Reopened with the walker's forced flag (a2 = 0 in F0x80097984): Cross must
  // do nothing at all, and Circle on the knocked-out row is still refused. A
  // fresh battle, because cancelling hands the turn back and the enemy acts.
  await boot();
  await page.evaluate(() => { window.__battleB()._forcedTag = true; });
  await openTagList();
  await tap("Escape");
  await page.waitForTimeout(300);
  const afterForced = await page.evaluate(() => ({
    diag: window.__battleTagNative.diagnostics(),
    state: window.__battleB?.()?.state ?? null,
  }));
  expect(afterForced.diag.open && afterForced.state === 11,
    `Cross does nothing on the forced TAG list (open ${afterForced.diag.open}, state ${afterForced.state})`);
  await tap("ArrowDown");
  await tap("Enter");
  await page.waitForTimeout(300);
  const stillForced = await page.evaluate(() => ({
    diag: window.__battleTagNative.diagnostics(),
    state: window.__battleB?.()?.state ?? null,
  }));
  expect(stillForced.diag.open && stillForced.state === 11,
    `the forced list still refuses the knocked-out row (open ${stillForced.diag.open}, state ${stillForced.state})`);
  await shot("tag-list-forced");

  // Circle on a live partner: the original answers with the party position and
  // the coordinator spawns the follow-up object directly. There is NO separate
  // form screen between the list and the pane (playtest bug 12b): the pane --
  // whose first sub-state is the species strip -- is the first screen shown.
  // Both Tag callers spawn that one object, tick 0x800980E4 (F0x800988fc at
  // fightstg.s:16343 delegates to F0x80098884, which allocates `lui 0x800a` +
  // `addiu -0x7f1c` at :22481).
  await tap("ArrowUp");
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 15, null, { timeout: 5_000 })
    .then(() => expect(true, "Circle on a live partner opens the DNA pane directly"))
    .catch(() => expect(false, "Circle on a live partner did not leave the TAG list"));
  await page.waitForFunction(
    () => window.__battleDnaNative?.diagnostics?.().pane?.subState === 0,
    null, { timeout: 8_000 })
    .then(() => expect(true, "the pane opens on its species strip, with no screen before it"))
    .catch(() => expect(false, "the pane never opened on the species strip"));
  await shot("tag-list-chosen");

  // The pane's second sub-state, the row list, whose row count is 2 with a DNA
  // pairing and 1 ("Switch" alone) without one: :22170 reads self+0x7C,
  // :22168/:22174 pick the count and :22177 stores it. This save has no DNA
  // pairing, so one row. Circle on the species names opens the rows
  // (`+0x3C(self)`, fightstg.s:22231-22245).
  await tap("Enter");
  await page.waitForFunction(
    () => window.__battleDnaNative?.diagnostics?.().pane?.subState === 1,
    null, { timeout: 8_000 })
    .then(() => expect(true, "Circle on the species names opened the Switch / DNA DV rows"))
    .catch(() => expect(false, "the pane never left the species names for the rows"));
  const pane = await page.evaluate(() => {
    const b = window.__battleB?.();
    return { state: b?.state ?? null, sel: b?.dnaSel ?? null, switchOnly: !!b?._dnaChoice?.switchOnly };
  });
  expect(pane.switchOnly === true,
    `with no DNA pairing the list is one row (${JSON.stringify(pane)})`);
  expect(pane.sel === 0, `the cursor starts on "Switch" (${pane.sel})`);
  await tap("ArrowDown");
  const paneAfterDown = await page.evaluate(() => window.__battleB?.()?.dnaSel ?? null);
  expect(paneAfterDown === 0,
    `Down does not leave a one-row list (${paneAfterDown})`);
  await shot("tag-switch-row-only");

  // Cross on the ROW list goes back to the species names, not out of the Tag.
  // Raw words: `andi $v0, $v1, 0x4000` then `bnez $v0, .L0x800984a0` at 0x800986f8
  // (word 0x1440ff68), and .L0x800984a0 plays the cancel blip 0x800450BD and calls
  // +0x2C(self, 0) — back to sub-state 0, the names — and writes no answer word.
  // verify_battle_dnalist.mjs already pinned this half; this file used to assert
  // the opposite, from the superseded reading that the rows share the names'
  // cancel. The names' own Cross is the one that writes -2 (:22200-:22201), and
  // it is checked next.
  await tap("Escape");
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.subState === 0,
    null, { timeout: 5_000 })
    .then(() => expect(true, "Cross on the row list returns to the species names"))
    .catch(() => expect(false, "Cross on the row list did not leave the rows"));
  const afterRowsCross = await page.evaluate(() => {
    const d = window.__battleDnaNative?.diagnostics?.();
    return { sub: d?.pane?.subState ?? null, answer: d?.answer ?? null, open: d?.open ?? false };
  });
  expect(afterRowsCross.sub === 0 && afterRowsCross.answer === null,
    `Cross on the rows wrote no answer word (${JSON.stringify(afterRowsCross)})`);
  await shot("tag-rows-cross-back-to-names");

  // The phase loads -2 in its dispatch delay slot before comparing the pane
  // answer (fightstg.s:16314-16316, :16347-16349). Both modes restart the picker.
  await tap("Escape");
  await page.waitForFunction(() => window.__battleB?.()?.state === 11, null, { timeout: 5_000 });
  expect(true, "Cross on forced species names reopens the partner picker");
  const forced = await page.evaluate(() => {
    const b = window.__battleB();
    return { action: b.pendingAction, mp: b.player.mp, forced: b._forcedTag };
  });
  expect(!forced.action && forced.mp === 80 && forced.forced,
    `forced cancel spends no MP or turn (${JSON.stringify(forced)})`);
  await shot("tag-forced-pane-cancel-to-picker");

  await boot();
  await openTagList();
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 15, null, { timeout: 5_000 });
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.subState === 0,
    null, { timeout: 8_000 });
  await tap("Escape");
  await page.waitForFunction(() => window.__battleB?.()?.state === 11, null, { timeout: 5_000 });
  expect(true, "Cross on command species names reopens the partner picker");
  expect(await page.evaluate(() => !window.__battleB().pendingAction && window.__battleB().player.mp === 80),
    "command cancel spends no MP or turn");
  await shot("tag-command-pane-cancel-to-picker");
  await tap("Escape");
  await page.waitForFunction(() => window.__battleB?.()?.state === 2);
  expect(true, "Cross from the reopened picker returns to the command list");

  // The "no partner left" pane. The original lists a partner at 0 HP, so the
  // pane is reached only when no party record but the actor has a live form:
  // F0x80097498 then goes to state 2 (:21280) and shows the message pane
  // cel 0x31 at (11,188), the text at (20,194) and the blinking hand at
  // (291,208), with bank 0x7F word #0x14 = "No reserve" (:21455-:21485).
  const solo = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  solo.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
  await solo.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "3");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p005koet");
    // One Digimon in the party: the actor has nobody in reserve.
    localStorage.setItem("party", JSON.stringify(["p005koet"]));
    localStorage.setItem("packId", "B");
    localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", "[]");
    const member = (digimonId, level, xp) => ({
      digimonId, level, xp, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
      stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
      bonuses: {}, elemBonuses: {},
    });
    localStorage.setItem("partnerStats", JSON.stringify(member(3, 5, 0)));
    localStorage.setItem("partyStats", JSON.stringify([member(3, 5, 0)]));
    localStorage.setItem("equipment", JSON.stringify([{}]));
  });
  await boot(solo);
  for (let i = 0; i < 3; i++) await tapOn(solo, "ArrowDown");
  for (let i = 0; i < 4; i++) {
    await tapOn(solo, "Enter");
    if (await solo.evaluate(() => window.__battleB?.()?.state === 11)) break;
  }
  await solo.waitForFunction(() => window.__battleB?.()?.state === 11, null, { timeout: 10_000 })
    .catch(() => { /* reported below */ });
  await solo.waitForFunction(() => window.__battleTagNative?.diagnostics?.().message === true,
    null, { timeout: 10_000 }).catch(() => { /* reported below */ });
  const soloState = await solo.evaluate(() => ({
    state: window.__battleB?.()?.state ?? null,
    notice: window.__battleB?.()?.menuNotice ?? null,
    diag: window.__battleTagNative?.diagnostics?.() ?? null,
  }));
  expect(soloState.state === 11 && soloState.diag?.message === true,
    `with one Digimon the list opens its message pane (state ${soloState.state}, message ${soloState.diag?.message}, notice ${JSON.stringify(soloState.notice)})`);
  // The pane and its text draw on the first frame; the blinking hand is skipped
  // on that frame and only appears once the display counter has advanced
  // (fightstg.s:21455-21470 reads self+0x70 first and takes the other branch
  // afterwards), so the picture calls have to be read on a later frame.
  const readSoloLayout = () => solo.evaluate(() => {
    const session = window.__battleTagNative?._session;
    if (!session) return null;
    return {
      texts: session.widgets.textWidgets().map((w) => ({ x: w.penX, y: w.penY })),
      sprites: session.draw.calls
        .filter((c) => c.method === "drawSprite")
        .map((c) => ({ pack: c.args[0] >>> 0, cel: c.args[1], x: c.args[2], y: c.args[3] })),
    };
  });
  let soloLayout = null;
  for (let i = 0; i < 40; i++) {
    soloLayout = await readSoloLayout();
    if ((soloLayout?.sprites ?? []).some((s) => s.cel === 0x0a)) break;
    await solo.waitForTimeout(100);
  }
  const soloTexts = soloLayout?.texts ?? [];
  const soloSprites = soloLayout?.sprites ?? [];
  console.log("  solo texts", JSON.stringify(soloTexts));
  console.log("  solo sprites", JSON.stringify(soloSprites.filter((s) => s.cel === 0x31 || s.cel === 0x0a)));
  expect(soloTexts.some((t) => t.x === 20 && t.y === 194),
    `the message text widget sits at (20,194) (${JSON.stringify(soloTexts.map((t) => [t.x, t.y]))})`);
  expect(soloSprites.some((s) => s.cel === 0x31 && s.x === 11 && s.y === 188),
    "the message pane cel 0x31 sits at (11,188)");
  expect(soloSprites.some((s) => s.cel === 0x0a && s.x === 291 && s.y === 208),
    `the blinking hand cel 0x0A sits at (291,208) (${JSON.stringify(soloSprites.filter((s) => s.cel === 0x0a))})`);
  // Only Circle is read on this screen and it answers -2, so Circle closes the
  // Tag and hands the turn back to the command list (fightstg.s:21343-21370).
  writeFileSync(`${OUT}/tag-no-partner.png`, await solo.screenshot());
  console.log("shot tag-no-partner");
  await tapOn(solo, "Enter");
  await solo.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 5_000 })
    .then(() => expect(true, "Circle on the message pane closes the Tag and returns to the command list"))
    .catch(() => expect(false, "Circle on the message pane did not close the Tag"));
  expect(soloState.notice !== "No partner to tag.",
    "the walker's own 'No partner to tag.' notice no longer pre-empts the pane");
  await solo.close();

  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  try {
    console.log("DUMP", JSON.stringify(await page.evaluate(() => ({
      state: window.__battleB?.()?.state ?? null,
      tag: window.__battleTagNative?.diagnostics?.() ?? null,
    }))));
  } catch { /* page may be gone */ }
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}

console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exit(problems.length ? 1 : 0);