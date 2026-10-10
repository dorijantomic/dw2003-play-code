// Driving the TRANSLATED pause pages from the field with real keys.
//
// The pause home (START) is now the ported pro/ststatus page and every row hands
// the pad to another ported page (web/game.js PAUSE_PAGE_ENTRIES, label -> entry;
// `menu.onNativePage` at web/game.js:537). A check that waits for a walker panel
// (`__menu.screen === "status-list"` / "items") therefore waits for a screen the
// game no longer routes to, and the walker's own `handleKey` is a no-op on the page.
//
// This module is the route, written once, out of the pages' own state words:
//   START -> the home list -> a named row -> that page's own prompt/step states ->
//   the See Equipment window inside the STATUS page.
//
// Every word read here is the page's own, from the walker's RAM addresses the
// translated session keeps (engine/dw3/ui/pause-root-session.ts):
//   home   root+0xc = 0x0C main step, root+0x10 = sub-step; 1/3 is the input step,
//          root+0x58 = the cursor's row.
//   status obj+0x10 = the page's step (0x0a "Choose Digimon", 0x0b the chooser),
//          obj+0x14 = the partner detail sheet's step (5 reads the pad, and
//          obj+0x74 is the See Digivolve / See Equipment row, 0/1),
//          obj+0x7c = the chooser's partner.
//   equip  the sub-screen is its own task (class 0x80088214, F0x80088214 root /
//          F0x8008744c tick): +0x10 its state (3 the six-slot list, 0x0f the item
//          grid), +0x60 the slot cursor, +0x68 the slot count, +0x78 eight halfwords
//          of item ids whose row 0 is the take-off sentinel 0xFFFF.
//
// The pages read the pad one frame behind the held word (web/status-translated.js),
// so every press here is a real keydown held across frames -- a synthetic
// `dispatchEvent` tap is consumed synchronously by the walker menu and never seen
// by these pages.
import { baseUrl } from "./verify-base-url.mjs";

/** The See Equipment sub-screen's task class (pro/ststatus F0x80088214). */
export const EQUIP_TASK_CLASS = 0x80088214;

/** A real held key. The pages sample the pad a frame behind the held word. */
export const press = async (page, key, ms = 90, after = 320) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(after);
};

/** The page's own words, all in one call. */
export const pageWords = (page) => page.evaluate((cls) => {
  const st = window.__status, s = st?._session, mem = s?.mem;
  if (!s || !mem) return null;
  const read32 = (a) => mem.read32(a) | 0;
  const obj = s.pageObject();
  const root = s.root >>> 0;
  const w = {
    entry: st.diagnostics().entry,
    open: st.isOpen(),
    home: { step: read32(root + 0xc), sub: read32(root + 0x10), row: read32(root + 0x58) },
    status: obj ? { step: read32(obj + 0x10), detail: read32(obj + 0x14),
                    sheetRow: read32(obj + 0x74), member: read32(obj + 0x7c) } : null,
    equip: null,
  };
  for (const t of s.tree.tasks.values()) {
    if ((t.classId >>> 0) !== cls) continue;
    const a = t.address >>> 0;
    w.equip = {
      state: read32(a + 0x10), slot: read32(a + 0x60), count: read32(a + 0x68),
      cursor: read32(a + 0x64),
      items: Array.from({ length: 8 }, (_, i) => mem.read16(a + 0x78 + i * 2)),
    };
  }
  return w;
}, EQUIP_TASK_CLASS);

/**
 * Poll the pages' own words until `read` returns exactly `want`, or give up.
 * Throws with what it last saw, so a failure says which step never arrived.
 */
export async function waitWords(page, read, want, what, tries = 300) {
  let got = null;
  for (let i = 0; i < tries; i++) {
    got = await read(page);
    if (JSON.stringify(got) === JSON.stringify(want)) return got;
    await page.waitForTimeout(100);
  }
  throw new Error(`the pause page never reached ${what}: got ${JSON.stringify(got)}`);
}

const homeReady = (page) => waitWords(page, async () => {
  const w = await pageWords(page);
  return w?.home ? [w.home.step, w.home.sub] : null;
}, [1, 3], "the pause home's input step");

/**
 * Press, poll until `read` matches `want`, press again -- up to `budget` ms.
 * A page arm that reads the pad for one tick only can be stepped straight over by a
 * press that lands before the page has ticked into it, so the press is repeated until
 * the page reaches the step it was aiming at. True when it got there.
 */
async function settleWords(page, read, want, budget, pressOnce) {
  const deadline = Date.now() + budget;
  do {
    await pressOnce();
    for (let i = 0; i < 12; i++) {
      if (JSON.stringify(await read(page)) === JSON.stringify(want)) return true;
      await page.waitForTimeout(100);
    }
  } while (Date.now() < deadline);
  return false;
}

const statusStep = (page) => pageWords(page).then((w) => w?.status?.step ?? null);
const statusDetail = (page) => pageWords(page).then((w) => w?.status?.detail ?? null);
const equipState = (page) => pageWords(page).then((w) => w?.equip?.state ?? null);

/** Press START on the field and wait for the pause home to be reading the pad. */
export async function openPauseHome(page) {
  await page.waitForFunction(() => window.__status?.diagnostics?.().entry === null
    || window.__status?.diagnostics?.().pending === false, null, { timeout: 20_000 }).catch(() => {});
  await press(page, "i", 140, 400);
  await page.waitForFunction(() => window.__status?.diagnostics?.().entry === "home",
    null, { timeout: 30_000 });
  await homeReady(page);
  return pageWords(page);
}

/** Walk the home cursor onto `row`, reading the home list's own row word. */
export async function homeRowTo(page, row, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const w = await pageWords(page);
    if (w.home.row === row) return w;
    await press(page, "ArrowDown", 70, 160);
  }
  const w = await pageWords(page);
  if (w.home.row !== row) throw new Error(`the home cursor sat on row ${w.home.row}, not ${row}`);
  return w;
}

/**
 * Home -> the named row's page -> (STATUS only) the lead's detail sheet, up and
 * reading the pad. `sheetRow` 0 is See Digivolve, 1 is See Equipment.
 */
export async function openPageFromHome(page, entry, { sheetRow = null } = {}) {
  const row = ["items", "sort", "map", "techniques", "status", "cardfolders"].indexOf(entry);
  if (row < 0) throw new Error(`no pause home row for ${entry}`);
  await openPauseHome(page);
  await homeRowTo(page, row);
  await press(page, " ");        // the disc confirms a pause row with Cross
  await page.waitForFunction((e) => window.__status?.diagnostics?.().entry === e,
    entry, { timeout: 30_000 });
  // The page object is built on the session's first tick; `pending` is the adapter's
  // own word for "named the page, no session yet".
  await page.waitForFunction(() => window.__status?.diagnostics?.().pending === false,
    null, { timeout: 30_000 });
  if (entry !== "status") return pageWords(page);
  // The three partner cards fold open before the page reads anything, then the page
  // asks which partner (pro/ststatus F0x8008DDB0 step 0x0b reads the pad) and hands the
  // lead to the detail sheet. Both of those steps last ONE tick each, so they are not
  // waited for by name -- the sheet's own input step (obj+0x14 === 5) is what is waited
  // for, and the press is repeated until the page gets there. The press is skipped once
  // the sheet is up, because on the sheet a press CONFIRMS the highlighted row.
  const pressForSheet = async () => {
    const w = await pageWords(page);
    if (w?.status?.detail === 5) return;
    await press(page, " ");
  };
  await settleWords(page, statusDetail, 5, 6_000, pressForSheet);
  await waitWords(page, statusDetail, 5, "the partner detail sheet's input step");
  if (sheetRow != null) {
    for (let i = 0; i < 6; i++) {
      const w = await pageWords(page);
      if (w.status.sheetRow === sheetRow) break;
      await press(page, "ArrowDown", 70, 160);
    }
    const w = await pageWords(page);
    if (w.status.sheetRow !== sheetRow)
      throw new Error(`the sheet prompt is on row ${w.status.sheetRow}, not ${sheetRow}`);
  }
  return pageWords(page);
}

/** The sheet's See Equipment prompt -> the six-slot list. */
export async function openEquipWindow(page) {
  await press(page, " ");
  await waitWords(page, equipState, 3, "the See Equipment six-slot list");
  return pageWords(page);
}

/** Walk the slot cursor onto `slot` (0 head, 1 body, 2 right hand, 3 left, 4/5 accessory). */
export async function equipSlotTo(page, slot, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const w = await pageWords(page);
    if (w.equip.slot === slot) return w;
    await press(page, "ArrowDown", 70, 160);
  }
  const w = await pageWords(page);
  if (w.equip.slot !== slot) throw new Error(`the slot cursor sat on ${w.equip.slot}, not ${slot}`);
  return w;
}

/** Open the item grid for the highlighted slot and read the eight rows it offers. */
export async function openEquipItemList(page) {
  await press(page, " ");
  await waitWords(page, equipState, 0x0f, "the equipment item list");
  const w = await pageWords(page);
  if (!w.equip) throw new Error("the item list came up with no window behind it");
  return w.equip.items;
}

/** Walk the item cursor onto `index` (the window's own item cursor, +0x64), in
 *  whichever direction it has to move: the list clamps at both ends, so only Down
 *  cannot always get there. */
export async function equipItemTo(page, index, tries = 16) {
  for (let i = 0; i < tries; i++) {
    const w = await pageWords(page);
    if (w.equip.cursor === index) return w;
    await press(page, w.equip.cursor < index ? "ArrowDown" : "ArrowUp", 70, 160);
  }
  const w = await pageWords(page);
  if (w.equip.cursor !== index)
    throw new Error(`the item cursor sat on ${w.equip.cursor}, not ${index}`);
  return w;
}

/** Back out of the See Equipment window, the sheet, the page, and the pause menu. */
export async function closePause(page, tries = 16) {
  const seen = [];
  for (let i = 0; i < tries; i++) {
    const w = await pageWords(page);
    if (!w?.open) return seen;
    seen.push(`${w.entry}:${w.status?.step ?? "-"}:${w.status?.detail ?? "-"}:${w.equip?.state ?? "-"}`);
    await press(page, "x", 90, 450);
  }
  if (await page.evaluate(() => window.__status?.isOpen?.() === true))
    throw new Error(`Back never closed the pause page (saw ${seen.join(" -> ")})`);
  return seen;
}

/** Serve THIS worktree's web/ and return the URL a pause check should open. */
export const pauseBase = (defaultPort = 8741, query = "skipTitle=1&noEncounters=1") =>
  `${baseUrl(defaultPort)}/?${query}`;
