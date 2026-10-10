// Section 7 opening coverage, case 2a: the Account Clerk's starter-pack wizard
// and the production handoff it writes.
//
// The game is seeded at s785 (Kusanagi Online Center), whose entry fires the
// real registration cutscene 014a0001; that cutscene ends in HANDOFF 1280, the
// registration screen, which the walker now opens as the TRANSLATED wizard
// (web/packselect-translated.js -> engine/dw3/ui/wizard-root-session.ts). Its
// three steps are the account-name keyboard, the "Choose a Starter Pack" list
// and the "Register account?" panel, all read here through the wizard's own
// object fields (the same ones tools/verify_translated_packselect.mjs reads):
//   the keyboard  +0x10 sub-state (2 = typing)
//   the pack list +0xc panel state (1 = live), +0x6c the chosen pack (0=A/1=B/2=C)
//   the confirm   +0xc panel state (1 = live), +0x10 sub-state (0 = asking),
//                 +0x5c the pack it will register, +0x60 YES(0)/NO(1)
// The check fast-forwards only the authored cutscene BEFORE the wizard (so the
// earlier dialogue is not replayed in real time), then drives the real screen
// with ordinary keys:
//   Start, Enter -> accept the account name the field opens with
//   Enter  -> "Register account?" panel
//   Down, Enter -> NO, back to the list
//   Down, Enter, Enter -> pack B + YES
// The production afterSay/hand-off hook in web/game.js then writes the outgoing
// handoff: state.pendingParty / state.packId / engine $party.pack /
// localStorage. Ownership (state.party) must NOT happen here: the s212 download
// is the boundary, checked separately.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_opening_pack.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.PACK_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.PACK_SHOT || "/tmp/opening-pack";
mkdirSync(OUT, { recursive: true });

const PACK_B = ["p005koet", "p006agum", "p009rena"]; // PACKS[1] members, lead first
// The wizard's three panels, by the task class the wizard creates them with.
const WIZ_KEYBOARD = 0x80085a70;
const WIZ_PACK_LIST = 0x80087a30;
const WIZ_CONFIRM = 0x80086eb8;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  // A fresh registration: no save, no wizard output yet.
  for (const k of [
    "playerName", "charId", "party", "pendingParty", "packId", "partnerStats",
    "partyStats", "equipment", "flags", "engineFlags", "progressOrdinal",
    "bits", "inventory", "rosterOwned", "reserveStats", "reserveEquipment",
    "engineEvents",
  ]) localStorage.removeItem(k);
});

const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};

// One field of one live wizard panel, straight out of the translated session.
const panel = (cls, off) => page.evaluate(([c, o]) => {
  const s = window.__packSelectNative?._session;
  const t = s && [...s.tree.tasks.values()].find((x) => x.classId === c);
  return t ? s.mem.read32(t.address + o) | 0 : null;
}, [cls, off]);
const press = async (key, ms = 120) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(140);
};
const waitPanel = async (cls, off, want, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await panel(cls, off)) === want) return true;
    await page.waitForTimeout(120);
  }
  return false;
};

let failed = null;
const fail = async (msg) => {
  failed = msg;
  console.error("FAIL:", msg);
  try {
    writeFileSync(`${OUT}/failure-state.json`, JSON.stringify(await page.evaluate(() => {
      const s = window.__packSelectNative?._session;
      const field = (cls, off) => {
        const t = s && [...s.tree.tasks.values()].find((x) => x.classId === cls);
        return t ? s.mem.read32(t.address + off) | 0 : null;
      };
      return {
        open: window.__state?.packSelect?.isOpen?.() ?? null,
        diagnostics: window.__packSelectNative?.diagnostics?.() ?? null,
        keyboard: field(0x80085a70, 0x10), packList: field(0x80087a30, 0xc),
        pack: field(0x80087a30, 0x6c), confirm: field(0x80086eb8, 0xc),
        yesNo: field(0x80086eb8, 0x60), confirmPack: field(0x80086eb8, 0x5c),
        cut: window.__cutscene?.isActive?.() ?? null,
        tb: window.__textbox?.isOpen?.() ?? null,
      };
    }), null, 2));
    await shot("failure");
  } catch { /* page may be gone */ }
};

try {
  await page.goto(ROOT + "?skipTitle=1&map=s785&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });

  // The s785 entry auto-fires event 014a0001, which ends in HANDOFF 1280 (the
  // registration screen). Blitz the authored cutscene up to that hand-off;
  // Enter confirms each SAY window on the way.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 30_000;
  let opened = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      pack: !!window.__state.packSelect,
      tb: window.__textbox?.isOpen?.() ?? false,
      cut: window.__cutscene?.isActive?.() ?? false,
    }));
    if (st.pack) { opened = true; break; }
    if (!st.cut && !st.tb) break; // the event ended without reaching the wizard
    if (st.tb) await press("Enter", 60);
    else await page.waitForTimeout(60);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  if (!opened) await fail("event 014a0001 finished without opening the registration wizard");

  // The wizard's own opening step is the clerk's introduction; confirm each page
  // until the account-name keyboard is live (its sub-state 2 is "typing").
  for (let i = 0; i < 300; i++) {
    if ((await panel(WIZ_KEYBOARD, 0x10)) === 2) break;
    await press("Enter", 110);
  }
  if ((await panel(WIZ_KEYBOARD, 0x10)) !== 2)
    await fail(`the account-name keyboard never opened: state ${await panel(WIZ_KEYBOARD, 0x10)}`);
  await page.waitForTimeout(500);
  // Start jumps the keyboard cursor to the decoded OK cell (row 6, col 13), and
  // Enter there accepts the name the field opens with.
  await press("i", 110);
  await press("Enter", 140);
  const openedOk = await waitPanel(WIZ_PACK_LIST, 0xc, 1, 30_000);
  if (!openedOk) await fail("the starter-pack list never opened after the account name");

  const initial = await page.evaluate((cls) => {
    const d = window.__packSelectNative.diagnostics();
    const s = window.__packSelectNative._session;
    const t = [...s.tree.tasks.values()].find((x) => x.classId === cls);
    return { open: d.open, error: d.error, tasks: d.tasks, pack: s.mem.read32(t.address + 0x6c) | 0 };
  }, WIZ_PACK_LIST);
  if (initial.open !== true) await fail(`the wizard is not open: ${JSON.stringify(initial)}`);
  if (initial.error) await fail(`the wizard reported ${initial.error}`);
  const packA = await panel(WIZ_PACK_LIST, 0x6c);
  if (packA !== 0) await fail(`the pack list opened on pack ${packA}, expected A (0)`);
  await shot("pack-list-A");

  // Enter on a pack opens the Register-account? panel.
  await press("Enter", 140);
  const confirm = {
    live: await panel(WIZ_CONFIRM, 0xc),
    sub: await panel(WIZ_CONFIRM, 0x10),
    pack: await panel(WIZ_CONFIRM, 0x5c),
    yesNo: await panel(WIZ_CONFIRM, 0x60),
  };
  if (confirm.live !== 1 || confirm.sub !== 0 || confirm.pack !== 0)
    await fail(`confirm panel wrong: ${JSON.stringify(confirm)}`);
  await shot("pack-register-panel");

  // Down -> NO, Enter -> back to the list with the cursor still on A.
  await press("ArrowDown", 110);
  const noSel = await panel(WIZ_CONFIRM, 0x60);
  if (noSel !== 1) await fail(`Down left the confirm panel on ${noSel}, expected 1 (NO)`);
  await shot("pack-register-no");
  await press("Enter", 140);
  const refused = { live: await panel(WIZ_PACK_LIST, 0xc), pack: await panel(WIZ_PACK_LIST, 0x6c) };
  if (refused.live !== 1 || refused.pack !== 0)
    await fail(`NO did not return to the list on pack A: ${JSON.stringify(refused)}`);

  // Choose pack B, then YES.
  await press("ArrowDown", 110);
  const selB = { pack: await panel(WIZ_PACK_LIST, 0x6c) };
  if (selB.pack !== 1) await fail(`pack B selection wrong: ${JSON.stringify(selB)}`);
  await shot("pack-list-B");
  await press("Enter", 140);   // open the register panel on B
  const onB = { pack: await panel(WIZ_CONFIRM, 0x5c), yesNo: await panel(WIZ_CONFIRM, 0x60) };
  if (onB.pack !== 1 || onB.yesNo !== 0)
    await fail(`the register panel is not asking about pack B: ${JSON.stringify(onB)}`);
  await press("Enter", 140);   // YES
  await page.waitForFunction(() => !window.__state.packSelect, null, { timeout: 30_000 });
  await page.waitForTimeout(100);
  await shot("pack-after-register");

  const handoff = await page.evaluate(() => ({
    packId: window.__state.packId,
    pendingParty: window.__state.pendingParty,
    packVar: window.__engine.state.vars.get("$party.pack"),
    accountName: window.__packSelectNative.accountName(),
    partners: window.__packSelectNative.partners(),
    sel: window.__packSelectNative.sel(),
    lsPack: localStorage.getItem("packId"),
    lsPending: localStorage.getItem("pendingParty"),
    party: window.__state.party ?? null,
    rosterOwned: window.__state.rosterOwned,
  }));

  if (handoff.packId !== "B") await fail(`packId ${handoff.packId}, expected B`);
  if (JSON.stringify(handoff.pendingParty) !== JSON.stringify(PACK_B))
    await fail(`pendingParty ${JSON.stringify(handoff.pendingParty)}, expected ${JSON.stringify(PACK_B)}`);
  if (handoff.packVar !== 1) await fail(`engine $party.pack ${handoff.packVar}, expected 1`);
  if (handoff.sel !== 1) await fail(`the wizard reported pack ${handoff.sel}, expected 1 (B)`);
  if (handoff.lsPack !== "B") await fail(`stored packId ${handoff.lsPack}, expected B`);
  if (handoff.lsPending !== JSON.stringify(PACK_B))
    await fail(`stored pendingParty ${handoff.lsPending}, expected ${JSON.stringify(PACK_B)}`);
  if (handoff.party) await fail(`party became ${JSON.stringify(handoff.party)} at registration; ownership belongs to the s212 download`);
  if (handoff.rosterOwned !== 0) await fail(`rosterOwned ${handoff.rosterOwned}, expected 0 before the download`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, opened, initial, refused, selB, handoff }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);