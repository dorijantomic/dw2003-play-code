// The Cut-Content Gallery (web/cut-content.js): seven honest exhibits about content the
// disc never lets a player see, each with the evidence path that proves it. The page is
// text only and opens from F2 -> Extras -> Cut-content gallery (off by default).
//
// The facts are read from the repo's own evidence record (docs/research/evidence/ledger.json)
// and from the generated data the page cites; the walker's prose decodes behind those claims
// are named in the exhibit bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  CUT_CONTENT,
  CUT_CONTENT_NOTE,
  cutContentPress,
  cutContentOpen,
  cutContentPage,
  cutContentPages,
  tickCutContent, openCutContent,
  wrapText,
  cutContentLines,
} from "../web/cut-content.js";

test("the gallery has exactly seven exhibits, each with a title, a body and an evidence path", () => {
  assert.equal(CUT_CONTENT.length, 7);
  assert.equal(cutContentPages(), 7);
  for (const e of CUT_CONTENT) {
    assert.equal(typeof e.title, "string");
    assert.ok(e.title.trim().length > 0, "every exhibit has a title");
    assert.equal(typeof e.body, "string");
    assert.ok(e.body.trim().length > 0, `"${e.title}" has a body`);
    assert.equal(typeof e.evidence, "string");
    assert.ok(e.evidence.trim().length > 0, `"${e.title}" has an evidence path`);
  }
});

test("every evidence path is a real file under docs/ or web/assets/data/", () => {
  for (const e of CUT_CONTENT) {
    assert.match(e.evidence, /^(docs|web\/assets\/data)\//, `"${e.title}" cites docs/ or web/assets/data/`);
    assert.ok(existsSync(e.evidence), `"${e.title}" cites a path that exists: ${e.evidence}`);
  }
});

test("the seven titles name the Arena, the Digivolve Demo, shop 30, the Master Room and no motion", () => {
  const titles = CUT_CONTENT.map((e) => e.title).join("\n");
  for (const name of ["Arena", "Digivolve", "shop 30", "Master Room", "no motion"]) {
    assert.ok(titles.includes(name), `a title names ${name}`);
  }
});

test("the page states plainly that the arena bracket does not exist in the finished game", () => {
  const page = CUT_CONTENT.map((e) => `${e.title}\n${e.body}`).join("\n");
  assert.match(page, /bracket does not exist in the finished game/i);
  // and the honest note separates exhibits from to-dos and names the falsified leads
  assert.match(CUT_CONTENT_NOTE, /not a to-do list/i);
  assert.match(CUT_CONTENT_NOTE, /MEFT1001-1055/);
  assert.match(CUT_CONTENT_NOTE, /smdldata/);
});

test("the Kunemon and shop 30 numbers on the page are the shipped data's own", () => {
  // nine single level-1 Kunemon records, then the one authored party
  const screens = JSON.parse(readFileSync("web/assets/data/field_encounters.json", "utf8")).screens;
  for (let id = 253; id <= 261; id++) {
    const party = screens[String(id)];
    assert.equal(party.length, 1, `screen ${id} holds one Digimon`);
    assert.equal(party[0].name, "Kunemon");
    assert.equal(party[0].level, 1);
  }
  assert.deepEqual(screens["262"].map((m) => m.name), ["Datamon", "Bulbmon", "Armageddemon"]);

  // shop 30: 52 items, no name, no merchant binding
  const shop = JSON.parse(readFileSync("web/assets/data/shops.json", "utf8")).shops.find((s) => s.shop_id === 30);
  assert.ok(shop, "shop 30 exists");
  assert.equal(shop.items.length, 52);
  assert.equal(shop.name, "");
  const merchants = JSON.parse(readFileSync("web/assets/data/merchant_shops.json", "utf8")).merchants;
  assert.equal(merchants.length, 87);
  assert.equal(merchants.filter((m) => m.kind === "item_shop").length, 37);
  assert.ok(!merchants.some((m) => m.shop_id === 30), "no merchant opens shop 30");
  // index 30 in the merchant table is the inn launcher, not an item shop
  const at30 = merchants.filter((m) => m.ui_index === 30);
  assert.equal(at30.length, 1);
  assert.equal(at30[0].kind, "launch_0x1002");
});

test("the stage-select paragraph's shop numbers are the shipped table's own", () => {
  // the table the exhibit describes: 297 rows, 257 distinct types, no 0x300 row, no value with bit 15
  const table = JSON.parse(readFileSync("web/assets/data/stagslct_ui.json", "utf8"));
  const rows = table.menuRows;
  assert.equal(rows.length, 297);
  assert.equal(new Set(rows.map((r) => r.type)).size, 257);
  assert.ok(!rows.some((r) => r.type === "0x300"), "no shipped row has type 0x300");
  assert.ok(!rows.some((r) => (Number(r.value) & 0x8000) !== 0), "no shipped row sets bit 15");

  // exactly seven rows are shop launches (code 0xf00): the special shop 30, the rows
  // labelled shops 0-4 and the row labelled shop 29, which stores value 28
  const shopRows = rows.filter((r) => r.type === "0xf00");
  assert.equal(shopRows.length, 7, "seven shop rows, not 31");
  assert.deepEqual(shopRows.map((r) => r.value), [30, 0, 1, 2, 3, 4, 28]);
  assert.equal(shopRows[0].value, 30, "the special shop is value 30");
  assert.equal(shopRows[6].name_jp, "みせ２９", "the last shop row is labelled shop 29");

  // the exhibit says what the table holds, and no longer claims 31 shop records / values 0-29 plus 30
  const body = CUT_CONTENT[2].body;
  assert.match(body, /seven of its rows are shop launches \(code 0xf00\)/);
  for (const named of ["special shop 30", "shops 0-4", "shop 29", "stored value is 28"]) {
    assert.ok(body.includes(named), `the paragraph names ${named}`);
  }
  assert.doesNotMatch(body, /31 shop records/);
  assert.doesNotMatch(body, /values 0-29 plus 30/);
});

test("the seventh exhibit is the bodies that cannot move, and the census note is its evidence", () => {
  const exhibit = CUT_CONTENT[6];
  assert.match(exhibit.title, /no motion/);
  assert.equal(exhibit.evidence, "docs/fight3d-animation-census.md");
  assert.ok(existsSync(exhibit.evidence), "the census note exists");

  // the counts the page states, and the still body it names
  for (const token of ["249", "23", "111", "13", "m466rgn2"]) {
    assert.ok(exhibit.body.includes(token), `the exhibit body carries ${token}`);
  }
  // every inert body is named, with what plays instead
  for (const folder of ["m468agnm", "m469garm", "m470agry"]) {
    assert.ok(exhibit.body.includes(folder), `the exhibit names ${folder}`);
  }
  assert.match(exhibit.body, /donor/i);
  // and it says plainly that these shipped - they are not a cut-content claim
  assert.match(exhibit.body, /shipped/i);
  assert.match(exhibit.body, /not cut content/i);
});

test("the census note's numbers match a fresh count of the shipped animation data", () => {
  const root = "web/assets/battle/models";
  const folders = JSON.parse(readFileSync(`${root}/index.json`, "utf8"));
  assert.equal(folders.length, 249);

  const present = new Map();
  const authors = new Array(62).fill(0);
  let still = null;
  for (const folder of folders) {
    const anim = JSON.parse(readFileSync(`${root}/${folder}/anim.json`, "utf8"));
    const n = anim.clips.filter((c) => c.present).length;
    present.set(n, (present.get(n) || 0) + 1);
    assert.equal(anim.timeline.length, 62, `${folder} carries 62 timeline tables`);
    anim.timeline.forEach((t, i) => {
      if (t.table.length > 0) authors[i] += 1;
    });
    if (folder === "m466rgn2") still = anim;
  }
  assert.equal(present.get(18), 23, "23 packs carry all 18 action clips");
  assert.equal(present.get(6), 111, "111 packs carry exactly 6");
  assert.equal(present.get(0), 3, "three packs carry no clip array");
  const never = authors.flatMap((n, i) => (n === 0 ? [i] : []));
  assert.equal(never.length, 13, "13 of the 62 timeline tables are authored by no pack");

  // m466rgn2: total_frames 0, every real keyframe at frame 0 (30000 is the end marker),
  // yet 12 non-empty tables - every table plays a still
  assert.equal(still.total_frames, 0);
  const frames = still.bones
    .flatMap((b) => Object.values(b.anim).flat())
    .map((rec) => rec[rec.length - 1]);
  assert.deepEqual([...new Set(frames)].sort((a, b) => a - b), [0, 30000]);
  assert.equal(still.timeline.filter((t) => t.table.length > 0).length, 12);

  const doc = readFileSync("docs/fight3d-animation-census.md", "utf8");
  for (const line of [
    `${folders.length} battle model packs`,
    `${present.get(18)} packs carry all 18 action clips`,
    `${present.get(6)} packs carry exactly 6`,
    `${never.length} of the 62 timeline tables`,
    "m466rgn2: total_frames 0",
  ]) {
    assert.ok(doc.includes(line), `the census note says "${line}"`);
  }
  for (const folder of ["m468agnm", "m469garm", "m470agry"]) {
    assert.ok(doc.includes(folder), `the census note names ${folder}`);
  }
});

test("the panel wraps its text and every page carries its title, body and evidence", () => {
  const lines = cutContentLines(0);
  assert.equal(lines.title, CUT_CONTENT[0].title);
  assert.equal(lines.evidence, `Evidence: ${CUT_CONTENT[0].evidence}`);
  assert.equal(lines.body.join(" "), CUT_CONTENT[0].body);
  assert.equal(lines.page, 1);
  assert.equal(lines.pages, 7);
  assert.deepEqual(wrapText("one two three four", 8), ["one two", "three", "four"]);
  assert.deepEqual(wrapText("", 8), []);
});

test("the page owns the pad: Cross or Start closes it, Left and Right page through all seven", () => {
  tickCutContent(false);
  assert.equal(cutContentOpen(), false);
  openCutContent();
  assert.equal(cutContentOpen(), true);
  assert.equal(cutContentPage(), 0);

  assert.equal(cutContentPress("right"), true);
  assert.equal(cutContentPage(), 1);
  assert.equal(cutContentPress("left"), true);
  assert.equal(cutContentPage(), 0);
  assert.equal(cutContentPress("left"), true);
  assert.equal(cutContentPage(), 6, "Left from the first page wraps to the last");
  assert.equal(cutContentPress("up"), true, "every press is consumed while the page is up");

  assert.equal(cutContentPress("cross"), true);
  assert.equal(cutContentOpen(), false);
  assert.equal(cutContentPress("up"), false, "with the page closed the field gets the press again");

  openCutContent();
  cutContentPress("start");
  assert.equal(cutContentOpen(), false, "Start closes it too");
  tickCutContent(false);
});

test("the switch never opens the page; the button does; Cross closes; the switch off closes", () => {
  tickCutContent(false);
  assert.equal(cutContentOpen(), false);
  tickCutContent(true);
  assert.equal(cutContentOpen(), false, "switch on at load: not open");
  openCutContent();
  assert.equal(cutContentOpen(), true, "the F2 button opens it");
  cutContentPress("cross");
  assert.equal(cutContentOpen(), false, "Escape (cross) closes it");
  tickCutContent(true);
  assert.equal(cutContentOpen(), false, "still on: it does not reopen");
  tickCutContent(false);
  tickCutContent(true);
  assert.equal(cutContentOpen(), false, "a new off -> on edge does not open it");
  openCutContent();
  tickCutContent(false);
  assert.equal(cutContentOpen(), false, "switching the setting off closes it");
});

test("the F2 row, the EXPERIMENTAL default and the game hook are all in place", () => {
  const ambience = readFileSync("web/ambience.js", "utf8");
  assert.ok(ambience.includes('["cutcontent", "Cut-content gallery (dev)"]'), "the Extras row has the pair");
  assert.match(ambience, /const EXPERIMENTAL = \[[^\]]*"cutcontent"/, "cutcontent is off until switched on");

  const game = readFileSync("web/game.js", "utf8");
  assert.match(game, /__fx\?\.cutcontent/, "the game reads the F2 flag");
  assert.match(game, /tickCutContent\(window\.__fx\?\.cutcontent/, "the game ticks the page from the flag");
  assert.match(game, /cutContentPress\(k\)/, "the game gives the page first claim on the pad");
  assert.match(game, /cutContentDraw\(ctx, VIEW_W, VIEW_H\)/, "the game draws the page");
});
