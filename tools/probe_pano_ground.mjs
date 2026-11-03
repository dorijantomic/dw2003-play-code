// probe: camera eye and fighters' feet / heights (render space) in s340 battles, panorama on
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const ROOT = baseUrl(Number(process.env.VERIFY_PORT || 8090));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sample = async (page, get, n = 12) => { const out = []; for (let i = 0; i < n; i++) { out.push(await page.evaluate(get)); await page.waitForTimeout(800); } return out; };
const summ = (rows) => { const ok = rows.filter((r) => r && r.eye); if (!ok.length) return "no samples";
  const ex = ok.map((r) => Math.hypot(r.eye[0], r.eye[2])), ey = ok.map((r) => r.eye[1]);
  return { n: ok.length, eyeRadius: [Math.round(Math.min(...ex)), Math.round(Math.max(...ex))], eyeY: [Math.round(Math.min(...ey)), Math.round(Math.max(...ey))],
    feet: [...new Set(ok.flatMap((r) => r.feet))].sort((a, b) => a - b).slice(0, 3).concat(["..."], [...new Set(ok.flatMap((r) => r.feet))].sort((a, b) => a - b).slice(-2)),
    heights: ok[ok.length - 1].heights, xz: ok[ok.length - 1].xz };
};
// 2v2 practice
{
  const page = await (await browser.newContext({ viewport: { width: 2000, height: 720 } })).newPage();
  await page.addInitScript(() => { localStorage.setItem("assetMode", "hd"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("charId", "p003pken");
    const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
    localStorage.setItem("party", JSON.stringify(["p003pken"])); localStorage.setItem("partnerStats", JSON.stringify(lead)); localStorage.setItem("partyStats", JSON.stringify([lead])); localStorage.setItem("rosterOwned", "1"); });
  await page.goto(`${ROOT}/index.html?skipTitle=1&noEncounters=1&map=s340`);
  await page.waitForFunction(() => window.__state?.started && window.__mpb);
  await page.evaluate(() => { window.__fx.battlepano = true; });
  await page.keyboard.press("f"); await page.waitForTimeout(1500);
  await page.evaluate(() => window.__mpb.practice({ foes: [1, 2].map(() => ({ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 })) }));
  await page.waitForFunction(() => window.__mpb.fight?.r3d?.getPanorama().loaded, null, { timeout: 60000 });
  console.log("2v2", JSON.stringify(summ(await sample(page, () => window.__mpb.fight.r3d.getPanorama()))));
  await page.close();
}
// 1v1 walk-up
{
  const page = await browser.newPage({ viewport: { width: 1140, height: 720 } });
  await page.addInitScript(() => localStorage.setItem("assetMode", "hd"));
  await page.goto(`${ROOT}/index.html?skipTitle=1&map=s340`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__fx.battlepano = true; const s = window.__state;
    if (!s.party?.length) { s.party = ["p003pken", "p009rena", "p010pata"]; s.packId = "A"; s.charId = "p003pken";
      const ci = s.manifest?.characters?.findIndex((c) => c.id === "p003pken") ?? -1; if (ci > 0) s.charIdx = ci;
      const block = (digimonId, hp, mp) => ({ digimonId, level: 5, xp: 0, tp: 0, hp, maxHp: hp, mp, maxMp: mp, bonuses: {}, elemBonuses: {} });
      s.partnerStats = block(1, 86, 38); s.partyStats = [s.partnerStats, block(7, 80, 40), block(8, 90, 55)]; } });
  let active = false; const dirs = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  for (let i = 0; i < 80 && !active; i++) {
    await page.evaluate(() => { window.__state._encTick = 0; window.__state._encCounter = 0; });
    const k = dirs[i % 4]; await page.keyboard.down(k); await page.waitForTimeout(400); await page.keyboard.up(k);
    active = await page.evaluate(() => !!window.__battle?.isActive?.()); await page.waitForTimeout(120);
  }
  if (!active) console.log("1v1: no encounter");
  else { await page.waitForFunction(() => window.__battle3d?.getPanorama?.().loaded, null, { timeout: 60000 }).catch(() => {});
    console.log("1v1", JSON.stringify(summ(await sample(page, () => window.__battle3d.getPanorama(), 15)))); }
}
await browser.close();
