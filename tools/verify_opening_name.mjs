// Section 7 opening coverage, case 2c: the account-name keyboard at HANDOFF 1280.
//
// The registration cutscene on s785 (014a0001) ends in HANDOFF 1280, the
// registration screen, and the walker now opens it as the TRANSLATED
// registration wizard (web/packselect-translated.js ->
// engine/dw3/ui/wizard-root-session.ts), whose first step is the account-name
// keyboard: a copy of the naming keyboard's own ports under the wizard layout
// (engine/dw3/ui/native/name-keyboard.ts, WIZARD_KEYBOARD_LAYOUT). The field is
// seeded with the walker's placeholder name and the typed name is what
// state.playerName / localStorage playerName become, so this check drives that
// keyboard with ordinary keys: press one letter, walk the grid to the decoded OK
// cell (row 6, col 13) and confirm, then take the wizard's remaining two steps
// (pack A + YES) so the named account is really registered. The receiving
// consumer is event 014a0002, which must then carry the player to s790 with the
// name still in place.
//
// The partner rename desk (pro/stdgname) and its translated route
// (web/nameentry-translated.js) are covered by tools/verify_translated_naming.mjs.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_opening_name.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NAME_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.NAME_SHOT || "/tmp/opening-name";
mkdirSync(OUT, { recursive: true });

// The wizard's three panels, by the task class the wizard creates them with, and
// the keyboard's own fields under the wizard layout (name-keyboard.ts L.f).
const WIZ_KEYBOARD = 0x80085a70;
const WIZ_PACK_LIST = 0x80087a30;
const WIZ_CONFIRM = 0x80086eb8;
const KB_SUBSTATE = 0x10;   // 2 = typing
const KB_SLOTS = 0x78;      // the typed glyph slots
const KB_SLOT_CURSOR = 0x90;
const KB_COL = 0x98;
const KB_ROW = 0x9c;
const OK_CELL = { col: 13, row: 6 };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  for (const k of [
    "playerName", "charId", "party", "pendingParty", "packId", "partnerStats",
    "partyStats", "equipment", "flags", "engineFlags", "progressOrdinal",
    "bits", "inventory", "rosterOwned", "reserveStats", "reserveEquipment",
    "engineEvents",
  ]) localStorage.removeItem(k);
});

const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};

const panel = (cls, off) => page.evaluate(([c, o]) => {
  const s = window.__packSelectNative?._session;
  const t = s && [...s.tree.tasks.values()].find((x) => x.classId === c);
  return t ? s.mem.read32(t.address + o) | 0 : null;
}, [cls, off]);
/** The keyboard's own state: sub-state, cursor cell, slot cursor and glyph row. */
const keyboard = () => page.evaluate((cls) => {
  const s = window.__packSelectNative?._session;
  const t = s && [...s.tree.tasks.values()].find((x) => x.classId === cls);
  if (!t) return null;
  const hex = [];
  for (let i = 0; i < 8; i++) hex.push(s.mem.read16(t.address + 0x78 + i * 2));
  return {
    sub: s.mem.read32(t.address + 0x10) | 0,
    built: s.mem.read32(t.address + 0xc) | 0,
    col: s.mem.read32(t.address + 0x98) | 0,
    row: s.mem.read32(t.address + 0x9c) | 0,
    slot: s.mem.read32(t.address + 0x90) | 0,
    glyphs: hex,
  };
}, WIZ_KEYBOARD);
const press = async (key, ms = 110) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(130);
};
const waitPanel = async (cls, off, want, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await panel(cls, off)) === want) return true;
    await page.waitForTimeout(120);
  }
  return false;
};

let failed = null;
const fail = async (msg) => {
  failed = msg;
  console.error("FAIL:", msg);
  try {
    writeFileSync(`${OUT}/failure-state.json`, JSON.stringify(await page.evaluate((cls) => {
      const s = window.__packSelectNative?._session;
      const field = (c, off) => {
        const t = s && [...s.tree.tasks.values()].find((x) => x.classId === c);
        return t ? s.mem.read32(t.address + off) | 0 : null;
      };
      return {
        keyboard: field(cls, 0x10), keyboardBuilt: field(cls, 0xc), col: field(cls, 0x98),
        row: field(cls, 0x9c), slot: field(cls, 0x90),
        packList: field(0x80087a30, 0xc), confirm: field(0x80086eb8, 0xc),
        open: !!window.__state.packSelect,
        diagnostics: window.__packSelectNative?.diagnostics?.() ?? null,
        playerName: window.__state.playerName,
        map: window.__state?.manifest?.maps?.[window.__state.mapIdx]?.id ?? null,
        textbox: window.__textbox?.isOpen?.() ?? false,
      };
    }, WIZ_KEYBOARD), null, 2));
    await shot("failure");
  } catch { /* page may be gone */ }
};

// Pump Enter through text windows at high speed; stop when `ready` reports true.
async function pump({ until, deadlineMs }) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      pack: !!window.__state.packSelect,
      tb: window.__textbox?.isOpen?.() ?? false,
      cut: window.__cutscene?.isActive?.() ?? false,
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
    }));
    if (until(st)) return st;
    if (st.tb) await press("Enter", 60);
    else await page.waitForTimeout(60);
  }
  return null;
}

try {
  await page.goto(ROOT + "?skipTitle=1&map=s785&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });

  // Phase 1: blitz the authored cutscene to the registration hand-off (1280).
  const wizard = await pump({
    until: (st) => st.pack,
    deadlineMs: 30_000,
  });
  if (!wizard) await fail("event 014a0001 never reached the registration wizard");
  // The clerk's introduction: confirm each page until the keyboard is typing.
  for (let i = 0; i < 300; i++) {
    if ((await panel(WIZ_KEYBOARD, KB_SUBSTATE)) === 2) break;
    await press("Enter", 110);
  }
  if ((await panel(WIZ_KEYBOARD, KB_SUBSTATE)) !== 2)
    await fail(`the account-name keyboard never opened: state ${await panel(WIZ_KEYBOARD, KB_SUBSTATE)}`);
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await page.waitForTimeout(500);

  // The field opens with the walker's placeholder name and the cursor on the
  // first letter cell, which is where the typed character lands.
  const seed = await page.evaluate(() => window.__packSelectNative.accountName());
  const start = await keyboard();
  if (start.built !== 1 || start.col !== 0 || start.row !== 0 || start.slot !== 0)
    await fail(`the keyboard opened wrong: ${JSON.stringify(start)}`);
  if (!seed) await fail("the keyboard opened with an empty account name");
  await shot("name-open");

  // Ordinary input: press one letter. Exactly one glyph must change and the
  // slot cursor must move on by one.
  await press("Enter", 130);
  const typed = await keyboard();
  const changed = typed.glyphs.filter((g, i) => g !== start.glyphs[i]).length;
  if (changed !== 1 || typed.slot !== start.slot + 1)
    await fail(`typing changed ${changed} glyph(s) and left the slot cursor at ${typed.slot} ` +
      `(expected 1 change, slot ${start.slot + 1})`);
  if (typed.col !== 0 || typed.row !== 0)
    await fail(`typing moved the grid cursor to ${typed.col},${typed.row}`);
  await shot("name-typed");

  // Walk the grid to the decoded OK cell (row 6, col 13). The keyboard skips
  // empty cells, so this re-reads the real cursor after every press instead of
  // counting presses. Start's decoded shortcut to that same cell is checked on
  // the way, from the first letter cell the cursor is on.
  const atCell = (k) => k && k.col === OK_CELL.col && k.row === OK_CELL.row;
  await press("i", 130);                          // Start jumps to the OK cell
  const jumped = await keyboard();
  if (!atCell(jumped))
    await fail(`Start left the cursor on ${jumped?.col},${jumped?.row}, expected the OK cell`);
  await press("ArrowUp", 130);                    // step off it again ...
  for (let i = 0; i < 12 && (await keyboard()).row !== OK_CELL.row; i++) await press("ArrowDown");
  for (let i = 0; i < 20; i++) {
    const k = await keyboard();
    if (atCell(k)) break;
    await press(k.col < OK_CELL.col ? "ArrowRight" : "ArrowLeft");
  }
  const at = await keyboard();
  if (!atCell(at)) await fail(`the arrow walk landed on ${at.col},${at.row}, expected the OK cell`);
  await shot("name-at-ok");
  await press("Enter", 140);         // OK accepts the name

  if (!(await waitPanel(WIZ_PACK_LIST, 0xc, 1, 30_000)))
    await fail("the starter-pack list never opened after the name was accepted");

  // The remaining wizard steps register the account with pack A.
  await press("Enter", 140);
  const asking = { live: await panel(WIZ_CONFIRM, 0xc), yesNo: await panel(WIZ_CONFIRM, 0x60) };
  if (asking.live !== 1 || asking.yesNo !== 0)
    await fail(`the register panel is not asking about YES: ${JSON.stringify(asking)}`);
  await press("Enter", 140);
  await page.waitForFunction(() => !window.__state.packSelect, null, { timeout: 30_000 });
  await page.waitForTimeout(100);
  await shot("name-after");

  const handoff = await page.evaluate(() => ({
    playerName: window.__state.playerName,
    lsName: localStorage.getItem("playerName"),
    accountName: window.__packSelectNative.accountName(),
    packId: window.__state.packId,
    open: !!window.__state.packSelect,
  }));
  const expected = "A" + seed.slice(1);   // the letter typed over the first slot
  if (handoff.playerName !== expected)
    await fail(`playerName ${JSON.stringify(handoff.playerName)}, expected ${JSON.stringify(expected)}`);
  if (handoff.lsName !== expected)
    await fail(`stored playerName ${JSON.stringify(handoff.lsName)}, expected ${JSON.stringify(expected)}`);
  if (handoff.accountName !== expected)
    await fail(`the wizard kept ${JSON.stringify(handoff.accountName)}, expected ${JSON.stringify(expected)}`);
  if (handoff.open) await fail("the registration wizard stayed open after YES");

  // Phase 3: the receiving consumer, event 014a0002, must carry us to s790.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const arrived = await pump({
    until: (st) => st.map === "s790" || (!st.cut && !st.tb && st.map !== "s785"),
    deadlineMs: 30_000,
  });
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await page.waitForTimeout(150);
  const end = await page.evaluate(() => ({
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
    playerName: window.__state.playerName,
  }));
  if (!arrived || end.map !== "s790") await fail(`event 014a0002 ended on ${end.map}, expected s790`);
  if (end.playerName !== expected) await fail(`playerName changed after the handoff: ${end.playerName}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, seed, start, typed, at, handoff, end }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);