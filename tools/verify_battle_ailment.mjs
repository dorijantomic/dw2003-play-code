// tools/verify_battle_ailment.mjs — what the original's 3D battle shows for an ailment.
//
// The decode (engine/dw3/battle-ailment-display.ts, 2026-10-04) is a NEGATIVE result
// plus one positive: a 3D battle draws NO 2D status icon over a fighter. The whole
// overlay loads exactly two sprite packs — PGFGTC00 (0x455) in 13 routines and CMFONT
// (0x286) in 7 — PGFGTC00's 48 cels hold no ailment icon, and of the 79 reads of a
// combatant's ailment byte (record +0x1c) exactly ONE is inside a sprite-drawing
// routine: the plate's party marker at fightstg.s:17305. So:
//
//   * the ailment's PICTURE is one plate marker per member, cel 0x0F on the acting
//     member and 0x3F on any other, at that member's own x out of 0x800A34C0, y 0x30;
//   * one cel for ALL FOUR ailments, so two ailments are still one marker;
//   * the ailment is NAMED by the shared battle message box with the game's own one
//     word — esmfight 0x1e "Poisoned!" (FIGHTSTG_F0x80091534's poison arm,
//     fightstg.s:15176-15178), which the walker used to replace with its own
//     typed sentence.
//
// The check therefore asserts the three things a player can see, and takes the frame
// that shows them. Run with this worktree's own server:
//   python3 -m http.server 8923 --directory web &
//   VERIFY_PORT=8923 tools/run-playwright.sh tools/verify_battle_ailment.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.AILMENT_ROOT || `${baseUrl(8923)}/`;
const OUT = process.env.AILMENT_SHOT || ".bunny-scratch/shots/battle-ailment";
// The disc's own words, read from the extracted bank rather than typed here.
const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  // Two HP charges and the AntidoteDisk, so the item checks below can be driven
  // through the real ITEM action rather than by calling the handler directly.
  localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 2 }, { id: 66, qty: 3 }]));
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const read = () => page.evaluate(() => {
  const b = window.__battleB();
  const marks = window.__battleAilmentMarks ? window.__battleAilmentMarks() : null;
  return {
    pips: window.__battle.debugPips(),
    marks,
    ailments: Object.keys(b.player.ailments || {}),
    message: b.message ?? "",
  };
});
// Everything the battle 2D HUD drew this frame, read back out of the browser's own
// 2D layer: which pack cel landed at which place. This is how "no icon over the
// fighter" becomes a measurement instead of a claim.
const drawnCels = () => page.evaluate(() => (window.__battle?.debugHudCels
  ? window.__battle.debugHudCels() : null));
// The markers are the cels at the decoded y 0x30: the three party slots at
// x 271/282/293 and the enemy's at x 37.
const MARKER_Y = 0x30;
const MARKER_XS = { player: [271, 282, 293], enemy: [37] };
const markerCels = (cels) => {
  const at = (xs) => xs.map((x) => {
    const hit = (cels || []).find((c) => c.y === MARKER_Y && c.x === x);
    return hit ? hit.cel : null;
  });
  return { player: at(MARKER_XS.player), enemy: at(MARKER_XS.enemy) };
};

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // ── control: a healthy party. Every member's own marker, no ailment anywhere.
  //     `pips` is what the HUD is ASKED for; `drawn` is what it actually drew, and
  //     the two have to agree or the plate is lying to the player.
  const healthy = await read();
  eq("healthy player markers", healthy.pips.player, [12, 60, 60]);
  eq("healthy enemy marker", healthy.pips.enemy, 12);
  eq("healthy ailments", healthy.ailments, []);
  const healthyDrawn = await drawnCels();
  eq("the plate drew the healthy markers", markerCels(healthyDrawn).player, [0x0c, 0x3c, 0x3c]);
  eq("the plate drew the healthy enemy marker", markerCels(healthyDrawn).enemy, [0x0c]);
  await shot("ailment-00-control-healthy");

  // ── 1. Poison the acting member. The marker becomes cel 0x0F and NOTHING else
  //       appears: no icon over the fighter, no [PSN] tag.
  await page.evaluate(() => {
    window.__battleB().player.ailments.poison = { power: 60, tickTime: 1000 };
  });
  const poisoned = await read();
  eq("poisoned acting marker is cel 0x0F", poisoned.pips.player[0], 0x0f);
  eq("the other two markers are unchanged", poisoned.pips.player.slice(1), [60, 60]);
  eq("poison is the only ailment", poisoned.ailments, ["poison"]);
  eq("the plate drew the orange afflicted marker", markerCels(await drawnCels()).player, [0x0f, 0x3c, 0x3c]);
  if (/\[[A-Z]{2,4}\]/.test(poisoned.message))
    fail(`a HUD text tag is still being printed: ${JSON.stringify(poisoned.message)}`);
  await shot("ailment-01-poisoned-marker");

  // ── 1b. A real poison hit is TWO box pages, and the words are the disc's. Page one is
  //        the damage line through the shared kind-4 arm; the ailment word is page two,
  //        through kind 2, and only after the player has read page one
  //        (fightstg.s:14624-14626 -> :14705 -> :15277-15279).
  await page.evaluate(async () => {
    const b = window.__battleB();
    const data = await (await fetch("./assets/data/digimon.json")).json();
    const poison = data.skills.find((s) => s.id === 115);   // "Poison Bites"
    // Every roll lands, so the hit and the ailment are not left to chance. The stub
    // stays up until both pages have been read, because the damage and the ailment are
    // rolled on different frames of the same attack.
    window.__origRandom = Math.random;
    Math.random = () => 0;
    b.player.mp = b.player.maxMp = 999;
    b.pendingAction = { type: "tech", skill: poison };
    b.state = 5;                                             // ST.PLAYER_ACT
    b.timer = 0;
  });
  await page.waitForFunction(() => (window.__battleB()._resultPages ?? []).length > 0,
    null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__battleB()._resultReady === true, null, { timeout: 30_000 });
  const hitPages = () => page.evaluate(() => {
    const b = window.__battleB();
    return {
      index: b._resultPageIndex ?? 0,
      count: (b._resultPages ?? []).length,
      texts: b._resultPages ?? [],
      specs: (b._resultPageSpecs ?? []).map((sp) => (sp ? { kind: sp.kind, payload: sp.payload } : null)),
      lines: window.__battle.peek().messageLine?.frame?.lines ?? null,
      ailments: Object.keys(b.enemy.ailments ?? {}),
    };
  });
  const hit1 = await hitPages();
  eq("a poison hit gives TWO pages", hit1.count, 2);
  eq("page one is the original's damage arm", hit1.specs[0].kind, 4);
  eq("and it says only the damage", hit1.lines, ["Kotemon", `${hit1.specs[0].payload[1]} damage!`]);
  eq("the enemy's marker is the only ailment picture", hit1.ailments, ["poison"]);
  await shot("ailment-04-poison-hit-page-1");

  await tap("Enter");
  await page.waitForFunction(() => (window.__battleB()._resultPageIndex ?? 0) > 0, null, { timeout: 20_000 });
  await page.waitForTimeout(700);
  const hit2 = await hitPages();
  eq("page two is the ailment word, as its own page", hit2.index, 1);
  eq("page two is the shared kind-2 arm", hit2.specs[1].kind, 2);
  eq("with the game's own word", ESMFIGHT[hit2.specs[1].payload[0]], "Poisoned!");
  eq("and the name on line one", hit2.lines, ["Kotemon", "Poisoned!"]);
  eq("the damage page is gone from the second page",
    hit2.lines.some((line) => /damage/.test(line)), false);
  await shot("ailment-05-poison-hit-page-2-ailment");
  await tap("Enter");
  await page.waitForTimeout(1_500);
  await page.evaluate(() => { Math.random = window.__origRandom; });

  // The battle's own words for the ailment, through the shared message box: the roll
  // answers with the ailment, and the game's one word is its own box page (kind 2).
  const said = await page.evaluate(async () => {
    const eng = await import("./vendor/engine.js");
    const battle = await import("./battle.js");
    const r = eng.tryInflict(
      { effect: "poison", effect_p1: 64, effect_p2: 48 },
      { ...window.__battleB().enemy, profile: { resistances: { water: 0 }, status_resist: { poison: 0 } } },
      "Kotemon", { wis: 255 }, () => 0);
    return { ail: r, page: battle.ailmentBoxPage("Kotemon", r) };
  });
  eq("the battle rolls the ailment, not a sentence", said.ail, "poison");
  eq("the ailment's page is the shared kind-2 arm", said.page.spec.kind, 2);
  eq("with the game's own word in the payload", said.page.spec.payload, [0x1e]);
  eq("and the name is line one's slot", said.page.spec.name, "Kotemon");

  // The turn-start gate: a sleeping fighter's line is the disc's "Asleep!" page.
  const gate = await page.evaluate(async () => {
    const eng = await import("./vendor/engine.js");
    const c = { level: 5, str: 10, def: 10, spt: 10, wis: 10, spd: 10, hp: 100, maxHp: 100,
      ailments: { sleep: { power: 40 } } };
    const ts = eng.processTurnStart(c, "Kotemon", false, false);
    const bank = (await (await fetch("./assets/data/battlecmd/esmfight.json")).json()).strings;
    return { spec: ts.spec, skipped: ts.skipped,
      line2: bank[ts.spec.payload[0]], line1: bank[0x16].replace("{1}", ts.spec.name) };
  });
  eq("the gate skips a sleeping turn", gate.skipped, true);
  eq("the gate's line two is the disc's word", gate.line2, "Asleep!");
  eq("the gate's line one is the Digimon's name", gate.line1, "Kotemon");

  // ── 2. A second ailment does not add a second picture. The original tests
  //       `record +0x1c != 0` once, so two ailments are still one marker.
  await page.evaluate(() => {
    const b = window.__battleB();
    b.player.ailments.poison = { power: 60, tickTime: 1000 };
    b.player.ailments.sleep = { power: 60, recoveryTime: 4000 };
  });
  const two = await read();
  eq("two ailments still sort into one marker", two.pips.player[0], 0x0f);
  eq("two ailments recorded", two.ailments.sort(), ["poison", "sleep"]);
  eq("two ailments are still one orange marker", markerCels(await drawnCels()).player, [0x0f, 0x3c, 0x3c]);
  await shot("ailment-02-two-ailments-one-marker");

  // ── 2b. The gradual-HP-recovery tick is a box page of its own through kind 10, and
  //        it carries NO number. pro/wfightmn.s `.L0x00002480` is a status-event machine
  //        beside the poison tick: it asks for kind 10 at wfightmn.s:2428, and that arm
  //        (`.L0x80099a28`, fightstg.s:23651-23681) is the name plus esmfight[0x27] with
  //        no +0x118 call at all. The walker used to type "<name> recovers N HP." into
  //        the line the action shared, so the box showed the recovery and the damage on
  //        one hand-written line.
  //
  // The tick is a STATUS-EVENT page, so it arrives beside the poison tick's page rather
  // than in front of the action's own result line — read the pages a player would read
  // until the panel is the regen one.
  await waitForCommandMenu(page);      // back to a clean command phase after the poison hit
  await page.evaluate(() => {
    const b = window.__battleB();
    b.player.ailments = {};
    b.player.regeneration = true;      // Recover Crest, the only source of the status
    b.player.hp = 200;                 // below max, or step 0 returns with no page at all
    window.__origRandom = Math.random;
    Math.random = () => 0;
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;
    b.pendingAction = { type: "fight" };
    b.state = 5;                       // ST.PLAYER_ACT
    b.timer = 0;
  });
  // "Read the line, then the next page", exactly what a player does with Circle. It stops
  // the moment the panel is showing the page under test.
  const readUntilKind = async (want, ticks = 90) => {
    for (let i = 0; i < ticks; i++) {
      const s = await page.evaluate(() => {
        const b = window.__battleB();
        return { kind: b._msgSpec?.kind ?? null, pages: (b._resultPages ?? []).length,
          ready: !!b._resultReady };
      });
      if (s.kind === want) return true;
      if (s.pages && s.ready) { await tap("Enter"); await page.waitForTimeout(260); continue; }
      await page.waitForTimeout(200);
    }
    return false;
  };
  if (!await readUntilKind(10)) fail("no kind-10 page was ever put up for the regen tick");
  // The reveal machine shows line one whole, then line two four ticks later, so wait for
  // both to have arrived before reading the picture.
  await page.waitForFunction(() => {
    const l = window.__battle.peek().messageLine?.frame?.lines ?? [];
    return l.length > 1 && !!l[1];
  }, null, { timeout: 15_000 }).catch(() => {});
  const regen = await page.evaluate(() => {
    const b = window.__battleB();
    return {
      kind: b._msgSpec?.kind ?? null,
      payload: b._msgSpec?.payload ?? null,
      lines: window.__battle.peek().messageLine?.frame?.lines ?? null,
      hp: b.player.hp,
    };
  });
  eq("the regen tick asks for the shared kind-10 arm", regen.kind, 10);
  eq("with the bank's own sentence on line two", ESMFIGHT[0x27], "HP gradually recovers.");
  eq("and the Digimon's name on line one", regen.lines,
    [await page.evaluate(() => window.__battleB().player.profile.name), "HP gradually recovers."]);
  eq("the HP really went up", regen.hp > 200, true);
  eq("but no amount is drawn anywhere on the page",
    regen.lines.some((line) => /\d/.test(line)), false);
  eq("the amount rides in the payload the arm never reads", regen.payload[2] !== undefined, true);
  await shot("ailment-06-regen-page-kind-10");
  await tap("Enter");                       // read it, so the next check starts clean
  await page.evaluate(() => { Math.random = window.__origRandom; });
  await page.waitForTimeout(1_500);

  // ── 2c. A cure disk is the disc's kind-2 page, not a typed sentence. The AntidoteDisk
  //        handler is 0x8008dcd8: it clears the record's mask and then asks the shared
  //        panel for kind 2 with its own record's esmfight index (fightstg.s:11319),
  //        payload[1] = 0 so the shared tail names the acting Digimon.
  await waitForCommandMenu(page);      // and again after the regen page has been read
  await page.evaluate(async () => {
    const b = window.__battleB();
    b.player.regeneration = false;
    b.player.ailments = { poison: { power: 60, tickTime: 1000 } };
    b.enemy.hp = 99999;
    const items = (await (await fetch("./assets/data/items.json")).json()).items;
    b.pendingAction = { type: "item", item: items.find((i) => i.id === 66) };
    b.state = 5;
    b.timer = 0;
  });
  if (!await readUntilKind(2)) fail("the AntidoteDisk put up no kind-2 page");
  await page.waitForFunction(() => {
    const l = window.__battle.peek().messageLine?.frame?.lines ?? [];
    return l.length > 1 && !!l[1];
  }, null, { timeout: 15_000 }).catch(() => {});
  const cured = await page.evaluate(() => ({
    kind: window.__battleB()._msgSpec?.kind ?? null,
    payload: window.__battleB()._msgSpec?.payload ?? null,
    lines: window.__battle.peek().messageLine?.frame?.lines ?? null,
    ailments: Object.keys(window.__battleB().player.ailments ?? {}),
  }));
  eq("the AntidoteDisk asks for the shared kind-2 arm", cured.kind, 2);
  eq("with the disc's own word in the payload", ESMFIGHT[cured.payload[0]], "Cured!");
  eq("and payload[1] is the side test that names the actor", cured.payload[1], 0);
  eq("so the player's own Digimon is named on line one", cured.lines,
    [await page.evaluate(() => window.__battleB().player.profile.name), "Cured!"]);
  eq("and the poison is really gone", cured.ailments, []);
  await shot("ailment-07-antidote-cured-page");
  eq("the walker's typed sentence is no longer what is drawn",
    /Antidote/.test(JSON.stringify(cured.lines)), false);
  await tap("Enter");
  await page.waitForTimeout(800);

  // ── 3. Nothing was drawn over the fighter. Every 2D cel the battle HUD put up
  //       this frame is accounted for, and none of them is over the 3D models.
  const cels = await drawnCels();
  if (!cels) fail("window.__hudDrawnCels is not available — the HUD draw read-out is missing");
  else {
    const OVERLAP_TOP = 66;      // game y of the top of the 3D stage area
    const OVERLAP_BOTTOM = 176; // game y of the bottom of it (above the command list)
    const over = cels.filter((c) => c.y + c.h > OVERLAP_TOP && c.y < OVERLAP_BOTTOM
      && c.x + c.w > 96 && c.x < 224);
    eq("no 2D cel is drawn over the fighters", over, []);
    eq("every cel drawn is a decoded battle-HUD cel", cels.every((c) => c.known), true);
  }
  await shot("ailment-03-no-icon-over-fighter");

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed,
    markers: { healthy: healthy.pips.player, poisoned: poisoned.pips.player, twoAilments: two.pips.player },
    ailments: two.ailments,
    celsDrawn: cels,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);