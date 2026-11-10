// The Next Forms planner — the forms a partner can still learn, and exactly what each
// one is waiting for (web/evolution-planner.js).
//
// The Digimon Lab only draws rows whose first form is already learned, so every next
// step in a line is invisible until it fires. This page lists a roster slot's line in
// table order and shows, for each record, the target form, the two form-level
// requirements with current/target, the one extra gate in plain words (a core stat, the
// partner's level, or one of the seven elements) and a READY badge when every condition
// passes now — that record is the one the next battle report learns.
//
// F2 -> Extras -> "Next forms planner (new)" (off by default). With the switch off there
// is no page, no key handling and no fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeDigimon, mergeEvolutions } from "../web/extra-roster.js";
import {
  plannerRows,
  requirementText,
  readyNow,
  plannerLoad,
  plannerReset,
  setPlannerData,
  tickPlanner, openPlanner,
  plannerPress,
  plannerDraw,
  plannerOpen,
  plannerRowsNow,
  plannerCursor,
  plannerSelection,
} from "../web/evolution-planner.js";

const digimon = JSON.parse(readFileSync("web/assets/data/digimon.json", "utf8"));
const evolutions = JSON.parse(readFileSync("web/assets/data/evolutions.json", "utf8"));
const extra = JSON.parse(readFileSync("web/assets/data/extra_species.json", "utf8"));
const profiles = digimon.digimon;
const skills = digimon.skills;
const mergedEvolutions = mergeEvolutions(evolutions, extra);
const mergedDigimon = mergeDigimon(digimon, extra);
const mergedProfiles = mergedDigimon.digimon;
const nameOf = new Map(profiles.map((p) => [p.id, p.name]));

const emptyLive = () => ({ formLevels: {}, level: 1, stats: { stats: {}, bonuses: {}, elemBonuses: {} } });
const liveFor = ({ levels = {}, level = 1, stats = {}, bonuses = {}, elements = {} }) => ({
  formLevels: levels,
  level,
  stats: { stats, bonuses, elemBonuses: elements },
});

/** The fake fetch a node test hands plannerLoad: the parsed tables, no network. */
const fakeFetch = async (url) =>
  /evolutions\.json/.test(url) ? evolutions : digimon;

/** A recording 2D context: enough of the canvas API for plannerDraw, and a text log. */
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

test("the shipped file gives eight lines of 44 records: 352 rows, 44 distinct forms on line 0", () => {
  let total = 0;
  for (let slot = 0; slot < 8; slot++) {
    const rows = plannerRows(evolutions, slot, profiles, skills, emptyLive());
    assert.equal(rows.length, 44, `roster slot ${slot} has 44 records`);
    total += rows.length;
  }
  assert.equal(total, 352);
  const first = plannerRows(evolutions, 0, profiles, skills, emptyLive());
  assert.equal(new Set(first.map((r) => r.to)).size, 44, "44 distinct target forms");
  assert.equal(new Set(first.map((r) => r.name)).size, 44, "each form has a real name");
  assert.equal(first[0].name, "Dinohumon");
  for (const row of first) {
    assert.equal(typeof row.to, "number");
    assert.equal(typeof row.name, "string");
    assert.equal(typeof row.ready, "boolean");
    assert.ok(Array.isArray(row.unmet), "unmet is always a list");
    assert.equal(typeof row.text, "string");
  }
  // a slot the data does not have is an empty page, never a guessed line
  assert.deepEqual(plannerRows(evolutions, 99, profiles, skills, emptyLive()), []);
});

test("47 records carry two form requirements — the six DNA results", () => {
  const twoReq = [];
  for (const line of evolutions.lines) for (const record of line.records) if (record.req1) twoReq.push(record);
  assert.equal(twoReq.length, 47);
  const dna = [...new Set(twoReq.map((r) => nameOf.get(r.to)))].sort();
  assert.deepEqual(dna, [
    "Beelzemon", "Diaboromon", "GranKuwagamon", "Imperialdramon-P", "Omnimon", "Paildramon",
  ]);
});

test("no shipped record uses kind 6: the unlock never asks for CHR", () => {
  let count = 0;
  for (const line of evolutions.lines) for (const record of line.records) if (Number(record.kind) === 6) count++;
  assert.equal(count, 0);
});

test("requirementText names both form requirements and maps every extra kind to plain words", () => {
  // Line 0's third record: Grizzmon needs Growlmon at form level 30 and SPD 280.
  const grizzmon = { to: 11, req0: 14, req0Level: 30, req1: 0, req1Level: 1, kind: 5, threshold: 280 };
  const text = requirementText(grizzmon, profiles);
  assert.equal(text.reqs.length, 1);
  assert.equal(text.reqs[0].id, 14);
  assert.equal(text.reqs[0].name, "Growlmon");
  assert.equal(text.reqs[0].level, 30);
  assert.match(text.reqs[0].text, /Growlmon L30/);
  assert.match(text.text, /Growlmon L30/);
  assert.match(text.text, /SPD 280/);
  assert.equal(text.gate.label, "SPD");
  // the digimon.json object is accepted as well as the bare profile array
  assert.deepEqual(requirementText(grizzmon, digimon), text);

  // kind 7 is the partner's own battle level
  const level = requirementText({ req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 7, threshold: 5 }, profiles);
  assert.match(level.text, /partner level 5/);
  assert.equal(level.gate.key, "level");
  // kind 8..14 are the seven elements, kind 8 being Fire
  const fire = requirementText({ req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 8, threshold: 200 }, profiles);
  assert.match(fire.text, /Fire 200/);
  assert.equal(fire.gate.key, "fire");
  // kind 0 is no extra gate
  const none = requirementText({ req0: 14, req0Level: 20, req1: 0, req1Level: 1, kind: 0, threshold: 1 }, profiles);
  assert.equal(none.gate.text, "none");
  assert.equal(none.text, "Growlmon L20");
  assert.equal(requirementText({ req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 0, threshold: 1 }, profiles).text, "none");

  // a two-requirement record names both source forms
  const paildramon = requirementText({ to: 25, req0: 13, req0Level: 5, req1: 18, req1Level: 5, kind: 0, threshold: 1 }, profiles);
  assert.deepEqual(paildramon.reqs.map((r) => r.name), ["ExVeemon", "Stingmon"]);
  assert.match(paildramon.text, /ExVeemon L5 \+ Stingmon L5/);
});

test("readyNow mirrors the unlock rule: both form levels, then the one extra gate", () => {
  const grizzmon = { to: 11, req0: 14, req0Level: 30, req1: 0, req1Level: 1, kind: 5, threshold: 280 };
  assert.equal(readyNow(grizzmon, liveFor({ levels: { 14: 29 }, stats: { spd: 280 } })), false, "29/30 is one short");
  assert.equal(readyNow(grizzmon, liveFor({ levels: { 14: 30 }, stats: { spd: 280 } })), true, "30/30 with SPD 280");
  assert.equal(readyNow(grizzmon, liveFor({ levels: { 14: 30 }, stats: { spd: 279 } })), false, "SPD 279/280 is one short");
  assert.equal(readyNow(grizzmon, liveFor({ levels: { 14: 30 }, stats: { spd: 200 }, bonuses: { spd: 80 } })), true, "stat chips count");
  assert.equal(readyNow(grizzmon, liveFor({ levels: {}, stats: { spd: 280 } })), false, "a missing requirement form is unmet, never ignored");
  assert.equal(readyNow(grizzmon, liveFor({ levels: { 14: 0 }, stats: { spd: 280 } })), false, "level 0 is not a learned form");

  // a DNA record needs both forms present
  const paildramon = { to: 25, req0: 13, req0Level: 5, req1: 18, req1Level: 5, kind: 0, threshold: 1 };
  assert.equal(readyNow(paildramon, liveFor({ levels: { 13: 5 } })), false);
  assert.equal(readyNow(paildramon, liveFor({ levels: { 13: 5, 18: 4 } })), false);
  assert.equal(readyNow(paildramon, liveFor({ levels: { 13: 5, 18: 5 } })), true);

  // kind 7 reads the line's own battle level
  const level = { req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 7, threshold: 5 };
  assert.equal(readyNow(level, liveFor({ level: 4 })), false);
  assert.equal(readyNow(level, liveFor({ level: 5 })), true);

  // kinds 8..14 read the element points the browser unlock reads
  const fire = { req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 8, threshold: 200 };
  assert.equal(readyNow(fire, liveFor({ elements: { fire: 199 } })), false);
  assert.equal(readyNow(fire, liveFor({ elements: { fire: 200 } })), true);

  // kind 6 is CHR, a real gate even though no shipped record uses it
  const chr = { req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 6, threshold: 10 };
  assert.equal(readyNow(chr, liveFor({ stats: { chr: 10 } })), true);
  assert.equal(readyNow(chr, liveFor({ stats: { str: 99, chr: 9 } })), false);
});

test("plannerRows hides a record whose target form is already in the ledger and keeps table order", () => {
  const all = plannerRows(evolutions, 0, profiles, skills, emptyLive());
  const rows = plannerRows(evolutions, 0, profiles, skills, liveFor({ levels: { 9: 1 } }));
  assert.equal(all.length, 44);
  assert.equal(rows.length, 43, "the unlock skips a form already learned");
  assert.ok(!rows.some((r) => r.to === 9), "Dinohumon is already in the ledger");
  const expected = evolutions.lines[0].records.filter((r) => r.to !== 9).map((r) => r.to);
  assert.deepEqual(rows.map((r) => r.to), expected, "the rest stays in table order");
});

test("a row shows current/target for every gate and READY only when all of them pass", () => {
  const waiting = plannerRows(evolutions, 0, profiles, skills, liveFor({ levels: { 14: 22 }, stats: { spd: 150 } }));
  const grizzmon = waiting.find((r) => r.to === 11);
  assert.equal(grizzmon.name, "Grizzmon");
  assert.equal(grizzmon.ready, false);
  assert.deepEqual(grizzmon.unmet, ["Growlmon 22/30", "SPD 150/280"]);
  assert.match(grizzmon.text, /Growlmon 22\/30/);
  assert.match(grizzmon.text, /SPD 150\/280/);
  assert.ok(!/READY/.test(grizzmon.text));

  const ready = plannerRows(evolutions, 0, profiles, skills, liveFor({ levels: { 14: 30 }, stats: { spd: 280 } }));
  const hit = ready.find((r) => r.to === 11);
  assert.equal(hit.ready, true);
  assert.deepEqual(hit.unmet, []);
  assert.match(hit.text, /READY/);
  assert.match(hit.text, /Growlmon 30\/30/);
  assert.match(hit.text, /SPD 280\/280/);
});

test("the runtime merge adds 135 records per line: 179 rows with no code change", () => {
  const rows = plannerRows(mergedEvolutions, 0, mergedProfiles, skills, emptyLive());
  assert.equal(rows.length, 179);
  assert.equal(rows[44].name, "Kunemon");
  assert.equal(new Set(rows.map((r) => r.name)).size, 179);
  // a whole line appended at a new slot is found by its `slot`, not by array position
  const appended = { lines: [...evolutions.lines, { slot: 8, digimonId: 9, records: mergedEvolutions.lines[0].records.slice(0, 3) }] };
  assert.equal(plannerRows(appended, 8, profiles, skills, emptyLive()).length, 3);
});

test("the F2 switch is the Extras pair and EXPERIMENTAL, so it starts off", () => {
  const src = readFileSync("web/ambience.js", "utf8");
  assert.ok(src.includes('["planner", "Next forms planner (new)"]'), "the Extras pair is present");
  const experimental = src.match(/const EXPERIMENTAL = \[([^\]]*)\]/);
  assert.ok(experimental, "EXPERIMENTAL is a literal list");
  assert.ok(/"planner"/.test(experimental[1]), "planner is experimental (off until switched on)");
});

test("game.js gates the page on window.__fx?.planner and hooks it like the Codex", () => {
  const src = readFileSync("web/game.js", "utf8");
  assert.match(src, /tickPlanner\(window\.__fx\?\.planner === true/);
  assert.match(src, /if \(plannerPress\(k\)\)/);
  assert.match(src, /if \(plannerOpen\(\)\) return;/);
  assert.match(src, /plannerDraw\(ctx/);
  assert.match(src, /window\.__planner/);
  // read-only page: nothing in it or its hook writes a store
  const planner = readFileSync("web/evolution-planner.js", "utf8");
  assert.ok(!/localStorage/.test(planner), "the planner stores nothing");
});

test("with the switch off the page is closed, swallows no press and draws nothing", () => {
  plannerReset();
  assert.equal(tickPlanner(false, () => ({ members: [] })), false);
  assert.equal(plannerOpen(), false);
  assert.equal(plannerPress("right"), false, "a closed page swallows no press");
  const ctx = fakeCtx();
  assert.equal(plannerDraw(ctx), false);
  assert.equal(ctx.calls.length, 0, "no canvas call at all");
});

test("the toggle never opens the page, the button does, and it lists the partner's next forms", async () => {
  plannerReset();
  await plannerLoad(fakeFetch);
  const members = [
    { slot: 0, name: "Kotemon", live: liveFor({ levels: { 14: 30 }, level: 5, stats: { spd: 280 } }) },
    { slot: 7, name: "Patamon", live: emptyLive() },
  ];
  assert.equal(tickPlanner(true, () => ({ members })), false, "the switch on opens nothing");
  assert.equal(plannerOpen(), false);
  openPlanner();
  assert.equal(tickPlanner(true, () => ({ members })), true, "the F2 button opened it; the tick keeps it fed");
  assert.equal(plannerOpen(), true);
  assert.equal(plannerSelection().name, "Kotemon");
  assert.equal(plannerRowsNow().length, 43, "Growlmon is already learned, so its own record leaves the list");
  assert.equal(plannerRowsNow()[0].name, "Dinohumon");
  assert.ok(!plannerRowsNow().some((r) => r.to === 14));

  const ctx = fakeCtx();
  assert.equal(plannerDraw(ctx), true);
  const text = drawnText(ctx);
  assert.match(text, /NEXT FORMS/);
  assert.match(text, /Kotemon/);
  assert.match(text, /Dinohumon/);
  assert.match(text, /Grizzmon/);
  assert.match(text, /READY/, "a passing record carries the badge");

  // Up/Down move the row cursor, Left/Right the partner
  assert.equal(plannerCursor(), 0);
  plannerPress("down");
  assert.equal(plannerCursor(), 1);
  plannerPress("up");
  assert.equal(plannerCursor(), 0);
  plannerPress("right");
  assert.equal(plannerSelection().name, "Patamon");
  assert.equal(plannerRowsNow().length, 44);
  plannerPress("left");
  assert.equal(plannerSelection().name, "Kotemon");

  // Cross closes and the switch staying on does not reopen it
  plannerPress("cross");
  assert.equal(plannerOpen(), false);
  tickPlanner(true, () => ({ members }));
  assert.equal(plannerOpen(), false, "Cross does not reopen while the switch stays on");
  tickPlanner(false, () => ({ members }));
  assert.equal(tickPlanner(true, () => ({ members })), false, "off and on again does not reopen it");
  openPlanner();
  assert.equal(tickPlanner(false, () => ({ members })), false, "the switch off closes it");
  openPlanner();
  plannerPress("start");
  assert.equal(plannerOpen(), false);
  tickPlanner(false, () => ({ members }));
});

test("the page reads the partner's live ledger: a learned form leaves the list", () => {
  plannerReset();
  setPlannerData(evolutions, digimon, [
    { slot: 0, name: "Kotemon", live: liveFor({ levels: { 9: 1 } }) },
  ]);
  openPlanner();
  openPlanner();
  tickPlanner(true, null);
  assert.equal(plannerOpen(), true);
  assert.equal(plannerRowsNow().length, 43);
  assert.ok(!plannerRowsNow().some((r) => r.to === 9));
  plannerReset();
});
