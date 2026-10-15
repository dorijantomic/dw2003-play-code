// tools/verify_finale_ending_chain.mjs — the finale win → ending chain → post-game return.
//
// WHAT THIS PROVES, AND AGAINST WHAT:
//   The Galacticmon finale's win does not open the battle-result screen. The win arm
//   (WFIGHTMN arm 4 phase 2, `F0x800a7c00`, `wfightmn.s:2165-2174`) reads the battle-kind
//   word: kind 6 takes launch code 0xE0B — STTITL mode 11 = movie row 10 = MOVIEE01_STR,
//   the ending movie — instead of 0x1400 (STFRPT), and suppresses the win jingle
//   (`wfightmn.s:3376-3384`). The ending rows chain through their own return selectors
//   (pro/stdwtitl.s:161-167, :212-218; engine/dw3/movie-destinations.ts):
//   0xE0B → row 10 MOVIEE01 → 0xE0C → row 11 MOVIEE02 → 0x2d7 = screen 727 = WSTAG780_PRO
//   = stage 780 (Kusanagi City Street Corner). The player lands where the disc lands;
//   the s780 reunion then advances the master ordinal 43 → 45 (wstag780.s .L0x1864-.L0x1870)
//   and the post-game world opens (the 55 alias records, fieldstg file 0xf460-0xf4ac).
//
// THE ROUTE (driven, not injected):
//   The finale battle is battle id 0x144 = screen 324 (Galacticmon ×3), and the disc
//   reaches it from s820's own scripted block. The block (pro/wstag820.s file 0x15f8, the
//   rate-0 zone) is [33, 324, 325, 326]; the bank-0x74 launcher indexes it. Event 1060's
//   completion hook (file 0xa14) arms 0x4074 and fires 0x7400 → record 0 = screen 33.
//   Event 1080's completion hook (file 0xa8c) writes the master ordinal 0x2b (43) AND
//   fires 0x7401 → record 1 = screen 324 — the finale. The walker runs that write through
//   the shared scene-completion port (engine/systems/scene-completion.ts): applySetFlag
//   sees bank 0x74, storyCommand answers {kind:'battle', index:1}, and the host queues
//   `pendingStoryBattleIndex`, which flushStoryBattle resolves against the stage's own
//   scripted block (`battle.scriptedScreen('s820', 1)` → 324).
//
//   So this check plays the real stage beat: boot s820 at the ordinal-41 gate, let the
//   arrival chain run event 1060 (the boss PRE), fight screen 33 (won through the
//   ordinary command menu; enemy HP is shortened to 1 only to keep the check bounded —
//   the win, its flags and everything after it come from the production code), let event
//   1070 (the POST) play, step into the act-2 cell (384,256) so the OnStep row fires event
//   1080, and watch the finale battle (324) start. Then win the finale: the tail falls,
//   the scripted beats play ("What! The body?!", the cannon to 1 HP, the head), the head
//   falls, and the win must exit through the ending chain — row 10 (MOVIEE01), row 11
//   (MOVIEE02), then the warp to s780. The movies are ended with the pad's START (a
//   decoded end arm, stdwtitl.s .L0x00000e88) so the check does not sit through ~2.5
//   minutes of stream; the rows themselves are asserted from the player's own diagnostics.
//   At s780 the reunion (event 1500) plays and the ordinal reaches 45; the post-game
//   world is then checked on the alias map the reunion lands on and on the three endgame
//   inns (s928/s946/s957).
//
// Run (the harness starts and stops its own server):
//   tools/run-playwright.sh tools/verify_finale_ending_chain.mjs [output-directory]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { tapCircle, COMMAND_PHASE } from "./verify-battle-wait.mjs";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.VERIFY_PORT) || 8779;
const ORIGIN = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] ?? "/tmp/finale-ending-chain");
mkdirSync(OUT, { recursive: true });

// ── the harness's own server ────────────────────────────────────────────────
const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", "web"],
  { cwd: ROOT_DIR, stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", stopServer);
async function waitForServer(url, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (r.ok || r.status === 404) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not come up on ${url}`);
}
await waitForServer(`${ORIGIN}/index.html`);

// ── fixtures ────────────────────────────────────────────────────────────────
// A level-99 party with maxed stats — the fixture the arena win check already uses.
// The finale's own scripted beats (the cannon to 1 HP) and the kind-6 fixed roll still
// govern the fight; the stats only keep the check's wall clock bounded.
const member = (digimonId) => ({
  digimonId, level: 99, xp: 0, tp: 10, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
  stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
  bonuses: {}, elemBonuses: {},
});
const PARTY = ["p003pken", "p005koet", "p004kogu"];

const browser = await chromium.launch({ headless: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const result = { stages: {}, errors: [] };

/** The FlagManager's `{bank: base64}` blob with one stored bit set (bank 0x40 = 512 bits). */
function engineFlagsWithBit(id) {
  const bank = (id >> 8) & 0xfe;
  const bit = id & 0x1ff;
  const bytes = new Uint8Array(64);
  bytes[bit >> 3] |= 1 << (bit & 7);
  return { [bank]: Buffer.from(bytes).toString("base64") };
}

/** One page booted at an ordinal with the party fixture. `extra.engineFlags` seeds the
 *  banked flag store (the FlagManager's `{bank: base64}` format) before the field loads. */
async function bootPage(ordinal, map, firedRows = [], extra = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => { result.errors.push(e.message); console.error("PAGEERROR", e.message); });
  const story = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/\[STORY\]|\[battle\]|\[field-movie\]|\[handoff\]|EVENT FIRED/.test(t)) story.push(t);
  });
  await page.addInitScript((seed) => {
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", seed.party[0]);
    localStorage.setItem("party", JSON.stringify(seed.party));
    localStorage.setItem("partnerStats", JSON.stringify(seed.member));
    localStorage.setItem("partyStats", JSON.stringify([seed.member, seed.member, seed.member]));
    localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
    localStorage.setItem("rosterOwned", "1");
    localStorage.setItem("bits", "1000");
    localStorage.setItem("progressOrdinal", String(seed.ordinal));
    localStorage.setItem("engineEvents", JSON.stringify(seed.firedRows));
    if (seed.engineFlags) localStorage.setItem("engineFlags", JSON.stringify(seed.engineFlags));
  }, { party: PARTY, member: member(39), ordinal, firedRows, engineFlags: extra.engineFlags ?? null });
  await page.goto(`${ORIGIN}/?skipTitle=1&map=${map}&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, { timeout: 40_000 });
  await page.waitForTimeout(600);
  // Record every sound the battle layer asks for, so the finale's suppressed win
  // jingle (`wfightmn.s:3376-3384`) is an observation rather than a claim.
  await page.evaluate(() => {
    window.__sfxLog = [];
    const play = window.__sfx.play.bind(window.__sfx);
    window.__sfx.play = (name) => { window.__sfxLog.push(name); return play(name); };
  });
  return { page, story };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const status = (page) => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  ord: window.__engine.state.vars.get("$story.ordinal"),
  battle: !!window.__battle?.isActive?.(),
  cutscene: window.__cutscene?.isActive?.() ?? false,
  textbox: window.__textbox?.isOpen?.() ?? false,
  movie: window.__fieldMovie?.()?.open === true,
}));
const holdEnter = async (page, ms = 220) => {
  await page.keyboard.down("Enter");
  await page.waitForTimeout(ms);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(120);
};
const tapStart = async (page) => { await page.keyboard.press("i"); await page.waitForTimeout(150); };

/**
 * Play a battle to its end through the ordinary command menu: at the command phase the
 * live enemy is shortened to 1 HP (the arena win check's own discipline), everything else
 * is the pad's confirm. Records the finale's kind-word walk and its result pages.
 */
async function playBattle(page, { label, maxMs = 240_000 }) {
  const trail = [];
  let last = "";
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => {
      const b = window.__battleB?.();
      if (!b || !window.__battle?.isActive?.()) return null;
      return {
        state: b.state,
        kind: b._finaleKind ?? null,
        phase: b._victoryPhase ?? null,
        enemy: b.enemy?.profile?.name ?? b.enemy?.name ?? null,
        enemyHp: b.enemy?.hp ?? null,
        playerHp: b.player?.hp ?? null,
        winLaunchCode: b._winLaunchCode ?? null,
        endingHosted: b._endingHosted ?? null,
        pages: (b._resultPages ?? []).map((p) => (typeof p === "string" ? p : p?.text ?? null)).filter(Boolean),
        msg: b.message ?? null,
        pageReady: !!b._resultReady,
        recordedTech: b._finaleRecordedTechId ?? 0,
        copiedAttack: b._finaleCopiedAttack ? true : false,
      };
    });
    if (!snap) break;
    const key = `${snap.state}|${snap.kind}|${snap.phase}|${snap.enemy}|${snap.pages.join(",")}|${snap.msg}`;
    if (key !== last) { last = key; trail.push(snap); }
    if (snap.phase === "pose" || snap.phase === "ending" || snap.phase === "report") break;
    if (snap.state === COMMAND_PHASE) {
      await page.evaluate(() => { const b = window.__battleB(); if (b?.enemy) b.enemy.hp = 1; });
      await tapCircle(page);
    } else if (snap.state === 11) {
      // A fallen active Digimon: the forced Tag screen. Confirm the replacement.
      await tapCircle(page);
      await page.waitForTimeout(120);
      await tapCircle(page);
    } else {
      await holdEnter(page, 160);
    }
    await page.waitForTimeout(50);
  }
  const final = await page.evaluate(() => {
    const b = window.__battleB?.();
    return b ? { phase: b._victoryPhase ?? null, winLaunchCode: b._winLaunchCode ?? null,
      endingHosted: b._endingHosted ?? null, active: !!window.__battle?.isActive?.() } : null;
  });
  log(label, "battle trail:", JSON.stringify(trail.map((s) => ({ st: s.state, kind: s.kind, enemy: s.enemy, php: s.playerHp, ehp: s.enemyHp }))));
  return { trail, final };
}

let page = null;
try {
  // ═══ STAGE 1 — s820: the PRE, the first fight (screen 33), the POST ═════════
  const booted = await bootPage(41, "s820");
  page = booted.page;
  const story = booted.story;
  await page.evaluate(() => { window.__gameSpeed = 8; });
  log("booted", JSON.stringify(await status(page)));

  let firstFight = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const st = await status(page);
    if (st.battle) {
      firstFight = await page.evaluate(() => {
        const b = window.__battleB?.();
        return { screenId: b?.screenId ?? null, specialMode: b?.specialMode ?? null };
      });
      break;
    }
    if (st.movie) await tapStart(page);
    else if (st.cutscene || st.textbox) await holdEnter(page);
    else await page.waitForTimeout(150);
  }
  await shot(page, "10-s820-fight33");
  assert.ok(firstFight, `the s820 beat's first fight must start (the PRE's 0x7400 launcher); story tail:\n  ${story.slice(-10).join("\n  ")}`);
  assert.equal(firstFight.screenId, 33, "the PRE launches record 0 = screen 33");
  result.stages.firstFight = firstFight;

  const sfxBeforeFirst = await page.evaluate(() => window.__sfxLog.length);
  const first = await playBattle(page, { label: "screen-33" });
  const firstJingles = await page.evaluate((n) => window.__sfxLog.slice(n).filter((s) => s === "w_jingle").length, sfxBeforeFirst);
  assert.ok(first.trail.some((s) => s.kind === null), "screen 33 is not the finale (no kind word)");
  assert.equal(firstJingles, 1, "an ordinary win plays the win jingle (wfightmn.s:3378-3382)");
  result.stages.firstFightWin = { jingles: firstJingles };

  // The win re-enters the field and the POST (event 1070) plays from the re-raised chain.
  const t1 = Date.now();
  while (Date.now() - t1 < 90_000) {
    const st = await status(page);
    if (!st.cutscene && !st.textbox && !st.battle) break;
    if (st.movie) await tapStart(page);
    else await holdEnter(page);
    await page.waitForTimeout(100);
  }
  log("POST settled", JSON.stringify(await status(page)));
  await shot(page, "12-s820-post");

  // ═══ STAGE 2 — event 1080 starts the finale battle (screen 324) ═════════════
  await page.evaluate(() => window.__tp(384, 256));
  await page.waitForTimeout(600);
  let finale = null;
  const t2 = Date.now();
  while (Date.now() - t2 < 150_000) {
    const st = await status(page);
    if (st.battle) {
      finale = await page.evaluate(() => {
        const b = window.__battleB?.();
        return {
          screenId: b?.screenId ?? null, specialMode: b?.specialMode ?? null,
          mapId: b?.mapId ?? null, partyLen: b?.party?.length ?? null,
          enemies: (b?.party ?? []).map((e) => e?.name ?? null),
          state: b?.state ?? null,
        };
      });
      break;
    }
    if (st.movie) await tapStart(page);
    else if (st.cutscene || st.textbox) await holdEnter(page);
    else await page.waitForTimeout(150);
  }
  log("finale battle:", JSON.stringify(finale));
  await shot(page, "13-finale-start");
  assert.ok(finale, `event 1080's completion must launch the finale battle (0x7401 → record 1); story tail:\n  ${story.slice(-14).join("\n  ")}`);
  assert.equal(finale.screenId, 324, "the finale battle is screen 324 (Galacticmon)");
  assert.equal(finale.specialMode, 4, "screen 324 selects battle mode 4 (WFIGHTMN's finale arm, wfightmn.s:1067)");
  assert.equal(finale.partyLen, 3, "the finale is the three-member gauntlet");
  result.stages.finaleBattle = finale;

  // ═══ STAGE 3 — win the finale: tail → beats → head → the kind-6 win ═════════
  const sfxBeforeFinale = await page.evaluate(() => window.__sfxLog.length);
  const fin = await playBattle(page, { label: "finale" });
  const finaleJingles = await page.evaluate((n) => window.__sfxLog.slice(n).filter((s) => s === "w_jingle").length, sfxBeforeFinale);
  // The pose runs for its authored cycle (or 3 s of game time); the win's exit arm then
  // reads the launch cue and hands the screen to the ending chain (battle.js:5708-5725).
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "ending", null, { timeout: 30_000 });
  const verdict = await page.evaluate(() => {
    const b = window.__battleB?.();
    return { phase: b?._victoryPhase ?? null, winLaunchCode: b?._winLaunchCode ?? null,
      endingHosted: b?._endingHosted ?? null, active: !!window.__battle?.isActive?.() };
  });
  await shot(page, "14-finale-verdict");

  const kinds = fin.trail.map((s) => s.kind).filter((k) => k != null);
  assert.ok(kinds.includes(5), `the tail's fall must write kind 5 (arm 18, wfightmn.s:3490-3494); saw kinds ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes(6), `the head beat must write kind 6 (arm 22, wfightmn.s:3786-3787); saw kinds ${JSON.stringify(kinds)}`);
  const pageTexts = fin.trail.flatMap((s) => s.pages);
  assert.ok(pageTexts.some((t) => /What! The body\?!/.test(t ?? "")), `the body beat's line must play; saw pages ${JSON.stringify(pageTexts)}`);
  assert.ok(fin.trail.some((s) => s.playerHp === 1), "the body's cannon must drop the active Digimon to 1 HP (fightstg.s:14416-14425)");
  assert.ok(fin.trail.some((s) => s.kind === 6 && s.enemy != null), "the head takes the field at kind 6");
  assert.equal(verdict.winLaunchCode, 0xe0b, "the kind-6 win's exit cue is 0xE0B (STTITL mode 11), not 0x1400 (wfightmn.s:2165-2174)");
  assert.equal(verdict.phase, "ending", "the win exits into the ending hand-off, not the battle-result screen");
  assert.equal(verdict.endingHosted, true, "the host claimed the ending chain");
  assert.equal(finaleJingles, 0, "the finale's win suppresses the win jingle (wfightmn.s:3376-3384)");
  result.stages.finaleWin = { kinds, winLaunchCode: verdict.winLaunchCode, jingles: finaleJingles, phase: verdict.phase, pageTexts };

  // ═══ STAGE 4 — the ending chain: MOVIEE01 → MOVIEE02 → stage 780 ════════════
  // Row 10, asserted from the movie object's own diagnostics while it is open, and
  // from the shared engine's own row table (movieRow) — the same function the chain used.
  const readMovie = (page) => page.evaluate(async () => {
    const d = window.__fieldMovie?.() ?? null;
    const engine = await import("./vendor/engine.js");
    return { diag: d, row: d ? engine.movieRow(d.code) : null };
  });
  await page.waitForFunction(() => {
    const d = window.__fieldMovie?.();
    return d?.open === true && d.code === 0xe0b;
  }, null, { timeout: 30_000 });
  const movie1 = await readMovie(page);
  await shot(page, "15-ending-movie1");
  assert.equal(movie1.row?.index, 10, "0xE0B names movie row 10 (the launch code's low byte minus one)");
  assert.equal(movie1.row?.file, "MOVIEE01_STR", "row 10 is the ending movie");
  assert.equal(movie1.row?.frames, 655, "row 10's own picture count (pro/stdwtitl.s .L0x00005060)");
  assert.equal(movie1.row?.destination, 0xe0c, "row 10's return selector is 0xE0C (row 11)");
  assert.equal(movie1.diag.file, "moviee01.mp4", "the shipped stream is the row's own disc file");
  assert.equal(movie1.diag.frames, 655, "the live movie object counts the row's own frames");
  assert.equal(movie1.diag.destination, "0xe0c", "and carries the row's own return selector");
  await tapStart(page); // the pad's START ends the movie (a decoded end arm)

  await page.waitForFunction(() => {
    const d = window.__fieldMovie?.();
    return d?.open === true && d.code === 0xe0c;
  }, null, { timeout: 30_000 });
  const movie2 = await readMovie(page);
  await shot(page, "16-ending-movie2");
  assert.equal(movie2.row?.index, 11, "0xE0C names movie row 11");
  assert.equal(movie2.row?.file, "MOVIEE02_STR", "row 11 is the second ending movie");
  assert.equal(movie2.row?.frames, 1649, "row 11's own picture count (pro/stdwtitl.s .L0x0000506c)");
  assert.equal(movie2.row?.destination, 0x2d7, "row 11's return selector is 0x2d7 = screen 727");
  assert.equal(movie2.diag.file, "moviee02.mp4", "the shipped stream is the row's own disc file");
  assert.equal(movie2.diag.destination, "0x2d7", "and carries the row's own return selector");
  await tapStart(page);

  // The chain then routes 0x2d7 through the shared screen router: screen 727 is
  // WSTAG780_PRO = stage 780, and the field transition lands there.
  await page.waitForFunction(() => {
    const s = window.__state;
    return s && s.manifest.maps[s.mapIdx].id === "s780";
  }, null, { timeout: 45_000 });
  await page.waitForTimeout(600);
  const landing = await status(page);
  log("landed after the ending chain", JSON.stringify(landing));
  await shot(page, "17-landed-s780");
  assert.equal(landing.map, "s780", "the ending chain lands on stage 780 (0x2d7 = screen 727 = WSTAG780_PRO)");
  assert.equal(landing.ord, 43, "the finale win happens at the ordinal the s820 beat wrote (43)");
  assert.equal(landing.battle, false, "the win's battle closed (finishEnding) after the chain");
  // The cannon's 1 HP reached the stored party: endBattle ran writeBackBattleVitals
  // (web/battle.js:1112-1122) when the chain closed the win. The post-game arrival
  // event's 0x7053 write (a full heal) is asserted against exactly this value in stage 5.
  const hpAfterWin = await page.evaluate(() => ({
    hp: window.__state.partnerStats?.hp ?? null,
    maxHp: window.__state.partnerStats?.maxHp ?? null,
  }));
  result.stages.finaleWin.hpAfterWin = hpAfterWin;
  result.stages.endingChain = {
    movie1: { code: movie1.diag.code, file: movie1.diag.file, row: movie1.row },
    movie2: { code: movie2.diag.code, file: movie2.diag.file, row: movie2.row },
    landing,
  };

  // ═══ STAGE 5 — the reunion (43 → 45) and the post-game route it opens ═══════
  // The s780 reunion (event 1500) plays on arrival at ordinal 43; its completion writes
  // 45 and hands off 0xE03 = movie row 2, whose return selector is 0x276 at ordinal 45
  // (stdwtitl.s .L0x00001144-.L0x00001198) → screen 630 → the alias stage s925. s925's
  // own arrival event 1600 then plays its cutscene and hands off 627 → the alias stage
  // s923 at 45 (that is the post-game route's own next beat).
  await page.evaluate(() => { window.__gameSpeed = 8; });
  let landing925 = null, final923 = null;
  const t5 = Date.now();
  while (Date.now() - t5 < 240_000) {
    const st = await status(page);
    if (st.map === "s925" && !landing925) {
      landing925 = await page.evaluate(() => ({
        map: window.__state.manifest.maps[window.__state.mapIdx].id,
        ord: window.__engine.state.vars.get("$story.ordinal"),
        npcs: (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id),
      }));
      log("landed s925", JSON.stringify(landing925));
      await shot(page, "18-postgame-s925");
    }
    if (st.map === "s923" && !st.cutscene && !st.textbox && !st.battle) {
      final923 = await page.evaluate(() => ({
        map: window.__state.manifest.maps[window.__state.mapIdx].id,
        ord: window.__engine.state.vars.get("$story.ordinal"),
        battle: !!window.__battle?.isActive?.(),
        npcs: (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id),
        flag40cd: window.__engine.state.flags.get(16589) === true,   // 0x40CD, set by s925's event 1600
        leadHp: window.__state.partnerStats?.hp ?? null,
        leadMaxHp: window.__state.partnerStats?.maxHp ?? null,
        events: JSON.parse(localStorage.getItem("engineEvents") || "[]"),
      }));
      break;
    }
    if (st.movie) await tapStart(page);
    else if (st.cutscene || st.textbox) await holdEnter(page);
    else await page.waitForTimeout(120);
  }
  await shot(page, "19-postgame-s923");
  assert.ok(landing925, `the s780 reunion must advance the ordinal to 45 and hand off to s925; status ${JSON.stringify(await status(page))}`);
  assert.equal(landing925.map, "s925", "the reunion hands off to the post-game alias of screen 630 (0x276 → s925 at ordinal 45)");
  assert.equal(landing925.ord, 45, "the post-game marker is exactly 45");
  assert.ok(final923, "s925's arrival event 1600 must play and hand off (627 → s923 at ordinal 45)");
  assert.equal(final923.map, "s923", "event 1600's own HANDOFF 627 resolves to its alias s923 at ordinal 45");
  assert.equal(final923.ord, 45, "the post-game marker is still 45");
  assert.equal(final923.battle, false, "no battle is left running");
  // The alias map's own arrival event (s925 event 1600) fired: it stores 0x40CD and runs
  // 0x7053 — the bank-0x70 full-heal action (roster_predicate_table record 83, op 24,
  // `heal_active_party`), so the party the cannon left at 1 HP is restored on arrival.
  assert.ok(final923.flag40cd, "s925's arrival event 1600 wrote 0x40CD");
  assert.equal(hpAfterWin.hp, 1, "the body's cannon reached the stored party (1 HP written back at the battle's end)");
  assert.equal(final923.leadHp, final923.leadMaxHp, "s925's arrival event ran 0x7053 (full heal) — the post-game event's own write");
  assert.ok(final923.events.includes("s780.auto.1500"), "the reunion is recorded as seen (once bit)");
  assert.ok(final923.events.includes("s925.auto.1600"), "s925's arrival event is recorded as seen (once bit)");
  result.stages.postGame = { landing925, final923 };
  await page.close();

  // ═══ STAGE 6a — the endgame cast gate on the alias map ══════════════════════
  // s925's cast list gates the PLAYER-CANDIDATE record (actor id 1, a member of the
  // cast system's player set {1, 0x6a, 0x146, 0x147}) on `0x40CD == 0`, and leaves the
  // ordinary actor 13 ungated (engine/systems/cast-list.ts loop A/B). The post-game state
  // a save carries after event 1600 has the flag set, so the arrival variant is retired
  // and the player falls back to the default actor (2). The once bit is seeded so the
  // arrival event does not replay.
  const gateLegs = [];
  for (const flagSet of [false, true]) {
    const l = await bootPage(45, "s925", ["s925.auto.1600"],
      flagSet ? { engineFlags: engineFlagsWithBit(16589) } : {});
    await l.page.waitForTimeout(500);
    const cast = await l.page.evaluate(() => ({
      playerCharOne: window.__state.playerCharOne === true,
      npcs: (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id),
    }));
    gateLegs.push({ flag40cd: flagSet, ...cast });
    await shot(l.page, `20-castgate-s925-${flagSet ? "set" : "clear"}`);
    await l.page.close();
  }
  log("cast gate legs", JSON.stringify(gateLegs));
  assert.ok(gateLegs[0].playerCharOne, `with 0x40CD clear, s925's cast builds the player as actor 1; saw ${JSON.stringify(gateLegs[0])}`);
  assert.ok(!gateLegs[1].playerCharOne, `with 0x40CD set, the candidate is retired and the player falls back to actor 2; saw ${JSON.stringify(gateLegs[1])}`);
  assert.ok(gateLegs[1].npcs.includes(13), `s925's ungated actor (npc 13) stays; saw ${JSON.stringify(gateLegs[1].npcs)}`);
  result.stages.castGate = gateLegs;

  // ═══ STAGE 6b — the endgame inns on the alias stages (s928/s946/s957) ═══════
  // The inn screen resolves its record from the CURRENT SCREEN ID the alias stage shares
  // with its base (engine/dw3/inn.ts INN_ALIAS_STAGES): s928 → 633 (Armaterasu Inn, 52),
  // s946 → 658 (Forest Inn, 56), s957 → 669 (Qing Long Inn, 60). The producer is the
  // innkeeper (npc 20), whose dialogue on_close writes the same bank-0x7A index its base
  // map's innkeeper carries (0x7A28/0x7A29/0x7A2A).
  const INN_LEGS = [
    { stage: "s928", npc: 20, name: "Armaterasu Inn", price: 52 },
    { stage: "s946", npc: 20, name: "Forest Inn", price: 56 },
    { stage: "s957", npc: 20, name: "Qing Long Inn", price: 60 },
  ];
  const innResults = [];
  for (const leg of INN_LEGS) {
    const l = await bootPage(45, leg.stage);
    await l.page.evaluate(() => { window.__gameSpeed = 4; });
    const placed = await l.page.evaluate((npcId) => {
      const st = window.__state;
      const n = (window.__npcsHere?.() ?? []).find((x) => (x.npc_id ?? x.id) === npcId);
      if (!n) return null;
      st.x = n.x; st.y = n.y + 24; st.dir = "up"; st.moving = false;
      return { x: n.x, y: n.y };
    }, leg.npc);
    assert.ok(placed, `${leg.stage}: the innkeeper (npc ${leg.npc}) must be in the alias scene`);
    await l.page.waitForTimeout(400);
    // Talk, then page the line closed — that close is where the bank-0x7A write lands.
    // The name/price are read from whichever inn factory is live: the translated adapter
    // keeps the resolved record (`_record`, web/inn-translated.js), the legacy one the
    // name/price pair (web/inn.js).
    let opened = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const inn = await l.page.evaluate(() => {
        const i = window.__inn;
        return {
          open: i?.isOpen?.() === true,
          name: i?._record?.name ?? i?._innName ?? null,
          price: i?._record?.pricePerDigimon ?? i?._price ?? null,
          textbox: window.__textbox?.isOpen?.() ?? false,
        };
      });
      if (inn.open && inn.name != null) { opened = true; innResults.push({ stage: leg.stage, ...inn }); break; }
      if (inn.textbox) await holdEnter(l.page, 160);
      else {
        // Nudge toward the innkeeper and press confirm (the talk edge).
        await l.page.evaluate((npcId) => {
          const st = window.__state;
          const n = (window.__npcsHere?.() ?? []).find((x) => (x.npc_id ?? x.id) === npcId);
          if (n) { st.x = n.x; st.y = n.y + 24; st.dir = "up"; }
        }, leg.npc);
        await holdEnter(l.page, 200);
      }
      await l.page.waitForTimeout(150);
    }
    await shot(l.page, `20-inn-${leg.stage}`);
    assert.ok(opened, `${leg.stage}: the innkeeper's talk must open the rest screen (bank-0x7A launcher)`);
    const rec = innResults[innResults.length - 1];
    assert.equal(rec.name, leg.name, `${leg.stage}: the alias stage opens its base screen's record (${leg.name})`);
    assert.equal(rec.price, leg.price, `${leg.stage}: the record's own price (${leg.price})`);
    await l.page.close();
  }
  result.stages.inns = innResults;
  log("inns", JSON.stringify(innResults));

  assert.deepEqual(result.errors, [], "no page errors");
  writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
  console.log("RESULT", JSON.stringify({
    ok: true,
    finale: result.stages.finaleBattle,
    win: result.stages.finaleWin,
    chain: {
      movie1: result.stages.endingChain.movie1.file,
      movie2: result.stages.endingChain.movie2.file,
      landing: result.stages.endingChain.landing,
    },
    post: result.stages.postGame,
    castGate: result.stages.castGate,
    inns: innResults,
  }));
} catch (e) {
  if (page) await shot(page, "99-failure").catch(() => {});
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/failure.json`, JSON.stringify({ ...result, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
  stopServer();
}
