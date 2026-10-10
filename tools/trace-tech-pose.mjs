/**
 * Drive battle-test.html and trace animation state through battle.js.
 * Tests what pose happens when a tech attack is executed.
 *
 * Usage: tools/run-playwright.sh tools/trace-tech-pose.mjs
 */

import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const out = process.env.OUT_DIR ?? "/tmp/tech-pose-trace";
fs.mkdirSync(out, { recursive: true });

// Simple HTTP server
const PORT = 3459;
const root = path.join(process.cwd(), "web");
const server = http.createServer((req, res) => {
  let filePath = path.join(root, req.url);
  if (filePath.endsWith("/")) filePath += "index.html";
  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
  }[ext] ?? "application/octet-stream";
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  
  page.on('console', msg => {
    const args = msg.args();
    const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.log(`[CONSOLE ${msg.type()}] ${text}`);
  });
  
  page.on('pageerror', err => {
    console.log(`[PAGE ERROR] ${err.message}`);
    console.log(`[STACK] ${err.stack || String(err)}`);
  });
  
  // Also capture all page events
  page.on('requestfinished', req => {
    if (req.url().includes('.js') || req.url().includes('.html')) {
      console.log(`[REQUEST] ${req.url()}`);
    }
  });
  
  // Also capture console log with empty args
  page.on('console', msg => {
    const args = msg.args();
    const type = msg.type();
    if (args.length === 0) {
      console.log(`[CONSOLE EMPTY ${type}]`);
    } else {
      const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      console.log(`[CONSOLE ${type}] ${text}`);
    }
  });

  await page.goto(`http://localhost:${PORT}/battle-test.html`);
  await new Promise(r => setTimeout(r, 1000));
  
  // Check what's loaded
  const loaded = await page.evaluate(() => {
    return {
      battle3d: typeof window.createBattle3D,
      battle: typeof window.createBattle,
      __battleTest: !!window.__battleTest,
      __battle3d: !!window.__battle3d,
    };
  });
  console.log("Pre-load state:", JSON.stringify(loaded));
  
  // Wait for model selectors
  await page.waitForSelector("#playerSel", { timeout: 15000 });
  
  // Check post-load state
  const afterLoad = await page.evaluate(() => {
    return {
      battle3d: typeof window.createBattle3D,
      battle: typeof window.createBattle,
      __battleTest: !!window.__battleTest,
      __battle3d: !!window.__battle3d,
    };
  });
  console.log("Post-load state:", JSON.stringify(afterLoad));
  
  // Take screenshot of loaded page
  await page.screenshot({ path: `${out}/00-loaded.png`, fullPage: false });
  
  // Check if OffscreenCanvas is available
  const hasOffscreen = await page.evaluate(() => typeof OffscreenCanvas !== "undefined");
  console.log("OffscreenCanvas available:", hasOffscreen);
  
  // Find Renamon and select it
  const playerOptions = await page.$$("#playerSel option");
  let renamonIdx = 0;
  for (let i = 0; i < playerOptions.length; i++) {
    const text = await playerOptions[i].textContent();
    if (text.toLowerCase().includes("renamon")) {
      renamonIdx = i;
      break;
    }
  }

  await page.evaluate((idx) => {
    document.querySelector("#playerSel").selectedIndex = idx;
    document.querySelector("#playerSel").dispatchEvent(new Event("change"));
  }, renamonIdx);

  await new Promise(r => setTimeout(r, 500));
  
  // Find Agumon and select it  
  const enemyOptions = await page.$$("#enemySel option");
  let agumonIdx = 0;
  for (let i = 0; i < enemyOptions.length; i++) {
    const text = await enemyOptions[i].textContent();
    if (text.toLowerCase().includes("agumon")) {
      agumonIdx = i;
      break;
    }
  }

  await page.evaluate((idx) => {
    document.querySelector("#enemySel").selectedIndex = idx;
  }, agumonIdx);

  await new Promise(r => setTimeout(r, 500));
  
  // Click Start Battle
  const startBtn = await page.$("#startBtn");
  if (!startBtn) {
    console.log("ERROR: Could not find #startBtn");
    await page.screenshot({ path: `${out}/01-missing-btn.png` });
    await browser.close();
    server.close();
    return;
  }
  
  // Check if the click handler is registered by looking at the button's onclick property
  const clickHandlerCheck = await page.evaluate(() => {
    const btn = document.getElementById("startBtn");
    if (!btn) return { error: "no button" };
    // Check if there's an onclick handler
    return {
      hasOnclick: !!btn.onclick,
      hasAddEventListener: btn.addEventListener !== undefined,
      tag: btn.tagName,
      id: btn.id,
    };
  });
  console.log("Button check:", JSON.stringify(clickHandlerCheck));
  
  // Try to click the button
  await startBtn.click();
  console.log("Clicked start button");
  
  // Wait and check if __battleTest is set
  await new Promise(r => setTimeout(r, 1000));
  
  // Check if __battleTest is set
  const afterClick = await page.evaluate(() => {
    return {
      __battleTest: !!window.__battleTest,
      __battle3d: !!window.__battle3d,
    };
  });
  console.log("After click:", JSON.stringify(afterClick));
  
  // Wait a bit
  await new Promise(r => setTimeout(r, 500));
  
  // Check battle state
  const battleState = await page.evaluate(() => {
    if (!window.__battleTest) return { error: "no __battleTest" };
    const b = window.__battleTest;
    return {
      active: b.isActive?.(),
      state: b.state,
      phase: b.phase,
    };
  }).catch(() => ({ error: "evaluate failed" }));
  console.log("Battle state:", JSON.stringify(battleState, null, 2));
  
  // Wait for battle to start
  await new Promise(r => setTimeout(r, 3000));
  
  // Take screenshot after start
  await page.screenshot({ path: `${out}/02-after-start.png`, fullPage: false });
  
  if (battleState.active) {
    // Navigate through menus to tech selection
    console.log("Navigating to tech...");
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowDown");
      await new Promise(r => setTimeout(r, 100));
    }
    
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 500));
    
    // Check state after tech selection
    const techState = await page.evaluate(() => {
      if (!window.__battleTest) return { error: "no battle" };
      const b = window.__battleTest;
      return {
        active: b.isActive?.(),
        state: b.state,
        phase: b.phase,
      };
    }).catch(() => ({ error: "evaluate failed" }));
    console.log("Tech selection state:", JSON.stringify(techState, null, 2));
    
    await page.screenshot({ path: `${out}/04-tech-selected.png`, fullPage: false });
    
    // Select a tech
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
      await new Promise(r => setTimeout(r, 100));
    }
    
    await page.screenshot({ path: `${out}/05-tech-picked.png`, fullPage: false });
    
    await page.keyboard.press("Enter");
    
    // Wait for attack to execute
    await new Promise(r => setTimeout(r, 2000));
    
    // Report animation state
    const animState = await page.evaluate(() => {
      const b3d = window.__battle3d;
      if (!b3d) return { error: "no __battle3d" };
      const r = b3d;
      return {
        playerAnim: r.playerAnimator?._clip,
        enemyAnim: r.enemyAnimator?._clip,
        playerFrame: r.playerAnimator?.frame,
        enemyFrame: r.enemyAnimator?.frame,
        playerTable: r.playerAnimator?.timelineTable,
        enemyTable: r.enemyAnimator?.timelineTable,
        playerVM: !!r.playerAnimator?.vm,
        enemyVM: !!r.enemyAnimator?.vm,
        coordActive: !!r.coordinator?.active,
        coordState: r.coordinator?.state,
      };
    }).catch(() => ({ error: "evaluate failed" }));
    
    console.log("\n=== ANIMATION STATE DURING ATTACK ===");
    console.log(JSON.stringify(animState, null, 2));
    await page.screenshot({ path: `${out}/06-during-attack.png`, fullPage: false });
    
    // Wait for attack to finish
    await new Promise(r => setTimeout(r, 5000));
    
    // Final state
    const finalState = await page.evaluate(() => {
      const b3d = window.__battle3d;
      if (!b3d) return { error: "no __battle3d" };
      const r = b3d;
      return {
        playerAnim: r.playerAnimator?._clip,
        enemyAnim: r.enemyAnimator?._clip,
        playerFrame: r.playerAnimator?.frame,
        enemyFrame: r.enemyAnimator?.frame,
        playerTable: r.playerAnimator?.timelineTable,
        enemyTable: r.enemyAnimator?.timelineTable,
        playerVM: !!r.playerAnimator?.vm,
        enemyVM: !!r.enemyAnimator?.vm,
        coordActive: !!r.coordinator?.active,
        coordState: r.coordinator?.state,
      };
    }).catch(() => ({ error: "evaluate failed" }));

    console.log("\n=== FINAL ANIMATION STATE ===");
    console.log(JSON.stringify(finalState, null, 2));
    
    // Check for the bug
    if (finalState.enemyAnim !== 2 && finalState.enemyAnim !== 3 && finalState.enemyAnim !== 0) {
      console.log(`\n** BUG CONFIRMED: Enemy is on clip ${finalState.enemyAnim}, expected 2 (survive) or 3 (death)`);
    } else {
      console.log("\n** Enemy on correct clip:", finalState.enemyAnim);
    }
    
    await page.screenshot({ path: `${out}/07-final-state.png`, fullPage: false });
  } else {
    console.log("Battle was not active");
    await page.screenshot({ path: `${out}/08-not-active.png`, fullPage: false });
  }
  
  await browser.close();
  server.close();
  
  console.log("\nScreenshots in", out);
});
