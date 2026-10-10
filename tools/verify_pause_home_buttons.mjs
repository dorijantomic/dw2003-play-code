// Every button on the translated pause home: its row, its key, its sound, its gate
// and what it opens — read off the live page after one real key press.
//
// Serve THIS worktree's web/ on your own port, then:
//   VERIFY_PORT=8915 tools/run-playwright.sh tools/verify_pause_home_buttons.mjs [outDir]
//
// Every expected value is the original's own rule, read out of
// ~/ddw3/asm/dw2003/exe/fns.s (the resident list, F0x8001270c / F0x800121b4) and
// ~/ddw3/asm/dw2003/pro/ststatus.s (the pages it opens), and written down with
// its line numbers in docs/research/ui/pause-home-button-table-2026-10-04.md.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = Number(process.env.VERIFY_PORT ?? 8915);
const ROOT = `${baseUrl(PORT)}/`;
const OUT = process.argv[2] ?? ".bunny-scratch/pause-home-buttons";
mkdirSync(OUT, { recursive: true });

// The packed words the original plays, by the name the disc's own sample list
// files them under (web/assets/sfx/manifest.json).
const CURSOR = "0x8004513e";   // system02 — the list cursor stepping
const CONFIRM = "0x8004503c";  // system00 — the click a confirmed row makes
const BACK = "0x800450bd";     // system01 — the click a cancelled row makes
const OPEN = "0x40019";        // system03 — a window folding open
// The esstatus ids D0x8003ef14 holds, one per row (web/assets/data/pause/home-data.bin).
const ROW_LABELS = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS", "CARD FOLDERS"];
const ROW_ENTRIES = ["items", "sort", "map", "techniques", "status", "cardfolders"];
// The page object each row's factory makes, by the handler the session registers.
const ROW_CLASSES = {
  items: 0x80091d18, sort: 0x800980b0, map: 0x8009913c, techniques: 0x80096380,
  status: 0x8008e744, cardfolders: 0x80084a98,
};

let failures = 0;
const log = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  log.push(line);
  console.log(line);
  if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [], executableRequests = [];
page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) pageErrors.push(`console: ${m.text()}`); });
await page.route("**/assets/native/**", (route) => { executableRequests.push(route.request().url()); return route.abort(); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
});

const press = async (key, ms = 120, after = 300) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(after);
};
const diag = () => page.evaluate(() => window.__status.diagnostics());
const packedNow = () => page.evaluate(() => ({ ...window.__status.diagnostics().packed }));
const hexKey = (k) => `0x${(Number(k) >>> 0).toString(16)}`;
const delta = (a, b) => Object.keys(b).filter((k) => (b[k] ?? 0) - (a[k] ?? 0) > 0)
  .map((k) => `${hexKey(k)}x${b[k] - (a[k] ?? 0)}`).sort();
/** The live list, read out of the page's own memory the way the tick writes it. */
const homeState = () => page.evaluate(() => {
  const st = window.__status, s = st?._session, mem = s?.mem;
  if (!s || st.diagnostics().entry !== "home") return null;
  const slots = mem.read32(s.root + 0x24) >>> 0;
  const count = mem.read32(s.root + 0x5c) | 0;
  // The game's own text codes (web/status-translated.js encodePauseName): 0x04+n a
  // digit, 0x0E+n a capital, 0x28+n a lower-case letter, and the pair 0x01,0x01 a
  // space. Everything else is a bracket or punctuation glyph that prints as nothing.
  const lines = (w) => {
    const rec = w + 0x5c, buf = mem.read32(rec) >>> 0, len = mem.read16(rec + 6) & 0xff;
    let out = "", i = 0;
    for (; i < len; i++) {
      const c = mem.read8(buf + i);
      if (c === 0x01) { if (mem.read8(buf + i + 1) === 0x01) { out += " "; i++; } continue; }
      if (c >= 0x04 && c <= 0x0d) out += String(c - 0x04);
      else if (c >= 0x0e && c <= 0x27) out += String.fromCharCode(0x41 + c - 0x0e);
      else if (c >= 0x28 && c <= 0x47) out += String.fromCharCode(0x61 + c - 0x28);
    }
    return out;
  };
  const label = [];
  for (let i = 0; i < count; i++) label.push(lines(mem.read32(slots + 0xc + i * 4) >>> 0));
  const icon = mem.read32(slots + 0x24) >>> 0;
  return {
    row: mem.read32(s.root + 0x58) | 0, count,
    cardFlag: mem.read32(s.root + 0x60) | 0, mapAllowed: mem.read32(s.root + 0x64) | 0,
    label, cursor: { x: mem.read32(icon + 0x58) | 0, y: mem.read32(icon + 0x5c) | 0, visible: mem.read32(icon + 0x64) | 0 },
    prompt: lines(mem.read32(slots) >>> 0), bit: lines(mem.read32(slots + 4) >>> 0),
  };
});
const cursorAt = () => page.evaluate(() => {
  const s = window.__status._session, mem = s.mem;
  const slots = mem.read32(s.root + 0x24) >>> 0;
  const icon = mem.read32(slots + 0x24) >>> 0;
  return { x: mem.read32(icon + 0x58) | 0, y: mem.read32(icon + 0x5c) | 0 };
});
const homeReady = () => page.waitForFunction(() => {
  const st = window.__status, s = st?._session;
  return st?.diagnostics?.().entry === "home" && st.diagnostics().pending === false && s &&
    s.mem.read32(s.root + 0x10) === 3;
}, null, { timeout: 40000 });
const closed = () => page.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 20000 });
/** Field START, on a fixture whose scripted opening has been settled. */
const openHome = async () => {
  await page.evaluate(() => {
    if (window.__cutscene?.isActive?.()) { window.__cutscene.start([], null, null); window.__cutscene.step(1); }
    window.__state.menuOpen = false;
  });
  await page.waitForTimeout(1500);
  await press("i", 140, 500);
  await homeReady();
  await page.waitForTimeout(700);
};
try {
  await page.goto(`${ROOT}?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
  await page.evaluate(() => {
    const s = window.__state;
    s.party = ["p003pken", "p004kogu", "p006rna"];
    const stats = { level: 12, xp: 100, tp: 30, hp: 45, maxHp: 50, mp: 21, maxMp: 25,
      core: [50, 40, 30, 20, 10, 5], elements: [1, 2, 3, 4, 5, 6, 7] };
    s.partyStats = s.party.map(() => ({ ...stats }));
    s.partnerStats = s.partyStats[0];
    s.inventory = [{ id: 43, qty: 3 }, { id: 40, qty: 1 }];
    s.equipment = [];
  });
  await page.waitForFunction(() => (window.__cards?.()?.folders?.length ?? 0) > 0, null, { timeout: 30000 }).catch(() => {});
  const folders = await page.evaluate(() => window.__menu.cardFolderUnlocked?.() === true);

  await openHome();
  const opened = await homeState();
  const d0 = await diag();
  check("START opens the translated home list", d0.classes.includes(0x8001270c) && d0.entry === "home",
    JSON.stringify({ entry: d0.entry, error: d0.error }));
  check("the list shows the disc's rows in the disc's order",
    JSON.stringify(opened.label) === JSON.stringify(ROW_LABELS.slice(0, opened.count)) && opened.count === (folders ? 6 : 5),
    JSON.stringify({ label: opened.label, count: opened.count, folders }));
  check("the cursor starts on ITEMS at the first row's own height",
    opened.row === 0 && opened.cursor.x === 0xb0 && opened.cursor.y === 0x31 && opened.cursor.visible === 1,
    JSON.stringify({ row: opened.row, cursor: opened.cursor }));
  check("the list prints Close Status at the top and the player's money beside BIT",
    opened.prompt.includes("Button") && opened.prompt.includes("Close Status") && opened.bit === "BIT",
    JSON.stringify({ prompt: opened.prompt, bit: opened.bit }));
  await page.screenshot({ path: `${OUT}/00-home.png` });
  const leaveHome = async () => {
    for (let n = 0; n < 14 && (await diag()).open; n++) await press("Escape", 120, 800);
    await closed();
  };
  await leaveHome();

  // ---- every key, one at a time, on a freshly opened list --------------------------
  // `prepare` walks the cursor there first, `then` is what the key must do:
  // "opens" the row, "closes" the list, "moves" the cursor one row (with the
  // cursor's click), "silent" nothing at all.
  const KEYS = [
    ["ArrowDown", "Down", [], "moves"],
    ["ArrowUp", "Up", ["ArrowDown"], "moves"],
    ["ArrowLeft", "Left", [], "silent"],
    ["ArrowRight", "Right", [], "silent"],
    ["c", "Cross — the walker's confirm", [], "opens"],
    ["Enter", "Enter — confirm as well", [], "opens"],
    ["x", "Triangle — the walker's back", [], "closes"],
    ["Escape", "Escape — back as well", [], "closes"],
    ["v", "Square", [], "silent"],
    ["k", "Circle — the third face button", [], "silent"],
    ["i", "START", [], "silent"],
    ["r", "Select", [], "silent"],
    ["q", "L1", [], "silent"],
    ["e", "R1", [], "silent"],
  ];
  const table = [];
  for (const [key, name, prepare, then] of KEYS) {
    await openHome();
    const from = (await homeState()).row;
    let target = from;
    for (const k of prepare) {
      target = k === "ArrowDown" ? from + 1 : from - 1;
      await press(k, 100, 150);
      await page.waitForFunction((want) => {
        const s = window.__status._session;
        return (s.mem.read32(s.root + 0x58) | 0) === want;
      }, target, { timeout: 8000 }).catch(() => {});
    }
    const before = await packedNow();
    await press(key);
    let entry = (await diag()).entry, home = await homeState();
    if (then === "opens") {
      await page.waitForFunction((want) => window.__status?.diagnostics?.().entry === want,
        ROW_ENTRIES[target], { timeout: 20000 }).catch(() => {});
      entry = (await diag()).entry;
    } else if (then === "closes") {
      await closed();
      entry = null; home = null;
    } else {
      await page.waitForTimeout(200);
      home = await homeState();
    }
    const sounds = delta(before, await packedNow());
    table.push({ key, name, from: target, sounds, entry, row: home?.row ?? null });
    const ok = then === "opens" ? entry === ROW_ENTRIES[target] && sounds.includes(`${CONFIRM}x1`)
      : then === "closes" ? entry === null && sounds.includes(`${BACK}x1`)
        : then === "moves" ? home !== null && home.row === (target === 0 ? 1 : 0) && sounds.includes(`${CURSOR}x1`)
          : home !== null && home.row === target && sounds.length === 0;
    check(`${name} (${key})`, ok, JSON.stringify({ sounds, entry, row: home?.row ?? null, from: target }));
    await leaveHome();
  }
  writeFileSync(`${OUT}/keys.json`, JSON.stringify(table, null, 2) + "\n");

  // ---- the walk: clamp, no wrap, and silence on a press that cannot move -------------
  await openHome();
  const walk = [];
  for (let i = 0; i < 8; i++) {
    const before = await packedNow();
    await press("ArrowDown");
    walk.push({ sounds: delta(before, await packedNow()), ...(await cursorAt()), row: (await homeState()).row });
  }
  const up = [];
  for (let i = 0; i < 8; i++) {
    const before = await packedNow();
    await press("ArrowUp");
    up.push({ sounds: delta(before, await packedNow()), ...(await cursorAt()), row: (await homeState()).row });
  }
  writeFileSync(`${OUT}/walk.json`, JSON.stringify({ down: walk, up }, null, 2) + "\n");
  const blockedDown = walk[walk.length - 1], blockedUp = up[up.length - 1];
  check("the cursor clamps at the last row and the blocked press is silent",
    blockedDown.row === opened.count - 1 && blockedDown.sounds.length === 0, JSON.stringify(blockedDown));
  check("every row the cursor lands on sits 14 pixels below the one above it",
    walk.every((w) => w.x === 0xb0 && w.y === 0x31 + w.row * 0xe) && up.every((u) => u.x === 0xb0 && u.y === 0x31 + u.row * 0xe),
    JSON.stringify({ down: walk.map((w) => [w.row, w.y]), up: up.map((u) => [u.row, u.y]) }));
  check("a real move clicks once; a press that cannot move says nothing",
    walk.filter((w, i) => i === 0 || w.row !== walk[i - 1].row).every((w) => w.sounds.length === 1 && w.sounds[0] === `${CURSOR}x1`) &&
    up.filter((u, i) => i === 0 || u.row !== up[i - 1].row).every((u) => u.sounds.length === 1 && u.sounds[0] === `${CURSOR}x1`) &&
    walk.filter((w, i) => i > 0 && w.row === walk[i - 1].row).every((w) => w.sounds.length === 0) &&
    up.filter((u, i) => i > 0 && u.row === up[i - 1].row).every((u) => u.sounds.length === 0),
    JSON.stringify({ down: walk.map((w) => w.sounds), up: up.map((u) => u.sounds) }));
  check("the list does not wrap: the top and the bottom both stop",
    blockedUp.row === 0 && blockedUp.sounds.length === 0 && blockedDown.row === opened.count - 1,
    JSON.stringify({ top: blockedUp, bottom: blockedDown }));
  await page.screenshot({ path: `${OUT}/01-walk.png` });

  // ---- every row opens its own page, and the list comes back on it --------------------
  /** The list, open and sitting on `row`; opens it again if a stray Back closed it. */
  const ensureRow = async (row) => {
    for (let guard = 0; guard < 30; guard++) {
      const home = await homeState();
      if (home) {
        if (home.row === row) return home;
        await press(home.row < row ? "ArrowDown" : "ArrowUp", 100, 160);
        continue;
      }
      await closed().catch(() => {});
      await openHome();
    }
    throw new Error(`the pause list would not sit on row ${row}`);
  };
  const openedRows = [];
  for (let row = 0; row < opened.count; row++) {
    // A fresh list each time, so one page's exit cannot colour the next row.
    await openHome();
    for (let i = 0; i < row; i++) {
      await press("ArrowDown", 100, 160);
      await page.waitForFunction((want) =>
        (window.__status._session.mem.read32(window.__status._session.root + 0x58) | 0) === want,
      i + 1, { timeout: 8000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
    const cursorY = await cursorAt();
    const before = await packedNow();
    await press("c");
    const sounds = delta(before, await packedNow());
    let landed = true;
    await page.waitForFunction((want) => {
      const dd = window.__status?.diagnostics?.();
      return dd?.open && !dd.pending && dd.entry === want;
    }, ROW_ENTRIES[row], { timeout: 30000 }).catch(() => { landed = false; });
    await page.waitForFunction((cls) => window.__status.diagnostics().classes.includes(cls),
      ROW_CLASSES[ROW_ENTRIES[row]], { timeout: 30000 }).catch(() => { landed = false; });
    const d = await diag();
    openedRows.push({ row, label: ROW_LABELS[row], entry: d.entry, cursorY, sounds, classes: d.classes });
    check(`row ${row} (${ROW_LABELS[row]}) sits its own row and CONFIRM opens ${ROW_ENTRIES[row]}`,
      landed && cursorY.x === 0xb0 && cursorY.y === 0x31 + row * 0xe && d.entry === ROW_ENTRIES[row] &&
      d.classes.includes(ROW_CLASSES[ROW_ENTRIES[row]]) && sounds.includes(`${CONFIRM}x1`),
      JSON.stringify({ cursorY, entry: d.entry, sounds, classes: d.classes.map((c) => "0x" + c.toString(16)) }));
    await page.screenshot({ path: `${OUT}/1${row + 1}-${ROW_ENTRIES[row]}.png` });
    // Back out of the page and check the list returns on the row the player chose.
    for (let n = 0; n < 16 && (await diag()).entry !== "home"; n++) await press("Escape", 120, 700);
    const back = await homeState();
    check(`row ${row} comes back on the row the player chose`, back !== null && back.row === row,
      JSON.stringify({ row: back ? back.row : null, entry: (await diag()).entry }));
    await leaveHome();
  }
  writeFileSync(`${OUT}/rows.json`, JSON.stringify(openedRows, null, 2) + "\n");

  // ---- BACK closes the list -------------------------------------------------------------
  {
    await openHome();                       // the row sweep leaves the menu shut
    const before = await packedNow();
    await press("Escape");
    const sounds = delta(before, await packedNow());
    await closed();
    check("BACK closes the list and plays the back click", sounds.includes(`${BACK}x1`), JSON.stringify(sounds));
    check("the field takes its START back", (await page.evaluate(() => window.__state.menuOpen)) === false, "");
  }

  check("no executable asset was requested", executableRequests.length === 0, executableRequests.join(", "));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  writeFileSync(`${OUT}/proof.json`, JSON.stringify({ execution: "translated", log, executableRequests, errors: pageErrors, failures }, null, 2) + "\n");
  if (failures) { console.error(`FAIL pause home buttons: ${failures} check(s) failed`); process.exitCode = 1; }
  else console.log("PASS pause home buttons");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
