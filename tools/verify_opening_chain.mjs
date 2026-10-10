// Opening chain: play the New Game route from the title all the way to the
// starter-pack download and print the map sequence it walked, then check the
// player can move on the map it settles on.
//
// The title draws its own menu on the canvas and its HTML rows are display:none
// (web/index.html), so New Game is started the way a player starts it: Start
// opens the Start/Continue split, Up moves off Continue onto Start, confirm
// picks it (the same three presses tools/verify_title_newgame.mjs uses).
// Playwright comes from the repo like every other verifier in tools/.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const seq = []; const failed = new Set();
try {
  const page = await browser.newPage();
  page.on("requestfailed", r => failed.add(r.url().split("/").slice(-2).join("/")));
  page.on("response", r => { if (r.status() === 404) failed.add("404 " + r.url().split("/").slice(-2).join("/")); });
  const hold = async (page, key, ms = 220) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
};

await page.goto(`${baseUrl(8741)}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // A clean boot opens the language screen first (pro/cnty_sel is the boot main's
  // 0x1600 target). It needs ~1.8 s to build its list before it samples the pad,
  // then Down Down reaches English and Start confirms — the same presses
  // tools/verify_native_boot_language.mjs uses.
  await page.waitForFunction(() => window.__cntyselNative?.isOpen?.() === true, null, { timeout: 20000 });
  await page.waitForTimeout(1800);
  await hold(page, "ArrowDown");
  await hold(page, "ArrowDown");
  for (let i = 0; i < 6; i++) {
    if (!(await page.evaluate(() => window.__cntyselNative?.isOpen?.() === true))) break;
    await hold(page, "i", 260);
  }
  await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 30000 });
  // Two opening movies follow the language choice, each about 120 s, and Start
  // skips one (tools/verify_title_movies.mjs). Skip both, as a player would.
  await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 40000 });
  for (let i = 0; i < 2; i++) {
    await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 40000 });
    await hold(page, "i", 260);
  }
  // A player starts a new game. The title sits on its prompt first; Start there
  // opens the Start/Continue split (tools/verify_title_newgame.mjs), then Up moves
  // off Continue onto Start and confirm picks it.
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 30000 });
  await hold(page, "i", 260);
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 20000 });
  await hold(page, "ArrowUp");
  await hold(page, "Enter", 260);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });

  // The authored opening is minutes long at 1x. The other opening verifiers raise
  // the game speed for the walk-through and drop it back afterwards; the same here.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const t0 = Date.now();
  let lastBash = 0;
  while (Date.now() - t0 < 220000) {
    const st = await page.evaluate(() => ({
      tb: window.__textbox?.isOpen?.() ?? false,
      ne: !!window.__state?.nameEntry,
      ch: window.__choice?.isOpen?.() ?? false,
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
      party: window.__state.party, packId: window.__state.packId,
      pack: !!window.__state.packSelect,
    }));
    if (seq[seq.length - 1] !== st.map) { seq.push(st.map); console.log(`[${((Date.now()-t0)/1000)|0}s] MAP:`, st.map, st.party ? "party=" + st.party.join(",") + " pack=" + st.packId : ""); }
    if (st.tb || st.ch) { await hold(page, "Enter", 90); continue; }
    // The naming screen reads the pad itself (web/nameentry-translated.js ticks
    // `state.keys` in update), so it is driven with the same real keys as the
    // rest of the route: Start jumps to the decoded OK cell, confirm commits it.
    if (st.ne) { await hold(page, "i", 200); await hold(page, "Enter", 200); continue; }
    // The starter-pack wizard on the ordinary translated route (pro/stplnmet's
    // port, engine/dw3/ui/*-session.ts). It pages an introduction first (one
    // confirm per page), then opens the account-name keyboard (Start jumps its
    // cursor to the OK cell, confirm accepts the name the field holds), the
    // pack list (confirm accepts the highlighted pack) and the "Register
    // account?" panel (confirm answers YES). Every step is a confirm press, so
    // mash Start+confirm until the wizard closes. A fixed short sequence
    // stopped pressing while the wizard was still open — the walk then stalled
    // on s785 forever (measured: the wizard needs ~40-50 presses).
    if (st.pack) {
      await hold(page, "i", 150);
      await hold(page, "Enter", 150);
      continue;
    }
    if (st.map === "s212" || st.map === "s200") break;
    // An authored scene can be waiting on a confirm with no text box up (a camera
    // beat or a "press to continue" plate). A player mashing confirm walks past
    // those, so do the same once a second.
    if (!st.tb && !st.ch && !st.ne && !st.pack && (Date.now() - lastBash) > 900) {
      lastBash = Date.now();
      await hold(page, "Enter", 120);
      continue;
    }
    await page.waitForTimeout(60);
  }

  await page.evaluate(() => { window.__gameSpeed = 1; });
  // Where the walk-through ended, so a reader can see what stopped it.
  console.log("settled on", JSON.stringify(await page.evaluate(() => ({
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
    x: window.__state.x, y: window.__state.y,
    ord: window.__state.progressOrdinal,
    cut: window.__cutscene?.isActive?.(),
    tb: window.__textbox?.isOpen?.(),
    pack: !!window.__state.packSelect,
  }))));
  await page.screenshot({ path: process.env.CHAIN_SHOT ?? "captures/opening-chain-end.png" });
  const moved = await page.evaluate(async () => {
    for (let i = 0; i < 40; i++) { if (!window.__cutscene.isActive() && window.__fade.dir === 0 && !window.__textbox.isOpen() && !window.__choice.isOpen()) break; await new Promise(r => setTimeout(r, 100)); }
    const x0 = window.__state.x, y0 = window.__state.y;
    window.__state.keys.add("d");
    await new Promise(r => setTimeout(r, 600));
    window.__state.keys.delete("d");
    return { moved: Math.abs(window.__state.x - x0) + Math.abs(window.__state.y - y0) > 1, x0, x1: Math.round(window.__state.x), cut: window.__cutscene.isActive(), map: window.__state.manifest.maps[window.__state.mapIdx].id };
  });

  console.log("\nSEQUENCE:", seq.join(" → "));
  console.log("dive→s225 reached:", seq.includes("s225"));
  console.log("reached lobby/Genji (s210/s212/s200):", seq.some(m => ["s210","s212","s200"].includes(m)));
  console.log("no soft-lock (moves on settled map):", moved.moved, JSON.stringify(moved));
  if (failed.size) console.log("FAILED/404 RESOURCES:", [...failed].slice(0,10));
} finally { await browser.close(); }
