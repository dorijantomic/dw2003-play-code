// An enemy-only Digimon on OUR side must not frame itself as the one being hit. Meramon (always an enemy on the disc)
// casts Flame Ball: its clip 9 opens with camera preset 1, "cut to the near fighter", which for a far-side attacker is the
// victim. From our side the near fighter is Meramon himself; the mirror (web/fight/side-mirror.js) turns it to the enemy.
//
// Samples the camera record while the action plays and reports where the camera was looking: at our own slot, or at the
// enemy's.
//
// Server: python3 -m http.server 8791 --directory web
// Run:    VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_mirror_camera.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MC_ROOT || `${baseUrl(8791)}/`;
const OUT = process.env.MC_SHOT || "/tmp/mcshots";
mkdirSync(OUT, { recursive: true });
const extra = JSON.parse(readFileSync(resolve(HERE, "../web/assets/data/extra_species.json"), "utf8"));
const base = JSON.parse(readFileSync(resolve(HERE, "../web/assets/data/digimon.json"), "utf8"));
const NAME = process.env.MC_NAME || "Meramon";
const SPECIES = extra.digimon.find((d) => d.name === NAME) ?? base.digimon.find((d) => d.name === NAME);
const MODE = process.env.MC_MODE || "attack";             // attack: playerAttack(tech); tech: setPlayerAnimByTech (a support move)
const TECH = Number(process.env.MC_TECH || 137);          // Flame Ball, clip 9

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((k) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const ledger = [3, k].map((id) => ({ id, formLevel: 3, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
  const member = (digimonId, level, formLedger, equippedForms) => ({
    digimonId, level, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 400, maxMp: 400,
    stats: { str: 90, def: 60, spt: 50, wis: 50, spd: 60, chr: 20 }, bonuses: {}, elemBonuses: {}, formLedger, equippedForms,
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(3, 12, ledger, [k, 0, 0])));
  localStorage.setItem("partyStats", JSON.stringify([member(3, 12, ledger, [k, 0, 0]), member(7, 5, [], []), member(8, 5, [], [])]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, SPECIES.id);

const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !(await page.evaluate(() => !!window.__battle?.isActive?.()))) {
    if (await page.evaluate(() => window.__textbox?.isOpen?.() ?? false)) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await waitForCommandMenu(page);
  await page.evaluate((id) => window.__battleDv(id), SPECIES.id);
  await page.waitForFunction((id) => window.__battleB?.()?.playerRecords?.[0]?.profile?.id === id, SPECIES.id, { timeout: 60_000 });
  await waitForCommandMenu(page).catch(() => {});
  await page.waitForTimeout(7000);

  const result = await page.evaluate(async ({ techId, mode }) => {
    const r = window.__battle3d;
    const slots = r.debugArenaSlots?.() ?? null;
    const samples = [];
    const ok = mode === "tech" ? r.setPlayerAnimByTech(techId, { onHit: () => {} }) : r.playerAttack(techId, { onHit: () => {} });
    const t0 = performance.now();
    while (performance.now() - t0 < 5200) {
      const dbg = r.__dnaDebug?.() ?? null;
      const cam = dbg?.camRecord ?? null;
      // the camera really looking at an arena point: `look` of the frame as it was last drawn
      samples.push({ t: Math.round(performance.now() - t0), kind: cam?.kind ?? null, issuer: cam?.issuer ?? null, preset: cam?.preset ?? null, fields: dbg?.cam?.look ? [0, 0, 0, ...dbg.cam.look] : null });
      await new Promise((res) => setTimeout(res, 50));
    }
    return { ok, slots, samples };
  }, { techId: TECH, mode: MODE });
  console.log("  slots", JSON.stringify(result.slots));
  const withFields = result.samples.filter((s) => s.fields);
  console.log("  samples with a camera:", withFields.length, "of", result.samples.length);
  // the camera is looking at the arena point its target names (fields 3-5); our slot is at negative z, the enemy's at positive z
  const targets = withFields.map((s) => s.fields[5]);
  const hitCuts = result.samples.filter((s) => s.issuer === "player" && s.preset != null);
  console.log("  preset cuts issued by our Meramon:", hitCuts.length, "distinct presets", JSON.stringify([...new Set(hitCuts.map((s) => s.preset))]));
  // the camera record as our Digimon's own op5 left it: issuer, kind, preset, and which side the shot looks at
  const trace = [];
  for (const smp of result.samples) {
    if (smp.issuer !== "player" || !smp.fields) continue;
    const key = `${smp.kind}/${smp.preset ?? "-"} looks ${smp.fields[5] < 0 ? "NEAR(us)" : "FAR(enemy)"}`;
    if (trace[trace.length - 1] !== key) trace.push(key);
  }
  console.log("  our camera cuts, in order:", JSON.stringify(trace));
  const nearView = targets.filter((z) => z < 0).length, farView = targets.filter((z) => z > 0).length;
  console.log(`  camera target z: ${nearView} samples looking at our side (z<0), ${farView} at the enemy side (z>0)`);
  expect(result.ok, `${SPECIES.name}'s technique ${TECH} found a script`);
  expect(withFields.length > 0, "the camera record was read");
  // the unmirrored preset 1 cuts to our own near shot (z < 0) for the whole action; mirrored it looks across at the enemy
  console.log(`RESULT ${NAME} tech ${TECH} (${MODE}): near ${nearView}, far ${farView}`);
  if (MODE === "attack" && process.env.MC_EXPECT_FAR !== "0") expect(farView > 0, "at some point of the action the camera looks at the enemy, not only at our own Digimon");
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
  writeFileSync(`${OUT}/samples.json`, JSON.stringify(result, null, 1));
} catch (error) {
  console.error("ERROR", error.message);
  problems.push(error.message);
} finally {
  await browser.close();
}
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exitCode = problems.length ? 1 : 0;
