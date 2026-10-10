// tools/verify_battle_damage_terms.mjs — one damage-term record of every category, driven
// through the real battle menus, and the box's own page read back.
//
// THE SHARED SYSTEM: FIGHTSTG_F0x8008f714 (`~/ddw3/asm/dw2003/pro/fightstg.s:13124`),
// the machine that walks the 18-byte technique records at `0x80042bca + 18 * techniqueId`
// (`fightstg.s:13105`-`:13110`), reads record byte 4 — the attack category — and dispatches
// through the five-word table at `.L0x80083004` (`fightstg.s:203`-`:207`):
//
//   2 -> 0x8008f9a8  an ordinary physical attack   (322 of the disc's 443 records)
//   3 -> 0x8008f9a8  an ordinary magical attack    (80) -- the SAME body, byte for byte
//   4 -> 0x8008fbec  the heal-and-cure family      (16)
//   5 -> 0x8009021c  the scripted family           (18)
//   6 -> 0x800907cc  the seven field techniques    (7)
//
// The walker's port is `engine/dw3/battle-damage-terms.ts` (`damageTermPage`), reached from
// `web/battle.js`'s `damageSpec`. This check drives FIVE of the disc's own records in normal
// play — one per category — by picking Fight and then Tech rows off the shipped command list,
// and compares the page the box actually put up with the page the port builds from the same
// shipped record. Nothing here calls a builder directly, so a page that only works when asked
// for by hand cannot pass.
//
// The records are the disc's own, named by what the shipped skill bank calls them
// (`web/assets/data/digimon.json` -> `skills[]`, which carries the extracted `attack_cat`):
//
//   1   Fight            category 2   "N damage!"        kind 4
//   104 Cable Crusher    category 3   "N damage!"        kind 4  (the shared body again)
//   189 Auto Recover     category 4   "HP gradually recovers."  kind 2
//   198 Double Power     category 5   "Strength [arrow-up]!"   kind 2
//   213 Fire Field       category 6   "Fire field!"      kind 1   (clip 15, no contact)
//
// The heal AMOUNT arm (techniques 184-188) is NOT driven here, and the check says so. Its
// amount comes from the getter the category-4 arm calls through at `fightstg.s:13516`
// `lw $v0, 0x4614($v0)` / `:13518 jalr $v0`, which is the single word
// `fightstg.s:35025 .L0x800a4614: .word 0x800a0108` -- NOT a table -- and the getter
// `FIGHTSTG_F0x800a0108` (`:30517`) computes `(power << 6) + ((wisdom * power + 7) >> 3)`
// from the record's own power and the acting Digimon's WISDOM. That formula is ported
// (`damageTermHealAmount`, proved by tests/battle-technique-result-paths.test.js) and
// applied, but these seven cases pick their rows off the shipped Tech list, and driving
// 184-186 in play needs a wounded partner and the original's own amount to compare. The
// unit test carries that number; technique 189's page does not read it.
//
// Math.random is pinned to 0 for the whole run. The walker's battle RNG is
// `RAND_U16 = (Math.random() * 0x10000) | 0` (`engine/dw3/battle-formulas.ts:70`) and the
// browser has no other entropy source, so this pins every accuracy roll in the fight -- the
// same stub `tools/verify_battle_ailment.mjs` uses for its poison hit. It is restored at the
// end.
//
//   python3 -m http.server 8965 --directory web &
//   VERIFY_PORT=8965 tools/run-playwright.sh tools/verify_battle_damage_terms.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import {
  COMMAND_PHASE, runBattleTurn, tapCircle, waitForCommandMenu,
} from "./verify-battle-wait.mjs";
import { battleMessageLineIndex, damageTermHandler, damageTermPage } from "../web/vendor/engine.js";

const ROOT = process.env.TERM_ROOT || `${baseUrl(8965)}/`;
const OUT = process.env.TERM_SHOT || ".bunny-scratch/shots/battle-damage-terms";
const TECH = JSON.parse(readFileSync(
  new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
mkdirSync(OUT, { recursive: true });

const SKILLS = JSON.parse(readFileSync(
  new URL("../web/assets/data/digimon.json", import.meta.url), "utf8")).skills;
const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [Number(s.id), s.name]));
const PLAYER = "Kotemon";
/** One record per category, and how the player reaches it. */
const CASES = [
  { techId: 1, command: "fight", handler: 0x8008f9a8, category: 2,
    line: "the basic attack" },
  { techId: 104, command: "tech", handler: 0x8008f9a8, category: 3,
    line: "a magical technique" },
  { techId: 189, command: "tech", handler: 0x8008fbec, category: 4,
    line: "Auto Recover" },
  { techId: 198, command: "tech", handler: 0x8009021c, category: 5,
    line: "Double Power" },
  // Capture Beam's roll, driven to MISS. The run's global pin is Math.random = 0, which
  // LANDS every roll, so this case re-pins it for its own turn: RAND_U16 is
  // `(Math.random() * 0x10000) | 0` and the arm's gate is `(rand & 0x7f) < record[+0x0B]`
  // (pro/fightstg.s:31866 `andi $v0, 0x7f` / :31869 `slt $v0, $s0` with the threshold
  // `lbu $s0, 0xb($v1)` :31865), so 0.9 answers 0xe666 & 0x7f = 102 against the record's 80
  // and the roll loses. A lost roll prints esmfight[0x2f] "No effect!" on line one through
  // kind 1, because `li $v0, 0x2f` :13889 is in the DELAY SLOT of the roll's `beqz`
  // :13888 and the branch's own target stores it :13896.
  { techId: 211, command: "tech", handler: 0x8009021c, category: 5,
    line: "Capture Beam", random: 0.9 },
  // Category 6 IS driven now. Fire Field's action script is clip 15, whose script fires no
  // contact opcode in ANY of the 53 models that ship it, so before 2026-10-04
  // `commitImpact` -- the one place the walker's technique path built its result page --
  // was never reached and NO page of any kind appeared for it. The same is true of the ten
  // techniques on clip 12 (the big-attack cinematic, whose only op10 is type 66 rather
  // than the type-99 contact), so one of those is driven too: the rule under test is that
  // a technique's result belongs to its RECORD and not to its animation.
  // `tests/battle-technique-result-paths.test.js` holds the all-443 census.
  { techId: 213, command: "tech", handler: 0x800907cc, category: 6,
    line: "Fire Field", clip: 15 },
];

// Clip 12 is the other script that fires no contact in any of the 246 shipped models, and
// ten of the disc's records animate it (374-380, 432-434). NONE of them is in the shipped
// skill bank (`web/assets/data/digimon.json` -> `skills[]` names ids from the clip-5, 6, 8,
// 9, 10, 11, 13, 15 and 16 sets only), so no player can pick one off the Tech list and this
// check cannot drive it. `tests/battle-technique-result-paths.test.js` covers that group:
// it reads the clip out of all 249 shipped `anim.json` files and asserts every one of the
// 443 rows is decided on BOTH sides of the partition.

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 400, maxMp: 400,
  stats: { str: 400, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

let failed = null;
const fail = (m) => { failed ??= m; console.error("FAIL:", m); };
/** One canvas capture, best effort: the box is proved from the session's state. */
const shot = async (name) => {
  try {
    const data = await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"));
    if (typeof data === "string" && data.includes(",")) {
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(data.split(",")[1], "base64"));
      return true;
    }
  } catch { /* the canvas is gone; the session's state is the proof */ }
  return false;
};
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
  return JSON.stringify(got) === JSON.stringify(want);
};

/**
 * Compose the two lines a page draws, through the SAME arm table the page itself uses and
 * from that page's OWN payload — so the words are checked against the shipped English bank
 * and never against a sentence written here.
 *
 * Three arms leave a line alone (`line2` with no index of its own): kind 1 keeps whatever
 * line two held, so only line one is composed for those and `null` marks it.
 */
function compose(spec, name) {
  const [a, bb, c] = spec?.slots ?? [];
  const sub = (t) => String(t)
    .replace("{1}", a ?? "").replace("{2}", bb ?? "").replace("{3}", c ?? "");
  const i0 = spec ? battleMessageLineIndex(spec.kind, 0, spec.payload) : null;
  const i1 = spec ? battleMessageLineIndex(spec.kind, 1, spec.payload) : null;
  if (i0 === null || i0 === undefined) return null;
  return [
    String(ESMFIGHT[i0] ?? "").replace("{1}", name ?? ""),
    i1 === null || i1 === undefined ? null : sub(ESMFIGHT[i1] ?? ""),
  ];
}

/**
 * Is this (spec, drawn lines) pair self-consistent? The session's spec and its two drawn
 * lines advance together, so a sampled pair can be one frame apart; only a pair whose lines
 * ARE the arm's composition of its own spec is evidence about what the player read.
 */
function drawn(spec, lines) {
  const want = compose(spec, spec?.name ?? PLAYER);
  if (!want || !Array.isArray(lines)) return false;
  if (lines[0] !== want[0]) return false;
  return want[1] === null ? true : lines[1] === want[1];
}

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
  localStorage.setItem("inventory", JSON.stringify([{ id: 1, qty: 1 }]));
  localStorage.setItem("bits", "1000");
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) });

/** The box's own state: the page spec the walker passed and the two lines it drew. */
const panel = () => page.evaluate(() => {
  const b = window.__battleB();
  const p = window.__battle.peek();
  const spec = b._msgSpec ?? null;
  return {
    lines: p.messageLine?.frame?.lines ?? null,
    kind: spec ? spec.kind : null,
    payload: spec ? (spec.payload ?? []).slice() : null,
    slots: spec ? (spec.slots ?? []).slice() : null,
    name: spec ? (spec.name ?? null) : null,
    message: p.message,
  };
});

/**
 * Read every page a turn puts up, pressing Circle exactly as a player does.
 *
 * The session's spec and its two drawn lines advance together, so a sampled pair can be one
 * frame apart. When the spec is already the page this case is looking for, the loop WAITS
 * (no press) for the drawing to catch up instead of pressing past it: a press there would
 * close the page and the evidence would be gone.
 */
async function readTurnPages(wantKind, budget = 20) {
  const seen = [];
  const atMenu = () => page.evaluate(() => {
    const p = window.__battle.peek();
    return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false;
  });
  const sample = async () => {
    const now = await panel();
    const spec = now.kind === null ? null
      : { kind: now.kind, payload: now.payload, slots: now.slots, name: now.name };
    // Keyed by the spec AND the drawn lines: the same spec is sampled twice while its
    // words are still being drawn, and only the second sample is the evidence.
    const entry = { key: JSON.stringify([spec, now.lines]), spec, lines: now.lines };
    if (!seen.some((x) => x.key === entry.key)) seen.push(entry);
    return entry;
  };
  for (let press = 0; press < budget; press++) {
    let entry = await sample();
    // The spec and the two drawn lines advance together, so a page that is already up can
    // still be showing the PREVIOUS page's words. Wait for the drawing to catch up; pressing
    // in that window would close the page the case is looking for.
    for (let wait = 0; wait < 60; wait++) {
      if (entry.spec && drawn(entry.spec, entry.lines)) break;
      await page.waitForTimeout(60);
      const fresh = await sample();
      if (fresh.spec?.kind === wantKind) { entry = fresh; continue; }
      if (wait > 3) break;                 // it moved on to another page: press it forward
      entry = fresh;
    }
    if (entry.spec?.kind === wantKind && drawn(entry.spec, entry.lines)) return seen;
    // Back at the command menu with nothing of this turn left to read.
    if (await atMenu() && !seen.some((x) => x.spec?.kind === wantKind)) return seen;
    await tapCircle(page);
    await page.waitForTimeout(180);
  }
  return seen;
}

/** Let the fight run on to the next command menu, reading and paging as a player does. */
async function settleToCommandMenu(ticks = 160) {
  await runBattleTurn(page, {
    ticks,
    until: (snap) => snap.state === COMMAND_PHASE && !snap.holds,
  });
  await page.waitForFunction(() => {
    const p = window.__battle.peek();
    return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false;
  }, null, { timeout: 25_000 });
}

/** Put the shipped command list under the row a case needs, and wait for it to be live. */
async function selectCommand(row) {
  await page.evaluate((r) => {
    window.__battleCmdNative?.close?.();
    window.__battleB().menuSel = r;
  }, row);
  await page.waitForFunction(() => {
    const p = window.__battle.peek();
    return p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false;
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(120);
}

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(300);
  // Every accuracy roll in this run takes its first branch. See the header.
  await page.evaluate(() => { window.__termOrigRandom = Math.random; Math.random = () => 0; });
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 2, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
    const b = window.__battleB();
    b.enemy.hp = 99999; b.enemy.maxHp = 99999;   // the fight must outlive the check
    b.player.hp = 120;                            // room for a heal technique to matter
  });
  const menu = await waitForCommandMenu(page);
  eq("the shipped command list is the six commands", menu.menu,
    ["Fight", "Tech", "DV", "Tag", "Item", "Run"]);
  eq("the player's Digimon is the one the record's name selector names",
    await page.evaluate(() => window.__battleB().player.profile.name), PLAYER);

  const results = [];
  for (const c of CASES) {
    const record = TECH[String(c.techId)] ?? null;
    eq(`the shipped record ${c.techId} is category ${c.category}`, record?.category, c.category);
    // A case that needs a different draw re-pins the run's global one for its own turn.
    if (c.random !== undefined) {
      await page.evaluate((r) => { window.__termOrigRandom = Math.random; Math.random = () => r; },
        c.random);
    }
    if (c.clip !== undefined) {
      eq(`the shipped record ${c.techId} animates clip ${c.clip}`, record?.clip, c.clip);
    }
    eq(`category ${c.category} dispatches to the handler the asm names`,
      damageTermHandler(record?.category ?? 0), c.handler);

    // The page the port builds for this record, from the same shipped data the browser
    // loaded. The numbers inside it are fight-dependent, so they are compared by shape.
    const expected = damageTermPage(record, {
      techniqueId: c.techId, side: 0, name: PLAYER,
      damage: 0, hitCount: 1,
      landed: c.category !== 4, applied: false, retaliated: false, suppressed: false,
    }, {});
    if (!expected) { fail(`the port builds no page for record ${c.techId}`); continue; }

    // Give the acting Digimon this one technique, the way a form ledger carries it
    // (`battleTechWords`, web/battle.js:150), then pick it off the shipped Tech list.
    await page.evaluate((techId) => {
      const b = window.__battleB();
      b.player.statsRecord.formLedger = [{
        id: b.player.profile.id, formLevel: 1, dvexp: 0, techSlots: [techId],
      }];
      // The fight must outlive the check and every technique must be affordable: the
      // MP gate is the original's own page (`esmfight[0x8d]` "No MP!" through kind 2,
      // `pro/fightstg.s:10219`-`:10227`), so a drained partner would answer with that
      // instead of the record machine's page.
      b.enemy.hp = 99999; b.enemy.maxHp = 99999; b.player.hp = 120;
      b.player.mp = 400; b.player.maxMp = 400;
    }, c.techId);

    if (c.command === "tech") {
      // The list opens on the battle's own remembered row (web/battle.js:3737
      // `commandNative.open(joke ? 0 : b.menuSel | 0, ...)`), and the chosen row is written
      // back into it (:3753), so setting the row and reopening the list IS the player's own
      // selection state -- no synthetic cursor move, and the shipped list still answers the
      // confirm press.
      await selectCommand(1);
      await tapCircle(page);                                  // confirm "Tech"
      await page.waitForFunction(() => window.__battle.peek().state === 3, null, { timeout: 10_000 })
        .catch(() => {});
      await tapCircle(page);                                  // pick row 0 of the Tech list
    } else {
      await selectCommand(0);
      await tapCircle(page);                                  // confirm "Fight"
    }

    const seen = await readTurnPages(expected.kind);
    if (c.command === "tech") {
      // A technique is announced by its own page before the result page (kind 3, the
      // attack-resolution sequencer FIGHTSTG_F0x80090e84 at fightstg.s:14582-:14583), so
      // the technique NAME appearing there is what proves this record's row was the one
      // that ran -- a Fight press would show kind 3 for nothing.
      const announced = seen.find((x) => x.spec?.kind === 3);
      eq(`${c.line}: the technique announced itself before its result page`,
        announced?.spec?.slots?.[0] ?? null, SKILL_NAME[c.techId] ?? null);
    }
    const hit = seen.find((x) => x.spec?.kind === expected.kind && drawn(x.spec, x.lines));
    if (!hit) {
      fail(`${c.line} (record ${c.techId}) never put up a self-consistent kind-${expected.kind}`
        + ` page; the turn showed ${JSON.stringify(seen.map((x) => [x.spec?.kind ?? null, x.lines]))}`);
      continue;
    }

    eq(`record ${c.techId}: payload word 0 is the arm's own word`,
      hit.spec.payload[0], expected.payload[0]);
    eq(`record ${c.techId}: the payload has the arm's word count`,
      hit.spec.payload.length, expected.payload.length);
    // The lines, composed from the box's OWN payload through the same arm table. Line two
    // is compared only where its arm decides it: three arms (`kind 1` among them) leave
    // whatever line two held, so `compose` answers `null` there and the drawn words are
    // whatever the page before it left — which is exactly what `drawn()` above tolerates.
    const want = compose(hit.spec, hit.spec.name ?? PLAYER);
    eq(`record ${c.techId}: line one a player reads`, hit.lines[0], want[0]);
    if (want[1] !== null) {
      eq(`record ${c.techId}: line two a player reads`, hit.lines[1], want[1]);
    } else {
      console.log(`note record ${c.techId}: line two is left alone by kind-${hit.spec.kind},`
        + ` so it read ${JSON.stringify(hit.lines[1])} from the page before`);
    }
    if (await shot(`term-${c.category}-${c.techId}`)) {
      console.log(`shot term-${c.category}-${c.techId} ${hit.lines.join(" / ")}`);
    }
    results.push({
      techId: c.techId, category: c.category, clip: c.clip ?? record?.clip, kind: hit.spec.kind,
      payload: hit.spec.payload, lines: hit.lines,
      pages: seen.map((x) => ({ kind: x.spec?.kind ?? null, lines: x.lines })),
    });
    await settleToCommandMenu();
    if (c.random !== undefined) {
      await page.evaluate(() => { Math.random = window.__termOrigRandom; });
    }
  }
  console.log("RESULT " + JSON.stringify({ ok: failed === null, results }));
} catch (e) {
  console.error("THREW", e);
  failed = String(e);
  console.log("RESULT " + JSON.stringify({ ok: false, fail: String(e) }));
}
await page.evaluate(() => { if (window.__termOrigRandom) Math.random = window.__termOrigRandom; })
  .catch(() => {});
await browser.close();
if (errors.length) { console.error("page errors:", errors.slice(0, 4)); failed ??= "page errors"; }
if (failed) process.exitCode = 1;
