// BRIEF4 Phase 4c regressions, asserted as an INVARIANT over the whole cross product. No species names in the
// logic: every case comes from the model index, the donor map and the packs themselves.
//
// What broke for the operator:
//   (1) the "being hit" effect played on the attacker's own body — the compact build spawned the SCREEN-space
//       spark (`op3 [..,32767]`) and installed no camera, so it drew at the arena shot's centre, over the caster;
//   (2) a killing blow never played the enemy's death clip — the compact build carried no op1 record, so the
//       coordinator's op1 dispatch never selected the defender's reaction (1 flinch / 2 survive / 3 death /
//       4 evade).
//
// The invariants below are what the scripts this module BUILDS for enemy-targeted techniques (buildKind
// body/cast/attack) must satisfy for EVERY model and clip of the index:
//   P1  every tick that fires op10 98 carries op1 [5]; every tick that fires op10 99 carries op1 [0]
//       (the disc's pairing, fight-coordinator.js:97-107);
//   P2  the script spawns its strike effect at exactly `victimAnchor(model)` — world space, on the opposite
//       fighter's home line in the model's own arena frame — and never the plain hit spark in screen space;
//   P3  the two anchors are exact mirrors (selfAnchor = -victimAnchor) and the animator's turn (mirrorOps)
//       moves each onto the other fighter, which is what makes one build correct on either arena side (C9);
//   P4  an authored script is never rewritten, and every model resolves to a determined authored side.
//
// The browser proof that these invariants produce the right pixels is tools/verify_attack_reaction.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ANIM_DONOR_GAPS } from "../web/fight/anim-donor-map.js";
import { resolveClipScript, prepareModelDonors, registerDonorAnim, setFallbackDonor,
         victimAnchor, selfAnchor } from "../web/fight/clip-fallback.js";
import { authoredSide, mirrorOps } from "../web/fight/side-mirror.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE_PACKS = fs.existsSync(path.join(MODELS, "index.json"));
const skip = HAVE_PACKS ? false : "model packs are not installed";

const VICTIM_LINE = 5120;
const CONTACT = 98, STRIKE = 99, SPARK = 2, WAIT = 11, END = 255;
const CLIPS = [5, 9, 10];
const SCREEN_Z = (z) => z === 32767 || z === -1 || Math.abs(z) > 20000;

const read = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
const index = HAVE_PACKS ? JSON.parse(fs.readFileSync(path.join(MODELS, "index.json"), "utf8")) : [];
const folders = Array.isArray(index) ? index : (index.models ?? []);
const own = (model, clip) => !!model?.actions?.[clip]?.ops?.length;

// ── the data the cases come from ────────────────────────────────────────────────
if (HAVE_PACKS) {
  // every donor the map names, read once
  const donors = new Set();
  for (const gaps of Object.values(ANIM_DONOR_GAPS)) for (const row of Object.values(gaps)) donors.add(row.d);
  for (const d of donors) registerDonorAnim(d, read(d));
  // The last-resort donor is whichever pack carries the most non-empty clips (a full player pack) — derived from
  // the data, not named, so the test follows the same rule the builder does.
  let best = null, bestN = -1;
  for (const f of folders) {
    const a = read(f).actions;
    const n = Array.isArray(a) ? a.filter((s) => s?.ops?.length).length : 0;
    if (n > bestN) { bestN = n; best = f; }
  }
  setFallbackDonor(read(best).actions);
}

const prepared = new Map();
/** Every model of the index, with the donor clips its gaps need attached (as the battle loader leaves it). */
async function models() {
  if (prepared.size) return prepared;
  for (const f of folders) {
    const m = read(f);
    await prepareModelDonors(m);
    prepared.set(f, m);
  }
  return prepared;
}

/** ops split into VM ticks: a wait (op11) or the end (op255) closes one. */
function ticks(ops) {
  const out = [[]];
  for (const o of ops) {
    out[out.length - 1].push(o);
    if (o.op === WAIT || o.op === END) out.push([]);
  }
  return out.filter((t) => t.length);
}
const hasOp = (tick, op, word) => tick.some((o) => o.op === op && (word == null || (o.words?.[0] | 0) === word));

test("P1/P2: every built enemy script pairs each contact and spawns its effect on the victim", { skip }, async () => {
  const bad = [];
  let checked = 0;
  for (const [folder, model] of await models()) {
    for (const clip of CLIPS) {
      if (own(model, clip)) continue;                                  // authored data: P4 covers it
      const script = resolveClipScript(model, clip, { element: 1, target: "enemy" });
      if (!script?.ops?.length) continue;                              // nothing to play: the caller idles
      if (!["body", "cast", "attack"].includes(script.buildKind)) continue;   // borrow/last resort keep the donor's shape
      checked++;
      const anchor = victimAnchor(model);
      // P1, CALIBRATED ON THE DISC (the original player packs are ground truth): the op1 that answers a contact is
      // not always in the contact's own tick and not always after it — some authored basics write it just BEFORE
      // the contact (m224mdev) and some a tick later (m140mtrn). What every authored script does guarantee is that
      // the reaction request EXISTS for the contact type it fires; withReactions() restores exactly that when a
      // build drops it. A build this module assembles itself (buildKind body) is held to the stricter same-tick
      // rule, which is what bodyFromTable emits.
      // the reaction request is only a DISC rule for the attack clips: 54 of the 69 own clip-10 scripts (item use,
      // which has no victim on the disc) fire a contact with no op1 at all, so clip 10 is exempt from P1 and is
      // only measured, never required, by the browser harness too
      const any = (op, mode) => script.ops.some((x) => x.op === op && (x.words?.[0] | 0) === mode);
      const contacts = script.ops.filter((o) => o.op === 10).map((o) => o.words?.[0] | 0);
      if (clip !== 10 && contacts.includes(CONTACT) && !any(1, 5)) bad.push(`${folder} c${clip}: an op10 98 fires with no op1 [5] anywhere`);
      if (clip !== 10 && contacts.includes(STRIKE) && !any(1, 0)) bad.push(`${folder} c${clip}: an op10 99 fires with no op1 [0] anywhere`);
      if (script.buildKind === "body") {
        for (const tick of ticks(script.ops)) {
          if (hasOp(tick, 10, CONTACT) && !hasOp(tick, 1, 5)) bad.push(`${folder} c${clip}: 98 and op1 [5] in different ticks`);
          if (hasOp(tick, 10, STRIKE) && !hasOp(tick, 1, 0)) bad.push(`${folder} c${clip}: 99 and op1 [0] in different ticks`);
        }
      }
      const spawns = [];
      script.ops.forEach((o, i) => {
        if (o.op === 3 && (o.words?.[0] | 0) === 0 && o.words.length >= 5) {
          spawns.push({ i, type: o.words[1] | 0, x: o.words[2] | 0, y: o.words[3] | 0, z: o.words[4] | 0 });
        }
      });
      if (!spawns.some((f) => f.x === anchor.x && f.y === anchor.y && f.z === anchor.z)) {
        bad.push(`${folder} c${clip}: no effect at the victim anchor (${anchor.x},${anchor.y},${anchor.z}); ` +
          `world spawns: ${spawns.map((f) => `t${f.type} (${f.x},${f.y},${f.z})`).join(" ") || "none"}`);
      }
      // A screen-space spawn is legal only under a camera cut TO THE VICTIM: that is how an authored basic lands its
      // own spark (the pair op5 [..,0,1] then op3 [..,32767]), and a cast body inherits the cut with the spark.
      for (const f of spawns) {
        if (!SCREEN_Z(f.z)) continue;
        const cut = script.ops.slice(0, f.i).reverse().find((o) => o.op === 5);
        const toVictim = cut && (cut.words?.[1] | 0) === 0 && (cut.words?.[2] | 0) === 1;
        if (f.type === SPARK && !toVictim) {
          bad.push(`${folder} c${clip}: a screen-space hit spark with no cut to the victim (it draws over the caster)`);
        }
      }
    }
  }
  assert.ok(checked > 0, "the index produced built scripts to check");
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} of ${checked} built scripts violate P1/P2`);
});

test("P3: the two anchors are exact mirrors, and the turn lands each on the other fighter", { skip }, async () => {
  const bad = [];
  for (const [folder, model] of await models()) {
    const v = victimAnchor(model), s = selfAnchor(model);
    const want = authoredSide(model) === "enemy" ? -VICTIM_LINE : VICTIM_LINE;
    if (v.z !== want || s.z !== -want) {
      bad.push(`${folder}: anchors v${v.z}/s${s.z}, want ±${VICTIM_LINE} for a ${authoredSide(model)}-authored pack`);
      continue;
    }
    const turned = mirrorOps([{ op: 3, words: [0, SPARK, v.x, v.y, v.z] }])[0].words[4] | 0;
    if (turned !== s.z) bad.push(`${folder}: mirroring the victim anchor ${v.z} gave ${turned}, not the caster's ${s.z}`);
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} models have non-mirrored anchors`);
});

test("P4: authored scripts are never rewritten, and every model has a determined authored side", { skip }, async () => {
  const bad = [];
  for (const [folder, model] of await models()) {
    const side = authoredSide(model);
    if (side !== "player" && side !== "enemy") bad.push(`${folder}: authored side ${side}`);
    for (const clip of CLIPS) {
      const script = model.actions?.[clip];
      if (!script?.ops?.length) continue;
      if (resolveClipScript(model, clip, { element: 1, target: "enemy" }) !== script) {
        bad.push(`${folder} c${clip}: an authored script was replaced by a build on the enemy path`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} authored scripts were rewritten or a side is undetermined`);
});

test("P4b: a model with no action scripts is player-convention, so its build mirrors on the far side", { skip }, async () => {
  for (const [folder, model] of await models()) {
    if (Array.isArray(model.actions)) continue;
    assert.equal(authoredSide(model), "player", `${folder}: a model with no scripts of its own plays +z builds`);
    const script = resolveClipScript(model, 5, { element: 1, target: "enemy" });
    if (!script?.ops?.length) continue;
    const anchor = victimAnchor(model);
    const turned = mirrorOps(script.ops).filter((o) => o.op === 3 && o.words?.[0] === 0 && o.words.length >= 5)
      .map((o) => o.words[4] | 0);
    assert.ok(turned.every((z) => z === -anchor.z || SCREEN_Z(z)),
      `${folder}: the far-side turn must put the effect on the near victim`);
  }
});
