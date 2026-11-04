// The Digimon Codex, part 1: the book and the partner pages (web/codex.js).
//
// The book lists every partner profile the game can hold: the disc's 55, plus the 135
// enemy-only species web/extra-roster.js merges into digimon.json at runtime. Every number
// on the page is read from the same tables the battle reads, never hand-written here.
//
// F2 -> Extras -> "Digimon Codex (new)" (off by default). With the toggle off there is no
// page, no key handling and no store write.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeDigimon, mergeEvolutions } from "../web/extra-roster.js";
import {
  partnerRows,
  lineTargets,
  codexPages,
  codexLoad,
  codexReset,
  codexOpen,
  codexPageIndex,
  codexCursor,
  codexPageRows,
  tickCodex,
  codexPress,
  codexDraw,
} from "../web/codex.js";

const disc = JSON.parse(readFileSync("web/assets/data/digimon.json", "utf8"));
const evolutions = JSON.parse(readFileSync("web/assets/data/evolutions.json", "utf8"));
const extra = JSON.parse(readFileSync("web/assets/data/extra_species.json", "utf8"));
const mergedDisc = mergeDigimon(disc, extra);
const mergedEvolutions = mergeEvolutions(evolutions, extra);

/** The fake fetchJson a node test hands codexLoad: returns the parsed tables, no network. */
const fakeFetch = async (url) =>
  /evolutions\.json/.test(url) ? mergedEvolutions : mergedDisc;

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

test("the disc's 55 partner profiles, and exactly the eight starters", () => {
  const rows = partnerRows(disc, disc.skills);
  assert.equal(rows.length, 55);
  assert.equal(rows.filter((r) => r.is_starter).length, 8);
  assert.deepEqual(
    rows.filter((r) => r.is_starter).map((r) => r.name),
    ["Kotemon", "Kumamon", "Monmon", "Agumon", "Veemon", "Guilmon", "Renamon", "Patamon"],
  );
  // every disc row is a disc species, none is flagged added
  assert.ok(rows.every((r) => r.added === false));
});

test("the merged roster is 190 rows and Kunemon (id 56) is flagged added", () => {
  const rows = partnerRows(mergedDisc, disc.skills);
  assert.equal(rows.length, 190);
  const kunemon = rows.find((r) => r.id === 56);
  assert.ok(kunemon, "Kunemon is row 56");
  assert.equal(kunemon.name, "Kunemon");
  assert.equal(kunemon.added, true);
  assert.equal(rows.filter((r) => r.added).length, 135);
});

test("Kotemon's page carries the battle's own numbers: family 1, three resistances, Hot Head, five Blasts", () => {
  const rows = partnerRows(disc, disc.skills);
  const k = rows.find((r) => r.id === 1);
  assert.equal(k.name, "Kotemon");
  assert.equal(k.family, 1);
  assert.equal(k.resistances.fire, 85);
  assert.equal(k.resistances.water, 125);
  assert.equal(k.resistances.thunder, 115);
  assert.equal(k.resistances.ice, 80);
  assert.equal(k.resistances.wind, 80);
  assert.equal(k.resistances.machine, 100);
  assert.equal(k.resistances.dark, 95);
  // the six core stats and HP/MP, straight from the profile
  assert.deepEqual(k.stats, { str: 48, def: 44, spt: 41, wis: 34, spd: 33, chr: 1 });
  assert.equal(k.hp, 150);
  assert.equal(k.mp, 100);
  assert.equal(k.signature.id, 53);
  assert.equal(k.signature.name, "Hot Head");
  assert.equal(k.signature.power, 75);
  assert.equal(k.signature.element, "fire");
  assert.deepEqual(k.blasts, ["Dinohumon", "Kyukimon", "GuardiAngemon", "GranKuwagamon", "MaloMyotismon"]);
  // seven resistances and five status resistances
  assert.equal(Object.keys(k.resistances).length, 7);
  assert.equal(Object.keys(k.statusResist).length, 5);
  assert.equal(k.statusResist.poison, 50);
});

test("a line's records resolve to real profile names: 44 on the disc, 179 after the merge", () => {
  const profiles = disc.digimon;
  const names = lineTargets(evolutions, 0, profiles);
  assert.equal(names.length, 44);
  assert.equal(new Set(names).size, 44);
  const real = new Set(profiles.map((p) => p.name));
  for (const n of names) assert.ok(real.has(n), `${n} is a real profile name`);
  assert.equal(names[0], "Dinohumon");
  // the whole digimon.json object is accepted too
  assert.deepEqual(lineTargets(evolutions, 0, disc), names);

  const merged = lineTargets(mergedEvolutions, 0, mergedDisc);
  assert.equal(merged.length, 179);
  assert.equal(new Set(merged).size, 179);
  assert.equal(merged[44], "Kunemon");
  // a slot the data does not have is an empty list, never a guessed line
  assert.deepEqual(lineTargets(evolutions, 99, profiles), []);
});

test("codexPages cuts 190 rows into 8 pages of 24, the last one holding the rest, no blank rows", () => {
  const rows = partnerRows(mergedDisc, disc.skills);
  const pages = codexPages(rows, 24);
  assert.equal(pages.length, 8);
  for (const p of pages) assert.ok(p.length > 0, "no empty page");
  for (let i = 0; i < 7; i++) assert.equal(pages[i].length, 24);
  assert.equal(pages[7].length, 22);
  assert.deepEqual(pages.flat(), rows, "every row appears exactly once, in order");
  assert.ok(pages.flat().every((r) => r && typeof r.name === "string"), "no blank row anywhere");
  // the default is the same 24
  assert.equal(codexPages(rows).length, 8);
});

test("the F2 switch is in ambience.js's Extras row and EXPERIMENTAL, so it starts off", () => {
  const src = readFileSync("web/ambience.js", "utf8");
  assert.ok(src.includes('["codex", "Digimon Codex (new)"]'), "the Extras pair is present");
  const experimental = src.match(/const EXPERIMENTAL = \[([^\]]*)\]/);
  assert.ok(experimental, "EXPERIMENTAL is a literal list");
  assert.ok(/"codex"/.test(experimental[1]), "codex is experimental (off until switched on)");
  // nothing in part 1 writes a store: the page is read-only
  const codex = readFileSync("web/codex.js", "utf8");
  assert.ok(!/localStorage/.test(codex), "part 1 stores nothing");
});

test("game.js gates the book on window.__fx?.codex and hooks it like the Cut-Content Gallery", () => {
  const src = readFileSync("web/game.js", "utf8");
  assert.match(src, /tickCodex\(window\.__fx\?\.codex === true\)/);
  assert.match(src, /if \(codexPress\(k\)\)/);
  assert.match(src, /if \(codexOpen\(\)\) return;/);
  assert.match(src, /codexDraw\(ctx/);
});

test("with the toggle off tickCodex opens nothing and codexDraw draws nothing", () => {
  codexReset();
  const ctx = fakeCtx();
  assert.equal(tickCodex(false), false);
  assert.equal(codexOpen(), false);
  assert.equal(codexPress("right"), false, "closed book swallows no press");
  assert.equal(codexDraw(ctx, 0), false);
  assert.equal(ctx.calls.length, 0, "no canvas call at all");
});

test("the page opens on the toggle's rising edge and pages/cursors/close from the pad", async () => {
  codexReset();
  await codexLoad(fakeFetch);
  assert.equal(tickCodex(true), true);
  assert.equal(codexOpen(), true);
  // first page, first row
  assert.equal(codexPress("down"), true);
  // Right/Left page (wrapping around the eight pages)
  codexPress("right");
  codexPress("left");
  codexPress("left");
  // Cross closes; Start closes too
  codexPress("cross");
  assert.equal(codexOpen(), false);
  // the setting staying on does not reopen it; turn it off and on again to reopen
  tickCodex(true);
  assert.equal(codexOpen(), false, "Cross does not reopen while the switch stays on");
  tickCodex(false);
  assert.equal(tickCodex(true), true);
  codexPress("start");
  assert.equal(codexOpen(), false);
  tickCodex(false);
});

test("an open book draws Kotemon's real numbers on its page", async () => {
  codexReset();
  await codexLoad(fakeFetch);
  tickCodex(true);
  const ctx = fakeCtx();
  assert.equal(codexDraw(ctx, 0), true);
  const text = drawnText(ctx);
  assert.match(text, /DIGIMON CODEX/);
  assert.match(text, /Kotemon/);
  assert.match(text, /Hot Head/);
  assert.match(text, /Dinohumon/);
  assert.match(text, /1 \/ 8/, "the page counter says where you are");
  // the list on page one is the first 24 profiles, not all 190
  const listNames = ["Kotemon", "Kumamon", "Monmon", "Agumon", "Veemon", "Guilmon", "Renamon", "Patamon", "Dinohumon"];
  for (const n of listNames) assert.ok(text.includes(n), `page one lists ${n}`);
  assert.ok(!text.includes("Kunemon"), "row 56 is not on page one");
  tickCodex(false);
});

test("the debug hook publishes the current page (source), and the page/cursor getters answer it", async () => {
  codexReset();
  await codexLoad(fakeFetch);
  tickCodex(true);
  assert.equal(codexPageIndex(), 0);
  codexPress("down");
  codexPress("down");
  assert.equal(codexCursor(), 2);
  codexPress("right");
  assert.equal(codexPageIndex(), 1);
  codexPress("left");
  assert.equal(codexPageIndex(), 0);
  assert.equal(codexPageRows()[2].name, "Monmon");
  const src = readFileSync("web/codex.js", "utf8");
  assert.match(src, /window\.__codex/);
  assert.match(src, /page: \(\) =>/);
  assert.ok(globalThis.window === undefined, "codex.js imported without a DOM");
  tickCodex(false);
});
