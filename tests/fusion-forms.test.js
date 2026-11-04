// Fused forms — the ten DNA bodies and whether they can play (web/fusion-forms.js).
//
// The DNA presentation table (web/assets/data/jogress_scripts.json) has ten actions;
// each fuses its partner models into one body (`fusedModel` / `fusedPack.folder`; most
// actions name two partners, action 432 names four). Seven of those bodies ship fully
// authored (17-18 of 18 clips). Three — m468agnm, m469garm,
// m470agry — ship with no clips at all and only 3, 3 and 5 timeline tables; they stay
// playable only through the donor rows in web/fight/anim-donor-map.js, which give them
// a basic attack (clip 5), a spell (clip 9) and an item pose (clip 10).
//
// Pure module + CLI: no game path, no F2 toggle, nothing changes in play.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fusionForms, fusionFaults } from "../web/fusion-forms.js";
import { ANIM_DONOR_GAPS } from "../web/fight/anim-donor-map.js";

const ROOT = resolve(import.meta.dirname, "..");
const readJSON = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const jogress = readJSON("web/assets/data/jogress_scripts.json");
const index = readJSON("web/assets/battle/models/index.json");
// The ten fused packs, in action order (the folder each action names in fusedPack).
const FOLDERS = [
  "m254pldr", "m059houo", "m372sgrg", "m150omgm", "m381ipdp",
  "m377blzb", "m151dblm", "m468agnm", "m469garm", "m470agry",
];
const bodies = Object.fromEntries(
  FOLDERS.map((folder) => [folder, readJSON(`web/assets/battle/models/${folder}/anim.json`)]),
);
const rows = () => fusionForms(jogress, index, ANIM_DONOR_GAPS, bodies);

test("the DNA table is ten actions with ten distinct fused bodies, and every pack is in the model index", () => {
  const out = rows();
  assert.equal(out.length, 10, "ten DNA actions");
  assert.deepEqual(out.map((r) => r.actionId), [374, 375, 376, 377, 378, 379, 380, 432, 433, 434]);
  assert.deepEqual(out.map((r) => r.clip), Array(10).fill(12), "every DNA action presents clip 12");
  assert.deepEqual(
    out.map((r) => r.fusedModel).sort((a, b) => a - b),
    [59, 150, 151, 254, 372, 377, 381, 468, 469, 470],
    "ten distinct fused model numbers",
  );
  assert.equal(new Set(out.map((r) => r.folder)).size, 10, "ten distinct pack folders");
  const indexSet = new Set(index);
  for (const row of out) {
    assert.ok(indexSet.has(row.folder), `${row.folder} is in the model index`);
    assert.equal(row.exists, true, `${row.folder} loads`);
    assert.deepEqual(row.partners, jogress.actions[String(row.actionId)].partnerModels,
      `${row.folder} keeps the script's partner list`);
  }
  assert.deepEqual(out[0].partners, [259, 260], "Paildramon fuses ExVeemon and Stingmon");
  assert.deepEqual(out[7].partners, [5, 374, 386, 387], "m468agnm fuses four partners");
});

test("seven bodies are authored (17-18 of 18 clips); the three dataless bodies have 3, 3 and 5 tables", () => {
  const out = rows();
  // Actions 374-380, in action order.
  assert.deepEqual(out.slice(0, 7).map((r) => r.presentClips.length), [17, 17, 17, 17, 18, 17, 18],
    "the seven authored bodies keep 17-18 of their 18 clip slots");
  assert.deepEqual(out.slice(0, 7).map((r) => r.tables), [39, 20, 20, 20, 18, 36, 19],
    "and the non-empty timeline tables each one carries");
  for (const row of out.slice(0, 7)) {
    assert.equal(bodies[row.folder].clips.length, 18, "an authored pack has 18 clip slots");
    if (row.presentClips.length === 17) {
      assert.ok(!row.presentClips.includes(12), "the one missing authored slot is clip 12, the DNA presentation itself");
    }
    assert.deepEqual(row.gaps, [], "an authored body needs no donor for clips 5, 9 or 10");
  }
  // Actions 432-434: the three dataless bodies.
  assert.deepEqual(out.slice(7).map((r) => r.presentClips.length), [0, 0, 0], "no action clips at all");
  assert.deepEqual(out.slice(7).map((r) => r.tables), [3, 3, 5], "only their timeline tables");
  assert.deepEqual(out.slice(7).map((r) => r.frames), [542, 470, 525], "and the frames those tables span");
});

test("the three dataless bodies borrow clips 5, 9 and 10 from donor rows over tables 56 / 56 / 58", () => {
  const out = rows();
  const dataless = out.slice(7);
  assert.deepEqual(dataless.map((r) => r.folder), ["m468agnm", "m469garm", "m470agry"]);
  for (const row of dataless) {
    assert.deepEqual(row.gaps.map((g) => g.clip), [5, 9, 10], `${row.folder} misses exactly the three battle clips`);
    for (const gap of row.gaps) {
      assert.equal(gap.method, "own-table-body", `${row.folder} clip ${gap.clip} plays its own table body`);
      assert.ok(gap.donor, `${row.folder} clip ${gap.clip} names a donor`);
      assert.equal(gap.covered, true, `${row.folder} clip ${gap.clip} can be played`);
    }
  }
  assert.deepEqual(dataless.map((r) => r.gaps.map((g) => g.tables)), [[[56], [56], [56]], [[56], [56], [56]], [[58], [58], [58]]],
    "tables 56, 56 and 58 carry the borrowed motion");
  assert.deepEqual(fusionFaults(out), [], "the shipped ten DNA bodies raise no fault");
});

test("a removed pack, a removed donor row and an emptied clip list are exactly three faults, each naming its body", () => {
  // The shipped copy with three real defects, one per fault kind the checker must catch.
  const brokenIndex = index.filter((folder) => folder !== "m468agnm");
  const brokenDonors = structuredClone(ANIM_DONOR_GAPS);
  delete brokenDonors.m469garm[9];
  const brokenBodies = structuredClone(bodies);
  brokenBodies.m254pldr.clips = [];
  const faults = fusionFaults(fusionForms(jogress, brokenIndex, brokenDonors, brokenBodies));

  assert.equal(faults.length, 3, "exactly the three defects, nothing else");
  assert.deepEqual(faults.map((f) => f.kind), ["unplayable", "missing-pack", "unplayable"]);
  assert.deepEqual(faults.map((f) => f.folder), ["m254pldr", "m468agnm", "m469garm"]);
  for (const fault of faults) assert.match(fault.message, new RegExp(fault.folder), "every fault names its body");
  assert.deepEqual(faults[0].clips, [5, 9, 10], "an emptied authored clip list loses all three battle clips");
  assert.match(faults[0].message, /clip 5, 9, 10\b/, "and the fault names them");
  assert.deepEqual(faults[2].clips, [9], "m469garm loses only the clip its donor row covered");
  assert.match(faults[2].message, /clip 9\b/, "and the fault names that clip");
});

test("a partner model outside the model index is a fault of its own, named with the body", () => {
  const broken = structuredClone(jogress);
  broken.actions["432"].partnerModels = [5, 374, 386, 387, 999];
  const out = fusionForms(broken, index, ANIM_DONOR_GAPS, bodies);
  assert.deepEqual(out[7].missingPartners, [999], "999 has no pack");
  const faults = fusionFaults(out);
  assert.equal(faults.length, 1, "the other nine bodies stay clean");
  assert.equal(faults[0].kind, "missing-partner");
  assert.equal(faults[0].folder, "m468agnm");
  assert.equal(faults[0].partner, 999);
  assert.match(faults[0].message, /m468agnm/);
  assert.match(faults[0].message, /999/);
});

test("the checker prints the ten bodies and exits 0; a faulting copy exits 1", async () => {
  const { fusedFormsReport } = await import("../tools/check_fused_forms.mjs");
  const report = fusedFormsReport(jogress, index, ANIM_DONOR_GAPS, bodies);
  assert.equal(report.status, 0, "the shipped data is clean");
  assert.equal(report.faults.length, 0);
  const rowLines = report.lines.filter((line) => /^action \d+/.test(line));
  assert.equal(rowLines.length, 10, "one printed line per DNA body");
  assert.ok(rowLines.some((line) => /^action 432 .*m468agnm/.test(line)), "the dataless body is printed too");
  assert.match(report.lines.join("\n"), /0 faults/);

  const brokenIndex = index.filter((folder) => folder !== "m468agnm");
  const brokenDonors = structuredClone(ANIM_DONOR_GAPS);
  delete brokenDonors.m469garm[9];
  const brokenBodies = structuredClone(bodies);
  brokenBodies.m254pldr.clips = [];
  const broken = fusedFormsReport(jogress, brokenIndex, brokenDonors, brokenBodies);
  assert.equal(broken.status, 1, "a fault list means exit 1");
  assert.match(broken.lines.join("\n"), /^fault: m254pldr .*clip 5, 9, 10/m);
  assert.match(broken.lines.join("\n"), /^fault: m468agnm .*no pack/m);

  // The CLI over the shipped tables: ten rows, no fault, exit 0.
  const cli = spawnSync(process.execPath, ["tools/check_fused_forms.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.equal(cli.stdout.split("\n").filter((line) => /^action \d+/.test(line)).length, 10);
  assert.match(cli.stdout, /0 faults/);
});
