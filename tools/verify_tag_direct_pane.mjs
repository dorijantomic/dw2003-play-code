// Playtest bug 12b: confirming a TAG row opens the DNA pane DIRECTLY.
//
// Replays the real party the operator used (Renamon with Kyubimon equipped), walks
// the ordinary command list to the Tag row, opens the partner list and confirms the
// Renamon row, and records the walker state trail across that confirm. There must
// be NO hand-drawn form screen between the partner list (state 11) and the pane
// (state 15): the discard of that screen is the whole point of the change.
//
// The pane's first sub-state is the species strip, whose names are read from the
// pane's own text widgets (its own decoder), so the frames show RENAMON and KYUBIMON.
//
// Server: python3 -m http.server 8831 --directory web
// Run:    VERIFY_PORT=8831 tools/run-playwright.sh tools/verify_tag_direct_pane.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.TAGPANE_ROOT || `${baseUrl(8831)}/`;
const OUT = process.env.TAGPANE_SHOT || ".bunny-scratch/tagpane-shots";
mkdirSync(OUT, { recursive: true });

const KYUBIMON = 15;
const member = (digimonId, level, name, equipped = []) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 300, maxMp: 300, dvGauge: 0,
  name,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
  formLedger: equipped.map((id) => ({ id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] })),
  equippedForms: equipped.slice(),
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
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.partner, seed.third]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, {
  lead: member(9, 20, "Dinohumon"),
  partner: member(7, 20, "Renamon", [KYUBIMON]),
  third: member(7, 20, "Patamon"),
});

const problems = [];
const expect = (ok, m) => { console.log(ok ? "ok  " : "FAIL", m); if (!ok) problems.push(m); };
const tap = async (key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
  await page.waitForTimeout(200);
};
const shot = async (n) => {
  writeFileSync(`${OUT}/${n}.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png")))
      .split(",")[1], "base64"));
  console.log("shot", n);
};
const state = () => page.evaluate(() => window.__battleB?.()?.state ?? null);
const dna = () => page.evaluate(() => window.__battleDnaNative?.diagnostics?.() ?? null);
const cmdRow = () => page.evaluate(() =>
  window.__battleCmdNative?.diagnostics?.().selection ?? null);
/** The pane's own widget text, decoded by its painter's codec. */
const paneText = async (x) => page.evaluate(async (want) => {
  const { decodeNativeText } = await import("/native-screen-text.js");
  const widgets = window.__battleDnaNative?._session?.pane?.widgets;
  return (widgets?.textWidgets() ?? [])
    .filter((w) => w.penX === want)
    .sort((a, b) => a.penY - b.penY)
    .map((w) => ({ y: w.penY, text: w.lines?.[0]?.bytes?.length ? decodeNativeText(w.lines[0].bytes).text : "" }));
}, x);

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__battle.start({
    enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
  }));
  await waitForCommandMenu(page);
  await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false,
    null, { timeout: 30_000 });

  // Command row 3 is Tag.
  for (let i = 0; i < 8 && (await cmdRow()) !== 3; i++) await tap("ArrowDown");
  expect(await cmdRow() === 3, `the command list is on the Tag row (${await cmdRow()})`);
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 11, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 });
  await shot("01-partner-list");

  // The list's first row is the Renamon partner. Confirm it and sample the walker
  // state across the whole transition.
  const trail = [];
  const sampler = setInterval(async () => {
    try { const s = await page.evaluate(() => window.__battleB?.()?.state ?? null); if (s !== null) trail.push(s); }
    catch { /* page might be mid-navigation */ }
  }, 25);
  await tap("Enter");
  await page.waitForTimeout(700);
  clearInterval(sampler);
  await page.waitForFunction(() => window.__battleB?.()?.state === 15, null, { timeout: 10_000 })
    .then(() => expect(true, "the TAG row confirm reaches the pane state (15) directly"))
    .catch(() => expect(false, "the pane state (15) was never reached"));
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.subState === 0,
    null, { timeout: 10_000 });
  await shot("02-pane-species-strip");

  const seen = [...new Set(trail)].sort((a, b) => a - b);
  console.log("state trail after the confirm:", JSON.stringify(trail));
  expect(!trail.includes(12),
    `no hand-drawn form screen (state 12) appears in the trail (${JSON.stringify(trail)})`);
  expect(trail.includes(15), `the pane (state 15) is the screen the confirm lands on (${JSON.stringify(trail)})`);

  // The pane's own species strip, named by its own text widgets.
  const names = await paneText(187);
  const shown = names.slice(0, 2).map((n) => n.text);
  console.log("pane species names:", JSON.stringify(names));
  expect(names[0]?.text === "Renamon" && names[1]?.text === "Kyubimon",
    `the first screen after the confirm names Renamon then Kyubimon (${JSON.stringify(shown)})`);
  const d = await dna();
  expect(Array.isArray(d?.pane?.species) && d.pane.species.join() === "373,374",
    `the strip is the partner's own line 373 Renamon / 374 Kyubimon (${JSON.stringify(d?.pane?.species)})`);

  await tap("ArrowDown");
  await shot("03-pane-kyubimon-selected");
  await tap("Enter");
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.subState === 1,
    null, { timeout: 10_000 });
  await shot("04-pane-switch-dna-rows");

  writeFileSync(`${OUT}/trail.json`, JSON.stringify({ trail, seen, names, species: d?.pane?.species, errors }, null, 2));
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}

console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exit(problems.length ? 1 : 0);
