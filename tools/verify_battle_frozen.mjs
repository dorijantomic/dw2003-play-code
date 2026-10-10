// A frozen partner loses its turn before the command menu opens.
//
// The original settles this in ONE script instruction. `F0x800a7418` is the command-menu
// instruction, and its step 1 (`wfightmn.s:1744`-`:1794`) does, in this order:
//
//   1. return while a line is up (`:1744`, the read the walker already keeps in
//      `commandPhaseWaitsForLine`);
//   2. resolve the ACTING Digimon, `0x800a4470 + 32*[0x800a4468]` (`:1750`-`:175c`);
//   3. test its status byte `+0x1c` for `0x2` (`:1760`-`:1768`);
//   4. on a hit, call the roll at `[0x800a4660](0)` -- `F0x800a19d8`, argument 0 = the player
//      side (`:1774`-`:1784`). A NONZERO return blocks the turn: the branch is `beqz ->
//      proceed`, so the return value 1 means "you do not move this turn";
//   5. put up message `0x56` -- `esmfight[0x56]` is "Frozen and can't move!" -- through the
//      line object's `+0xac` with kind 2 and the pair at `instr+0x50` (`:178c`-`:17b8`), so the
//      panel reads the partner's name on line one and the game's sentence on line two;
//   6. never arm the list. The arming is the `jal 0x80092d80` with the literal 2 at `:1824`,
//      which the blocked branch jumps over.
//
// The tail (`:17bc`-`:17f4`) is what makes it a lost TURN and not a lost battle: the
// speed-relative delay `[0x800a437c](0, 0)` -- `F0x8009bda4` opcode 0, `clamp(1000*sqrt(SPDopp/
// SPDown), 707, 1414)` -- goes to `F0x8009c4bc`, which re-enqueues the player action event at
// that cost, and only then `instr+0x2C(2)` gives the controller back. So the enemy still takes
// its own turn and the partner's command menu comes round again.
//
// What this check proves, all with real key presses on a live battle:
//   * not frozen -> the command list opens (the control);
//   * frozen at the turn -> the line "Frozen and can't move!" is the game's own, the command
//     list NEVER opens on that turn, and no row is chosen (sampled every animation frame from
//     the moment Fight is confirmed until the line is read);
//   * the turn is lost, not the battle: the enemy acts, and the partner's next command phase
//     opens its list again.
//
// The Frozen status is set through the battle's own live combatant -- the same `ailments` entry
// the shared `applyAilment` writes (`{ power, recoveryTime }`) -- not through a mock screen. The
// magnitude is 0xff with the summed native resistance term pinned to 0, which is inside the
// original's own range (`chance = record[+0x2d] - ceil((eff[+0x1c]+eff[+0x14])/8)`, floored at
// 0x20, compared against `RAND_U16 & 0x7f`): a chance above 0x7f blocks every time, so the roll
// is deterministic here without touching the shared RAND_U16 for anything else.
//
// Server: python3 -m http.server 8887 --directory web
// Run:    VERIFY_PORT=8887 tools/run-playwright.sh tools/verify_battle_frozen.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { readBattleLine, waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.BTL_ROOT || `${baseUrl(process.env.VERIFY_PORT || 8887)}/`;
const OUT = process.env.BTL_SHOT || "/tmp/battle-frozen";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const member = (digimonId, level, xp, hp = 200) => ({
    digimonId, level, xp, tp: 10, hp, maxHp: 200, mp: 80, maxMp: 80,
    stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
    bonuses: {}, elemBonuses: {},
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(3, 5, 0)));
  localStorage.setItem("partyStats", JSON.stringify([member(3, 5, 0)]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
});

const tap = async (k, ms = 90) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
  await page.waitForTimeout(60);
};
const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};
const peek = () => page.evaluate(() => window.__battle?.peek?.() ?? null);
const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) problems.push(msg);
};

/** Sample every animation frame from inside the page: did the command list ever come up? */
const startRecorder = () => page.evaluate(() => {
  const rec = {
    frames: 0, listUp: 0, chosenSeen: [], states: {}, sawFrozenLine: null, sawEnemyTurn: false,
  };
  window.__frozenRec = rec;
  window.__frozenTimer = setInterval(() => {
    const p = window.__battle?.peek?.();
    if (!p) return;
    rec.frames++;
    rec.states[p.state] = (rec.states[p.state] ?? 0) + 1;
    if (p.state === 6) rec.sawEnemyTurn = true;
    if (p.commandList?.open || p.commandList?.active) rec.listUp++;
    const chosen = window.__battleCmdNative?.diagnostics?.()?.chosen ?? null;
    if (!rec.chosenSeen.includes(chosen)) rec.chosenSeen.push(chosen);
    const lines = p.messageLine?.frame?.lines ?? null;
    if (lines && lines.some((l) => /Frozen and can't move/i.test(String(l)))) {
      rec.sawFrozenLine = lines;
    }
  }, 16);
  return rec;
});
const stopRecorder = () => page.evaluate(() => {
  clearInterval(window.__frozenTimer);
  return window.__frozenRec ?? null;
});

try {
  // ── Control: nothing frozen, so the list opens ──
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 15_000;
  let launched = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      tb: window.__textbox?.isOpen?.() ?? false,
    }));
    if (st.battle) { launched = true; break; }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  if (!launched) throw new Error("no battle");
  const opened = await waitForCommandMenu(page);
  expect(opened.state === 2, `the opening turn reached the command menu (state ${opened.state})`);
  expect(!!opened.menu?.length, `the menu offers its rows (${JSON.stringify(opened.menu)})`);
  expect(opened.chosen === null, "no row was chosen by the press that read the line");
  await shot("frozen-00-control-menu-open");

  // ── The partner is Frozen at its next turn, through the battle's own state ──
  const inflicted = await page.evaluate(() => {
    const b = window.__battleB();
    if (!b) return null;
    // The entry the shared applyAilment writes for Frozen: a magnitude byte and the
    // timeline recovery time. 0xff magnitude with the summed native term at 0 makes the
    // block chance 255 against a 0..127 draw, so the roll blocks every time.
    b.player.ailments.frozen = { power: 0xff, recoveryTime: 900_000 };
    b.player.frozenBlockResistance = 0;
    // Neither side's HP decides whether the gate runs, and this enemy's HP is low enough
    // that one Fight ends the battle. Both sides are given room, so the check always gets
    // the partner's next turn instead of a win or a knockout screen.
    b.player.maxHp = 9_999;
    b.player.hp = 9_999;
    b.enemy.maxHp = 9_999;
    b.enemy.hp = 9_999;
    return {
      frozen: { ...b.player.ailments.frozen },
      resistance: b.player.frozenBlockResistance,
      name: b.player.profile?.name,
    };
  });
  expect(inflicted?.frozen?.power === 0xff,
    `the live partner carries Frozen (${JSON.stringify(inflicted)})`);

  // Fight, so the turn ends and the partner's next command phase is where the gate runs.
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state !== 2, null, { timeout: 10_000 });
  // The recorder starts with the list already closed, so the row the Fight press chose
  // cannot be mistaken for a pick made during the frozen turn.
  await page.waitForFunction(
    () => window.__battleCmdNative?.diagnostics?.()?.open === false,
    null, { timeout: 10_000 },
  );
  const baselineChosen = await page.evaluate(
    () => window.__battleCmdNative?.diagnostics?.()?.chosen ?? null,
  );
  await startRecorder();
  const turnSeqBefore = (await peek())?.frozenGate?.seq ?? null;

  // Play the ordinary turn on: read each line, press the result page on. The gate fires on
  // the frame the command phase is reached, so nothing is pressed in that state.
  for (let i = 0; i < 60; i++) {
    const p = await peek();
    if (p?.frozenGate?.lost) break;
    if (p?.state === 8 || p?.state === 9) break;              // the battle ended instead
    if (p?.state === 2) { await page.waitForTimeout(120); continue; }
    if (!await readBattleLine(page, { timeout: 1500 })) await tap("Enter");
    await page.waitForTimeout(120);
  }
  // The line then holds the turn until it is read.
  const lineUp = await page.waitForFunction(
    () => {
      const p = window.__battle?.peek?.();
      const lines = p?.messageLine?.frame?.lines ?? [];
      return !!p?.frozenGate?.lost && lines.some((l) => /Frozen and can't move/i.test(String(l)));
    },
    null,
    { timeout: 30_000 },
  ).then(() => true, () => false);
  const frozenLine = await peek();
  expect(lineUp === true,
    `the frozen turn showed its line (state ${frozenLine?.state}, gate ${JSON.stringify(frozenLine?.frozenGate)}, lines ${JSON.stringify(frozenLine?.messageLine?.frame?.lines ?? null)})`);
  await shot("frozen-01-frozen-line");
  const lines = frozenLine?.messageLine?.frame?.lines ?? [];
  console.log("  frozen line", JSON.stringify(lines), "state", frozenLine?.state);
  expect(lines.some((l) => /Frozen and can't move/i.test(String(l))),
    `the game's own line is up (${JSON.stringify(lines)})`);
  expect(frozenLine?.message?.includes("frozen and can't move"),
    `the battle says the turn is lost (${JSON.stringify(frozenLine?.message)})`);
  expect(frozenLine?.frozenGate?.lost === true, "the battle's own read-out says the turn was lost");
  expect(frozenLine?.frozenGate?.seq !== turnSeqBefore,
    `the gate rolled on the new turn (seq ${frozenLine?.frozenGate?.seq}, was ${turnSeqBefore})`);
  expect(!!frozenLine?.player, "the partner is still the actor");

  // While the line stands, the command list must not exist and no row may be chosen.
  for (let i = 0; i < 4; i++) {
    await tap("ArrowDown");
    await tap("ArrowUp");
  }
  const during = await peek();
  expect(during?.commandList?.open === false && during?.commandList?.active === false,
    `the command list never opened while the line stood (open ${during?.commandList?.open}, active ${during?.commandList?.active})`);

  // Read the line: the turn is over for the partner, so the enemy takes its own turn. The
  // recorder keeps sampling, and it must see the enemy's own turn (state 6) come after.
  await readBattleLine(page, { timeout: 30_000 });
  const enemyTurnSeen = await page
    .waitForFunction(() => window.__frozenRec?.sawEnemyTurn === true, null, { timeout: 15_000 })
    .then(() => true, () => false);
  await shot("frozen-02-enemy-turn");
  const rec = await stopRecorder();
  console.log("  recorder", JSON.stringify(rec));
  expect(rec?.sawFrozenLine !== null,
    "the frozen line was on screen while the command phase waited");
  expect(rec?.listUp === 0,
    `the command list was never open on the frozen turn (open on ${rec?.listUp} of ${rec?.frames} sampled frames)`);
  expect(JSON.stringify(rec?.chosenSeen) === JSON.stringify([baselineChosen]),
    `no command was chosen on the frozen turn (chosen rows seen ${JSON.stringify(rec?.chosenSeen)}, the Fight before it was ${JSON.stringify(baselineChosen)})`);
  expect(enemyTurnSeen === true,
    `the enemy took its own turn after the lost one (states seen ${JSON.stringify(rec?.states)})`);

// The turn is lost, not the battle. Lift the partner's Frozen (the same deletion the cure
// appliers make on the live combatant) and top its HP back up, so the battle outlives the
// turn and its next command phase is reachable whatever the enemy's damage roll was.
await page.evaluate(() => {
  const b = window.__battleB();
  delete b.player.ailments.frozen;
  b.player.hp = b.player.maxHp;
  // The enemy's own HP does not matter to the gate either, and a battle that ends under the
  // walker's feet cannot show the next turn's menu.
  b.enemy.hp = b.enemy.maxHp;
});
let after = null;
for (let i = 0; i < 120; i++) {
  const p = await peek();
  if (p?.state === 8 || p?.state === 9) { after = p; break; }
  // Never press inside the command phase: a press that lands on the freshly opened list
  // confirms a command this check never chose, and the battle runs away. So the phase is
  // left the moment it is reached, and the press below re-reads the state first.
  if (p?.state === 2) { after = p; break; }
  if (!await readBattleLine(page, { timeout: 1200 })) {
    const q = await peek();
    if (q && q.state !== 2 && q.state !== 8 && q.state !== 9) await tap("Enter");
  }
  await page.waitForTimeout(150);
}
after = after ?? await peek();
if (after?.state === 2 && !after?.commandList?.active) {
  // The list builds on its own tick after the phase is armed.
  await page.waitForFunction(
    () => window.__battle?.peek?.()?.commandList?.active === true, null, { timeout: 10_000 },
  ).catch(() => {});
  after = await peek();
}
console.log("  after the lost turn", JSON.stringify({
  state: after?.state, list: after?.commandList, hp: after?.player?.hp,
  ehp: after?.enemy?.hp, gate: after?.frozenGate,
}));
expect(after?.state === 2 && after?.commandList?.active === true,
  `the partner's next turn opens the command list again (state ${after?.state}, list ${JSON.stringify(after?.commandList)})`);
expect(after?.frozenGate?.lost === false, "the gate rolled again and let the turn through");
await shot("frozen-03-next-turn-menu-open");

  if (errors.length) {
    console.log("page errors:", JSON.stringify(errors));
    problems.push(`${errors.length} page error(s)`);
  }
} catch (err) {
  console.error(err);
  problems.push(String(err?.message ?? err));
}

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log("\nbattle frozen: all checks passed");