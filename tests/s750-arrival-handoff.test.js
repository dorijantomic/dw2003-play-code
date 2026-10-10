// s750 (North Sector — Chamber Room): where the player stands on a warp-less boot, and
// what the room's own arrival gate does with them.
//
// Settled 2026-10-06 (docs/research/systems/deep-playthrough-2026-10-06.md §2026-10-06c):
// the deep walk read the player "pinned at (0,0)" on a `?skipTitle=1&map=s750` boot and
// called it an unresolved spawn gap. It is neither a gap nor a freeze and our fixture data
// is NOT wrong: the disc's scene descriptor puts the leader at (298,466) — our
// stage_default_spawn.json agrees — and the room's OWN arrival gate then plays a scene that
// hands the player on to s805. The (0,0) was the arrival cutscene, not a spawn.
//
// So this pins the two static halves of that result: the descriptor default spawn, and the
// arrival gate being ordinal-0x20-gated (all four candidates) with event 860 present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const SPAWN = read("web/assets/data/stage_default_spawn.json");
const DESCRIPTORS = read("docs/generated/stage-descriptors.json");
const ARRIVAL = read("web/assets/data/scene/arrival_candidates.json");
const STEPS = read("web/assets/data/story_steps.json");

test("s750's descriptor default spawn is (298,466), and our fixture data agrees", () => {
  const d = DESCRIPTORS.find((e) => e.stage === "wstag750");
  assert.ok(d, "wstag750 has a scene descriptor");
  // fieldstg F0x8009116c: +0x2C/+0x30 are 24.8 fixed, the map pixel is raw >> 8.
  assert.equal(d.fields["2C"], "0x12A00");
  assert.equal(d.fields["30"], "0x1D200");
  assert.equal(0x12a00 >> 8, 298);
  assert.equal(0x1d200 >> 8, 466);
  assert.deepEqual(SPAWN.s750, { x: 298, y: 466, facing: 0 }, "our fixture data must match the disc, not (0,0)");
});

test("s750's arrival gate is ordinal-0x20 gated, and event 860 heads the chain", () => {
  const s750 = ARRIVAL.stages.s750;
  assert.ok(s750, "s750 has an arrival chain");
  assert.ok(s750.candidates.length >= 1, "at least one candidate");
  const ORD = 0x6020; // bank 0x60, ordinal == 0x20 (32)
  for (const c of s750.candidates) {
    assert.ok(c.conds.some(([id, v]) => id === ORD && v === 1), `event ${c.event} must be gated on ordinal 0x20`);
  }
  // Candidate 0 is the beat the fixture boot at ordinal 32 plays; its event is 860.
  assert.equal(s750.candidates[0].event, 860);
  const ev = STEPS.stages["750"].events.find((e) => e.event_id === 860);
  assert.ok(ev, "s750 ships event 860");
  assert.equal(ev.flag_key, "014a001c");
  // Its completion sets 0x4048 (16456) — the flag the next candidate branch tests.
  const sets = new Map(ev.sets.map(([id, v]) => [id, v]));
  assert.equal(sets.get(16456), 1);
});
