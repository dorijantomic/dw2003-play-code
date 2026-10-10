// Story-robot regression contract — runs the data-driven spine solver (tools/story_robot.ts)
// and asserts its unwired-link punch-list and contiguous frontier match the pinned baseline
// (tools/story_robot.baseline.json). This is the authenticity oracle for story progression:
// a NEW hole (a gate whose required item/flag has no producer of any kind) or a frontier
// regression flips this red. Fixing a hole (wiring its producer) is allowed — update the
// baseline deliberately when you do.
//
// The robot is a self-contained CLI (it builds engine content from the live converter + data,
// so it reflects Part-B wiring without a bundle rebuild). We run it as a subprocess in --json
// mode rather than importing it (it calls process.exit), and compare structured output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const baseline = JSON.parse(readFileSync(resolve(root, "tools/story_robot.baseline.json"), "utf8"));

const run = () => JSON.parse(
  execFileSync("node", ["tools/story_robot.ts", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }),
);

test("robot punch-list matches the pinned baseline (no new unwired links)", () => {
  const { holes } = run();
  const baseHoles = [...baseline.holes].sort();
  const got = [...holes].sort();
  const newHoles = got.filter((h) => !baseHoles.includes(h));
  const fixed = baseHoles.filter((h) => !got.includes(h));
  assert.deepEqual(newHoles, [], `NEW unwired links appeared (regression): ${newHoles.join(", ")}`);
  // Fixing holes is allowed but should be intentional — surface it so the baseline gets updated.
  if (fixed.length) console.log(`  note: ${fixed.length} baseline hole(s) now FIXED — update baseline: ${fixed.join(", ")}`);
});

test("robot contiguous frontier does not regress", () => {
  const { frontier } = run();
  assert.ok(frontier >= baseline.frontier,
    `frontier regressed: 0x${frontier.toString(16)} < baseline 0x${baseline.frontier.toString(16)}`);
});

test("robot run is deterministic (same holes + frontier across repeated runs)", () => {
  const a = run();
  const b = run();
  assert.deepEqual([...a.holes].sort(), [...b.holes].sort());
  assert.equal(a.frontier, b.frontier);
});

test("robot audits the terminal scene's shared handoffs beyond the last ordinal", () => {
  const result = run();
  assert.equal(result.continuation?.events?.[0]?.stage, "s780");
  assert.equal(result.continuation?.events?.[0]?.event, 1500);
  assert.equal(result.continuation?.events?.[1]?.stage, "s925");
  assert.equal(result.continuation?.events?.[1]?.event, 1600);
  assert.equal(result.continuation?.ordinal, 45);
  assert.deepEqual(result.holes, []);
});

// ── Census: the code's story-step member list must EQUAL the decoded one ──────────────────────
// The decoded list is the ordinal ladder (web/assets/data/progress_ordinal.json) and, per step,
// the event the disc's own completion routine names as its writer
// (web/assets/data/ordinal_owner.json, read from the overlay's `sw $vX,-0x4c90`). The robot's
// list is what it MEASURED by driving the real engine. Three steps (0x07 s440, 0x0e s212,
// 0x19 s685) were reported as skipped rather than wired before the stage-entry arrival chain
// and the bank-0x90 talk launcher were ported, so `skipped` is pinned to empty here: a step
// that stops being wired fails this test instead of appearing in a report nobody diffs.
test("every story step on the decoded ladder is wired (skipped list is empty)", () => {
  const { skipped, beats } = run();
  assert.deepEqual(skipped, [],
    `story steps the solver could not wire: ${skipped.map((s) => `0x${s.ordinal.toString(16)} ${s.stage} (${s.status}: ${s.detail})`).join("; ")}`);
  const ladder = JSON.parse(readFileSync(resolve(root, "web/assets/data/progress_ordinal.json"), "utf8"))
    .ladder.flatMap((r) => r.ordinals).sort((a, b) => a - b);
  assert.deepEqual(beats.map((b) => b.target), ladder,
    "the measured step list must equal the decoded ladder, one beat per ladder step");
});

test("each step is advanced by the event the decoded owner map names", () => {
  const { producerCensus, ownerMismatch } = run();
  assert.deepEqual(ownerMismatch, [], "a step advanced by an event the disc does not use");
  const owners = JSON.parse(readFileSync(resolve(root, "web/assets/data/ordinal_owner.json"), "utf8"));
  const decoded = new Map();   // ordinal -> [event ids the overlay's own routine names]
  for (const row of owners.ladder)
    for (const [ev, ord] of Object.entries(row.owner))
      decoded.set(Number(ord), [...(decoded.get(Number(ord)) ?? []), Number(ev)]);
  for (const row of producerCensus) {
    assert.ok(decoded.has(row.ordinal), `step 0x${row.ordinal.toString(16)} is not on the decoded ladder`);
    assert.ok(decoded.get(row.ordinal).includes(row.producer),
      `step 0x${row.ordinal.toString(16)} was advanced by event ${row.producer}, not one of ` +
      `${JSON.stringify(decoded.get(row.ordinal))} (${row.stage}, via ${row.via})`);
  }
});

// The three steps this job is about, each through the shared system the disc uses — no hand row.
// 0x07 and 0x0e are stage-entry arrival-chain rows; 0x19 has NO trigger row on the disc and is
// started by a conversation's closing line through the bank-0x90 talk launcher.
test("the three long-skipped steps are wired through their shared start systems", () => {
  const byStep = new Map(run().producerCensus.map((c) => [c.ordinal, c]));
  const expect = [
    { ordinal: 0x07, stage: "s440", producer: 152, via: /^OnEnterMap:s440\.auto\.152$/ },
    { ordinal: 0x0e, stage: "s212", producer: 352, via: /^OnEnterMap:s212\.auto\.352$/ },
    { ordinal: 0x19, stage: "s685", producer: 690, via: /^talk-launch:bank 0x90 bit 67/ },
  ];
  for (const want of expect) {
    const got = byStep.get(want.ordinal);
    assert.ok(got, `step 0x${want.ordinal.toString(16)} (${want.stage}) is not in the census`);
    assert.equal(got.stage, want.stage);
    assert.equal(got.producer, want.producer, `step 0x${want.ordinal.toString(16)} producer`);
    assert.match(got.via, want.via, `step 0x${want.ordinal.toString(16)} start site`);
  }
});
