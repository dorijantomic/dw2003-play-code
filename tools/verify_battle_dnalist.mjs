// In-battle DNA pane: the translated pro/fightstg screen (tick 0x800980E4),
// opened on its own and read where it draws.
//
// The pane's first step is the shared partner list, which the TAG screen already
// runs; this check opens the pane directly on a seeded pairing and asserts the
// geometry F0x80097AB0 / F0x800979E4 / F0x80097BD8 / F0x80097CFC produce: the
// pane frame cel 0x2B at (167, 143), the species names at (187, 146+19*i), the
// header at (171, 146), "Switch" at (187, 165), "DNA DV" at (187, 184), "MP" at
// (270, 186), the price at (307, 186) and the four MP-plate widgets at y 57 with
// x from the table at 0x800A35D4. It then checks the three rules the walker got
// wrong: the frame and the MP plate are drawn when the Switch / DNA DV rows open
// and not before, L1 and R1 move the selected row and wrap (Up and Down do
// nothing here), Cross in the rows goes back to the names, and Circle on Switch
// answers with the species under the cursor without touching either member's MP
// while Circle on DNA DV takes the price off both.
//
// The seed is real game data, not invented ids: form 387's profile record at
// 0x8003EF5C + 9*0x58 carries 12 in its +0x3D byte, so its DNA partner is the
// record at the 1-based index 12 — form 5 — and 432 in the halfword at +0x2A.
// With the pane's cursor on form 5 (its own +0x55 is 12) the pairing settles and
// the option list has two rows.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_battle_dnalist.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.VERIFY_ROOT || process.env.BTL_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.BTL_SHOT || ".bunny-scratch/dnashots";
mkdirSync(OUT, { recursive: true });

// The walker's own technique data, the only place a technique's name is written
// down as text: web/assets/data/digimon.json's `skills`, indexed by the same id
// the panel hands bank 0xA2 (`word & 0x1FFF`, fightstg.s .L0x80094e80 in the
// delay slot of the widget's +0x114 call). The check reads every technique name
// the panel draws back out of the widget and compares it with this table, so a
// row that draws a letter instead of a name fails.
//
// The game's technique-name bank leaves its low slots as the single letter "a":
// bank 0xA2's indices 1..52 are one byte each (they are the ids the technique
// table gives the BASIC attacks, which the game never names — digimon.json marks
// every one of them `tech_basic`), and so are the unused slots above 219. A
// check that seeds one of those ids draws "a" and proves nothing, so every id
// below is a named technique, quoted from this table.
const SKILLS = new Map(JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data/digimon.json"),
  "utf8")).skills.map((s) => [s.id, s]));
const named = (id) => {
  const skill = SKILLS.get(id & 0x1fff);
  if (!skill || skill.tech_basic) throw new Error(`${id} is not a named technique`);
  return skill.name;
};
// Page 1 of the partner's own form: its signature, one technique another form can
// hand over, and one of its own level-up moves.
const OWN = [0x8000 | 56, 0x4000 | 137, 198];
// Page 2 is what the partner's OTHER equipped form has loaded, so its rows come
// out masked to 13 bits and can never take the loaded palette.
const OTHER = [0x4000 | 53, 0x4001 | 64];

// The partner is Renamon (RANK MON): the pane's self+0x60 is the ROSTER SLOT
// [0x8004B44C] answers for a party position (F0x80016D94), so the strip's first
// row is that slot's own profile row and its equipped triple follows. Renamon is
// roster slot 6 and profile row 6, game form 373.
const PARTNER_SLOT = 6;
const STARTER_FORM = 373;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) problems.push(msg);
};

/**
 * Form 387 fights, form 5 stands with it; 432 is the DNA result both records name.
 *
 * Every id handed to the screen is the WALKER's own (digimon.json, 1..55), the
 * ids the real caller web/battle.js passes, and the session turns each one into
 * the game's form id through one mapping before anything else sees it. That is
 * what real play does too, and what this fixture used to skip: it handed the
 * game's own ids, so it passed while the pane read the wrong rows in a fight
 * (tools/verify_dna_realplay.mjs drives the real battle).
 *
 * The partner also carries the carry-over panel's own data, read out of the
 * original's profile table (0x8003EF5C, the one shared cut this screen already
 * loads) rather than invented: its six stat halfwords at +0x02,
 * its seven elemental ones at +0x0E, and the twelve stat halfwords the panel's
 * page zero prints are sums over these.
 */
const seed = () => page.evaluate(({ ids, partnerSlot }) => {
  const screen = window.__battleDnaNative;
  const STRIDE = 0x58;
  // `profiles` is the profile table itself, 0x8003EF5C + 0x58*row, cut out of the
  // resident image once by the data build and loaded by the shared loader.
  const table = screen._data.profiles;
  const profileRow = (form) => {
    for (let i = 0; i < 0x37; i++) {
      const at = i * STRIDE;
      if ((table[at] | (table[at + 1] << 8)) === form) return i;
    }
    return 0;
  };
  // The other direction, the same table: the walker's own id for a form id is the
  // row that carries it, one-based. This is native/pause-status.ts's `gameFormId`
  // read backwards, and it is why the walker's 10 is the game's 387.
  const walkerFor = (form) => profileRow(form) + 1;
  const halfs = (row, offset, count) => Array.from({ length: count }, (_, i) => {
    const at = row * STRIDE + offset + i * 2;
    return (table[at] | (table[at + 1] << 8)) & 0xffff;
  });
  const partnerForm = 5;
  const secondForm = 6;
  // The species the pane's strip lists are the partner's OWN form followed by the
  // forms its roster record carries: [0x8004B46C] is F0x800176AC, which keeps
  // each of the roster's three EQUIPPED form ids that its acquired-form ledger
  // holds. So the partner is given three equipped forms and a ledger that holds
  // all three. The third is form 259 (ExVeemon), the walker's own id 13.
  const thirdForm = 259;
  const forms = [
    {
      species: partnerForm,
      left: halfs(profileRow(partnerForm), 0x02, 6),
      right: halfs(profileRow(partnerForm), 0x0e, 7),
      // The roster's own technique words for this form. F0x80017A1C reads them out
      // of the 0x14-byte block the DRI menu writes; the walker's form ledger holds
      // the same six, so the preview names real techniques. These are the named ids
      // digimon.json gives them, never a basic attack's id (the game's name bank
      // answers those with the single letter "a").
      techs: ids.own,
      level: 12,
      dvexp: 40,
    },
    {
      species: secondForm,
      left: halfs(profileRow(secondForm), 0x02, 6),
      right: halfs(profileRow(secondForm), 0x0e, 7),
      techs: [...ids.other, 0, 0, 0, 0],
      level: 7,
      dvexp: 10,
    },
    {
      // The third carried form: a real row, so the fourth strip row is named.
      species: thirdForm,
      left: halfs(profileRow(thirdForm), 0x02, 6),
      right: halfs(profileRow(thirdForm), 0x0e, 7),
      techs: [0, 0, 0, 0, 0, 0],
      level: 1,
      dvexp: 0,
    },
  ];
  // `form` is the GAME's id; the roster and the profile block are addressed by the
  // walker's id, one row along.
  // The caller's copy of the same three forms, in the walker's own ids — what
  // web/battle.js hands the pane.
  const formsForCaller = forms.map((f) => ({ ...f, species: walkerFor(f.species) }));
  // `form` is the game's id; the roster and the profile block are addressed by the
  // walker's id, one row along.
  const panelFor = (form, options, equipped = [walkerFor(form)]) => ({
    slotIndex: profileRow(form),
    options,
    // The panel's page one and page two both read the equipped triple F0x800176AC
    // resolves (fightstg.s .L0x8009506c / .L0x80095138), so the partner carries a
    // second form: page two is what the OTHER equipped form has loaded.
    equipped,
    // The profile's own 22 stat halfwords: level, tp, HP, max HP, MP, max MP, the
    // six core stats, the seven elements and the three buff counters the original
    // clears at the start of a battle (so nothing is grey in ordinary play).
    panelBlock: [12, 0, 120, 120, 70, 70, 60, 55, 50, 48, 52, 45,
      ...halfs(profileRow(form), 0x0e, 7), 0, 0, 0],
  });
  // `form` is the game's id and `walker` the walker's own, which is what the
  // screen is handed — exactly what web/battle.js passes.
  const member = (form, walker, hp, mp, status = 0, techs = [], rosterSlot = 0) => ({
    digimonId: walker, rosterSlot, hp, maxHp: hp, mp, maxMp: mp, status,
    panel: panelFor(form, [{ species: walker, left: halfs(profileRow(form), 0x02, 6),
      right: halfs(profileRow(form), 0x0e, 7), techs, level: 12, dvexp: 0 }]),
    forms: [{ species: walker, left: halfs(profileRow(form), 0x02, 6),
      right: halfs(profileRow(form), 0x0e, 7), techs, level: 12, dvexp: 0 }],
    preselected: 0,
  });
  screen.open({
    step: "pane",
    activeIndex: 0,
    partnerIndex: 1,
    members: [
      member(387, walkerFor(387), 120, 90, 0, [...ids.other, 0, 0, 0, 0]),
      { digimonId: walkerFor(partnerForm), rosterSlot: partnerSlot,
        hp: 200, maxHp: 200, mp: 70, maxMp: 70, status: 0,
        panel: panelFor(partnerForm, formsForCaller,
          [partnerForm, secondForm, thirdForm].map(walkerFor)), forms: formsForCaller },
      member(3, walkerFor(3), 150, 50, 0, []),
    ],
  });
  return screen.update([], 1 / 30);
}, { ids: { own: OWN.slice(0, 3), other: OTHER.slice(0, 2) }, partnerSlot: PARTNER_SLOT });

/** Run the pane's own frames with one held button, then read what it drew. */
const step = async (buttons = [], frames = 8) => page.evaluate(({ held, n }) => {
  const screen = window.__battleDnaNative;
  for (let i = 0; i < n; i++) screen.update(held, 1 / 30);
  const d = screen.diagnostics();
  const session = screen._session?.pane;
  const texts = session ? session.widgets.textWidgets()
    .map((w) => ({ x: w.penX, y: w.penY, palette: w.colour, string: w.stringId }))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x)) : [];
  const sprites = session ? session.draw.calls
    .filter((c) => c.method === "drawSprite")
    .map((c) => ({ cel: c.args[1], x: c.args[2], y: c.args[3] })) : [];
  return { diag: d, texts, sprites };
}, { held: buttons, n: frames });

/** Draw the pane into a canvas and return it as a PNG data URL. */
const capture = async (name) => {
  const url = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000018";
    ctx.fillRect(0, 0, 320, 240);
    window.__battleDnaNative.draw(ctx, 320);
    return canvas.toDataURL("image/png");
  });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  console.log("shot", name);
};

/**
 * The text the widget at (x, y) is really showing, decoded by the same codec the
 * painter uses (web/native-screen-text.js) out of the bytes the panel's +0x114
 * call installed. It reads the widget, not a log of the call, so a wrong bank, a
 * wrong language or a masked id all show up here.
 */
const nameAt = async (x, y) => page.evaluate(async (pos) => {
  const { decodeNativeText } = await import("/native-screen-text.js");
  const screen = window.__battleDnaNative;
  const widgets = screen._session?.pane?.widgets ?? screen._session?.widgets;
  const line = widgets?.textWidgets()
    .find((w) => w.penX === pos.x && w.penY === pos.y)?.lines?.[0];
  return line?.bytes?.length ? decodeNativeText(line.bytes).text : "";
}, { x, y });

/** The six technique rows' names and palettes, top to bottom, as painted. */
const rowNames = async () => page.evaluate(async () => {
  const { decodeNativeText } = await import("/native-screen-text.js");
  const widgets = window.__battleDnaNative._session?.pane?.widgets;
  return (widgets?.textWidgets() ?? [])
    .filter((w) => w.penX === 38)
    .sort((a, b) => a.penY - b.penY)
    .map((w) => ({
      y: w.penY,
      palette: w.colour,
      name: w.lines?.[0]?.bytes?.length ? decodeNativeText(w.lines[0].bytes).text : "",
    }));
});

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  // The battle loop only reaches PLAYER_DNA_CHOICE from a save that carries a
  // DNA pairing, so the check drives the same adapter module the game wires in
  // (web/battle.js createBattleDnaTranslated) on its own instead.
  await page.evaluate(async () => {
    const mod = await import("/battledna-translated.js");
    const screen = mod.createBattleDnaTranslated(null, { getState: () => ({ languageByte: 2 }) });
    window.__battleDnaNative = screen;
    screen.preload();
  });
  await page.waitForFunction(() => window.__battleDnaNative?._data, null, { timeout: 20_000 });

  await seed();
  await step([], 20);
  let s = await step([], 10);
  const pane = s.diag.pane;
  expect(s.diag.execution === "translated", `the pane runs translated logic (${s.diag.execution})`);
  expect(pane?.ready === true, "the pane is live and reading the pad");
  expect(s.diag.step === "pane", `the screen is on its pane step (${s.diag.step})`);

  // The name strip. The pane frame, the DNA row's backing and the MP plate are
  // NOT drawn yet: F0x800979E4 is reached only from the option sub-state
  // (fightstg.s:22413), which the name strip's own branches skip (they jump to
  // :22422 instead).
  const stripCels = s.sprites.map((c) => `${c.cel}@${c.x},${c.y}`);
  expect(!stripCels.includes("43@167,143"),
    `the pane frame is not drawn on the name strip (${stripCels.join(" ")})`);
  expect(stripCels.includes("36@167,146"),
    `the species marker is cel 0x24 at (167,146) (${stripCels.join(" ")})`);

  const has = (x, y) => s.texts.some((t) => t.x === x && t.y === y);
  expect(has(171, 146), "the header sits at (171,146)");
  expect(has(187, 146) && has(187, 165) && has(187, 184),
    "a species name, Switch and DNA DV sit at (187,146)/(187,165)/(187,184)");
  for (const x of [172, 216, 217, 251]) {
    expect(has(x, 57), `an MP-plate widget sits at (${x},57)`);
  }
  expect(pane?.species?.join() === `${STARTER_FORM},5,6,259`,
    `the strip is the partner's STARTER species plus the three forms its roster carries (${JSON.stringify(pane?.species)})`);
  // The strip's own names. Each row asks the profile record service
  // F0x800134E8 ([0x8005CCA0]) for its species and, when the service answers 0,
  // the loop skips the widget altogether (fightstg.s .L0x80097c44 `beqz $s0`,
  // jumping past the +0x114 call). Every id the walker's own party can carry is a
  // row of that table — its digimon.json ids ARE the rows — so all four rows here
  // are named; the blank-row case (a carried form with no profile record) cannot
  // be built from a real party and is the port's own `preselectRecord === 0` skip.
  // Nothing here comes from a DNA evolution table: the pane asks the partner's
  // roster record which forms it carries.
  const strip = await page.evaluate(async () => {
    const { decodeNativeText } = await import("/native-screen-text.js");
    const widgets = window.__battleDnaNative._session?.pane?.widgets;
    return (widgets?.textWidgets() ?? [])
      .filter((w) => w.penX === 187)
      .sort((a, b) => a.penY - b.penY)
      .map((w) => ({ y: w.penY, name: w.lines?.[0]?.bytes?.length ? decodeNativeText(w.lines[0].bytes).text : "" }));
  });
  expect(strip.filter((r) => r.name).map((r) => r.name).join("|") === "Renamon|Greymon|Devimon|ExVeemon",
    `all four carried rows are named from the game's own name bank (${JSON.stringify(strip)})`);
  expect(strip.some((r) => r.y === 203 && r.name === "ExVeemon"),
    `the fourth row sits at y 203 (${JSON.stringify(strip)})`);
  await capture("dna-names");

  // L1 and R1 turn the pages of the stat carry-over preview the pane puts on top
  // of itself: F0x800953E4 builds the panel (tick 0x80094F08, 0xEC bytes) from
  // three numbers — the partner's profile, this selection and the species strip's
  // cursor — and the pane replaces the panel whenever the selection changes.
  const pageOf = (state) => state.diag.pane?.preview?.page ?? -1;
  expect(pageOf(s) === 0, `the preview is on page 0 (${pageOf(s)})`);
  expect(s.diag.pane.handoffs.length > 0,
    `the pane asked for the preview (${JSON.stringify(s.diag.pane.handoffs)})`);
  expect(s.diag.pane.handoffs.at(-1)?.combatant === s.diag.pane.combatant,
    `the preview describes the partner's own profile (${JSON.stringify(s.diag.pane.handoffs.at(-1))})`);
  const zero = s.diag.pane.preview;
  // The panel copies the partner's own 22 stat halfwords into its block at +0x64
  // ([0x8004B468] = F0x80017174), and page zero prints the thirteen sums at +0x70
  // and +0x7C — which stay zero until the cursor is on a row, because a species
  // strip's first row is the partner's own form and adds nothing.
  expect(zero?.block?.length === 22,
    `the panel copied its 22-halfword stat block (${JSON.stringify(zero?.block)})`);
  expect(zero?.block?.[0] === 12 && zero?.block?.[2] === 120 && zero?.block?.[4] === 70,
    `the block is the partner's own battle record (${JSON.stringify(zero?.block?.slice(0, 6))})`);
  expect(zero?.block?.[19] === 0 && zero?.block?.[20] === 0 && zero?.block?.[21] === 0,
    `the three buff counters are clear, so nothing is grey (${JSON.stringify(zero?.block?.slice(19))})`);
  expect(zero?.pageZero?.length === 13,
    `page 0 prints thirteen sums (${JSON.stringify(zero?.pageZero)})`);
  // The six core stats and the seven elements sit at the block's halfwords 6..18,
  // which are the same addresses the sums occupy, so with the cursor on the
  // partner's own form the panel prints the profile's own numbers unchanged; a
  // cursor on another row adds that row's base stats into them.
  expect(zero?.pageZero?.slice(0, 6).join() === zero?.block?.slice(6, 12).join(),
    `page 0's left column is the profile's six core stats (${JSON.stringify(zero?.pageZero?.slice(0, 6))})`);
  expect(zero?.pageZero?.slice(6).join() === zero?.block?.slice(12, 19).join(),
    `page 0's right column is the seven elements (${JSON.stringify(zero?.pageZero?.slice(6))})`);
  // The two column captions are bank 0x7F words 0x11 and 0x12, and the thirteen
  // numbers sit at the (x, y) of the table at 0x800A350C: six at x 60 and seven
  // at x 126, both columns on a 14-pixel pitch.
  const textsOf = (state) => state.texts;
  expect(textsOf(s).some((t) => t.x === 34 && t.y === 171)
    && textsOf(s).some((t) => t.x === 56 && t.y === 171),
    "page 0's two column captions sit at (34,171) and (56,171)");
  for (const [x, y] of [[60, 82], [60, 152], [126, 82], [126, 166]]) {
    expect(textsOf(s).some((t) => t.x === x && t.y === y),
      `a page-zero number sits at (${x},${y})`);
  }
  let cels0 = s.sprites.map((c) => `${c.cel}@${c.x},${c.y}`);
  expect(cels0.includes("35@24,81"),
    `page 0 draws CMFONT cel 0x23 at (24,81) (${cels0.join(" ")})`);
  expect(cels0.includes("37@16,74"),
    `page 0 draws the corner cel 0x25 at (16,74) (${cels0.join(" ")})`);
  await capture("dna-preview-page0");

  await page.evaluate(() => window.__battleDnaNative.press("r1"));
  await step([], 12);
  s = await step([], 8);
  expect(pageOf(s) === 1, `R1 turned the preview to page 1 (${pageOf(s)})`);
  const one = s.diag.pane.preview;
  expect(one?.rows?.length === 6, `page 1 lists six technique rows (${JSON.stringify(one?.rows)})`);
  expect(textsOf(s).some((t) => t.x === 90 && t.y === 169),
    "page 1's caption sits at (90,169)");
  expect(textsOf(s).some((t) => t.x === 147 && t.y === 169),
    "page 1's headline number sits at (147,169)");
  for (const y of [81, 95, 109, 123, 137, 151]) {
    expect(textsOf(s).some((t) => t.x === 38 && t.y === y),
      `a technique name sits at (38,${y})`);
  }
  const cels1 = s.sprites.map((c) => `${c.cel}@${c.x},${c.y}`);
  expect(cels1.includes("38@16,74"),
    `page 1 draws the corner cel 0x26 at (16,74) (${cels1.join(" ")})`);
  // With no cursor row the panel shows the profile's own pre-selected word with
  // the signature bit on (fightstg.s .L0x8009506c), and this profile has none, so
  // the one row it builds carries id 0 and no name at all.
  const bare = await rowNames();
  expect(bare[0]?.name === "" && bare[0]?.palette === 3,
    `page 1 with no cursor row draws no name (${JSON.stringify(bare[0])})`);
  await capture("dna-preview-page1");

  await page.evaluate(() => window.__battleDnaNative.press("r1"));
  await step([], 12);
  s = await step([], 8);
  expect(pageOf(s) === 2, `R1 turned the preview to page 2 (${pageOf(s)})`);
  expect(s.diag.pane.preview?.rows?.length === 6,
    `page 2 lists six technique rows (${JSON.stringify(s.diag.pane.preview?.rows)})`);
  const cels2 = s.sprites.map((c) => `${c.cel}@${c.x},${c.y}`);
  expect(cels2.includes("38@16,74"),
    `page 2 draws the corner cel 0x26 at (16,74) (${cels2.join(" ")})`);
  await capture("dna-preview-page2");

  // The preview is one object: turning the pages replaces it, it does not stack.
  expect(s.diag.pane.tasks <= 4,
    `the pane holds one preview, not one per page (${s.diag.pane.tasks} tasks)`);
  await page.evaluate(() => window.__battleDnaNative.press("l1"));
  await step([], 12);
  s = await step([], 8);
  expect(pageOf(s) === 1, `L1 turned the preview back to page 1 (${pageOf(s)})`);

  // The species cursor has to leave the partner's starter row before the DNA row
  // can appear: `self+0x60` is the roster slot, so strip row 0 is that slot's own
  // profile row and every starter's +0x3D is 0 — no starter can DNA with anything.
  // Down walks onto the first EQUIPPED form, and the acting member here is Hookmon
  // (row 9, +0x3D = 12) while that form is Greymon (row 11, +0x55 = 12).
  await page.evaluate(() => window.__battleDnaNative.press("down"));
  await step([], 20);
  s = await step([], 8);
  expect(s.diag.pane.stripCursor === 1,
    `Down moved the species cursor off the partner's starter row (${s.diag.pane.stripCursor})`);

  // Circle opens the Switch / DNA DV rows, and that is where the pane draws its
  // frame, the DNA row's backing and the standard MP plate.
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 12);
  s = await step([], 10);
  expect(s.diag.pane?.subState === 1, `Circle moved to the option sub-state (${s.diag.pane?.subState})`);
  expect(s.diag.pane?.dnaId === 432,
    `the +0x3D/+0x55 pairing settled the DNA result (${s.diag.pane?.dnaId})`);
  const cels = s.sprites.map((c) => `${c.cel}@${c.x},${c.y}`);
  expect(cels.includes("43@167,143"), `the pane frame is cel 0x2B at (167,143) (${cels.join(" ")})`);
  expect(cels.includes("2@167,184"), `the DNA row's backing is cel 2 at (167,184) (${cels.join(" ")})`);
  expect(cels.includes("41@163,33"), `the MP plate is cel 0x29 at (163,33) (${cels.join(" ")})`);
  expect(has(270, 186) && has(307, 186), "the MP label and the price sit at (270,186)/(307,186)");
  await capture("dna-options");

  // L1/R1 move the pane's own three-position selection, which the carry-over
  // preview is handed; they never touch the Switch / DNA DV row. The row is the
  // option list model's own cursor, which the shared list widget moves with Up
  // and Down off the repeat word, so those two are held, not tapped.
  const before = s.diag.pane.previewOption;
  let t = await step(["up"], 24);
  expect(t.diag.pane.previewOption === before,
    `Up does not move the L1/R1 selection (${t.diag.pane.previewOption})`);
  expect(t.diag.pane.optionRow === 0, `Up at the top row leaves it at 0 (${t.diag.pane.optionRow})`);
  t = await step(["down"], 24);
  expect(t.diag.pane.previewOption === before,
    `Down does not move the L1/R1 selection (${t.diag.pane.previewOption})`);
  expect(t.diag.pane.optionRow === 1, `Down moved the option row to 1 (${t.diag.pane.optionRow})`);
  t = await step(["up"], 24);
  expect(t.diag.pane.optionRow === 0, `Up moved the option row back to 0 (${t.diag.pane.optionRow})`);
  s = t;

  // R1 raises the L1/R1 selection, L1 lowers it, both wrap over three positions.
  // The species-strip walk above left it on 1, and Circle does not reset it, so
  // the walk starts there and comes back to it — which is the page the carry-over
  // section below expects to be showing.
  expect(s.diag.pane.previewOption === 1,
    `the L1/R1 selection came out of the strip walk on 1 (${s.diag.pane.previewOption})`);
  await page.evaluate(() => window.__battleDnaNative.press("l1"));
  await step([], 10);
  s = await step([], 6);
  expect(s.diag.pane.previewOption === 0, `L1 lowered it to 0 (${s.diag.pane.previewOption})`);
  await page.evaluate(() => window.__battleDnaNative.press("l1"));
  await step([], 10);
  s = await step([], 6);
  expect(s.diag.pane.previewOption === 2, `L1 at the top wraps to 2 (${s.diag.pane.previewOption})`);
  await page.evaluate(() => window.__battleDnaNative.press("r1"));
  await step([], 10);
  s = await step([], 6);
  expect(s.diag.pane.previewOption === 0, `R1 at the bottom wraps to 0 (${s.diag.pane.previewOption})`);
  expect(s.diag.pane.sounds.includes(0x4001b), `R1 played the move blip 0x4001B (${s.diag.pane.sounds})`);
  await page.evaluate(() => window.__battleDnaNative.press("r1"));
  await step([], 10);
  s = await step([], 6);
  expect(s.diag.pane.previewOption === 1, `R1 raised it back to 1 (${s.diag.pane.previewOption})`);


  await page.evaluate(() => window.__battleDnaNative.press("cross"));
  await step([], 12);
  s = await step([], 6);
  expect(s.diag.pane?.subState === 0, `Cross went back to the names (${s.diag.pane?.subState})`);
  expect(s.diag.pane?.sounds?.includes(0x800450bd),
    `Cross played the cancel blip 0x800450BD (${s.diag.pane?.sounds})`);

  // On the name strip, Up and Down walk the species the pane lists, and the tail
  // hands the cursor row to the preview as well (fightstg.s:22408-22424). The
  // cursor is still on the equipped row the rows were opened from — crossing back
  // does not reset it — and that row is what makes the panel add that form's base
  // stats into page zero's columns and list that form's techniques on page one.
  expect(s.diag.pane.stripCursor === 1,
    `Cross left the species cursor on row 1 (${s.diag.pane.stripCursor})`);
  expect(s.diag.pane.preview?.row === 1,
    `the preview was handed the cursor row (${s.diag.pane.preview?.row})`);
  // Page 0 first: with a row under the cursor the panel adds that row's base
  // stats into the profile's own six core and seven elemental numbers.
  await page.evaluate(() => window.__battleDnaNative.press("l1"));
  await step([], 14);
  s = await step([], 8);
  const moved = s.diag.pane.preview;
  expect(moved?.page === 0, `L1 went back to page 0 (${moved?.page})`);
  expect(moved?.pageZero?.slice(0, 6).join() !== zero.block.slice(6, 12).join(),
    `page 0 added the cursor row's base stats to the six core numbers (${JSON.stringify(moved?.pageZero?.slice(0, 6))} against ${JSON.stringify(zero.block.slice(6, 12))})`);
  // Then page 1: the same row's technique words, named, with its own level.
  await page.evaluate(() => window.__battleDnaNative.press("r1"));
  await step([], 14);
  s = await step([], 8);
  const moved1 = s.diag.pane.preview;
  expect(moved1?.page === 1, `R1 went to page 1 (${moved1?.page})`);
  expect(moved1?.rows?.map((w) => w & 0xffff).join() === [...OWN, 0, 0, 0].join(),
    `page 1 lists that row's own technique words (${(moved1?.rows ?? []).map((w) => (w & 0xffff).toString(16))})`);
  expect(moved1?.headline > 0, `page 1's headline is the row's own level (${moved1?.headline})`);
  expect(s.texts.some((t) => t.x === 38 && t.y === 81),
    "page 1 names the first technique at (38,81)");
  // THE NAMES THEMSELVES. F0x80094D50 asks bank 0xA2 at `word & 0x1FFF`
  // (fightstg.s .L0x80094e80, the delay slot of the widget's +0x114 call), so each
  // row must show the name the walker's technique data gives that id — and the
  // signature row the plain palette, the loaded row palette 4 (.L0x80094e8c).
  const own = await rowNames();
  expect(own.length === 6, `page 1 builds six rows (${own.map((r) => r.y)})`);
  expect(own.slice(0, 3).map((r) => r.name).join("|") === OWN.map((w) => named(w)).join("|"),
    `page 1 names its three techniques (${JSON.stringify(own.slice(0, 3).map((r) => r.name))})`);
  expect(own.slice(3).every((r) => r.name === ""),
    `page 1's three empty rows draw nothing (${JSON.stringify(own.slice(3).map((r) => r.name))})`);
  expect(own[0]?.palette === 3 && own[1]?.palette === 4 && own[2]?.palette === 0,
    `the signature row is palette 3, the loaded row palette 4 (${own.slice(0, 3).map((r) => r.palette)})`);
  await capture("dna-preview-row1");

  // Page 2 is the other equipped form's LOADED techniques (the 0x4000 words, masked
  // to 13 bits and deduped, fightstg.s .L0x80095138), so its rows are named too and
  // the mask means they can never take the loaded palette.
  await page.evaluate(() => window.__battleDnaNative.press("r1"));
  await step([], 14);
  s = await step([], 8);
  const moved2 = s.diag.pane.preview;
  expect(moved2?.page === 2, `R1 went to page 2 (${moved2?.page})`);
  expect(JSON.stringify(moved2?.rows) === JSON.stringify([...OTHER.map((w) => w & 0x1fff), 0, 0, 0, 0]),
    `page 2 lists the other form's two loaded techniques (${(moved2?.rows ?? []).map((w) => w.toString(16))})`);
  const shared = await rowNames();
  expect(shared.slice(0, 2).map((r) => r.name).join("|") === OTHER.map((w) => named(w)).join("|"),
    `page 2 names the other form's techniques (${JSON.stringify(shared.slice(0, 2).map((r) => r.name))})`);
  expect(shared[0]?.palette === 0 && shared[1]?.palette === 0,
    `page 2's masked rows are the plain palette (${shared.slice(0, 2).map((r) => r.palette)})`);
  await capture("dna-preview-row1-page2");

  await page.evaluate(() => window.__battleDnaNative.press("up"));
  await step([], 20);
  s = await step([], 8);
  expect(s.diag.pane.stripCursor === 0,
    `Up moved the species cursor back to row 0 (${s.diag.pane.stripCursor})`);

  // Circle on the names and then on Switch answers with the species under the
  // cursor and spends no MP.
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 12);
  const mpBefore = (await step([], 4)).diag.pane.party.map((p) => p.mp);
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 12);
  s = await step([], 4);
  const answer = s.diag.answer;
  expect(answer !== null && answer >= 0, `Circle on Switch answered (${answer})`);
  expect((answer & 0xf) === 0, `the answer's low nibble is the Switch row (${answer & 0xf})`);
  expect((answer >> 4) === STARTER_FORM,
    `the answer's high nibble is the species under the cursor (${answer >> 4})`);
  expect(s.diag.pane.party.map((p) => p.mp).join() === mpBefore.join(),
    "Switch took no MP off either member");
  await capture("dna-switch-answered");

  // The DNA DV row is the one that charges: the price comes off both members
  // and the result species goes out through self+0x80. The pane stays open after
  // an answer (only the coordinator closes it), so the check reopens it the way
  // web/battle.js does when it takes the answer.
  await page.evaluate(() => window.__battleDnaNative.close());
  await seed();
  await step([], 20);
  await page.evaluate(() => window.__battleDnaNative.press("down"));
  await step([], 20);
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 12);
  s = await step(["down"], 24);
  expect(s.diag.pane.optionRow === 1, `the DNA DV row is selected (${s.diag.pane.optionRow})`);
  const price = s.diag.pane.price;
  expect(price > 70, `the Jogress price for DNA 432 is more than the seeded partner's MP (${price})`);
  const partyBefore = s.diag.pane.party.map((p) => p.mp);
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 12);
  s = await step([], 6);
  expect(s.diag.answer === null, `a partner short of the price is refused (${s.diag.answer})`);
  expect(s.diag.pane.party.map((p) => p.mp).join() === partyBefore.join(),
    "the refused DNA DV took no MP off either member");

  // With both members able to pay, the row answers and both lose the price.
  await page.evaluate(() => window.__battleDnaNative.close());
  await page.evaluate((partnerSlot) => {
    // The partner's roster record still has to carry the equipped form the DNA
    // pairing needs (walker 12 = Greymon, the row the acting member's +0x3D
    // names), because the strip's rows after the starter come from that record.
    const species = window.__battleDnaNative?._data?.profiles;
    // digimon.json numbers the disc's 55 profile rows 1..55 in their own order,
    // so a walker's id names the row one below it (tests/lane-b/dna-command.test.js).
    const halfs = (row, offset, count) => Array.from({ length: count }, (_, i) => {
      const at = row * 0x58 + offset + i * 2;
      return (species[at] | (species[at + 1] << 8)) & 0xffff;
    });
    const greymon = 12 - 1;
    window.__battleDnaNative.open({
      step: "pane", activeIndex: 0, partnerIndex: 1,
      members: [
        { digimonId: 10, rosterSlot: 0, hp: 120, maxHp: 120, mp: 300, maxMp: 300 },
        { digimonId: 12, rosterSlot: partnerSlot, hp: 200, maxHp: 200, mp: 300, maxMp: 300,
          panel: {
            slotIndex: partnerSlot,
            options: [{ species: 12, left: halfs(greymon, 0x02, 6), right: halfs(greymon, 0x0e, 7),
              techs: [0, 0, 0, 0, 0, 0], level: 1, dvexp: 0 }],
            equipped: [12],
            panelBlock: [12, 0, 200, 200, 300, 300, 60, 55, 50, 48, 52, 45,
              ...halfs(greymon, 0x0e, 7), 0, 0, 0],
          } },
        { digimonId: 4, rosterSlot: 7, hp: 150, maxHp: 150, mp: 50, maxMp: 50 },
      ],
    });
  }, PARTNER_SLOT);
  await step([], 20);
  await page.evaluate(() => window.__battleDnaNative.press("down"));
  await step([], 20);
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 12);
  s = await step(["down"], 24);
  const mpFull = s.diag.pane.party.map((p) => p.mp);
  expect(s.diag.pane.price === price, `the same DNA id costs the same (${s.diag.pane.price})`);
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 12);
  s = await step([], 6);
  const dna = s.diag.answer;
  const party = s.diag.pane.party;
  expect(dna !== null && (dna & 0xf) === 1, `Circle on DNA DV answered (${dna})`);
  expect(party[0].mp === mpFull[0] - price && party[1].mp === mpFull[1] - price,
    `the price ${price} came off both members (${party[0].mp}/${party[1].mp})`);
  expect(s.diag.speciesOut === 432, `the result species went out through +0x80 (${s.diag.speciesOut})`);
  expect(s.diag.pane.handoffs.length >= 1,
    `the stat carry-over screen was asked for (${s.diag.pane.handoffs.length} calls)`);
  await capture("dna-dv-answered");

  // The shared session must preserve the resident Blast flag instead of
  // seeding +0x1A with zero. Reopen the same otherwise valid pairing.
  await page.evaluate(() => {
    const screen = window.__battleDnaNative;
    const seed = structuredClone(screen._seed);
    seed.members[0].blast = true;
    seed.members[0].mp = seed.members[1].mp = 300;
    screen.close();
    screen.open(seed);
  });
  await step([], 20);
  await page.evaluate(() => window.__battleDnaNative.press("down"));
  await step([], 20);
  await page.evaluate(() => window.__battleDnaNative.press("circle"));
  await step([], 20);
  expect(await page.evaluate(() => window.__battleDnaNative._session.pane.dnaId()) === 0,
    "Blast actor suppresses an otherwise valid DNA offer");
  await capture("dna-blast-switch-only");

  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
  await page.evaluate(() => window.__battleDnaNative.close());
} catch (error) {
  problems.push(`threw: ${error?.message ?? error}`);
  console.error(error);
} finally {
  await browser.close();
}

console.log(problems.length === 0 ? "\nPASS" : `\nFAIL ${problems.length}`);
process.exit(problems.length === 0 ? 0 : 1);