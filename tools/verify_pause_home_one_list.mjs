// ONE pause home: the UI lab and the field's START both open the one translated
// list, with the table's rows in the table's order and the table's sounds.
//
// Serve THIS worktree's web/ on your own port, then:
//   VERIFY_PORT=8915 tools/run-playwright.sh tools/verify_pause_home_one_list.mjs [outDir]
//
// Every expected value is the original's own rule, read out of
// ~/ddw3/asm/dw2003/exe/fns.s (the resident list F0x8001270c / F0x800121b4) and
// ~/ddw3/asm/dw2003/pro/ststatus.s (the pages it opens), and written down with
// its line numbers in docs/research/ui/pause-home-button-table-2026-10-04.md.
// assets/native/** is denied, so no original instruction can run on any route
// below: if the hand-written web/menu.js list answered, its classes would be
// empty and this would fail.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = Number(process.env.VERIFY_PORT ?? 8915);
const ROOT = `${baseUrl(PORT)}/`;
const OUT = process.argv[2] ?? ".bunny-scratch/pause-home-one-list";
mkdirSync(OUT, { recursive: true });

const CURSOR = "0x8004513e";   // system02 — the list cursor stepping (table §3.2)
const CONFIRM = "0x8004503c";  // system00 — the click a confirmed row makes
const BACK = "0x800450bd";     // system01 — the click a cancelled row makes
const HOME_CLASS = 0x8001270c; // F0x8001270c: the resident pause list's tick
const ROW_LABELS = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS", "CARD FOLDERS"];

let failures = 0;
const log = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  log.push(line);
  console.log(line);
  if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });

/** The live list, read out of the page's own memory the way its tick writes it:
 *  the row widgets at root+0x24, the row cursor at root+0x58 and the cursor icon
 *  at slots+0x24. Game text codes: 0x04+n a digit, 0x0E+n a capital, 0x28+n a
 *  lower-case letter, and the pair 0x01,0x01 a space. */
const readHome = (target) => target.evaluate(() => {
  const st = window.__status, s = st?._session, mem = s?.mem;
  const d = st?.diagnostics?.() ?? null;
  const menuScreen = window.__menu?.screen ?? null;
  if (!s || !d || d.entry !== "home") return { home: false, entry: d?.entry ?? null, menuScreen, classes: d?.classes ?? [] };
  const slots = mem.read32(s.root + 0x24) >>> 0;
  const count = mem.read32(s.root + 0x5c) | 0;
  const lines = (w) => {
    const rec = w + 0x5c, buf = mem.read32(rec) >>> 0, len = mem.read16(rec + 6) & 0xff;
    let out = "";
    for (let i = 0; i < len; i++) {
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
    home: true, entry: "home", menuScreen, classes: d.classes, count, label, row: mem.read32(s.root + 0x58) | 0,
    cardFlag: mem.read32(s.root + 0x60) | 0, mapAllowed: mem.read32(s.root + 0x64) | 0,
    cursor: { x: mem.read32(icon + 0x58) | 0, y: mem.read32(icon + 0x5c) | 0, visible: mem.read32(icon + 0x64) | 0 },
  };
});
const packed = (target) => target.evaluate(() => ({ ...window.__status.diagnostics().packed }));
const hexKey = (k) => `0x${(Number(k) >>> 0).toString(16)}`;
const delta = (a, b) => Object.keys(b).filter((k) => (b[k] ?? 0) - (a[k] ?? 0) > 0)
  .map((k) => `${hexKey(k)}x${b[k] - (a[k] ?? 0)}`).sort();
/** `where` is the object that takes the keys (a Page, or the lab Page whose
 *  iframe it focused); `view` is where the game's own globals are read. */
const press = async (where, key, ms = 120, after = 320) => {
  await where.keyboard.down(key);
  await where.waitForTimeout(ms);
  await where.keyboard.up(key);
  await where.waitForTimeout(after);
};
/** The list open, settled, with its window finished folding in. */
const homeReady = (view) => view.waitForFunction(() => {
  const s = window.__status?._session;
  return window.__status?.diagnostics?.().entry === "home" && s && s.mem.read32(s.root + 0x10) === 3;
}, null, { timeout: 40000 });

/** The rows, the sounds and the cursor the table's §3.2 says a fresh list has,
 *  driven with real keys. Returns what the page did. */
async function driveRows(where, view, label) {
  const target = view;
  const opened = await readHome(target);
  const out = { label, opened, steps: [] };
  if (!opened.home) return out;
  const before = await packed(target);
  await press(where, "ArrowDown");
  out.steps.push({ key: "ArrowDown", sounds: delta(before, await packed(target)), row: (await readHome(target)).row });
  const bottom = await packed(target);
  await press(where, "ArrowUp");
  out.steps.push({ key: "ArrowUp", sounds: delta(bottom, await packed(target)), row: (await readHome(target)).row });
  const top = await packed(target);
  await press(where, "ArrowUp");
  out.steps.push({ key: "ArrowUp (blocked at the top)", sounds: delta(top, await packed(target)), row: (await readHome(target)).row });
  out.cursor = await target.evaluate(() => {
    const s = window.__status._session, mem = s.mem;
    const icon = mem.read32(mem.read32(s.root + 0x24) + 0x24);
    return { x: mem.read32(icon + 0x58) | 0, y: mem.read32(icon + 0x5c) | 0 };
  });
  return out;
}

try {
  // ---- 1. the UI lab's Status Menu button ---------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const pageErrors = [], executableRequests = [];
    page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("Failed to load resource")) pageErrors.push(`console: ${m.text()}`); });
    await page.route("**/assets/native/**", (route) => { executableRequests.push(route.request().url()); return route.abort(); });
    await page.addInitScript(() => {
      localStorage.setItem("assetMode", "authentic");
      localStorage.setItem("engineSchema", "2");
      localStorage.setItem("playerName", "Junior");
    });
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => {
      const f = document.getElementById("game");
      return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
    }, null, { timeout: 60000 });
    await page.click('[data-scr="menu"]');
    // The lab seeds a party because the pause pages draw partner cards.
    await page.waitForFunction(() => document.getElementById("game").contentWindow.__status?.diagnostics?.().entry === "home",
      null, { timeout: 40000 }).catch(() => {});
    // The lab's own click focuses the game iframe, so the Page takes the keys
    // while the Frame reads the game's globals.
    const target = page.frames().find((f) => /index\.html/.test(f.url()));
    if (!target) throw new Error("the lab's game iframe is not there");
    await homeReady(target).catch(() => {});
    await target.waitForTimeout(900);
    const run = await driveRows(page, target, "UI lab · Status Menu");
    const { opened, steps, cursor } = run;
    check("the UI lab's Status Menu opens the ONE pause home, not a hand-written copy",
      opened.home && opened.classes.includes(HOME_CLASS),
      JSON.stringify({ home: opened.home, entry: opened.entry, menuScreen: opened.menuScreen,
        classes: (opened.classes ?? []).map((c) => "0x" + c.toString(16)) }));
    check("the lab's list shows the table's rows in the table's order",
      JSON.stringify(opened.label) === JSON.stringify(ROW_LABELS.slice(0, opened.count)),
      JSON.stringify({ label: opened.label, count: opened.count }));
    check("the lab's list puts the cursor on the first row at its own position",
      opened.row === 0 && cursor.x === 0xb0 && cursor.y === 0x31 && opened.cursor.visible === 1,
      JSON.stringify({ row: opened.row, cursor }));
    check("the lab's list clicks the table's cursor word and stays silent when blocked",
      steps[0]?.sounds.includes(`${CURSOR}x1`) && steps[0]?.row === 1 &&
      steps[1]?.sounds.includes(`${CURSOR}x1`) && steps[1]?.row === 0 &&
      steps[2]?.sounds.length === 0 && steps[2]?.row === 0,
      JSON.stringify(steps));
    await page.screenshot({ path: `${OUT}/01-lab-status-menu.png` });
    // A row opens, and Back closes: the table's confirm and back words.
    const beforeRow = await packed(target);
    await press(page, "c");
    await target.waitForFunction(() => window.__status?.diagnostics?.().entry === "items", null, { timeout: 20000 }).catch(() => {});
    const row = { entry: (await readHome(target)).entry, sounds: delta(beforeRow, await packed(target)) };
    check("CONFIRM on ITEMS opens the page with the table's confirm word",
      row.entry === "items" && row.sounds.includes(`${CONFIRM}x1`), JSON.stringify(row));
    await page.screenshot({ path: `${OUT}/02-lab-items.png` });
    // Back out of the page. The list is rebuilt and folded before it reads the
    // pad again (table §3.2 "Cursor memory"), so wait for it to be interactive
    // before the press that closes it — otherwise the press lands on a folding
    // list, which reads no buttons at all.
    for (let n = 0; n < 8; n++) {
      if (await target.evaluate(() => window.__status?.diagnostics?.().entry) === "home") break;
      await press(page, "Escape", 120, 900);
    }
    await homeReady(target).catch(() => {});
    await target.waitForTimeout(400);
    const homeAgain = await readHome(target);
    const beforeBack = await packed(target);
    await press(page, "Escape");
    await target.waitForFunction(() => window.__status?.isOpen?.() === false, null, { timeout: 20000 }).catch(() => {});
    const back = { closed: await target.evaluate(() => window.__status?.isOpen?.() === false),
      row: homeAgain.row, entry: homeAgain.entry, sounds: delta(beforeBack, await packed(target)) };
    check("BACK from the lab's list closes it with the table's back word",
      back.closed && back.sounds.includes(`${BACK}x1`), JSON.stringify(back));
    check("the lab route requested no executable asset", executableRequests.length === 0, executableRequests.join(", "));
    check("the lab route had no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    // ---- 2. the Digivolve Demo lab screen still works ---------------------------
    await page.click('[data-scr="demosetup"]');
    await target.waitForFunction(() => window.__menu?.screen === "demosetup", null, { timeout: 20000 }).catch(() => {});
    const demoOpen = await target.evaluate(() => ({ screen: window.__menu?.screen ?? null,
      menuOpen: window.__state?.menuOpen === true, statusOpen: window.__status?.isOpen?.() === true }));
    await page.screenshot({ path: `${OUT}/03-lab-demo-setup.png` });
    await press(page, "Escape", 120, 600);
    await target.waitForTimeout(600);
    const demoBack = await readHome(target);
    check("the lab's Digivolve Demo screen still opens, and its Back returns to the ONE list",
      demoOpen.screen === "demosetup" && demoOpen.menuOpen &&
      demoBack.home && demoBack.classes.includes(HOME_CLASS) && demoBack.row === 0,
      JSON.stringify({ demoOpen, back: { home: demoBack.home, entry: demoBack.entry, menuScreen: demoBack.menuScreen } }));
    await page.screenshot({ path: `${OUT}/04-lab-demo-back.png` });
    await page.close();
  }

  // ---- 3. the development flag that used to select the second copy is gone --------
  for (const [name, query] of [["an ordinary START", ""], ["?legacyPause=1", "&legacyPause=1"]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [], executableRequests = [];
    page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
    await page.route("**/assets/native/**", (route) => { executableRequests.push(route.request().url()); return route.abort(); });
    await page.addInitScript(() => {
      localStorage.setItem("assetMode", "authentic");
      localStorage.setItem("engineSchema", "2");
      localStorage.setItem("playerName", "Junior");
    });
    await page.goto(`${ROOT}index.html?skipTitle=1&noEncounters=1${query}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.evaluate(() => {
      if (window.__cutscene?.isActive?.()) { window.__cutscene.start([], null, null); window.__cutscene.step(1); }
      window.__state.menuOpen = false;
    });
    await page.waitForTimeout(1200);
    await press(page, "i", 140, 600);
    await homeReady(page).catch(() => {});
    await page.waitForTimeout(700);
    const run = await driveRows(page, page, `field START · ${name}`);
    const { opened, steps } = run;
    check(`${name} opens the one translated list (class 0x8001270c)`,
      opened.home && opened.classes.includes(HOME_CLASS),
      JSON.stringify({ home: opened.home, entry: opened.entry, menuScreen: opened.menuScreen,
        classes: (opened.classes ?? []).map((c) => "0x" + c.toString(16)) }));
    check(`${name}: the same rows in the same order, with the same sounds`,
      JSON.stringify(opened.label) === JSON.stringify(ROW_LABELS.slice(0, opened.count)) &&
      steps[0]?.sounds.includes(`${CURSOR}x1`) && steps[2]?.sounds.length === 0,
      JSON.stringify({ label: opened.label, count: opened.count, steps }));
    check(`${name} requested no executable asset`, executableRequests.length === 0, executableRequests.join(", "));
    check(`${name} had no page errors`, pageErrors.length === 0, pageErrors.join(" | "));
    await page.screenshot({ path: `${OUT}/10-start${query ? "-legacy-pause" : ""}.png` });
    await page.close();
  }

  writeFileSync(`${OUT}/proof.json`, JSON.stringify({ execution: "translated", log, failures }, null, 2) + "\n");
  if (failures) { console.error(`FAIL pause home one list: ${failures} check(s) failed`); process.exitCode = 1; }
  else console.log("PASS pause home one list");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}