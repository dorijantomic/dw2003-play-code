// The DW2-motion converter's committed tables (data/authored/dw2_motion): every species it builds has a body record, every pair
// names real bone numbers on both sides, and the cast-type table has the shape web/fight/dw2-motion.js reads. No disc needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const pairs = read("data/authored/dw2_motion/pairs.json").species;
const rigs = read("data/authored/dw2_motion/rigs.json").models;

test("every species the converter builds has a body record with the parts it reads", () => {
  assert.ok(pairs.length >= 70, `only ${pairs.length} species`);
  for (const s of pairs) {
    const r = rigs[s.folder];
    assert.ok(r, `${s.folder}: no body record`);
    assert.ok(r.size?.h > 0, `${s.folder}: no height`);
    assert.ok(r.chains && r.sites && r.ground?.contact && Array.isArray(r.boneList), `${s.folder}: chains/sites/contact/boneList missing`);
    assert.equal(r.boneList.length, r.bones, `${s.folder}: boneList length`);
  }
});

test("every pair names one of our bones and a DW2 bone, each used once", () => {
  for (const s of pairs) {
    assert.match(s.dw2, /^\d{3}[a-z0-9]+$/, `${s.folder}: dw2 id`);
    assert.equal(typeof s.flipDw2, "boolean", `${s.folder}: flipDw2`);
    const n = rigs[s.folder].bones, ours = s.pairs.map((p) => p[0]), theirs = s.pairs.map((p) => p[1]);
    assert.ok(ours.every((b) => Number.isInteger(b) && b >= 0 && b < n), `${s.folder}: our bone out of range`);
    assert.ok(theirs.every((b) => Number.isInteger(b) && b >= 0), `${s.folder}: DW2 bone`);
    assert.equal(new Set(ours).size, ours.length, `${s.folder}: one of our bones paired twice`);
    assert.equal(new Set(theirs).size, theirs.length, `${s.folder}: a DW2 bone paired twice`);
  }
});

test("the cast-type table maps techniques to DW2 cast types 0/1/2", () => {
  const ct = read("data/authored/dw2_motion/cast-types.json");
  const vals = Object.values(ct.bySkill);
  assert.ok(vals.length > 100);
  assert.ok(vals.every((v) => v === 0 || v === 1 || v === 2));
});

test("the converter reads nothing outside the repo except the folders paths.mjs names", () => {
  const dir = path.join(ROOT, "tools/dw2_motion/retarget");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && f !== "paths.mjs")) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(s, /homedir\(\)|\/home\/|dw3-knowledge\/|dw2-models\/|scratch-research/, `${f} names a private path`);
  }
});
