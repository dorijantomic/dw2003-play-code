// A party knocked out one member at a time: what the forced TAG offers each time.
//
// pro/fightstg F0x80097498 (the TAG screen) builds its rows in state 0: it walks the
// three party records at 0x800A4470 + slot*0x20 and keeps every one whose live form id
// (record +0x00) is not zero and which is not the acting slot (fightstg.s:21206-21230).
// There is no HP test in that scan, so a knocked-out partner IS a row; F0x800972C8
// recolours only its name plate to palette 7 when record +0x08 is 0
// (fightstg.s:21155-21174). The confirm is what skips it: fightstg.s:21296-21308 reads
// record +0x08 and jumps to the routine's end when it is zero, so Circle on a fallen row
// says nothing and the cursor stays put. Cross is only read when self+0x58 is not zero
// (fightstg.s:21256-21262), so on the forced list the cursor -- Down/Up, which the shared
// list model clamps and never wraps -- is the only way off it.
//
// The list also opens on the row the caller last left, and the confirm hands the row back
// to the caller: fightstg.s:21258-21260 seeds the shared model's cursor out of the cell
// behind self+0x54 with no clamp, and fightstg.s:21312 stores the confirmed row into that
// same cell. One row word, carried across every list the battle opens.
//
// The battle controller is the one that decides between "bring somebody in" and "you
// lost": wfightmn's knock-down machine (its state-1 handler at 0x800A9110) scans the
// group's three records for species != 0 AND HP != 0 (0x800A9160-0x800A918C), writes the
// index it found into the acting slot at 0x800A446C (0x800A937C-0x800A9384), and when it
// finds nobody goes to 0x800A9214 and decides win (0x800A9268 -> F0x8009C534(1)) or loss
// (0x800A9230 -> F0x8009C534(2)).
//
// What you'll see: the s200 story fight with all three party members on their last hit.
// The enemy knocks the first one out and the TAG list opens on the two partners still
// standing; you move down to the second and take it. The enemy knocks that one out too --
// the list opens again, its FIRST row is the Digimon that went down first (grey plate),
// and it opens on the SECOND row, the one you took last time. Circle on the grey row does
// nothing at all. Circle on the living one brings it in, and the third knockout ends the
// battle: nothing is left standing, so no list opens at all.
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_tag_after_two_knockouts.mjs
// Shots:  TAGSTALL_SHOT=<dir>  (default .bunny-scratch/shots/tag-after-two-knockouts)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const PORT = process.env.VERIFY_PORT || "8881";
const ROOT = `${baseUrl(Number(PORT))}/`;
const OUT = process.env.TAGSTALL_SHOT || ".bunny-scratch/shots/tag-after-two-knockouts";
mkdirSync(OUT, { recursive: true });

const member = (digimonId) => ({
  digimonId, level: 5, xp: 0, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
  stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
});
await page.addInitScript((seed) => {
  localStorage.setItem("partnerStats", JSON.stringify(seed[0]));
  localStorage.setItem("partyStats", JSON.stringify(seed));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, [member(3), member(7), member(8)]);

/** A real key press held across exactly one drawn frame: the pad edges are read once
 *  a frame, so down and up have to land on different frames or the press is lost. */
const pressFrame = async (key) => {
  await page.keyboard.down(key);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.keyboard.up(key);
  await page.waitForTimeout(60);
};
const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};
const read = () => page.evaluate(() => {
  const b = window.__battleB?.();
  const p = window.__battle?.peek?.() ?? null;
  const d = window.__battleTagNative?.diagnostics?.() ?? null;
  return {
    state: b?.state ?? null,
    active: b?.activePlayerIndex ?? null,
    partyHp: (b?.playerRecords ?? []).map((r) => r.hp),
    message: String(b?.message ?? ""),
    lineUp: !!p?.messageLine?.active && !p?.messageLine?.finished,
    holds: !!p?.messageLine?.holdsTurn,
    cmdReady: !!p?.commandList?.active,
    forced: !!b?._forcedTag,
    tagOpen: !!d?.open,
    tagReady: !!d?.ready,
    tagRows: d?.rows ?? null,
    tagCands: d?.candidates ?? null,
    tagSel: d?.selection ?? null,
    tagChosen: d?.chosen ?? null,
  };
});

const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) problems.push(msg);
};

/** Each row's name-plate palette, top row first (fightstg.s:21155-21174). */
const rowPalettes = () => page.evaluate(() => {
  const session = window.__battleTagNative?._session;
  if (!session) return null;
  return session.widgets.textWidgets()
    .map((w) => ({ x: w.penX, y: w.penY, palette: w.colour }))
    .filter((w) => w.x === 36)
    .sort((a, b) => a.y - b.y)
    .map((w) => w.palette);
});

/**
 * Play the battle forward the way a player does until `test` holds: read every line the
 * battle puts up (the timed action and result pages, then the forced line), take FIGHT
 * when the command list is live, and confirm the partner list's row when one is open on a
 * member that is still standing.
 */
async function playUntil(test, label, { moveDownFirst = false } = {}) {
  const deadline = Date.now() + 60_000;
  let last = "";
  let idle = 0;
  while (Date.now() < deadline) {
    const s = await read();
    if (test(s)) return s;
    const key = [s.state, s.active, s.partyHp.join(","), s.message, s.tagRows, s.tagSel].join("|");
    if (key !== last) { last = key; idle = 0; } else idle++;
    if (idle >= 150) throw new Error(`stalled waiting for ${label}: ${key}`);
    if (s.tagOpen && s.tagReady && s.tagRows > 0) {
      if (moveDownFirst) { await pressFrame("ArrowDown"); continue; }
      const slot = s.tagCands[s.tagSel];
      if (s.partyHp[slot] === 0) { await pressFrame("ArrowDown"); continue; }
      await pressFrame("Enter");
    } else if (s.state === 15 || s.state === 16) {
      await pressFrame("Enter");
    } else if (s.holds || s.lineUp || s.state === 7) {
      await pressFrame("Enter");
    } else if (s.state === 2 && s.cmdReady) {
      await pressFrame("Enter");
    } else {
      await page.waitForTimeout(120);
    }
  }
  throw new Error(`timed out waiting for ${label}`);
}

await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
await page.evaluate(() => { window.__gameSpeed = 8; });
const boot = Date.now() + 15_000;
let launched = false;
while (Date.now() < boot) {
  if (await page.evaluate(() => !!window.__battle?.isActive?.())) { launched = true; break; }
  if (await page.evaluate(() => window.__textbox?.isOpen?.() ?? false)) await page.keyboard.press("Enter");
  await page.waitForTimeout(40);
}
await page.evaluate(() => { window.__gameSpeed = 1; });
expect(launched, "the s200 PRE launched the scripted battle");
await waitForCommandMenu(page);

// The whole party on its last hit and an enemy no single blow can reach: nothing after
// the first command can change the outcome, so the three knockouts happen in the order
// this check reads. This is the harness arranging the fight, not the battle deciding it.
const armed = await page.evaluate(() => {
  const b = window.__battleB();
  b.playerRecords.forEach((record) => { record.hp = 1; });
  b.player.hp = 1;
  const top = Math.min(9999, Math.max(1, b.enemy.maxHp || 1) * 100);
  b.enemy.maxHp = top;
  b.enemy.hp = top;
  b._hpEase = null;
  return { partyHp: b.playerRecords.map((r) => r.hp), enemyHp: b.enemy.hp };
});
expect(armed.partyHp.every((hp) => hp === 1),
  `all three Digimon are on one hit of health (${JSON.stringify(armed.partyHp)})`);

// First knockout: the forced list offers the two partners still standing. Take the
// SECOND one, so the row the list carries forward is row 1.
const first = await playUntil((s) => s.state === 11 && s.tagReady && s.tagRows > 0, "the first forced TAG");
console.log("first forced TAG:", JSON.stringify(first));
expect(first.tagRows === 2 && JSON.stringify(first.tagCands) === "[1,2]",
  `the first forced TAG offers the two partners still standing (${JSON.stringify(first.tagCands)})`);
expect(first.forced === true, "the list is the forced one: Cross cannot cancel it");
await shot("tag-first-forced");
await pressFrame("ArrowDown");
await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().selection === 1,
  null, { timeout: 5000 }).catch(() => {});
expect((await read()).tagSel === 1, "Down moves the cursor to the second partner");
await pressFrame("Enter");
await page.waitForFunction(() => window.__battleB?.()?.state === 15, null, { timeout: 5000 })
  .then(() => expect(true, "Circle on a living partner takes it and opens the DNA pane"))
  .catch(() => expect(false, "Circle on a living partner did not leave the list"));

// Second knockout: the list comes back with the partner that went down first as its
// FIRST row, greyed, and it opens on the row the player took last time.
const second = await playUntil((s) => s.state === 11 && s.tagReady && s.tagRows > 0, "the second forced TAG");
console.log("second forced TAG:", JSON.stringify(second));
expect(second.active === 2 && JSON.stringify(second.partyHp) === "[0,1,0]",
  `the member taken last time is the one that went down (active ${second.active}, hp ${JSON.stringify(second.partyHp)})`);
expect(second.tagRows === 2 && JSON.stringify(second.tagCands) === "[0,1]",
  `its rows are the fallen partner and the one still standing (${JSON.stringify(second.tagCands)})`);
expect(second.tagSel === 1,
  `it opens on the row the player took last time, as the original's own row word does (${second.tagSel})`);
const grey = await rowPalettes();
console.log("  name plate palettes", JSON.stringify(grey));
expect(Array.isArray(grey) && grey[0] === 7 && grey[1] === 0,
  `the fallen partner's name is grey and the survivor's is not (${JSON.stringify(grey)})`);
await shot("tag-second-forced-grey-row");

// Circle on the fallen row: the original's HP test refuses and says nothing at all.
await pressFrame("ArrowUp");
await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().selection === 0,
  null, { timeout: 5000 }).catch(() => {});
expect((await read()).tagSel === 0, "Up moves the cursor onto the fallen partner");
await pressFrame("Enter");
await page.waitForTimeout(400);
const refused = await read();
console.log("after Circle on the fallen row:", JSON.stringify(refused));
expect(refused.tagOpen && refused.state === 11 && refused.tagChosen === null && refused.tagSel === 0,
  `Circle on the fallen row keeps the list up and says nothing (open ${refused.tagOpen}, state ${refused.state}, chosen ${refused.tagChosen}, row ${refused.tagSel})`);
await shot("tag-fallen-row-refused");

// The survivor, and then the third knockout ends the battle: no list opens at all.
await pressFrame("ArrowDown");
await pressFrame("Enter");
await page.waitForFunction(() => window.__battleB?.()?.state === 15, null, { timeout: 5000 })
  .then(() => expect(true, "the living partner is taken and the pane opens"))
  .catch(() => expect(false, "the living partner did not come in"));
const lost = await playUntil((s) => s.state === 9 || s.state === 8, "the third knockout");
expect(lost.state === 9, `the third knockout ends the battle in the loss state (${lost.state})`);
expect(JSON.stringify(lost.partyHp) === "[0,0,0]",
  `no member is left standing (${JSON.stringify(lost.partyHp)})`);
expect(lost.tagRows === null, `no partner list opens once nothing is standing (${lost.tagRows})`);
await shot("tag-loss-after-three-knockouts");
expect(errors.length === 0, `no page errors (${errors.join("; ")})`);

await browser.close();
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exit(problems.length ? 1 : 0);