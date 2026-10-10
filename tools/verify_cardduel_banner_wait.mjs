// Prove, in the live page, that a phase banner waits for the player.
//
// The seven banners the duel raises — the six phase announcements and the
// challenge screen — are ONE routine on the disc. Its enter phase reads a
// two-byte record (a title id and a subtitle id) and its update, `F0x80089580`
// (`cardgame.s:6715-6799`), is a four-step machine on the step byte: step 1
// waits for the info banner and the prompt window to finish opening, step 2
// polls pad port 0 for logical 0xD (Circle) or 0xE (Cross) and advances on
// either, step 3 closes both windows, step 4 waits for them to go. The beat
// timer is never touched anywhere in it: a player who never presses never
// leaves the banner.
//
//   ledger cardduel-phase-banners-are-one-routine-and-wait-for-a-button-2026-08-27
//   docs/research/card/cardduel-animation-atlas-2026-08-26.md
//
// The six numbers `BEAT_FRAMES` carries for 0xA0..0xA5 — 25, 49, 151, 71, 101,
// 63 — are therefore how long one player took to press in the 2026-08-26
// capture, not durations the game chooses. The spread over six identical
// banners is the evidence.
//
// What this checks:
//   1. the Start banner is still up, and the duel has not moved on, after 300
//      frames with no press at all;
//   2. Cross dismisses it, and the duel goes on;
//   3. Circle dismisses the next one too — the update takes either;
//   4. a key that is neither does nothing.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_banner_wait.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelbanner";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The legacy duel: this check reads the old shell's own surface (labDuel.handleKey), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };
const key = async (k, wait = 300) => {
  await frame.evaluate((kk) => window.__labDuel.handleKey(kk), k);
  await page.waitForTimeout(wait);
};
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const snap = () => frame.evaluate(() => {
  const c = window.__labDuel, d = c.duel;
  return {
    hasDuel: !!d,
    phase: d ? c.phaseKey() : null,
    beat: d ? { current: d.beat.current, hold: d.beat.hold, gated: d.beat.gated,
                pending: d.beat.pending.slice() } : null,
    // the ceremony beats the duel has issued so far, so a stall is visible as a
    // stream that stopped growing
    issued: d ? d.ceremony.length : 0,
    coin: !!c.coin,
  };
});

// Past the challenge screen and the folder chooser, which both run before there
// is a duel at all. Neither is a banner beat.
for (let i = 0; i < 6 && !(await snap()).hasDuel; i++) await key("enter", 400);

// ---- 1. it waits, with no press, for as long as it is left -----------------
let st = await snap();
check(st.beat?.current === 0xa0 && st.beat.gated,
  `the Start banner is up and waiting (beat 0x${(st.beat?.current ?? 0).toString(16)})`);
await shot("01-start-banner-waiting");
const before = await snap();
await page.waitForTimeout(5000);          // ~300 frames at 60Hz, no press
const after = await snap();
check(after.beat?.current === 0xa0 && after.beat.gated,
  "after five seconds with no press it is still the same banner, still waiting");
check(after.issued === before.issued,
  `and the duel issued nothing further while it waited (${before.issued} -> ${after.issued})`);
await shot("02-still-waiting-five-seconds-later");

// ---- 4. a key that is neither Circle nor Cross does nothing ---------------
await key("ArrowRight");
await key("square");
const nudged = await snap();
check(nudged.beat?.current === 0xa0 && nudged.beat.gated,
  "a press that is neither Circle nor Cross leaves it up");

// ---- 2. Cross dismisses it ------------------------------------------------
await key("cross", 600);
const dismissed = await snap();
check(dismissed.beat?.current !== 0xa0 || !dismissed.beat.gated,
  "Cross dismisses the banner and the duel goes on");
await shot("03-dismissed-on-cross");

// ---- 3. Circle dismisses the next one -------------------------------------
// Let the duel run to its next banner. The Start Phase's Calumon draw comes
// first and takes a press of its own.
let reached = null;
for (let i = 0; i < 40; i++) {
  const s = await snap();
  if (s.beat?.gated && s.beat.current >= 0xa0 && s.beat.current <= 0xa6 && s.beat.current !== 0xa0) {
    reached = s; break;
  }
  if (s.coin) await key("circle", 200); else await page.waitForTimeout(200);
}
check(!!reached, `the duel reaches its next banner (0x${(reached?.beat.current ?? 0).toString(16)})`);
if (reached) {
  await shot("04-next-banner-waiting");
  // Step 1 of the machine waits for the two windows to finish opening, and a
  // press before that is not read. Give them the moment they take, exactly as
  // the banner that came before did.
  await page.waitForTimeout(500);
  await key("circle", 600);
  const gone = await snap();
  check(gone.beat?.current !== reached.beat.current || !gone.beat.gated,
    "Circle dismisses it too — the update takes either button");
  await shot("05-dismissed-on-circle");
}

check(errors.length === 0, `no page errors (${errors.join("; ")})`);
await browser.close();
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); process.exit(1); }
console.log("\nall checks passed");
console.log("captures in", OUT);
