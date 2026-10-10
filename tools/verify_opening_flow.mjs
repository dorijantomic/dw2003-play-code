// Drives the whole opening the way a player meets it: pick a language, watch
// (or skip) the opening movie, press Start at the title, choose New Game, then
// sit through the story scenes — s780 -> s785 (the Online Center clerk) ->
// s790 (the Chamber Room) -> s225 (the dive) -> s210 (the Main Lobby) ->
// the Tamer Service counter -> s212 (the partner download) -> s200.
// It must arrive at s200 with the account name and the downloaded partner.
// Run: npm run verify:opening
import { chromium } from "playwright";
import { mkdir as _mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const mkdirSafe = p => _mkdir(p, { recursive: true });
// Where the closing screenshots go. OPENING_SHOT relocates them, so a check can
// run with its own tree; the default is unchanged.
const SHOT_DIR = process.env.OPENING_SHOT ?? "/tmp/opening-shots";

// No executablePath: Playwright resolves the headless-shell browser that matches
// the installed package version (see package.json postinstall / setup:playwright).
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseUrl(8741)}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Wait for game to initialise (manifest load)
  await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 10000 });

  const press = async (key, ms = 120) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(140);
  };

  // The boot screen is the country / language pick (pro/cnty_sel, translated).
  // Its list only takes input once the startup state has reached sub-state 7;
  // Start (the "i" key) confirms the highlighted row.
  await page.waitForFunction(() => window.__cntyselNative?.active?.() === true
    && window.__cntyselNative.diagnostics().host?.state?.state1 === 7, null, { timeout: 30000 });
  const language = await page.evaluate(() => window.__cntyselNative.diagnostics());
  console.log("language screen:", JSON.stringify({ row: language.row, language: language.language }));
  let picked = null;
  for (let i = 0; i < 20 && !picked; i++) {
    await press("i");
    picked = await page.evaluate(() => window.__bootLanguage ?? null);
  }
  if (!picked) throw new Error("the language pick never committed");
  console.log("language picked:", JSON.stringify(picked));

  // The pick hands the launcher an opening movie (0xE01/0xE02). Start skips it.
  await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 30000 });
  const movie = await page.evaluate(() => window.__titleMovie());
  console.log("opening movie:", JSON.stringify({ code: movie.code }));
  await press("i");
  await page.waitForFunction(() => window.__titleMovie?.()?.open === false, null, { timeout: 30000 });

  // The title: "press Start" prompt, then the live two-option menu. The menu
  // opens on the lower Continue option, so Up moves to New Game; a stray Enter
  // on Continue would open the memory card instead.
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 30000 });
  console.log("title prompt");
  await press("i");
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 15000 });
  const openedOn = await page.evaluate(() => window.__titleState().highlight());
  console.log("title menu highlight on open:", openedOn);
  await press("ArrowUp");                    // Continue -> New Game
  const highlight = await page.evaluate(() => window.__titleState().highlight());
  if (highlight !== 0) throw new Error(`the title menu highlight is ${highlight}, expected New Game (0)`);
  await press("Enter");                      // confirm New Game
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });

  const mapId = () => page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id);

  // The registration wizard (the Account Clerk's screen) answers these keys:
  // its three panels are read straight out of the translated session.
  const WIZ_KEYBOARD = 0x80085a70;
  const WIZ_PACK_LIST = 0x80087a30;
  const WIZ_CONFIRM = 0x80086eb8;
  const panel = (cls, off) => page.evaluate(([c, o]) => {
    const s = window.__packSelectNative?._session;
    const t = s && [...s.tree.tasks.values()].find((x) => x.classId === c);
    return t ? s.mem.read32(t.address + o) | 0 : null;
  }, [cls, off]);

  let wizardStep = null;   // which wizard step is still to be answered
  const driveWizard = async () => {
    if (wizardStep === "keyboard" || (wizardStep === null && (await panel(WIZ_KEYBOARD, 0x10)) === 2)) {
      wizardStep = "keyboard";
      // Start jumps the keyboard cursor to the decoded OK cell, Enter accepts
      // the name the field opens with.
      await press("i", 110);
      await press("Enter", 140);
      return;
    }
    if (wizardStep === "keyboard" || wizardStep === null) {
      if ((await panel(WIZ_PACK_LIST, 0xc)) === 1) {
        wizardStep = "pack";
        await press("Enter", 140);          // accept the highlighted pack
        return;
      }
    }
    if (wizardStep === "pack" && (await panel(WIZ_CONFIRM, 0xc)) === 1) {
      wizardStep = "confirm";
      await press("Enter", 140);            // YES, register
      return;
    }
    // The clerk's introduction: confirm each page of text.
    await press("Enter", 110);
  };

  const advanceAllDialogue = async () => {
    for (let i = 0; i < 300; i++) {
      // advance textbox
      const busy = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
      if (busy) { await page.keyboard.press("Enter"); await page.waitForTimeout(80); continue; }
      // the Account Clerk's registration wizard (its account name, then its pack, then YES)
      if (await page.evaluate(() => !!window.__state?.packSelect)) { await driveWizard(); continue; }
      // accept name entry programmatically
      const ne = await page.evaluate(() => !!window.__state?.nameEntry);
      if (ne) {
        await page.evaluate(() => {
          window.__state.nameEntry.press();        // type 'A' (cursor starts at row=0,col=0)
          window.__state.nameEntry.selectEnd();    // mark done
          window.__state.nameEntryDone();          // commit + proceed
        });
        await page.waitForTimeout(100);
        continue;
      }
      // advance choice menu
      const ch = await page.evaluate(() => window.__choice?.isOpen?.() ?? false);
      if (ch) { await page.keyboard.press("Enter"); await page.waitForTimeout(80); continue; }
      // wait a tick for cutscene steps or map transitions
      await page.waitForTimeout(120);
      const idle = await page.evaluate(() =>
        !window.__textbox?.isOpen?.() &&
        !window.__state?.nameEntry &&
        !window.__state?.packSelect &&
        !window.__cutscene?.isActive?.());
      if (idle) break;
    }
  };

  console.log("start map:", await mapId());          // expect s780
  await mkdirSafe(SHOT_DIR);
  // The opening is a long run of authored scenes; blitz them so the check is
  // about the route, not about how many minutes of dialogue it is.
  await page.evaluate(() => { window.__gameSpeed = 4; });

  let lastMap = null;
  let lastChangeAt = Date.now();
  let talkedAtLobby = false;
  // The opening cutscenes are long and paced in native field ticks, so patience
  // is wall-clock: a map that has not changed for this long is a stall.
  const MAP_PATIENCE_MS = 120_000;
  for (let guard = 0; guard < 4000; guard++) {
    await advanceAllDialogue();
    const cur = await mapId();
    if (cur !== lastMap) {
      console.log("map:", cur);
      lastMap = cur;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt > MAP_PATIENCE_MS) {
      const diag = await page.evaluate(() => {
        const st = window.__state; const c = window.__cutscene;
        return {
          map: st.manifest.maps[st.mapIdx].id, x: Math.round(st.x), y: Math.round(st.y),
          ordinal: st.progressOrdinal, textbox: window.__textbox?.isOpen?.() ?? null,
          choice: window.__choice?.isOpen?.() ?? null, cutscene: c?.isActive?.() ?? null,
          wait: c?.debugWait?.() ?? null, opcodes: (c?.debugOpcodes?.() ?? []).map(String),
          screen: st.screen ?? null, fade: window.__fade?.dir ?? null,
        };
      });
      console.error("FAIL: stuck on map", cur, "for", MAP_PATIENCE_MS, "ms");
      console.error("DIAG", JSON.stringify(diag, null, 2));
      // Movement probe at the stall: hold each direction for 700ms and report
      // the position delta, so a collision block and an input lock differ.
      const walk = async (k) => {
        const a = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
        await page.keyboard.down(k); await page.waitForTimeout(700); await page.keyboard.up(k);
        await page.waitForTimeout(150);
        const b = await page.evaluate(() => [Math.round(window.__state.x), Math.round(window.__state.y)]);
        return { key: k, from: a, to: b, moved: a[0] !== b[0] || a[1] !== b[1] };
      };
      console.error("WALK", JSON.stringify([await walk("ArrowLeft"), await walk("ArrowDown"), await walk("ArrowUp"), await walk("ArrowRight")]));
      process.exit(1);
    }
    if (cur === "s200") break;
    // In the Main Lobby the opening's last step is the player speaking to the
    // Tamer Service counter (NPC 32); its talk event walks us to s212, where the
    // partner download runs and hands us to s200. Talking is raised through the
    // engine's own OnTalk, the call the walker's talk path makes.
    if (cur === "s210") {
      const busy = await page.evaluate(() =>
        (window.__textbox?.isOpen?.() ?? false) ||
        (window.__choice?.isOpen?.() ?? false) ||
        (window.__cutscene?.isActive?.() ?? false) ||
        !!window.__state?.packSelect);
      if (!busy) {
        if (!talkedAtLobby) {
          talkedAtLobby = true;
          const presented = await page.evaluate(() => !!window.__engineBridge.onTalk(32));
          console.log("talked to the Tamer Service counter:", presented);
          lastChangeAt = Date.now();
          continue;
        }
        // First field control: from the Main Lobby (s210) the route's exit to
        // Asuka City (s200) is the left-hand warp zone. Holding Left IS the
        // journey, and it is also the decoded exit event's own trigger.
        await page.keyboard.down("ArrowLeft");
        await page.waitForTimeout(450);
        await page.keyboard.up("ArrowLeft");
      }
    }
    // wait for fade transitions to complete
    const fading = await page.evaluate(() => window.__fade?.dir !== 0);
    if (fading) { await page.waitForTimeout(300); continue; }
    await page.waitForTimeout(120);
  }

  await page.evaluate(() => { window.__gameSpeed = 1; });
  await page.screenshot({ path: `${SHOT_DIR}/final.png` });
  const finalMap = await mapId();
  const playerName = await page.evaluate(() => window.__state?.playerName);
  const charId = await page.evaluate(() => window.__state?.charId);

  if (finalMap !== "s200") { console.error("FAIL: did not reach s200, at", finalMap); process.exit(1); }
  console.log("OK: reached s200 with name", playerName, "partner", charId);
} finally {
  await browser.close();
}
