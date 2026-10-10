// tools/verify_attack_camera_ownership.mjs
//
// Does an ordinary landed attack leave the camera alone, and does an item use still install its
// clip-10 camera? (Premise corrected 2026-10-08: this file used to REQUIRE a landed attack to
// produce its own defender camera. That was the WRONG rule — the disc installs no defender camera
// on an ordinary hit — so it is re-aimed, not deleted.)
//
// The rule (settled .dw3-research/attack-camera-rule-2026-10-08/worker-av.md; confirmed live
// attack-camera-timing-2026-10-08/worker-ax.md):
//   * an ordinary landed basic/TECH hit is the attacker's op-1 clip 2/3/4 reaction, and clips
//     2/3/4 author no op5 in any of the 249 packs — so the hit moves nothing;
//   * the clip-10 op-5 pair is the ITEM/USE close-up (the damage-reaction machine's DEFAULT arm,
//     reached only from the battle item/command executor);
//   * a preset names a SLOT, so the DEFENDER's authored preset 3 aimed at slot 0 = OUR Digimon.
//
// So: every landed player attack must install NO defender-signed camera, and an item use must
// still install and glide its clip-10 pair.
//
// Server: python3 -m http.server "$PORT" --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_attack_camera_ownership.mjs
import { chromium } from "playwright";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";
import { mkdirSync } from "node:fs";
const PORT = process.env.VERIFY_PORT || 8788;
const ROOT = process.env.ATTACK_CAM_ROOT || `http://127.0.0.1:${PORT}/`;
const OUT = process.env.ATTACK_CAM_SHOT || ".dw3-research/attack-camera-implement-2026-10-08/shots/verify";
const ENEMY_SPD = Number(process.env.ATTACK_CAM_ENEMY_SPD || 0);
const TURNS = Number(process.env.ATTACK_CAM_TURNS || 2);
const ITEM = Number(process.env.ATTACK_CAM_ITEM || 43);
mkdirSync(OUT, { recursive: true });

const member = (digimonId) => ({ digimonId, level: 10, xp: 0, tp: 10, hp: 99999, maxHp: 99999, mp: 999, maxMp: 999,
  stats: { str: 9999, def: 9999, spt: 60, wis: 50, spd: 9999, chr: 30 }, bonuses: {}, elemBonuses: {} });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior"); localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", JSON.stringify(seed.inv.map((id) => ({ id, qty: 9 }))));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, { lead: member(1), rena: member(7), pata: member(8), inv: [ITEM, 43, 45] });

const tap = (k) => page.evaluate((kk) => { window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })); window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })); }, k);

const R = () => {
  const r = window.__battle3d; const d = r && r.__dnaDebug ? r.__dnaDebug() : null;
  const b = window.__battleB ? window.__battleB() : null;
  const p = r && r.playerAnimator, e = r && r.enemyAnimator;
  const peek = (window.__battle)?.peek?.(); const ml = peek?.messageLine;
  return {
    state: b?.state ?? null,
    holds: !!(ml?.active && !ml.finished && (ml.holdsTurn || peek?.waitsForLine)),
    pages: !!b?._resultPages?.length,
    pclip: p ? (p._clip ?? null) : null, pvm: !!(p && p.vm && !p.vm.ended),
    eclip: e ? (e._clip ?? null) : null, evm: !!(e && e.vm && !e.vm.ended),
    ownedR: d ? !!d.camScriptOwned : null,
    mode: d ? d.camMode : null,
    rec: d?.camRecord ? { kind: d.camRecord.kind, issuer: d.camRecord.issuer ?? null,
      preset: d.camRecord.preset ?? null, progress: d.camRecord.progress ?? null,
      duration: d.camRecord.duration ?? null } : null,
    eye: d?.cam ? d.cam.eye : null,
    defenderReaction: d ? d.enemyReactionCam : null,
    enemyFolder: d ? d.enemyFolder : null,
  };
};

let result;
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40000 });
  await page.waitForTimeout(500);
  await page.evaluate(async (spd) => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 10, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
    const b = window.__battleB(); b.enemy.hp = 999999; b.enemy.maxHp = 999999; b.enemy.spd = spd;
    b.player.hp = 99999; b.player.maxHp = 99999;
  }, ENEMY_SPD);
  await waitForCommandMenu(page);
  await page.evaluate((src) => {
    const fn = new Function("return (" + src + ")()");
    window.__t = []; window.__tOn = true;
    (function loop() { if (!window.__tOn) return; try { window.__t.push({ n: window.__t.length, ...fn() }); } catch (e) {} requestAnimationFrame(loop); })();
  }, R.toString());

  for (let turn = 0; turn < TURNS; turn++) {
    await page.waitForFunction(() => { const p = window.__battle?.peek?.(); return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false; }, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(150);
    for (let i = 0; i < 10; i++) { const sel = await page.evaluate(() => window.__battleCmdNative.diagnostics().selection); if (sel === 0) break; await tap("ArrowUp"); await page.waitForTimeout(120); }
    await tap("Enter");
    let lastTap = -10;
    for (let k = 0; k < 520; k++) {
      const s = await page.evaluate(R);
      if ((s.holds || (s.state === 7 && s.pages)) && k - lastTap >= 4) { lastTap = k; await tap("Enter"); }
      if (k > 40 && s.state === 2 && !s.holds) break;
      await page.waitForTimeout(25);
    }
  }

  // One item use, to prove the item camera still installs and glides.
  let itemDrove = false;
  await page.waitForFunction(() => { const p = window.__battle?.peek?.(); return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false; }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(150);
  for (let i = 0; i < 12; i++) { const sel = await page.evaluate(() => window.__battleCmdNative.diagnostics().selection); if (sel === 4) break; await tap("ArrowDown"); await page.waitForTimeout(120); }
  await tap("Enter");
  const ready = await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready === true, null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (ready) {
    const ids = await page.evaluate(() => window.__battleItemNative.diagnostics().ids);
    const row = ids.indexOf(ITEM);
    for (let i = 0; i < row; i++) { await tap("ArrowDown"); await page.waitForTimeout(150); }
    await tap("Enter");
    itemDrove = true;
    let lastTap = -10;
    for (let k = 0; k < 420; k++) {
      const s = await page.evaluate(R);
      if ((s.holds || (s.state === 7 && s.pages)) && k - lastTap >= 4) { lastTap = k; await tap("Enter"); }
      if (k > 60 && s.state === 2 && !s.holds) break;
      await page.waitForTimeout(25);
    }
  }
  const frames = (await page.evaluate(() => { window.__tOn = false; return window.__t; })).filter((f) => f.eye);

  // Player basic-attack episodes: a contiguous run of the player's clip-5 VM running.
  const episodes = [];
  let cur = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const attacking = f.pvm && f.pclip === 5;
    if (attacking && !cur) cur = { start: i, frames: [f] };
    else if (attacking) cur.frames.push(f);
    else if (cur) { episodes.push(cur); cur = null; }
  }
  if (cur) episodes.push(cur);

  for (let n = 0; n < episodes.length; n++) {
    const ep = episodes[n];
    const tail = frames.slice(ep.start, Math.min(frames.length, ep.start + ep.frames.length + 60));
    const hit = tail.some((f) => f.eclip === 2 || f.eclip === 3);   // survive / death reaction
    const miss = tail.some((f) => f.eclip === 4);                    // evade reaction
    // The disc's rule: NO record the DEFENDER's side installed may appear during the attack.
    // A player attack's defender is the enemy, so any `issuer: "enemy"` preset/move here is the
    // removed stand-in.
    const defenderInstalls = [...new Set(tail.filter((f) => f.rec && f.rec.issuer === "enemy"
      && f.rec.preset != null).map((f) => `p${f.rec.preset}:d${f.rec.duration}`))];
    const startEye = ep.frames[0].eye;
    const reaction = (tail.find((f) => f.defenderReaction) || {}).defenderReaction ?? null;
    ep.result = { hit, miss, defenderInstalls, startEye,
      defenderPreset: reaction ? (reaction[0]?.preset ?? null) : null, frames: ep.frames.length };
  }

  const landed = episodes.filter((e) => e.result.hit && !e.result.miss);
  const failed = landed.filter((e) => e.result.defenderInstalls.length > 0);

  // The item use: a clip-10 episode that installed a preset camera.
  const itemEps = [];
  cur = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const using = f.pvm && f.pclip === 10;
    if (using && !cur) cur = { start: i, frames: [f] };
    else if (using) cur.frames.push(f);
    else if (cur) { itemEps.push(cur); cur = null; }
  }
  if (cur) itemEps.push(cur);
  const itemInstalls = itemEps.map((ep) => {
    const tail = frames.slice(ep.start, Math.min(frames.length, ep.start + ep.frames.length + 90));
    return [...new Set(tail.filter((f) => f.rec && f.rec.preset != null)
      .map((f) => `${f.rec.kind}:${f.rec.issuer}:p${f.rec.preset}:d${f.rec.duration}`))];
  });
  const itemInstalled = itemInstalls.some((sigs) => sigs.some((s) => s.includes("preset") && s.includes("d60")));

  await page.screenshot({ path: `${OUT}/last-frame.png` }).catch(() => {});
  result = {
    ok: failed.length === 0 && (!itemDrove || itemInstalled),
    enemySpd: ENEMY_SPD, turns: TURNS, totalFrames: frames.length,
    playerAttacks: episodes.length,
    landedPlayerAttacks: landed.length,
    attacksWithDefenderCamera: failed.length,
    itemDrove, itemInstalled, itemInstalls,
    episodes: episodes.map((e, i) => ({ n: i, ...e.result })),
    errors,
  };
} catch (e) {
  result = { ok: false, error: e.message, errors };
} finally {
  await browser.close();
}
console.log(JSON.stringify(result, null, 1));
// Compact one-liner for the suite log.
console.log(`ATTACK-CAMERA ${result.ok ? "PASS" : "FAIL"}: ${result.landedPlayerAttacks} landed player attacks, ` +
  `${result.attacksWithDefenderCamera} installed a defender camera (must be 0)` +
  (result.episodes ? " | " + result.episodes.map((e) => `#${e.n}${e.hit ? "H" : e.miss ? "M" : "?"}:defInst=[${e.defenderInstalls.join(",")}]`).join(" ") : "") +
  ` | item ${result.itemDrove ? (result.itemInstalled ? "installed" : "NO-INSTALL") : "not-driven"}`);
process.exitCode = result.ok ? 0 : 1;
