// tools/verify_postgame_world.mjs — the post-game world past the reunion, driven end to end.
//
// WHAT THIS PROVES, AND AGAINST WHAT:
//   The finale/rig work settled how the story ENTERS the post-game (ordinal 45, the
//   s780 reunion, the alias flip). This check drives what the disc's own post-game
//   world then DOES, from the state the reunion leaves the player in, and asserts every
//   beat against the raw overlay decode and the shipped extracted data:
//
//   1. THE ENTRY CHAIN. s780's reunion (event 1500) writes ordinal 45 and hands off
//      0xE03 = STTITL mode 3 = movie row 2 = MOVIED01_STR (465 frames; row at
//      pro/stdwtitl.s .L0x00005000), whose return selector at ordinal 0x2d is re-pointed
//      from its tabled 0x0207 to 0x276 (stdwtitl.s .L0x00001144-.L0x00001198) — screen
//      630, the alias record {base 226, alt 925}. Landing on s925, its arrival event
//      1600 (wstag925.s file 0x100/0x114 writes 0x40CD + 0x7053) plays and hands off
//      HANDOFF 627 -> the alias of screen 627 {base s211, alt s923}. The native save
//      screen opening on the way proves nothing here; the heal does: the 0x7053 write
//      runs roster action 83 (`heal_active_party`), so a 1-HP party is full on arrival.
//      The MOVIED01 STREAM ships (web/assets/movie/movied01.mp4, disc file 2026: 480
//      stream pictures, the row counts 465) and the handoff path PLAYS it before the
//      warp — the movie phase is asserted below (row 2, MOVIED01_STR, movied01.mp4,
//      playing), then ended with the pad's START (a decoded end arm) to keep the drive
//      bounded. Before the fix the same drive saw no movie phase at all.
//
//   2. THE FOUR AMATERASU LEADERS (POST_GAME_WALKTHROUGH quest a). Each of the four
//      endgame tamer challenges is one NPC dialogue state gated on virtual flag 0x7096
//      = collection_all over item ids 105/119/131/144/156 (Muramasa, SuperNova,
//      Punishment, Eternally, Invincible — the walkthrough's "5 Epic Items"), whose
//      on_close writes its own bank-0x10 bit plus a bank-0x74 launcher record:
//        s956 npc 143 (352,234) -> 0x100d + 0x7400 -> record 0 = screen 305
//        s949 npc 144 (1073,145) -> 0x100e + 0x7400 -> record 0 = screen 306
//        s949 npc 145 (520,220) -> 0x100f + 0x7401 -> record 1 = screen 307
//        s954 npc 146 (924,323) -> 0x1010 + 0x7400 -> record 0 = screen 308
//      (raw lists: wstag956.s .L0x000002c8-.L0x000002e8, wstag949.s .L0x000005b8-.L0x00000604,
//      wstag954.s .L0x0000053c-.L0x0000055c; screens: stage_encounters zone block 3 slots).
//      The negative leg proves the 0x7096 gate: without the five items the leader only
//      says its refusal line and starts nothing.
//
//   3. THE ARENA FINALE (the World Champion, quest a's end). 0x7054 is virtual:
//      stored-bits-all-set over 0x100d..0x1010. With it true, s926 npc 32's dialogue
//      state 1 (estalk08[40]) writes 0x906f on close, which the bank-0x90 launcher
//      turns into event 1606 (HANDOFF 632 -> alias s927, the arena floor's story
//      variant). s927's arrival gate picks event 1608 on 0x100c == 0; its completion
//      writes 0x100c and fires 0x7400 = record 0 = screen 262 (Datamon/Bulbmon/
//      Armageddemon), with won flag 4663. The win re-chains the POST row 1610 and its
//      HANDOFF 631 returns to the desk (s926), where the receptionist now shows
//      estalk08[41] (0x100c == 1).
//
//   4. THE ENDGAME INNS AND SAVE POINTS. s928/s946/s957 carry innkeeper NPC 20, whose
//      dialogue opens the inn its base screen owns (INN_ALIAS_STAGES: 928->633 Armaterasu
//      Inn 52, 946->658 Forest Inn 56, 957->669 Qing Long Inn 60). s928/s946 npc 21
//      (Guardromon) writes the bank-0x90 bit whose event (1612/1648) ends `HANDOFF
//      3082/3083` — the native save screen at save-point slots 10/11.
//
// Run (the harness starts and stops its own server):
//   tools/run-playwright.sh tools/verify_postgame_world.mjs [output-directory]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { tapCircle, COMMAND_PHASE } from "./verify-battle-wait.mjs";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.VERIFY_PORT) || 8783;
const ORIGIN = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] ?? "/tmp/postgame-world");
mkdirSync(OUT, { recursive: true });

// ── static data for the assertions that must not come from the browser ──────
const WSTAG_EVENTS = JSON.parse(readFileSync(
  new URL("../web/assets/events/wstag_events.json", import.meta.url)));
const TALK_BINDINGS = JSON.parse(readFileSync(
  new URL("../web/assets/data/talk_launch_bindings.json", import.meta.url)));
const encountersAt = (stage) => JSON.parse(readFileSync(
  new URL("../web/assets/data/stage_encounters.json", import.meta.url))).stages[stage];

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
// A level-99 party — the fixture the arena win check already uses. `digimonId` is
// the NUMERIC digimon id (39 = Kotemon): getPlayerProfile reads
// partnerStats.digimonId into digimonDB, so a sprite-name string there silently
// blocks every battle (web/battle.js getPlayerProfile).
const member = (hp) => ({
  digimonId: 39, level: 99, xp: 0, tp: 10, hp, maxHp: 9999, mp: 9999, maxMp: 9999,
  stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
  bonuses: {}, elemBonuses: {},
});
const PARTY = ["p003pken", "p005koet", "p004kogu"];
// The five Epic Items the leaders' 0x7096 gate counts (collection ids; items.json).
const EPIC_WEAPONS = [105, 119, 131, 144, 156]; // Muramasa, SuperNova, Punishment, Eternally, Invincible

const browser = await chromium.launch({ headless: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const result = { legs: {}, errors: [] };

/** The FlagManager's `{bank: base64}` blob with the given stored bits set. */
function engineFlagsWithBits(ids) {
  const banks = {};
  for (const id of ids) {
    const bank = (id >> 8) & 0xfe;
    const bit = id & 0x1ff;
    const bytes = banks[bank] ? Buffer.from(banks[bank], "base64") : Buffer.alloc(64);
    bytes[bit >> 3] |= 1 << (bit & 7);
    banks[bank] = bytes.toString("base64");
  }
  return banks;
}

/** One page booted at an ordinal with the party fixture. `extra.inventory` seeds the
 *  item bag; `extra.engineFlags` seeds the banked flag store before the field loads. */
async function bootPage(ordinal, map, firedRows = [], extra = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => { result.errors.push(e.message); console.error("PAGEERROR", e.message); });
  const story = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/\[STORY\]|\[battle\]\[|\[handoff\]|TALK EVENT|EVENT FIRED|WARP \(event/.test(t)) story.push(t);
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
    if (seed.inventory) localStorage.setItem("inventory", JSON.stringify(seed.inventory));
  }, {
    party: PARTY, member: member(extra.hp ?? 9999), ordinal, firedRows,
    engineFlags: extra.engineFlags ?? null, inventory: extra.inventory ?? null,
  });
  await page.goto(`${ORIGIN}/?skipTitle=1&map=${map}&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, { timeout: 40_000 });
  await page.waitForTimeout(600);
  return { page, story };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
// POSTGAME_ONLY=entry|leaders|arena|inns runs one leg only (fast iteration on the
// movie leg); unset runs the whole world, as before.
const ONLY = (process.env.POSTGAME_ONLY ?? "").trim();
const want = (leg) => ONLY === "" || ONLY === leg;
const status = (page) => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  ord: window.__engine.state.vars.get("$story.ordinal"),
  battle: !!window.__battle?.isActive?.(),
  cutscene: window.__cutscene?.isActive?.() ?? false,
  textbox: window.__textbox?.isOpen?.() ?? false,
  movie: window.__fieldMovie?.()?.open === true,
  text: (() => {
    const d = window.__textbox?.dialogue;
    if (!d) return "";
    if (d.pages) return d.pages.flat().join(" ").replace(/\s+/g, " ");
    return JSON.stringify(d).replace(/\s+/g, " ");
  })(),
}));
const holdEnter = async (page, ms = 220) => {
  await page.keyboard.down("Enter");
  await page.waitForTimeout(ms);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(120);
};
const tapStart = async (page) => { await page.keyboard.press("i"); await page.waitForTimeout(150); };

/** Press through cutscene/textbox/movie until `until()` is true. */
async function pressThrough(page, until, { deadlineMs = 90_000, label = "" } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (await until()) return true;
    const st = await page.evaluate(() => ({
      textbox: window.__textbox?.isOpen?.() ?? false,
      cutscene: window.__cutscene?.isActive?.() ?? false,
      movie: window.__fieldMovie?.()?.open === true,
    }));
    if (st.movie) await tapStart(page);
    else if (st.textbox || st.cutscene) await holdEnter(page, 200);
    else await page.waitForTimeout(120);
  }
  const ok = await until();
  if (!ok) log(`pressThrough(${label}) timed out`);
  return ok;
}

/** Place the player below an NPC facing up (the talk probe's own reach). */
async function faceNpc(page, npcId) {
  return page.evaluate((id) => {
    const st = window.__state;
    const n = (window.__npcsHere?.() ?? []).find((x) => (x.npc_id ?? x.id) === id);
    if (!n) return null;
    st.x = n.x; st.y = n.y + 24; st.dir = "up"; st.moving = false;
    return { x: n.x, y: n.y };
  }, npcId);
}

/** Tap confirm until the talk box opens; returns the shown text. */
async function talkTo(page, npcId, { deadlineMs = 20_000 } = {}) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const st = await status(page);
    if (st.textbox) return st.text;
    await faceNpc(page, npcId);
    await holdEnter(page, 200);
    await page.waitForTimeout(120);
  }
  return null;
}

/** Close the open talk box (and any cutscene it starts) — one Enter at a time. */
async function closeBox(page, { deadlineMs = 20_000 } = {}) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const st = await status(page);
    if (!st.textbox && !st.cutscene) return true;
    await holdEnter(page, 200);
  }
  return false;
}

/** Fight to the end through the ordinary menu; the live enemy is shortened to 1 HP
 *  only to keep the check bounded (the arena checks' own discipline). */
async function winBattle(page, { label, maxMs = 150_000 } = {}) {
  const deadline = Date.now() + maxMs;
  let guard = 0;
  while (Date.now() < deadline && guard++ < 4000) {
    const st = await page.evaluate(() => {
      const b = window.__battleB?.();
      return {
        active: !!window.__battle?.isActive?.(),
        state: b?.state ?? null,
        report: window.__reportNative?.isOpen?.() === true,
      };
    });
    if (!st.active) { log(label, "battle closed"); return true; }
    if (st.report) { await holdEnter(page, 260); continue; }
    if (st.state === COMMAND_PHASE) {
      await page.evaluate(() => { const b = window.__battleB(); if (b?.enemy) b.enemy.hp = 1; });
    }
    await holdEnter(page, 180);
  }
  const active = await page.evaluate(() => !!window.__battle?.isActive?.());
  if (active) log(label, "battle still active at deadline");
  return !active;
}

/** The fired-event / once-bit list a save carries. */
const savedEvents = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem("engineEvents") || "[]"));

let page = null;
try {
  // ═══ STATIC — the data behind every drive below ════════════════════════════
  {
    const w = (stage, id) => WSTAG_EVENTS[stage].find((e) => e.id === id);
    assert.equal(w("s780", 1500).disasm.at(-2), "HANDOFF 3587 0 0 1",
      "s780's reunion ends in the 0xE03 handoff (MOVIED01's launch code)");
    assert.equal(w("s925", 1600).disasm.at(-2), "HANDOFF 627 730 382 1",
      "s925's arrival event hands off screen 627 (the s211 row)");
    assert.ok(WSTAG_EVENTS.s925[0].disasm.includes("FN6B 1 286 295"),
      "s925 event 1600 is the Login Room cutscene (wstag925.s file 0x804)");
    assert.equal(w("s928", 1612).disasm.at(-1), "HANDOFF 3082 0 0 0",
      "s928's save event ends in save-point handoff 3082 (slot 10)");
    assert.equal(w("s946", 1648).disasm.at(-1), "HANDOFF 3083 0 0 0",
      "s946's save event ends in save-point handoff 3083 (slot 11)");
    // The four challenge battles' screens: the scripted block's record slots.
    assert.deepEqual(encountersAt("956").zones[3].slots.slice(0, 1), [305], "s956 record 0 -> 305");
    assert.deepEqual(encountersAt("949").zones[3].slots.slice(0, 2), [306, 307], "s949 records 0/1 -> 306/307");
    assert.deepEqual(encountersAt("954").zones[3].slots.slice(0, 1), [308], "s954 record 0 -> 308");
    assert.deepEqual(encountersAt("927").zones[3].slots.slice(0, 1), [262], "s927 record 0 -> 262");
    // The talk-launch bindings behind the desk and the save points.
    const bind = (stage, npc, state) => TALK_BINDINGS.stages[stage]
      .find((b) => b.npc === npc && b.state === state);
    assert.deepEqual([bind("s926", 32, 1).event, bind("s926", 32, 1).bit], [1606, 111],
      "the arena reception's close launches event 1606 through bit 111");
    assert.deepEqual([bind("s928", 21, 0).event, bind("s928", 21, 0).bit], [1612, 112],
      "s928 Guardromon launches event 1612 through bit 112");
    assert.deepEqual([bind("s946", 21, 0).event, bind("s946", 21, 0).bit], [1648, 122],
      "s946 Guardromon launches event 1648 through bit 122");
    result.legs.static = { ok: true };
  }

  // ═══ LEG 1 — the entry chain: reunion -> MOVIED01 routing -> s925 -> s923 ══
  log("LEG 1: s780 reunion at 43 -> s925 -> s923");
  {
    const booted = await bootPage(43, "s780", ["s780.auto.0"], { hp: 1 });
    page = booted.page;
    const story = booted.story;
    await page.evaluate(() => { window.__gameSpeed = 8; });

    // The reunion cutscene plays on arrival; press it through to the handoff.
    const movieBefore = await page.evaluate(() => window.__fieldMovie?.() ?? null);
    // The handoff now PLAYS MOVIED01 (row 2) before the warp: stop as soon as the
    // movie phase opens (or at s925, as before, if the fix regresses to a skip).
    const movieOr925 = await pressThrough(page, async () => {
      const st = await status(page);
      return st.map === "s925" || st.movie;
    }, { deadlineMs: 120_000, label: "reunion->movie-or-s925" });
    const moviePhase = await page.evaluate(() => window.__fieldMovie?.() ?? null);
    assert.ok(moviePhase?.open === true,
      `the reunion's HANDOFF 0xE03 must play MOVIED01 (row 2) before the warp; ` +
      `movie phase not seen — fieldMovie=${JSON.stringify(moviePhase)}; story tail:\n  ${story.slice(-12).join("\n  ")}`);
    // Bound the movie phase (the speed hack sub-steps the movie too) and wait for the
    // shipped stream to actually decode in the page before reading the pins.
    await page.evaluate(() => { window.__gameSpeed = 2; });
    await page.waitForFunction(() => {
      const d = window.__fieldMovie?.();
      return d?.open === true && d.readyState >= 2 && d.paused === false;
    }, null, { timeout: 30_000 });
    const moviePins = await page.evaluate(async () => {
      const d = window.__fieldMovie?.() ?? null;
      const engine = await import("./vendor/engine.js");
      return { diag: d, row: d ? engine.movieRow(d.code) : null,
               returnsPostGame: d ? engine.movieReturnScreen(d.code, true) : null };
    });
    assert.equal(moviePins.diag.code, 0xe03, "the movie opened for the handoff's own launch code");
    assert.equal(moviePins.row?.index, 2, "0xE03 names movie row 2");
    assert.equal(moviePins.row?.file, "MOVIED01_STR", "row 2 is MOVIED01_STR");
    assert.equal(moviePins.row?.fileIndex, 2026, "MOVIED01 is disc file 2026");
    assert.equal(moviePins.row?.frames, 465, "row 2's own picture count — the player's end");
    assert.equal(moviePins.diag.frames, 465, "the live movie object counts the row's own 465");
    assert.equal(moviePins.diag.destination, "0x207", "the row's tabled return selector");
    assert.equal(moviePins.returnsPostGame, 0x276, "at ordinal 45 the return is 0x276 (screen 630 -> s925)");
    assert.equal(moviePins.diag.file, "movied01.mp4", "the shipped stream is the row's own disc file");
    assert.equal(moviePins.diag.width, 320, "the stream decodes at the STR's own 320x416");
    assert.equal(moviePins.diag.height, 416);
    // Let real pictures play (not just the object state) before the pad's START.
    await page.waitForFunction(() => (window.__fieldMovie?.()?.pictures ?? 0) >= 5, null, { timeout: 30_000 });
    const played = await page.evaluate(() => window.__fieldMovie?.() ?? null);
    await shot(page, "00-postgame-entry-movied01");
    assert.ok(played.pictures >= 5, `the movie must actually play pictures; saw ${played.pictures}`);
    await tapStart(page); // the pad's START ends the movie (a decoded end arm)
    const movieEnd = await page.evaluate(() => window.__fieldMovie?.() ?? null);
    assert.equal(movieEnd.open, false, "START ended the movie");
    assert.ok(["start", "last-picture"].includes(movieEnd.endReason),
      `a decoded end arm ended it; saw ${movieEnd.endReason}`);

    const arrived925 = await pressThrough(page, async () => {
      const st = await status(page);
      return st.map === "s925";
    }, { deadlineMs: 120_000, label: "movie->s925" });
    const fired = story.filter((t) => t.includes("EVENT FIRED")).map((t) => t.split("EVENT FIRED ")[1]?.split(" ")[0]);
    assert.ok(arrived925, `the reunion's HANDOFF 0xE03 must land on its post-game alias s925; fired ${JSON.stringify(fired)}; story tail:\n  ${story.slice(-12).join("\n  ")}`);
    const st925 = await status(page);
    assert.equal(st925.ord, 45, "the reunion wrote ordinal 45 before the handoff");
    await shot(page, "01-postgame-entry-s925");

    // The MOVIED01 row, read from the engine's own generated table in the page.
    const movie = await page.evaluate(async () => {
      const engine = await import("./vendor/engine.js");
      const row = engine.movieRow(0xe03);
      return {
        row, returnsPostGame: engine.movieReturnScreen(0xe03, true),
        returnsBase: engine.movieReturnScreen(0xe03, false),
        field: window.__fieldMovie?.() ?? null,
      };
    });
    assert.equal(movie.row?.index, 2, "0xE03 names movie row 2");
    assert.equal(movie.row?.file, "MOVIED01_STR", "row 2 is MOVIED01_STR");
    assert.equal(movie.row?.fileIndex, 2026, "MOVIED01 is disc file 2026");
    assert.equal(movie.row?.frames, 465, "row 2's own picture count");
    assert.equal(movie.row?.destination, 0x207, "row 2's tabled return selector");
    assert.equal(movie.returnsPostGame, 0x276, "at ordinal 45 the return is 0x276 (screen 630 -> the {226, alt 925} row)");
    assert.equal(movie.returnsBase, 0x207, "below 45 the row's own destination is kept");

    // s925's arrival event 1600 plays and hands off 627 -> the alias of s211.
    const arrived923 = await pressThrough(page, async () => {
      const st = await status(page);
      return st.map === "s923";
    }, { deadlineMs: 120_000, label: "s925->s923" });
    assert.ok(arrived923, `s925's event 1600 must hand off (627 -> s923); story tail:\n  ${story.slice(-14).join("\n  ")}`);
    await page.waitForTimeout(700);
    const st923 = await page.evaluate(() => ({
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
      ord: window.__engine.state.vars.get("$story.ordinal"),
      flag40cd: window.__engine.state.flags.get(16589) === true,
      leadHp: window.__state.partnerStats?.hp ?? null,
      leadMaxHp: window.__state.partnerStats?.maxHp ?? null,
      npcs: (window.__npcsHere?.() ?? []).map((n) => n.npc_id ?? n.id),
      events: JSON.parse(localStorage.getItem("engineEvents") || "[]"),
    }));
    await shot(page, "02-postgame-entry-s923");
    assert.equal(st923.map, "s923", "the Login Room cutscene's HANDOFF 627 resolves to its alt s923");
    assert.equal(st923.ord, 45, "the post-game marker stays 45");
    assert.ok(st923.flag40cd, "s925's arrival event 1600 wrote 0x40CD");
    assert.ok(st923.events.includes("s780.auto.1500"), "the reunion is recorded as seen");
    assert.ok(st923.events.includes("s925.auto.1600"), "s925's arrival event is recorded as seen");
    // 0x7053 is roster action 83 (heal_active_party): the 1-HP fixture is full here.
    assert.equal(st923.leadHp, st923.leadMaxHp, "the arrival chain's 0x7053 healed the party (the terminal-fight aftermath survives a full reload)");
    assert.ok(st923.npcs.includes(32) && st923.npcs.includes(36) && st923.npcs.includes(37),
      `s923 must spawn its Main Lobby actors; saw ${JSON.stringify(st923.npcs)}`);
    result.legs.entry = { arrived925: st925, movie: { row: movie.row, returnsPostGame: movie.returnsPostGame }, movieBefore, fieldMovieAtEntry: movie.field, st923,
      movieDiag: moviePins.diag, moviePlayed: played, movieEnd };
  }
  await page.close(); page = null;

  // ═══ LEG 2 — the four Amaterasu Leaders (quest a's gate + fights) ══════════
  const leaderResults = [];
  if (want("leaders")) {
  const LEADERS = [
    { stage: "s956", npc: 143, screen: 305, bit: 4109, name: "Chinron (Qing Long) Leader", line: /I see you have all 5 strongest/ },
    { stage: "s949", npc: 144, screen: 306, bit: 4110, name: "Zhu Que Leader", line: /So, you have the 5 strongest/ },
    { stage: "s949", npc: 145, screen: 307, bit: 4111, name: "Bai Hu Leader", line: /Those aren't the 5 strongest/ },
    { stage: "s954", npc: 146, screen: 308, bit: 4112, name: "Xuan Wu Leader", line: /You have them\?/ },
  ];
  const inventory = EPIC_WEAPONS.map((id) => ({ id, qty: 1 }));
  for (const L of LEADERS) {
    log("LEG 2:", L.stage, "npc", L.npc, "-> screen", L.screen);
    const booted = await bootPage(45, L.stage, [], { inventory });
    const p = booted.page;
    page = p;
    await p.evaluate(() => { window.__gameSpeed = 4; });
    await shot(p, `10-leader-${L.stage}-${L.npc}-boot`);
    const placed = await faceNpc(p, L.npc);
    assert.ok(placed, `${L.stage}: npc ${L.npc} (${L.name}) must be in the alias scene`);
    const line = await talkTo(p, L.npc);
    assert.ok(line, `${L.stage}: the leader's talk must open the dialogue box`);
    assert.match(line, L.line, `${L.stage}: the challenge line (estalk08/09, the 0x7096==1 && bit==0 state) must be the one shown`);
    await shot(p, `11-leader-${L.stage}-${L.npc}-line`);
    // Close the line; the state's on_close writes its bit + the launcher record.
    const battleUp = await pressThrough(p, async () => (await status(p)).battle,
      { deadlineMs: 60_000, label: `${L.stage}/battle` });
    assert.ok(battleUp, `${L.stage}: closing the challenge line must launch the scripted battle`);
    const opened = await p.evaluate(() => ({
      screenId: window.__battleB?.()?.screenId ?? null,
      enemies: (window.__battleB?.()?.party ?? []).map((e) => e?.name ?? null),
    }));
    await shot(p, `12-leader-${L.stage}-${L.npc}-battle`);
    assert.equal(opened.screenId, L.screen, `${L.stage}: 0x7400/0x7401 must resolve to ${L.screen}`);
    const won = await winBattle(p, { label: `${L.stage}/${L.npc}` });
    assert.ok(won, `${L.stage}: the leader fight must end`);
    await p.waitForTimeout(500);
    const after = await p.evaluate((bit) => ({
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
      bit: window.__engine.state.flags.get(bit) === true,
    }), L.bit);
    assert.ok(after.bit, `${L.stage}: the challenge bit ${L.bit} must be written by the on_close`);
    assert.equal(after.map, L.stage, `${L.stage}: the fight leaves the player on the same alias map`);
    leaderResults.push({ ...L, opened, after });
    await p.close();
    page = null;
  }
  result.legs.leaders = leaderResults;

  // The 0x7096 gate's negative leg: no Epic Items, the refusal line, no battle.
  {
    log("LEG 2n: s956 without the five Epic Items");
    const booted = await bootPage(45, "s956", []);
    const p = booted.page;
    page = p;
    await p.evaluate(() => { window.__gameSpeed = 4; });
    await faceNpc(p, 143);
    const line = await talkTo(p, 143);
    assert.ok(line, "the leader must still speak without the items");
    assert.match(line, /must go find the 5 strongest/, "the refusal line is the 0x7096==0 state");
    assert.ok(!/I see you have all 5 strongest/.test(line), "the challenge line must NOT show without the items");
    await closeBox(p);
    await p.waitForTimeout(2500);
    const after = await p.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      bit: window.__engine.state.flags.get(4109) === true,
      screen: window.__battleB?.()?.screenId ?? null,
    }));
    await shot(p, "13-leader-negative-refusal");
    assert.equal(after.battle, false, "no battle may start without the five Epic Items");
    assert.equal(after.bit, false, "the challenge bit must stay clear");
    result.legs.leaderNegative = { line, after };
    await p.close();
    page = null;
  }
  }

  // ═══ LEG 3 — the arena finale end to end (World Champion) ═══════════════════
  if (want("arena")) {
  log("LEG 3: arena reception -> s927 -> screen 262 -> win -> desk");
  {
    // The four challenge bits (a save that has taken all four challenges), the
    // 0x7054 gate's four stored bits 0x100d..0x1010.
    const booted = await bootPage(45, "s926", [], { engineFlags: engineFlagsWithBits([4109, 4110, 4111, 4112]) });
    page = booted.page;
    const story = booted.story;
    await page.evaluate(() => { window.__gameSpeed = 4; });
    const placed = await faceNpc(page, 32);
    assert.ok(placed, "the Arena Reception (npc 32) must be at the desk");
    const line = await talkTo(page, 32);
    assert.ok(line, "the receptionist's talk must open the dialogue box");
    assert.match(line, /I've been waiting/, "with 0x7054 true and 0x100c clear the receptionist shows estalk08[40]");
    await shot(page, "20-arena-reception-state1");
    // Close: 0x906f (bank 0x90 bit 111) -> event 1606 -> HANDOFF 632 -> s927.
    const landed = await pressThrough(page, async () => (await status(page)).map === "s927",
      { deadlineMs: 90_000, label: "desk->s927" });
    assert.ok(landed, `the receptionist's close must launch event 1606 and hand off onto the arena floor; story tail:\n  ${story.slice(-14).join("\n  ")}`);
    await page.waitForTimeout(400);
    await shot(page, "21-arena-floor-s927");
    // The floor's arrival gate fires event 1608 (0x100c == 0) and its completion
    // writes 0x100c + 0x7400 -> battle 262.
    const battleUp = await pressThrough(page, async () => (await status(page)).battle,
      { deadlineMs: 60_000, label: "s927 challenge" });
    assert.ok(battleUp, "the floor's arrival gate must start the World Champion fight");
    const opened = await page.evaluate(() => ({
      screenId: window.__battleB?.()?.screenId ?? null,
      enemies: (window.__battleB?.()?.party ?? []).map((e) => e?.enemyId ?? null),
    }));
    await shot(page, "22-arena-battle-262");
    assert.equal(opened.screenId, 262, "s927 record 0 is screen 262");
    assert.deepEqual(opened.enemies, ["Datamon", "Bulbmon", "Armageddemon"], "screen 262's own party");
    const won = await winBattle(page, { label: "arena-262", maxMs: 180_000 });
    assert.ok(won, "the World Champion fight must end");
    const afterWin = await page.evaluate(() => ({
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
      latched: window.__engine.state.flags.get(4108) === true,
      wonFlag: window.__engine.state.flags.get(4663) === true,
    }));
    assert.equal(afterWin.latched, true, "event 1608's completion wrote 0x100c");
    assert.equal(afterWin.wonFlag, true, "the win set the battle's own flag 4663");
    // The win re-chains the POST row 1610, whose HANDOFF 631 returns to the desk.
    await page.evaluate(() => { window.__gameSpeed = 8; });
    const back = await pressThrough(page, async () => (await status(page)).map === "s926",
      { deadlineMs: 90_000, label: "post->desk" });
    assert.ok(back, `the victory row's HANDOFF 631 must return to the front desk; at ${afterWin.map}`);
    await page.evaluate(() => { window.__gameSpeed = 4; });
    await page.waitForTimeout(500);
    await shot(page, "23-arena-back-at-desk");
    // The receptionist's third state: 0x7054 true && 0x100c true.
    await faceNpc(page, 32);
    const doneLine = await talkTo(page, 32);
    assert.ok(doneLine, "the receptionist must still speak after the finale");
    assert.match(doneLine, /beat Kurt/, "with 0x100c latched she shows estalk08[41]");
    await shot(page, "24-arena-reception-state2");
    assert.ok(story.some((t) => t.includes("TALK EVENT 111")), "the close went through the bank-0x90 launcher's bit 111");
    result.legs.arena = { line, opened, afterWin, doneLine };
    await page.close(); page = null;
  }
  }

  // ═══ LEG 4 — the endgame inns, save points and the Qing Long item shop ═════
  const innResults = [];
  if (want("inns")) {
  const INN_LEGS = [
    { stage: "s928", npc: 20, name: "Armaterasu Inn", price: 52, save: 21, saveEvent: 1612 },
    { stage: "s946", npc: 20, name: "Forest Inn", price: 56, save: 21, saveEvent: 1648 },
    { stage: "s957", npc: 20, name: "Qing Long Inn", price: 60 },
  ];
  for (const leg of INN_LEGS) {
    log("LEG 4:", leg.stage, "innkeeper npc", leg.npc);
    const booted = await bootPage(45, leg.stage);
    const p = booted.page;
    page = p;
    await p.evaluate(() => { window.__gameSpeed = 4; });
    const placed = await faceNpc(p, leg.npc);
    assert.ok(placed, `${leg.stage}: the innkeeper (npc ${leg.npc}) must be in the alias scene`);
    await talkTo(p, leg.npc);
    let inn = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      inn = await p.evaluate(() => {
        const i = window.__inn;
        return {
          open: i?.isOpen?.() === true,
          name: i?._record?.name ?? i?._innName ?? null,
          price: i?._record?.pricePerDigimon ?? i?._price ?? null,
        };
      });
      if (inn.open && inn.name != null) break;
      const st = await status(p);
      if (st.textbox) await holdEnter(p, 180);
      else { await faceNpc(p, leg.npc); await holdEnter(p, 200); }
      await p.waitForTimeout(150);
    }
    await shot(p, `30-inn-${leg.stage}`);
    assert.ok(inn?.open, `${leg.stage}: the innkeeper's talk must open the rest screen`);
    assert.equal(inn.name, leg.name, `${leg.stage}: the alias opens its base screen's record (${leg.name})`);
    assert.equal(inn.price, leg.price, `${leg.stage}: the record's own price`);
    innResults.push({ stage: leg.stage, ...inn });
    await p.close();

    if (leg.save != null) {
      log("LEG 4:", leg.stage, "save point npc", leg.save);
      const sboot = await bootPage(45, leg.stage);
      const sp = sboot.page;
      page = sp;
      await sp.evaluate(() => { window.__gameSpeed = 4; });
      await faceNpc(sp, leg.save);
      await talkTo(sp, leg.save);
      const saved = await pressThrough(sp, async () =>
        sp.evaluate(() => window.__saveNative?.isOpen?.() === true),
        { deadlineMs: 60_000, label: `${leg.stage}/save` });
      await shot(sp, `31-save-${leg.stage}`);
      const diag = await sp.evaluate(() => window.__saveNative?.diagnostics?.() ?? null);
      assert.ok(saved, `${leg.stage}: the Guardromon's event ${leg.saveEvent} must end in the save-point handoff and open the native save screen`);
      assert.equal(diag?.mode, "save", `${leg.stage}: the memory card opens in SAVE mode`);
      result.legs[`save-${leg.stage}`] = { mode: diag?.mode ?? null };
      await sp.close();
      page = null;
    }
  }
  result.legs.inns = innResults;
  }

  // ═══ WRAP ═══════════════════════════════════════════════════════════════════
  assert.deepEqual(result.errors, [], "no page errors");
  writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
  console.log("RESULT", JSON.stringify({
    ok: true,
    entry: { arrived925: result.legs.entry.arrived925?.map, landed923: result.legs.entry.st923.map },
    leaders: leaderResults.map((l) => ({ stage: l.stage, npc: l.npc, screen: l.opened.screenId, bit: l.bit })),
    leaderNegative: result.legs.leaderNegative?.line ?? null,
    arena: result.legs.arena?.opened ?? null,
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
