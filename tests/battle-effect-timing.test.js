// The special-attack backdrop STARTS at the acting clip's own play-motion op — not on a timer.
//
// THE RULE (from the disc). A technique's per-element backdrop is selected by its action script's
// own play-motion opcode:
//   FIGHTSTG_F0x8008c2cc  (op4)          ~/ddw3/asm/dw2003/pro/fightstg.s:9566
//     :0x8008c2d8 li $a0, 0x15 / ... jalr [0x8004b7bc]   -- fetch the class-0x15 scene object
//     :0x8008c2fc..:0x8008c320  read the op's motion id; word 0x38 -> the actor's +0x68
//     :0x8008c364 lw $v0, 0xe8($a0)          -- the object's +0xe8 selector
//     :0x8008c36c jalr $v0 / :0x8008c370 move_ $a1, $s0
//   FIGHTSTG_F0x800868c0  (+0xe8)        fightstg.s:3921
//     stores the motion at +0x50 and restarts the object through +0x28(state 2)
//   FIGHTSTG_F0x80086304  (the rebuild)  fightstg.s:3552
//     indexes SFSTDATA with +0x50: rec = base + [obj+0x50]*0x58, and rec[+0x00]/[+0x04] build
//     the scene -> MEFT10<motion>.
// A later op4 naming motion 0 (the `op4[0,0,..]` return-to-base every attack clip ends on)
// re-selects the area arena, so the backdrop comes back down at the clip's own final op.
//
// THE FIELD TECHNIQUE (clip 15) is `op4[1,56] / op4[0,56,15,15] / wait 90 / op4[0,0,30,30] /
// wait 60`, so its backdrop switches in at the clip's SECOND op — the cast's first frame. The
// walker used to put it up on a hardcoded 850 ms wall clock from the cast's start
// (`BD_DELAY_MS`), which with the walker's 2x animation step landed at the cast's END.
//
// WHAT THIS TEST HOLDS. The four attack entry points arm the backdrop from the clip's op4
// (`armDataField` + `dataFieldMotion`) and no longer call the wall-clock `triggerDataField`;
// and the art is unchanged (the field technique's op4 motion and its sigEffect resolve to the
// same pack, meft1034). `tools/_probe_cb_effect_timing.mjs` is the on-screen before/after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const battle3d = readFileSync(resolve("web/battle3d.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve("web/assets/battle/backdrops/manifest.json"), "utf8"));
const sfstdata = JSON.parse(readFileSync(
  resolve("docs/research/fight-3d/data/sfstdata_effect_table.json"), "utf8"));
const TECH = JSON.parse(readFileSync(resolve("web/assets/data/fight_tech_table.json"), "utf8"));

test("the four attack entry points arm the backdrop from the clip's op4, not a timer", () => {
  // setPlayerAnimByTech / setEnemyAnimByTech / playerAttack / enemyAttack.
  const arms = battle3d.match(/armDataField\(techId\);/g) || [];
  assert.equal(arms.length, 4,
    `expected the four attack entry points to arm the backdrop from the clip's op4 ` +
    `(armDataField), found ${arms.length}`);
  // NO attack entry point may trigger the wall-clock window any more. `triggerDataField`
  // survives only for the lab/debug `setDataField` (which passes an explicit `now`).
  assert.ok(!/triggerDataField\(techId\)/.test(battle3d),
    "an attack entry point still calls the wall-clock triggerDataField(techId); the backdrop " +
    "would again appear on a timer instead of at the clip's own play-motion op");
  assert.match(battle3d, /function dataFieldMotion\(motion\) \{[\s\S]{0,400}?else if \(m > 0\)/,
    "dataFieldMotion must resolve the op4 motion into the backdrop's on/off state");
  assert.match(battle3d, /dataFieldPinned \|\| dataFieldOn \|\| \(now >= dataFieldOnAt/,
    "dataFieldIsActive no longer honours the op4-driven `dataFieldOn`; the op-selected backdrop " +
    "would never draw");
});

test("both attackers feed their own clip's motion to the backdrop, the defenders do not", () => {
  // The attacker hooks carry `onMotion: dataFieldMotion`; the defender hooks must not, or a
  // reaction clip's op4 would take the backdrop down under the attacker's own effect.
  const atk = battle3d.match(/_impactContact\(\{ \.\.\.hooks, onMotion: dataFieldMotion \}\)/g) || [];
  assert.equal(atk.length, 2,
    `expected the player and enemy attacker hooks to carry onMotion: dataFieldMotion, found ${atk.length}`);
  assert.match(battle3d, /function dataFieldMotion\(motion\) \{\s*\n\s*if \(!dataFieldArmed\) return;/,
    "dataFieldMotion must do nothing when the cast in flight has no element pack (a basic attack)");
});

test("the art is unchanged: the field technique's op4 motion and its sigEffect name one pack", () => {
  // Fire Field (tech 213) animates clip 15. Its walker pack comes from the manifest by
  // sigEffect; the disc's comes from the clip's op4 motion through SFSTDATA. Both must be the
  // flame pack, so the fix moved only WHEN it appears, not WHICH one.
  const rec = TECH["213"];
  assert.equal(rec.clip, 15, "Fire Field must still animate clip 15");
  const sig = manifest.byTech["213"];
  assert.equal(sig, rec.sigEffect, "the manifest's byTech must be keyed by the record's sigEffect");
  const packFromSig = manifest.bySig[String(sig)].pack;
  assert.equal(packFromSig, "meft1034", "Fire Field's sigEffect must resolve to the flame pack");

  // The clip's own op4 motion, read from every shipped model that has clip 15.
  const models = ["web/assets/battle/models/m003agum/anim.json"];
  const action = JSON.parse(readFileSync(resolve(models[0]), "utf8")).actions[15];
  const ops = action.ops.map((o) => [o.op, (o.words || []).slice()]);
  assert.deepEqual(ops[0][0], 4, "clip 15 must open with the play-motion op");
  const motion = ops.find((o) => o[0] === 4 && o[1][1] !== 0)[1][1];
  // SFSTDATA[motion] -> MEFT10<motion> (record 56 is the fire pack, aliased from record 34).
  const row = sfstdata.records.find((r) => r.index === motion);
  assert.ok(row, `SFSTDATA has no record ${motion}`);
  assert.equal(row.meft.toLowerCase().replace("_bin", ""), packFromSig,
    `the clip's op4 motion ${motion} -> ${row.meft} must be the same pack the walker draws ` +
    `(${packFromSig}); if they diverge the fix changed the art, not just the timing`);
});
