// Field NPC / tree collision proof (worker-ca, 2026-10-08).
//
// The operator reports walking THROUGH field NPCs and trees. The original
// refuses such a step — the walk predicate F0x8008dfec probes the actor's foot
// perimeter (table RAM 0x80097B88) and F0x8008de0c asks zonemgr+0x58
// (F0x80092a90), which blocks when a probe lands inside a type-5 actor's
// footprint diamond or within 10 px of a tree (F0x8008ce40). This script drives
// the player straight at an NPC and at a tree, with the obstacle ACTIVE and
// with it bypassed (the NPC list / tree list emptied), and measures how far the
// player got.
//
// Run:  VERIFY_PORT=8788 tools/run-playwright.sh tools/verify_field_actor_collision.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const MAP = "s330";
const PORT = 8788;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${baseUrl(PORT)}/?skipTitle=1&map=${MAP}&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 20_000 });
  await page.waitForFunction(
    () => window.__state?.collision?.[window.__state.manifest.maps[window.__state.mapIdx].id],
    null, { timeout: 15_000 },
  );

  // Quiet any on-enter cutscene / textbox so the field takes input.
  for (let i = 0; i < 60; i++) {
    const busy = await page.evaluate(() => (window.__cutscene?.isActive?.() ?? false)
      || (window.__textbox?.isOpen?.() ?? false));
    if (!busy) break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }

  // In-page geometry helper: the walker's own foot box (x±6, y-8..y), read from
  // the LIVE collision grid, exactly as the game does.
  await page.evaluate(() => {
    window.__freeRun = (map, y, x0, x1) => {
      const g = window.__state.collision[map];
      const { cell, cols, rows, cells } = g;
      const free = (x) => {
        const c0 = Math.floor((x - 6) / cell), c1 = Math.floor((x + 6) / cell);
        const r0 = Math.floor((y - 8) / cell), r1 = Math.floor(y / cell);
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
            if (cells[r * cols + c]) return false;
          }
        return true;
      };
      for (let x = x0; x <= x1; x += 2) if (!free(x)) return false;
      return true;
    };
    // A long horizontal walkable run, to test walking along it.
    window.__findRun = (map, len) => {
      const g = window.__state.collision[map];
      const { cell, rows, cols } = g;
      for (let y = 40; y < rows * cell - 40; y += 4) {
        let run = 0, start = 0;
        for (let x = 20; x < cols * cell - 20; x += 2) {
          if (window.__freeRun(map, y, x, x)) {
            if (run === 0) start = x;
            run += 2;
            if (run >= len) return { x0: start, x1: start + run, y };
          } else run = 0;
        }
      }
      return null;
    };
    // Place the player and drive one held key for `ms`, returning the path ends.
    window.__walk = async (sx, sy, key, ms) => {
      const s = window.__state;
      s.x = sx; s.y = sy; s.moving = false; s.stopping = false;
      s.dir = key === "ArrowRight" ? "right" : "down";
      window.__keys = s.keys;
      const ev = (t, down) => window.dispatchEvent(new KeyboardEvent(t, { key, bubbles: true }));
      ev("keydown", true);
      const t0 = performance.now();
      await new Promise((res) => setTimeout(res, ms));
      ev("keyup", false);
      return { x: s.x, y: s.y, ms: performance.now() - t0 };
    };
  });

  // ── Tree: the stage's own FIELDCOM tree records (real disc data) ──────────
  const treeRun = await page.evaluate(() => {
    const s = window.__state;
    const trees = s.treeStages?.[s.manifest.maps[s.mapIdx].id]?.trees ?? null;
    if (!trees) return null;
    for (const t of trees) {
      if (window.__freeRun(s.manifest.maps[s.mapIdx].id, t.y, t.x - 40, t.x + 24))
        return t;
    }
    return null;
  });
  assert.ok(treeRun, "a tree with an open approach exists on the stage");

  const treeBlocked = await page.evaluate(
    (t) => window.__walk(t.x - 40, t.y, "ArrowRight", 900), treeRun);
  const treeGap = treeRun.x - treeBlocked.x;
  // Obstacle ACTIVE: the player stops before the ±10 box.
  assert.ok(treeGap > 10,
    `player stopped short of the tree (gap ${treeGap.toFixed(1)} px > 10)`);

  // Control: with no tree records the SAME walk passes through.
  const treeThrough = await page.evaluate((t) => {
    const s = window.__state;
    const stage = s.treeStages[s.manifest.maps[s.mapIdx].id];
    const saved = stage.trees;
    stage.trees = [];
    return window.__walk(t.x - 40, t.y, "ArrowRight", 900)
      .finally(() => { stage.trees = saved; });
  }, treeRun);
  assert.ok(treeThrough.x > treeRun.x + 6,
    `control walk passes the tree centre (${treeThrough.x.toFixed(1)} > ${treeRun.x + 6})`);

  // ── NPC: a field actor on the same stage (synthetic, same code path) ──────
  // The stage ships dozens of NPCs; clear the list so ONLY the test actor is
  // live, then the control (list emptied) is a clean A/B.
  const npcRun = await page.evaluate((map) => {
    const run = window.__findRun(map, 200);
    if (!run) return null;
    const s = window.__state;
    const scene = s.scenes[map];
    const proto = (scene.npcs ?? []).find((n) => n.sprite) ?? {};
    const npc = { ...proto, npc_id: proto.npc_id ?? 1, x: run.x0 + 100, y: run.y,
      n: undefined, slot: undefined, spawn_flags: [] };
    window.__npcSaved = scene.npcs;
    scene.npcs = [npc];
    return { npc, start: run.x0 + 40 };
  }, MAP);
  assert.ok(npcRun, "an open horizontal run exists for the NPC walk");

  const npcBlocked = await page.evaluate(
    (r) => window.__walk(r.start, r.npc.y, "ArrowRight", 900), npcRun);
  const npcGap = npcRun.npc.x - npcBlocked.x;
  // The injected actor has a real size-table entry (npc_id 1 -> half-width 16),
  // so the player stops at its diamond edge (~16 + the probe offset).
  assert.ok(npcGap > 10,
    `player stopped short of the NPC (gap ${npcGap.toFixed(1)} px > 10)`);

  // Control: no actors in the list -> the same walk passes through.
  const npcThrough = await page.evaluate((r) => {
    const s = window.__state;
    const scene = s.scenes[s.manifest.maps[s.mapIdx].id];
    const saved = scene.npcs;
    scene.npcs = [];
    return window.__walk(r.start, r.npc.y, "ArrowRight", 900)
      .finally(() => { scene.npcs = window.__npcSaved ?? saved; });
  }, npcRun);
  assert.ok(npcThrough.x > npcRun.npc.x + 6,
    `control walk passes the NPC centre (${npcThrough.x.toFixed(1)} > ${npcRun.npc.x + 6})`);

  const report = {
    map: MAP,
    tree: { at: treeRun.x, blockedTo: +treeBlocked.x.toFixed(1), gap: +treeGap.toFixed(1),
      controlTo: +treeThrough.x.toFixed(1) },
    npc: { at: npcRun.npc.x, blockedTo: +npcBlocked.x.toFixed(1), gap: +npcGap.toFixed(1),
      controlTo: +npcThrough.x.toFixed(1) },
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("VERDICT OK — walking is blocked by NPCs and trees; bypassed, the same walk passes through.");
} finally {
  await browser.close();
}
