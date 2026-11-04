// The Second Job (F2 -> Extras -> "Quests: pick which job to take"): a character with more than one job waiting
// asks which one you want now, instead of always handing out the first def in the file. web/quest-offers.js holds
// the offer loop's filters in one pure place; the host (web/quests.js questTalk) asks only when the switch is on
// and there is a real choice. One job is exactly today's behaviour, with no extra question.
//
// The host arm is exercised by lifting questTalk() and pagedPick() out of web/quests.js and wiring them to spies --
// the same trick tests/quest-bucket.test.js uses on web/game.js -- so the questions checked here are the real ones
// the code produces, in order, with the real paged widget.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { offersAt, offerLabels, pageCount } from "../web/quest-offers.js";

const QUESTS = readFileSync(new URL("../web/quests.js", import.meta.url), "utf8");
const AMBIENCE = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const OFFERS_SRC = readFileSync(new URL("../web/quest-offers.js", import.meta.url), "utf8");
const DATA = JSON.parse(readFileSync(new URL("../web/quests.json", import.meta.url), "utf8"));
const DEFS = DATA.quests;

const canonId = (m) => m;
const allAvailable = () => "available";
const opts = (o = {}) => ({ statusOf: allAvailable, declined: new Set(), labFocus: null, canon: canonId, ...o });

// A small fixture: three available jobs share npc 58 on s330 (one is also posted on s331), plus a job for npc 60.
const job = (id, title, npc, maps, extra = {}) => ({
  id, title, objectives: [],
  offer: { npc, maps, name: "Old Woman", lines: [`${id} lines`], ask: `Take ${id}?` },
  ...extra,
});
const FIXTURE = [
  job("q_a", "A first job", 58, ["s330"]),
  job("q_b", "B second job", 58, ["s330", "s331"]),
  job("q_c", "C third job", 58, ["s330"]),
  job("q_x", "Somebody else", 60, ["s330"]),
];

// =====================================================================================================================
// 1. offersAt: the offer loop's own filters, written once
// =====================================================================================================================
test("offersAt returns every job this person could hand out here, in file order", () => {
  const out = offersAt(FIXTURE, 58, "s330", opts());
  assert.deepEqual(out.map((d) => d.id), ["q_a", "q_b", "q_c"]);
  // another giver, another map, and a same-map job without an offer are all left out
  assert.deepEqual(offersAt(FIXTURE, 60, "s330", opts()).map((d) => d.id), ["q_x"]);
  assert.deepEqual(offersAt(FIXTURE, 58, "s331", opts()).map((d) => d.id), ["q_b"]);
  assert.deepEqual(offersAt(FIXTURE, 58, "s200", opts()), []);
  assert.deepEqual(offersAt([{ id: "no_offer", title: "x", objectives: [] }], 58, "s330", opts()), []);
});

test("offersAt drops a job already declined this session, and respects the lab's one-quest focus", () => {
  assert.deepEqual(offersAt(FIXTURE, 58, "s330", opts({ declined: new Set(["q_b"]) })).map((d) => d.id), ["q_a", "q_c"]);
  assert.deepEqual(offersAt(FIXTURE, 58, "s330", opts({ labFocus: "q_c" })).map((d) => d.id), ["q_c"]);
  // the lab's focus is a host-level variable, not a def field: an unrelated id leaves nothing
  assert.deepEqual(offersAt(FIXTURE, 58, "s330", opts({ labFocus: "q_x" })), []);
});

test("offersAt keeps only what statusOf calls available", () => {
  const statusOf = (d) => (d.id === "q_c" ? "locked" : d.id === "q_b" ? "active" : "available");
  assert.deepEqual(offersAt(FIXTURE, 58, "s330", opts({ statusOf })).map((d) => d.id), ["q_a"]);
});

test("offersAt matches night and story variants of a map through canon, on both sides", () => {
  // the query is the plain map, the def is posted on its night variant
  const night = [job("q_n", "Night job", 58, ["s330-night"])];
  const canon = (m) => (m === "s330-night" ? "s330" : m);
  assert.deepEqual(offersAt(night, 58, "s330", opts({ canon })).map((d) => d.id), ["q_n"]);
  // and the other way round
  assert.deepEqual(offersAt(FIXTURE, 58, "s330-night", opts({ canon })).map((d) => d.id), ["q_a", "q_b", "q_c"]);
});

// =====================================================================================================================
// 2. The real quest data (web/quests.json, 225 offers) -- computed, never a copy of a number that may drift
// =====================================================================================================================
test("the real data: Leomon 27 on s330 has 11 jobs waiting, and they page three at a time", () => {
  const expected = DEFS.filter((d) => d.offer && d.offer.npc === 27 && d.offer.maps.includes("s330")).map((d) => d.id);
  assert.equal(expected.length, 11, "the measured stack at Leomon");
  const out = offersAt(DEFS, 27, "s330", opts());
  assert.deepEqual(out.map((d) => d.id), expected);
  assert.equal(pageCount(out.length), 3);
  assert.equal(pageCount(1), 1);
});

test("the real data: 55 of the 118 (npc, map) giver slots carry two or more jobs", () => {
  const slots = new Set();
  for (const d of DEFS) for (const m of d.offer?.maps ?? []) slots.add(`${d.offer.npc}@${m}`);
  assert.equal(slots.size, 118, "the measured giver slots");
  let stacked = 0;
  for (const key of slots) {
    const at = key.indexOf("@");
    if (offersAt(DEFS, Number(key.slice(0, at)), key.slice(at + 1), opts()).length >= 2) stacked += 1;
  }
  assert.equal(stacked, 55, "the measured slots with a real choice");
});

test("offerLabels clips exactly like the game's own clip(): over 28 becomes 27 characters and a full stop", () => {
  const titles = DEFS.map((d) => d.title);
  const longest = DEFS.reduce((a, b) => (b.title.length > a.title.length ? b : a));
  assert.ok(longest.title.length > 28, "there is a title long enough to clip");
  const labels = offerLabels(DEFS, 28);
  assert.equal(labels.length, DEFS.length);
  assert.ok(labels.every((s) => s.length <= 28), "no label is longer than the row");
  assert.equal(labels[DEFS.indexOf(longest)], longest.title.slice(0, 27) + ".");
  assert.equal(labels[DEFS.indexOf(longest)].length, 28);
  // a title that already fits is left exactly as it is (clip() adds no ellipsis)
  assert.deepEqual(offerLabels([{ title: "A short job" }], 28), ["A short job"]);
  const exact = "Twenty eight chars fit right";
  assert.equal(exact.length, 28);
  assert.deepEqual(offerLabels([{ title: exact }], 28), [exact]);
});

// =====================================================================================================================
// 3. The host arm: web/quests.js questTalk lifted out and wired to spies
// =====================================================================================================================
/** One function declaration out of web/quests.js, braces balanced, keeping an `async` prefix when it has one. */
function bodyOf(name) {
  const begin = QUESTS.indexOf(`function ${name}(`);
  assert.ok(begin >= 0, `web/quests.js still declares ${name}()`);
  let depth = 0;
  let i = QUESTS.indexOf("{", begin);
  for (; i < QUESTS.length; i++) {
    if (QUESTS[i] === "{") depth++;
    else if (QUESTS[i] === "}" && --depth === 0) break;
  }
  const asyncPrefix = QUESTS.slice(Math.max(0, begin - 6), begin) === "async " ? "async " : "";
  return asyncPrefix + QUESTS.slice(begin, i + 1);
}

// Every module-level name questTalk reads or calls; the host wiring below supplies each one.
const FREE = ["enabled", "dialogBusy", "logOpen", "syncCounts", "st", "defOf", "atNpc", "busy", "perform", "chaseLost",
  "say", "isReady", "toast", "turnInRef", "claim", "ask", "chatted", "allDefs", "statusOf", "declined", "labFocus",
  "accept", "offersAt", "offerLabels", "pagedPick", "fx", "canon"];

/**
 * The real questTalk(), with the real pagedPick() when the host asks which job, and spies for everything else.
 * `answers` is what the player picks in order (an index, or -1 for "Back"); an exhausted list takes the last option.
 */
function host({ offers, fxOn, answers = [] }) {
  const calls = [];
  let n = 0;
  const ask = async (prompt, options) => {
    calls.push({ prompt, options: [...options] });
    const v = answers[n++];
    return v === undefined ? options.length - 1 : v;
  };
  const st = { active: {}, done: {} };
  const declined = new Set();
  const performed = [];
  let running = null;
  const env = {
    enabled: () => true, dialogBusy: false, logOpen: false,
    syncCounts: () => {}, st,
    defOf: (id) => offers.find((d) => d.id === id) ?? null,
    atNpc: (ref, npcId, mapId) => !!ref && ref.npc === npcId && ref.maps.some((m) => m === mapId),
    busy: (fn) => { running = fn(); },
    perform: async (scene, name, lines, npcId) => {
      performed.push({ scene, name, lines, npcId });
      return { ran: false, answer: null, failed: false };      // no scene here: the def's own ask comes next
    },
    chaseLost: () => false, say: async () => {}, isReady: () => false, toast: () => {}, turnInRef: () => null,
    claim: () => {}, ask, chatted: new Set(),
    allDefs: () => offers, statusOf: allAvailable, declined, labFocus: null,
    accept: (id) => { st.active[id] = { p: [] }; },          // what quests.js accept() does to the store
    offersAt, offerLabels, pagedPick: new Function("ask", `"use strict"; return (${bodyOf("pagedPick")});`)(ask),
    fx: { questsecondjob: fxOn }, canon: canonId,
  };
  const factory = new Function(...FREE, `"use strict"; return (${bodyOf("questTalk")});`);
  const questTalk = factory(...FREE.map((k) => env[k]));
  return { questTalk, calls, st, declined, performed, settle: async () => { await running; } };
}

test("one job: the host asks nothing new -- the offer's own ask is the only question, as today", async () => {
  const h = host({ offers: [FIXTURE[0]], fxOn: true, answers: [0] });
  assert.equal(h.questTalk(58, "s330", false), true, "the offer takes the conversation");
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].prompt, "Take q_a?");
  assert.deepEqual(h.calls[0].options, ["I will do it", "Not now"]);
  assert.ok(h.st.active.q_a, "taking it accepts exactly that job");
});

test("three jobs with the switch on: \"Which job?\" first, then the chosen job's own offer and ask", async () => {
  const h = host({ offers: FIXTURE.slice(0, 3), fxOn: true, answers: [2, 0] });
  assert.equal(h.questTalk(58, "s330", false), true);
  await h.settle();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].prompt, "Which job?");
  assert.deepEqual(h.calls[0].options, ["A first job", "B second job", "C third job", "Back"]);
  assert.equal(h.calls[1].prompt, "Take q_c?", "the chosen job asks its own question");
  assert.ok(h.st.active.q_c, "the chosen job is the one taken");
  assert.equal(h.st.active.q_a, undefined);
  assert.deepEqual(h.performed[0].lines, ["q_c lines"], "and its own offer scene is what plays");
  assert.equal(h.declined.size, 0);
});

test("four rows a page: five jobs need a \"More\" row, and the fifth is still pickable", async () => {
  const many = [...FIXTURE.slice(0, 3), job("q_d", "D fourth job", 58, ["s330"]), job("q_e", "E fifth job", 58, ["s330"])];
  const h = host({ offers: many, fxOn: true, answers: [4, 0, 0] });   // More, then the fifth, then accept it
  assert.equal(h.questTalk(58, "s330", false), true);
  await h.settle();
  assert.equal(h.calls[0].options.length, 6, "four titles + More + Back");
  assert.equal(h.calls[0].options[4], "More (1/2)");
  assert.equal(h.calls[1].options[0], "E fifth job");
  assert.ok(h.st.active.q_e);
});

test("\"Back\" (-1) declines nothing and marks nothing: the whole list is still waiting", async () => {
  const h = host({ offers: FIXTURE.slice(0, 3), fxOn: true, answers: [-1] });
  assert.equal(h.questTalk(58, "s330", false), true);
  await h.settle();
  assert.equal(h.calls.length, 1, "only \"Which job?\" was asked");
  assert.equal(h.calls[0].prompt, "Which job?");
  assert.equal(h.declined.size, 0, "nothing is declined");
  assert.deepEqual(h.st.active, {}, "and no job was taken");
  assert.equal(h.performed.length, 0, "no offer scene ran");
  assert.deepEqual(offersAt(FIXTURE, 58, "s330", opts({ declined: h.declined })).map((d) => d.id), ["q_a", "q_b", "q_c"]);
});

test("switch off: three jobs still hand out the first one in the file, with no extra question", async () => {
  const h = host({ offers: FIXTURE.slice(0, 3), fxOn: false, answers: [1] });
  assert.equal(h.questTalk(58, "s330", false), true);
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].prompt, "Take q_a?", "today's behaviour: the first available job");
  assert.equal(h.declined.size, 1, "\"Not now\" declines that job, exactly as before");
  assert.ok(h.declined.has("q_a"));
});

// =====================================================================================================================
// 4. Source gates: the switch is the only gate, off is today's loop, nothing writes the story or rebuilds data
// =====================================================================================================================
test("the extra question sits behind `offers.length > 1 && fx.questsecondjob === true` and asks for clipped titles", () => {
  assert.ok(QUESTS.includes("const offers = offersAt(allDefs(), npcId, mapId, { statusOf, declined, labFocus, canon })"),
    "the offer branch builds its list from web/quest-offers.js");
  assert.ok(QUESTS.includes("if (offers.length > 1 && fx.questsecondjob === true)"), "one job never sees the question");
  assert.ok(QUESTS.includes('pagedPick("Which job?", offerLabels(offers, 28))'), "the game's own four-row widget, clipped titles");
  assert.ok(QUESTS.includes("let d = offers[0];"), "otherwise the first offer, as today");
});

test("F2 -> Extras has the pair and the key, appended and off by default", () => {
  assert.ok(AMBIENCE.includes('["questsecondjob", "Quests: pick which job to take (new)"]'), "the Extras row pair");
  const line = AMBIENCE.split("\n").find((l) => l.startsWith("const EXPERIMENTAL ="));
  assert.ok(line, "the switch list still exists");
  assert.ok(line.includes('"questsecondjob"'), "the switch is in EXPERIMENTAL (off until you turn it on)");
  assert.ok(line.indexOf('"chatqueue"') < line.indexOf('"questsecondjob"'), "appended, so every older key keeps its place");
});

test("web/quest-offers.js is pure and the host still writes no story flag or quest data", () => {
  for (const bad of [/\bimport\b/, /\brequire\s*\(/, /\bprocess\b/, /\bfetch\s*\(/, /\blocalStorage\b/, /\bdocument\b/, /\bwindow\b/, /quests\.json/, /setFlag/]) {
    assert.ok(!bad.test(OFFERS_SRC), `web/quest-offers.js must not use ${bad}`);
  }
  assert.ok(!/setFlag\s*\(|applyStoryFlag/.test(QUESTS), "quests.js writes no story flag (it only reads them)");
  assert.ok(!/build_quests|readFileSync/.test(OFFERS_SRC), "no data rebuild rides this change");
});
