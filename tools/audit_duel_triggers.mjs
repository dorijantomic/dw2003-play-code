// THE TRIGGER AUDIT. For every decoded duel behaviour, prove at runtime that it
// actually fires.
//
// Why this exists: verify_cardduel_anim.mjs reported a clean [1,2,4] and was
// measuring nothing — it only pressed Enter, so it never summoned and never
// reached the Battle Phase. A green number from a driver that cannot reach the
// code is worse than no number. Everything here is therefore reported with the
// reachability caveat attached: a zero is only a bug candidate if the run
// actually got somewhere it could have been observed.
//
// Axes recorded:
//   * sprite animation states and effect runs  (the decoded state machine)
//   * every string the game actually draws     (via globalThis.__uiTextTrace)
//   * phases reached, and both battle outcomes
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BANK = "/home/dorij/ddw3/lang_file/dw2003/eng/escardgm.toml";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));

await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "networkidle" });
const frame = p.frames().find((f) => f.url().includes("index.html")) || p.mainFrame();
await frame.waitForFunction(() => !!window.__labOpen, null, { timeout: 20000 });
await frame.evaluate(() => window.__labOpen("cardduel"));
await p.waitForTimeout(2500);
await p.locator("iframe").first().click({ position: { x: 200, y: 200 } }).catch(() => {});
await p.waitForTimeout(300);

// Arm the text trace inside the game frame.
await frame.evaluate(() => {
  globalThis.__uiTextTrace = new Set();
  globalThis.__vmOpTrace = new Set();
  globalThis.__sfxTrace = new Set();
});

const states = new Set(), runs = new Set(), phases = new Set(), playStages = new Set();
const outcomes = new Set();

const probe = () => frame.evaluate(() => {
  const d = window.__labDuel;
  if (!d) return null;
  return {
    phase: d.phaseKey?.() ?? null,
    summonCursor: d.summonCursor?.() ?? null,
    playStage: d.play?.stage ?? null,
    playable: d.play ? [...Array(d.duel?.player.hand.length ?? 0).keys()]
      .filter((i) => d.playableSlot?.(i)).length : null,
    php: d.duel?.player.totalHp ?? null,
    ohp: d.duel?.opponent.totalHp ?? null,
    pf: d.duel?.player.field.length ?? 0,
    of: d.duel?.opponent.field.length ?? 0,
    sprites: [...d.sprites].map(([, r]) => ({ s: r.sprite.state, e: r.sprite.effect })),
  };
});

const sample = async (n = 3, ms = 40) => {
  for (let i = 0; i < n; i++) {
    await p.waitForTimeout(ms);
    const s = await probe();
    if (!s) continue;
    if (s.phase) phases.add(s.phase);
    if (s.playStage) playStages.add(`${s.playStage}(playable=${s.playable})`);
    for (const sp of s.sprites) {
      if (sp.s != null) states.add(sp.s);
      if (sp.e) runs.add(sp.e);
    }
  }
};

/** Force the coming battle's winner by posing the DISPLAYED health, which is
 *  what recomputeTotals sums and what the reaction's youWin test reads. */
const forceOutcome = (playerWins) => frame.evaluate((win) => {
  const d = window.__labDuel?.duel;
  if (!d) return false;
  // BOTH numbers, not just health. Battle damage is the other side's total AP
  // against this side's total HP, so posing health alone let each side wipe the
  // other out — every battle came back 0 vs 0, and a tie falls to the opponent.
  // The winner is the side left with health, so the loser needs no attack.
  const pose = (side, wins) => {
    for (const f of side.field) {
      f.ap = f.shownAp = wins ? 90 : 0;
      f.hp = f.shownHp = wins ? 90 : 1;
    }
    side.totalAp = side.field.reduce((t, f) => t + f.shownAp, 0);
    side.totalHp = side.field.reduce((t, f) => t + f.shownHp, 0);
  };
  pose(d.player, win);
  pose(d.opponent, !win);
  return true;
}, playerWins);

let wantPlayerWin = true;
let exercised = false;
await sample(6);
for (let step = 0; step < 260; step++) {
  const s = await probe();
  if (s?.phase === "summon" && s.summonCursor != null) {
    await p.keyboard.press("v");
    await sample(3);
  }
  // Alternate who takes each battle so BOTH branches of the reaction are
  // reachable. Without this the player never wins and states 7 and 9 look
  // missing when they are merely unobserved.
  // Both branches of the battle reaction, exercised directly the first time a
  // board exists on both sides. A posed board does not survive the resolution
  // and endSet, so winning a real duel is not a dependable way to reach the
  // player-wins branch — and running this after the duel ends reaches nothing
  // at all, because there are no field sprites left. This calls exactly what
  // resolveCurrentPhase calls, with nothing stubbed, so the audit can separate
  // "the branch is broken" from "this run never won a battle".
  if (!exercised && s && s.pf > 0 && s.of > 0) {
    exercised = true;
    for (const win of [true, false]) {
      await frame.evaluate((w) => window.__labDuel?.__runBattleReactions?.(w), win);
      await sample(6, 30);
    }
  }
  if (s?.phase === "battle" && s.pf > 0 && s.of > 0) {
    if (await forceOutcome(wantPlayerWin)) {
      outcomes.add(wantPlayerWin ? "player" : "opponent");
      wantPlayerWin = !wantPlayerWin;
    }
  }
  await p.keyboard.press("Enter");
  await sample(3);
}

const drawn = new Set(await frame.evaluate(() => [...(globalThis.__uiTextTrace ?? [])]));
const ops = new Set(await frame.evaluate(() => [...(globalThis.__vmOpTrace ?? [])]));
const sfxSeen = new Set(await frame.evaluate(() => [...(globalThis.__sfxTrace ?? [])]));

// --- report ---------------------------------------------------------------
const DECODED_STATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DECODED_RUNS = [1, 2, 3, 4];
console.log(`phases_reached      = ${[...phases].join(",")}`);
console.log(`battle_outcomes     = ${[...outcomes].join(",") || "NONE — states 6/7/9 unobservable"}`);
console.log(`states_observed     = [${[...states].sort((a, c) => a - c)}]`);
console.log(`states_never_seen   = [${DECODED_STATES.filter((s) => !states.has(s))}]`);
console.log(`effect_runs_observed= [${[...runs].sort()}]`);
console.log(`runs_never_seen     = [${DECODED_RUNS.filter((r) => !runs.has(r))}]`);

// Which lines of the shipped text bank ever reach the screen.
let bankLines = [];
try {
  // escardgm.toml is one `strings = [ ... ]` array, one quoted entry per line
  // with a leading tab and a trailing comma — not key = "value" pairs.
  bankLines = readFileSync(BANK, "utf8").split("\n")
    .map((l) => l.match(/^\s*"(.*)",?\s*$/)?.[1])
    .filter((v) => v && v.trim().length > 2)
    .map((v) => v.replace(/\\n/g, " "));
} catch { console.log("bank_unavailable    = " + BANK); }
if (bankLines.length) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const shown = new Set([...drawn].map(norm));
  // Match strictly. The first version asked whether the BANK LINE contained a
  // drawn string, which any two-character draw ("5", "AP") satisfies for almost
  // every line — it reported 67 of 67 rendered off 63 distinct strings, which
  // cannot be true. A line counts as rendered only if some drawn string is it,
  // contains it whole, or is a substantial prefix of it (the bank stores a few
  // entries with an embedded newline that reach the screen as two draws).
  const shownArr = [...shown].filter((d) => d.length >= 4);
  const unseen = [...new Set(bankLines)].filter((l) => {
    const n = norm(l);
    return !shownArr.some((d) => d === n || d.includes(n)
      || (d.length >= 8 && n.startsWith(d)));
  });
  console.log(`bank_lines          = ${new Set(bankLines).size}`);
  console.log(`bank_lines_rendered = ${new Set(bankLines).size - unseen.length}`);
  console.log(`bank_lines_NEVER_rendered (${unseen.length}):`);
  for (const l of unseen.slice(0, 60)) console.log(`   - ${JSON.stringify(l)}`);
}
// --- the VM's opcode vocabulary -------------------------------------------
// 174 opcodes are decoded; the 60 shipped card programs use 100 of them and the
// other 74 are the phase machine's own ceremony. What a REAL duel executes is a
// third number, and the one that says which decoded behaviour is live.
const reg = JSON.parse(readFileSync(
  "/home/dorij/ddw3-walker/docs/research/card/cardgame-opcode-registry.json", "utf8"));
const allOps = Object.keys(reg.opcodes).map((k) => parseInt(k, 16));
const hex = (n) => "0x" + n.toString(16).toUpperCase().padStart(2, "0");
const inPrograms = new Set();
for (const e of JSON.parse(readFileSync(
  "/home/dorij/ddw3-walker/web/assets/data/card_effects.json", "utf8")).effects) {
  for (const m of e.messages ?? []) inPrograms.add(m);
}
// Split the vocabulary the way the game does. CARD opcodes are what the 60
// shipped programs contain; CEREMONY opcodes are what the phase machine issues
// and no card program holds.
//
// Card-opcode coverage is NOT this harness's job and its number here is not a
// bug signal: one duel deals one hand, only a card or two is ever playable, and
// covering all 100 through the UI would take dozens of duels. That every card
// program runs end to end is already proven at engine level by
// tests/engine/unit/card-effect-vm.test.ts. What the UI axis proves is that the
// path from a press to the VM works at all — reaching `commit` and executing
// anything is the pass condition.
//
// The CEREMONY opcodes are the real signal: they are issued by the phase
// machine, so a duel that reaches every phase should reach them, and one that
// never executes is a wiring gap rather than a dealing accident.
const ceremony = allOps.filter((o) => !inPrograms.has(o));
const cardRan = [...inPrograms].filter((o) => ops.has(o));
const ceremonyRan = ceremony.filter((o) => ops.has(o));
console.log(`vm_opcodes_executed = ${ops.size} of ${allOps.length} decoded`);
console.log(`  card opcodes     : ${cardRan.length} of ${inPrograms.size} executed`
  + "  (coverage is dealing luck, not a bug signal — see engine tests)");
console.log(`  ceremony opcodes : ${ceremonyRan.length} of ${ceremony.length} executed`);
console.log(`    executed : ${ceremonyRan.sort((a, c) => a - c).map(hex).join(" ") || "NONE"}`);
console.log(`    NOT run  : ${ceremony.filter((o) => !ops.has(o)).sort((a, c) => a - c).map(hex).join(" ")}`);

console.log(`play_stages_seen = ${[...playStages].join(" | ") || "NONE — no Program card was ever played"}`);
console.log(`sounds_played = ${sfxSeen.size}`);
console.log(`distinct_strings_drawn = ${drawn.size}`);
if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].slice(0, 5).join("\n"));
await b.close();
