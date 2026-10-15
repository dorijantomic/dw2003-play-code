// tools/verify_long_session_smoke.mjs — the long-session smoke on a FRESH profile.
//
// One page, one session: the real boot screens → New Game → the authored opening
// to Asuka City → the scripted first battle → three more field battles (one with
// a digivolution standing in, one item use, one Run) → shop buy/sell → a walked
// set of map transitions → inn rest → save → reload through the title's Continue
// → a card duel → two more transitions. It asserts: no page errors, no stuck
// states (every leg must reach its expected state inside a budget), and that
// xp / level / bits / bag / the active form's DV ledger are identical across the
// reload.
//
// WHERE THE LEGS ARE DRIVEN, AND WHERE THEY ARE PLACED
//   Everything a player PRESSES is driven with real key events through the real
//   screens: the boot chooser/language/movie/title, New Game, the opening chain,
//   the counter talk, every battle (command list, Item row, Run row), the shop
//   session (BUY/SELL), the inn rest, the memory card, the title's Continue, and
//   the duel. `window.__teleport` (web/game.js) is used for PLACEMENT only —
//   standing at the counter / shopkeeper / innkeeper / a door pad instead of
//   walking there. The full walked routes for the opening and the inn save are
//   the committed journey check's job (tools/verify_journey.mjs); this smoke's
//   job is breadth and state consistency over a long session.
//
// THE DIGIVOLUTION LEG, EXACTLY
//   Before battle 2 the lead is seeded to stand in Dinohumon (id 30) at level 1
//   with xp 9, its form ledger entry at dvexp 9 / formLevel 1. Screen 200's
//   reward is [dvexp 1, exp 4, bits 50]. The disc's level curve reads the
//   STARTER species' row (pro/stfgtrep F0x80086184 -> growth_xp 8 for Kotemon),
//   never the active form's (Dinohumon's row says 1). So after the win:
//     * the main level must be 2 (xp 13 > threshold 9; the form's own curve
//       would have carried it to level 4) — the rookie-curve check;
//     * the form's DV ladder (F0x800865C0) must have taken the DVEXP gain
//       (solo, one marked form: 10) and raised the form level 1 -> 2.
//
// Run:  VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_long_session_smoke.mjs
// Serve: python3 -m http.server <port> --directory web
// Shots land in SMOKE_SHOT (default .bunny-scratch/long-session-smoke).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, runBattleTurn, tapCircle } from "./verify-battle-wait.mjs";
import { openContinueCard, loadFromCard, cardWindow, saveToCard } from "./memcard-continue.mjs";

const ROOT = `${baseUrl(8842)}/`;
const OUT = process.env.SMOKE_SHOT ?? ".bunny-scratch/long-session-smoke";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const checks = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  checks.push({ name, ok, detail });
  if (!ok) failures++;
};
const log = (...a) => console.log("[smoke]", ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [], consoleErrors = [], failedRequests = [], httpErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText ?? ""}`));
page.on("response", (r) => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`); });

// The same two optional files every verifier tolerates, plus the ERR_ABORTED
// class the chooser's own reload causes (no AbortController exists in web/).
const KNOWN_OPTIONAL_404 = [/assets\/ui\/fight_ui\.png/, /assets-hd\/manifest\.json/, /slot_map\.json$/];
const unexpectedHttp = () => httpErrors.filter((r) => !KNOWN_OPTIONAL_404.some((re) => re.test(r)));
const unexpectedFailed = () => failedRequests.filter((r) => !/movieopn\.mp4/.test(r) && !/:: net::ERR_ABORTED$/.test(r));

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const hold = async (key, ms = 130) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(80);
};
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const speed = (n) => page.evaluate((v) => { window.__gameSpeed = v; }, n);

const snap = () => page.evaluate(() => {
  const st = window.__state;
  let map = null;
  try { map = st?.manifest?.maps?.[st.mapIdx]?.id ?? null; } catch { map = null; }
  return {
    started: !!st?.started, map,
    x: Math.round(st?.x ?? 0), y: Math.round(st?.y ?? 0), dir: st?.dir ?? null,
    textbox: window.__textbox?.isOpen?.() ?? false,
    choice: window.__choice?.isOpen?.() ?? false,
    cutscene: window.__cutscene?.isActive?.() ?? false,
    battle: !!window.__battle?.isActive?.(),
    packSelect: !!st?.packSelect, nameEntry: !!st?.nameEntry,
    fade: window.__fade?.dir ?? 0,
    ordinal: st?.progressOrdinal ?? null,
    titleUp: !document.getElementById("title-screen")?.hidden,
    innOpen: !!window.__inn?.isOpen?.(), shopOpen: !!window.__shop?.isOpen?.(),
    duelOpen: !!window.__cardDuelNative?.isOpen?.(),
  };
});

/** Advance any textbox / choice until nothing is up (or the battle starts). */
const settleDialogue = async (budgetMs = 30_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const p = await snap();
    if (p.battle) return p;
    if (p.textbox || p.choice) { await hold("Enter", 250); continue; }
    return p;
  }
  return await snap();
};

const sessionState = () => page.evaluate(() => {
  const s = window.__state;
  let map = null;
  try { map = s?.manifest?.maps?.[s.mapIdx]?.id ?? null; } catch {}
  const ps = s?.partnerStats ?? {};
  const form = (ps.formLedger ?? []).find((e) => Number(e.id) === 30) ?? null;
  return {
    name: s?.playerName ?? null, map, bits: s?.bits ?? null,
    level: ps.level ?? null, xp: ps.xp ?? null, digimonId: ps.digimonId ?? null,
    hp: ps.hp ?? null, maxHp: ps.maxHp ?? null,
    party: (s?.party ?? []).slice(),
    bag: (s?.inventory ?? []).map((i) => [Number(i.id), Number(i.qty)]).sort((a, b) => a[0] - b[0]),
    form30: form ? { dvexp: Number(form.dvexp ?? 0), formLevel: Number(form.formLevel ?? 1) } : null,
  };
});

// ── the boot screens, the way tools/verify_journey.mjs drives them ───────────
const driveBootToTitle = async (label) => {
  const chooserUp = await page.evaluate(() => {
    const el = document.getElementById("asset-mode-screen");
    return !!el && !el.hidden;
  });
  if (chooserUp) {
    log(`boot (${label}): the first-launch visual-style chooser is up — picking Authentic PS1`);
    await page.click("#asset-mode-authentic").catch((e) => log(`boot (${label}): chooser click: ${e.message}`));
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 60_000 });
  }
  await page.waitForFunction(() => window.__cntyselNative?.active?.() === true
    && window.__cntyselNative.diagnostics().host?.state?.state1 === 7, null, { timeout: 60_000 });
  let picked = null;
  for (let i = 0; i < 20 && !picked; i++) { await hold("i", 140); picked = await page.evaluate(() => window.__bootLanguage ?? null); }
  log(`boot (${label}): language pick committed ${JSON.stringify(picked)}`);
  await page.waitForFunction(() => window.__titleMovie?.()?.open === true, null, { timeout: 60_000 });
  await hold("i", 140);
  await page.waitForFunction(() => window.__titleMovie?.()?.open === false, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "prompt", null, { timeout: 60_000 });
  return picked;
};

// ── the opening chain to s210 (auto cutscene handoffs; the counter talk ends it)
const driveOpeningToS210 = async (budgetMs = 300_000) => {
  let lastMap = null;
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const p = await snap();
    if (!p.map) { await page.waitForTimeout(300); continue; }
    if (p.map !== lastMap) { log(`opening: map → ${p.map} (${p.x},${p.y}) ord=${p.ordinal}`); lastMap = p.map; }
    if (p.map === "s210" && !p.cutscene && !p.textbox && !p.packSelect && !p.nameEntry && p.fade === 0) return p;
    if (p.battle) { log("opening: battle mid-chain — fighting it"); return p; }
    if (p.textbox || p.choice) { await hold("Enter", 100); continue; }
    if (p.nameEntry) { await hold("i", 200); await hold("Enter", 200); continue; }
    if (p.packSelect) { await hold("i", 110); await hold("Enter", 130); continue; }
    if (p.cutscene || p.fade !== 0) { await page.waitForTimeout(250); continue; }
    await page.waitForTimeout(150);
  }
  return await snap();
};

// ── the s210 counter talk: place the player at the stand point, face up, talk ─
const counterTalk = async () => {
  const npc = await page.evaluate(() => {
    const list = window.__state?.scenes?.["s210"]?.npcs ?? [];
    const n = list.find((x) => x.npc_id === 32);
    return n ? { x: n.x, y: n.y } : null;
  });
  if (!npc) return { ok: false, why: "NPC 32 not in the live scene" };
  await page.evaluate(([x, y]) => window.__teleport(x, y), [npc.x, npc.y + 25]);
  await page.waitForTimeout(400);
  let aim = null;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down("ArrowUp"); await page.waitForTimeout(30); await page.keyboard.up("ArrowUp");
    aim = await page.evaluate(() => { try { return window.__talkTarget?.(); } catch { return null; } });
    if (aim?.npc === 32) break;
    await page.waitForTimeout(120);
  }
  if (aim?.npc !== 32) return { ok: false, why: `talk target ${JSON.stringify(aim)}` };
  await hold("Enter", 400);                 // first talk (state 0 sets its flag on close)
  await settleDialogue(20_000);
  await hold("ArrowUp", 30);
  await hold("Enter", 400);                 // the second talk's close writes bank 0x90 -> s212
  await settleDialogue(25_000);
  return { ok: true, aim };
};

// ── battles ──────────────────────────────────────────────────────────────────
const battleSnap = () => page.evaluate(() => {
  const b = window.__battleB?.();
  return b ? { state: b.state, ehp: b.enemy?.hp ?? null, php: b.playerRecords?.[0]?.hp ?? null } : null;
});

/** Fight ordinary rounds to a win (enemy shortened to 1 once a hit has landed). */
const fightToWin = async (label, { maxRounds = 20, shortenAfter = 1 } = {}) => {
  await waitForCommandMenu(page);
  let landed = 0, rounds = 0, shortened = false;
  for (; rounds < maxRounds; rounds++) {
    const st = await battleSnap();
    if (!st || st.state == null) break;
    if (st.state === 8) break;
    if (st.state === 9) return { won: false, lost: true, landed };
    if (!shortened && (landed >= shortenAfter || rounds >= 3)) {
      await page.evaluate(() => { const b = window.__battleB?.(); if (b?.enemy) b.enemy.hp = 1; });
      shortened = true;
      log(`battle (${label}): enemy HP shortened to 1 to close the fight`);
    }
    const before = st.ehp;
    await tapCircle(page, 120);
    await runBattleTurn(page, { ticks: 400, until: (s) => s.state === 2 || s.state === 8 || s.state === 9 });
    const after = await battleSnap();
    if (before != null && after?.ehp != null && after.ehp < before) landed++;
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 8 || !window.__battle?.isActive?.(),
    null, { timeout: 30_000 }).catch(() => {});
  return { won: true, landed };
};

/** Read the victory report's own figures, then page it closed. */
const finishVictoryReport = async () => {
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report" || !window.__battle?.isActive?.(),
    null, { timeout: 30_000 }).catch(() => {});
  const report = await page.evaluate(() => {
    const b = window.__battleB?.();
    return b ? { applied: b._winApplied ?? null, reward: b._winReward ?? null, newLevel: b._winNewLevel ?? null, phase: b._victoryPhase ?? null } : null;
  });
  for (let i = 0; i < 40 && await page.evaluate(() => !!window.__battle?.isActive?.()); i++) {
    await tapCircle(page, 150);
    await page.waitForTimeout(350);
  }
  const over = await page.evaluate(() => !window.__battle?.isActive?.());
  return { report, over };
};

/** Start a field battle through the game's own entry, on the ordinary field. */
const startBattle = (o = {}) => page.evaluate(async (opts) => {
  window.__smokeOutcome = null;
  await window.__battle.start({
    enemyId: opts.enemyId ?? 1, enemyLevel: opts.enemyLevel ?? 1, screenId: opts.screenId ?? 200,
    onWin: (r) => { window.__smokeOutcome = { win: r }; },
    onFlee: () => { window.__smokeOutcome = { fled: true }; },
    onLose: () => { window.__smokeOutcome = { lost: true }; },
  });
}, o);

const commandRow = () => page.evaluate(() => window.__battleCmdNative?.diagnostics?.().selection ?? null);
const armRow = async (row) => {
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 });
  for (let i = 0; i < 8 && (await commandRow()) !== row; i++) {
    await tap("ArrowDown");
    await page.waitForTimeout(140);
  }
  return (await commandRow()) === row;
};

// ── doors: stand on the pad (placement), sweep facings, confirm ──────────────
const FACING_KEYS = [
  ["ArrowUp"], ["ArrowDown"], ["ArrowLeft"], ["ArrowRight"],
  ["ArrowUp", "ArrowLeft"], ["ArrowDown", "ArrowRight"],
  ["ArrowUp", "ArrowRight"], ["ArrowDown", "ArrowLeft"],
];
const doorTo = async (map, cx, cy, label, budgetMs = 60_000) => {
  const t0 = Date.now();
  for (let i = 0; i < 24 && Date.now() - t0 < budgetMs; i++) {
    let p = await snap();
    if (p.map !== map) return p;
    await page.evaluate(([x, y]) => window.__teleport(x, y), [cx, cy]);
    await page.waitForTimeout(150);
    const keys = FACING_KEYS[i % FACING_KEYS.length];
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(120);
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(100);
    await hold("Enter", 700);
    p = await settleDialogue(10_000);
    if (p.map !== map) { log(`door ${label}: ${map} → ${p.map}`); return p; }
  }
  log(`door ${label}: still on ${map} at (${(await snap()).x},${(await snap()).y})`);
  return await snap();
};

// ── the shop (translated merchant session; states read off its own memory) ───
const shopActorState = () => page.evaluate(() => {
  const session = window.__shop?._session;
  if (!session) return null;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return actor ? session.mem.read32(actor + 0x10) : null;
});
const waitShopActor = (v) => page.waitForFunction((expected) => {
  const session = window.__shop?._session;
  if (!session) return false;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return actor && session.mem.read32(actor + 0x10) === expected;
}, v, { timeout: 25_000 });
const waitShopRoot = () => page.waitForFunction(() => {
  const s = window.__shop?._session;
  return s && s.mem.read32(s.root + 0x10) === 3;
}, null, { timeout: 25_000 });
const shopResult = () => page.evaluate(() => window.__shop?._session?.result?.() ?? null);
const pressC = async () => { await page.keyboard.down("c"); await page.waitForTimeout(90); await page.keyboard.up("c"); await page.waitForTimeout(350); };
const pressKey = async (key) => { await page.keyboard.down(key); await page.waitForTimeout(90); await page.keyboard.up(key); await page.waitForTimeout(350); };

/** Press through the BUY flow until the wallet reads `wantBits`.
 *
 * One press per state: the merchant root -> the BUY list -> "How many?" -> the
 * Buy/No plate -> the purchase. The walker's session folds between states, so
 * this waits on the wallet rather than assuming a press count; the short first
 * budget covers the "root -> list" press, which cannot move the wallet. */
const driveBuy = async (wantBits) => {
  for (let i = 0; i < 8; i++) {
    await pressC();
    const done = await page.waitForFunction((want) => {
      const r = window.__shop?._session?.result?.();
      return r && r.bits === want;
    }, wantBits, { timeout: i === 0 ? 1200 : 6000 }).then(() => true, () => false);
    if (done) return true;
  }
  return false;
};

// ── the run ──────────────────────────────────────────────────────────────────
try {
  // 1. fresh profile: clear storage, cold boot through the real boot screens.
  await page.goto(`${ROOT}?noEncounters=1`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 30_000 });
  const picked = await driveBootToTitle("first boot");
  check("boot: the language pick commits on a fresh profile", !!picked, JSON.stringify(picked));
  await hold("i", 200);
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 30_000 });
  await hold("ArrowUp", 130);            // Continue -> New Game
  await hold("Enter", 200);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
  log("New Game started:", JSON.stringify(await snap()));
  await shot("01-new-game");

  // 2. the opening chain to the Main Lobby counter (auto handoffs; speed 8 like
  //    the journey check), then the counter talk, then s212 -> s200.
  await speed(8);
  let p = await driveOpeningToS210();
  check("opening: the chain reaches the Main Lobby (s210)", p.map === "s210", `map=${p.map} (${p.x},${p.y})`);
  const talked = await counterTalk();
  check("opening: the counter talk lands on NPC 32 and hands off", talked.ok, talked.why ?? JSON.stringify(talked.aim));
  const atS200 = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 90_000) {
      const q = await settleDialogue(2_000);
      if (q.map === "s200") return q;
      await page.waitForTimeout(200);
    }
    return await snap();
  })();
  check("opening: the partner download carries the player to Asuka City (s200)", atS200.map === "s200", `map=${atS200.map}`);
  await shot("02-s200-arrival");
  await speed(1);

  // 3. the scripted first battle (the s200 PRE fires on entry), then the POST to s220.
  const battleUp = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      if (await page.evaluate(() => !!window.__battle?.isActive?.())) return true;
      await settleDialogue(2_000);
      await page.waitForTimeout(200);
    }
    return false;
  })();
  check("battle 1: the s200 PRE launches the scripted first fight", battleUp);
  if (battleUp) {
    const res = await fightToWin("s200 story");
    const fin = await finishVictoryReport();
    check("battle 1: the fight resolves and the field comes back", fin.over, `landed=${res.landed}`);
  }
  await shot("03-battle1-won");
  await speed(4);
  const s220 = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const q = await settleDialogue(2_000);
      if (q.map === "s220" && !q.textbox && !q.cutscene) return q;
      await page.waitForTimeout(200);
    }
    return await snap();
  })();
  check("battle 1: the POST carries the player to the DigiLab (s220)", s220.map === "s220", `map=${s220.map}`);
  await speed(1);

  // 4. battle 2 — a digivolution stands in: the main level must rise with the
  //    ROOKIE's curve and the form's DV level must rise (see the header).
  await page.evaluate(() => {
    const ps = window.__state.partnerStats;
    ps.digimonId = 30; ps.level = 1; ps.xp = 9;
    ps.equippedForms = [30];
    ps.formLedger = [{ id: 30, formLevel: 1, dvexp: 9, techSlots: [0, 0, 0, 0, 0, 0] }];
  });
  await startBattle({});
  const b2 = await fightToWin("digivolution");
  const b2report = await finishVictoryReport();
  const after2 = await sessionState();
  check("battle 2: the win applied its rewards exactly once", b2report.report?.applied === true,
    JSON.stringify(b2report.report?.reward));
  check("battle 2: the main level rose on the ROOKIE curve (level 2, xp 13 — the form curve would say 4)",
    after2.level === 2 && after2.xp === 13, `level=${after2.level} xp=${after2.xp}`);
  check("battle 2: the report's own new level agrees", b2report.report?.newLevel === 2, `newLevel=${b2report.report?.newLevel}`);
  check("battle 2: the form's DV level rose (1 → 2) with its DVEXP bank",
    after2.form30?.formLevel === 2 && after2.form30?.dvexp === 14, JSON.stringify(after2.form30));
  // The bank: the ladder's gain is level-scaled (F0x80086924 -> dvexpGain), and the
  // level it reads is the post-level-up one (2): expShare(floor(1*10/2)=5, 1) = 5.
  // 9 + 5 = 14 >= the form level 2 threshold (10), below the level 3 one (20).
  await shot("04-battle2-report");

  // 5. battle 3 — a Run, on a WILD screen (34 = a Kunemon walk-up: the story
  //    screens carry the no-run flag, the wild band does not). Faster than the
  //    enemy, the roll is certain.
  await startBattle({ screenId: 34 });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.player.spd = 999; b.enemy.spd = 1; });
  const armedRun = await armRow(5);
  check("battle 3: the Run row arms", armedRun, `row=${await commandRow()}`);
  await tap("Enter");
  await runBattleTurn(page, { ticks: 160, until: (s) => s.gone });
  for (let i = 0; i < 10 && await page.evaluate(() => !!window.__battle?.isActive?.()); i++) {
    await tapCircle(page, 150);
    await page.waitForTimeout(300);
  }
  const fled = await page.evaluate(() => ({ outcome: window.__smokeOutcome, active: !!window.__battle?.isActive?.() }));
  check("battle 3: the Run got away and the field returned",
    fled.outcome?.fled === true && fled.active === false, JSON.stringify(fled));
  await shot("05-after-battles");

  // 7. map transitions: s220 → s200 (walked through the door pad, placement only).
  await speed(4);
  p = await doorTo("s220", 192, 384, "s220→s200");
  check("transitions: s220 → s200", p.map === "s200", `map=${p.map}`);
  p = await doorTo("s200", 576, 416, "s200→s245");
  check("transitions: s200 → s245 (the shop street)", p.map === "s245", `map=${p.map}`);

  // 8. the shop: talk to the merchant, BUY two PowerCharges, SELL one back.
  const shopNpc = await page.evaluate(() => {
    const list = window.__state?.scenes?.["s245"]?.npcs ?? [];
    const n = list.find((x) => x.npc_id === 22);
    return n ? { x: n.x, y: n.y } : null;
  });
  check("shop: the merchant (NPC 22) is on s245", !!shopNpc, JSON.stringify(shopNpc));
  await page.evaluate(([x, y]) => window.__teleport(x, y), [shopNpc.x, shopNpc.y + 24]);
  await page.waitForTimeout(400);
  let shopAim = null;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down("ArrowUp"); await page.waitForTimeout(30); await page.keyboard.up("ArrowUp");
    shopAim = await page.evaluate(() => { try { return window.__talkTarget?.(); } catch { return null; } });
    if (shopAim?.npc === 22) break;
    await page.waitForTimeout(120);
  }
  check("shop: the merchant answers the talk", shopAim?.npc === 22, JSON.stringify(shopAim));
  await hold("Enter", 400);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__shop?.isOpen?.())) break;
    await tap("Enter");
    await page.waitForTimeout(300);
  }
  await waitShopRoot();
  const bitsBeforeShop = (await sessionState()).bits;
  await shot("06-shop-open");
  check("shop: the first PowerCharge bought (bits -12)", await driveBuy(bitsBeforeShop - 12));
  check("shop: the second PowerCharge bought (bits -24)", await driveBuy(bitsBeforeShop - 24));
  const afterBuys = await shopResult();
  check("shop: two PowerCharges bought (bits -24, qty 2)",
    afterBuys?.bits === bitsBeforeShop - 24
    && afterBuys.inventory.find((r) => Number(r.id) === 43)?.qty === 2,
    JSON.stringify({ bits: afterBuys?.bits, bag: afterBuys?.inventory }));
  // Back to the merchant root, then SELL: category row 0 is the charge/disk directory.
  await pressKey("Escape");
  await waitShopRoot();
  await pressKey("ArrowDown");
  await pressC();
  await waitShopActor(2);                // the category rows
  await pressC();                        // row 0 = the charges/disks directory
  await waitShopActor(6);                // the SELL list
  const sellRow = await page.evaluate(() => {
    const session = window.__shop._session;
    const context = session.mem.read32(session.root + 0x24);
    const actor = session.mem.read32(context + 0x1c);
    const list = session.mem.read32(session.mem.read32(actor + 0x24));
    return { count: session.mem.read32(list + 0x6c0), id: session.mem.read16(list + 0x64) };
  });
  // The list's own count field is the number of ROWS (one per held id), not the
  // quantity: one PowerCharge row, id 43, however many copies are held.
  check("shop: the SELL list shows the PowerCharge (id 43)", sellRow.id === 43 && sellRow.count === 1, JSON.stringify(sellRow));
  await pressC();
  await waitShopActor(0x17);
  await pressC();
  await waitShopActor(0x20);
  await pressC();
  await waitShopActor(6);
  const afterSell = await shopResult();
  check("shop: one sold back (bits -18, qty 1)",
    afterSell?.bits === bitsBeforeShop - 18
    && afterSell.inventory.find((r) => Number(r.id) === 43)?.qty === 1,
    JSON.stringify({ bits: afterSell?.bits, bag: afterSell?.inventory }));
  await shot("07-shop-sold");
  for (let i = 0; i < 6 && await page.evaluate(() => !!window.__shop?.isOpen?.()); i++) await pressKey("Escape");
  check("shop: the merchant closes", !(await page.evaluate(() => !!window.__shop?.isOpen?.())));

  // 9. battle 4 — the item use, with the PowerCharge the shop just sold: wound
  //    the lead, take the Item row, use it, and let the fight finish.
  await startBattle({ screenId: 34 });
  await waitForCommandMenu(page);
  await page.evaluate(() => { window.__battleB().playerRecords[0].hp = 40; });
  const bagBeforeItem = (await sessionState()).bag;
  check("battle 4: the bag carries the bought PowerCharge", JSON.stringify(bagBeforeItem) === JSON.stringify([[43, 1]]),
    JSON.stringify(bagBeforeItem));
  const armedItem = await armRow(4);
  check("battle 4: the Item row arms", armedItem, `row=${await commandRow()}`);
  await tap("Enter");                    // open the Item list
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(() => window.__battleB?.()?.state === 4)) break;
    await tap("Enter");
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready === true, null, { timeout: 20_000 }).catch(() => {});
  await tap("Enter");                    // use PowerCharge
  await runBattleTurn(page, { ticks: 200, until: (s) => s.state === 2 || s.state === 8 || s.state === 9 });
  const afterItem = await page.evaluate(() => ({
    php: window.__battleB?.()?.playerRecords?.[0]?.hp ?? null,
    bag: (window.__state.inventory ?? []).map((i) => [Number(i.id), Number(i.qty)]),
  }));
  check("battle 4: the item was consumed from the bag", JSON.stringify(afterItem.bag) === JSON.stringify([]),
    JSON.stringify(afterItem.bag));
  check("battle 4: the heal moved the lead's HP", afterItem.php != null && afterItem.php > 40, `hp=${afterItem.php}`);
  const b4 = await fightToWin("item use");
  const b4fin = await finishVictoryReport();
  check("battle 4: the fight resolves after the item", b4fin.over && b4.won);

  // 10. two more transitions: back to the city, then the inn door.
  p = await doorTo("s245", 384, 416, "s245→s200");
  check("transitions: s245 → s200", p.map === "s200", `map=${p.map}`);
  p = await doorTo("s200", 672, 368, "s200→s235");
  check("transitions: s200 → s235 (the inn)", p.map === "s235", `map=${p.map}`);
  await speed(1);

  // 10. the inn: rest at the innkeeper, then save through the card.
  await page.evaluate(() => window.__teleport(188, 184));
  await page.waitForTimeout(400);
  let innAim = null;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down("ArrowUp"); await page.waitForTimeout(30); await page.keyboard.up("ArrowUp");
    innAim = await page.evaluate(() => { try { return window.__talkTarget?.(); } catch { return null; } });
    if (innAim?.npc === 20) break;
    await page.waitForTimeout(120);
  }
  check("inn: the innkeeper answers the talk", innAim?.npc === 20, JSON.stringify(innAim));
  const bitsBeforeRest = (await sessionState()).bits;
  await hold("Enter", 400);
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__inn?.isOpen?.())) break;
    await tap("Enter");
    await page.waitForTimeout(350);
  }
  await page.waitForFunction(() => window.__inn?.isOpen?.()
    && (window.__inn.diagnostics?.().state?.step ?? null) === 3, null, { timeout: 30_000 });
  const innInfo = await page.evaluate(() => ({
    price: window.__inn.diagnostics().inn?.price ?? null,
    party: window.__inn.diagnostics().state?.party ?? null,
    selection: window.__inn.selection?.() ?? null,
  }));
  check("inn: the rest screen quotes the decoded price and party", innInfo.price === 8 && innInfo.party >= 1,
    JSON.stringify(innInfo));
  await shot("08-inn-open");
  await tap("Enter");                    // Stay in Inn (selection 0)
  await page.waitForFunction(() => !window.__inn?.isOpen?.(), null, { timeout: 60_000 });
  const afterRest = await sessionState();
  check("inn: the stay charged price × party and healed the lead",
    afterRest.bits === bitsBeforeRest - innInfo.price * innInfo.party
    && afterRest.hp === afterRest.maxHp,
    JSON.stringify({ bits: afterRest.bits, want: bitsBeforeRest - innInfo.price * innInfo.party, hp: afterRest.hp, maxHp: afterRest.maxHp }));
  await shot("09-inn-rested");

  // 11. save to the card through the inn's own save entry (openMemoryCard("save"),
  //     the call the save-point HANDOFF makes).
  const slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); }, { timeout: 60_000 });
  check("save: the card wrote a slot", slot != null, `slot=${slot}`);
  const written = await page.evaluate((n) => JSON.parse(localStorage.getItem(`mcardSlot${n}`) ?? "null"), slot);
  check("save: the file carries the inn's own place index (43 = Asuka Inn)",
    written?.record?.placeIndex === 43, JSON.stringify({ placeIndex: written?.record?.placeIndex, bits: written?.record?.bits }));
  const beforeReload = await sessionState();
  log("state before reload:", JSON.stringify(beforeReload));
  await shot("10-saved");

  // 12. reload: the boot screens come back, then title → Continue → load.
  await page.goto(`${ROOT}?skipLanguage=1&noEncounters=1`);
  await openContinueCard(page);
  check("reload: the title's Continue opens the memory card in LOAD mode",
    (await cardWindow(page)) === 2, `window=${await cardWindow(page)}`);
  await loadFromCard(page);
  const afterReload = await sessionState();
  log("state after load:", JSON.stringify(afterReload));
  await shot("11-reloaded-field");
  check("reload: the game resumes in the field at the inn (s235)", afterReload.map === "s235", `map=${afterReload.map}`);
  check("reload: name / bits / level / xp / form all identical",
    afterReload.name === beforeReload.name && afterReload.bits === beforeReload.bits
    && afterReload.level === beforeReload.level && afterReload.xp === beforeReload.xp
    && afterReload.digimonId === beforeReload.digimonId
    && JSON.stringify(afterReload.form30) === JSON.stringify(beforeReload.form30),
    JSON.stringify({ before: beforeReload, after: afterReload }));
  check("reload: the bag and the party are identical",
    JSON.stringify(afterReload.bag) === JSON.stringify(beforeReload.bag)
    && JSON.stringify(afterReload.party) === JSON.stringify(beforeReload.party),
    JSON.stringify({ bagBefore: beforeReload.bag, bagAfter: afterReload.bag }));

  // 13. a card duel on the field: the lab entry opens the real translated duel;
  //     real key events drive it to a close (the field-NPC duel route is the
  //     King of Cards and native-duel checks' job). The duel builds its screen
  //     object asynchronously, so both waits matter: the host opening, then the
  //     duel object itself appearing.
  await page.evaluate(() => window.__labOpen("cardduel", 1));
  await page.waitForFunction(() => window.__cardDuelNative?.isOpen?.() === true, null, { timeout: 25_000 });
  await page.waitForFunction(() => window.__nativeScreenObjects?.().some((o) => o.cb === 0x800a2f00), null, { timeout: 25_000 });
  const duelSnap = () => page.evaluate(() => {
    const duel = window.__nativeScreenObjects().find((o) => o.cb === 0x800a2f00);
    if (!duel) return { closed: true, open: window.__cardDuelNative?.isOpen?.() === true };
    return { closed: false, open: true, mode: window.__nativeScreenRead(duel.addr + 0x2f8, 1) };
  });
  let board = await duelSnap();
  let seeded = false;
  for (let i = 0; i < 40 && board.mode !== 4 && !board.closed; i++) {
    await tapCircle(page, 160);
    await page.waitForTimeout(180);
    board = await duelSnap();
    if (!seeded && board.mode === 3) {
      await page.evaluate(() => {
        const duel = window.__nativeScreenObjects().find((o) => o.cb === 0x800a2f00);
        window.__nativeScreenWrite(duel.addr + 0x66c, 5, 2);   // a five-card opponent deck
      });
      seeded = true;
    }
  }
  check("duel: the board reaches its Draw Phase (mode 4)", board.mode === 4, JSON.stringify(board));
  await shot("12-duel-board");
  let after = board;
  for (let i = 0; i < 30 && !(after.closed && !after.open); i++) {
    await tapCircle(page, 160);
    await page.waitForTimeout(200);
    after = await duelSnap();
  }
  check("duel: the duel closed back to the field", after.closed === true && after.open === false, JSON.stringify(after));
  await page.waitForTimeout(800);

  // 14. a couple more transitions after the reload: inn → city → DigiLab.
  p = await doorTo("s235", 288, 224, "s235→s200");
  check("transitions: s235 → s200 after the reload", p.map === "s200", `map=${p.map}`);
  p = await doorTo("s200", 1056, 512, "s200→s220");
  check("transitions: s200 → s220", p.map === "s220", `map=${p.map}`);
  await shot("13-final-field");

  // 15. the error budget over the whole session.
  check("no page errors across the whole session", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("no unexpected failed requests", unexpectedFailed().length === 0, unexpectedFailed().slice(0, 3).join(" | "));
  check("no unexpected >=400 responses", unexpectedHttp().length === 0, unexpectedHttp().slice(0, 3).join(" | "));
} catch (e) {
  failures++;
  console.error("SMOKE ERROR:", e);
  try { await page.screenshot({ path: `${OUT}/failure.png` }); } catch { /* page gone */ }
} finally {
  await browser.close();
}

console.log("\n== error detail ==");
console.log("console errors:", consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 6)));
console.log("page errors:", pageErrors.length, JSON.stringify(pageErrors.slice(0, 6)));
console.log("failed requests:", failedRequests.length, JSON.stringify(failedRequests.slice(0, 6)));
console.log("http >= 400:", httpErrors.length, JSON.stringify(httpErrors.slice(0, 6)));
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${checks.filter((c) => c.ok).length}/${checks.length} checks, screenshots in ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
