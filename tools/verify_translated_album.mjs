// Bounded ordinary-route check for the translated Card Album task tree.
// Run with tools/run-playwright.sh tools/verify_translated_album.mjs [output-dir].
// It aborts every assets/native/** request, refuses any execution mark other
// than "translated", and drives open -> page turn -> cursor move -> back ->
// close over the real browser route.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const output = process.argv[2] ?? "/tmp/translated-album";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failures = [];
const blocked = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
await page.route("**/assets/native/**", (route) => { blocked.push(route.request().url()); return route.abort(); });

const press = async (key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
  await page.waitForTimeout(220);
};
const diag = () => page.evaluate(() => window.__cardAlbum?.diagnostics?.() ?? null);
const readWord = (offset) => page.evaluate((o) => {
  const session = window.__cardAlbum?._session;
  return session ? session.mem.read32(session.root + o) | 0 : null;
}, offset);

try {
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__cardAlbum);
  await page.evaluate(() => window.__labOpen("cardalbum"));
  await page.waitForFunction(() => {
    const d = window.__cardAlbum?.diagnostics?.();
    return d && (d.session || d.error);
  }, null, { timeout: 10000 });
  const opened = await diag();
  if (!opened) throw new Error("the album reported no diagnostics");
  if (opened.execution !== "translated") throw new Error(`unexpected execution mark ${opened.execution}`);
  if (opened.error) throw new Error(`the album failed to open: ${opened.error}`);
  await page.waitForFunction(() => (window.__cardAlbum?._session?.mem.read32(window.__cardAlbum._session.root + 0x10) | 0) === 4,
    null, { timeout: 10000 });
  await page.locator("#game").screenshot({ path: `${output}/01-open.png` });

  // R1 (key "e") turns the page forward; L1 (key "q") back.
  const pageBefore = await readWord(0x60);
  await press("e");
  await page.waitForTimeout(400);
  const pageAfter = await readWord(0x60);
  if (pageAfter !== pageBefore + 1) failures.push(`R1 did not turn the page: ${pageBefore} -> ${pageAfter}`);
  await page.locator("#game").screenshot({ path: `${output}/02-page-turn.png` });
  await press("q");
  await page.waitForTimeout(400);
  const pageBack = await readWord(0x60);
  if (pageBack !== pageBefore) failures.push(`L1 did not turn back: ${pageAfter} -> ${pageBack}`);

  // The d-pad moves the cursor within the page when a collected card is
  // adjacent; with no collected neighbour the cursor stays (the original snaps
  // to the nearest collected cell). Either way it must stay in range and the
  // album must stay on its cursor state.
  const cellBefore = await readWord(0x74);
  await press("ArrowRight");
  await press("ArrowRight");
  const cellAfter = await readWord(0x74);
  if (!(cellAfter >= 0 && cellAfter <= 11)) failures.push(`the cursor left the page: ${cellAfter}`);
  if ((await readWord(0x10)) !== 4) failures.push("the album left its cursor state after a d-pad press");
  await page.locator("#game").screenshot({ path: `${output}/03-cursor.png` });
  if (cellAfter === cellBefore) {
    // Not a failure: the next cells are empty. Recorded so the run is honest.
    console.log(`note: cursor stayed at ${cellBefore} (no collected neighbour)`);
  }

  // Back (key "Escape") opens the closing popup and leaves the screen.
  await press("Escape");
  await page.waitForFunction(() => window.__cardAlbum?.isOpen?.() === false, null, { timeout: 10000 });
  await page.locator("#game").screenshot({ path: `${output}/04-closed.png` });
  if (blocked.length) failures.push(`the album requested executable assets: ${blocked.join(", ")}`);
} catch (error) {
  failures.push(error.stack ?? String(error));
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`translated album check FAILED:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("translated album check passed: open, page turn, cursor, back, no executable asset requests");
