/**
 * Check if battle-test.html loads and if battle3d.js can be imported.
 *
 * Usage: tools/run-playwright.sh tools/check-page-load.mjs
 */

import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const out = process.env.OUT_DIR ?? "/tmp/tech-pose";

// Simple HTTP server
const PORT = 3457;
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
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  
  page.on('console', msg => {
    const args = msg.args();
    const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.log(`[CONSOLE ${msg.type()}] ${text}`);
  });
  
  page.on('pageerror', err => {
    console.log(`[PAGE ERROR] ${err.message}`);
    console.log(`[STACK] ${err.stack || err}`);
  });
  
  await page.goto(`http://localhost:${PORT}/battle-test.html`);
  await new Promise(r => setTimeout(r, 3000));
  
  // Check HTML content
  const html = await page.content();
  console.log("\n=== HTML content (first 2000 chars) ===");
  console.log(html.substring(0, 2000));
  
  // Check if script modules loaded
  const scripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script')).map(s => ({
      src: s.src,
      type: s.type,
      text: s.textContent?.substring(0, 50),
    }));
  });
  console.log("\n=== Scripts ===");
  console.log(JSON.stringify(scripts, null, 2));
  
  // Try to import battle3d module directly
  const hasBattle3D = await page.evaluate(async () => {
    try {
      // Try importing the module
      const mod = await import('./battle3d.js');
      return {
        hasModule: true,
        exports: Object.keys(mod).join(", "),
        hasCreateBattle3D: typeof mod.createBattle3D === 'function',
      };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log("\n=== battle3d.js import ===");
  console.log(JSON.stringify(hasBattle3D, null, 2));
  
  // Try to import battle module
  const hasBattle = await page.evaluate(async () => {
    try {
      const mod = await import('./battle.js');
      return {
        hasModule: true,
        exports: Object.keys(mod).join(", "),
        hasCreateBattle: typeof mod.createBattle === 'function',
      };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log("\n=== battle.js import ===");
  console.log(JSON.stringify(hasBattle, null, 2));
  
  await browser.close();
  server.close();
});
