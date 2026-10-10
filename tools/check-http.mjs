/**
 * Check if battle3d.js can be fetched from HTTP.
 */

import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "web");
const server = http.createServer((req, res) => {
  let filePath = path.join(root, req.url);
  if (filePath.endsWith("/")) filePath += "index.html";
  const content = fs.readFileSync(filePath);
  res.writeHead(200);
  res.end(content);
});

server.listen(3458, async () => {
  console.log("Server running on http://localhost:3458");
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('pageerror', err => {
    console.log(`[PAGE ERROR] ${err.message}`);
    console.log(`[STACK] ${err.stack || err}`);
  });
  page.on('console', msg => {
    console.log(`[CONSOLE] ${msg.type()} ${msg.args().map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
  });

  page.on('response', response => {
    console.log(`[RESP] ${response.status()} ${response.url()}`);
  });

  await page.goto(`http://localhost:3458/battle-test.html`);
  await new Promise(r => setTimeout(r, 2000));
  
  // Try to fetch battle3d.js directly
  const fetchResult = await page.evaluate(async () => {
    try {
      const response = await fetch('./battle3d.js');
      const text = await response.text();
      return {
        status: response.status,
        hasCreateBattle3D: text.includes('createBattle3D'),
        length: text.length,
      };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log("Fetch battle3d.js:", JSON.stringify(fetchResult));
  
  // Try to fetch model_map.json
  const modelMap = await page.evaluate(async () => {
    try {
      const response = await fetch('./assets/battle/model_map.json');
      const text = await response.text();
      const json = JSON.parse(text);
      return {
        status: response.status,
        hasRenamon: !!json['Renamon'],
        hasAgumon: !!json['Agumon'],
        entries: Object.keys(json).join(', '),
      };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log("Fetch model_map.json:", JSON.stringify(modelMap));
  
  // Get the log content
  const logContent = await page.$eval("#log", el => el.innerHTML || el.textContent).catch(() => 'NO LOG');
  console.log("Log content:", logContent?.substring(0, 500));
  
  // Check for any error elements
  const hasError = await page.evaluate(() => {
    const err = document.querySelector('script[error]');
    if (err) return { found: true, text: err.textContent };
    return { found: false };
  });
  console.log("Error element:", JSON.stringify(hasError));
  
  await browser.close();
  server.close();
});
