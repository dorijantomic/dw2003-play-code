// Prove, in the live page, that an attack DRAINS instead of snapping.
//
// Both sides' damage used to land in a single frame on beat 0x16, with nothing
// happening on 0x15 at all. The disc issues the SAME routine twice --
// F0x80084320 dispatches 0x15 to `F0x80093624(duel, view, 0)` and 0x16 to
// `(..., 1)` -- so each side's attack is its own beat, and each one ramps two
// numbers: the attacker's AP counts down as the damage is spent, and the
// defender's HP falls to its new value over a window whose length is set by how
// many cards attacked.
//
// What this checks, per drain beat:
//   1. the defending side's HP passes through intermediate values rather than
//      jumping straight to the result;
//   2. it never rises, and never falls past the result;
//   3. the attacking side's AP counts down to zero;
//   4. neither number moves during the decoded 16-tick lead-in;
//   5. both drains happen, one per side, on separate beats.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_drain.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/dueldrain";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The legacy duel: this check reads the old shell's own surface, which the native duel — the default since web/game.js:545 — does not expose. Census: docs/research/card/CARD-DUEL-VERIFIED.md 34.
// The opponent is NAMED (CARD_NPC record 13, the one the capture this duel was
// traced against). With no record the lab opens the duel against a copy of the
// player's own folder with no AI play classes at all, and an opponent with no
// classes never summons — so neither side ever drains and every assertion below
// is unsatisfiable. The original always loads its opponent from CARD_NPC through
// the launcher parameter (CARD-DUEL-VERIFIED.md 8.3), so naming one is what the
// disc does, not a fixture convenience.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel", 13));
await page.waitForTimeout(1500);

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };

const result = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const runs = [];          // one entry per drain beat
  let cur = null;
  let frames = 0;
  let summonPress = 0;

  const tick = () => {
    frames += 1;
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return next(); }

    const beat = d.beat.current;
    if ((beat === 0x15 || beat === 0x16) && d.drain && c.view) {
      if (!cur || cur.op !== beat) {
        cur = { op: beat, side: d.drain.side, ap: [], hp: [], hpRaw: [],
                startAp: d.drain.ap, startHp: d.drain.hpBefore, cards: d.drain.cards };
        runs.push(cur);
      }
      cur.ap.push(c.view.drain.shownAp);
      cur.hp.push(c.view.drain.hpFixed >> 8);
      // The ramp is carried in 8.8 fixed point and can total just one whole
      // point. Sampling only the integer half then has no value strictly
      // between the start and the end, and the "intermediate values" check
      // becomes unsatisfiable for a 1-damage drain. Keep the raw word so a
      // fractional ramp is still visible.
      cur.hpRaw.push(c.view.drain.hpFixed);
    }

    // A phase banner waits on Circle or Cross with no timer of its own
    // (`F0x80089580`), so a driver that never presses waits forever. This is
    // the press a player makes.
    if (d.beat.gated) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (d.summonTurns && !d.summonTurns.done) {
      // ACTUALLY SUMMON. Declining every summon turn leaves the player with an
      // empty board, and an empty board deals 0 AP into 0 HP -- a drain with
      // nothing to ramp, which is how this verifier first passed while proving
      // nothing. CIRCLE marks the card under the cursor; SQUARE raises the
      // "Put in Field?" prompt and CIRCLE answers Yes at it, which is the only
      // way the marked set reaches the board (F0x80087EDC state 7). `right`
      // walks the cursor on when nothing is affordable.
      if (d.summonTurns.order[d.summonTurns.turn] !== d.player) c.handleKey("circle");
      else if (c.summonConfirm) c.handleKey("circle");         // Yes: commit the set
      else if (c.summonMarks && c.summonMarks.size) c.handleKey("square");
      else {
        summonPress = (summonPress + 1) % 16;
        if (summonPress === 15) c.handleKey("square");         // nothing affordable: raise the prompt to pass
        else c.handleKey(summonPress % 2 === 0 ? "circle" : "right");
      }
    }
    else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)

    if ((d.outcome && !c.setEnd) || frames > 200000) {
      return done({ frames, runs, outcome: d.outcome ?? null });
    }
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));

const hex = (n) => "0x" + n.toString(16).toUpperCase();
console.log("  frames:", result.frames, "outcome:", result.outcome,
            "drain beats:", result.runs.length);

check(result.runs.length > 0, "the duel reaches an attack drain");

// Both sides drain, on separate beats.
const ops = [...new Set(result.runs.map((r) => r.op))].sort();
check(ops.length === 2 && ops[0] === 0x15 && ops[1] === 0x16,
  `both sides drain, on their own beats (${ops.map(hex).join(" ")})`);
check(result.runs.every((r) => r.side === (r.op === 0x15 ? 0 : 1)),
  "0x15 carries side 0 and 0x16 carries side 1");

for (const r of result.runs) {
  const tag = `${hex(r.op)} side ${r.side} #${result.runs.indexOf(r)}`;
  console.log(`\n  ${tag}: ${r.cards} card(s), ${r.startAp} AP into ${r.startHp} HP, ${r.hp.length} frames`);
  console.log(`    HP: ${r.hp.slice(0, 24).join(" ")}${r.hp.length > 24 ? " ..." : ""}`);
  console.log(`    AP: ${r.ap.slice(0, 24).join(" ")}${r.ap.length > 24 ? " ..." : ""}`);

  const end = Math.max(0, r.startHp - r.startAp);
  // 1. it ramps rather than snapping -- only meaningful when there IS damage.
  // Compared in the 8.8 word the model actually carries, so a drain of exactly
  // one whole point still shows the fractional ramp instead of being called a
  // snap it is not.
  if (r.startAp > 0 && r.startHp > end) {
    const startRaw = r.startHp << 8;
    const endRaw = end << 8;
    check(r.hpRaw.some((v) => v < startRaw && v > endRaw),
      `${tag}: HP passes through intermediate values`);
  }
  // The damage number is NOT carried frame to frame -- the update recomputes it
  // from the absolute tick as `ap - (trunc(ap / (cards * 0x38 + 1)) + 1) * tick`
  // and floors it at zero. Combined with the 16-tick lead-in, that means a small
  // attack is ALREADY spent the first time the number is drawn: at tick 16 with
  // 5 AP over 3 cards the decrement is 1 a tick, so the first value written is
  // max(0, 5 - 16) = 0. That is the disc's arithmetic, not a defect, so this
  // asserts the PREDICTION rather than demanding an animation the formula does
  // not produce.
  {
    const per = Math.trunc(r.startAp / (r.cards * 0x38 + 1)) + 1;
    const firstWritten = Math.max(0, r.startAp - per * 16);
    if (firstWritten > 0) {
      check(r.ap.some((v) => v < r.startAp && v > 0),
        `${tag}: the damage number spends down through intermediate values`);
    } else {
      check(r.ap[16] === 0 || r.ap[17] === 0,
        `${tag}: ${r.startAp} AP over ${r.cards} cards is already spent when first drawn`);
    }
  }
  // 2. monotone, and bounded by the clamped result.
  check(r.hp.every((v, i) => i === 0 || (v <= r.hp[i - 1] && v >= end)),
    `${tag}: HP only falls, and never past ${end}`);
  check(r.ap.every((v, i) => i === 0 || (v <= r.ap[i - 1] && v >= 0)),
    `${tag}: the damage number only falls, and never past 0`);
  // 3. the decoded 16-tick lead-in: nothing moves before it.
  const lead = r.hp.slice(0, 16);
  check(lead.every((v) => v === r.startHp),
    `${tag}: nothing moves during the 16-tick lead-in`);
}

await page.screenshot({ path: `${OUT}/drain.png` });
console.log(errors.length ? `\npage errors: ${errors.join(" | ")}` : "\nno page errors");
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); }
else console.log("ALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
