// Arrival Lab — why this place starts this scene.
//
// One read-only page (web/arrival-lab.html) over the per-place arrival gate objects the
// field's own dispatcher installs: 78 gate objects over 76 places (76 on the reset band,
// s795's and s800's second one on phase 1), 133 candidates in all. The model
// (web/arrival-lab.js) never decides by itself: every "who wins" answer is the engine's
// own chooseArrivalEvent(chain, test), so the page and the engine can never disagree.
//
// F2 -> Extras -> "Arrival lab (dev)" (off by default). With the switch off there is no
// row to click and the page is never opened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  labRows,
  candidateLines,
  flagChoices,
  arrivalVerdict,
  loadChains,
  isOrdinalLeaf,
  beatOf,
} from "../web/arrival-lab.js";
import {
  arrivalChain,
  chooseArrivalEvent,
  arrivalEventForPhase,
} from "../web/vendor/engine.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const raw = JSON.parse(read("../web/assets/data/scene/arrival_candidates.json"));
const chains = loadChains(raw);
const rows = labRows(chains);

const rowFor = (mapId, band) => rows.find((r) => r.mapId === mapId && r.band === band);
const gate = (mapId, band) => chains.find((c) => c.mapId === mapId && (c.band ?? "reset") === band);
const set = (...ids) => new Set(ids);
/** The one predicate shape the chains use: an ordinal leaf asserts the master story
 *  beat (0x6000|n, expected 1 = "is", expected 0 = "is not"), every other leaf asserts
 *  the flag reads as `expected`. Same shape as the oracle in tests/lane-b/scene-arrival. */
const at = (beat, flags) => (id, exp) =>
  isOrdinalLeaf(id) ? (beatOf(id) === beat) === (exp === 1) : flags.has(id) === (exp === 1);

test("every gate object the 76 places install is installed — 78 over 76, {reset: 76, phase1: 2}", () => {
  assert.equal(chains.length, 78);
  assert.equal(new Set(chains.map((c) => c.mapId)).size, 76);
  assert.equal(chains.reduce((n, c) => n + c.candidates.length, 0), 133);
  const bands = {};
  for (const c of chains) bands[c.band] = (bands[c.band] || 0) + 1;
  assert.deepEqual(bands, { reset: 76, phase1: 2 });

  // s795 is the two-object case: the entry object is the reset-band one.
  assert.equal(chains.filter((c) => c.mapId === "s795").length, 2);
  assert.equal(arrivalChain("s795").band, "reset");
  assert.equal(gate("s795", "phase1").candidates[0].event, 1505);
});

test("the chains are 133 candidates over 366 condition leaves and 37 distinct beats", () => {
  let leaves = 0;
  const beats = new Set();
  for (const c of chains) {
    for (const cand of c.candidates) {
      for (const path of cand.paths) {
        for (const [id] of path) {
          leaves++;
          if (isOrdinalLeaf(id)) beats.add(beatOf(id));
        }
      }
    }
  }
  assert.equal(leaves, 366);
  assert.equal(beats.size, 37);
});

test("the row list is one row per gate object, in install order, with words and citation", () => {
  assert.equal(rows.length, 78);
  assert.equal(rows.reduce((n, r) => n + r.candidates.length, 0), 133);

  const s200 = rowFor("s200", "reset");
  assert.equal(s200.order, 0);
  assert.deepEqual(s200.candidates.map((c) => c.event), [52, 50]);
  assert.deepEqual(s200.candidates[0].lines, ["beat 3 and flag 16397 = 1"]);
  assert.equal(s200.candidates[0].cite.call.file, "pro/wstag200.s");
  assert.equal(s200.candidates[0].cite.call.line, 34);

  assert.equal(rowFor("s305", "reset").candidates.length, 9);
  assert.deepEqual(rows.filter((r) => r.mapId === "s795").map((r) => r.order), [0, 1]);
  assert.deepEqual(rows.filter((r) => r.mapId === "s795").map((r) => r.band), ["phase1", "reset"]);
});

test("s200: beat 3 starts 50 with the flag clear, 52 with flag 16397 set, and beat 4 starts nothing", () => {
  const s200 = gate("s200", "reset");
  assert.deepEqual(arrivalVerdict(s200, 3, set()), {
    event: 50,
    index: 1,
    lines: ["beat 3 and flag 16397 = 0"],
  });
  assert.deepEqual(arrivalVerdict(s200, 3, set(16397)), {
    event: 52,
    index: 0,
    lines: ["beat 3 and flag 16397 = 1"],
  });
  assert.equal(arrivalVerdict(s200, 4, set()), null);
  assert.equal(arrivalVerdict(s200, 4, set(16397)), null);
});

test("s305: beat 13 starts 350 with 7181 clear and 351 with 7181 set; beat 0 starts nothing", () => {
  const s305 = gate("s305", "reset");
  assert.deepEqual(arrivalVerdict(s305, 13, set()), {
    event: 350,
    index: 0,
    lines: ["beat 13 and flag 7181 = 0"],
  });
  assert.deepEqual(arrivalVerdict(s305, 13, set(7181)), {
    event: 351,
    index: 1,
    lines: ["beat 13 and flag 7181 = 1"],
  });
  assert.equal(arrivalVerdict(s305, 0, set()), null);
  assert.equal(arrivalVerdict(s305, 0, set(7181)), null);
});

test("s795: the phase-1 object says 1505 only on phase 1, and the reset object says 830 at beat 32", () => {
  const phase1 = gate("s795", "phase1");
  assert.equal(phase1.band, "phase1");
  assert.deepEqual(candidateLines(phase1.candidates[0]), ["flag 16451 = 1"]);
  // Candidate 1505 needs flag 16451; its band is what decides whether it is asked at all.
  assert.equal(arrivalEventForPhase(phase1, 0, at(0, set(16451))), null);
  assert.equal(arrivalEventForPhase(phase1, 1, at(0, set(16451))), 1505);

  const reset = gate("s795", "reset");
  assert.equal(reset.band, "reset");
  assert.equal(arrivalEventForPhase(reset, 0, at(32, set())), 830);
  assert.equal(arrivalVerdict(reset, 32, set()).event, 830);
  // The reset band is skipped while the phase word sits in 1..3 (one-shot latch).
  assert.equal(arrivalEventForPhase(reset, 1, at(32, set())), null);
});

test("flagChoices lists the flags a chain reads and never its beat leaves", () => {
  const s305 = gate("s305", "reset");
  const choices = flagChoices(s305);
  assert.ok(choices.includes(7181));
  assert.ok(!choices.includes(24589), "0x600d is the beat leaf, not a flag");
  assert.ok(choices.every((id) => !isOrdinalLeaf(id)));
  assert.ok(flagChoices(gate("s200", "reset")).includes(16397));

  // The words: 0x600d renders as beat 13, never as flag 24589.
  assert.deepEqual(candidateLines({ event: 350, paths: [[[0x600d, 1], [7181, 0]]] }), [
    "beat 13 and flag 7181 = 0",
  ]);
  assert.ok(!candidateLines({ event: 350, paths: [[[0x600d, 1]]] })[0].includes("24589"));
  // An ordinal leaf read with expected 0 says "not beat N", like the disc's bne arm.
  assert.deepEqual(candidateLines({ event: 1, paths: [[[0x6008, 0]]] }), ["not beat 8"]);
});

test("every verdict is the engine's chooseArrivalEvent under the same predicate", () => {
  for (const chain of chains) {
    for (const beat of [0, 1, 3, 13, 22, 32, 43]) {
      const verdict = arrivalVerdict(chain, beat, set());
      assert.equal(
        verdict ? verdict.event : null,
        chooseArrivalEvent(chain, at(beat, set())),
        `${chain.mapId} ${chain.band} beat ${beat}`,
      );
    }
  }
});

test("the module is pure and imports the engine's matcher instead of writing its own", () => {
  const src = read("../web/arrival-lab.js");
  assert.match(src, /import\s*\{[^}]*\bchooseArrivalEvent\b[^}]*\}\s*from\s*"\.\/vendor\/engine\.js"/s,
    "the engine's own matcher is the only one");
  assert.doesNotMatch(src, /(function|const|let|var)\s+chooseArrivalEvent\b/,
    "no second matcher of its own");
  assert.match(src, /export function arrivalVerdict[\s\S]*?chooseArrivalEvent\(/,
    "the verdict asks the engine");

  // Pure: no page, no DOM, no storage, no fetch, no fs.
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b/);
  assert.doesNotMatch(src, /\blocalStorage\b/);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /from\s*"(node:)?fs"/);
});

test("F2 switch: off by default, hidden row, one guarded open, no URL flag", () => {
  const ambience = read("../web/ambience.js");
  assert.match(ambience, /\["arrivallab", "Arrival lab \(dev\)"\]/, "the F2 Extras row");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
  assert.ok(experimental, "EXPERIMENTAL is still one array literal");
  assert.match(experimental[1], /"arrivallab"/, "off until the player switches it on");
  const devModel = read("../web/dev-panel-model.js"), devPanel = read("../web/dev-panel.js");
  assert.match(devModel, /arrivallab: P\("arrival-lab\.html"/, "the Open button's page is in the F2 page model");
  assert.match(ambience, /if \(!o \|\| !fx\[key\]\) return;/, "opened only behind the switch (the Open guard)");
  assert.match(devPanel, /b\.disabled = !fx\[/, "the Open button is disabled while the switch is off");
  assert.equal(devModel.split("arrival-lab.html").length - 1, 1, "one reference to the page, no other link into it");
  assert.equal(ambience.split("arrival-lab.html").length - 1, 0, "ambience.js itself has no link");
  assert.doesNotMatch(ambience, /(get|has)\("arrivallab"\)/, "never a URL flag");
});

test("the page reads the one extracted chain file and writes nothing", () => {
  const html = read("../web/arrival-lab.html");
  assert.match(html, /import\s*\{[^}]*\}\s*from\s*"\.\/arrival-lab\.js"/s, "the page uses the model");
  assert.match(html, /fetch\("assets\/data\/scene\/arrival_candidates\.json"\)/);
  const fetches = html.match(/fetch\s*\(/g) ?? [];
  assert.equal(fetches.length, 1, "one read of the extracted data, nothing else");
  assert.doesNotMatch(html, /\blocalStorage\b/, "no storage");
  assert.doesNotMatch(html, /method\s*:\s*["'](POST|PUT|DELETE|PATCH)["']/i, "no write");
  assert.doesNotMatch(html, /assets\/(native|hd)\//, "no disc bytes, only the extracted chains");
  assert.match(html, /chooseArrivalEvent|arrivalVerdict/, "the verdict comes from the engine-backed model");
});
