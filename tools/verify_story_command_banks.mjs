// Bounded command-door check; direct state setup, no walking bot or emulator.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { baseUrl } from './verify-base-url.mjs';
const out = process.env.STORYBANK_SHOT ?? '.bunny-scratch/storybanks/commands-after';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('assetMode', 'authentic');
    localStorage.setItem('engineSchema', '2');
    localStorage.setItem('progressOrdinal', '45');
    localStorage.setItem('party', JSON.stringify(['p005koet', 'p006agum', 'p009rena']));
    localStorage.setItem('packId', 'B');
    localStorage.setItem('playerName', 'Junior');
    localStorage.setItem('charId', 'p005koet');
    const stats = { digimonId: 3, level: 99, xp: 0, tp: 10, hp: 9000, maxHp: 9000, mp: 800, maxMp: 800,
      stats: { str: 800, def: 800, spt: 800, wis: 800, spd: 800, chr: 20 }, bonuses: {}, elemBonuses: {} };
    localStorage.setItem('partnerStats', JSON.stringify(stats));
    localStorage.setItem('partyStats', JSON.stringify([stats, { ...stats, digimonId: 7 }, { ...stats, digimonId: 8 }]));
    localStorage.setItem('equipment', '[{},{},{}]');
  });
  await page.goto(`${baseUrl(8987)}/?skipTitle=1&map=s651&noEncounters=1`);
  await page.waitForFunction(() => window.__engine && window.__state?.started && !window.__cutscene?.isActive?.(), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const state = await page.evaluate(async () => {
    window.__applyStoryFlag(0x7606, 0);
    const duel = window.__state.pendingDuelId;
    window.__state.pendingDuelId = null;
    window.__applyStoryFlag(0x7a2d, 0);
    const inn = window.__state.pendingInn;
    window.__state.pendingInn = false;
    const { createFlagStore } = await import('./flag-store.js');
    const flags = createFlagStore({ get: () => 0, set: () => {} });
    return { duel: duel ?? null, inn: Boolean(inn), read: flags.get(0x7c0a),
      both: flags.matches ? [flags.matches(0x7c0a, 0), flags.matches(0x7c0a, 1)] : null };
  });
  await page.locator('#game').screenshot({ path: `${out}/field-before-command.png` });
  await page.evaluate(() => window.__applyStoryFlag(0x7404, 0));
  let opened = false;
  try { await page.waitForFunction(() => window.__battle?.isActive?.(), null, { timeout: 8000 }); opened = true; }
  catch { /* The baseline deliberately records the missed command. */ }
  const battle = opened ? await page.evaluate(() => ({ screenId: window.__battleB().screenId, members: window.__battleB().party.length })) : null;
  await page.locator('#game').screenshot({ path: `${out}/after-command.png` });
  let returned = null;
  const played = new Set();
  if (opened && !process.env.STORYBANK_BASELINE) {
    // Shorten damage, never write battle state, win markers or the return map.
    await page.evaluate(() => { window.__gameSpeed = 4; });
    for (let i = 0; i < 100 && await page.evaluate(() => window.__battle.isActive()); i++) {
      const index = await page.evaluate(() => { const b = window.__battleB(); if (b?.enemy && b.enemy.hp > 1) b.enemy.hp = 1; return b?.partyIndex; });
      if (index != null) played.add(index);
      await page.keyboard.down('Enter');
      await page.waitForTimeout(100);
      await page.keyboard.up('Enter');
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(400);
    returned = await page.evaluate(() => ({ active: window.__battle.isActive(),
      map: window.__state.manifest.maps[window.__state.mapIdx].id, busy: window.__engineBridge.isBusy() }));
    await page.locator('#game').screenshot({ path: `${out}/returned-to-field.png` });
  }
  const ok = state.duel === 13 && state.inn && state.read === 1 && state.both?.every(Boolean)
    && opened && battle.screenId === 242 && played.size === battle.members && returned?.active === false && returned.map === "s651" && !returned.busy && errors.length === 0;
  const result = { ok, state, opened, battle, played: [...played], returned, errors };
  writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (!ok && !process.env.STORYBANK_BASELINE) process.exitCode = 1;
} finally { await browser.close(); }
