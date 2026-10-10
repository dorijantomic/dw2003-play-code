// Player action: a real story grant of an item already at 99 stays at 99.
//
// The original's bag count is a single byte clamped to [0,99] at F0x800161d8,
// reached from the give/take dispatcher F0x800165ac (claim
// items-stack-quantity-cap-99-floor-0-2026-08-04), with no "inventory full"
// message. The walker enforced the cap in the shop's buy path but not in the
// story/flag grant path, so a GiveItem at 99 could exceed it.
//
// The real consumer here is s420's own closing scene, event 71. The original's
// ONLY start site for that event is the stage-entry dispatcher: wstag420.s:32-33
// is the overlay's one `jal 0x800853f8` (`li $a0, 0x47` = 71 in the delay slot,
// which executes), reached from pro/wstag420.s:38-40 (`lw $v1, 0x8004B370`;
// `li $v0, 0x4`; `bne $v1, $v0, skip`) only when the story ordinal reads 4, and
// from :44/:58 `li $a0, 0x4012` + `li $a1, 0x1` + `jalr get_flag` only when the
// PRE's completion flag is set. So the scene the player meets is: walk into
// MetalGreymon's arena after beating him, and the closing scene plays by itself.
//
// Its completion routine (the routine event 71's table entry points at,
// wstag420.s:86-104) is the two collection writes — `li $a0, 0x8028` at :88 with
// the set_flag call at :94 (SilverID, item 40) and `li $a0, 0x8009` at :97 with
// the call at :99 (SeiryuBadge, item 9) — then `li $v0, 0x5` /
// `sw $v0, -0x4c90($v1)` at :184-188, the ordinal moving 4 -> 5. Both flags sit
// in the collection banks, so the single set_flag dispatcher hands both items to
// the bag through the same clamped add. That is the production path and the
// whole check: no battle is driven, because 0x4012 (16402) and the battle's own
// won flag (4627) are seeded to put the player where the original puts them,
// after the fight.
//
// The qty is asserted at 1, not 2: the completion writes each collection flag
// exactly once, and the item lands once.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_item_stack_cap.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.CAP_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.CAP_SHOT || "/tmp/item-stack-cap";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

// The stage-entry dispatcher gates the closing scene on the story ordinal
// reading 4 (wstag420.s:38-40), and the scene's own completion is what moves it
// to 5 (:184-188). Booting at 5 is the state AFTER the scene, where the original
// would never start it again.
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("progressOrdinal", "4");
  // SeiryuBadge (id 9) already at the 99 cap; SilverID (40) not held.
  localStorage.setItem("inventory", JSON.stringify([{ id: 9, qty: 99 }]));
});

let failed = null;
const fail = (msg) => { failed = msg; console.error("FAIL:", msg); };
const shot = async (name) => writeFileSync(
  `${OUT}/${name}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);
const bag = () => page.evaluate(() => window.__state.inventory.map((s) => [s.id, s.qty ?? 1]));
const qty = (rows, id) => {
  if (!Array.isArray(rows)) return 0;
  for (const r of rows) {
    if (Array.isArray(r)) { if (r[0] === id) return r[1] ?? 0; }
    else if (r && r.id === id) return r.qty ?? 1;
  }
  return 0;
};
const flags = (ids) => page.evaluate((list) =>
  list.map((id) => window.__engine.state.flags.get(id, 1)), ids);

try {
  const boot = `${BASE}?skipTitle=1&map=s420&noEncounters=1`;
  await page.goto(boot);
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 20_000 });
  await page.waitForTimeout(600);

  const before = await bag();
  if (qty(before, 9) !== 99)
    await fail(`prerequisite bag is ${JSON.stringify(before)}, expected SeiryuBadge 99`);
  // Booting into the arena is not enough: on the first entry 0x4012 is clear, so
  // the dispatcher takes the skip branch at wstag420.s:40 and starts nothing.
  const atBoot = await flags([16402, 4627]);
  if (atBoot.some(Boolean)) await fail(`0x4012 and the won flag must start clear, got ${JSON.stringify(atBoot)}`);
  await shot("stack-cap-before");

  // The player reaches this state by beating the fight the PRE's completion arms
  // (wstag420.s:70-:74 writes 0x7401, the bank-0x74 launcher, from the same
  // routine that sets 0x4012). Seed the two flags the closing scene reads, then
  // re-enter the map, which is the original's own route to it.
  await page.evaluate(() => {
    window.__engine.state.flags.set(16402, true);   // 0x4012, set by the PRE's completion
    window.__engine.state.flags.set(4627, true);    // the fight's won flag
  });
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 20_000 });

  // The closing scene plays on its own; advance its lines with confirm.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 30_000;
  let probe = null;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      bag: window.__state.inventory.map((s) => [s.id, s.qty ?? 1]),
      tb: window.__textbox?.isOpen?.() ?? false,
      cut: window.__cutscene?.isActive?.() ?? false,
      busy: window.__engineBridge?.isBusy?.() ?? null,
      ord: Number(localStorage.getItem("progressOrdinal")),
    }));
    probe = st;
    if (st.bag.some(([id, q]) => id === 40 && q >= 1)) break;
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await page.waitForTimeout(300);
  const after = await bag();
  const lsBag = JSON.parse(await page.evaluate(() => localStorage.getItem("inventory") ?? "[]"));
  await shot("stack-cap-after");

  if (qty(after, 9) !== 99)
    await fail(`SeiryuBadge went to ${qty(after, 9)}, expected it clamped at 99`);
  if (qty(after, 40) < 1)
    await fail(`SilverID was not granted (bag ${JSON.stringify(after)})`);
  if (qty(after, 40) !== 1)
    await fail(`SilverID is ${qty(after, 40)}, expected one grant (wstag420.s:94 writes 0x8028 once)`);
  if (qty(after, 9) > 99) await fail("the stack exceeded the 99 cap");
  if (qty(lsBag, 9) !== 99)
    await fail(`persisted bag ${JSON.stringify(lsBag)} did not keep the 99 cap`);
  // The scene's own last write (wstag420.s:184-188): the story step moves 4 -> 5.
  if (probe?.ord !== 5)
    await fail(`the story step is ${probe?.ord}, expected the closing scene's own 4 -> 5`);
  if (errors.length) await fail(`${errors.length} page error(s)`);

  console.log("RESULT", JSON.stringify({ ok: !failed, before, after, lsBag, ordinal: probe?.ord }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);