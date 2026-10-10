/**
 * Drive battle-test.html through a tech attack and capture
 * what pose each digimon has during and after.
 *
 * Usage: tools/run-playwright.sh tools/tech-pose-verify.mjs
 */

import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const out = process.env.OUT_DIR ?? "/tmp/tech-pose";
fs.mkdirSync(out, { recursive: true });

// Simple HTTP server
const PORT = 3456;
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
  
  // Capture console logs and errors
  page.on('console', msg => {
    const args = msg.args();
    const text = args.map(a => {
      if (typeof a === 'object') {
        try { return JSON.stringify(a); }
        catch { return String(a); }
      }
      return String(a);
    }).join(' ');
    console.log(`[PAGE CONSOLE] ${text}`);
  });
  page.on('pageerror', err => {
    console.log(`[PAGE ERROR] ${err.message}`);
    console.log(`[PAGE STACK] ${err.stack || err}`);
  });
  
  // Also capture unhandled rejections
  page.on('console', msg => {
    const args = msg.args();
    const type = msg.type();
    const text = args.map(a => {
      if (typeof a === 'object') {
        try { return JSON.stringify(a); }
        catch { return String(a); }
      }
      return String(a);
    }).join(' ');
    if (type === 'error') {
      console.log(`[PAGE CONSOLE ERROR] ${text}`);
    } else if (type === 'warning') {
      console.log(`[PAGE CONSOLE WARNING] ${text}`);
    }
  });
  
  // Listen for network requests to see what's being loaded
  page.on('response', response => {
    const url = response.url();
    const status = response.status();
    if (!url.includes('localhost:3456') && status !== 304) {
      console.log(`[NETWORK] ${status} ${url}`);
    }
    if (status >= 400) {
      console.log(`[NETWORK ERROR] ${status} ${url}`);
    }
  });

  await page.goto(`http://localhost:${PORT}/battle-test.html`);
  
  // Wait for page to load
  await new Promise(r => setTimeout(r, 3000));
  
  // Screenshot right after page loads
  await page.screenshot({ path: `${out}/00-page-loaded.png`, fullPage: false });
  
  // Get the log content to see what errors occurred
  const logContent = await page.$eval("#log", el => el.textContent);
  console.log("Log content:", logContent);
  
  // Check if there's an error on the page
  const pageErrors = await page.evaluate(() => {
    const errors = [];
    // Check for any error elements
    const errEl = document.querySelector('script[error]');
    if (errEl) errors.push(errEl.textContent);
    return errors;
  });
  
  // Check if WebGL is available
  const webgl = await page.evaluate(() => {
    try {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'no canvas' };
      const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return { hasWebgl: !!ctx };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log("WebGL:", JSON.stringify(webgl));
  
  // Wait for model selectors
  await page.waitForSelector("#playerSel", { timeout: 15000 });
  
  // Screenshot after selectors load
  await page.screenshot({ path: `${out}/01-selectors-loaded.png`, fullPage: false });
  
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
    await page.screenshot({ path: `${out}/02-start-btn-missing.png` });
    await browser.close();
    server.close();
    return;
  }
  
  await startBtn.click();
  
  // Wait for battle to start
  await new Promise(r => setTimeout(r, 3000));
  
  // Screenshot after clicking start
  await page.screenshot({ path: `${out}/03-after-start.png` });
  
  // Check if battle is active
  let battleActive = await page.evaluate(() => !!window?.battle?.isActive()).catch(() => false);
  console.log("Battle active:", battleActive);
  
  // Check renderer3d
  const renderer3d = await page.evaluate(() => {
    const b3d = window.__battle3d || window.__battle3d;
    if (!b3d) return { error: "no __battle3d" };
    return {
      playerModel: b3d.playerModel ? "loaded" : "missing",
      enemyModel: b3d.enemyModel ? "loaded" : "missing",
    };
  }).catch(() => ({ error: "evaluate failed" }));
  console.log("Renderer3D:", JSON.stringify(renderer3d));
  
  if (battleActive) {
    // Navigate through menus to tech selection
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowDown");
      await new Promise(r => setTimeout(r, 100));
    }
    
    await page.screenshot({ path: `${out}/04-attack-select.png` });
    
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 500));
    
    // Select a tech
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
      await new Promise(r => setTimeout(r, 100));
    }
    
    await page.screenshot({ path: `${out}/05-tech-select.png` });
    
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 2000));
    
    // Capture during attack
    await page.screenshot({ path: `${out}/06-during-attack.png` });
    
    // Report animation state
    const state = await page.evaluate(() => {
      const r = window.__battle3d;
      if (!r || !r.coordinator) return { error: "no battle3d or coordinator" };
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
      };
    }).catch(() => ({ error: "evaluate failed" }));
    
    console.log("Animation state:", JSON.stringify(state, null, 2));
    await page.screenshot({ path: `${out}/07-state-report.png` });
    
    // Wait for attack to finish
    await new Promise(r => setTimeout(r, 5000));
    
    // Final state
    const finalState = await page.evaluate(() => {
      const r = window.__battle3d;
      if (!r || !r.coordinator) return { error: "no battle3d" };
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
      };
    }).catch(() => ({ error: "evaluate failed" }));

    console.log("Final animation state:", JSON.stringify(finalState, null, 2));
    await page.screenshot({ path: `${out}/08-final.png` });
  } else {
    console.log("Battle was not active");
    await page.screenshot({ path: `${out}/09-no-battle.png` });
  }

  await browser.close();
  server.close();
  
  console.log("\nScreenshots in", out);
});
