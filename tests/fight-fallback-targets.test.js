// A9 — a SELF/ALLY technique or an item use must build a self cast, never an attack body.
//
// The disc's skills table classifies every technique: type heal/support = SELF (22 records), everything
// else = ENEMY. The item machine's default clip-10 arm is a self use; the throw band 77..90 is an attack.
// Before the fix, resolveClipScript() had no target class at all: it answered a model's OWN clip 10 (an
// enemy-authored "second attack" on m441raiz, with op1/op6/hit spark) and, for a model without one, built
// the basic attack's body — so a healing item or a power-up threw an axe at the enemy. These tests fail on
// that code because the `target` option did not exist (every case answered the attack script).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS = resolve(ROOT, "web/assets/battle/models");
const dj = JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/digimon.json"), "utf8"));
const tech = JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/fight_tech_table.json"), "utf8"));
const items = JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/items.json"), "utf8"));
const itemRows = Array.isArray(items) ? items : (items.items ?? []);
const itemUsePath = resolve(ROOT, "web/assets/data/item_use_effects.json");
const itemUse = existsSync(itemUsePath) ? JSON.parse(readFileSync(itemUsePath, "utf8")) : { records: [] };

const ft = await import(resolve(ROOT, "web/fight/fight-tables.js"));
const cf = await import(resolve(ROOT, "web/fight/clip-fallback.js"));
ft.setTechTable(tech);
ft.setSkillTable(dj);
ft.setItemUseEffects(itemUse);
cf.setFallbackDonor(JSON.parse(readFileSync(resolve(MODELS, "m005grey/anim.json"), "utf8")).actions);

const has = (s, op, word0) => (s?.ops ?? []).some((o) => o.op === op && (word0 == null || (o.words?.[0] | 0) === word0));
const load = (f) => { const m = JSON.parse(readFileSync(resolve(MODELS, f, "anim.json"), "utf8")); m.folder = f; return m; };
const index = JSON.parse(readFileSync(resolve(MODELS, "index.json"), "utf8"));

test("the technique class is the disc's own type column: exactly the 22 heal/support records are self", () => {
  const self = dj.skills.filter((s) => ft.techTargetClass(s.id) === "self");
  const expect = dj.skills.filter((s) => s.type === "heal" || s.type === "support");
  assert.equal(self.length, 22);
  assert.deepEqual(self.map((s) => s.id).sort((a, b) => a - b), expect.map((s) => s.id).sort((a, b) => a - b));
  // a plain attack stays enemy, including the three records that share clip 10 with the item path
  assert.equal(ft.techTargetClass(1), "enemy");
  assert.equal(ft.techTargetClass(184), "self");
  const clip10Attacks = dj.skills.filter((s) => s.clip === 10 && s.type === "attack");
  assert.ok(clip10Attacks.length > 0);
  for (const s of clip10Attacks) assert.equal(ft.techTargetClass(s.id), "enemy", `tech ${s.id} is an attack despite clip 10`);
});

test("the item class: the default clip-10 arm is self, the throw band is an attack", () => {
  assert.equal(ft.itemTargetClass(43), "self");     // PowerCharge, a healing item
  assert.equal(ft.itemTargetClass(76), "self");
  assert.equal(ft.itemTargetClass(77), "enemy");    // the typed throw arm
  assert.equal(ft.itemTargetClass(90), "enemy");
  const defaults = itemRows.map((r) => r.id | 0).filter((id) => id > 0 && !(id >= 77 && id <= 90));
  for (const id of defaults) assert.equal(ft.itemTargetClass(id), "self");
});

test("a self cast has no projectile, no strike contact, no reaction, and its effect on the caster", () => {
  const models = ["m441raiz", "m175krsr", "m190bolt", "m115muge", "m003agum", "m468agnm"].map(load);
  for (const m of models) {
    for (const clip of [10, 11]) {
      const s = cf.resolveClipScript(m, clip, { element: 1, target: "self" });
      assert.ok(s, `${m.folder} clip ${clip} has no self script`);
      assert.equal(has(s, 1), false, `${m.folder} clip ${clip}: op1 reaction`);
      assert.equal(has(s, 6, 0), false, `${m.folder} clip ${clip}: projectile`);
      // a bare op10 99 in an AUTHORED item clip is the item's sound cue (the disc's own clip 10 has one,
      // with no op1 and no victim-facing record); a BUILT self script has no op10 at all.
      if (s.synthesized) assert.equal(has(s, 10, 98) || has(s, 10, 99), false, `${m.folder} clip ${clip}: strike contact`);
      assert.equal(cf.scriptIsSelfCast(s), true, `${m.folder} clip ${clip}: not a self-shaped script`);
      const spawn = (s.ops ?? []).filter((o) => o.op === 3 && (o.words?.[0] | 0) === 0);
      if (s.synthesized) {
        assert.ok(spawn.some((o) => (o.words?.[1] | 0) === 9999), `${m.folder} clip ${clip}: no current-effect spawn`);
        assert.ok(spawn.every((o) => (o.words?.[4] | 0) === 32767 || Math.abs(o.words?.[4] | 0) < 1000), `${m.folder} clip ${clip}: effect on the victim line`);
        // the disc's own clip-10 camera convention: preset 3 (the near slot) in, preset 0 out
        const cams = (s.ops ?? []).filter((o) => o.op === 5).map((o) => o.words);
        assert.deepEqual(cams[0], [60, 0, 3], `${m.folder} clip ${clip}: camera in`);
        assert.deepEqual(cams[cams.length - 1], [60, 0, 0], `${m.folder} clip ${clip}: camera out`);
      }
      // the caster stays planted: no absolute leap (op2 3) and no contact dash (op2 8)
      assert.equal((s.ops ?? []).some((o) => o.op === 2 && [3, 8].includes(o.words?.[0] | 0)), false, `${m.folder} clip ${clip}: locomotion`);
    }
  }
});

test("the enemy path is untouched: a built attack still carries its contacts and reactions", () => {
  const m = load("m441raiz");    // no clip 5: built from its own spell table, contacts + op1 from A7b
  const s = cf.resolveClipScript(m, 5, { element: 1, target: "enemy" });
  assert.ok(s && has(s, 10, 99), "the built basic must fire its strike");
  assert.ok(has(s, 1, 0), "the built basic must ask its reaction");
  assert.notEqual(s.buildKind, "self");
  const own = cf.resolveClipScript(m, 10, { target: "enemy" });
  assert.equal(has(own, 1), true, "an enemy-targeted clip-10 technique still plays the model's own attack script");
});

test("the self build holds a calm body table of the model and moves it (not a frozen pose)", () => {
  for (const folder of ["m441raiz", "m175krsr", "m190bolt", "m003agum"]) {
    const m = load(folder);
    const s = cf.resolveClipScript(m, 10, { target: "self" });
    const binds = (s.ops ?? []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0).map((o) => o.words[2] | 0);
    const body = binds.find((t) => t !== 1 && (m.timeline?.[t]?.table?.length ?? 0) > 0);
    assert.ok(body != null, `${folder}: no body table`);
    const hold = Math.max(...(s.ops ?? []).filter((o) => o.op === 11).map((o) => o.words?.[0] | 0));
    assert.ok(hold >= 10, `${folder}: held ${hold} frames`);
  }
});

test("every model in the index answers a self script for a support technique and an item", () => {
  for (const folder of index) {
    const m = load(folder);
    if (!m) continue;
    for (const [clip, label] of [[10, "item"], [10, "heal"], [11, "support-11"]]) {
      const s = cf.resolveClipScript(m, clip, { target: "self" });
      assert.ok(s, `${folder}: no self script for ${label}`);
      assert.equal(has(s, 1), false, `${folder} ${label}: op1`);
      assert.equal(has(s, 6, 0), false, `${folder} ${label}: projectile`);
    }
  }
});
