// Journey 1 (ordinary inputs only): title New Game → opening chain → s200
// field control → talk → leave for s255 → return to s200.
//
// No page.evaluate state writes, no direct method calls, no seeded flags.
// Navigation reads live state to choose the next keypress; every action is a
// keyboard press. Run: tools/run-playwright.sh tools/journey1.mjs
// (server on :8741 must be running).
import { chromium } from "playwright";
import { selectAuthentic } from './select-authentic.mjs';
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { readBattleLine } from "./verify-battle-wait.mjs";

const TRACE = [];
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (m) => { TRACE.push(`${stamp()} ${m}`); console.log(`${stamp()} ${m}`); };

// ── Collision-grid pathfinding (navigation only: it chooses keypresses).
// The grid is read LIVE from the game (state.collision — the same data the
// O-key editor overlay draws as red blocked cells), never from the JSON
// files, so the walker and the game always agree on what is walkable.
const gridCache = new Map();
const loadGridLive = async (map) => {
  if (gridCache.has(map)) return gridCache.get(map);
  const live = await page.evaluate((m) => {
    const grid = window.__state?.collision?.[m];
    if (!grid) return null;
    const scene = window.__state?.scenes?.[m];
    return {
      cell: grid.cell, cols: grid.cols, rows: grid.rows,
      cells: Array.from(grid.cells),
      doors: (scene?.doors ?? []).map((d) => ({ x: d.x, y1: d.y1, y2: d.y2 })),
    };
  }, map);
  let g = null;
  if (live) {
    const blocked = [];
    for (let r = 0; r < live.rows; r++) {
      let s = "";
      for (let c = 0; c < live.cols; c++) s += live.cells[r * live.cols + c] ? "1" : "0";
      blocked.push(s);
    }
    g = { cell: live.cell, cols: live.cols, rows: live.rows, blocked, doors: live.doors };
  } else {
    // Fallback: the shipped grid file (same bytes the game fetches).
    const j = JSON.parse(readFileSync(`web/assets/collision/${map}.json`, "utf8"));
    const sj = JSON.parse(readFileSync(`web/assets/scenes/${map}.json`, "utf8"));
    g = { ...j, doors: (sj.doors ?? []).map((d) => ({ x: d.x, y1: d.y1, y2: d.y2 })) };
  }
  gridCache.set(map, g);
  return g;
};
const bfsPath = async (map, sx, sy, tx, ty, extraBlocked = null) => {
  const g = await loadGridLive(map);
  if (!g) return null;
  // Doors (vertical x / y1-y2 segments, read live with the grid) warp on
  // touch, unlike grid exits (stand + Space). Block their cells so walks
  // don't warp by accident. No leg of this journey aims at a door.
  for (const d of g.doors ?? []) {
    const c = Math.floor(d.x / g.cell);
    for (let y = d.y1; y <= d.y2; y += g.cell) {
      const r = Math.floor(y / g.cell);
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++)
        (extraBlocked ??= new Set()).add((r + dr) * g.cols + (c + dc));
    }
  }
  const blocked = (c, r) => {
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return true;
    if (g.blocked[r][c] !== "0") return true;
    if (extraBlocked && extraBlocked.has(r * g.cols + c)) return true;
    return false;
  };
  const near = (c, r) => {
    const ok = (cc, rr) => !blocked(cc, rr);
    if (ok(c, r)) return [c, r];
    for (let rad = 1; rad < 40; rad++)
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        if (ok(c + dc, r + dr)) return [c + dc, r + dr];
      }
    return null;
  };
  const S = near(Math.floor(sx / g.cell), Math.floor(sy / g.cell));
  const T = near(Math.floor(tx / g.cell), Math.floor(ty / g.cell));
  if (!S || !T) return null;
  const key = (c, r) => r * g.cols + c;
  const prev = new Map([[key(...S), null]]);
  const q = [S];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const free = (c, r) => !blocked(c, r);
  while (q.length) {
    const [c, r] = q.shift();
    if (c === T[0] && r === T[1]) {
      const cells = [];
      let k = key(c, r);
      let cur = [c, r];
      while (cur) { cells.push(cur); const p = prev.get(key(...cur)); cur = p; }
      cells.reverse();
      // Compress straight runs into corner waypoints (cell centers, pixels).
      const pts = cells.map(([cc, rr]) => [(cc + 0.5) * g.cell, (rr + 0.5) * g.cell]);
      const out = [pts[0]];
      let dir = null;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.abs(pts[i][0] - pts[i - 1][0]) > 1 ? "h" : "v";
        if (d !== dir && i > 1) out.push(pts[i - 1]);
        dir = d;
      }
      out.push(pts[pts.length - 1]);
      return out;
    }
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr, k = key(nc, nr);
      if (prev.has(k) || !free(nc, nr)) continue;
      prev.set(k, [c, r]);
      q.push([nc, nr]);
    }
  }
  return null;
};

const browser = await chromium.launch({ headless: process.env.HEADFUL ? false : true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "/tmp/journey1-video", size: { width: 640, height: 400 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => {
  const m = String(e && e.message || e).slice(0, 200);
  errors.push(m);
  console.log(`${stamp()} PAGEERROR: ${m}`);
});

try {
  await page.goto(`${baseUrl(8741)}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await selectAuthentic(page);
  await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const snap = () => page.evaluate(() => {
    const st = window.__state;
    const maps = st?.manifest?.maps || [];
    return {
      started: !!st?.started,
      map: st ? maps[st.mapIdx]?.id : null,
      x: st?.x, y: st?.y, dir: st?.dir,
      textbox: !!window.__textbox?.isOpen?.(),
      choice: !!window.__choice?.isOpen?.(),
      cutscene: !!window.__cutscene?.isActive?.(),
      battle: !!(window.__battle?.isActive?.()),
      tbText: (() => { try { return window.__textbox?.isOpen?.() ? window.__textbox.currentPage().join(" ").slice(0, 160) : null; } catch { return null; } })(),
      packSelect: !!st?.packSelect,
      nameEntry: !!st?.nameEntry,
      neDone: st?.nameEntry ? !!st.nameEntry.isDone?.() : null,
      titleUp: !document.getElementById("title-screen")?.hidden,
    };
  });

  // Fine approach: greedy micro-steps to an exact stand point (talk range
  // is tight — ~32px — and path arrival tolerance is looser than that).
  const fineApproach = async (tx, ty, label) => {
    for (let i = 0; i < 80; i++) {
      const p = await snap();
      if (p.map !== label.split(":")[0]) return p;
      const dx = tx - p.x, dy = ty - p.y;
      if (Math.hypot(dx, dy) < 9) return p;
      const keys = [];
      if (dx > 4) keys.push("ArrowRight");
      else if (dx < -4) keys.push("ArrowLeft");
      if (dy > 4) keys.push("ArrowDown");
      else if (dy < -4) keys.push("ArrowUp");
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(90);
      for (const k of keys.reverse()) await page.keyboard.up(k);
    }
    return await snap();
  };
  // for points it is coming within tolerance. If a waypoint makes no
  // progress, nudge out and resume pursuit, up to a cap.
  const pathWalk = async (map, tx, ty, label, expectMap = null, budgetMs = 150000) => {
    const t1 = Date.now();
    const plan = async () => {
      const p = await snap();
      return { wps: await bfsPath(map, p.x, p.y, tx, ty, null), from: p };
    };
    let { wps } = await plan();
    if (!wps) { log(`walk ${label}: NO PATH on grid`); return await snap(); }
    log(`walk ${label}: path with ${wps.length} waypoints`);
    // Pure pursuit: chase a lookahead point on the polyline so corridors are
    // ridden down their midline instead of hopping between cell centers.
    const cum = [0];
    for (let i = 1; i < wps.length; i++)
      cum.push(cum[i - 1] + Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][1] - wps[i - 1][1]));
    const total0 = cum[cum.length - 1];
    let total = total0;
    const pointAt = (d) => {
      d = Math.max(0, Math.min(total, d));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const t = cum[i] === cum[i - 1] ? 0 : (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
      return [wps[i - 1][0] + (wps[i][0] - wps[i - 1][0]) * t, wps[i - 1][1] + (wps[i][1] - wps[i - 1][1]) * t];
    };
    const LOOK = 14;
    let replans = 0, still = 0, lx = -1, ly = -1, battles = 0;
    while (Date.now() - t1 < budgetMs) {
      const p = await snap();
      if (p.battle) {
        if (++battles > 3) { log(`walk ${label}: too many battles, stopping`); return p; }
        log(`walk ${label}: battle ${battles} at (${p.x.toFixed(0)},${p.y.toFixed(0)}) — fighting`);
        if (!(await handleBattle())) return p;
        lx = -1; still = 0;
        continue;
      }
      if (p.map !== map) { log(`walk ${label}: map ${map} → ${p.map}`); return p; }
      if (expectMap && p.map === expectMap) return p;
      // Progress along the polyline = projection of player position.
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
        if (Math.abs(dx) < 26 && Math.abs(dy) < 26) { log(`walk ${label}: arrived (${p.x.toFixed(0)},${p.y.toFixed(0)})`); return p; }
      }
      if (Math.abs(p.x - lx) < 1 && Math.abs(p.y - ly) < 1) {
        if (++still >= 20) {
          still = 0;
          if (++replans > 40) { log(`walk ${label}: STUCK at (${p.x.toFixed(0)},${p.y.toFixed(0)}) after nudges`); return p; }
          // Nudge: probe all four directions with short holds; pursuit
          // re-acquires from wherever the probes end (no grid poisoning:
          // discs seal the one-cell corridors this maze needs).
          for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
            await page.keyboard.down(k);
            await page.waitForTimeout(250);
            await page.keyboard.up(k);
            const q = await snap();
            if (q.map !== map) { log(`walk ${label}: map ${map} → ${q.map} on nudge`); return q; }
          }
          log(`walk ${label}: nudge ${replans} done at (${(await snap()).x.toFixed(0)},${(await snap()).y.toFixed(0)})`);
          lx = -1;
          continue;
        }
      } else { still = 0; lx = p.x; ly = p.y; }
      const [gx, gy] = pointAt(best + LOOK);
      const dx = gx - p.x, dy = gy - p.y;
      if (Math.hypot(dx, dy) < 8) continue;
      // Hold both axes (the engine resolves them separately, so diagonals
      // slide along walls instead of jamming against them).
      const keys = [];
      if (dx > 6) keys.push("ArrowRight");
      else if (dx < -6) keys.push("ArrowLeft");
      if (dy > 6) keys.push("ArrowDown");
      else if (dy < -6) keys.push("ArrowUp");
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(120);
      for (const k of keys.reverse()) await page.keyboard.up(k);
    }
    const p = await snap();
    log(`walk ${label}: budget out at (${p.x.toFixed(0)},${p.y.toFixed(0)}) map=${p.map}`);
    return p;
  };

  // Exits here are press-to-enter: standing on the rect shows a "?" prompt
  // and Space confirms (plain walking does not fire them — seen on s210).
  // An exit press may also play a gated scene (the west door's refusal
  // walks you back with dialogue), so settle fully after each press.
  const settleScene = async (label, budgetMs = 45000) => {
    const t1 = Date.now();
    let lastText = "";
    while (Date.now() - t1 < budgetMs) {
      const p = await snap();
      if (p.battle) return p;
      if (!p.textbox && !p.cutscene) return p;
      if (p.textbox) {
        if (p.tbText && p.tbText !== lastText) { lastText = p.tbText; log(`dialogue: "${p.tbText}"`); }
        await press("Space", 400);
      } else await page.waitForTimeout(500);
    }
    return await snap();
  };
  const confirmExit = async (label) => {
    for (let i = 0; i < 3; i++) {
      let p = await snap();
      if (p.map !== label) return p;
      const onRect = await page.evaluate(() => {
        const st = window.__state;
        const ex = st.scenes?.[st.manifest.maps[st.mapIdx]?.id]?.exits ?? [];
        return ex.some((e) => st.x >= e.x && st.x < e.x + e.w && st.y >= e.y && st.y < e.y + e.h);
      });
      log(`exit confirm ${label}: onRect=${onRect} at (${p.x.toFixed(0)},${p.y.toFixed(0)})`);
      await press("Space", 900);
      p = await settleScene(label);
      if (p.map !== label) { log(`exit: ${label} → ${p.map} OK`); return p; }
    }
    return await snap();
  };

  const press = async (key, wait = 150) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(wait);
  };
  const battlePeek = () => page.evaluate(() => {
    try { return window.__battle?.peek?.() ?? null; } catch { return null; }
  });
  // Ride out a live battle with menu keys only: page result text, confirm
  // the default Fight command each round, page the win report to the end.
  // Scripted story fights cannot be fled — they are fought. States: 2 menu,
  // 5/6 action playing (keys ignored), 7 result text, 8 won, 9 lost.
  const handleBattle = async (maxRounds = 40) => {
    for (let round = 0; round < maxRounds; round++) {
      let b = null;
      for (let i = 0; i < 120; i++) {
        b = await battlePeek();
        if (!b) { log("battle: over, back to field"); return true; }
        if (b.state === 2 || b.state === 8) break;
        if (b.state === 9) { log("battle: LOST — journey ends here"); return false; }
        // A line the player has not read yet holds the battle controller, so the command
        // menu does not exist and this ride-out would sit in state 1 forever. Read it the
        // way a player does (one Circle while the line waits), the shared press every other
        // battle check uses -- tools/verify-battle-wait.mjs.
        if (b.waitsForLine) await readBattleLine(page, { timeout: 15_000 });
        else if (b.state === 7) await press("Space", 400);
        else await page.waitForTimeout(300);
      }
      b = await battlePeek();
      if (!b) { log("battle: over, back to field"); return true; }
      log(`battle r${round}: state=${b.state} msg="${b.message}" player=${JSON.stringify(b.player)} enemy=${JSON.stringify(b.enemy)}`);
      if (round === 0) await page.screenshot({ path: "/tmp/journey1-battle.png" });
      if (b.state === 8) {
        for (let i = 0; i < 30; i++) {
          await press("Space", 500);
          if (!(await battlePeek())) { log("battle: won, back to field"); return true; }
        }
        log("battle: win report did not close"); return false;
      }
      if (b.state !== 2) { log(`battle: no decision point (state ${b.state})`); return false; }
      const item = b.menu ? b.menu[b.menuSel] : "?";
      // Fight is index 0; Up decrements (wraps), so menuSel Ups land on it.
      for (let u = 0; u < (b.menuSel ?? 0); u++) await press("ArrowUp", 150);
      log(`battle: menu pick "${item}" → Fight`);
      await press("Space", 800); // confirm Fight
    }
    log("battle: still active after fight rounds"); return false;
  };

  // ── Phase 1: title → New Game via keyboard.
  // Rhythm the screen demands: confirm the prompt, wait out blink+split for
  // the menu (which opens on Continue), Up to Start, confirm again.
  log("phase1: title screen — Enter, Up, Enter");
  await page.waitForTimeout(2500); // slide + glow + intro ≈ 40 ticks
  let s = await snap();
  for (let i = 0; i < 5 && !s.started; i++) {
    await press("Enter", 1500); // prompt → menu (blink 12 + split 15 + settle)
    await press("ArrowUp", 400); // menu: Continue → Start
    await press("Enter", 1200); // commit (fade + 650ms close)
    s = await snap();
    log(`title attempt ${i}: started=${s.started} titleUp=${s.titleUp}`);
  }
  if (!s.started) { console.error(`FAIL: New Game did not start via keyboard: ${JSON.stringify(s)}`); process.exit(1); }
  log(`started on map=${s.map}`);

  // ── Phase 2: opening chain to s200, keyboard only.
  // packSelect: arrows move, Space confirms (game.js confirms + Done when done).
  // nameEntry: cursor starts (0,0); Space types the cell; OK cell finishes.
  let namePhase = 0; // 0 = type a letter, 1 = steer to OK
  let lastMap = s.map;
  let lastPos = "";
  let idleIters = 0;
  let cleanStreak = 0;
  let packIters = 0, neIters = 0;
  let lastLoopText = "";
  let s210TalkDone = false;
  let s212Dumped = false;
  let s212Seen = false;
  for (let i = 0; i < 1500; i++) {
    s = await snap();
    if (!s.map) { await page.waitForTimeout(400); continue; } // mid-transition
    if (i % 120 === 0) log(`phase2 heartbeat: ${JSON.stringify(s)}`);
    if (s.map !== lastMap) { log(`map → ${s.map} (x=${s.x} y=${s.y})`); lastMap = s.map; idleIters = 0; }
    // Focused observation: first arrival on s212 dumps the download-gate
    // inputs, then watches 90s. (Intermittent stall under investigation.)
    if (s.map === "s212" && !s212Seen) {
      s212Seen = true;
      const dump = await page.evaluate(() => {
        const out = {};
        try {
          const fl = window.__storyFlags ?? window.__engineBridge?.flags;
          out.f24578 = fl?.get?.(24578) ?? null;
          out.f28672 = fl?.get?.(28672) ?? null;
          out.f6656 = fl?.get?.(6656) ?? null;
          out.packVar = window.__engine?.state?.vars?.get?.("$party.pack") ?? null;
          out.ordinal = window.__engine?.state?.vars?.get?.("$story.ordinal") ?? null;
          out.busy = window.__engineBridge?.isBusy?.() ?? null;
          out.party = window.__state?.party ?? null;
          out.packId = window.__state?.packId ?? null;
          out.pendingParty = window.__state?.pendingParty ?? null;
          out.cutscene = !!window.__cutscene?.isActive?.();
        } catch (e) { out.err = String(e).slice(0, 120); }
        return out;
      });
      log(`s212 entry dump: ${JSON.stringify(dump)}`);
    }
    if (s.map === "s200" && !s.textbox && !s.cutscene && !s.packSelect && !s.nameEntry && !s.choice) {
      cleanStreak++;
      // Guard against catching a map load mid-flight (position not placed).
      if (cleanStreak >= 4 && s.x > 0 && s.y > 0) { log(`reached s200 with a clean field at (${s.x},${s.y})`); break; }
      await page.waitForTimeout(300); continue;
    }
    if (s.battle) {
      log(`phase2: battle on ${s.map} — fighting it with menu keys`);
      if (!(await handleBattle())) { console.error("STOP: battle did not resolve (see log)"); process.exit(1); }
      idleIters = 0; cleanStreak = 0; continue;
    }
    if (s.packSelect) {
      // Pack list → Space opens the Register-account confirm (YES default);
      // Space again confirms it. Never Down (that picks NO and loops back).
      packIters++;
      if (packIters > 30) { console.error(`FAIL: packSelect not closing after 30 confirms`); process.exit(1); }
      const ph = await page.evaluate(() => window.__state.packSelect.phase());
      if (packIters % 5 === 1) log(`packSelect phase=${ph}`);
      await press("Space", 700);
      idleIters = 0; cleanStreak = 0; continue;
    }
    packIters = 0;
    if (s.nameEntry) {
      neIters++;
      if (neIters > 150) { console.error(`FAIL: nameEntry not committing after 150 steps`); process.exit(1); }
      if (namePhase === 0) { await press("Space", 300); namePhase = 1; log("name: typed first letter"); continue; }
      // Steer the grid cursor onto the OK action cell using live reads.
      // Row 6 exists only under cols 10-14, so: Right along the char rows
      // to col 13 first, then Down (lands on OK, skipping null spans).
      const cur = await page.evaluate(() => {
        const ne = window.__state.nameEntry;
        return { at: ne.cursor(), act: ne.currentCell()?.act ?? ne.currentCell()?.ch ?? null, val: ne.value(), closing: ne.isClosing() };
      });
      if (neIters % 10 === 1) log(`name: cursor=(${cur.at.row},${cur.at.col}) act=${cur.act} val="${cur.val}" closing=${cur.closing}`);
      if (cur.closing) { await page.waitForTimeout(500); idleIters = 0; continue; }
      if (cur.act === "OK") {
        await press("Space", 500);
        const s2 = await snap();
        if (!s2.nameEntry) log(`name: committed "${cur.val}" via OK cell`);
        idleIters = 0; continue;
      }
      if (cur.at.col !== 13 && cur.at.row <= 2) await press("ArrowRight", 120);
      else if (cur.at.row <= 2) await press("ArrowDown", 120);
      else await press("ArrowUp", 120);
      idleIters = 0; cleanStreak = 0; continue;
    }
    neIters = 0;
    if (s.textbox || s.choice) {
      if (s.tbText && s.tbText !== lastLoopText) { lastLoopText = s.tbText; log(`dialogue: "${s.tbText}"`); }
      await press("Space", 160); idleIters = 0; cleanStreak = 0; continue;
    }
    if (s.cutscene) { await page.waitForTimeout(400); idleIters++; cleanStreak = 0; continue; }
    // Clean snap with no UI and no cutscene: may be a dialogue lull (common
    // right after a map change), so only conclude field control when it holds.
    cleanStreak++;
    if (cleanStreak < 6) { await page.waitForTimeout(300); idleIters++; continue; }
    // Idle passenger on s212 (download room): dump the entry-gate inputs once
    // so a missing flag names itself instead of stalling silently.
    if (s.map === "s212" && !s212Dumped) {
      s212Dumped = true;
      const dump = await page.evaluate(() => {
        const out = {};
        try {
          const fl = window.__storyFlags ?? window.__engineBridge?.flags;
          out.f24578 = fl?.get?.(24578) ?? null;
          out.f28672 = fl?.get?.(28672) ?? null;
          out.f6656 = fl?.get?.(6656) ?? null;
          out.packVar = window.__engine?.state?.vars?.get?.("$party.pack") ?? null;
          out.ordinal = window.__engine?.state?.ordinal ?? window.__state?.progressOrdinal ?? null;
          out.busy = window.__engineBridge?.isBusy?.() ?? null;
          out.party = window.__state?.party ?? null;
          out.packId = window.__state?.packId ?? null;
          out.pendingParty = window.__state?.pendingParty ?? null;
        } catch (e) { out.err = String(e).slice(0, 120); }
        return out;
      });
      log(`s212 gate dump: ${JSON.stringify(dump)}`);
    }
    // Sustained-clean field: on s210, first talk to the counter NPC (the
    // s212 download room has no walking exits — it is reached by handoff),
    // then walk the grid path to the west exit and confirm it with Space.
    // Anywhere else, keep waiting (scene lull).
    if (!s.packSelect && !s.nameEntry) {
      if (s.map !== "s210") { await page.waitForTimeout(300); idleIters++; continue; }
      if (!s210TalkDone) {
        s210TalkDone = true;
        // Counter NPCs (receptionist row): aim with __talkTarget (the same
        // rule a Space press uses: facing cone, range 48) then talk.
        const near = await page.evaluate(() => {
          const st = window.__state;
          return (st.scenes?.["s210"]?.npcs || [])
            .map((n) => ({ id: n.npc_id, x: Math.round(n.x), y: Math.round(n.y) }))
            .filter((n) => Math.abs(n.x - 409) < 120 && Math.abs(n.y - 261) < 60)
            .slice(0, 8);
        });
        log(`s210 counter npcs: ${JSON.stringify(near)}`);
        await pathWalk("s210", 384, 278, "s210:npc-384");
        {
          const at = await snap();
          if (Math.hypot(at.x - 384, at.y - 278) > 40) {
            log(`s210: npc walk fell short at (${at.x.toFixed(0)},${at.y.toFixed(0)}), retrying leg`);
            s210TalkDone = false;
            continue;
          }
        }
        // Systematic sweep along the counter: stand, face north with a
        // minimal tap (long holds walk away), read who Space would address.
        // Never talk to a stranger: wrong-NPC lines may set flags.
        let aimed = null;
        for (const sx of [384, 376, 392, 368, 396, 360]) {
          await fineApproach(sx, 278, "s210:npc-384");
          await page.keyboard.down("ArrowUp");
          await page.waitForTimeout(25);
          await page.keyboard.up("ArrowUp");
          const at = await snap();
          aimed = await page.evaluate(() => {
            try { return window.__talkTarget?.(); } catch { return null; }
          });
          log(`s210 sweep x=${sx}: at (${at.x.toFixed(0)},${at.y.toFixed(0)}) dir=${at.dir} aim=${JSON.stringify(aimed)}`);
          if (aimed?.npc === 32) break;
        }
        log(`s210 aim: ${JSON.stringify(aimed)}`);
        if (aimed?.npc !== 32) { log("s210: NPC 32 not addressed, retrying leg"); s210TalkDone = false; continue; }
        await press("Space", 400);
        s = await settleScene("s210-talk", 25000);
        // A handoff mid-talk lands on a new map: keep observing (the s200
        // break above is the only way out of this loop).
        idleIters = 0; cleanStreak = 0;
        continue;
      }
      await pathWalk(s.map, 80, 416, `${s.map}:exit-west`);
      s = await confirmExit("s210");
      if (s.map === "s200") { idleIters = 0; continue; }
      if (s.map !== lastMap) continue; // map changed elsewhere; re-observe
      console.error(`FAIL: still on s210 at (${s.x},${s.y}) after pathed walk + confirm`);
      process.exit(1);
    }
    await page.waitForTimeout(250); idleIters++;
    if (idleIters > 120) { console.error(`FAIL: stuck, no progress for 120 iters at ${JSON.stringify(s)}`); process.exit(1); }
  }
  s = await snap();
  if (s.map !== "s200") {
    await page.screenshot({ path: "/tmp/journey1-stuck.png" });
    const ui = await page.evaluate(() => ({
      menuOpen: !!window.__state?.menuOpen,
      shop: !!window.__shop?.isOpen?.(),
      inn: !!window.__inn?.isOpen?.(),
      save: !!window.__saveScreen?.isOpen?.() ?? null,
      party: window.__state?.party ?? null,
      charId: window.__state?.charId ?? null,
      flags: Object.keys(window.__state?.flags ?? {}).length,
    }));
    console.error(`FAIL: did not reach s200, at ${s.map} snap=${JSON.stringify(s)} ui=${JSON.stringify(ui)}`);
    process.exit(1);
  }
  await page.screenshot({ path: "/tmp/journey1-s200-arrival.png" });
  // Let any arrival fade/handoff settle before asserting control.
  await page.waitForTimeout(1500);
  s = await snap();
  log(`s200 settled: (${s.x},${s.y}) facing ${s.dir}`);

  // ── Phases 3-5: leg driver. The story may route through other maps
  // (the post-ambush Lab visit); each leg runs when its map holds, and any
  // accidental warp is recovered by routing back. Legs: control → talk →
  // leave (s200→s255) → return (s255→s200).
  const legs = { control: false, talk: false, leave: false, back: false };
  const legDeadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < legDeadline) {
    s = await snap();
    if (!s.map) { await page.waitForTimeout(400); continue; }
    if (s.battle) {
      log(`roam: battle on ${s.map} — fighting`);
      if (!(await handleBattle())) { console.error("STOP: battle did not resolve (see log)"); process.exit(1); }
      s = await settleScene("post-battle", 15000);
      continue;
    }
    if (s.textbox || s.choice) {
      if (s.tbText) log(`dialogue: "${s.tbText}"`);
      await press("Space", 300); continue;
    }
    if (s.cutscene || s.packSelect || s.nameEntry) { await page.waitForTimeout(400); continue; }
    // Clean field.
    if (s.map === "s220" && !(legs.leave && legs.back)) {
      // DigiLab: walk to the s200 grid exit (rect 160-224, 352-416), confirm.
      await pathWalk("s220", 192, 384, "s220:exit-s200");
      s = await confirmExit("s220");
      continue;
    }
    if (s.map !== "s200" && s.map !== "s255") {
      console.error(`FAIL: clean field on unexpected map ${s.map} (${s.x},${s.y})`);
      process.exit(1);
    }
    if (s.map === "s255" && !legs.back) {
      const p = await pathWalk("s255", 224, 352, "s255:exit-s200");
      s = await confirmExit("s255");
      if (s.map === "s200") { legs.back = true; log("return: s255 → s200 OK"); }
      await page.screenshot({ path: "/tmp/journey1-returned.png" });
      continue;
    }
    if (s.map !== "s200") { await page.waitForTimeout(400); continue; }
    if (!legs.control) {
      // Field control: short holds each way; pass on the first that moves.
      // (East is avoided first: a walk-through door sits that way at spawn.)
      let moved = false;
      for (const [key, axis] of [["ArrowLeft", "x"], ["ArrowUp", "y"], ["ArrowDown", "y"], ["ArrowRight", "x"]]) {
        const before = (await snap())[axis];
        await page.keyboard.down(key);
        await page.waitForTimeout(250);
        await page.keyboard.up(key);
        await page.waitForTimeout(150);
        const q = await snap();
        if (q.map !== "s200") break; // warped mid-check; roam recovers
        if (q.battle) break; // handled next loop
        log(`field control ${key}: ${axis} ${before.toFixed(0)} → ${q[axis].toFixed(0)}`);
        if (Math.abs(q[axis] - before) > 1) { moved = true; break; }
      }
      s = await snap();
      if (s.map === "s200" && !s.battle && moved) { legs.control = true; log("control: field moves on arrows"); }
      continue;
    }
    if (!legs.talk) {
      const npc = await page.evaluate(() => {
        const sc = window.__state.scenes?.["s200"];
        return { npcs: (sc?.npcs || []).length };
      });
      log(`s200 live NPCs: ${JSON.stringify(npc)}`);
      const p = await pathWalk("s200", 564, 582, "s200:npc-below");
      await fineApproach(564, 582, "s200:npc-below");
      const at = await snap();
      if (at.map !== "s200") continue;
      if (Math.hypot(at.x - 564, at.y - 582) > 60) {
        log(`talk: NPC corner not reached, at (${at.x},${at.y}) — will retry`);
        continue;
      }
      await press("ArrowUp", 60);
      const q = await snap();
      const aim = await page.evaluate(() => { try { return window.__talkTarget?.(); } catch { return null; } });
      log(`s200 aim: at (${q.x.toFixed(0)},${q.y.toFixed(0)}) dir=${q.dir} ${JSON.stringify(aim)}`);
      if (!aim?.npc) { log("talk: no target, will retry"); continue; }
      await press("Space", 400);
      s = await snap();
      if (!s.textbox && !s.cutscene) { log("talk: nothing opened, will retry"); continue; }
      s = await settleScene("s200-talk", 30000);
      legs.talk = true;
      log(`talk: settled, map=${s.map}`);
      await page.screenshot({ path: "/tmp/journey1-talk.png" });
      continue;
    }
    if (!legs.leave) {
      const p = await pathWalk("s200", 288, 544, "s200:exit-s255");
      s = await confirmExit("s200");
      if (s.map === "s255") { legs.leave = true; log("leave: s200 → s255 OK"); }
      await page.screenshot({ path: "/tmp/journey1-s255.png" });
      continue;
    }
    if (legs.control && legs.talk && legs.leave && legs.back) break;
    await page.waitForTimeout(400);
  }
  if (!(legs.control && legs.talk && legs.leave && legs.back)) {
    console.error(`FAIL: legs incomplete after budget: ${JSON.stringify(legs)} at ${s.map} (${s.x},${s.y})`);
    process.exit(1);
  }
  await page.screenshot({ path: "/tmp/journey1-returned.png" });

  if (errors.length) { console.error("FAIL: page errors:", errors.slice(0, 3)); process.exit(1); }
  log("JOURNEY1 OK: title → s200 → moved → talked → left → returned, keyboard only");
} finally {
  await browser.close();
}
console.log("---TRACE---");
for (const t of TRACE) console.log(t);
