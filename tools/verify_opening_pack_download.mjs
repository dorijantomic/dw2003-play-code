// Section 7 opening coverage, case 2b: the s212 download — the consumer that
// turns the Account Clerk's chosen pack into the live party.
//
// Seeds the producer's real output (localStorage packId "B" + pendingParty) and
// the arrival beat the opening route has produced by the time it walks into the
// Tamer Service: the master story ordinal 2, which is the stage's own ladder
// step (data ordinal table: s225 -> 2) and the bank-0x60 flag 0x6002 every s212
// entry rule for the three pack-specific downloads asks for
// (web/assets/engine-content.json, s212.auto.10/11/12). Entering s212 AT that
// ordinal is what fires event 01120004, the pack-B download; raising the ordinal
// after the stage is already loaded does nothing, because the once-only entry
// rules have already been decided. The production onDone in web/game.js is what
// must then make the party exist.
//
// Negative branch in the same check: the same download with NO pending pack
// must complete without creating a party (ownership stays unset).
//
// The hand-off under test is the disc's own, read off the s212 scripts: all three
// pack downloads (flags 01120003/4/5) end `HANDOFF 512 1000 236 1` then END
// (wstag212.s:888-891 for event 10, :1249-1252 for event 0x01120004, :1610-1613 for
// event 12), screen 512 is WSTAG200_PRO, stage 200 (data/screen_table.json), so the
// player ends in s200 at (1000,236) facing right, and the shared on_complete
// (wstag212.s:3133 -> F0x800a6438) writes the master story ordinal 3. s212 has no
// exit, warp or door to s200 — the scene's own HANDOFF is the only way out of the
// Tamer Service.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_opening_pack_download.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.PACK_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.PACK_SHOT || "/tmp/opening-pack-download";
mkdirSync(OUT, { recursive: true });

const PACK_B = ["p005koet", "p006agum", "p009rena"]; // PACKS[1] members, lead first
const LEAD_DIGIMON_ID = 3; // CHARID_TO_DIGID p005koet = Monmon
const ARRIVAL_ORDINAL = 2; // bank-0x60 flag 0x6002, the s212 download gate

const browser = await chromium.launch({ headless: true });

async function run({ withPending }) {
  // A fresh context per run: the download is a once-only entry event, and its
  // mark must not leak into the next run through shared localStorage.
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
  await page.addInitScript((seed) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("packId", "B");
    // The story beat the real route is standing on when it enters s212.
    localStorage.setItem("progressOrdinal", String(seed.ordinal));
    if (seed.pending) localStorage.setItem("pendingParty", JSON.stringify(seed.pending));
    else localStorage.removeItem("pendingParty");
    localStorage.removeItem("party");
    localStorage.removeItem("rosterOwned");
    localStorage.removeItem("flags");
    localStorage.removeItem("engineFlags");
  }, { pending: withPending ? PACK_B : null, ordinal: ARRIVAL_ORDINAL });

  const shot = async (name) => {
    writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
    console.log("shot", name);
  };

  // The arrival beat is the seed: entering s212 at ordinal 2 raises OnEnterMap
  // and the pack-B download (event 01120004) fires by itself.
  await page.goto(ROOT + "?skipTitle=1&map=s212&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
  const before = await page.evaluate(() => ({
    party: window.__state.party ?? null,
    pending: window.__state.pendingParty ?? null,
    pack: window.__engine.state.vars.get("$party.pack"),
    ordinal: window.__engine.state.vars.get("$story.ordinal"),
  }));
  await shot(withPending ? "download-before" : "download-before-nopending");
  await page.evaluate(() => { window.__gameSpeed = 8; });

  // The download is a long scene (about twenty pages of dialogue and its own
  // waits), so it runs at eight times normal speed and every text page is
  // confirmed. It ends on its own hand-off to s200.
  //
  // WAIT FOR THE HAND-OFF, not for the party. On the disc the scene's own last op
  // is `HANDOFF 512 1000 236 1` (wstag212.s:1249-1252 for event 0x01120004; all
  // three pack scripts end on the same three words) — screen 512 is
  // WSTAG200_PRO, stage 200 (data/screen_table.json), so the player ends in s200
  // at (1000,236) facing right. The walker creates the party and then routes that
  // HANDOFF in the SAME callback (web/game.js:4633 creates the party, :4675 hands
  // the handoff to the caller, engine-bridge.js:92 warps), so a poll that stops on
  // `state.party` stops one tick BEFORE the transition and cannot see it. It then
  // allowed 150 ms, which is under the decoded 32-frame closing wipe
  // (web/stage-wipe.js) plus the hold until the destination's own sheets are ready
  // — so this read always landed back on s212 and the check could never pass.
  // Polling on the map is the decoded wait: the scene is over when the player is
  // no longer standing in the Tamer Service.
  const deadline = Date.now() + 120_000;
  let done = false;
  let event = null;
  let handoff = null;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      party: window.__state.party ?? null,
      cut: window.__cutscene?.isActive?.() ?? false,
      tb: window.__textbox?.isOpen?.() ?? false,
      map: window.__state.manifest.maps[window.__state.mapIdx].id,
      pc: (window.__cutscene?.debugOpcodes?.() ?? []).length,
    }));
    if (event === null && st.cut) event = st.pc;
    if (st.map !== "s212") { done = true; handoff = st; break; }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => ({
    party: window.__state.party ?? null,
    pending: window.__state.pendingParty ?? null,
    charId: window.__state.charId ?? null,
    rosterOwned: window.__state.rosterOwned,
    engineRoster: Number(window.__engine.state.vars.get("$roster.owned")),
    partnerStats: window.__state.partnerStats ?? null,
    lsParty: localStorage.getItem("party"),
    lsPending: localStorage.getItem("pendingParty"),
    ordinal: window.__engine.state.vars.get("$story.ordinal"),
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
  }));
  await shot(withPending ? "download-after" : "download-after-nopending");
  await context.close();
  return { before, after, done, handoff, errors };
}

let failed = null;
const bad = (m) => { failed = m; console.error("FAIL:", m); };

try {
  // Positive: the chosen pack becomes the live party.
  const pos = await run({ withPending: true });
  console.log("POSITIVE", JSON.stringify(pos));
  if (pos.before.ordinal !== ARRIVAL_ORDINAL)
    await bad(`the stage loaded at story ordinal ${pos.before.ordinal}, expected the arrival beat ${ARRIVAL_ORDINAL}`);
  if (pos.before.pack !== 1) await bad(`engine $party.pack ${pos.before.pack}, expected 1 (pack B)`);
  if (!pos.done) await bad(`the pack-B download never left the Tamer Service (still on ${pos.after.map})`);
  if (JSON.stringify(pos.after.party) !== JSON.stringify(PACK_B))
    await bad(`party ${JSON.stringify(pos.after.party)}, expected ${JSON.stringify(PACK_B)}`);
  if (pos.after.pending !== null) await bad(`pendingParty ${JSON.stringify(pos.after.pending)} was not consumed`);
  if (pos.after.lsPending !== null) await bad(`stored pendingParty ${pos.after.lsPending} was not removed`);
  if (pos.after.lsParty !== JSON.stringify(PACK_B)) await bad(`stored party ${pos.after.lsParty}`);
  if (pos.after.charId !== "p005koet") await bad(`charId ${pos.after.charId}, expected the pack lead p005koet`);
  if (!(pos.after.rosterOwned > 0)) await bad(`rosterOwned ${pos.after.rosterOwned}, expected the pack owned`);
  if (pos.after.rosterOwned !== pos.after.engineRoster)
    await bad(`state roster ${pos.after.rosterOwned} != engine $roster.owned ${pos.after.engineRoster}`);
  if (pos.after.partnerStats?.digimonId !== LEAD_DIGIMON_ID)
    await bad(`lead partnerStats ${JSON.stringify(pos.after.partnerStats)}`);
  // The hand-off itself: the scene's own HANDOFF 512 1000 236 1, read off the disc
  // (wstag212.s:1249-1252) and resolved through the screen table (512 = stage 200).
  if (pos.handoff?.map !== "s200") await bad(`the hand-off landed on ${pos.handoff?.map}, expected s200`);
  if (pos.after.map !== "s200") await bad(`download ended on ${pos.after.map}, expected the handoff s200`);
  // The download's on_complete is the shared ordinal hook (wstag212.s:3133 →
  // F0x800a6438, `*(s32 *)0x8004B370 = 3`): one download advances the chapter
  // marker to the Main Lobby beat, and that is the step s200's own arrival runs at.
  if (pos.after.ordinal !== 3) await bad(`story ordinal ${pos.after.ordinal} after the download, expected 3`);
  if (pos.errors.length) await bad(`${pos.errors.length} page error(s) in the positive run`);

  // Negative: no pending pack -> the download cannot grant ownership.
  const neg = await run({ withPending: false });
  console.log("NEGATIVE", JSON.stringify(neg));
  if (!neg.done) await bad(`the no-pending download never left the Tamer Service (still on ${neg.after.map})`);
  // The hand-off is unconditional in the script: the scene ends on the same
  // HANDOFF with or without a pack waiting, so the player still moves to s200.
  if (neg.handoff?.map !== "s200") await bad(`the no-pending hand-off landed on ${neg.handoff?.map}, expected s200`);
  if (neg.after.party) await bad(`party appeared with no pending pack: ${JSON.stringify(neg.after.party)}`);
  if (neg.after.rosterOwned !== 0) await bad(`rosterOwned ${neg.after.rosterOwned} with no pending pack`);
  if (neg.after.lsParty) await bad(`stored party appeared with no pending pack: ${neg.after.lsParty}`);
  if (neg.errors.length) await bad(`${neg.errors.length} page error(s) in the negative run`);

  console.log("RESULT", JSON.stringify({ ok: !failed, positive: pos.after, negative: neg.after }));
} catch (e) {
  await bad(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);