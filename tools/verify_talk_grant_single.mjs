// tools/verify_talk_grant_single.mjs — a talk grant lands exactly ONCE, at the close.
//
// WHAT THIS PROVES, AND AGAINST WHAT:
//   The disc applies a dialogue-state on_close table once, on the tick the dialogue reads
//   closed: the talk handler (fieldstg F0x80090afc) stores the selected ptrB triple's ptr2
//   into entity+0xFC at talk start (file 0xdee8-0xdeeec, the branch delay slot) and its close
//   arm (file 0xdfa4-0xe010) runs that table through the applier F0x80016988 (walks
//   {u16 id,u16 value} pairs, calling setGameState) -> set_flag F0x800165ac -> collection
//   handler F0x800161d8 ("+1 copy", capped at 99). web/game.js's talk onClose is the port of
//   that arm. This drives s300's item box (npc 33 at 700,283, sprite p126itmb; its state's
//   on_close is [532=1, 33323=1, 0x7013] — item 43 PowerCharge, the box's own spawn bit, and
//   the acquisition flourish) end to end and asserts:
//
//     1. THE GRANT LANDS ONCE. The bag holds exactly one PowerCharge after the box is
//        collected. fail-before (master): the converter ALSO emitted s300.give.33.43, a once
//        OnTalk GiveItem row that fired at talk start, so the player held TWO.
//     2. THE FLOURISH FIRES AT THE CLOSE TICK, from the close arm — not at talk start from a
//        converted row. fail-before: 0x7013 was armed by the give row the moment the talk
//        started (and the close arm dropped it).
//     3. THE BOX'S OWN ON_CLOSE EFFECTS STILL LAND (spawn bit 532 = 1) and the box leaves the
//        field the tick its line closes — the pre-existing box behaviour, kept.
//
// Run: tools/run-playwright.sh tools/verify_talk_grant_single.mjs [outdir]
//      (VERIFY_PORT picks the port; the script serves web/ itself.)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.VERIFY_PORT) || 8797;
const ORIGIN = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] ?? "/tmp/talk-grant-single");
mkdirSync(OUT, { recursive: true });

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", "web"],
  { cwd: ROOT_DIR, stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", stopServer);
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`${ORIGIN}/index.html`, { method: "HEAD" }); if (r.ok || r.status === 404) break; } catch { /* not up */ }
  await new Promise((r) => setTimeout(r, 150));
}

const fails = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const tbOpen = () => page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
const qty = (id) => page.evaluate((i) => (window.__state.inventory ?? []).find((it) => Number(it.id) === i)?.qty ?? 0, id);
const flag = (id) => page.evaluate((i) => window.__storyFlags.get(i), id);
const boxes = async () => (await page.evaluate(() => window.__npcsHere() || [])).filter((n) => n.sprite === "p126itmb");
const sparkle = () => page.evaluate(() => {
  const sa = window.__state.sparkleActor;
  return sa ? { program: sa.program } : null;
});

try {
  await page.goto(`${ORIGIN}/?skipTitle=1&map=s300&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 25000 });
  await page.waitForTimeout(900);
  for (let i = 0; i < 30; i++) {           // clear anything the map-enter event put up
    if (!(await tbOpen())) break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }

  check("s300 spawns its item box (npc 33)", (await boxes()).some((b) => b.npc_id === 33));
  check("no PowerCharge in the bag before the talk", (await qty(43)) === 0, `qty=${await qty(43)}`);

  // Stand under the box (700,283), face up, press.
  await page.evaluate(() => { window.__tp(700, 283 + 24); window.__state.dir = "up"; });
  await page.waitForTimeout(250);
  const target = await page.evaluate(() => window.__talkTarget());
  check("the press addresses the box", target?.npc === 33 && target?.sprite === "p126itmb",
    JSON.stringify(target));

  await page.keyboard.press("Enter");
  let opened = false;
  for (let i = 0; i < 20; i++) {
    if (await tbOpen()) { opened = true; break; }
    await page.waitForTimeout(100);
  }
  check("the box's line opens", opened);

  // While the line is up: the flourish must NOT have fired yet (the disc fires it on close).
  const sparkleWhileOpen = await sparkle();
  check("the flourish is not armed while the line is up", sparkleWhileOpen === null,
    JSON.stringify(sparkleWhileOpen));
  // Wipe any flare so the next read can only come from the close tick.
  await page.evaluate(() => { window.__state.sparkleActor = null; });

  // Close the box and read the state on the tick it closes.
  let closed = false, sparkleAtClose = null;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(140);
    if (!(await tbOpen())) { closed = true; sparkleAtClose = await sparkle(); break; }
  }
  check("the box's line closes", closed);
  await page.waitForTimeout(300);

  const after = await qty(43);
  check("the grant lands exactly once (one PowerCharge in the bag)", after === 1, `qty=${after}`);
  check("the close arm armed the flourish at the close tick",
    sparkleAtClose?.program === 3, JSON.stringify(sparkleAtClose));
  check("the box's own spawn bit 532 was written", (await flag(532)) === 1, `532=${await flag(532)}`);
  check("the collected box left the live cast", (await boxes()).length === 0);

  await page.screenshot({ path: `${OUT}/s300-box-collected.png` });
  if (errors.length) check("no page errors", false, `${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: fails.length === 0, fails }));
} catch (e) {
  check("script completed", false, e.message);
} finally {
  await browser.close();
}
process.exit(fails.length ? 1 : 0);
