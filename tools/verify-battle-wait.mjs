// Reach the battle command menu the way a player does: read the line first.
//
// A battle puts an opening line up ("Ambush!") and the original's battle controller does
// not arm the command menu until that line has been read. "Wait for the line, then open the
// command menu" is ONE script instruction in pro/wfightmn whose first act is to read the
// owner's message-line slot and return while it is still occupied (`wfightmn.s:1494-1496`;
// the arming `jal 0x80092d80` with the literal 2 is at `:1552-1556`, and the same wait sits
// in the other script's dispatch entry at `:1303-1305`). The walker holds the same rule on one
// predicate, `commandPhaseWaitsForLine` (web/battle.js), which `peek().waitsForLine` reads
// back out.
//
// The consequence for a headless check: waiting for the command menu without pressing Circle
// waits forever. This module is that press, written once. It taps the confirm bit (Enter / Space / Z are
// the pad's Cross -- `KEYBOARD_BINDINGS.cross` in engine/systems/input-map.ts) only while a line is
// actually waiting, so the press can never be spent confirming a row, and it then waits for the
// list to be built and reading the pad.
//
// The menu actor is born in state 0, which builds the widget and returns without reading the
// pad (`fightstg.s:17629-17649`, `commandMenuActorTick` in
// engine/dw3/ui/native/fight-command-menu.ts:176-183), so the press that reads the line cannot
// also pick a command. A check that then wants Fight or Tech to be chosen still has to press
// Circle again -- that is the original's own second press.
//
// Every wait below reads the battle module as `window.__battle ?? window.__battleTest`: the game
// page hands out `window.__battle`, the battle lab (`web/battle-test.html`) mounts the same
// `createBattle` object as `window.__battleTest` (web/battle-test.html:505). Both carry
// `isActive` and `peek`, so one helper serves the field checks and the lab checks.

/** The key that stands for the confirm bit (the pad's Cross), per `KEYBOARD_BINDINGS.cross`. */
export const CIRCLE_KEY = "Enter";

/** One Circle press: down long enough for the edge to be sampled, then up. */
export async function tapCircle(page, ms = 90) {
  await page.keyboard.down(CIRCLE_KEY);
  await page.waitForTimeout(ms);
  await page.keyboard.up(CIRCLE_KEY);
  await page.waitForTimeout(60);
}
/**
 * Whether the battle is showing a line that has not been read yet, in either of the two places
 * the original's own rule stops the turn.
 *
 * `messageLine.holdsTurn` is the walker's `msgHoldsTurn`: the timed action phases (the player's
 * action, the enemy's action, the result line) do not advance while a line is up, exactly as the
 * original's sequencer yields on the line's own object. `waitsForLine` is the command phase's own
 * stronger rule -- the menu is not even built beside a waiting line (`wfightmn.s:1494-1496`). A
 * check that has just confirmed a command meets the first one ("Kotemon attacks!"), a check that
 * has only just started a battle meets the second ("Ambush!").
 *
 * The predicate is written inline in both waits: `waitForFunction` ships the source to the page,
 * so it cannot close over anything in this module.
 */
const LINE_HELD_SRC = () => {
  const p = (window.__battle ?? window.__battleTest)?.peek?.();
  const m = p?.messageLine;
  return !!m?.active && !m.finished && (!!m.holdsTurn || !!p?.waitsForLine);
};

/**
 * Reads the line the battle is holding, the way a player does: wait until the battle is genuinely
 * holding an unread line, one Circle press, then wait until it lets the turn go.
 *
 * The press is spent on nothing else. It is only ever made while a line is up and unread, so it
 * can never be mistaken for the press that confirms a row.
 *
 * `timeout` is per wait. Returns false (rather than throwing) when no line was ever waiting,
 * which is the normal case for a caller that reaches a battle whose line is already read.
 */
export async function readBattleLine(page, opts = {}) {
  const { timeout = 30_000, releaseTimeout = 8_000 } = opts;
  const held = await page
    .waitForFunction(LINE_HELD_SRC, null, { timeout })
    .then(() => true, () => false);
  if (!held) return false;
  await tapCircle(page);
  // Let the line finish its last words and hand its turn back before looking again. The
  // bound is short on purpose: a press the game never accepted (the boot loader still owned
  // the driver slot) leaves the line standing, and proving that costs one timeout per battle.
  await page
    .waitForFunction(
      () => {
        const p = (window.__battle ?? window.__battleTest)?.peek?.();
        const m = p?.messageLine;
        return !(!!m?.active && !m.finished && (!!m.holdsTurn || !!p?.waitsForLine));
      },
      null,
      { timeout: releaseTimeout },
    )
    .catch(() => {});
  return true;
}
/**
 * Waits until the battle has reached its command phase with nothing holding it.
 *
 * This is the bare wait the original's rule makes necessary: the phase does not move off the
 * opening line until the player has read it, so `state === 2` alone never resolves without the
 * press. Use it where the check is about the walker's own phase, not the ported list.
 */
export async function waitForCommandPhase(page, opts = {}) {
  const { timeout = 30_000 } = opts;
  await page.waitForFunction(
    () => {
      const p = (window.__battle ?? window.__battleTest)?.peek?.();
      return p?.state === 2 && !p?.waitsForLine;
    },
    null,
    { timeout },
  );
}

/**
 * Waits until the command list is on screen and reading the pad.
 *
 * The battle boot loader owns the driver slot until it retires (`peek().loaderOpen`), and the
 * menu ignores presses until its first tick has built it (`peek().commandList.active`), so a
 * check that wants the list to answer anything has to wait for both to be past.
 */
export async function waitForCommandList(page, opts = {}) {  const { timeout = 30_000 } = opts;
  await page.waitForFunction(
    () => {
      const p = (window.__battle ?? window.__battleTest)?.peek?.();
      return p?.state === 2 && !!p?.commandList?.active && !!p?.loaderOpen === false;
    },
    null,
    { timeout },
  );
  // One more frame so the list's own state-0 tick has drawn the rows a caller is about to read.
  await page.waitForTimeout(120);
}

/**
 * "Is a battle line waiting to be read?" — the question `readBattleLine` presses on, asked with
 * a short budget so a battle that opens with NO line costs one poll instead of a long timeout.
 *
 * It stops as soon as the command phase is reached with nothing standing, because at that point
 * the original's opening sequence is over and there is provably nothing left to read.
 */
async function probeBattleLine(page, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const held = await page.evaluate(LINE_HELD_SRC);
    if (held) return true;
    const done = await page.evaluate(() => {
      const p = (window.__battle ?? window.__battleTest)?.peek?.();
      const m = p?.messageLine;
      return !!p?.state && p.state === 2 && !(m?.active && !m.finished);
    });
    if (done) return false;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(100);
  }
}

/**
 * Waits until the battle boot loader has retired.
 *
 * `pro/wfightmn`'s boot loader owns the driver slot until it retires: a Circle press sent
 * while it is still up is discarded, so the opening line it is holding never goes away and
 * the command phase never arms. The loader is also what `peek().loaderOpen` reads, and with
 * `?legacyWfight=1` it is never opened, so this wait returns at once there.
 */
export async function waitForLoaderRetired(page, opts = {}) {
  const { timeout = 30_000 } = opts;
  await page.waitForFunction(
    () => {
      const p = (window.__battle ?? window.__battleTest)?.peek?.();
      return !!p && p.loaderOpen === false;
    },
    null,
    { timeout, polling: 100 },
  );
}

/**
 * Waits for the battle, reads every line it puts up before the command menu, then waits for
 * the command list to be active.
 *
 * `timeout` is per wait, not for the whole sequence. `lines` bounds the presses (a battle that
 * opens with more than one line reads each of them; the bound only stops a check hanging on a
 * cycle it can never leave). `nativeList: false` waits only for the phase, for the checks that
 * deliberately run the walker's own list under a rollback switch -- there the ported list never
 * opens, and `commandList.active` would never be true.
 *
 * The loader is waited out FIRST, because a press sent before it retires is discarded: the
 * opening line stays up, and `readBattleLine`'s own "wait until it lets the turn go" then
 * spends its whole timeout proving a line that no press will ever move.
 *
 * `lineProbe` is the "IS a line waiting?" budget, and it is deliberately much shorter than
 * `timeout`. A battle that has no opening line at all must not cost `timeout` of dead wall
 * clock per battle; with eight battles in one check that alone reached five minutes. The probe
 * also ends the moment the command phase is reached with nothing holding it, so the no-line
 * case costs one poll.
 *
 * Returns a small read-out so a caller can assert on what it saw.
 */
export async function waitForCommandMenu(page, opts = {}) {
  const { timeout = 30_000, lines = 8, nativeList = true, lineProbe = 5_000 } = opts;

  await page.waitForFunction(() => !!(window.__battle ?? window.__battleTest)?.isActive?.(),
    null, { timeout });
  await waitForLoaderRetired(page, { timeout });

  let read = 0;
  for (; read < lines; read++) {
    if (!await probeBattleLine(page, lineProbe)) break;
    await readBattleLine(page, { timeout: lineProbe });
  }

  if (nativeList) await waitForCommandList(page, { timeout });
  else await waitForCommandPhase(page, { timeout });

  return page.evaluate((pressed) => {
    const p = (window.__battle ?? window.__battleTest)?.peek?.();
    return {
      linesRead: pressed,
      state: p?.state ?? null,
      waitsForLine: !!p?.waitsForLine,
      menu: p?.menu ?? null,
      chosen: window.__battleCmdNative?.diagnostics?.()?.chosen ?? null,
    };
  }, read);
}

/** One poll of the battle's own words: phase, line, who is speaking, and what is holding it. */
const TURN_SNAPSHOT_SRC = () => {
  const b = window.__battleB?.();
  const p = (window.__battle ?? window.__battleTest)?.peek?.();
  const m = p?.messageLine;
  if (!b) return { gone: true };
  return {
    state: b.state,
    msg: b.message ?? null,
    speaker: window.__battle?.debugFaceCam?.()?.speaker ?? null,
    // The walker's post-battle result pages (web/battle.js `state === RESULT_MSG &&
    // _resultPages.length`) own the pad themselves and are deliberately NOT in
    // `msgHoldsTurn`, so they need their own press once they are ready.
    pages: !!b._resultPages?.length,
    ready: !!b._resultReady,
    holds: !!m?.active && !m.finished && (!!m.holdsTurn || !!p?.waitsForLine),
    enemyMp: b.enemy?.mp ?? null,
    fled: !!b._enemyFled,
  };
};

/**
 * Lets a whole battle turn run to the player's command phase again, the way a player does:
 * read every line the fight puts up and turn every results page it pages.
 *
 * `until` stops the loop as soon as a snapshot satisfies it; `onSnapshot` is called once per
 * CHANGE of (phase, line, speaker), so a caller can sample the screen mid-turn without polling
 * it on its own. `ticks` bounds the loop: each tick is one poll plus one press or one 120ms
 * pause, so 200 ticks is under half a minute of wall clock — the bound is what keeps a check
 * that meets a state it cannot leave from running to its own harness cap.
 *
 * Returns the trail of snapshots it saw.
 */
export async function runBattleTurn(page, opts = {}) {
  const { ticks = 200, until = null, onSnapshot = null, pause = 120 } = opts;
  const trail = [];
  let last = null;
  for (let i = 0; i < ticks; i++) {
    const snap = await page.evaluate(TURN_SNAPSHOT_SRC);
    if (snap.gone) break;
    // `holds` is part of the key: a line can appear at one phase with nothing holding
    // it yet and be holding a frame later, and a caller sampling "the screen while a
    // line is up" has to see that frame.
    const key = `${snap.state}|${snap.msg}|${snap.speaker}|${snap.holds}`;
    if (key !== last) {
      last = key;
      trail.push(snap);
      if (onSnapshot) await onSnapshot(snap);
    }
    if (until?.(snap)) break;
    if (snap.holds) await readBattleLine(page, { timeout: 5_000 });
    else if (snap.state === 7 && snap.pages && snap.ready) await tapCircle(page);
    else await page.waitForTimeout(pause);
  }
  return trail;
}

/** The walker's command phase: `peek().state` 2 is ST.PLAYER_MENU (web/battle.js). */
export const COMMAND_PHASE = 2;