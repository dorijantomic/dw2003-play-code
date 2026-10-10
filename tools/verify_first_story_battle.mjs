// Section 7 opening coverage, case 4: the first story battle.
//
// The opening's first scripted fight is s200's StartBattle(200, flag 4608): on
// entering s200 the real PRE event (0112000b) plays, arms flag 16397, and the
// engine bridge then re-raises OnEnterMap so the battle row launches screen 200
// (Genji's Kuwagamon) against the party the s212 download granted. This check
// seeds that party, runs the real launch, wins with the ordinary FIGHT command,
// and asserts the story consumes the result: won flag 4608 is set and the POST
// event carries the player to s220.
//
// The enemy's HP is dropped to 1 only to shorten the fight; the victory flag
// under test is produced by the ordinary command and the engine's real win
// callback, never injected.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_first_story_battle.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
// Every battle check reads the opening line and reaches the command menu through this helper.
import { readBattleLine, waitForCommandList } from "./verify-battle-wait.mjs";

const ROOT = process.env.FSB_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.FSB_SHOT || "/tmp/first-story-battle";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
  stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  // s200's PRE is the story beat at master ordinal 3, the ordinal its own gate
  // names: web/assets/data/auto_event_gates.json gives s200 event 50 the
  // conditions flag 0x6003 == 1 and flag 16397 == 0, and bank-0x60NN is the
  // master ordinal (tools/gate_ordinal.py:26, docs/research/field/
  // rig-stage-anchoring-2026-09-11.md:69) -- so 0x6003 == ordinal 3.
  // Booting at ordinal 0 plays a beat the original has not reached yet, and at
  // ordinal 0 the stage's cast list does not build the player as actor 2 either
  // (docs/research/field/wstag-script-decode.md:136), so the scripted battle
  // this check drives never arms.
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, { lead: member(3, 5, 0), rena: member(7, 5, 0), pata: member(8, 5, 0) });

// A press the game can see. The post-fight results screen reads the pad service's
// held word once per frame (web/game.js:4443 adds a button on keydown, 4998 removes it
// on keyup; web/fightreport-translated.js:189 hands that held set to the session each
// frame), so a keydown and keyup dispatched inside one JS turn leave nothing held for
// any frame and the screen never advances. Hold the button across frames, as a player
// does and as the other native-screen verifiers drive it.
const tap = async (k, ms = 90) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
};
const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};

// The two HP plates. The plate pictures are the chrome pack's cels 0 and 1 at native
// (8,15) and (161,15) (BATTLE_HUD_PLATE_POSITIONS), the two names sit at (17,21) and
// (174,21) and the HP row with the mark between the numbers is at y=26 —
// FIGHTSTG_F0x80093a74's build arm, decoded in .bunny-scratch/platenames-report.md.
//
// Both the crops and the ink read-out come out of one offscreen 320x240 copy of the battle
// canvas, because the battle chrome is laid out in the original's 320x240 space and scaled
// once (web/battle.js:5401) while the canvas itself is larger than the window and hangs off
// its left edge — a window-level screenshot clip cannot address it. The crops are magnified
// PLATE_ZOOM so the glyphs are readable.
const PLATE_CROPS = {
  enemy: { x: 4, y: 12, w: 152, h: 46 },
  player: { x: 158, y: 12, w: 158, h: 46 },
};
const PLATE_INK = {
  enemyName: { x: 17, y: 21, w: 96, h: 12 },
  playerName: { x: 174, y: 21, w: 84, h: 12 },
  separator: { x: 268, y: 26, w: 8, h: 8 },
};
const PLATE_ZOOM = 3;
const plateCapture = (crops, boxes, zoom) => page.evaluate(({ crops, boxes, zoom }) => {
  const src = document.querySelector("#stage canvas");
  if (!src) return null;
  const off = document.createElement("canvas");
  off.width = 320; off.height = 240;
  const c = off.getContext("2d", { willReadFrequently: true });
  c.imageSmoothingEnabled = false;
  c.drawImage(src, 0, 0, 320, 240);
  const out = { ink: {}, png: {} };
  for (const [name, b] of Object.entries(boxes)) {
    const d = c.getImageData(b.x, b.y, b.w, b.h).data;
    let lit = 0;
    let minY = 99; let maxY = -1; let minX = 999; let maxX = -1;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const i = (y * b.w + x) * 4;
        if (Math.max(d[i], d[i + 1], d[i + 2]) < 150) continue;
        lit += 1;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    out.ink[name] = {
      lit, rows: maxY >= minY ? maxY - minY + 1 : 0, cols: maxX >= minX ? maxX - minX + 1 : 0,
      // Where the ink sits in the original's own 320x240 space, so a reader can see the
      // name really does start on its element's x.
      at: maxX >= minX ? { x: b.x + minX, y: b.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    };
  }
  for (const [side, r] of Object.entries(crops)) {
    const piece = document.createElement("canvas");
    piece.width = r.w * zoom; piece.height = r.h * zoom;
    const p = piece.getContext("2d");
    p.imageSmoothingEnabled = false;
    p.drawImage(off, r.x, r.y, r.w, r.h, 0, 0, r.w * zoom, r.h * zoom);
    out.png[side] = piece.toDataURL("image/png").split(",")[1];
  }
  return out;
}, { crops, boxes, zoom });

/** Write both plate crops next to the other shots and hand back the ink read-out. */
const plateShots = async () => {
  const got = await plateCapture(PLATE_CROPS, PLATE_INK, PLATE_ZOOM);
  if (!got) { console.log("no battle canvas; the plate crops are skipped"); return null; }
  for (const [side, b64] of Object.entries(got.png)) {
    writeFileSync(`${OUT}/story-battle-plate-${side}.png`, Buffer.from(b64, "base64"));
    console.log("shot", `story-battle-plate-${side}`, `${PLATE_CROPS[side].w}x${PLATE_CROPS[side].h} native`);
  }
  console.log("plate-ink", JSON.stringify(got.ink));
  return got.ink;
};

let failed = null;
const fail = async (msg) => {
  failed = msg;
  console.error("FAIL:", msg);
  try {
    writeFileSync(`${OUT}/failure-state.json`, JSON.stringify(await page.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      state: window.__battleB?.()?.state ?? null,
      phase: window.__battleB?.()?._victoryPhase ?? null,
      won: !!window.__engine.state.flags.get(4608, 1),
      map: window.__state?.manifest?.maps?.[window.__state?.mapIdx]?.id ?? null,
    })), null, 2));
    await shot("failure");
  } catch { /* page may be gone */ }
};

try {
  // Seed the party the s212 download would have granted, on the battle map.
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });

  // The PRE cutscene arms the battle; run it at speed and confirm each SAY.
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
  if (!launched) await fail("the s200 PRE never launched the scripted battle");

  const opened = await page.evaluate(() => {
    const b = window.__battleB();
    return {
      state: b.state,
      screenId: b.screenId ?? null,
      enemy: b.enemy?.profile?.name ?? null,
      enemyLevel: b.enemy?.level ?? null,
      player: b.player?.profile?.name ?? null,
      playerId: b.player?.profile?.id ?? null,
      party: window.__state.party ?? null,
      activePlayerIndex: b.activePlayerIndex ?? 0,
      wonFlag: !!window.__engine.state.flags.get(4608, 1),
    };
  });
  if (opened.screenId !== 200) await fail(`battle screen ${opened.screenId}, expected the story screen 200`);
  if (opened.enemy !== "Kuwagamon") await fail(`enemy ${opened.enemy}, expected Kuwagamon`);
  if (opened.playerId !== 3) await fail(`player ${opened.player}/${opened.playerId}, expected the seeded Monmon (3)`);
  if (JSON.stringify(opened.party) !== JSON.stringify(["p005koet", "p006agum", "p009rena"]))
    await fail(`party ${JSON.stringify(opened.party)} is not the downloaded pack`);
  if (opened.wonFlag) await fail("won flag was already set before the fight");

  // The plate's two names and the slash between the HP numbers
  // (FIGHTSTG_F0x80093364 and FIGHTSTG_F0x80093a74's build arm; the decode is
  // .bunny-scratch/platenames-report.md). Bank 0x7f line 0x10 is the single glyph
  // "/", and it is built at (268, 26) between the shown HP's anchor at (267, 26) and
  // the maximum's at (302, 26). The names are the original's elements at (174, 21)
  // and (17, 21).
  const labels = await page.evaluate(() => window.__battle?.debugPlateLabels?.() ?? null);
  if (!labels) await fail("the plate names read-out is missing");
  const PLATE_NAMES = { player: { x: 174, y: 21 }, enemy: { x: 17, y: 21 } };
  for (const side of ["player", "enemy"]) {
    const l = labels[side];
    if (l.x !== PLATE_NAMES[side].x || l.y !== PLATE_NAMES[side].y || l.kind !== 1)
      await fail(`plate ${side} name at (${l.x}, ${l.y}) kind ${l.kind}, expected ${JSON.stringify(PLATE_NAMES[side])} kind 1`);
    if (!String(l.text ?? "").trim()) await fail(`the ${side} name on the plate is blank`);
  }
  if (labels.player.text !== opened.player)
    await fail(`plate shows the player's name "${labels.player.text}", expected "${opened.player}"`);
  if (labels.enemy.text !== "Kuwagamon")
    await fail(`plate shows the enemy's name "${labels.enemy.text}", expected Kuwagamon`);
  if (labels.separator.text !== "/" || labels.separator.x !== 268 || labels.separator.y !== 26
      || labels.separator.bank !== 0x7f || labels.separator.index !== 0x10)
    await fail(`HP separator ${JSON.stringify(labels.separator)}, expected "/" from bank 0x7f line 0x10 at (268, 26)`);
  // The player's element is handed its own roster record with the literal index -1
  // (`.L0x80093400 li $a2, -0x1`), which is how the plate shows the stored nickname.
  if (labels.player.source >>> 0 !== 0x8004949c + opened.activePlayerIndex * 988
      || labels.player.index !== -1)
    await fail(`the player's name element was handed ${JSON.stringify(labels.player)}, expected the active roster record and index -1`);
  // Both plates, cropped out of the battle canvas so the two names and the mark between
  // the numbers can be read, and the ink each one carries where the port says it draws.
  const ink = await plateShots();
  if (!ink) await fail("the battle canvas could not be read for the plate ink");
  else {
    for (const [box, side] of [["enemyName", "enemy"], ["playerName", "player"]]) {
      const want = PLATE_NAMES[side].x;
      const at = ink[box].at;
      if (ink[box].lit < 8 || !at || Math.abs(at.x - want) > 2)
        await fail(`the ${side} name is not drawn at its element's x=${want}: ${JSON.stringify(ink[box])}`);
    }
    // The mark between the HP numbers is one glyph: ink on its own element's x, no wider
    // than one kind 3 cell and taller than it is wide, which is what the original's "/"
    // looks like (bank 0x7f line 0x10).
    const sep = ink.separator;
    if (sep.lit < 3 || !sep.at || Math.abs(sep.at.x - 268) > 1 || sep.cols > 8 || sep.rows < 4)
      await fail(`the HP separator is not the original's glyph: ${JSON.stringify(sep)}`);
  }
  await shot("story-battle-start");

  // Ordinary FIGHT command. A line the message panel is showing waits for Circle and has
  // no timeout (pro/fightstg F0x80098a84, `.L0x80098bb8`/`.L0x80098bbc`).
  //
  // One Circle press does exactly one job, because the original's battle controller never
  // builds the command menu beside a waiting line: "wait for the line, then open the command
  // menu" is ONE script instruction, whose first act is to read the owner's message-line slot
  // and return while it is occupied (`wfightmn.s:1494-1496`; the arming `F0x80092d80(2)` is at
  // `:1552-1556`, and the same wait sits at `:1303-1305`). The menu actor itself is born in
  // state 0, which builds the widget and returns without reading the pad
  // (`fightstg.s:17629-17649`), so the press that read the line could not confirm it anyway.
  //
  // The opening line ("Ambush!") is the first case of that rule: it is put up by the script
  // instruction that parks it in the controller's slot (`wfightmn.s:1472-1474`) and the next
  // instruction is the wait above, so the intro stays the intro until the line is read.
  await page.waitForFunction(
    () => {
      const p = window.__battle?.peek?.();
      const m = p?.messageLine;
      return p?.state === 1 && !!m?.active && m.finished === false && !!m.frame?.prompt;
    },
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => { window.__battleB().enemy.hp = 1; }); // shorten the fight only

  // Give the battle the whole intro time it would need to arm the command phase by itself.
  // It must not: the line is still waiting, so there is no list and the phase has not moved.
  await page.waitForTimeout(2000);
  const whileWaiting = await page.evaluate(() => {
    const p = window.__battle?.peek?.();
    return {
      state: p?.state ?? null,
      waitsForLine: !!p?.waitsForLine,
      listOpen: !!p?.commandList?.open,
      lineFinished: !!p?.messageLine?.finished,
      prompt: !!p?.messageLine?.frame?.prompt,
    };
  });
  // `waitsForLine` is the battle's own read-out of the rule and is reported, not required:
  // the condition below is the picture a player sees.
  if (whileWaiting.state !== 1 || whileWaiting.lineFinished || !whileWaiting.prompt
      || whileWaiting.listOpen) {
    await fail(`the command phase started beside the waiting opening line: ${JSON.stringify(whileWaiting)}, expected the intro (state 1) still waiting with no command list opened`);
  }
  await shot("story-battle-line-waiting");

  // One Circle press reads the line and nothing else. The list is built on the frames after
  // it, and a list's first tick reads no pad, so this press cannot also confirm: the battle
  // must come to rest at the command menu with the line read and no row chosen. The next
  // Circle is what picks the command.
  //
  // `readBattleLine` is the shared press (tools/verify-battle-wait.mjs, the same one every other
  // battle check uses); this check keeps its own reading of the picture on each side of it.
  await readBattleLine(page);
  await waitForCommandList(page);
  await page.waitForTimeout(400);
  const afterClose = await page.evaluate(() => {
    const p = window.__battle?.peek?.();
    return {
      state: p?.state ?? null,
      waitsForLine: !!p?.waitsForLine,
      lineFinished: !!p?.messageLine?.finished,
      menu: p?.menu ?? null,
      message: p?.message ?? null,
      chosen: window.__battleCmdNative?.diagnostics?.()?.chosen ?? null,
    };
  });
  if (afterClose.state !== 2 || !afterClose.lineFinished || afterClose.chosen !== null) {
    await fail(`one Circle press left the battle in state ${afterClose.state} saying ${JSON.stringify(afterClose.message)} (line read: ${afterClose.lineFinished}, chosen row: ${afterClose.chosen}), expected state 2 (the command menu) with the line read and no command chosen: the press both read the line and confirmed the menu`);
  }
  await shot("story-battle-line-closed-menu-open");

  for (let tries = 0; tries < 8; tries++) {
    await tap("Enter");
    await page.waitForTimeout(220);
    const st = await page.evaluate(() => window.__battleB?.()?.state);
    if (st !== 2) break;
  }

  // The translated message line must come up where pro/fightstg puts it: the window
  // picture at native (11, 188) sized 296 x 38, the lines at (20, 194) and (20, 208),
  // and the "press Circle" glyph at (291, 208), which the original only blinks while the
  // line waits to be read (F0x80098924 `.L0x8009895c` on `self+0x98`). These are the
  // decoded constants of FIGHTSTG_F0x80099588 / F0x80098924
  // (engine/dw3/ui/native/battle-message-line.ts, decode in
  // .bunny-scratch/battlemsg-fix2-report.md); the peek's `messageLine` carries them.
  const MSG_LINE = { x: 11, y: 188, w: 296, h: 38 };
  const MSG_LINES = [{ x: 20, y: 194 }, { x: 20, y: 208 }];
  const MSG_PROMPT = { x: 291, y: 208 };
  let msgLine = null;
  const msgDeadline = Date.now() + 12_000;
  while (Date.now() < msgDeadline) {
    const peeked = await page.evaluate(() => window.__battle?.peek?.()?.messageLine ?? null);
    if (peeked?.active && peeked.frame?.prompt) { msgLine = peeked; break; }
    if (await page.evaluate(() => window.__battleB?.()?.state) === 8) break;
    await page.waitForTimeout(60);
  }
  if (!msgLine) {
    await fail("the translated message line never came up during the fight");
  } else {
    const p = msgLine.frame.panel;
    const l = msgLine.frame.lines;
    if (p.x !== MSG_LINE.x || p.y !== MSG_LINE.y || p.w !== MSG_LINE.w || p.h !== MSG_LINE.h)
      await fail(`message panel at ${JSON.stringify(p)}, expected ${JSON.stringify(MSG_LINE)}`);
    if (msgLine.frame.prompt.x !== MSG_PROMPT.x || msgLine.frame.prompt.y !== MSG_PROMPT.y)
      await fail(`message prompt at ${JSON.stringify(msgLine.frame.prompt)}, expected ${JSON.stringify(MSG_PROMPT)}`);
    if (!msgLine.frame.prompt.clipId.startsWith("10"))
      await fail(`message prompt clip ${msgLine.frame.prompt.clipId} is not CMFONT cel 10`);
    if (!l.some((line) => line)) await fail("the message line came up with no text on either line");
    console.log("message-line", JSON.stringify(msgLine));
    await shot("story-battle-message");
  }

  let guard = 0;
  while (await page.evaluate(() => window.__battleB?.()?.state) !== 8 && guard++ < 30) {
    await tap("Enter");
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 8, null, { timeout: 15_000 });
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", null, { timeout: 20_000 });
  const report = await page.evaluate(() => {
    const b = window.__battleB();
    return { applied: b._winApplied, pages: (b._winPages ?? []).map((p) => p.kind) };
  });
  await page.waitForTimeout(1200);
  await shot("story-battle-report");
  if (report.applied !== true) await fail(`victory report did not apply: ${JSON.stringify(report)}`);

  // Skip the report to the battle end, which fires the engine's win callback.
  guard = 0;
  while (await page.evaluate(() => !!window.__battle?.isActive?.()) && guard++ < 25) {
    await tap("Enter");
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(300);

  const afterWin = await page.evaluate(() => ({
    wonFlag: !!window.__engine.state.flags.get(4608, 1),
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
  }));
  if (!afterWin.wonFlag) await fail("the story won flag 4608 was not set on victory");

  // The bridge rechains to the POST row; its event must carry the player on.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const arriveDeadline = Date.now() + 15_000;
  let arrived = null;
  while (Date.now() < arriveDeadline) {
    const st = await page.evaluate(() => ({
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
      tb: window.__textbox?.isOpen?.() ?? false,
      cut: window.__cutscene?.isActive?.() ?? false,
    }));
    if (st.map === "s220") { arrived = st; break; }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await page.waitForTimeout(200);
  await shot("story-battle-after");
  if (!arrived) await fail(`the POST event never reached s220: ${JSON.stringify(await page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id))}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, opened, report, afterWin, arrived, plateLabels: labels,
    plateCrops: PLATE_CROPS, plateInk: ink,
    // The picture one Circle press buys: no command list while the line waits, then the
    // list open and unchosen after the press that read the line.
    whileWaiting, afterClose,
    messageLine: msgLine && { panel: msgLine.frame.panel, lines: msgLine.frame.lines,
      prompt: msgLine.frame.prompt },
    // The two line positions are the decoded literals, so a reader can see them
    // without opening the engine: pro/fightstg F0x8001AE38(0x1005, 1, 0x14, 0xc2/0xd0).
    messageLinePlaces: MSG_LINES,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
