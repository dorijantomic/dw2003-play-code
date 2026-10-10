// tools/verify_cardduel_setend.mjs — the SET-END beat, driven to a real set
// boundary in the running walker.
//
// A set does not just tick over. Battle-Phase state 0xB plays CARDSGNL, raises
// a mid-grey overlay with a life of ten and runs the winner's set counter for
// fifty-one ticks; states 0xC..0x10 then hold a result window open and wait for
// a button (cardbattle-set-counter-roll-is-51-ticks-with-a-grey-flash-2026-08-21).
// Ahead of it, the played row drains to the discard one card at a time
// (divergence item 7).
//
// This drives the duel by pressing confirm until the beat opens, then shoots
// the drain, the flash, the roll after the flash, and the result window, and
// checks the chain of windows the set award puts up — state 0xD's set line,
// state 0xE's "Current score", and the duel-over test's own two when the duel
// is decided — and that each one waits for a button that EITHER Circle or Cross
// takes, which is what F0x800A0F94's five pad gates read.
//
// `?legacyDuel=1` because this drives the HAND-AUTHORED screen (web/cardduel.js);
// the native pro/cardgame screen is the production route and the lab defaults to
// it, as tools/verify_cardduel.mjs records.
//
// Needs the lab served:  python3 -m http.server 8742 --directory web
// Run through the wrapper: tools/run-playwright.sh tools/verify_cardduel_setend.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardduel-setend";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("cardduel");
  w.__labDuel.open(null, "Opponent", null, 13);
});
await p.waitForTimeout(1500);

const state = () => p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  return {
    opening: d.openingScreen(),
    phase: d.phaseKey?.() ?? null,
    setEnd: d.setEndState(),
    score: d.duel ? [d.duel.player.score, d.duel.opponent.score] : null,
  };
});

async function press(key = "Enter", settle = 250) {
  await p.evaluate(() => document.getElementById("game").contentWindow.focus());
  await p.keyboard.press(key);
  await p.waitForTimeout(settle);
}

async function shot(name) {
  const url = await p.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    const c = w.document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    w.__labDuel.draw(g, 320, 240);
    return c.toDataURL("image/png");
  });
  writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  console.log("shot", name, JSON.stringify(await state()));
}

// Confirm through the challenge screen and the folder chooser, then mash
// confirm until a set is awarded. A whole set is six phases and the Load and
// Compile phases are played a turn at a time, so this takes a while.
//
// The Summon Phase commits on SQUARE (the disc's legend is
// "[cross] Select [square] Summon", and F0x800878B4 sets picker state 6 on
// Square); a plain Enter never places a Digimon, so the phase would stall with
// an empty field and no set could ever be awarded.
const summonParked = () => p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  const t = d.duel?.summonTurns;
  return { parked: !!(t && !t.done), confirm: !!d.summonConfirm,
           mine: !!(t && !t.done && t.order[t.turn] === d.duel.player) };
});

/** One press of whatever the duel is asking for. */
async function driveOnce(settle = 120) {
  const sp = await summonParked();
  if (sp.parked) {
    // Square raises the "Put in Field?" prompt on your own turn; Circle
    // answers Yes there and only there (F0x80087EDC state 7: Circle finishes,
    // Cross is No). The other side's turn just takes a confirm.
    await p.evaluate(() => document.getElementById("game").contentWindow.focus());
    await p.keyboard.press(sp.confirm || !sp.mine ? "Enter" : "v");
  } else {
    await press("Enter", settle);
    return;
  }
  await p.waitForTimeout(settle);
}

let seen = null;
for (let i = 0; i < 400 && !seen; i++) {
  await driveOnce();
  const s = await state();
  if (s.setEnd) seen = s;
}
if (!seen) { console.log("FAILED: no set was awarded in 400 presses"); await b.close(); process.exit(1); }
console.log("beat opened:", JSON.stringify(seen));

// The drain may already have finished by the time we look; shoot whatever step
// is up, then follow it through the roll and into the result window.
await shot("10-opened");
await p.waitForTimeout(120);
await shot("11-flash");     // the grey overlay lives ten ticks from roll t = 0
await p.waitForTimeout(700);
await shot("12-roll");      // the roll is still running, no window yet
await p.waitForTimeout(1500);
const atResult = await state();
await shot("13-result");

if (atResult.setEnd?.step !== "result") {
  console.log("FAILED: the beat did not reach its result window:", JSON.stringify(atResult));
  await b.close(); process.exit(1);
}
console.log("counters at the result window:", JSON.stringify(atResult.score));

// The window waits for a button, and the press does NOT hand the duel back:
// F0x800A0F94's chain is a window per state, so state 0xD takes the SET line
// down and state 0xE puts up "Current score", and only then does the duel-over
// test run (states 0x10 and 0x11). Every pad gate in the machine reads logical
// 0x0D and then 0x0E, so the walk below alternates the two keys — a gate that
// only took one of them would stop the chain here.
const chain = [];
for (let i = 0; i < 8; i++) {
  const s = await state();
  chain.push(s.setEnd?.step ?? null);
  if (!s.setEnd) break;
  await shot(`1${4 + i}-${s.setEnd.step}`);
  await press(i % 2 ? "x" : "Enter", 400);
}
const after = await state();
console.log("set-award chain:", JSON.stringify(chain));
console.log("after the windows:", JSON.stringify(after));
if (after.setEnd) { console.log("FAILED: the chain did not finish"); await b.close(); process.exit(1); }
if (chain[0] !== "result") {
  console.log("FAILED: the chain did not start at the set line:", JSON.stringify(chain));
  await b.close(); process.exit(1);
}
if (new Set(chain).size !== chain.length) {
  console.log("FAILED: a window repeated, so one state skipped another:", JSON.stringify(chain));
  await b.close(); process.exit(1);
}
await shot("14-dismissed");

// ---- and the duel's own end -------------------------------------------
// Two sets decide it. State 0x11 is the duel-over test: a win plays W_JINGLE
// and a loss plays nothing, and what follows is an opponent-specific message,
// NOT a score screen (cardgame-there-is-no-end-of-duel-score-screen-2026-08-24).
// Keep pressing until the rules engine writes an outcome, dismissing each
// further set-end window on the way. The second set re-enters the Summon Phase,
// so it too needs Square on the player's own summon turn.
let over = null;
for (let i = 0; i < 1600 && !over; i++) {
  // The same press rule as above. The second set re-enters the Summon Phase, so
  // a run that only ever pressed Square there stalled on the "Put in Field?"
  // prompt and never reached the duel-over test — which is what this loop is
  // for, so it now drives the phase the way the first loop does.
  await driveOnce(60);
  const s = await p.evaluate(() => {
    const d = document.getElementById("game").contentWindow.__labDuel;
    return {
      outcome: d.duel?.outcome ?? null,
      setEnd: d.setEndState(),
      score: d.duel ? [d.duel.player.score, d.duel.opponent.score] : null,
    };
  });
  if (s.outcome && !s.setEnd) over = s;
}
if (!over) { console.log("FAILED: the duel never ended in 1600 presses"); await b.close(); process.exit(1); }
console.log("duel over:", JSON.stringify(over));
await shot("20-duel-over");
console.log("OK");

await b.close();
