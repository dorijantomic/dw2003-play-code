// The hand-picked DW2/DW3 clips (web/dw2-motion-picks.json -> web/fight/dw2-picks.js -> resolveClipScript).
// The species check needs the local, git-ignored DW2 motion file and models; it skips without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanPicks, setDw2Picks, dw2Pick } from "../web/fight/dw2-picks.js";
import { setDw2MotionEnabled } from "../web/fight/dw2-motion.js";
import { resolveClipScript, prepareModelDonors, setFallbackDonor } from "../web/fight/clip-fallback.js";
import { setSkillTable, setTechTable } from "../web/fight/fight-tables.js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(WEB, rel), "utf8"));

test("the committed picks file is well formed", () => {
  const j = read("dw2-motion-picks.json");
  assert.equal(j.v, 1);
  assert.deepEqual(cleanPicks(j.picks), j.picks, "every row survives cleaning");
});

test("cleanPicks drops anything that is not folder -> slot -> dw2|dw3", () => {
  assert.deepEqual(cleanPicks({ m040andr: { 9: "dw2", 5: "dw3", 3: "x", a: "dw2" }, "../x": { 1: "dw2" }, m1: null }),
    { m040andr: { 9: "dw2", 5: "dw3" } });
  setDw2Picks({ m040andr: { 9: "dw2" } });
  assert.equal(dw2Pick("m040andr", 9), "dw2");
  assert.equal(dw2Pick("m040andr", 5), null);
  setDw2Picks({});
});

const HAVE = ["assets/battle/dw2motion/m040andr.json", "assets/battle/models/m040andr/anim.json", "assets/battle/models/m005grey/anim.json",
  "assets/data/digimon.json", "assets/data/fight_tech_table.json"].every((f) => fs.existsSync(path.join(WEB, f)));

test("a pick overrides the rule only while DW2 motion is on (Andromon)", { skip: !HAVE && "no local DW2 motion data" }, async () => {
  setSkillTable(read("assets/data/digimon.json").skills);
  setTechTable(read("assets/data/fight_tech_table.json"));
  setFallbackDonor(read("assets/battle/models/m005grey/anim.json").actions);
  const model = read("assets/battle/models/m040andr/anim.json");
  model.folder = "m040andr";
  setDw2MotionEnabled(true);
  try {
    await prepareModelDonors(model);
    const dw2 = (slot, opts = {}) => resolveClipScript(model, slot, opts)?.dw2Motion?.letter ?? null;
    setDw2Picks({});
    assert.equal(dw2(5), null, "rule: an own clip stays DW3");
    assert.equal(dw2(9, { tech: 156 }), "F", "rule: a missing spell takes DW2");
    setDw2Picks({ m040andr: { 5: "dw2", 3: "dw2", 9: "dw3" } });
    assert.equal(dw2(5), "F", "pick dw2 beats the own attack");
    assert.equal(dw2(3), "C2K", "pick dw2 beats the own death");
    assert.equal(dw2(9, { tech: 156 }), null, "pick dw3 keeps DW2 off the spell");
    setDw2MotionEnabled(false);
    assert.equal(dw2(5), null, "DW2 motion off: picks do nothing");
  } finally {
    setDw2MotionEnabled(null);
    setDw2Picks({});
  }
});
