// A roaming card tamer only duels you once your party's Charisma reaches their rung.
//
// Flag bank 0x72 stores nothing: get_flag(0x7200+n) sums the deployed party's Charisma and
// compares it against the ladder D0x80048CF8 (60,150,210,...,2472). Every tamer's dialogue
// ladder pairs a brush-off line gated on their rung being unmet with a challenge line gated
// on it being met, and the challenge line's on_close is the duel launcher. While the walker
// returned "unmodelled" for the bank, the brush-off always won and no wandering tamer would
// fight. Ledger: charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate,
// CARDNPC-TWO-DECKS-ARE-CHALLENGE-AND-REMATCH-2026-08-14.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_tamer_charisma_duel.mjs [out-dir]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = process.argv[2] ?? "/tmp/tamer-charisma";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 900, height: 700 },
  storageState: {
    cookies: [],
    origins: [{
      origin,
      localStorage: [
        { name: "engineSchema", value: "2" },
        { name: "assetMode", value: "authentic" },
        // Mitch's duelling variant only exists while the story ordinal is in [4,23]
        // (spawn flag 0x7003 = roster predicate record 3, an ordinal range). Past 23 the
        // map places his one-line variant instead, which has no duel state at all.
        { name: "progressOrdinal", value: "20" },
        { name: "charId", value: "p003pken" },
        { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${origin}/?skipTitle=1&map=s335&noEncounters=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started && window.__storyFlags, null,
  { timeout: 40000 });
// digimon.json is fetched asynchronously; the gate stays dormant until it lands.
await page.waitForFunction(() => window.__partyCharisma() != null, null, { timeout: 20000 });

const real = await page.evaluate(() => window.__partyCharisma());
console.log("party Charisma as the walker computes it:", real);

/** Force every deployed member's stored Charisma so a rung can be crossed without
 *  grinding levels. This writes the same stat the status screen draws — the walker's
 *  model of the roster record's cur_chr — not a test-only hook in shipped code. */
const setCharisma = (perMember) => page.evaluate((v) => {
  const s = window.__state;
  const put = (rec) => { if (rec) { rec.stats = { ...(rec.stats ?? {}), chr: v }; } };
  put(s.partnerStats);
  // The non-lead members only get a stats slot once the status menu builds one, so make
  // sure all three deployed positions have one before writing. The native sums three
  // positions and clamps EACH at 999, so a single member cannot carry the high rungs.
  s.partyStats = s.partyStats ?? [];
  for (let i = 0; i < (s.party?.length ?? 0); i++) {
    s.partyStats[i] = s.partyStats[i] ?? {};
    put(s.partyStats[i]);
  }
  return window.__partyCharisma();
}, perMember);

// Tamer Mitch at s335 sits on rung 9: flag 0x7209, party Charisma >= 1218. His challenge
// state's on_close is 0x7606, which launches CARD_NPC deck 13 (his first folder).
const RUNG_FLAG = 0x7209;
const RUNG = 1218;

const gate = () => page.evaluate((f) => window.__storyFlags.get(f), RUNG_FLAG);

// The core of the fix: the bank must ANSWER now. A null here is what shadowed every
// tamer's challenge line behind their brush-off line.
// Only the members the walker actually has stat records for respond, so drive each
// member to the whole threshold rather than a third of it and read the real total back.
const below = await setCharisma(0);
const gateBelow = await gate();
console.log(`Charisma ${below} -> get_flag(0x${RUNG_FLAG.toString(16)}) = ${gateBelow}`);
assert.notEqual(gateBelow, null, "bank 0x72 must resolve, not stay unmodelled");
assert.equal(gateBelow, 0, "below the rung the gate must read 0");

const above = await setCharisma(RUNG);
const gateAbove = await gate();
console.log(`Charisma ${above} -> get_flag(0x${RUNG_FLAG.toString(16)}) = ${gateAbove}`);
assert.equal(gateAbove, 1, "at or above the rung the gate must read 1");
assert.ok(above >= RUNG && below < RUNG, `the two probes must straddle ${RUNG}`);

// And the ladder as a whole: each rung flips exactly at its own threshold.
const LADDER = [60, 150, 210, 285, 378, 492, 630, 795, 990, 1218, 1482, 1785, 2049, 2277, 2472];
for (let n = 0; n < LADDER.length; n++) {
  const t = LADDER[n];
  const loTotal = await setCharisma(0);
  const lo = await page.evaluate((f) => window.__storyFlags.get(f), 0x7200 + n);
  const hiTotal = await setCharisma(t);
  const hi = await page.evaluate((f) => window.__storyFlags.get(f), 0x7200 + n);
  assert.ok(loTotal < t, `rung ${n}: the low probe (${loTotal}) must sit below ${t}`);
  assert.ok(hiTotal >= t, `rung ${n}: the high probe (${hiTotal}) must reach ${t}`);
  assert.equal(lo, 0, `rung ${n} (>= ${t}) must read 0 below it`);
  assert.equal(hi, 1, `rung ${n} (>= ${t}) must read 1 at it`);
}
console.log(`all ${LADDER.length} rungs flip at their own threshold`);

// The tamer only appears in their DUELLING form once you carry the Folder Bag: s335's
// npc-47 variants split on collection flag 0x8192 (item 402, "Bag that can fit 3 Card
// Folders"). Without it you get the one-line variant that has no duel state at all.
await page.evaluate(() => {
  const s = window.__state;
  s.inventory = s.inventory ?? [];
  if (!s.inventory.some((it) => it.id === 402)) s.inventory.push({ id: 402, qty: 1 });
});

// Whoever the shipped save actually places here, report which dialogue state they land on
// and whether it launches a duel. Reported, not asserted: which tamer variant spawns
// depends on story flags this harness does not set.
const faceTamer = async () => {
  await page.evaluate(() => window.__teleport(593, 319));
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })));
  await page.waitForTimeout(140);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" })));
  await page.waitForTimeout(250);
};

/** Talk and dismiss, so the NPC's own state machine advances. Mitch's first state is the
 *  "we have not met" line gated on flag 0 == 0; his brush-off and challenge states both
 *  need flag 0 == 1, so the ladder does not start until you have spoken to him once. */
const tapKey = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);

const dismiss = async () => {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(160);
    const open = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
    if (!open) break;
    await tapKey(" ");
  }
  await page.waitForTimeout(300);
};

const talkAndClose = async () => {
  await faceTamer();
  await tapKey(" ");
  await dismiss();
};

const talkAt = async (perMember) => {
  await setCharisma(perMember);
  await faceTamer();
  return page.evaluate(() => {
    const t = window.__talkTarget();
    const launch = (t?.state?.on_close ?? []).find((c) => ((c.id >> 8) & 0xfe) === 0x76
      || ((c.id >> 8) & 0xfe) === 0x78);
    return {
      npc: t?.npc ?? null,
      dialogue: t?.state?.dialogue ?? null,
      duelFlag: launch ? `0x${launch.id.toString(16)}` : null,
    };
  });
};
await talkAndClose();   // past the first-meeting line, onto the real ladder

// Below the rung: the brush-off line, and no duel launcher on it.
const low = await talkAt(0);
console.log("facing the tamer, below the rung:", JSON.stringify(low));
assert.equal(low.npc, 47, "the duelling tamer variant must be the one standing here");
assert.equal(low.dialogue?.index, 112, "below the rung he keeps the brush-off line");
assert.equal(low.duelFlag, null, "and that line launches nothing");
await faceTamer();
await tapKey(" ");
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(outDir, "s335-below-rung.png") });
await dismiss();

// At the rung: the challenge line, carrying the bank-0x76 launcher for his first deck.
const high = await talkAt(RUNG);
console.log("facing the tamer, above the rung:", JSON.stringify(high));
assert.equal(high.dialogue?.index, 113, "at the rung he challenges you");
assert.equal(high.duelFlag, "0x7606", "and that line writes the duel launcher");
await faceTamer();
await tapKey(" ");
await page.waitForTimeout(600);
await page.screenshot({ path: resolve(outDir, "s335-above-rung.png") });
await dismiss();

// The launcher resolves to a real CARD_NPC deck and the duel actually opens.
await page.waitForTimeout(1200);
const duelOpen = await page.evaluate(() => window.__cardDuel?.isOpen?.() ?? false);
console.log("card duel running after the challenge:", duelOpen);
assert.equal(duelOpen, true, "the challenge must launch the duel");
await page.screenshot({ path: resolve(outDir, "s335-duel-launched.png") });

assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
console.log(`tamer charisma gate OK -> ${outDir}`);
await browser.close();
