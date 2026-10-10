// tools/diff_cardduel_sprites.mjs — compare the WALKER's card sprites against
// the DISC's, field by field, frame by frame.
//
// WHY THIS REPLACES THE PIXEL DIFF. tools/diff_cardduel_vs_disc.mjs compares
// whole rendered frames against ten hand-picked screenshots. On 2026-08-26 that
// tool reported 25.9% of the challenge screen differing; aligning the backdrop
// tile independently showed 0.0% of its pixels differ — the entire reported
// difference was the scroll counter sitting at a different phase. A pixel diff
// of a screen with a free-running scrolling background cannot separate "the art
// is wrong" from "the counter is at 14 instead of 0", and on the board it
// reports one bounding box for cards that are merely at a different point in
// their tweens. It names a rectangle; it can never name the field.
//
// The rig traces log every pooled card sprite that changed, every frame:
//     <frame> sprite <slot> x,y,dx,dy,sx,sy,state,kind,clip,anim,timer,dur
// which is the field set of CardSprite in engine/systems/card-animation.ts, in
// the same 8.8 fixed point. So the two sides are compared as NUMBERS.
//
// ALIGNMENT. Frame numbers are not comparable — the disc trace starts when the
// listener was armed and the walker starts when the lab opened. Both sides are
// anchored on the same event instead: the first frame on which any hand slot
// leaves DEAL_START_X. Everything is then compared at the same offset from that
// anchor.
//
// Prepare the disc side first:
//   .venv/bin/python3 tools/parse_cardduel_trace.py \
//       /mnt/c/dw3-rig/dumps/cardgame_full_state1_trace.txt -o /tmp/disc.jsonl
// Serve the lab:  python3 -m http.server 8742 --directory web
// Run:            tools/run-playwright.sh tools/diff_cardduel_sprites.mjs /tmp/disc.jsonl
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const DISC = process.argv[2] ?? "/tmp/disc.jsonl";
// Frames after the anchor to compare. 0 means "the whole rest of the trace" —
// the default, because a 120-frame deal window only ever proved the deal.
const WINDOW = Number(process.argv[3] ?? 0);
// Slots to compare. The 12 dealt cards are 0..11; the pool is 40 deep and the
// centre row, the field and the piles all live above 11, so the default is all.
const SLOTS = Number(process.argv[4] ?? 40);
const DEAL_START_X = 352;
// THE TWO CLOCKS. The disc is PAL: it DISPLAYS at 50Hz while its game logic
// ticks at 60Hz (resident frame-delta D0x8004DE28 reads 1 on 720 of 900 sampled
// frames and 2 on 180 — mean exactly 1.2, period-5). The walker's clock is 60Hz,
// one tick per animation frame. So a rig trace frame and a walker frame are NOT
// the same instant, and comparing index-to-index compares different points in
// time: at disc frame 2 the original has advanced ~2.4 logic ticks while the
// walker has advanced 2.0. Walker frame = disc frame * 60/50.
const DISC_HZ = 50;
const WALKER_HZ = 60;
const toWalkerFrame = (discFrames) => Math.round(discFrames * (WALKER_HZ / DISC_HZ));

// WHY FRAME ALIGNMENT CANNOT REACH ZERO, AND WHAT REPLACES IT.
// The disc's delta is not a constant 1.2 — it is a period-5 sequence (2,1,1,1,1)
// whose phase we do not control, so a given logic tick lands on a different
// displayed frame on each side. Measured on the deal: the disc's timer runs
// 19,18,16,15..., the walker's 19,18,17,16..., yet BOTH satisfy the same lerp —
// disc px at timer 19/18/16/1 is 335/319/286/40, and 352-328*(20-T)/20 truncates
// to exactly those. The walker's tween MATHS is identical to the original's; only
// the sampling cadence differs, and a 60Hz display cannot show a 50Hz cadence.
//
// So the meaningful comparison aligns on the animation's own clock — the sprite's
// `timer` — not on the frame index. `--by-timer` compares, for each (slot, state,
// duration, timer) the disc visited, the position the walker computed at that same
// point in the tween. That isolates the maths from the cadence, and IS expected to
// reach zero.
const BY_TIMER = process.argv.includes("--by-timer");

// ---- disc side -------------------------------------------------------------
const disc = readFileSync(DISC, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const discAnchor = disc.findIndex((r) =>
  r.sprites.some((s) => s && s.state === 2 && s.px !== DEAL_START_X && s.px > 0));
if (discAnchor < 0) { console.error("no deal found in the disc trace"); process.exit(1); }
console.log(`disc anchor: trace frame ${disc[discAnchor].frame} (index ${discAnchor})`);

// ---- walker side -----------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${baseUrl(8742)}/ui-lab.html`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const walker = await frame.evaluate(({ startX, window: win }) => new Promise((done) => {
  const c = window.__labDuel;
  const poses = [];
  let frames = 0, anchor = -1;
  const tick = () => {
    frames += 1;
    const pose = c.spritePose ? c.spritePose() : [];
    poses.push(pose);
    if (anchor < 0 && pose.some((s) => s.state === 2 && s.px !== startX && s.px > 0)) {
      anchor = poses.length - 1;
    }
    // With win === 0 the harness runs the duel to its own outcome instead of
    // stopping a fixed distance past the deal.
    if (anchor >= 0 && win > 0 && poses.length - anchor > win) {
      return done({ poses, anchor, frames });
    }
    if (anchor >= 0 && win === 0 && c.duel?.outcome && !c.setEnd) {
      return done({ poses, anchor, frames, outcome: c.duel.outcome });
    }
    if (frames > 200000) return done({ poses, anchor, frames, timedOut: true });
    // Drive the duel exactly as tools/verify_cardduel_pace.mjs does. NONE of
    // these presses advances a phase — every beat still takes its own frames —
    // but without the full set the duel stalls forever on a summon turn, which
    // is what made the first whole-duel run time out.
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return requestAnimationFrame(tick); }
    if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (d.summonTurns && !d.summonTurns.done) c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");
    else if (c.setEnd && c.setEnd.step === "result") c.handleKey("circle");
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), { startX: DEAL_START_X, window: WINDOW });

if (errors.length) console.log("PAGE ERRORS:", errors.slice(0, 3));
if (walker.anchor < 0) {
  console.error(`walker never dealt (${walker.frames} frames${walker.timedOut ? ", timed out" : ""})`);
  await browser.close();
  process.exit(1);
}
console.log(`walker anchor: frame ${walker.anchor} of ${walker.frames}`);

// ---- compare ---------------------------------------------------------------
// Named for the CardSprite field on both sides. tools/parse_cardduel_trace.py
// translates the trace's offset-named columns into these; see its comment on
// why "state" in the trace header is NOT the engine's `state`.
const FIELDS = ["px", "py", "pdx", "pdy", "sx", "sy",
                "state", "renderKind", "badge", "effect", "timer", "dur"];
const tally = new Map();
let firstDiff = null, compared = 0;
// Divergence as a function of distance from the anchor, so it is visible WHERE
// the two timelines part company rather than just how much they differ. The two
// sides make independent decisions once the duel is under way (AI, rng), so some
// divergence downstream is expected and is not by itself a defect — the useful
// signal is the frame at which it starts and whether it is a field we control.
const BUCKET = 60;
const buckets = new Map();
const span = WINDOW > 0 ? WINDOW : Math.min(
  disc.length - discAnchor - 1,
  Math.floor((walker.poses.length - walker.anchor - 1) * (DISC_HZ / WALKER_HZ)));

for (let d = 0; d <= span; d++) {
  const dRow = disc[discAnchor + d];
  const wPose = walker.poses[walker.anchor + toWalkerFrame(d)];
  if (!dRow || !wPose) break;
  const wBySlot = new Map(wPose.map((s) => [s.slot, s]));
  for (const ds of dRow.sprites) {
    if (!ds || ds.slot >= SLOTS) continue;
    const ws = wBySlot.get(ds.slot);
    if (!ws) continue;
    for (const f of FIELDS) {
      if (ws[f] === undefined || ds[f] === undefined) continue;
      compared++;
      if (ws[f] !== ds[f]) {
        tally.set(f, (tally.get(f) ?? 0) + 1);
        const bk = Math.floor(d / BUCKET);
        buckets.set(bk, (buckets.get(bk) ?? 0) + 1);
        if (!firstDiff) firstDiff = { d, slot: ds.slot, field: f, disc: ds[f], walker: ws[f] };
      }
    }
  }
}

if (BY_TIMER) {
  // Index the walker's run by the animation clock, then replay the disc's.
  // ONLY ACTIVE TWEENS. An idle sprite has dur === 0 and timer === 0, so its key
  // matches every other idle frame and the lookup lands on an arbitrary one — the
  // first run of this compared a settled card against its pre-deal pose off-screen
  // and reported nonsense. A tween in flight is uniquely identified.
  const key = (s) => `${s.slot}|${s.state}|${s.dur}|${s.timer}`;
  const active = (s) => s.dur > 0 && s.timer > 0;
  const wByClock = new Map();
  for (const pose of walker.poses) {
    for (const ws of pose) {
      if (active(ws) && !wByClock.has(key(ws))) wByClock.set(key(ws), ws);
    }
  }
  const POS = ["px", "py", "pdx", "pdy", "sx", "sy", "renderKind", "badge", "effect"];
  const t2 = new Map();
  // What the divergent values actually ARE, per field. A count alone cannot tell
  // "off by one pixel" from "face-up where the disc has face-down".
  const pairs = new Map();
  let seen = 0, matched = 0, first = null;
  for (let d = 0; d <= span; d++) {
    const row = disc[discAnchor + d];
    if (!row) break;
    for (const ds of row.sprites) {
      if (!ds || ds.slot >= SLOTS || !active(ds)) continue;
      seen++;
      const ws = wByClock.get(key(ds));
      if (!ws) continue;
      matched++;
      for (const f of POS) {
        if (ws[f] === undefined || ds[f] === undefined) continue;
        if (ws[f] !== ds[f]) {
          t2.set(f, (t2.get(f) ?? 0) + 1);
          const pk = `${f} disc=${ds[f]} walker=${ws[f]}  (anim state ${ds.state}, dur ${ds.dur})`;
          pairs.set(pk, (pairs.get(pk) ?? 0) + 1);
          if (!first) first = { slot: ds.slot, state: ds.state, dur: ds.dur, timer: ds.timer, f, d: ds[f], w: ws[f] };
        }
      }
    }
  }
  console.log(`\nBY LOGIC CLOCK: ${matched} of ${seen} disc sprite states MID-TWEEN had a`
            + ` walker sample at the same (slot, state, duration, timer)`);
  if (!t2.size) console.log("  NO DIVERGENCE: the walker computes the disc's values at every matched point.");
  else {
    for (const [f, n] of [...t2].sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(11)} ${n}`);
    console.log(`  first: slot ${first.slot} state ${first.state} t=${first.timer}/${first.dur} `
              + `${first.f} disc=${first.d} walker=${first.w}`);
    console.log("\n  most common divergent value pairs:");
    for (const [k, n] of [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${String(n).padStart(5)}  ${k}`);
    }
  }
}

console.log(`\ncompared ${compared} field samples over ${span} frames, slots 0..${SLOTS - 1}`
          + (walker.outcome ? `  (walker duel ended: ${walker.outcome})` : ""));
if (!tally.size) {
  console.log("NO DIVERGENCE: every field matches the disc.");
} else {
  console.log("\ndivergent fields, worst first:");
  for (const [f, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(6)} ${n} samples differ`);
  }
  const { d, slot, field, disc: dv, walker: wv } = firstDiff;
  console.log(`\nfirst divergence: +${d} frames from the deal, slot ${slot}, `
            + `${field} disc=${dv} walker=${wv}`);
  console.log(`\ndivergence over time (${BUCKET}-frame buckets from the deal):`);
  for (const [bk, n] of [...buckets].sort((a, b) => a[0] - b[0]).slice(0, 20)) {
    const bar = "#".repeat(Math.min(50, Math.ceil(n / 20)));
    console.log(`  +${String(bk * BUCKET).padStart(5)}..${String(bk * BUCKET + BUCKET - 1).padStart(5)}  `
              + `${String(n).padStart(6)} ${bar}`);
  }
}
await browser.close();
