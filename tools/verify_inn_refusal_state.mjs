// tools/verify_inn_refusal_state.mjs — the inn's refusal panel, live.
//
// Original: the inn's third fold (obj+0x94) is the refusal panel. F0x800110e0
// state 30 waits for the fold, replaces the OFFER WIDGET's own price line with
// the eshtlnam 0x14 message, state 31 waits for Confirm, state 32 closes the
// fold. So when the player cannot pay, the stay is refused, nothing is charged,
// nobody is healed, and the message stands where the price was rather than
// beside it. Claim UI-INN-THIRD-FOLD-2026-08-14; frontier INN-Q002 (resolved
// 2026-09-14). The line is engine/dw3/inn.ts:206, "You don't have enough BIT!".
//
// The old verify_inn_refusal.mjs is a slow two-screenshot capture with no
// assertions; this is the fast, asserting check.
//
// UPDATES 2026-10-02. The screen now runs TRANSLATED code
// (engine/dw3/ui/inn-session.ts behind web/inn-translated.js), which is why
// nothing here reads `_price` / `_refusal` / `_message` / `_sel` any more: those
// were the hand-made web/inn.js fields. The same facts are read the way
// tools/verify_inn.mjs reads them — the matched inn record and the painted text
// through `diagnostics()`, the selected row through `selection()` — and the
// screen's own step through `diagnostics().state.step`. Each press is followed by
// a wait for that step, because the panels are folded windows: the old fixed
// 150 ms landed the next press while the fold was still opening, so the press was
// dropped and the check measured nothing. Step 3 is the two-row prompt and step 31
// is the refusal panel waiting for Confirm; both are read in
// engine/dw3/ui/native/inn-screen.ts's step table.
//
// Needs the lab served:  python3 -m http.server <port> --directory web
// Run: tools/run-playwright.sh tools/verify_inn_refusal_state.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = resolve(process.env.INN_REFUSAL_SHOT ?? process.argv[2] ?? ".bunny-scratch/inn-refusal-state");
mkdirSync(OUT, { recursive: true });

/** eshtlnam 0x14, the line the refusal panel puts where the price was. */
const REFUSAL_LINE = "You don't have enough BIT!";
/** eshtlnam 0x11 with its {1} filled: the quote at the Asuka Inn (s235). */
const OFFER_LINE = "Each Digimon\n8 BIT";

const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
p.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

const inGame = (src) => p.evaluate((code) => {
  const w = document.getElementById("game").contentWindow;
  // eslint-disable-next-line no-new-func
  return new Function("w", code)(w);
}, src);
const snap = () => inGame(`
  const inn = w.__inn, s = w.__state, d = inn.diagnostics();
  const painted = d.painted ?? [];
  const offer = painted.find((t) => t.startsWith("Each Digimon")) ?? null;
  return {
    open: inn.isOpen(),
    execution: d.execution,
    // The refusal is the decoded LINE standing in the offer widget, and step 31 is
    // that panel waiting for Confirm. A different wording would read null here.
    refusal: painted.includes(${JSON.stringify(REFUSAL_LINE)}),
    message: painted.includes(${JSON.stringify(REFUSAL_LINE)}) ? ${JSON.stringify(REFUSAL_LINE)} : null,
    // The price line the refusal REPLACES: gone while the panel is up.
    offer,
    rows: painted.filter((t) => t === "Stay in Inn" || t === "Do not stay in Inn"),
    price: d.inn?.price ?? null,
    name: d.inn?.name ?? null,
    sel: inn.selection(),
    step: d.state?.step ?? null,
    party: d.state?.party ?? null,
    rests: d.rests,
    painted,
    bits: s.bits,
    // The three deployed members, in the order the inn prices them: slot 0 is the
    // live partnerStats block, the rest are partyStats[i] (web/inn.js partyOf).
    vitals: [s.partnerStats, ...(s.partyStats ?? []).slice(1)]
      .map((x) => (x ? [x.hp, x.mp, x.maxHp, x.maxMp] : null)),
  };
`);
const key = async (k) => {
  await inGame(`w.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)} }));`);
  await inGame(`w.dispatchEvent(new KeyboardEvent("keyup", { key: ${JSON.stringify(k)} }));`);
  await p.waitForTimeout(200);
};
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await inGame(`return w.document.querySelector("canvas#game").toDataURL("image/png");`)).split(",")[1], "base64"));

// The translated screen's own step: 3 = the two-row prompt, 31 = the refusal panel
// waiting for Confirm. Waiting for it means a press is only judged once the window
// it belongs to has finished folding open.
const waitStep = (want) => p.waitForFunction((n) => {
  const i = document.getElementById("game").contentWindow.__inn;
  return !!i?.isOpen?.() && (i.diagnostics?.().state?.step ?? null) === n;
}, want, { timeout: 30000 });
const waitClosed = () => p.waitForFunction(
  () => !document.getElementById("game").contentWindow.__inn?.isOpen?.(), null, { timeout: 60000 });
/** Whatever the screen is showing, for a failure message. */
const now = () => inGame(`
  const d = w.__inn.diagnostics();
  return JSON.stringify({ open: d.open, failed: d.failed, error: d.error, step: d.state?.step ?? null, painted: d.painted });
`);

let failures = 0;
const lines = [];
const check = (ok, name, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  lines.push(line);
  if (!ok) failures += 1;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const result = { errors };
try {
  // Three damaged members and an empty wallet: s235 quotes 3 x 8, unpayable.
  await inGame(`
    const s = w.__state;
    s.bits = 0;
    s.party = ["p003pken", "p009rena", "p010pata"];
    const dmg = (id) => ({ digimonId: id, level: 10, hp: 37, maxHp: 200, mp: 10, maxMp: 80,
      stats: { str: 50, def: 40, spt: 40, wis: 40, spd: 40, chr: 30 }, bonuses: {}, elemBonuses: {} });
    s.partnerStats = dmg(1);
    s.partyStats = [dmg(1), dmg(7), dmg(8)];
    s.equipment = [{}, {}, {}];
  `);
  // Close first and wait for the close to land before opening again: open() is
  // asynchronous, so a screen opened straight after a close can already be up when
  // the next predicate is evaluated, and waiting for "closed" would then hang.
  const openAt = async (bits) => {
    await inGame(`w.__inn.close();`);
    await waitClosed();
    await inGame(`w.__state.bits = ${bits}; w.__labOpen("inn");`);
    await waitStep(3);
  };

  await openAt(0);
  result.before = await snap();
  await shot("inn-offer");
  check(result.before.open, "the inn opens");
  check(result.before.execution === "translated", "the rest screen is the translated one",
    `execution=${result.before.execution}`);
  // `price` is the per-Digimon price (s235 = 8); the stay costs price x party, and
  // the line the player reads says so.
  check(result.before.price === 8, "s235 quotes 8 BIT per Digimon", `price=${result.before.price}`);
  check(result.before.name === "Asuka Inn", "s235 is the Asuka Inn", `name=${JSON.stringify(result.before.name)}`);
  check(result.before.offer === OFFER_LINE, "the offer line is the decoded quote",
    `offer=${JSON.stringify(result.before.offer)}`);
  check(result.before.party === 3, "the screen counted three Digimon", `party=${result.before.party}`);
  check(result.before.sel === 0, 'the prompt starts on "Stay in Inn"', `selection=${result.before.sel}`);
  check(result.before.rows.length === 2, "both choices are on screen", `rows=${JSON.stringify(result.before.rows)}`);

  await key("Enter");                      // Circle confirms the stay
  await waitStep(31);
  result.refused = await snap();
  await shot("inn-refusal");
  check(result.refused.refusal, "an unaffordable stay is refused",
    `painted=${JSON.stringify(result.refused.painted)}`);
  check(result.refused.message === REFUSAL_LINE, "the refusal is the decoded line",
    `message=${JSON.stringify(result.refused.message)}`);
  check(result.refused.offer === null, "the refusal replaced the price line rather than joining it",
    `offer=${JSON.stringify(result.refused.offer)}`);
  check(result.refused.rows.length === 0, "the two choices are hidden behind the refusal panel",
    `rows=${JSON.stringify(result.refused.rows)}`);
  check(result.refused.step === 31, "the refusal panel is waiting for Confirm", `step=${result.refused.step}`);
  check(result.refused.rests === 0, "a refused stay rests nobody", `rests=${result.refused.rests}`);
  check(result.refused.bits === 0, "a refused stay charges nothing", `bits=${result.refused.bits}`);
  check(eq(result.refused.vitals, result.before.vitals), "a refused stay leaves HP/MP alone",
    `${JSON.stringify(result.before.vitals)} -> ${JSON.stringify(result.refused.vitals)}`);

  await key("Enter");                      // Confirm dismisses the refusal
  await waitStep(3);
  result.dismissed = await snap();
  check(!result.dismissed.refusal, "Confirm dismisses the refusal",
    `painted=${JSON.stringify(result.dismissed.painted)}`);
  check(result.dismissed.open, "dismissing the refusal leaves the inn open");
  check(result.dismissed.offer === OFFER_LINE, "the prompt comes back with its price",
    `offer=${JSON.stringify(result.dismissed.offer)}`);
  check(result.dismissed.bits === 0, "dismissing charges nothing", `bits=${result.dismissed.bits}`);
  check(eq(result.dismissed.vitals, result.before.vitals), "dismissing leaves HP/MP alone",
    JSON.stringify(result.dismissed.vitals));

  // Cancel: the second row ("Do not stay") closes with no charge.
  await key("ArrowDown");
  result.moved = await snap();
  check(result.moved.sel === 1, 'Down moves to "Do not stay in Inn"', `selection=${result.moved.sel}`);
  await key("Enter");
  await waitClosed();
  result.cancelled = await snap();
  check(!result.cancelled.open, 'the "Do not stay in Inn" row closes the inn');
  check(result.cancelled.bits === 0, "cancelling charges nothing", `bits=${result.cancelled.bits}`);
  check(eq(result.cancelled.vitals, result.before.vitals), "cancelling leaves HP/MP alone",
    JSON.stringify(result.cancelled.vitals));

  // The money boundary: 23 BIT is still refused, exactly 24 pays.
  await openAt(23);
  await key("Enter");
  await waitStep(31);
  result.short = await snap();
  check(result.short.refusal, "23 BIT does not cover a 24 BIT stay",
    `painted=${JSON.stringify(result.short.painted)}`);
  check(result.short.message === REFUSAL_LINE, "the 23 BIT refusal is the decoded line",
    `message=${JSON.stringify(result.short.message)}`);
  check(result.short.bits === 23, "the 23 BIT refusal charges nothing", `bits=${result.short.bits}`);
  check(eq(result.short.vitals, result.before.vitals), "the 23 BIT refusal leaves HP/MP alone",
    JSON.stringify(result.short.vitals));

  await openAt(24);
  await key("Enter");
  await waitClosed();
  await p.waitForTimeout(300);
  result.exact = await snap();
  await shot("inn-exact-pay");
  check(!result.exact.refusal, "exactly 24 BIT is not refused", `painted=${JSON.stringify(result.exact.painted)}`);
  check(result.exact.rests === 1, "exactly 24 BIT rests once", `rests=${result.exact.rests}`);
  check(result.exact.bits === 0, "the exact stay leaves 0 BIT", `bits=${result.exact.bits}`);
  check(result.exact.vitals.length === 3 && result.exact.vitals.every((v) => v && v[0] === v[2] && v[1] === v[3]),
    "the exact stay heals all three to full", `vitals=${JSON.stringify(result.exact.vitals)}`);

  check(errors.length === 0, "no page error on the whole route", errors.join("; "));
} catch (e) {
  check(false, `the run threw: ${e.message}`, await now().catch(() => "(no screen state)"));
  lines.push(JSON.stringify(result, null, 2));
} finally {
  await b.close();
}
writeFileSync(`${OUT}/verify-output.txt`, lines.join("\n") + "\n");
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
