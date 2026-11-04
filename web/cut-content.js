// web/cut-content.js — the Cut-Content Gallery: a read-only text page that says plainly what the
// disc never lets a player see, and which leads were falsified so nobody rebuilds a myth.
//
// Six exhibits, one per page. Every fact is read from the repo's own evidence record
// (docs/research/evidence/ledger.json) or from the generated data the page cites, and every
// exhibit carries its evidence path so the claim can be re-checked. The prose decodes behind the
// claims live in the walker's research tree (docs/research/UNFINISHED-CONTENT-NOT-ADDED-TO-THE-
// ACTUAL-GAME.md, docs/research/ui/stagslct-full-decode-2026-08-05.md §"Two dead branches",
// docs/research/field/repeat-examine-search-points-2026-07-26.md); the ledger entry is what the
// repo can check without that tree.
//
// Nothing here is a to-do item: the game cancels the arena in dialogue, and the walker recreates
// the game that shipped. The page is OFF unless F2 -> Extras -> Cut-content gallery is switched on
// (web/ambience.js), opens on that toggle's rising edge and owns the pad while it is up.
//
// The module is DOM-free at the top level so node tests can import it; the drawing takes a canvas
// context and the two view sizes.

/** The six exhibits. `body` is one short paragraph; `evidence` is a real path in this repo. */
export const CUT_CONTENT = [
  {
    title: "The Arena ladder the game cancels in dialogue",
    body:
      "Both Digimon Arena floors ship a five-opponent ladder - s232 Asuka screens 253-257 and s233 Amaterasu screens 258-262 - " +
      "and nothing can start a single match. Neither floor carries an event table, a step program or an NPC, and the one routine " +
      "that starts a scripted battle takes its record index from a caller, and no caller has been found. Nine of the ten records are a single " +
      "level-1 Kunemon; only Amaterasu's fifth, screen 262, is an authored party (Datamon, Bulbmon, Armageddemon), and that is the " +
      "one fight that ships: the World Champ finale on the s927 room at story ordinal 0x2d. A live check on 2026-08-13 stood on s233 " +
      "in the tournament state and swept the floor with confirm and cancel: nothing started. The Arena Receptionist says registration " +
      "is closed for maintenance and onlookers react to the cancellation, so the story cancels the tournament on purpose. " +
      "The bracket does not exist in the finished game.",
    evidence: "docs/research/evidence/ledger.json",
  },
  {
    title: "The Digivolve Demo switch with no way in",
    body:
      "A complete options screen headed 'Digivolve Demo' ships with ON and OFF choices and the line 'Setup the Battle Digivolve " +
      "demo': its own factory, screen function, draw routine and state machine. No instruction in the game can select it. The status " +
      "overlay picks its screen with table[variant*7 + row]; the variant is only ever the Card Folder unlock flag, the row is only " +
      "ever the pause-menu cursor, and that cursor is clamped to rowCount-1. The Demo Setup slot sits at index rowCount in both " +
      "variants - row 5 against a maximum of 4 with the folder locked, row 6 against 5 with it unlocked. This one is static only: it " +
      "was not confirmed on the running game. The walker ships the screen deliberately and non-authentically as a debug screen; its " +
      "pause row is off by default (?demoSetup=1 or localStorage demoSetupRow=1) and it is always reachable from web/ui-lab.html.",
    evidence: "docs/research/evidence/ledger.json",
  },
  {
    title: "Two dead branches in the stage-select table",
    body:
      "The developers' stage-select table holds 297 records of {label_left, label_right, type, value}. Two branches in its code can " +
      "never run on the retail disc. The launch state loads value, tests bit 15, and only when that bit is set would pass 0 to the " +
      "launcher and force the master story ordinal to value - no shipped record sets bit 15. The Circle handler compares type against " +
      "0x300 and on a match would write value to the master story ordinal without leaving the screen - no shipped record has type " +
      "0x300. Both were checked by walking the whole table: 297 rows, 257 distinct types, 0x300 absent and no value with bit 15 set. " +
      "The table is a launcher, not a travel menu: seven of its rows are shop launches (code 0xf00) - the special shop 30, the rows " +
      "labelled shops 0-4 and the row labelled shop 29, whose stored value is 28.",
    evidence: "docs/research/evidence/ledger.json",
  },
  {
    title: "The special shop 30: 52 items, no merchant",
    body:
      "web/assets/data/shops.json carries shop_id 30 with 52 items and an empty name. Its stock is the game's important shop: the " +
      "three starter packs, TreeBoots, the FishingPole, the four City Badges, three trophies, four ID passes, the eight city tags and " +
      "the DDNA items. No merchant opens it. merchant_shops.json maps 87 merchants, 37 of them item shops, and not one is " +
      "shop 30; its only index-30 entry launches the inn instead, and the resident bank-0x7a dispatcher opens an item " +
      "shop only for indices 0-29 - index 30 falls through to the inn launcher. The only " +
      "row that names shop 30 is the stage-select table's own special-shop entry (code 0xf00, value 30), and that table is a " +
      "developers' launcher. Missing: the opener, not the stock.",
    evidence: "web/assets/data/shops.json",
  },
  {
    title: "The Master Room: seven sensors, one unread reward",
    body:
      "s305 Asuka City - Master Room (screen 0x218) and its Amaterasu twin s306 hold seven invisible NPC records (63, 198, 199, " +
      "289-292), one per sensor. Each first touch names a letter - M, O, N, S, T, E, R - and sets its own bank-0x1c flag " +
      "(0x1c27-0x1c2d); the non-terminal touch states gate on 0x7070 == 1, when 0x7070 == 0 a shared state clears all seven and " +
      "sets 0x1c36, and the R sensor alone has an alternate outcome (0x1c37) when the chain flag 0x1c33 is set. The room is not in " +
      "the walkthrough's item list at all, and no reward for the seven sensors has been read. Unresearched, not missing: the seven " +
      "records are real, the prize is unknown.",
    evidence: "docs/research/evidence/ledger.json",
  },
  {
    title: "Nine Kunemon stubs where tournament rounds should be",
    body:
      "The arena ladder's opponents were never written. In web/assets/data/field_encounters.json, screens 253-257 (all five Asuka " +
      "records) and 258-261 (the first four Amaterasu records) each hold exactly one Kunemon, level 1, 120 HP - the same " +
      "starter-tier placeholder nine times in a row. The tenth record, screen 262, is the only authored party: Datamon level 90, " +
      "Bulbmon level 95, Armageddemon level 99. Nine identical stubs are not nine rounds; they are the shape of a ladder that was " +
      "scaffolded and never filled in.",
    evidence: "web/assets/data/field_encounters.json",
  },
];

/** The honest note drawn under every page: exhibits are not promises, and these leads are falsified. */
export const CUT_CONTENT_NOTE =
  "These are exhibits, not a to-do list: the game cancels the arena in dialogue, and the walker recreates what shipped. " +
  "Leads that did not qualify: smdldata is undecoded rather than unreachable, and MEFT1001-1055 are battle effect packs, " +
  "not unbound field art. Every claim here is in docs/research/evidence/ledger.json.";

const PAGE_COLS = 70;   // 13px monospace inside the 556px panel
const NOTE_COLS = 84;   // 11px note line

const S = {
  open: false,
  page: 0,
  wasOn: false,   // the F2 flag last frame: the page opens on its rising edge only
};

/** Is the page up? (web/game.js freezes the field and routes the pad to it while true.) */
export function cutContentOpen() {
  return S.open;
}

/** The exhibit on screen, 0-based. */
export function cutContentPage() {
  return S.page;
}

/** How many pages the panel has (one per exhibit). */
export function cutContentPages() {
  return CUT_CONTENT.length;
}

export function openCutContent() {
  S.open = true;
  S.page = 0;
}

export function closeCutContent() {
  S.open = false;
}

/**
 * Follow the F2 -> Extras -> Cut-content gallery setting. Opens once when it turns on (the rising
 * edge), closes when it turns off. Closing the page with Cross while the setting stays on does not
 * reopen it; switching the setting off and on again does.
 */
export function tickCutContent(enabled) {
  const on = enabled === true;
  if (on && !S.wasOn) openCutContent();
  else if (!on && S.wasOn) closeCutContent();
  S.wasOn = on;
  return S.open;
}

/**
 * The pad while the page is up: Left/Right turn a page (wrapping), Cross/Start close it, and every
 * other press is swallowed so nothing reaches the field under it. Returns false when it is closed.
 */
export function cutContentPress(k) {
  if (!S.open) return false;
  const n = CUT_CONTENT.length;
  if (k === "left") S.page = (S.page + n - 1) % n;
  else if (k === "right") S.page = (S.page + 1) % n;
  else if (k === "cross" || k === "start") S.open = false;
  return true;
}

/** Break text into lines no longer than `cols` characters, on spaces (a long token keeps its own line). */
export function wrapText(text, cols) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += " " + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/** One page's ready-to-draw strings (pure; the test and the draw both use this). */
export function cutContentLines(index = S.page) {
  const e = CUT_CONTENT[index];
  if (!e) return null;
  return {
    title: e.title,
    body: wrapText(e.body, PAGE_COLS),
    evidence: `Evidence: ${e.evidence}`,
    note: wrapText(CUT_CONTENT_NOTE, NOTE_COLS),
    page: index + 1,
    pages: CUT_CONTENT.length,
  };
}

/**
 * Draw the page over the whole view. `W`/`H` are the canvas box (640x480 in the game); the panel is
 * inset from them, so it also reads correctly in a smaller test canvas.
 */
export function cutContentDraw(ctx, W = 640, H = 480) {
  if (!S.open) return false;
  const lines = cutContentLines();
  if (!lines) return false;

  const x = Math.round(W * 0.04), y = Math.round(H * 0.04);
  const w = W - 2 * x, h = H - 2 * y;
  const left = x + 16;
  const lh = 18;

  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.95)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#4f8fc0";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // header: what this is, and where you are in it
  ctx.font = "bold 18px monospace";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText("CUT-CONTENT GALLERY", left, y + 10);
  ctx.font = "14px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.textAlign = "right";
  ctx.fillText(`${lines.page} / ${lines.pages}`, x + w - 16, y + 13);
  ctx.textAlign = "left";

  // title
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(lines.title, left, y + 36);

  // body
  ctx.font = "13px monospace";
  ctx.fillStyle = "#d8e2f0";
  let ty = y + 60;
  for (const line of lines.body) {
    ctx.fillText(line, left, ty);
    ty += lh;
  }

  // evidence
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = "#6fd0a8";
  ctx.fillText(lines.evidence, left, ty + 4);

  // the honest note, small, above the controls
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  let ny = y + h - 34 - lines.note.length * 14;
  for (const line of lines.note) {
    ctx.fillText(line, left, ny);
    ny += 14;
  }

  // controls
  ctx.font = "12px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.fillText("Left / Right: page    Cross / Start: close    F2 -> Extras switches it off", left, y + h - 18);
  ctx.restore();
  return true;
}
