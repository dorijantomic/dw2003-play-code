// The Language Desk — the digimon world 3 boot language screen has seven rows and the
// pad can only reach five of them. The desk lays out the decoded branch: which rows the
// PAL build can pick, what each one changes, and the surprising answer that the USA row
// changes nothing decoded at all.
//
// Sources (all in ddw3-walker/docs/research/ui/):
//   cnty_sel-full-decode-2026-08-05.md      the seven-row cursor table and the dead side pane
//   stdwtitl-title-menu-2026-08-14.md       the title menu's per-language clip trios and the
//                                            Japanese build's different opening
//   end-screen-decoded-2026-08-14.md        the END card's per-language clip
//   card-folder-screens-layout.md           the naming keyboard's page count and the plates
//
// The page (web/language-desk.html) is text only and opens from
// F2 -> Extras -> Language desk (off by default).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  ROW_TABLE,
  ROWS,
  TITLE_CLIPS,
  END_CLIPS,
  NAMEDT_PAGES,
  PLATE_CLIPS,
  JPN_OPENING,
  branchesFor,
} from "../web/language-desk.js";

const CNTY = "docs/research/ui/cnty_sel-full-decode-2026-08-05.md";
const TITLE = "docs/research/ui/stdwtitl-title-menu-2026-08-14.md";
const END = "docs/research/ui/end-screen-decoded-2026-08-14.md";
const PLATE = "docs/research/ui/card-folder-screens-layout.md";

test("the cursor table is the seven bytes 02 03 05 04 06 01 00, a permutation of 0..6", () => {
  assert.deepEqual(ROW_TABLE, [2, 3, 5, 4, 6, 1, 0]);
  assert.deepEqual([...ROW_TABLE].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(ROW_TABLE).size, 7);
});

test("the desk has seven rows, each writing its cursor-table byte and citing where it was decoded", () => {
  assert.equal(ROWS.length, 7);
  ROWS.forEach((r, i) => {
    assert.equal(r.row, i);
    assert.equal(r.language, ROW_TABLE[i], `row ${i} writes the cursor table's byte`);
    assert.ok(typeof r.name === "string" && r.name.trim(), `row ${i} has a name`);
    assert.equal(typeof r.reachable, "boolean");
    assert.ok(typeof r.source === "string" && r.source.trim(), `row ${i} has a source`);
  });
});

test("only rows 0-4 are reachable; rows 5 (USA) and 6 (JPN) sit on the side pane", () => {
  assert.deepEqual(ROWS.filter((r) => r.reachable).map((r) => r.row), [0, 1, 2, 3, 4]);
  assert.deepEqual(ROWS.filter((r) => !r.reachable).map((r) => r.row), [5, 6]);
  assert.equal(ROWS[5].name, "USA");
  assert.equal(ROWS[5].side, "right");
  assert.equal(ROWS[6].code, "JPN");
  assert.equal(ROWS[6].side, "left");
});

test("the five reachable rows are the PAL EFIGS in alphabetical order", () => {
  assert.deepEqual(ROWS.slice(0, 5).map((r) => r.name), ["English", "French", "German", "Italian", "Spanish"]);
  assert.deepEqual(ROWS.slice(0, 5).map((r) => r.language), [2, 3, 5, 4, 6]);
});

test("the title menu's trios are per language, and JPN, USA and English share one", () => {
  assert.deepEqual(TITLE_CLIPS, {
    0: [8, 9, 10],
    1: [8, 9, 10],
    2: [8, 9, 10],
    3: [17, 18, 19],
    4: [11, 12, 13],
    5: [20, 21, 22],
    6: [14, 15, 16],
  });
  assert.deepEqual(TITLE_CLIPS[0], TITLE_CLIPS[1]);
  assert.deepEqual(TITLE_CLIPS[1], TITLE_CLIPS[2]);
});

test("the Japanese release builds a different opening, and the flag carries its source", () => {
  assert.equal(JPN_OPENING.different, true);
  assert.equal(JPN_OPENING.source, TITLE);
  assert.match(JPN_OPENING.detail, /three screen objects/i);
});

test("the END card clips, the keyboard's page counts and the name plates are the decoded ones", () => {
  assert.deepEqual(END_CLIPS, [0, 0, 0, 2, 3, 1, 2]);
  assert.equal(NAMEDT_PAGES[0], 3, "JPN has three pages");
  for (const language of [1, 2, 3, 4, 5, 6]) assert.equal(NAMEDT_PAGES[language], 1, `language ${language} has one page`);
  assert.deepEqual(PLATE_CLIPS, { 10: 53, 5: 52, 8: 55 });
});

test("the USA row changes no decoded layout branch at all — and the page says so", () => {
  assert.deepEqual(branchesFor(1), []);
  const html = readFileSync("web/language-desk.html", "utf8");
  assert.match(html, /USA row changes nothing decoded/i);
});

test("the JPN row changes exactly three things: the opening, the keyboard pages and the plate", () => {
  const branches = branchesFor(0);
  assert.equal(branches.length, 3);
  assert.deepEqual(branches.map((b) => b.kind), ["opening", "keyboard", "plate"]);
  assert.equal(branches[0].source, TITLE);
  assert.equal(branches[1].source, PLATE);
  assert.equal(branches[2].source, PLATE);
  for (const b of branches) {
    assert.ok(b.what.trim(), `"${b.kind}" has a headline`);
    assert.ok(b.detail.trim(), `"${b.kind}" has a detail line`);
  }
});

test("the other four languages each change the title trio and the END card", () => {
  for (const [language, trio] of [[3, [17, 18, 19]], [4, [11, 12, 13]], [5, [20, 21, 22]], [6, [14, 15, 16]]]) {
    const branches = branchesFor(language);
    assert.equal(branches.length, 2, `language ${language} changes two branches`);
    assert.deepEqual(branches.map((b) => b.kind), ["title", "end"]);
    assert.deepEqual(branches[0].clips, trio, `language ${language} draws its own trio`);
    assert.equal(branches[1].clip, END_CLIPS[language], `language ${language} draws its own END card`);
  }
  assert.deepEqual(branchesFor(2), [], "English is the reference: it branches from nothing");
});

test("every row and branch cites a walker decode under docs/research/ui/", () => {
  for (const r of ROWS) assert.match(r.source, /^docs\/research\/ui\/.+\.md$/);
  for (let language = 0; language <= 6; language++) {
    for (const b of branchesFor(language)) assert.match(b.source, /^docs\/research\/ui\/.+\.md$/);
  }
  assert.equal(ROWS[0].source, CNTY);
});

test("the F2 switch is the Extras pair and EXPERIMENTAL, with a button row that is hidden while off", () => {
  const ambience = readFileSync("web/ambience.js", "utf8");
  assert.ok(ambience.includes('["langdesk", "Language desk (new)"]'), "the Extras row has the pair");
  assert.match(ambience, /const EXPERIMENTAL = \[[^\]]*"langdesk"/, "langdesk is off until switched on");
  const devModel = readFileSync("web/dev-panel-model.js", "utf8"), devPanel = readFileSync("web/dev-panel.js", "utf8");
  assert.match(devModel, /langdesk: P\("language-desk\.html"/, "the Open button's page is in the F2 page model");
  assert.match(ambience, /if \(!o \|\| !fx\[key\]\) return;/, "opened only behind the switch (the Open guard)");
  assert.match(devPanel, /b\.disabled = !fx\[/, "the Open button is disabled while the switch is off");
});

test("the desk page exists, imports the module and draws its table from it", () => {
  assert.ok(existsSync("web/language-desk.html"));
  const html = readFileSync("web/language-desk.html", "utf8");
  assert.match(html, /from "\.\/language-desk\.js"/);
  assert.match(html, /Language desk/);
  assert.match(html, /ROW_TABLE|02 03 05 04 06 01 00/);
  assert.match(html, /id="rows"/);
  assert.match(html, /id="branches"/);
});
