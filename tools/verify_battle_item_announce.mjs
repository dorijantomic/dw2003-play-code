// tools/verify_battle_item_announce.mjs — the item announcement page, as a player meets it.
//
// The decode (engine/dw3/battle-items.ts, `itemAnnouncementPage`): before any battle
// item effect runs, FIGHTSTG_F0x8008dac0's outer step 0 puts up a battle message box
// page of its own. `fightstg.s:11154` allocates a line object, `:11158` writes payload
// word 0 = 0, `:11157`/`:11159` write payload word 1 = the ItemId, and `:11161` is
// **kind 14** (`li $a1, 0xe`). The arm `.L0x80099ca0` (:23809-23847) is line 1
// `esmfight[0x16]` (`:23822`) — the bare name placeholder the shared tail fills with the
// acting Digimon — line 2 `esmfight[0x09]` `{1}!` (`:23833`), and the second line's slot 1
// is the item's name read out of bank 0x6a by ItemId (`addiu $a0, 0x6a` at `:23838`,
// `lw $a2, 0x4($s2)` at `:23841`, then `+0x120(line2, handle, payload[1], 1)` at
// `:23842`/`:23845`). The step then waits for that line to be read (`:11171`/`:11173`)
// before it calls self+0x38 (`:11179`), the handler dispatch.
//
// So the player reads two lines and one press of Circle before the effect: the
// Digimon's name, then the item's own name and "!".
//
// Run with this worktree's own server, on a port nothing else is using:
//   python3 -m http.server 8940 --directory web &
//   VERIFY_PORT=8940 tools/run-playwright.sh tools/verify_battle_item_announce.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.ANNOUNCE_ROOT || `${baseUrl(8940)}/`;
const OUT = process.env.ANNOUNCE_SHOT || ".bunny-scratch/shots/battle-item-announce";
// The disc's own words, read from the extracted banks rather than typed here.
const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
const ESITMNAM = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esitmnam.json", import.meta.url), "utf8")).strings;
mkdirSync(OUT, { recursive: true });

const ITEM_ID = 43;          // Power Charge — row 0 of the in-battle ITEM list, in table order
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
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
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  // One HP charge and an AntidoteDisk, so the ITEM action can be driven through the
  // real in-battle list rather than by calling a handler directly. The list is in the
  // original's own table order, so row 0 is item 43.
  localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 2 }, { id: 66, qty: 3 }]));
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const ne = (what, got, unwanted) => {
  if (JSON.stringify(got) === JSON.stringify(unwanted))
    fail(`${what}: got the unwanted ${JSON.stringify(got)}`);
};
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));

/** The panel's own two lines, the arm the box was opened with, and the turn it holds. */
const panel = () => page.evaluate(() => {
  const b = window.__battleB();
  const p = window.__battle.peek();
  const spec = b._msgSpec ?? null;
  return {
    lines: p.messageLine?.frame?.lines ?? null,
    promptVisible: p.messageLine?.promptVisible ?? null,
    holdsTurn: p.messageLine?.holdsTurn ?? null,
    kind: spec ? spec.kind : null,
    payload: spec ? (spec.payload ?? []).slice() : null,
    slots: spec ? (spec.slots ?? []).slice() : null,
    name: spec ? (spec.name ?? null) : null,
    message: p.message,
  };
});

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
    // The player is hurt, so the HP charge has something to restore and its own effect
    // page follows the announcement.
    window.__battleB().player.hp = 100;
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // ── Control: the battle's own intro line may be up, but no item announcement is.
  const before = await panel();
  ne("no announcement is up before the item is chosen", before.kind, 14);
  eq("and the item's name is nowhere on the panel",
    (before.lines ?? []).some((line) => line.includes(ESITMNAM[ITEM_ID])), false);
  await shot("announce-00-before");

  // ── Choose the Item row on the shipped command list, then confirm the first row.
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });
  for (let i = 0; i < 8; i++) {
    const sel = await page.evaluate(() => window.__battleCmdNative.diagnostics().selection);
    if (sel === 4) break;
    await tap("ArrowDown");
    await page.waitForTimeout(140);
  }
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 4, null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  await tap("Enter");

  // ── 1. The announcement is the box's OWN page: kind 14, and the two lines are the
  //        acting Digimon's name and the bank 0x6a name for that ItemId. No Circle has
  //        been pressed yet, and the page is holding the turn.
  await page.waitForFunction((want) => {
    const p = window.__battle.peek();
    return (p.messageLine?.frame?.lines?.[1] ?? "") === want;
  }, `${ESITMNAM[ITEM_ID]}!`, { timeout: 20_000 });
  const announced = await panel();
  eq("the announcement is the kind-14 arm", announced.kind, 14);
  eq("payload word 0 is the side test, and it is 0 (the actor)", announced.payload, [0, ITEM_ID]);
  eq("line one is the acting Digimon", announced.name, "Kotemon");
  eq("slot 1 is the bank 0x6a name for that ItemId", announced.slots, [ESITMNAM[ITEM_ID]]);
  eq("the panel shows the name, then the item's own name", announced.lines,
    ["Kotemon", `${ESITMNAM[ITEM_ID]}!`]);
  eq("line two is the disc's esmfight 0x09 template", ESMFIGHT[0x09], "{1}!");
  eq("line one is the disc's esmfight 0x16 template", ESMFIGHT[0x16], "{1}");
  eq("the page holds the turn until Circle", announced.holdsTurn, true);
  eq("the press-Circle glyph is up", announced.promptVisible, true);
  eq("the two drawn lines are the original's page, not a typed sentence",
    announced.lines.join(" / "), `Kotemon / ${ESITMNAM[ITEM_ID]}!`);
  await shot("announce-01-kind-14-page");

  // ── 2. Reading it is what lets the effect run: one Circle, and the next page is the
  //        charge's own outcome (kind 8, `esmfight[0x22]` `{1}HP healed!`), the way
  //        fightstg.s:11171-11179 gates it. The walker keeps its old sentence in
  //        `b.message` for `?legacyBattleMsg=1` and `peek()`, so the check reads the
  //        panel's two lines, which is what the player sees.
  await tap("Enter");
  await page.waitForFunction(() => {
    const lines = window.__battle.peek().messageLine?.frame?.lines ?? [];
    return /HP healed!$/.test(String(lines[1] ?? ""));
  }, null, { timeout: 30_000 });
  const effect = await panel();
  const healed = Number(effect.payload?.[1] ?? 0);
  eq("the effect page is the shared kind-8 arm", effect.kind, 8);
  eq("with the charge's amount in payload word 1", healed, 300);
  eq("the healed line is the disc's esmfight 0x22 template", ESMFIGHT[0x22], "{1}HP healed!");
  eq("and the name on line one", effect.lines, ["Kotemon", `${healed}HP healed!`]);
  eq("the announcement is gone from the second page",
    effect.lines.some((line) => line.includes(ESITMNAM[ITEM_ID])), false);
  await shot("announce-02-effect-page");

  // ── 3. The bank is read by ItemId, so a different item reads a different name and
  //        nothing is typed: the same call for two more ids, through the ported VM.
  const charge = await page.evaluate(async () => {
    const eng = await import("./vendor/engine.js");
    const adapter = await import("./battlemsg-translated.js");
    const bank = (await (await fetch("./assets/data/battlecmd/esitmnam.json")).json()).strings;
    const read = (itemId) => {
      const spec = eng.itemAnnouncementPage("Kotemon", itemId, bank[itemId]);
      return { id: itemId, spec, live: adapter.battleMsgItemName(itemId),
        calls: adapter.battleMsgShowCalls(spec.kind, spec.payload).calls };
    };
    return { bank: [43, 66, 84, 90].map(read), names: [43, 66, 84, 90].map((i) => bank[i]) };
  });
  eq("the bank answers for every battle item id", charge.names,
    ["Power Charge", "Antidote Disk", "Unknown Field", "TNT Ball"]);
  eq("and the loaded adapter agrees with the file",
    charge.bank.map((r) => r.live), charge.names);
  eq("each of them is a kind-14 page with its own ItemId in payload word 1",
    charge.bank.map((r) => [r.spec.kind, r.spec.payload]), [[14, [0, 43]], [14, [0, 66]],
      [14, [0, 84]], [14, [0, 90]]]);
  // The ported VM, run against the recording host: line 1's index, line 2's index, then
  // the bank string into slot 1, then the arm's own two `+0x144` tail calls. The oracle
  // tests/lane-b/battle-message-line.test.js pins that whole sequence against the
  // original VM, so what is checked here is which bank and which index it names.
  const first = charge.bank[1];
  const methods = first.calls.filter((c) => c[0] === "method");
  eq("the VM writes line 1, line 2, the bank slot, then the arm's two tail calls",
    methods.map((c) => c[2]), [0x114, 0x114, 0x120, 0x144, 0x144]);
  eq("line 1 takes esmfight 0x16 and line 2 esmfight 0x09, out of bank 0x7f",
    methods.slice(0, 2).map((c) => c.slice(3, 5)), [[0x7f, 0x16], [0x7f, 0x09]]);
  eq("the item name goes into slot 1 out of bank 0x6a, by ItemId",
    methods[2].slice(3), [0x6a, 66, 1]);
  eq("the banks it reads are 0x7f for the lines and 0x6a for the item name",
    first.calls.filter((c) => c[0] === "bank").map((c) => c[1]), [0x7f, 0x6a]);

  if (errors.length) await fail(`${errors.length} page error(s): ${errors.join(" | ")}`);
  console.log("RESULT", JSON.stringify({
    ok: !failed,
    announced: { kind: announced.kind, payload: announced.payload, lines: announced.lines,
      slots: announced.slots },
    effect: { kind: effect.kind, lines: effect.lines },
    banks: charge.names,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
if (failed) process.exit(1);
