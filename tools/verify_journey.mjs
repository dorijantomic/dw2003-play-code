// tools/verify_journey.mjs — the early-game journey, driven the way a player
// meets it, on the ordinary (translated) route with keyboard input only.
//
//   1. boot: the first-launch visual-style chooser (Authentic PS1), the
//      language pick, the opening movie (skipped) → title → New Game
//   2. the authored opening chain: s780 → s785 → s790 → s225 → s210, where the
//      player walks to the Tamer Service counter (NPC 32) and talks; the talk
//      hands off to s212 (the partner download) and then to s200 (Asuka City).
//   3. the first story battle: s200's PRE (Genji) arms and the scripted fight
//      (Kuwagamon) launches on entry. One ordinary turn is fought for real;
//      the enemy's HP is then shortened to 1 (the same documented shortening
//      tools/verify_first_story_battle.mjs uses) so the ordinary FIGHT command
//      can end the fight and the journey can carry on to the field.
//   4. back on the field (s220 after the POST), the pause menu is opened with
//      START, a row is walked, and Back closes it.
//   5. the save: s220 → s200 → s235 (Asuka Inn). The Guardromon save clerk
//      (NPC 21) is talked to; its dialogue's own bank-0x90 write starts the
//      "PREPARE TO SAVE." event, whose HANDOFF 0xC01 opens the memory card in
//      SAVE mode. The card is driven to a write in slot 1.
//   6. reload: the page is reloaded and the boot screens drive again (the
//      language pick and movie come back; the visual-style chooser does not —
//      the first boot saved it). The title's Continue opens the card in LOAD
//      mode, the saved file is loaded, and the game comes back in the field
//      at the inn with the saved state.
//
// The pause menu has NO Save row — the pause home list is ITEMS / SORT / MAP /
// TECHNIQUES / STATUS / CARD FOLDERS (tools/pause_explorer_report.py TOP_ROWS,
// engine/dw3/ui/pause-root-session.ts). The original saves only at save points
// (engine/dw3/save-points.ts); this script drives that real route.
//
// Screenshots land in the output dir (default .bunny-scratch/journey-out/).
// Run: VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_journey.mjs
// Serve web/ first: python3 -m http.server <port> --directory web
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, runBattleTurn, tapCircle } from "./verify-battle-wait.mjs";
import { openContinueCard, loadFromCard, cardWindow } from "./memcard-continue.mjs";

const ROOT = `${baseUrl(8741)}/`;
const OUT = process.env.JOURNEY_SHOT ?? ".bunny-scratch/journey-out";
mkdirSync(OUT, { recursive: true });
// Debug aid: stop after a named phase and exit 0 (phases: opening, battle, pause, inn, save).
const STOP_AFTER = process.env.JOURNEY_STOP_AFTER ?? "";

let failures = 0;
const checks = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  checks.push({ name, ok, detail });
  if (!ok) failures++;
};
const log = (...a) => console.log("[journey]", ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [], pageErrors = [], failedRequests = [], httpErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("requestfailed", (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText ?? ""}`));
page.on("response", (r) => { if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`); });

// The two optional files this build does not carry: the fight UI atlas (never
// built by the disc route; web/battle.js falls back to its procedural chrome)
// and the HD overlay manifest (web/assets.js: "Normal when an authentic-only
// build has no assets-hd directory"). Any OTHER >=400 is a real failure.
const KNOWN_OPTIONAL_404 = [
  /assets\/ui\/fight_ui\.png/,
  /assets-hd\/manifest\.json/,
  // An optional per-model override no shipped model carries; the loader probes
  // for it and every battle verifier in tools/ ignores its 404 (verify_blast,
  // verify_action_lab, verify_generated_model, ...).
  /slot_map\.json$/,
];
const unexpectedHttpErrors = () => httpErrors.filter((r) => !KNOWN_OPTIONAL_404.some((re) => re.test(r)));
// The skipped opening movie aborts mid-load by design, and the first-launch
// visual-style chooser RELOADS the page (driveBootToTitle) while the boot's own
// eager asset fetch (~430 scene/data files) is still in flight — the browser
// cancels every in-flight request, all reported as net::ERR_ABORTED. Neither is
// a game failure: the game code never aborts a fetch (no AbortController in
// web/), so an ERR_ABORTED is always a navigation the harness itself caused.
// Real failures (ERR_FAILED, connection refused, DNS) still count.
const unexpectedFailed = () =>
  failedRequests.filter((r) =>
    !/movieopn\.mp4/.test(r) && !/:: net::ERR_ABORTED$/.test(r));

const counts = () => ({
  consoleErrors: consoleErrors.length, pageErrors: pageErrors.length,
  failedRequests: failedRequests.length, httpErrors: httpErrors.length,
  unexpected: unexpectedHttpErrors().length,
});
const stepCounts = {};
const mark = (label) => { stepCounts[label] = counts(); };

const hold = async (key, ms = 130) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(80);
};

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
  };
});

// ── collision-grid pathfinding (navigation only; reads the live grid) ─────────
const readGrid = (map) => page.evaluate((m) => {
  const g = window.__state?.collision?.[m];
  const sc = window.__state?.scenes?.[m];
  if (!g) return null;
  return {
    cell: g.cell, cols: g.cols, rows: g.rows,
    cells: Array.from(g.cells ?? []),
    exits: (sc?.exits ?? []).map((e) => ({ to: e.to, x: e.x, y: e.y, w: e.w, h: e.h })),
    // NPCs are solid to the player: a route straight through one wedges the
    // walker against its body (measured: stuck at 410,357 against the pair at
    // 391,359 on s210).
    npcs: (sc?.npcs ?? []).filter((n) => n.x || n.y).map((n) => ({ x: n.x, y: n.y })),
  };
}, map);

/** BFS cell path start→target on the PLAYER's own passability: the game moves
 *  the player as a 12x8 foot box (engine/core/util/collision.ts
 *  moveWithCollision, the exact test web/game.js runs per field tick), so a
 *  route the box cannot fit through is not a route. Returns corner waypoints
 *  in pixels (or null). */
const planPath = async (map, tx, ty, allowExit = null) => {
  const g = await readGrid(map);
  if (!g) return null;
  const { cell, cols, rows, cells } = g;
  const p = await snap();
  const buildAvoid = (skipAll) => {
    const avoid = new Set();
    if (skipAll) return avoid;
    for (const e of g.exits ?? []) {
      if (allowExit != null && e.to === allowExit) continue;
      // Never block the rect the player is standing in: the arrival pad of the
      // handoff that brought us here is often the only opening in a walled
      // corner, and sealing it sealed the whole map (s210, arrival at 730,382
      // inside the s225 pad).
      if (p.x >= e.x - 8 && p.x < e.x + e.w + 8 && p.y >= e.y - 8 && p.y < e.y + e.h + 8) continue;
      const c0 = Math.floor(e.x / cell) - 1, c1 = Math.floor((e.x + e.w - 1) / cell) + 1;
      const r0 = Math.floor(e.y / cell) - 1, r1 = Math.floor((e.y + e.h - 1) / cell) + 1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) avoid.add(r * cols + c);
    }
    // NPC bodies (16px around each): the field refuses a step whose foot
    // perimeter lands inside another actor's footprint (web/game.js
    // fieldStepBlockedByActors), so routes go around people, not through them.
    for (const n of g.npcs ?? []) {
      const c0 = Math.floor((n.x - 16) / cell), c1 = Math.floor((n.x + 16) / cell);
      const r0 = Math.floor((n.y - 16) / cell), r1 = Math.floor((n.y + 16) / cell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        if (Math.hypot((c + 0.5) * cell - n.x, (r + 0.5) * cell - n.y) <= 16) avoid.add(r * cols + c);
      }
    }
    return avoid;
  };
  const search = (avoid) => {
    const rawBlocked = (c, r) =>
      c < 0 || r < 0 || c >= cols || r >= rows || cells[r * cols + c] === 1 || avoid.has(r * cols + c);
    // The foot box: {w:12, h:8} centred on x and standing on y, tested at cell
    // granularity exactly as rectBlocked does.
    const boxBlocked = (cx, cy) => {
      const c0 = Math.floor((cx - 6) / cell), c1 = Math.floor((cx + 6) / cell);
      const r0 = Math.floor((cy - 8) / cell), r1 = Math.floor(cy / cell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (rawBlocked(c, r)) return true;
      return false;
    };
    const passable = new Set();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!boxBlocked((c + 0.5) * cell, (r + 0.5) * cell)) passable.add(r * cols + c);
    }
    const near = (c, r) => {
      if (passable.has(r * cols + c)) return [c, r];
      for (let rad = 1; rad < 40; rad++)
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          if (passable.has((r + dr) * cols + (c + dc))) return [c + dc, r + dr];
        }
      return null;
    };
    const S = near(Math.floor(p.x / cell), Math.floor(p.y / cell));
    const T = near(Math.floor(tx / cell), Math.floor(ty / cell));
    if (!S || !T) return null;
    const key = (c, r) => r * cols + c;
    const prev = new Map([[key(...S), null]]);
    const q = [S];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
      const [c, r] = q.shift();
      if (c === T[0] && r === T[1]) {
        const path = [];
        let cur = [c, r];
        while (cur) { path.push(cur); cur = prev.get(key(...cur)); }
        path.reverse();
        const pts = path.map(([cc, rr]) => [(cc + 0.5) * cell, (rr + 0.5) * cell]);
        const out = [pts[0]];
        let dir = null;
        for (let i = 1; i < pts.length; i++) {
          const d = Math.abs(pts[i][0] - pts[i - 1][0]) > 1 ? "h" : "v";
          if (d !== dir && i > 1) out.push(pts[i - 1]);
          dir = d;
        }
        out.push([tx, ty]);
        return out;
      }
      for (const [dc, dr] of DIRS) {
        const nc = c + dc, nr = r + dr, k = key(nc, nr);
        if (prev.has(k) || !passable.has(k)) continue;
        prev.set(k, [c, r]);
        q.push([nc, nr]);
      }
    }
    return null;
  };
  return search(buildAvoid(false)) ?? search(buildAvoid(true));
};

/** Walk to (tx,ty) on `map` with ordinary arrow keys, following a grid path.
 *  Pure pursuit along the polyline (the approach tools/journey1.mjs proved on
 *  these maps): steer at a point ~14px ahead of the player's own projection
 *  onto the path, so corridors are ridden down their midline instead of
 *  hopping between cell centres. */
const walkTo = async (map, tx, ty, label, { budgetMs = 90_000, allowExit = null } = {}) => {
  const setPlan = async () => {
    const np = await planPath(map, tx, ty, allowExit);
    if (!np) return false;
    wps = np;
    cum.length = 0;
    cum.push(0);
    for (let i = 1; i < wps.length; i++)
      cum.push(cum[i - 1] + Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][1] - wps[i - 1][1]));
    total = cum[cum.length - 1];
    return true;
  };
  let wps = [], cum = [], total = 0;
  if (!await setPlan()) { log(`walk ${label}: no path on the grid`); return await snap(); }
  log(`walk ${label}: ${wps.length} waypoint(s)`);
  const pointAt = (d) => {
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = cum[i] === cum[i - 1] ? 0 : (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    return [wps[i - 1][0] + (wps[i][0] - wps[i - 1][0]) * t, wps[i - 1][1] + (wps[i][1] - wps[i - 1][1]) * t];
  };
  const LOOK = 14;
  const t0 = Date.now();
  let replans = 0, still = 0, lx = -1, ly = -1;
  while (Date.now() - t0 < budgetMs) {
    const p = await snap();
    if (p.battle) { log(`walk ${label}: battle mid-walk`); if (!(await fightToEnd("random"))) return p; continue; }
    if (p.textbox || p.choice) { await settleDialogue(4_000); continue; }
    if (p.map !== map) { log(`walk ${label}: left ${map} → ${p.map}`); return p; }
    // Progress along the polyline = projection of the player's position.
    let best = 0, bd = Infinity;
    for (let i = 0; i < wps.length - 1; i++) {
      const [ax, ay] = wps[i], [bx, by] = wps[i + 1];
      const vx = bx - ax, vy = by - ay;
      const L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / L2));
      const dd = Math.hypot(p.x - (ax + vx * t), p.y - (ay + vy * t));
      if (dd < bd) { bd = dd; best = cum[i] + Math.sqrt(L2) * t; }
    }
    if (total - best < 22) {
      const dx = tx - p.x, dy = ty - p.y;
      if (Math.abs(dx) < 26 && Math.abs(dy) < 26) {
        // Tighten up with micro-taps: talk ranges are 48px but the facing cone
        // wants a close stand, and exit pads read the tile under the feet.
        let q = p;
        for (let i = 0; i < 30; i++) {
          const ddx = tx - q.x, ddy = ty - q.y;
          if (Math.hypot(ddx, ddy) <= 8) break;
          const keys = [];
          if (ddx > 2) keys.push("ArrowRight"); else if (ddx < -2) keys.push("ArrowLeft");
          if (ddy > 2) keys.push("ArrowDown"); else if (ddy < -2) keys.push("ArrowUp");
          if (!keys.length) break;
          for (const k of keys) await page.keyboard.down(k);
          await page.waitForTimeout(35);
          for (const k of keys.reverse()) await page.keyboard.up(k);
          await page.waitForTimeout(45);
          const nq = await snap();
          if (nq.map !== map) return nq;
          if (nq.x === q.x && nq.y === q.y) break; // blocked; stand where we are
          q = nq;
        }
        log(`walk ${label}: arrived (${q.x},${q.y})`);
        return q;
      }
    }
    if (Math.abs(p.x - lx) < 1 && Math.abs(p.y - ly) < 1) {
      if (++still >= 20) {
        still = 0;
        if (++replans > 40) {
          const d = Math.hypot(tx - p.x, ty - p.y);
          if (d <= 40) { log(`walk ${label}: close enough (${d.toFixed(0)}px) at (${p.x},${p.y})`); return p; }
          log(`walk ${label}: STUCK at (${p.x},${p.y}) after nudges`); return p;
        }
        // Nudge: probe all four directions with short holds; pursuit re-acquires
        // from wherever the probes end.
        for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
          await page.keyboard.down(k);
          await page.waitForTimeout(250);
          await page.keyboard.up(k);
          const q = await snap();
          if (q.map !== map) { log(`walk ${label}: map ${map} → ${q.map} on nudge`); return q; }
        }
        log(`walk ${label}: nudge ${replans} done at (${(await snap()).x},${(await snap()).y})`);
        if (!await setPlan()) return await snap();
        lx = -1;
        continue;
      }
    } else { still = 0; lx = p.x; ly = p.y; }
    const [gx, gy] = pointAt(best + LOOK);
    const dx = gx - p.x, dy = gy - p.y;
    if (Math.hypot(dx, dy) < 8) continue;
    const keys = [];
    if (dx > 6) keys.push("ArrowRight"); else if (dx < -6) keys.push("ArrowLeft");
    if (dy > 6) keys.push("ArrowDown"); else if (dy < -6) keys.push("ArrowUp");
    if (!keys.length) continue;
    // Hold both axes: the engine resolves them separately, so diagonals slide
    // along walls instead of jamming against them.
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(120);
    for (const k of keys.reverse()) await page.keyboard.up(k);
    await page.waitForTimeout(40);
  }
  log(`walk ${label}: budget out at`, JSON.stringify(await snap()));
  return await snap();
};

/** Advance any textbox / choice with the confirm key until nothing is up. */
const settleDialogue = async (budgetMs = 30_000) => {
  const t0 = Date.now();
  let lastText = "";
  while (Date.now() - t0 < budgetMs) {
    const p = await snap();
    if (p.battle) return p;
    if (p.textbox || p.choice) {
      const text = await page.evaluate(() => {
        try { return window.__textbox?.isOpen?.() ? window.__textbox.currentPage().join(" ").slice(0, 120) : ""; } catch { return ""; }
      });
      if (text && text !== lastText) { lastText = text; log(`dialogue: "${text}"`); }
      await hold("Enter", 250);
      continue;
    }
    return p;
  }
  return await snap();
};

// ── the opening chain driver ──────────────────────────────────────────────────
// Reaches s200 from New Game, handling: textboxes/choices (Enter), the naming
// screen (Start jumps to its OK cell, Enter commits), the starter-pack wizard
// (the same press sequence tools/verify_opening_chain.mjs uses), and the s210
// counter talk (walk to NPC 32, face it, Space).
const driveOpeningToS200 = async (budgetMs = 420_000) => {
  let lastBash = 0, talkedAtCounter = false, lastMap = null;
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    const p = await snap();
    if (!p.map) { await page.waitForTimeout(300); continue; }
    if (p.map !== lastMap) { log(`map → ${p.map} (${p.x},${p.y}) ord=${p.ordinal}`); lastMap = p.map; }
    if (p.map === "s200") return p;
    if (p.battle) { if (!(await fightToEnd("opening"))) return p; continue; }
    if (p.textbox || p.choice) { await hold("Enter", 100); continue; }
    if (p.nameEntry) { await hold("i", 200); await hold("Enter", 200); continue; }
    if (p.packSelect) {
      // The registration wizard, mashed through the way a player does: the
      // account-name keyboard jumps to its OK cell with Start ("i") and accepts
      // with confirm; the pack list and the "Register account?" panel take
      // confirm. The introduction pages with confirm too, so keep pressing until
      // the wizard closes (it takes ~40-50 presses: pages, then the panels).
      await hold("i", 110);
      await hold("Enter", 130);
      continue;
    }
    if (p.cutscene || p.fade !== 0) { await page.waitForTimeout(250); continue; }
    // On the Main Lobby the counter talk is the route: walk to NPC 32 and talk.
    if (p.map === "s210" && !talkedAtCounter) {
      const npc = await page.evaluate(() => {
        const list = window.__state?.scenes?.["s210"]?.npcs ?? [];
        const n = list.find((x) => x.npc_id === 32);
        return n ? { x: n.x, y: n.y } : null;
      });
      if (!npc) { log("s210: NPC 32 not in the live scene"); talkedAtCounter = true; continue; }
      log(`s210: walking to the counter NPC 32 at (${npc.x},${npc.y})`);
      const at = await walkTo("s210", npc.x, npc.y + 24, "s210:counter", { budgetMs: 90_000 });
      if (at.map !== "s210") { talkedAtCounter = false; continue; }
      // Face up (the NPC is above the stand point) and check the talk target.
      for (let i = 0; i < 10; i++) {
        await page.keyboard.down("ArrowUp"); await page.waitForTimeout(30); await page.keyboard.up("ArrowUp");
        const aim = await page.evaluate(() => { try { return window.__talkTarget?.(); } catch { return null; } });
        if (aim?.npc === 32) break;
        await page.waitForTimeout(120);
      }
      const aim = await page.evaluate(() => { try { return window.__talkTarget?.(); } catch { return null; } });
      log(`s210: talk target ${JSON.stringify(aim)}`);
      if (aim?.npc !== 32) { log("s210: NPC 32 not addressed — retry"); talkedAtCounter = false; continue; }
      talkedAtCounter = true;
      await hold("Enter", 400); // first talk (state 0 sets its flag on close)
      await settleDialogue(20_000);
      // The second talk is the one whose on_close writes bank 0x90 → the s212 handoff.
      await hold("ArrowUp", 30);
      await hold("Enter", 400);
      await settleDialogue(25_000);
      continue;
    }
    // A confirm plate with nothing up: a player mashes confirm once in a while.
    if (Date.now() - lastBash > 900) { lastBash = Date.now(); await hold("Enter", 120); continue; }
    await page.waitForTimeout(100);
  }
  return await snap();
};

// ── battles ───────────────────────────────────────────────────────────────────
/** Read + confirm the battle's command phase and fight ordinary rounds. */
const fightToEnd = async (label, { maxRounds = 30 } = {}) => {
  log(`battle (${label}): waiting for the command menu`);
  await waitForCommandMenu(page);
  const opened = await page.evaluate(() => {
    const b = window.__battleB?.();
    const p = window.__battle?.peek?.();
    return {
      state: b?.state ?? null, screenId: b?.screenId ?? null,
      enemy: b?.enemy?.profile?.name ?? null, enemyHp: b?.enemy?.hp ?? null,
      player: b?.player?.profile?.name ?? null, menu: p?.menu ?? null, menuSel: p?.menuSel ?? null,
    };
  });
  log(`battle (${label}) opened: ${JSON.stringify(opened)}`);
  let landed = 0, sawAction = false, realRounds = 0, shortened = false;
  const states = [];
  for (let round = 0; round < maxRounds; round++) {
    const st = await page.evaluate(() => ({
      state: window.__battleB?.()?.state ?? null,
      enemyHp: window.__battleB?.()?.enemy?.hp ?? null,
      playerHp: window.__battleB?.()?.player?.hp ?? null,
    }));
    if (st.state == null) { log(`battle (${label}): over`); break; }
    if (st.state === 8) break; // won → report flow below
    if (st.state === 9) { log(`battle (${label}): LOST`); return false; }
    // Fight real ordinary turns until one lands (a miss is possible); then the
    // enemy's HP is shortened to 1 — the same documented shortening
    // tools/verify_first_story_battle.mjs uses — so the ordinary FIGHT command
    // can close the fight and the journey can carry on.
    if (!shortened && (landed > 0 || realRounds >= 3)) {
      await page.evaluate(() => { const b = window.__battleB?.(); if (b?.enemy) b.enemy.hp = 1; });
      shortened = true;
      log(`battle (${label}): enemy HP shortened to 1 to close the fight`);
    }
    const before = await page.evaluate(() => window.__battleB?.()?.enemy?.hp ?? null);
    await tapCircle(page, 120); // confirm the highlighted command (Fight)
    const trail = await runBattleTurn(page, {
      ticks: 400,
      until: (s) => s.state === 2 || s.state === 8 || s.state === 9,
    });
    const after = await page.evaluate(() => window.__battleB?.()?.enemy?.hp ?? null);
    for (const t of trail) states.push(t.state);
    const last = trail[trail.length - 1] ?? {};
    const msg = trail.map((t) => t.msg).filter(Boolean).slice(-1)[0] ?? "";
    log(`battle (${label}) round ${round}: enemy HP ${before} → ${after}, last=${last.state}${msg ? ` msg="${msg}"` : ""}`);
    if (!shortened) {
      realRounds++;
      sawAction ||= trail.some((t) => t.state === 5 || t.state === 6 || t.state === 7);
      if (after != null && before != null && after < before) landed++;
    }
  }
  check(`battle: an ordinary turn resolved (${realRounds} round(s) fought for real)`,
    realRounds >= 1 && (sawAction || landed > 0), `landed=${landed} states=[${states.join(",")}]`);
  check("battle: an ordinary attack landed damage", landed >= 1, `landed=${landed} in ${realRounds} real round(s)`);
  // Win flow: victory report pages, then the battle closes and the field returns.
  await page.waitForFunction(() => window.__battleB?.()?.state === 8 || !window.__battle?.isActive?.(),
    null, { timeout: 30_000 }).catch(() => {});
  const won = await page.evaluate(() => ({
    state: window.__battleB?.()?.state ?? null,
    phase: window.__battleB?.()?._victoryPhase ?? null,
  }));
  log(`battle (${label}): win phase ${JSON.stringify(won)}`);
  for (let i = 0; i < 30 && await page.evaluate(() => !!window.__battle?.isActive?.()); i++) {
    await tapCircle(page, 150);
    await page.waitForTimeout(500);
  }
  const over = await page.evaluate(() => !window.__battle?.isActive?.());
  log(`battle (${label}): over=${over}`);
  return over;
};

// ── the pause menu ────────────────────────────────────────────────────────────
const pauseHomeReady = () => page.waitForFunction(() => {
  const s = window.__status, sess = s?._session;
  return s?.diagnostics?.().entry === "home" && s.diagnostics().pending === false && sess &&
    sess.mem.read32(sess.root + 0x10) === 3;
}, null, { timeout: 40_000 });
const pauseRow = () => page.evaluate(() => {
  const s = window.__status?._session;
  return s ? s.mem.read32(s.root + 0x58) | 0 : null;
});

const openPauseAndClose = async () => {
  // Settle any leftover scene first (the field's START needs the field).
  await settleDialogue(10_000);
  await page.waitForTimeout(800);
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    await hold("i", 150);
    opened = await pauseHomeReady().then(() => true, () => false);
  }
  check("pause: START opens the translated pause home", opened,
    JSON.stringify(await page.evaluate(() => window.__status?.diagnostics?.() ?? null)));
  if (!opened) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/pause-home.png` });
  const row0 = await pauseRow();
  await hold("ArrowDown", 110);
  await page.waitForTimeout(400);
  const row1 = await pauseRow();
  check("pause: the list cursor moves between rows", row1 != null && row1 !== row0, `row ${row0} → ${row1}`);
  await hold("ArrowUp", 110);
  await page.waitForTimeout(300);
  const back = await pauseRow();
  check("pause: Up returns to the row it came from", back === row0, `row ${row1} → ${back}`);
  for (let i = 0; i < 16 && await page.evaluate(() => !!window.__status?.isOpen?.()); i++) await hold("Escape", 150);
  const closed = await page.evaluate(() => !window.__status?.isOpen?.());
  check("pause: Back closes the pause and the field returns", closed);
};

// ── the save at the inn ───────────────────────────────────────────────────────
const confirmExit = async (map, label) => {
  // Door tiles are facing-gated: the step's opcode is live only while the
  // player's facing sits in the tile's cone (engine/systems/trigger-system.ts
  // stepLive — the shipped table's row is the ±1 cone around the tile's
  // grid-byte group). The walk leaves the facing at whatever its last steering
  // press was, and a facing outside the cone makes the confirm press do
  // nothing at all: measured, the s200 inn door fires facing up and stays dead
  // facing right at the same pixel. So each press is preceded by a deliberate
  // facing; the sweep pairs opposite directions so the taps cannot walk the
  // player off the pad. If a tap does push the player off the rect, the walk
  // recentres on it first.
  const FACING_KEYS = [
    ["ArrowUp"], ["ArrowDown"], ["ArrowLeft"], ["ArrowRight"],
    ["ArrowUp", "ArrowLeft"], ["ArrowDown", "ArrowRight"],
    ["ArrowUp", "ArrowRight"], ["ArrowDown", "ArrowLeft"],
  ];
  const rectAt = () => page.evaluate((m) => {
    const st = window.__state;
    const ex = st.scenes?.[m]?.exits ?? [];
    const hit = ex.find((e) => st.x >= e.x && st.x < e.x + e.w && st.y >= e.y && st.y < e.y + e.h);
    return hit ? { x: hit.x, y: hit.y, w: hit.w, h: hit.h } : null;
  }, map);
  let rect = await rectAt();
  for (let i = 0; i < 16; i++) {
    let p = await snap();
    if (p.map !== map) return p;
    if (!rect) rect = await rectAt();
    const onRect = await rectAt();
    const keys = FACING_KEYS[i % FACING_KEYS.length];
    log(`exit ${label}: onRect=${!!onRect} at (${p.x},${p.y}) facing ${keys.join("+")}`);
    if (!onRect && rect) {
      await walkTo(map, rect.x + rect.w / 2, rect.y + rect.h / 2, `${label}:recentre`, { budgetMs: 30_000 });
      p = await snap();
      if (p.map !== map) return p;
    }
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(120);
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(100);
    await hold("Enter", 700);
    p = await settleDialogue(15_000);
    if (p.map !== map) { log(`exit ${label}: ${map} → ${p.map}`); return p; }
  }
  return await snap();
};

const walkToGuardromonAndSave = async () => {
  // s235: the save clerk is NPC 21 (Guardromon). Talk once (its state-0 line
  // sets flag 6665), then again — the second dialogue's on_close writes bank
  // 0x90 and the save event opens the memory card in SAVE mode.
  const npc = await page.evaluate(() => {
    const list = window.__state?.scenes?.["s235"]?.npcs ?? [];
    const n = list.find((x) => x.npc_id === 21);
    return n ? { x: n.x, y: n.y } : null;
  });
  if (!npc) { check("inn: the save clerk (NPC 21) is in the live scene", false); return false; }
  log(`inn: walking to the save clerk at (${npc.x},${npc.y})`);
  await walkTo("s235", npc.x, npc.y + 22, "s235:clerk", { budgetMs: 90_000 });
  // After the second talk the save-point event plays: it walks the player, puts
  // the clerk's line up (the "PREPARE TO SAVE." beat), and only its tail's
  // HANDOFF opens the card — so keep advancing any line and wait for the card
  // instead of stopping at the first quiet moment (the walk gap between the
  // line and the handoff read as "settled" and the run gave up there).
  const waitForCard = async (budgetMs = 60_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      if (await page.evaluate(() => !!window.__saveNative?.isOpen?.())) return true;
      const p = await snap();
      if (p.textbox || p.choice) { await hold("Enter", 250); continue; }
      await page.waitForTimeout(250);
    }
    return await page.evaluate(() => !!window.__saveNative?.isOpen?.());
  };
  let opened = false;
  for (let talk = 0; talk < 3 && !opened; talk++) {
    let aimed = null;
    for (let i = 0; i < 12 && aimed?.npc !== 21; i++) {
      await page.keyboard.down("ArrowUp"); await page.waitForTimeout(30); await page.keyboard.up("ArrowUp");
      aimed = await page.evaluate(() => { try { return window.__talkTarget?.(); } catch { return null; } });
      if (aimed?.npc !== 21) await page.waitForTimeout(100);
    }
    log(`inn: talk ${talk} target ${JSON.stringify(aimed)}`);
    if (aimed?.npc !== 21) { check(`inn: the clerk answers talk ${talk}`, false, JSON.stringify(aimed)); return false; }
    await hold("Enter", 400);
    const p = await settleDialogue(25_000);
    log(`inn: talk ${talk} settled (map=${p.map}, textbox=${p.textbox})`);
    opened = await waitForCard(talk === 0 ? 8_000 : 60_000);
  }
  check("inn: the clerk's second talk opens the memory card (the save-point event)", opened);
  return opened;
};

const driveSaveCard = async () => {
  await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.state?.window != null, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/save-slot-chooser.png` });
  await page.keyboard.down("Enter"); await page.waitForTimeout(140); await page.keyboard.up("Enter"); await page.waitForTimeout(600); // block → file card
  await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.state?.window === 0x21, null, { timeout: 30_000 });
  await page.keyboard.down("Enter"); await page.waitForTimeout(140); await page.keyboard.up("Enter"); await page.waitForTimeout(600); // write
  await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.state?.window === 0x1f5, null, { timeout: 30_000 });
  await page.keyboard.down("Enter"); await page.waitForTimeout(140); await page.keyboard.up("Enter"); await page.waitForTimeout(500); // dismiss "Saved."
  await page.waitForFunction(() => window.__saveNative?.diagnostics?.()?.state?.window === 0x21, null, { timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/save-written.png` });
  const slot = await page.evaluate(() => {
    const d = window.__saveNative.diagnostics();
    return d?.stores?.[0]?.slot ?? d?.savedSlot ?? null;
  });
  for (let i = 0; i < 10 && await page.evaluate(() => !!window.__saveNative?.isOpen?.()); i++) await hold("Escape", 200);
  await page.waitForFunction(() => !window.__saveNative?.isOpen?.(), null, { timeout: 20_000 }).catch(() => {});
  return slot;
};

// ── the boot screens before the title ────────────────────────────────────────
// Every cold boot of this build plays, in order: the first-launch "Choose
// Visual Style" chooser (an HTML modal; picking Authentic PS1 saves the mode
// and reloads — it only appears while nothing is saved), the language pick
// (pro/cnty_sel; Start confirms the highlighted row), and the opening movie
// (skipped with Start). Only a memory-card load skips these (the walker sets
// sessionStorage "resumeAfterLoad" and boots straight into the field), so the
// reload leg needs this drive again — not just the first boot.
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

// ── the run ───────────────────────────────────────────────────────────────────
try {
  await page.goto(`${ROOT}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 30_000 });
  mark("boot");

  // 1+2. the boot screens a player meets: the first-launch visual-style
  // chooser (HTML modal — picking Authentic PS1 saves the choice and reloads),
  // the language pick (Start confirms the highlighted row), the opening movie
  // (skipped with Start), then the title prompt and its menu.
  const picked = await driveBootToTitle("first boot");
  check("boot: the language pick commits", !!picked, JSON.stringify(picked));
  await hold("i", 200);
  await page.waitForFunction(() => window.__titleState?.()?.phase?.() === "menu", null, { timeout: 30_000 });
  const openedOn = await page.evaluate(() => window.__titleState().highlight());
  await hold("ArrowUp", 130);
  const hl = await page.evaluate(() => window.__titleState().highlight());
  check("title: Up moves the highlight from Continue to New Game", hl === 0, `open=${openedOn} now=${hl}`);
  await hold("Enter", 200);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
  log("New Game started; first field map:", JSON.stringify(await snap()));
  await page.screenshot({ path: `${OUT}/01-new-game-first-map.png` });

  // 3. the authored opening chain to s200
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const s200 = await driveOpeningToS200();
  await page.evaluate(() => { window.__gameSpeed = 1; });
  check("opening: the chain reaches Asuka City (s200)", s200.map === "s200",
    `map=${s200.map} (${s200.x},${s200.y}) ordinal=${s200.ordinal}`);
  mark("opening");
  await page.screenshot({ path: `${OUT}/02-s200-arrival.png` });
  if (STOP_AFTER === "opening") throw new Error("STOP_AFTER=opening");

  // 4. the first story battle (the PRE fires on entry; its scene must be read —
  // a player presses confirm through it — and then the fight launches itself)
  const battleUp = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      if (await page.evaluate(() => !!window.__battle?.isActive?.())) return true;
      await settleDialogue(2_000);
      await page.waitForTimeout(200);
    }
    return false;
  })();
  check("battle: the s200 PRE launches the scripted first fight", battleUp);
  await page.screenshot({ path: `${OUT}/03-battle-opening.png` });
  const won = battleUp && await fightToEnd("s200");
  check("battle: the fight resolves and the field comes back", won);
  await page.screenshot({ path: `${OUT}/04-battle-won.png` });
  // The POST event carries the player to the DigiLab (s220).
  await page.evaluate(() => { window.__gameSpeed = 4; });
  const s220 = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const p = await settleDialogue(2_000);
      if (p.map === "s220" && !p.textbox && !p.cutscene) return p;
      await page.waitForTimeout(200);
    }
    return await snap();
  })();
  await page.evaluate(() => { window.__gameSpeed = 1; });
  check("battle: the POST event carries the player to the DigiLab (s220)", s220.map === "s220", `map=${s220.map}`);
  mark("battle");
  if (STOP_AFTER === "battle") throw new Error("STOP_AFTER=battle");

  // 5. the pause menu opens, walks and closes on the field
  await openPauseAndClose();
  mark("pause");
  if (STOP_AFTER === "pause") throw new Error("STOP_AFTER=pause");

  // 6. walk to the inn and save at the save point
  log("walking s220 → s200");
  let p = await walkTo("s220", 192, 384, "s220:exit-s200", { allowExit: "s200" });
  p = await confirmExit("s220", "s220→s200");
  check("walk: s220 → s200 exit works", p.map === "s200", `map=${p.map}`);
  log("walking s200 → s235 (the inn)");
  p = await walkTo("s200", 672, 368, "s200:inn-door", { allowExit: "s235" });
  p = await confirmExit("s200", "s200→s235");
  check("walk: s200 → s235 inn door works", p.map === "s235", `map=${p.map}`);
  await page.screenshot({ path: `${OUT}/05-inn-arrival.png` });
  const cardOpen = p.map === "s235" && await walkToGuardromonAndSave();
  mark("inn");
  if (STOP_AFTER === "inn") throw new Error("STOP_AFTER=inn");

  // 7. write the card
  check("save: the save-point event opened the memory card", cardOpen);
  const slot = cardOpen ? await driveSaveCard() : null;
  const saved = slot == null ? null : await page.evaluate((n) =>
    JSON.parse(localStorage.getItem(`mcardSlot${n}`) ?? "null"), slot);
  check("save: the card wrote a file with the inn's own place index (43 = Asuka Inn)",
    saved?.record != null && saved?.record?.placeIndex === 43,
    `slot=${slot} placeIndex=${saved?.record?.placeIndex} name=${saved?.record?.name}`);
  const beforeReload = await page.evaluate(() => ({
    name: window.__state.playerName, bits: window.__state.bits,
    party: (window.__state.party ?? []).slice(), map: window.__state.manifest.maps[window.__state.mapIdx].id,
  }));
  log("state before reload:", JSON.stringify(beforeReload));
  mark("save");
  if (STOP_AFTER === "save") throw new Error("STOP_AFTER=save");

  // 8. reload → title → Continue → load the file → back in the field
  await page.reload();
  // A plain reload boots like a cold start: the language pick and the movie
  // play again (only a memory-card LOAD skips straight into the field, via
  // sessionStorage "resumeAfterLoad"). The visual-style chooser does not
  // return — the first boot saved the mode.
  const pickedAgain = await driveBootToTitle("after reload");
  check("reload: the boot screens drive again after the reload", !!pickedAgain, JSON.stringify(pickedAgain));
  await openContinueCard(page);
  check("reload: the title's Continue opens the memory card in LOAD mode",
    (await cardWindow(page)) === 2, `window=${await cardWindow(page)}`);
  await page.screenshot({ path: `${OUT}/06-continue-load.png` });
  await loadFromCard(page);
  const afterReload = await page.evaluate(() => ({
    name: window.__state.playerName, bits: window.__state.bits,
    party: (window.__state.party ?? []).slice(), map: window.__state.manifest.maps[window.__state.mapIdx].id,
  }));
  log("state after load:", JSON.stringify(afterReload));
  check("reload: the loaded game resumes in the field at the inn (s235)", afterReload.map === "s235", `map=${afterReload.map}`);
  check("reload: the saved state came back (name, bits, party)",
    afterReload.name === beforeReload.name && afterReload.bits === beforeReload.bits &&
    JSON.stringify(afterReload.party) === JSON.stringify(beforeReload.party),
    JSON.stringify({ before: beforeReload, after: afterReload }));
  await page.screenshot({ path: `${OUT}/07-loaded-field.png` });
  mark("reload");

  // 9. the error budget
  check("no page errors on the whole journey", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("no unexpected failed requests", unexpectedFailed().length === 0, unexpectedFailed().slice(0, 3).join(" | "));
  check("no unexpected >=400 responses (only the two known optional files)",
    unexpectedHttpErrors().length === 0, unexpectedHttpErrors().slice(0, 5).join(" | "));
} catch (e) {
  if (String(e.message).startsWith("STOP_AFTER=")) log(String(e.message));
  else { failures++; console.error("JOURNEY ERROR:", e); try { await page.screenshot({ path: `${OUT}/failure.png` }); } catch { /* page gone */ } }
} finally {
  await browser.close();
}

console.log("\n== per-step counts ==");
for (const [label, c] of Object.entries(stepCounts)) {
  console.log(`  ${label}: console=${c.consoleErrors} pageErrors=${c.pageErrors} failedReq=${c.failedRequests} http>=400=${c.httpErrors} unexpected=${c.unexpected}`);
}
console.log("== error detail ==");
console.log("console errors:", consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 10)));
console.log("page errors:", pageErrors.length, JSON.stringify(pageErrors.slice(0, 10)));
console.log("failed requests:", failedRequests.length, JSON.stringify(failedRequests.slice(0, 10)));
console.log("http >= 400:", httpErrors.length, JSON.stringify(httpErrors.slice(0, 10)));
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — ${checks.filter((c) => c.ok).length}/${checks.length} checks, screenshots in ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
