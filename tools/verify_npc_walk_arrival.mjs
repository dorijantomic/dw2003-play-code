// Live check: a scripted walk's ARRIVAL FACING (the WALKTO opcode's 4th operand).
//
// The disc's walk driver (fieldstg F0x8008eef0, file 0xc240-0xc31c) stores the
// opcode's 4th operand into the facing char+0x60 when the actor arrives. The
// s225 login-room scene (wstag_events.json s225 event 5) is the shipped case
// with no masking: `WALKTO 1 80 464 7` — the player walks DOWN-LEFT to the exit
// and must arrive facing DOWN-RIGHT (7). The walker used to keep the last walk
// direction (down-left) as the facing.
//
// Boots the ordinary opening the way verify_opening_flow.mjs does (language,
// skip the movie, title -> New Game) and samples the player's facing while the
// s225 scene runs. PASS requires "down-right" to be observed on s225.
//
// Run: tools/run-playwright.sh tools/verify_npc_walk_arrival.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseUrl(8741)}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 10000 });

  const press = async (key, ms = 120) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(140);
  };

  // Language pick -> skip the opening movie -> title -> New Game (see
  // verify_opening_flow.mjs for the decoded key grammar).
  await page.waitForFunction(() => window.__cntyselNative?.active?.() === true
    && window.__cntyselNative.diagnostics().host?.state?.state1 === 7, null, { timeout: 30000 });
  let picked = null;
  for (let i = 0; i < 20 && !picked; i++) {
    await press("i");
    picked = await page.evaluate(() => window.__bootLanguage ?? null);
  }
  if (!picked) throw new Error("the language pick never committed");
  await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 30000 });
  await press("i");
  await page.waitForFunction(() => window.__titleMovie?.()?.open === false, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 30000 });
  await press("i");
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 15000 });
  await press("ArrowUp");  // Continue -> New Game
  await press("Enter");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });

  // Drive the registration wizard + dialogue the way the opening verifier does.
  const WIZ_KEYBOARD = 0x80085a70;
  const WIZ_PACK_LIST = 0x80087a30;
  const WIZ_CONFIRM = 0x80086eb8;
  const panel = (cls, off) => page.evaluate(([c, o]) => {
    const s = window.__packSelectNative?._session;
    const t = s && [...s.tree.tasks.values()].find((x) => x.classId === c);
    return t ? s.mem.read32(t.address + o) | 0 : null;
  }, [cls, off]);

  let wizardStep = null;
  const driveWizard = async () => {
    if (wizardStep === "keyboard" || (wizardStep === null && (await panel(WIZ_KEYBOARD, 0x10)) === 2)) {
      wizardStep = "keyboard";
      await press("i", 110);
      await press("Enter", 140);
      return;
    }
    if (wizardStep === "keyboard" || wizardStep === null) {
      if ((await panel(WIZ_PACK_LIST, 0xc)) === 1) {
        wizardStep = "pack";
        await press("Enter", 140);
        return;
      }
    }
    if (wizardStep === "pack" && (await panel(WIZ_CONFIRM, 0xc)) === 1) {
      wizardStep = "confirm";
      await press("Enter", 140);
      return;
    }
    await press("Enter", 110);
  };

  const dirsOnS225 = new Set();
  let walkedToExit = false;
  let sawS225 = false;
  let sawS210 = false;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      map: window.__state?.manifest?.maps?.[window.__state.mapIdx]?.id ?? null,
      dir: window.__state?.dir ?? null,
      x: window.__state?.x ?? null,
      y: window.__state?.y ?? null,
      cs: window.__cutscene?.isActive?.() ?? false,
      box: window.__textbox?.isOpen?.() ?? false,
      choice: window.__choice?.isOpen?.() ?? false,
      pack: !!window.__state?.packSelect,
      ne: !!window.__state?.nameEntry,
    }));
    if (st.map === "s225") {
      sawS225 = true;
      dirsOnS225.add(st.dir);
      if (st.x != null && st.x < 120) walkedToExit = true;
    }
    if (st.map === "s210") { sawS210 = true; break; }
    if (st.box) { await page.keyboard.press("Enter"); await page.waitForTimeout(40); continue; }
    if (st.pack) { await driveWizard(); continue; }
    if (st.ne) {
      await page.evaluate(() => {
        window.__state.nameEntry.press();
        window.__state.nameEntry.selectEnd();
        window.__state.nameEntryDone();
      });
      await page.waitForTimeout(100);
      continue;
    }
    if (st.choice) { await page.keyboard.press("Enter"); await page.waitForTimeout(60); continue; }
    await page.waitForTimeout(25);
  }

  console.log("s225 seen:", sawS225, "walked to the exit:", walkedToExit, "s210 reached:", sawS210);
  console.log("player facings seen on s225:", [...dirsOnS225].join(", "));
  const ok = sawS225 && walkedToExit && dirsOnS225.has("down-right");
  if (!ok) {
    console.error("FAIL: the arrival facing (WALKTO 1 80 464 7 -> down-right) was never applied on s225");
    process.exit(1);
  }
  console.log("OK: the scripted walk to the s225 exit arrived facing down-right (the opcode's 4th operand)");
} finally {
  await browser.close();
}
