// The enemy-only Digimon as player forms, in the game's own Digivolve list: a Digimon that has learned
// Kunemon (walker id 56) and Kuwagamon (71) has them in its list, they are named from the disc's name
// bank, and picking one digivolves into it in the 3D fight.
//
// Server: python3 -m http.server 8791 --directory web
// Run:    VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_extra_roster.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.XR_ROOT || `${baseUrl(8791)}/`;
const OUT = process.env.XR_SHOT || "/tmp/xrshots";
mkdirSync(OUT, { recursive: true });
const extra = JSON.parse(readFileSync(resolve(HERE, "../web/assets/data/extra_species.json"), "utf8"));
const byName = Object.fromEntries(extra.digimon.map((d) => [d.name, d]));
const KUNEMON = byName.Kunemon.id, KUWAGAMON = byName.Kuwagamon.id;
const GAME_ID = { [KUNEMON]: extra.meta.Kunemon.value0, [KUWAGAMON]: extra.meta.Kuwagamon.value0 };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console error]", m.text().slice(0, 200)); });

await page.addInitScript(({ k, w }) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const ledger = [3, k, w].map((id) => ({ id, formLevel: 3, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
  const member = (digimonId, level, formLedger, equippedForms) => ({
    digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 200, maxMp: 200,
    stats: { str: 90, def: 60, spt: 50, wis: 50, spd: 60, chr: 20 },
    bonuses: {}, elemBonuses: {}, formLedger, equippedForms,
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(3, 12, ledger, [k, w, 0])));
  localStorage.setItem("partyStats", JSON.stringify([member(3, 12, ledger, [k, w, 0]), member(7, 5, [], []), member(8, 5, [], [])]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, { k: KUNEMON, w: KUWAGAMON });

const tap = async (k, ms = 90) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(80); };
const shot = async (name) => { const c = await page.$("canvas"); writeFileSync(`${OUT}/${name}.png`, c ? await c.screenshot() : await page.screenshot()); console.log("shot", name); };
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  const loaded = await page.evaluate(async () => {
    const x = await window.__extraRoster?.load?.();
    const dj = await (await fetch("assets/data/digimon.json")).json();
    const ev = await (await fetch("assets/data/evolutions.json")).json();
    return { extra: !!x, digimon: dj.digimon.length, records: ev.lines.map((l) => l.records.length) };
  });
  expect(loaded.extra && loaded.digimon === 55 + 135, `digimon.json carries the 135 extra species (${loaded.digimon} rows)`);
  expect(loaded.records.every((n) => n === 44 + 135), `every line gained 135 unlock records (${loaded.records})`);

  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 30_000;
  let launched = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({ battle: !!window.__battle?.isActive?.(), tb: window.__textbox?.isOpen?.() ?? false }));
    if (st.battle) { launched = true; break; }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  expect(launched, "the scripted battle launched");
  if (!launched) throw new Error("no battle");

  await waitForCommandMenu(page);
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready, null, { timeout: 30_000 });
  await tap("ArrowDown"); await tap("ArrowDown");
  for (let i = 0; i < 4; i++) {
    await tap("Enter");
    if (await page.evaluate(() => window.__battleB?.()?.state === 13)) break;
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 13, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__battleFormNative?.diagnostics?.().ready, null, { timeout: 30_000 });
  await page.waitForTimeout(400);
  await shot("extra-form-list");

  const list = await page.evaluate(async () => {
    const { decodeNativeText } = await import("/native-screen-text.js");
    const screen = window.__battleFormNative;
    const widgets = screen._session.widgets.textWidgets();
    const names = widgets.filter((w) => w.penX === 187).sort((a, b) => a.penY - b.penY)
      .map((w) => (w.lines?.[0]?.bytes?.length ? decodeNativeText(w.lines[0].bytes).text : ""));
    return { rows: screen.diagnostics().rows, species: screen.diagnostics().species, names };
  });
  console.log("  rows", JSON.stringify(list));
  expect(list.rows === 3, `the list has the current form and the two extra forms (${list.rows})`);
  expect(list.species?.[1] === GAME_ID[KUNEMON] && list.species?.[2] === GAME_ID[KUWAGAMON],
    `rows 1 and 2 are Kunemon and Kuwagamon by their game form ids (${list.species})`);
  expect(list.names?.[1] === "Kunemon" && list.names?.[2] === "Kuwagamon",
    `their names come from the disc's name bank (${JSON.stringify(list.names)})`);

  await tap("ArrowDown"); await page.waitForTimeout(200);
  await shot("extra-form-list-kunemon-panel");
  await tap("Enter"); await page.waitForTimeout(300);
  const committed = await page.evaluate(() => ({ pending: window.__battleB?.()?.pendingAction?.type, formId: window.__battleB?.()?.pendingAction?.formId }));
  expect(committed.pending === "dv" && committed.formId === KUNEMON, `picking Kunemon queues the Digivolve (${JSON.stringify(committed)})`);
  await page.waitForFunction((id) => window.__battleB?.()?.playerRecords?.[window.__battleB?.()?.activePlayerIndex ?? 0]?.profile?.id === id,
    KUNEMON, { timeout: 60_000 }).catch(() => {});
  const form = await page.evaluate(() => { const b = window.__battleB?.(); return b?.playerRecords?.[b?.activePlayerIndex ?? 0]?.profile?.name ?? null; });
  expect(form === "Kunemon", `the Digimon is now Kunemon (${form})`);
  await page.waitForTimeout(1500);
  await shot("extra-kunemon-in-fight");
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exitCode = problems.length ? 1 : 0;
