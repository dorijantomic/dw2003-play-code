// Headless proof that the Digimon Arena finale is REACHABLE and then actually fights.
//
// Before 2026-08-13 the s927 chain was two OnTalk rows and nothing else: Kurt's
// challenge scene played, and the next talk played "I did it! I beat Kurt!" — with
// no battle in between. The disc starts that fight from the pre-fight event's
// completion hook, which fires set_flag(0x7400); bank 0x74 is the scripted-battle
// launcher (ARENA-C011), and record 0 of s927's scripted block is screen 262.
//
// ── WHAT REACHES THE FLOOR (decoded 2026-10-06, corrected 2026-10-06) ──────────
// This tool used to claim "the desk scene auto-fires on entry" and drove
// `bridge.onTalk(32)` from a bare s926 boot. That premise is false and the tool
// therefore failed at HEAD (`landed on s926`). The decoded truth
// (docs/research/systems/arena-finale-gate-2026-10-06.md):
//
//   • The receptionist (s926 npc 32) launches the handoff (event 1606, whose
//     HANDOFF 632 resolves to s927 at master ordinal 0x2d) ONLY in her dialogue
//     state 1, gated `0x7054 == 1 && 0x100c == 0` (pro/wstag926.s file 0x37c-0x3a0;
//     web/assets/data/talk_launch_bindings.json → stages.s926). The launch is her
//     on_close writing bank-0x90 bit 111 — NOT the talk, NOT an entry auto-fire.
//   • 0x7054 is VIRTUAL: true iff the four endgame tamer challenges' bits
//     0x100d/0x100e/0x100f/0x1010 are all set (roster_predicate_table.json flag_id
//     28756). So the tool must give the player the state a real player would have:
//     the four challenge bits, with the arm flag 0x100c still clear.
//   • The floor's emptiness is the DISC's data (one cutscene-positioned actor Kurt,
//     actor 104, at 0,0; no exits) — s233 is the ordinary empty room, and the room
//     only reaches s927 because the desk is entered at ordinal 0x2d.
//
// So this drives the REAL web/game.js: boot the desk at ordinal 0x2d, set the four
// challenge bits, stand in front of npc 32 and confirm her line (the real field
// talk), page it closed (that is where her on_close writes 0x906f → start_event
// 1606), watch the engine hand off to s927, then watch the arrival gate chain
// PRE -> battle on the floor and assert screen 262. Captures a frame at each step.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_arena_finale.mjs [output-directory]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(Number(process.env.VERIFY_PORT) || 8742)}`;
const outDir = resolve(process.argv[2] ?? "/tmp/arena-finale");
const LABEL = process.env.LABEL ?? "after";
await mkdir(outDir, { recursive: true });

const KURT = 104;
const EXPECTED_SCREEN = 262;
// The four endgame tamer challenges (bank 0x10 bits 0x0d..0x10) the virtual gate
// 0x7054 is the all-set of; and the arm flag the finale itself writes.
const ENDGAME_BITS = [0x100d, 0x100e, 0x100f, 0x1010];
const ARM_FLAG = 0x100c;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 900, height: 700 },
  storageState: {
    cookies: [],
    origins: [{
      origin,
      localStorage: [
        { name: "engineSchema", value: "2" },
        // Without a saved mode the first-launch visual chooser covers the frame.
        { name: "assetMode", value: "authentic" },
        // The desk and floor are the ordinal-0x2d alias of screens 631/632, so the
        // router needs the master ordinal at the post-game value.
        { name: "progressOrdinal", value: "45" },
        { name: "charId", value: "p003pken" },
        { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
const story = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.text().includes("[STORY]")) story.push(m.text().replace(/^%c.*?%c /, "")); });

const shot = (name) => page.locator("#game").screenshot({ path: resolve(outDir, `${LABEL}-${name}.png`) });
const status = () => page.evaluate(() => ({
  cutscene: window.__cutscene?.isActive?.() ?? false,
  textbox: window.__textbox?.isOpen?.() ?? false,
  battle: window.__battle?.isActive?.() ?? false,
}));

/** Hold a confirm so the pad (and the translated box, which reads the confirm EDGE)
 *  samples it — a 0 ms press is not read. Mirrors the playbook's "hold ~200 ms". */
async function pressConfirm() {
  await page.keyboard.down("Enter");
  await page.waitForTimeout(140);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(80);
}

/** Page dialogue along until something else takes the screen (or it all goes quiet). */
async function settle(ms = 25_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const s = await status();
    if (s.battle) return s;
    if (!s.cutscene && !s.textbox) return s;
    if (s.textbox || s.cutscene) await pressConfirm();
    await page.waitForTimeout(120);
  }
  return status();
}

const mapId = () => page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id);

/** Page dialogue along until the loaded map is no longer `from`; returns the new map. */
async function mapAfter(from, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const now = await mapId();
    if (now !== from) { await page.waitForTimeout(800); return now; }
    if ((await status()).textbox || (await status()).cutscene) await pressConfirm();
    await page.waitForTimeout(150);
  }
  return from;
}

const result = { label: LABEL, battleStarted: false, screenId: null, party: null };

try {
  // ── Reachability. The finale is entered from the Arena Front Desk (s926), and the
  // room the desk hands off to is decided by the screen table's alias rule: screen 632
  // loads the ordinary arena s233, or its story variant s927, selected only at master
  // ordinal 0x2d. s233 is an EMPTY room, so the finale is reachable only because the
  // arena is entered at 0x2d. Boot the desk and prove the REACHABLE path end to end.
  await page.goto(`${origin}/?skipTitle=1&map=s926&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await settle(8_000);
  await shot("00-front-desk");

  // NOTE: wrapping the exposed `window.__battle.startParty` does NOT intercept the fight —
  // battle.js's own entry points call startParty by closure (web/battle.js:3665-3676), so the
  // proof reads the LIVE battle state (`window.__battleB()`) instead: its screenId is what the
  // launcher resolved, not a pixel change.

  // Stand in front of the Arena Reception and read which dialogue state her gate
  // selects. At the fixture's starting flags 0x7054 is clear, so it must be state 0
  // (estalk08 index 39) — the line that starts nothing.
  await page.evaluate(() => {
    const st = window.__state;
    const n = (window.__npcsHere?.() ?? []).find((x) => (x.npc_id ?? x.id) === 32);
    if (n) { st.x = n.x; st.y = n.y + 24; st.dir = "up"; }
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const t = window.__talkTarget?.();
    return { npc: t?.npc ?? null, index: t?.state?.dialogue?.index ?? null, gate: window.__engine.state.flags.get(0x7054) === true };
  });
  assert.equal(before.npc, 32, `the player must be facing the Arena Reception (npc 32), read ${JSON.stringify(before)}`);
  assert.equal(before.gate, false, "the virtual gate 0x7054 starts clear on a bare fixture boot");
  assert.equal(before.index, 39,
    `with 0x7054 clear the receptionist must offer state 0 (estalk08[39], the line that starts nothing); saw index ${before.index}`);

  // Give the player the state a real player would have: beat the four endgame tamer
  // challenges. 0x7054 is virtual, so it is set by its four stored bits — never
  // written directly — and the finale's own arm flag 0x100c stays clear.
  await page.evaluate((bits) => { for (const id of bits) window.__engine.state.flags.set(id, true); }, ENDGAME_BITS);
  const gate = await page.evaluate(() => window.__engine.state.flags.get(0x7054) === true);
  assert.ok(gate, "setting the four endgame bits 0x100d..0x1010 must make the virtual gate 0x7054 true");
  const armed = await page.evaluate(() => window.__engine.state.flags.get(0x100c) === true);
  assert.equal(armed, false, "the finale's arm flag 0x100c must still be clear before the challenge");

  // Now her state must be state 1 (estalk08[40]) and its on_close must carry the
  // bank-0x90 bit-111 write that start_events event 1606.
  const after = await page.evaluate(() => {
    const t = window.__talkTarget?.();
    const oc = (t?.state?.on_close ?? []).map((c) => c.id);
    return { index: t?.state?.dialogue?.index ?? null, on_close: oc };
  });
  assert.equal(after.index, 40,
    `with 0x7054 set and 0x100c clear the receptionist must offer state 1 (estalk08[40], the handoff line); saw index ${after.index}`);
  assert.ok(after.on_close.includes(0x906f),
    `state 1's on_close must write bank-0x90 bit 111 (0x906f); saw ${JSON.stringify(after.on_close)}`);
  await shot("01-reception-state1");

  // ── The real talk. Confirm her line, then page it closed: her on_close writes
  // 0x906f -> start_event(1606) -> the scene whose HANDOFF 632 warps to s927. Wait on
  // the map actually changing rather than on a quiet frame (a cutscene WAIT looks quiet).
  await pressConfirm();
  await page.waitForTimeout(300);
  const landed = await mapAfter("s926", 40_000);
  assert.equal(landed, "s927", `the desk must hand off onto the arena floor (landed on ${landed})`);
  result.reachedFrom = "s926 front desk";
  result.talkLaunched = story.some((l) => /TALK EVENT 111.*1606/.test(l));
  assert.ok(result.talkLaunched,
    `the receptionist's on_close must launch event 1606 (TALK EVENT 111 → id 1606); story log:\n  ${story.slice(-12).join("\n  ")}`);
  await shot("02-arena-floor");

  // ── The challenge. Landing on s927 runs the floor's arrival gate, which starts the
  // Kurt challenge (event 1608, arm 0x100c clear) and its completion arms the fight
  // (set_flag 0x7400 -> the bank-0x74 launcher, record 0 = screen 262). No NPC is involved.
  // Do NOT ask the stage entry again: with 0x100c now set the arrival gate would pick the
  // victory row (event 1610) instead of the challenge. Let the clock run and page the scene.
  await page.evaluate(() => { window.__gameSpeed = 6; });
  const battleDeadline = Date.now() + 45_000;
  let sawScene = false;
  while (Date.now() < battleDeadline) {
    const s = await status();
    if (s.battle) break;
    if (s.cutscene || s.textbox) { sawScene = true; await pressConfirm(); }
    else await page.waitForTimeout(120);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  result.challengeSceneSeen = sawScene;
  await shot("03-battle");

  // Read the LIVE battle the launcher resolved: its screenId is an observation about
  // what the disc asked for, not a pixel change.
  const live = await page.evaluate(() => {
    const b = window.__battleB?.();
    return { active: !!window.__battle?.isActive?.(), screenId: b?.screenId ?? null, hasEnemy: !!b?.enemy, state: b?.state ?? null };
  });
  result.battleStarted = live.active;
  result.screenId = live.screenId;
  result.party = live.hasEnemy ? 1 : 0;
  result.battleState = live.state;

  assert.ok(result.battleStarted,
    `the floor's arrival gate must start the tournament fight — the whole point of the arena finale. ` +
    `Story log:\n  ${story.slice(-12).join("\n  ")}`);
  assert.equal(result.screenId, EXPECTED_SCREEN,
    `the fight must be screen ${EXPECTED_SCREEN} (scripted record 0, the one set_flag(0x7400) launches)`);
  assert.ok(result.party > 0, "screen 262 must resolve to a real enemy");

  assert.deepEqual(errors, [], "no page errors");
  await writeFile(resolve(outDir, `${LABEL}-result.json`), JSON.stringify(result, null, 2));
  console.log(`arena finale OK — reached s927 through the gated receptionist talk, battle screen ${result.screenId}, party of ${result.party}`);
} catch (e) {
  await shot("99-failure").catch(() => {});
  await writeFile(resolve(outDir, `${LABEL}-result.json`), JSON.stringify({ ...result, error: String(e) }, null, 2));
  console.error(`arena finale FAILED (${LABEL}):`, e.message);
  console.error("battles started:", JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await browser.close();
}
