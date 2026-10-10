// Prove, in the live page, that a duel is now PLAYED rather than watched:
// the Load and Compile phases stop and ask which card you want, the ask is a
// three-step negotiation with a take-back, and a card whose program needs a
// target stops the duel again until you choose one.
//
//   docs/research/ui/cardgame-divergence-2026-08-21.md items 1 and 4
//   docs/research/card/card-effect-programs-2026-08-22.md
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_play.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelplay";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The legacy duel: this check reads the old shell's own surface (labDuel.duel, labDuel.handleKey, labDuel.isOpen, labDuel.play), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const key = async (k, wait = 200) => {
  await frame.evaluate((kk) => window.__labDuel.handleKey(kk), k);
  await page.waitForTimeout(wait);
};
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
/** Press until the duel reaches the state we are after — the board refuses
 *  input while cards are animating, exactly as the disc does. */
const keyUntil = async (k, want, tries = 25) => {
  for (let i = 0; i < tries; i++) {
    const s = await snap();
    if (want(s)) return s;
    // TRIANGLE WITH NOTHING OPEN QUITS THE DUEL. `Escape` is Triangle, and the
    // Load/Compile branch treats a bare Triangle as "leave the card game" — so
    // pressing it blind, which this used to do, closed the screen and froze
    // everything behind it. Only press it while there is a prompt to cancel.
    const canPress = await frame.evaluate((kk) => {
      const c = window.__labDuel;
      if (!c.isOpen()) return false;
      if (kk !== "cross") return true;
      return !!(c.play || c.effectPicker || c.picker);
    }, k);
    if (!canPress) { await page.waitForTimeout(60); continue; }
    await key(k, 200);
  }
  return snap();
};
/** Injected into the page: true while a beat is waiting on Circle or Cross.
 *  The seven phase banners poll the pad with no timeout (`F0x80089580`), and so
 *  does the card reveal 0x1B at step 6 of its own machine, so nothing advances
 *  until something presses. Ask the model rather than testing a range. */
const BANNER_HELPER = `window.duelAwaitsBanner = (d) =>
  !!d && d.beat.gated && d.beat.current !== null;`;
await frame.evaluate(BANNER_HELPER);

const snap = () => frame.evaluate(() => {
  const c = window.__labDuel;
  const d = c.duel;
  // The challenge screen and the folder chooser both run BEFORE there is a duel
  // at all (added 2026-08-24), so the first snapshots have nothing to read.
  if (!d) return { phase: null, play: null, picker: null, offered: null, hand: 0,
                   field: 0, trash: 0, turns: null, outcome: null, log: [] };
  return {
    phase: c.phaseKey(),
    play: c.play ? { ...c.play } : null,
    picker: c.effectPicker ? { ...c.effectPicker } : null,
    // what the parked question is offering, so a check can watch exactly those
    offered: (() => {
      const ch = window.__engineDuelChoice ? window.__engineDuelChoice(d) : (d.effectVm?.choice ?? null);
      if (!ch || ch.kind !== "board") return null;
      return ch.targets.map((t) => {
        const f = t.side.field[t.slot];
        return { side: t.side === d.player ? "you" : "opp", slot: t.slot, id: f?.id, hp: f?.hp, ap: f?.ap };
      });
    })(),
    hand: d.player.hand.length,
    field: d.player.field.length,
    trash: d.player.trash.length,
    turns: d.programTurns ? { turn: d.programTurns.turn, passes: d.programTurns.passes, done: d.programTurns.done } : null,
    outcome: d.outcome,
    log: d.log.slice(-2),
  };
});

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };

/** Wait for the duel to reach a state, pressing ONLY where it is genuinely
 *  waiting on the pad for something this test is not about.
 *
 *  UPDATED 2026-08-26. The duel used to advance one phase per confirm, so these
 *  harnesses hammered Enter to get anywhere. It now runs the disc's own
 *  ceremony-opcode stream a beat per frame and stops by itself wherever the
 *  disc stops — so a blind press is no longer a way of moving forward, it is a
 *  way of answering the question the test was waiting for. */
const settle = async (want, tries = 300) => {
  for (let i = 0; i < tries; i++) {
    const s = await snap();
    if (want(s)) return s;
    const waiting = await frame.evaluate(() => {
      const c = window.__labDuel;
      if (!c.duel) return true;                            // challenge / chooser
      if (c.coin) return c.coin.step === 2;                // the Calumon pick
      // A PHASE BANNER WAITS FOR THE PLAYER, with no timer — so a harness that
      // never presses waits forever. This is the press a player makes.
      return duelAwaitsBanner(c.duel);
    });
    if (waiting) await key("enter", 100);
    else await page.waitForTimeout(50);
  }
  return snap();
};

// Start -> Draw -> Load, then through the phase announcement, which is only
// skippable after its first 0x14 units.
let st = await settle((s) => !!s.play);
// The question comes first and the hand only opens if you say yes — and the
// box opens EVEN WHEN YOU CANNOT PLAY, with the cursor parked on "No" and
// frozen there, which is a decoded behaviour verify_cardduel_turns covers. This
// harness is about what happens once the hand IS open, so on a frozen turn it
// answers with the cursor forced to "Yes" rather than passing and starting over.
if (st.play && st.play.stage === "ask") {
  await frame.evaluate(() => { const p = window.__labDuel.play; p.ask = 0; p.frozen = false; });
  await key("enter");
  st = await snap();
}
await shot("01-pick");
check(!!st.play && st.play.stage === "pick", `the duel stops and asks which card to play (${JSON.stringify(st.play)})`);
check(st.hand > 0, "your hand is still in your hand");

// The cursor is yours to move.
const before = st.play.cursor;
await key("ArrowRight");
st = await snap();
check(st.play.cursor !== before, `the cursor moves along your hand (${before} -> ${st.play.cursor})`);

// Pose a hand that holds a Program card with a real target, so the three
// prompts and the effect's own question can both be shown. Fire Cannon (22) is
// `5B 58 67 4D 4C`: pick one of the opponent's Digimon, 30 damage.
// Cards whose program stops to ask which board target to act on (opcode 0x5B)
// come first, so the effect's own question is exercised when the phase allows
// one of them.
const effectTable = await (await fetch(`${baseUrl(8742)}/assets/data/card_effects.json`)).json();
const askers = effectTable.effects
  .filter((e) => e.messages.includes(0x5b) && e.targeting.zone === "field")
  .map((e) => e.id);
const order = askers.concat(effectTable.effects.map((e) => e.id).filter((id) => !askers.includes(id)));

const posed = await frame.evaluate((ids) => {
  const c = window.__labDuel, d = c.duel;
  const blue = [];
  for (const [id, rec] of d.byId) if (rec.kind === "digimon" && rec.colour === "blue") blue.push(id);
  const stat = (id) => ({
    id, ap: d.byId.get(id).ap, hp: d.byId.get(id).hp,
    shownAp: d.byId.get(id).ap, shownHp: d.byId.get(id).hp,
    shownAp: d.byId.get(id).ap, shownHp: d.byId.get(id).hp,
  });
  // BOTH fields are posed. `askers` is every card that carries 0x5B over the
  // board, and its targeting picks the side: Protect Aura is
  // `sides: ["own"]`, so posing only the opponent's field left it with no legal
  // target and no question to ask. Filling one side only made this harness
  // report an implementation defect that was its own setup.
  d.opponent.field = blue.slice(0, 3).map(stat);
  d.player.field = blue.slice(3, 6).map(stat);
  c.play.cursor = 0;
  // Only some Program cards may be picked in the Load Phase (the disc's own
  // per-phase class gate), so take the first one that both gates accept and
  // that has to ask which Digimon to hit.
  for (const id of ids) {
    d.player.hand[0] = id;
    if (c.playableSlot(0)) {
      c.resyncSprites();
      return { id, name: d.byId.get(id).name };
    }
  }
  return null;
}, order);
console.log("  posed:", JSON.stringify(posed));
st = await snap();
const handBefore = st.hand;

st = await keyUntil("enter", (s) => s.play?.stage === "pick");
// The three stages are `ask`, `pick`, `commit`. This harness asked for a
// stage called "confirm", which the duel has never had under that name --
// so all five of its negotiation checks had been failing on a spelling.
check(st.play?.stage === "pick", "picking a card raises a second prompt rather than playing it");
await shot("02-confirm");

st = await keyUntil("enter", (s) => s.play?.stage === "commit");
check(st.play?.stage === "commit", "and a third asks again before the card is played");
await shot("03-commit");

// Take it back: nothing has left the hand.
// Cross is the take-back now: Triangle opens the inspect menu.
st = await keyUntil("cross", (s) => s.play?.stage === "pick");
check(st.play?.stage === "pick", "declining at the third prompt is a take-back");
check(st.hand === handBefore, "the card is still in your hand after the take-back");

// And now really play it.
st = await keyUntil("enter", (s) => s.play?.stage === "commit");
st = await keyUntil("enter", (s) => s.hand === handBefore - 1 || !!s.picker, 30);
await shot("04-played");
check(st.hand === handBefore - 1, `the card was played (hand ${handBefore} -> ${st.hand})`);
check(!askers.includes(posed.id) || !!st.picker,
  `if the posed card was one that asks, the duel stopped (${posed.name})`);
if (st.picker) { await shot("05-effect-choice"); }

// --- act two: the Compile Phase, where any Program card may be played, so a
// card whose program asks WHICH Digimon to hit can be shown doing it.
// Walk to the Compile Phase. The duel keeps its own time now, so this presses
// only where the disc genuinely hands it a decision, and never to advance a
// phase — the same policy verify_cardduel_pace.mjs uses. Blind Enter presses,
// which is what this used to do, now ANSWER the question the test is waiting
// for instead of moving the duel along.
let stage2 = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  let frames = 0;
  const tick = () => {
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return next(); }
    if (c.phaseKey() === "compile" && c.play) return done({ reached: true, frames });
    if (d.outcome) return done({ reached: false, frames, why: "the duel ended first" });
    if (++frames > 20000) return done({ reached: false, frames, why: "timed out", drive: c.driveDebug() });
    // A phase banner waits on Circle or Cross with no timer, so a driver that
    // never presses waits forever. This is the press a player makes.
    // The Summon Phase must be handled BEFORE the play/picker arms: a summon
    // turn parks the shared browser and can also set `c.play`/`c.picker`, so an
    // earlier `else if` would swallow the press and the phase would never
    // commit. Square commits the player's own summon turn (legend
    // "[cross] Select [square] Summon"; F0x800878B4 sets picker state 6).
    if (window.duelAwaitsBanner(d)) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (d.summonTurns && !d.summonTurns.done) c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");
    else if (c.play) c.handleKey("cross");                 // decline the turn
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));
console.log("  walk to compile:", JSON.stringify(stage2));
check(await frame.evaluate(() => window.__labDuel.isOpen()), "the duel screen is still open");
check(stage2.reached, `the duel reached the Compile Phase and was asked (${stage2.why ?? ""})`);
stage2 = await snap();
check(!!stage2.play, "the Compile Phase asks which card to play too");
if (stage2.play && stage2.play.stage === "ask") {
  await frame.evaluate(() => { const p = window.__labDuel.play; p.ask = 0; p.frozen = false; });
  await key("enter");
  stage2 = await snap();
}

const posed2 = await frame.evaluate((ids) => {
  const c = window.__labDuel, d = c.duel;
  const blue = [];
  for (const [id, rec] of d.byId) if (rec.kind === "digimon" && rec.colour === "blue") blue.push(id);
  const stat = (id) => ({
    id, ap: d.byId.get(id).ap, hp: d.byId.get(id).hp,
    shownAp: d.byId.get(id).ap, shownHp: d.byId.get(id).hp,
    shownAp: d.byId.get(id).ap, shownHp: d.byId.get(id).hp,
  });
  d.opponent.field = blue.slice(0, 3).map(stat);
  d.player.field = blue.slice(3, 6).map(stat);   // see act one: own-side askers
  c.play.cursor = 0;
  for (const id of ids) {
    d.player.hand[0] = id;
    if (c.playableSlot(0)) { c.resyncSprites(); return { id, name: d.byId.get(id).name }; }
  }
  return null;
}, askers);
console.log("  posed:", JSON.stringify(posed2));
check(!!posed2 && askers.includes(posed2.id),
  `a card that must pick one target is in hand (${posed2?.name})`);

const hand2 = (await snap()).hand;
await keyUntil("enter", (s) => s.play?.stage === "pick");
await keyUntil("enter", (s) => s.play?.stage === "commit");
stage2 = await keyUntil("enter", (s) => s.hand === hand2 - 1 || !!s.picker, 30);
check(!!stage2.picker, `${posed2?.name} stops the duel and asks which Digimon to hit`);
await shot("05-effect-choice");
if (stage2.picker) {
  const offeredBefore = stage2.offered;
  await key("ArrowRight");
  const chosen = (await snap()).picker.cursor;
  stage2 = await keyUntil("enter", (s) => !s.picker, 20);
  check(!stage2.picker, "the program carried on once the target was chosen");
  const after = await frame.evaluate((list) => {
    const d = window.__labDuel.duel;
    return list.map((t) => {
      const f = (t.side === "you" ? d.player : d.opponent).field[t.slot];
      return { hp: f?.hp, ap: f?.ap };
    });
  }, offeredBefore);
  const moved = offeredBefore.map((t, i) => t.hp !== after[i].hp || t.ap !== after[i].ap);
  check(moved.filter(Boolean).length === 1 && moved[chosen] === true,
    `exactly the Digimon you chose changed (cursor ${chosen}: ${JSON.stringify(offeredBefore.map((t) => [t.ap, t.hp]))} -> ${JSON.stringify(after.map((t) => [t.ap, t.hp]))})`);
  await shot("06-effect-applied");
}

// Passing twice ends the phase, and the duel can still be finished.
//
// This used to press Escape-or-Enter 200 times and expect an outcome. It is not
// enough any more: the duel keeps its own time, and a beat that parks on a
// question no plain Enter answers (a program's board picker, the coin toss, the
// set-end window) stops the whole loop. Answer whatever is actually on the
// screen, and give the duel frames of its own between presses.
let guard = 0;
while (guard++ < 900) {
  const s = await frame.evaluate(() => {
    const c = window.__labDuel;
    if (!c.duel) return { outcome: null, k: "enter" };
    // The Summon Phase commits on Square, so it must be answered before the
    // play/picker arms — otherwise the phase stalls with the field empty and
    // the duel never reaches its second set, let alone an outcome.
    const t = c.duel.summonTurns;
    const k = (t && !t.done) ? (t.order[t.turn] === c.duel.player ? (c.summonConfirm ? "circle" : "square") : "circle")
      : c.play ? "cross"
      : (c.effectPicker || c.picker) ? "circle"
      : (c.coin || c.combo || c.setEnd) ? "circle"
      : "enter";
    return { outcome: c.duel.outcome ?? null, k };
  });
  if (s.outcome) break;
  if (guard % 200 === 0) {
    const where = await frame.evaluate(() => {
      const c = window.__labDuel;
      return { phase: c.phaseKey(), set: c.duel?.set, log: c.duel?.log?.slice(-1) };
    });
    console.log("  still going:", guard, JSON.stringify(where));
  }
  await key(s.k, 70);
}
st = await snap();
await shot("07-outcome");
check(!!st.outcome, `passing ends the phase and the duel reaches an outcome (${st.outcome})`);
check(errors.length === 0, `no page errors (${errors.join(" | ")})`);

console.log(fail.length ? `\nFAILED:\n  - ${fail.join("\n  - ")}` : "\nall checks passed");
console.log(`captures in ${OUT}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
