// The developers' own 62 battle animation names — the clip glossary the game never printed
// (web/fight/clip-names.js, and the fifth Digimon Codex tab in web/codex.js).
//
// Source of the names and the id arithmetic: ddw3-walker
// docs/research/battle/scene-test-tool-wfightts-2026-08-05.md. The tool's clip picker is a
// 62-entry list; it passes source-index + 1 as the engine animation id, so clip id 1..62
// maps to timeline table 0..61. The names are typed in as facts (the label image is
// Shift-JIS; the tool spells them with fullwidth digits and a fullwidth minus); the pack
// counts beside them are computed here from the 249 shipped anim.json packs, never typed.
//
// F2 -> Extras -> "Digimon Codex (new)" (off by default). The Clips tab rides that switch;
// with it off no page exists and the canvas gets no call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import {
  CLIP_NAMES_62,
  CLIP_ID_CAVEAT,
  PACK_COUNTS,
  PACK_TOTAL,
  clipFamily,
  clipLabel,
  packCountsFrom,
} from "../web/fight/clip-names.js";
import {
  codexCursor,
  codexDraw,
  codexPageCount,
  codexPageRows,
  codexPress,
  codexReset,
  codexRows,
  codexTab,
  setCodexData,
  tickCodex, openCodex,
} from "../web/codex.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE_PACKS = existsSync(path.join(MODELS, "index.json"));
const skip = HAVE_PACKS ? false : "model packs are not installed";

/** A recording 2D context: enough of the canvas API for codexDraw, and a text log. */
function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect() { calls.push(["fillRect"]); },
    strokeRect() { calls.push(["strokeRect"]); },
    fillText(text) { calls.push(["fillText", String(text)]); },
    set font(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set textBaseline(v) {}, set textAlign(v) {},
  };
  return ctx;
}
const drawnText = (ctx) => ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]).join("\n");

/** Every pack's parsed anim.json, the same files the battle plays. */
function readPacks() {
  const folders = readdirSync(MODELS).filter((d) => statSync(path.join(MODELS, d)).isDirectory());
  return {
    folders,
    anims: folders.map((f) => JSON.parse(readFileSync(path.join(MODELS, f, "anim.json"), "utf8"))),
  };
}

test("the glossary is 62 rows: ids 1..62 once, table = id - 1, a name and a family each", () => {
  assert.equal(CLIP_NAMES_62.length, 62);
  assert.deepEqual(CLIP_NAMES_62.map((r) => r.id), Array.from({ length: 62 }, (_, i) => i + 1));
  for (const row of CLIP_NAMES_62) {
    assert.equal(row.table, row.id - 1, `clip ${row.id} reads table ${row.id - 1}`);
    assert.equal(typeof row.jp, "string");
    assert.ok(row.jp.length > 0, `clip ${row.id} has the tool's own name`);
    assert.equal(typeof row.en, "string");
    assert.ok(row.en.length > 0, `clip ${row.id} has a plain-English gloss`);
    assert.equal(typeof row.family, "string");
    assert.ok(row.family.length > 0, `clip ${row.id} belongs to a group`);
    assert.ok(Number.isInteger(row.packs) && row.packs >= 0 && row.packs <= PACK_TOTAL);
  }
  // the ends of the list, spelled as the label image spells them
  assert.equal(CLIP_NAMES_62[0].jp, "ウェイト−０");
  assert.equal(CLIP_NAMES_62[0].en, "wait (still)");
  assert.equal(CLIP_NAMES_62[61].jp, "ジョグレス−５");
  assert.equal(CLIP_NAMES_62[61].table, 61);
});

test("the thirteen groups add up to 62: wait 2, guard 1, damage 7, dead 1, get-up 1, victory 1, anger 1, fight 6, combo 18, the two ワ:マ lines 6+6, hissatsu 6, jogres 6", () => {
  const count = (family) => CLIP_NAMES_62.filter((r) => r.family === family).length;
  assert.deepEqual(
    {
      wait: count("wait"),
      guard: count("guard"),
      damage: count("damage"),
      dead: count("dead"),
      "get-up": count("get-up"),
      victory: count("victory"),
      anger: count("anger"),
      fight: count("fight"),
      combo: count("combo"),
      "ワ：マ：ウ": count("ワ：マ：ウ"),
      "ワ：マ：カ": count("ワ：マ：カ"),
      hissatsu: count("hissatsu"),
      jogres: count("jogres"),
    },
    {
      wait: 2, guard: 1, damage: 7, dead: 1, "get-up": 1, victory: 1, anger: 1,
      fight: 6, combo: 18, "ワ：マ：ウ": 6, "ワ：マ：カ": 6, hissatsu: 6, jogres: 6,
    },
  );
  // every row belongs to one of those thirteen groups
  const families = new Set(CLIP_NAMES_62.map((r) => r.family));
  assert.equal(families.size, 13);
  // the group boundaries the id list makes
  assert.equal(clipFamily(1), "wait");
  assert.equal(clipFamily(2), "wait");
  assert.equal(clipFamily(3), "guard");
  assert.equal(clipFamily(4), "damage");
  assert.equal(clipFamily(10), "damage");
  assert.equal(clipFamily(11), "dead");
  assert.equal(clipFamily(12), "get-up");
  assert.equal(clipFamily(13), "victory");
  assert.equal(clipFamily(14), "anger");
  assert.equal(clipFamily(15), "fight");
  assert.equal(clipFamily(20), "fight");
  assert.equal(clipFamily(21), "combo");
  assert.equal(clipFamily(38), "combo");
  assert.equal(clipFamily(39), "ワ：マ：ウ");
  assert.equal(clipFamily(44), "ワ：マ：ウ");
  assert.equal(clipFamily(45), "ワ：マ：カ");
  assert.equal(clipFamily(50), "ワ：マ：カ");
  assert.equal(clipFamily(51), "hissatsu");
  assert.equal(clipFamily(56), "hissatsu");
  assert.equal(clipFamily(57), "jogres");
  assert.equal(clipFamily(62), "jogres");
  // outside the list there is no group, never a guess
  assert.equal(clipFamily(0), null);
  assert.equal(clipFamily(63), null);
  assert.equal(clipFamily("5"), null);
});

test("the pack counts are the real 249 packs, table by table (skipped when assets are absent)", { skip }, () => {
  const { folders, anims } = readPacks();
  assert.equal(folders.length, PACK_TOTAL, "249 model packs");
  const counts = packCountsFrom(anims);
  assert.equal(counts.length, 62);
  // the module's typed numbers ARE the packs' numbers
  assert.deepEqual(PACK_COUNTS, counts);
  assert.deepEqual(CLIP_NAMES_62.map((r) => r.packs), counts);
  // the anchors the research doc's id list makes
  assert.equal(counts[0], 249, "table 0 (WAIT-0) is on every pack");
  assert.equal(counts[12], 249, "table 12 (VICTORY-POSE) is on every pack");
  assert.equal(counts[56], 10, "table 56 (JOGRESS-0) is on ten packs");
  assert.equal(counts[57], 4, "table 57 (JOGRESS-1) is on four packs");
  assert.equal(counts[58], 1, "table 58 (JOGRESS-2) is on one pack");
  // exactly these tables no pack authors
  const never = counts.map((c, table) => (c === 0 ? table : null)).filter((t) => t !== null);
  assert.deepEqual(never, [7, 8, 9, 41, 42, 43, 46, 47, 48, 49, 59, 60, 61]);
  // and every row's packs is that table's count
  for (const row of CLIP_NAMES_62) assert.equal(row.packs, counts[row.table], `clip ${row.id}`);
});

test("packCountsFrom counts a table as authored only when the pack's timeline entry carries frames", () => {
  const pack = (tables) => ({ timeline: tables.map((n) => (n ? { table: new Array(n).fill({ value: 0 }) } : { table: [] })) });
  const counts = packCountsFrom([pack([1, 0, 2]), pack([1, 1, 0]), { timeline: [] }, null]);
  assert.equal(counts.length, 62);
  assert.equal(counts[0], 2);
  assert.equal(counts[1], 1);
  assert.equal(counts[2], 1);
  assert.equal(counts[3], 0);
  // an empty input is 62 zeroes, never a guess or a short array
  assert.deepEqual(packCountsFrom([]), new Array(62).fill(0));
  assert.deepEqual(packCountsFrom(null), new Array(62).fill(0));
});

test("clipLabel names the 18 battle action slots; anything else says its own number", () => {
  assert.equal(clipLabel(0), "idle");
  assert.equal(clipLabel(1), "multi-hit contact");
  assert.equal(clipLabel(2), "survive");
  assert.equal(clipLabel(3), "death");
  assert.equal(clipLabel(4), "evade");
  assert.equal(clipLabel(5), "basic attack");
  assert.equal(clipLabel(6), "combo 2");
  assert.equal(clipLabel(7), "combo 3");
  assert.equal(clipLabel(8), "combo 4");
  assert.equal(clipLabel(9), "cast");
  assert.equal(clipLabel(10), "item use");
  assert.equal(clipLabel(11), "signature");
  assert.equal(clipLabel(12), "DNA presentation");
  assert.equal(clipLabel(13), "second cast");
  for (const n of [14, 15, 16, 17]) assert.equal(clipLabel(n), "typed item arm");
  assert.equal(clipLabel(18), "clip 18");
  assert.equal(clipLabel(-1), "clip -1");
  assert.equal(clipLabel(99), "clip 99");
});

test("the two research pages import the one clip-label table and keep none of their own", () => {
  for (const file of ["web/sound-audit.js", "web/anim-viewer-data.js"]) {
    const src = read(file);
    assert.match(src, /import \{ clipLabel \} from "\.\/fight\/clip-names\.js";/, `${file} imports clipLabel`);
    assert.ok(!/CLIP_LABELS/.test(src), `${file} keeps no local label table`);
  }
  // the sound page really prints the shared labels
  const sound = read("web/sound-audit.js");
  assert.ok(sound.includes("clipLabel(clip)"), "the sound audit names its clips through the shared table");
  // the animation viewer uses it for the item action it always offers
  const viewer = read("web/anim-viewer-data.js");
  assert.ok(viewer.includes("clipLabel(10)"), "the viewer's item action is named through the shared table");
});

test("the model viewer's inline labels carry the known corrections", () => {
  const html = read("web/model-viewer.html");
  assert.ok(html.includes('5: "basic attack"'), "clip 5 is the basic attack, not ??");
  assert.ok(html.includes('10: "item use"'), "clip 10 is the item use, not hit");
  assert.ok(html.includes('11: "signature"'), "clip 11 is the signature");
  assert.ok(html.includes('13: "second cast family"'), "clip 13 is the second cast family");
  assert.ok(html.includes('15: "typed item arm"'), "clip 15 is a typed item arm");
  assert.ok(html.includes('16: "typed item arm"'), "clip 16 is a typed item arm");
  // the debug vocabulary in battle3d.js is a different list; it is not touched
  assert.ok(!/clip-names/.test(read("web/battle3d.js")), "battle3d.js keeps its own debug names");
});

test("the Clips tab rides the codex switch: off draws nothing, on shows all 62 names with tables, pack counts and the caveat", () => {
  const disc = JSON.parse(read("web/assets/data/digimon.json"));
  const evolutions = JSON.parse(read("web/assets/data/evolutions.json"));
  codexReset();
  const offCtx = fakeCtx();
  assert.equal(tickCodex(false), false);
  assert.equal(codexDraw(offCtx, 0), false);
  assert.equal(offCtx.calls.length, 0, "with the switch off the canvas gets no call");

  setCodexData(disc, evolutions); // no enemy/finder tables: those two tabs are skipped
  openCodex();
  for (let i = 0; i < 5 && codexTab() !== "clips"; i++) codexPress("r1");
  assert.equal(codexTab(), "clips", "the fifth tab is reachable from the pad");
  assert.equal(codexRows().length, 62);
  assert.equal(codexPageCount(), 3, "62 rows over pages of 24");
  assert.equal(codexRows()[0].jp, "ウェイト−０");

  const ctx = fakeCtx();
  assert.equal(codexDraw(ctx), true);
  const text = drawnText(ctx);
  for (const part of [
    "CLIPS",
    "ウェイト−０",
    "タタカウ−０",
    "t0",
    "249/249",
    "1 / 3",
    "list position + 1",
    "SCENE-Q002",
    "needs_evidence",
    "engine id 1",
  ]) {
    assert.ok(text.includes(part), `the page carries "${part}"`);
  }
  // the caveat is the module's own sentence
  assert.ok(text.includes(CLIP_ID_CAVEAT.slice(0, 40)), "the header prints the module's caveat");

  // the last page, the last row: JOGRESS-5, table 61, authored by no pack
  codexPress("right");
  codexPress("right");
  assert.equal(codexCursor(), 0);
  for (let i = 0; i < 13; i++) codexPress("down");
  const lastRow = codexPageRows()[codexCursor()];
  assert.equal(lastRow.id, 62);
  const lastCtx = fakeCtx();
  codexDraw(lastCtx);
  const lastText = drawnText(lastCtx);
  assert.ok(lastText.includes("ジョグレス−５"));
  assert.ok(lastText.includes("t61"));
  assert.ok(lastText.includes("0/249"));
  assert.ok(lastText.includes("engine id 62"));
  assert.ok(lastText.includes("0 of the 249"), "the detail says no pack authors this table");
  assert.ok(lastText.includes("3 / 3"));
  tickCodex(false);
});
