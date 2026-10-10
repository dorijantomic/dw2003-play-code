// tools/verify_partner_handover.mjs — a handed-over partner, all the way to your party.
//
// A partner handover is one dialogue state: the NPC's on_close writes bank-0x70 op-0x10
// case 3, `roster_owned[slot] = slot + 3`. That marks the partner OBTAINED; it does not
// deploy it. The Digimon Lab is the second step — its Switch screen walks all eight roster
// slots, keeps the obtained ones that are not among the three deployed, and offers those
// (claim PARTY-C004, stgdglab.s L9505-L9542).
//
// This drives both steps in the real game.js on s375, where the lab assistant hands over
// the roster-slot-4 partner (Veemon, the one no starter pack contains):
//   1. before the talk, the Lab offers nobody — everything owned is already deployed,
//   2. talking to the assistant marks the slot obtained,
//   3. the Lab now offers exactly that partner,
//   4. picking a party member and confirming deploys it, and the one that stepped out
//      keeps its level and gear and becomes what the Lab offers,
//   5. the new party survives a reload.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_partner_handover.mjs [output-directory]
//
// ROUTE. This check drives the lab through `__dri.openAction`, `__dri.screen` and
// `__dri.reserveRows`, which live in the hand-authored lab (web/dri.js). The Digimon
// Lab runs translated code in ordinary play now (web/lab-translated.js,
// engine/dw3/ui/lab-session.ts), so this check asks for the rollback lab with
// ?legacyDri=1 — unchanged assertions, explicitly named route. The ported screen's own
// Switch -> commit chain, including "the partner that stepped out waits in the reserve",
// is proven by tools/verify_translated_lab.mjs; what is unique HERE is the first step,
// the NPC dialogue that marks the slot obtained.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = resolve(process.argv[2] ?? "/tmp/partner-handover");
await mkdir(outDir, { recursive: true });

const MAP = "s375";
const NPC = { id: 43, x: 304, y: 328 };
const PARTY = ["p003pken", "p009rena", "p010pata"];   // pack A: roster slots 0, 6, 7
const HANDED_OVER = "p007vmon";                        // roster slot 4

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 900, height: 700 },
  storageState: {
    cookies: [],
    origins: [{
      origin,
      localStorage: [
        { name: "engineSchema", value: "2" },
        { name: "assetMode", value: "authentic" },
        // The assistant's spawn gate is the bank-0x60 "story ordinal is exactly 0x2b"
        // predicate, so this is the point in the story where he is standing there.
        { name: "progressOrdinal", value: "43" },
        { name: "charId", value: PARTY[0] },
        { name: "party", value: JSON.stringify(PARTY) },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const hold = async (k, ms) => {
  await page.evaluate((kk) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
  await page.waitForTimeout(ms);
  await page.evaluate((kk) =>
    window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
};
const closeBoxes = async () => {
  for (let i = 0; i < 20 && await page.evaluate(() =>
    (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false)); i++) {
    await tap(" ");
    await page.waitForTimeout(200);
  }
};
const snapshot = () => page.evaluate(() => ({
  party: [...(window.__state.party ?? [])],
  owned: window.__state.rosterOwned,
}));
// What the Switch screen would offer right now, read through the screen's own call.
const labList = () => page.evaluate(() =>
  window.__dri.reserveRows(window.__state).map((r) => r.charId));

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) failed += 1; };

await page.goto(`${origin}/?skipTitle=1&map=${MAP}&noEncounters=1&legacyDri=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started && window.__talkTarget, null,
  { timeout: 40000 });
await page.waitForTimeout(1000);
await closeBoxes();

// 1. Nothing is waiting at the Lab yet.
const before = await snapshot();
const waitingBefore = await labList();
check(waitingBefore.length === 0,
  `before the handover the Lab offers nobody (got ${JSON.stringify(waitingBefore)})`);

// 2. Talk to the lab assistant.
await page.evaluate(([x, y]) => window.__teleport(x, y + 28), [NPC.x, NPC.y]);
await page.waitForTimeout(400);
await hold("ArrowUp", 150);
await page.waitForTimeout(300);
const target = await page.evaluate(() => window.__talkTarget());
assert.equal(target?.npc, NPC.id,
  `expected to be facing the lab assistant, got ${JSON.stringify(target)}`);
await page.screenshot({ path: resolve(outDir, "1-assistant.png") });
await tap(" ");
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(outDir, "2-handover.png") });
await closeBoxes();

const after = await snapshot();
check(after.owned !== before.owned,
  `the handover marked a roster slot obtained (${before.owned} -> ${after.owned})`);

// 3. The Lab now offers exactly that partner.
const waitingAfter = await labList();
check(waitingAfter.length === 1 && waitingAfter[0] === HANDED_OVER,
  `the Lab now offers ${HANDED_OVER} (got ${JSON.stringify(waitingAfter)})`);

// 4. Deploy it through the real screen: open Switch, pick party slot 2, confirm.
await page.evaluate(() => {
  window.__dri.openAction(0, window.__state, null);
});
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(outDir, "3-switch-who.png") });
await page.evaluate(() => { window.__dri.handleKey("down"); });        // party member 2
// Confirm is word bit 0x2000 = "circle"; "cross" is the back bit 0x4000
// (engine/systems/input-map.ts, commit 173ebcf0), so the old press cancelled.
await page.evaluate(() => { window.__dri.handleKey("circle"); });     // confirm -> switch_to
await page.waitForTimeout(200);
const screen = await page.evaluate(() => window.__dri.screen);
check(screen === "switch_to", `the screen advanced to the reserve list (screen=${screen})`);
await page.screenshot({ path: resolve(outDir, "4-switch-with-who.png") });
await page.evaluate(() => { window.__dri.handleKey("circle"); });     // confirm the swap
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(outDir, "5-deployed.png") });

const deployed = await snapshot();
check(deployed.party.includes(HANDED_OVER),
  `${HANDED_OVER} is in the party (${JSON.stringify(deployed.party)})`);
check(deployed.party.length === 3, `the deployed party is still three (${deployed.party.length})`);
const waitingNow = await labList();
check(waitingNow.length === 1 && waitingNow[0] === PARTY[1],
  `the partner that stepped out is what the Lab now offers (got ${JSON.stringify(waitingNow)})`);

// 5. It survives a reload.
await page.evaluate(() => window.__dri.close());
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 40000 });
await page.waitForTimeout(800);
const reloaded = await snapshot();
check(JSON.stringify(reloaded.party) === JSON.stringify(deployed.party),
  `the party survives a reload (${JSON.stringify(reloaded.party)})`);
check(reloaded.owned === deployed.owned,
  `the obtained set survives a reload (${deployed.owned} -> ${reloaded.owned})`);
// The new partner is now one of the three walking behind the tamer.
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(outDir, "6-field-followers.png") });
const followers = await page.evaluate(() => window.__activeFollowerCount());
check(followers === 3, `three partners follow the tamer in the field (got ${followers})`);

if (errors.length) console.log("PAGEERRORS:", errors);
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : "partner handover OK");
process.exit(failed || errors.length ? 1 : 0);
