// The in-battle DNA pane in REAL PLAY: an ordinary battle, a party that the disc
// says can DNA, and the four screens a player walks to use it.
//
// Why this check exists: tools/verify_battle_dnalist.mjs drives the pane's adapter
// on its own and seeds every id by hand, which is why it passed while the pane was
// reading the wrong rows in a real fight (dnacommand-report.md §5). This one
// starts a battle from an ordinary save state, presses ordinary keys — the command
// list, the partner list, the form chooser, then the pane — and reads what the
// player's screen shows.
//
// The party is one of the disc's own eleven DNA pairs, read out of the profile
// table the pane reads: row 8's +0x3D is 15 and row 14's +0x55 is 15, and both
// carry 432 in their +0x2A halfword (dnacommand-report.md §1). Row 8 is Dinohumon
// and row 14 is Kyubimon, which are digimon.json's ids 9 and 15 — so the walker's
// own ids for this pair are 9 and 15 and the game's form ids are 386 and 374.
// Every id the pane is handed goes through one mapping (native/pause-status.ts
// `gameFormId`); if that mapping is missing the pane asks the species getter for
// form 9, which no row carries, finds no pairing, and never shows the DNA DV row.
//
// The three members are seeded the way the disc hands them out. The party is
// [p003pken, p009rena, p010pata], which are roster slots 0, 6 and 7 — Kotemon,
// Renamon, Patamon, the eight starters being the disc's profile rows 0..7 — so
// the lead is Kotemon already digivolved into Dinohumon (walker 9) and the
// partner is the BASE Renamon with Kyubimon (walker 15) sitting in its first
// equip slot and in its acquired-form ledger. That is what the original's strip
// lists: `F0x80016D94` answers the ROSTER SLOT for the party position the pane
// was given, the pane stores it at +0x60, and its first row is that slot's own
// profile row's first halfword — Renamon — with the equipped triple after it
// (pro/fightstg.s 0x80098130-0x80098178). Seeding the partner AS Kyubimon instead
// would hide the difference, because then its starter and its equipped form are
// the same row.
//
// Server: python3 -m http.server 8827 --directory web
// Run:    VERIFY_PORT=8827 tools/run-playwright.sh tools/verify_dna_realplay.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.DNAREAL_ROOT || `${baseUrl(8827)}/`;
const OUT = process.env.DNAREAL_SHOT || ".bunny-scratch/dnarealshots";
mkdirSync(OUT, { recursive: true });

// The disc's pair, both halves: walker id 9 (game form 386, Dinohumon) and walker
// id 15 (game form 374, Kyubimon), DNA action 432. The MP is well over the 80 the
// action costs, so the pane shows the DNA DV row in its normal palette and the
// confirm is not refused for want of MP.
const LEAD = 9, PARTNER = 7, THIRD = 7;
const KYUBIMON = 15;
const ACTION = 432;
// Roster slots of [p003pken, p009rena, p010pata]: 0 Kotemon, 6 Renamon, 7 Patamon
// (ROSTER_SLOT_CHARIDS, engine/dw3/roster.ts).
const LEAD_SLOT = 0, PARTNER_SLOT = 6, THIRD_SLOT = 7;
const member = (digimonId, level, name, equipped = []) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 300, maxMp: 300, dvGauge: 0,
  name,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
  // The acquired-form ledger one equip slot per entry carries, which is what
  // F0x800176AC validates an equipped id against before it keeps it.
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
  lead: member(LEAD, 20, "Dinohumon"),
  partner: member(PARTNER, 20, "Renamon", [KYUBIMON]),
  third: member(THIRD, 20, "Patamon"),
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const expect = (ok, m) => { console.log(ok ? "ok  " : "FAIL", m); if (!ok) fail(m); };

/** One real key press: held across frames, released, so the screen sees an edge. */
const tap = async (key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
  await page.waitForTimeout(200);
};
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const dna = () => page.evaluate(() => window.__battleDnaNative?.diagnostics?.() ?? null);
const tag = () => page.evaluate(() => window.__battleTagNative?.diagnostics?.() ?? null);
const cmdRow = () => page.evaluate(() =>
  window.__battleCmdNative?.diagnostics?.().selection ?? null);
const mp = () => page.evaluate(() => {
  const b = window.__battleB();
  return { active: b.player.mp, partner: b.playerRecords[1].mp, activeId: b.player.profile.id };
});
/** The text the pane's own widgets really show, decoded by the painter's codec. */
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
  // The opening line has to be read before the command menu is armed (verify-battle-wait.mjs).
  await waitForCommandMenu(page);
  await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false,
    null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });

  // The price the game charges for this pair, read out of the disc's own technique
  // table (the pane's DNA_PRICES + 0x12*(id-1) first halfword) rather than typed.
  const price = await page.evaluate((id) => {
    const bytes = window.__battleDnaNative?._data?.techniques;
    if (!bytes) return null;
    const at = 0x12 * (id - 1);
    return { mp: bytes[at] | (bytes[at + 1] << 8), clip: bytes[at + 0x10] };
  }, ACTION);
  expect(price !== null, `the pane's own technique table is loaded (${JSON.stringify(price)})`);
  expect(price?.clip === 12, `DNA action ${ACTION} runs on clip 12 (${price?.clip})`);

  // Command row 3 is Tag, and Tag is the way into this pane in the original: both
  // Tag callers allocate the same follow-up object (F0x80098884 / F0x800988FC).
  for (let i = 0; i < 8 && (await cmdRow()) !== 3; i++) { await tap("ArrowDown"); }
  expect(await cmdRow() === 3, `the command list is on its Tag row (${await cmdRow()})`);
  await tap("Enter");

  // The partner list. Its own highlight starts on the first partner; walk it to the
  // Kyubimon so the two halves of the pair are the ones on screen.
  await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  const tagRows = await tag();
  expect(tagRows?.rows > 0,
    `the partner list is up with ${JSON.stringify(tagRows?.rows)} rows`);
  // The list's rows are the OTHER two party members, in party order, so its first
  // row is the Renamon. The check asks the battle which live form each row is
  // rather than trusting the order — and the partner is the BASE Renamon, with
  // Kyubimon only in its equip slot, which is the state this whole check is for.
  const chosen = await page.evaluate(() => {
    const t = window.__battleTagNative.diagnostics();
    const b = window.__battleB();
    const slot = t.candidates[t.selection];
    return { selection: t.selection, candidates: t.candidates, slot,
      formId: b.playerRecords[slot]?.profile?.id ?? null,
      equipped: b.playerRecords[slot]?.statsRecord?.equippedForms ?? [] };
  });
  expect(chosen.formId === PARTNER && chosen.equipped.join() === String(KYUBIMON),
    `the highlighted partner is the base Renamon with Kyubimon equipped, walker ${PARTNER}/${KYUBIMON} (${JSON.stringify(chosen)})`);
  await tap("Enter");

  // No form screen between the partner list and the pane (playtest bug 12b): the
  // confirm opens the pane directly. The form the DNA pairing needs is picked on
  // the pane's own species strip below, which is where the disc picks it too.

  // The pane. The strip's first row is the partner's STARTER species, because
  // `self+0x60` is the roster slot [0x8004B44C] answers for the party position
  // (F0x80016D94) and the strip's first entry is `*(u16 *)(0x8003EF5C + 0x58*it)`
  // — row 6, Renamon, game form 373. Its second row is the equipped Kyubimon
  // (374). Reading a row of the member's LIVE form instead would make row 0 the
  // form the Digimon happens to be in now, which is what this check used to see
  // when the partner was seeded as Kyubimon.
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  let d = await dna();
  expect(d?.step === "pane" && d?.pane?.ready === true,
    `the DNA pane is live (${JSON.stringify({ step: d?.step, ready: d?.pane?.ready })})`);
  // The pane is handed the roster slot each party position holds, from the one
  // shared helper (partyPositionRosterSlot): [Kotemon, Renamon, Patamon] are
  // slots [0, 6, 7], and the partner's own is what the strip is built from.
  const slots = await page.evaluate(() => (window.__battleDnaNative?._seed?.members ?? [])
    .map((m) => m.rosterSlot));
  expect(slots.join() === `${LEAD_SLOT},${PARTNER_SLOT},${THIRD_SLOT}`,
    `each member is handed its roster slot, not a row of its live form (${JSON.stringify(slots)})`);
  const strip = d?.pane?.species ?? [];
  expect(strip.join() === "373,374",
    `the strip is the partner's own line: Renamon then Kyubimon (${JSON.stringify(strip)})`);
  const names = await paneText(187);
  expect(names.slice(0, 2).map((n) => n.text).join("|") === "Renamon|Kyubimon",
    `the pane names the partner's line Renamon then Kyubimon (${JSON.stringify(names.slice(0, 2))})`);
  await shot("dna-pane-names");

  // The cursor starts on row 0, the partner's starter, which cannot DNA with a
  // digivolved lead: the acting record is Dinohumon (row 8, +0x3D = 15) and
  // Renamon's row carries +0x55 = 7. Down walks it onto the equipped Kyubimon,
  // whose row 14 carries +0x55 = 15 — the match the pane's own test looks for.
  expect(d?.pane?.stripCursor === 0,
    `the species cursor starts on the partner's own starter row (${d?.pane?.stripCursor})`);
  await tap("ArrowDown");
  d = await dna();
  expect(d?.pane?.stripCursor === 1,
    `Down moved the species cursor onto the equipped Kyubimon (${d?.pane?.stripCursor})`);

  // Circle on the names opens the Switch / DNA DV rows. The row list has two rows
  // only when the pane's own pairing test settles, which is the whole point: the
  // acting record's +0x3D (15) against the cursor species record's +0x55 (15).
  await tap("Enter");
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.subState === 1,
    null, { timeout: 10_000 }).catch(() => {});
  d = await dna();
  expect(d?.pane?.subState === 1, `the Switch / DNA DV rows are up (${d?.pane?.subState})`);
  expect(d?.pane?.dnaId === ACTION,
    `the pane found the DNA pairing the disc allows (${d?.pane?.dnaId}, wanted ${ACTION})`);
  expect(d?.pane?.price === price?.mp,
    `the DNA DV row shows the game's own price ${price?.mp} (${d?.pane?.price})`);
  await shot("dna-pane-options");

  // Down walks the shared list model's own cursor onto "DNA DV".
  await tap("ArrowDown");
  d = await dna();
  expect(d?.pane?.optionRow === 1, `DNA DV is the selected row (${d?.pane?.optionRow})`);

  // The price widget's own text, as painted.
  const priceText = await paneText(307);
  expect(priceText.some((t) => t.text === String(price?.mp)),
    `the price reads ${price?.mp} on screen (${JSON.stringify(priceText)})`);

  const before = await mp();
  expect(before.active === 300 && before.partner === 300,
    `both members start with 300 MP (${JSON.stringify(before)})`);

  // Circle on DNA DV. The pane answers, "DNA DV!" goes up on the message line and
  // that line holds the turn the way the original's own sequencer does, so the
  // player Circles it away; then the committed action runs and both members' own
  // MP — the number the HUD shows — drops by the price.
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 5, null, { timeout: 10_000 })
    .catch(() => {});
  d = await dna();
  expect(d?.answer !== null && (d?.answer & 0xf) === 1,
    `Circle on DNA DV answered on the DNA row (${d?.answer})`);
  expect(d?.speciesOut === ACTION,
    `the result went out through self+0x80 as action ${ACTION} (${d?.speciesOut})`);
  const line = await page.evaluate(() => window.__battle?.peek?.()?.messageLine?.holdsTurn === true);
  expect(line === true, `the DNA DV! line holds the turn, as the original's does (${line})`);
  await tap("Enter");
  await page.waitForFunction((want) => window.__battleB?.()?.player.mp === want,
    before.active - price?.mp, { timeout: 15_000 }).catch(() => {});
  const paid = await mp();
  expect(paid.active === before.active - price?.mp && paid.partner === before.partner - price?.mp,
    `the fight took ${price?.mp} off both members' own MP (${JSON.stringify(paid)})`);
  // The pane's own copy of the two party records is debited by the same amount
  // (battle-dna-menu.ts dnaPaneCommit, 0x8009864c / 0x80098680); it is a private
  // copy of the record the HUD reads, and the adapter closes the pane on the
  // answer, so that debit is checked where the pane stays open:
  // tools/verify_battle_dnalist.mjs, "the price ... came off both members".
  await shot("dna-dv-answered");

  if (errors.length) fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, action: ACTION, price: price?.mp,
    strip, before, paid }));
} catch (e) {
  fail(e?.stack ?? e?.message ?? String(e));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);