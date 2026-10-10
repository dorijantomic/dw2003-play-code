// The Galacticmon finale's phase machinery, as the walker now runs it: the battle-kind
// word's 4 -> 5 -> 6 advance, the copied technique, and the kind-6 fixed roll.
//
// Decode: ledger claim wfightmn-finale-kinds-2026-10-10 + section 14 of
// docs/research/battle/3d-battle-complete-model-2026-08-19.md. What a player meets:
// you fight the tail; when it falls the game says "What! The body?!" and the body's
// Ragnarok Cannon drops your Digimon to 1 HP; then the head takes over, attacks with a
// technique it copied from you ("Galacticmon learned a technique!"), and from the head
// phase on your own attacks roll the fixed `(rand & 0x7f) >= 0x2b` (~2-in-3).
//
// This file pins the engine port (engine/dw3/battle-finale.ts) and the wiring in
// web/battle.js, so a future edit cannot quietly drop the phases again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FINALE_KIND_TAIL, FINALE_KIND_BODY, FINALE_KIND_HEAD,
  FINALE_MSG_BODY, FINALE_MSG_LEARNED, FINALE_HEAD_ATTACK_ID,
  FINALE_TAIL_DEFEAT_BEATS, finaleBattleKind, finaleRecordsTechnique, finaleCopiedAttackSkill,
} from "../engine/index.ts";

const battleJs = () => readFileSync("web/battle.js", "utf8");
const techRows = () => JSON.parse(readFileSync("web/assets/data/fight_tech_table.json", "utf8"));
const skillRows = () => Object.fromEntries(
  JSON.parse(readFileSync("web/assets/data/digimon.json", "utf8")).skills.map((s) => [s.id, s]));

// ── 1. the three phases as beats ────────────────────────────────────────────

test("the tail's fall starts three beats: body, cannon, head", () => {
  assert.equal(FINALE_TAIL_DEFEAT_BEATS.length, 3);
  // Setup writes kind 4; arm 18 writes 5 (body), the kind-5 object's cannon runs under
  // 5, arm 22 writes 6 (head) before the head is spawned.
  assert.deepEqual(FINALE_TAIL_DEFEAT_BEATS.map((b) => b.kind),
    [FINALE_KIND_BODY, FINALE_KIND_BODY, FINALE_KIND_HEAD]);
  // The walker's three-member gauntlet stands in for the disc's spawns: member 0 is
  // the tail (the fight just lost), 1 the body, 2 the head.
  assert.deepEqual(FINALE_TAIL_DEFEAT_BEATS.map((b) => b.member), [1, 1, 2]);
  // Beat 0 is arm 18's default sub-state's line, esmfight 0x8B.
  assert.equal(FINALE_MSG_BODY, 0x8b);
  assert.equal(FINALE_TAIL_DEFEAT_BEATS[0].message, FINALE_MSG_BODY);
  // Beat 1 is the cannon alone: no line of its own beyond the damage page.
  assert.equal(FINALE_TAIL_DEFEAT_BEATS[1].cannon, true);
  assert.equal(FINALE_TAIL_DEFEAT_BEATS[1].message, null);
  // Beat 2 takes the field as the head and prints arm 22's state-2 line, esmfight 0x8C.
  assert.equal(FINALE_MSG_LEARNED, 0x8c);
  assert.equal(FINALE_TAIL_DEFEAT_BEATS[2].head, true);
  assert.equal(FINALE_TAIL_DEFEAT_BEATS[2].message, FINALE_MSG_LEARNED);
  assert.equal(FINALE_TAIL_DEFEAT_BEATS[2].cannon, false);
});

test("the live kind word is setup's value until the finale advances", () => {
  // The kind word (0x800a4536) is 4 for the whole tail fight; only the beats move it.
  assert.equal(finaleBattleKind(4, null), FINALE_KIND_TAIL);
  assert.equal(finaleBattleKind(4, undefined), FINALE_KIND_TAIL);
  assert.equal(finaleBattleKind(4, FINALE_KIND_BODY), FINALE_KIND_BODY);
  assert.equal(finaleBattleKind(4, FINALE_KIND_HEAD), FINALE_KIND_HEAD);
  // Ordinary battles keep their setup value (no finale phase ever applies).
  assert.equal(finaleBattleKind(0, null), 0);
  assert.equal(finaleBattleKind(2, null), 2);
  // The phase kinds are the disc's own literals: setup 4 (wfightmn.s:1067-1068),
  // arm 18 sub-state 5 (wfightmn.s:3491-3492), arm 22 entry (wfightmn.s:3786-3787).
  assert.equal(FINALE_KIND_TAIL, 4);
  assert.equal(FINALE_KIND_BODY, 5);
  assert.equal(FINALE_KIND_HEAD, 6);
});

// ── 2. the kind-6 fixed roll fires only in the head phase ───────────────────

test("the player's fixed roll governs the head phase alone", async () => {
  const { rollHit, rollMagicHit } = await import("../engine/index.ts");
  const at = (v) => () => v;
  const skill = { base_acc: 200 };
  const enemy = { spd: 1, wis: 1, level: 1 };
  // A player who would never miss on the ordinary formula: chance = 200 + 1128.
  const player = { spd: 5000, wis: 5000, level: 99, sideByte: 0, crit: 0 };
  for (const kind of [FINALE_KIND_TAIL, FINALE_KIND_BODY]) {
    assert.equal(rollHit({ ...player, battleKind: kind }, enemy, skill, at(0x2a)), true,
      `kind ${kind}: the ordinary formula lands`);
    assert.equal(rollMagicHit({ ...player, battleKind: kind }, enemy, skill, at(0x2a)), true,
      `kind ${kind}: the magical leaf lands`);
  }
  // The head phase: `(rand & 0x7f) >= 0x2b` whatever the stats say — 0x2a misses.
  assert.equal(rollHit({ ...player, battleKind: FINALE_KIND_HEAD }, enemy, skill, at(0x2a)), false);
  assert.equal(rollHit({ ...player, battleKind: FINALE_KIND_HEAD }, enemy, skill, at(0x2b)), true);
  assert.equal(rollMagicHit({ ...player, battleKind: FINALE_KIND_HEAD }, enemy, skill, at(0x2a)), false);
  assert.equal(rollMagicHit({ ...player, battleKind: FINALE_KIND_HEAD }, enemy, skill, at(0x2b)), true);
});

// ── 3. the copied technique ─────────────────────────────────────────────────

test("the latch takes the disc's own qualifying technique rows", () => {
  const row = (over = {}) => ({ category: 2, elem1: 1, dispatch: 1, clip: 9, ...over });
  // `+0x07 >= 2` qualifies on its own; otherwise `+0x0a >= 2`, with 9, 10 and 12 out.
  assert.equal(finaleRecordsTechnique(4, 0, row()), false, "elem1 1 with dispatch 1 does not qualify");
  assert.equal(finaleRecordsTechnique(4, 0, row({ elem1: 2 })), true);
  assert.equal(finaleRecordsTechnique(4, 0, row({ dispatch: 2 })), true);
  assert.equal(finaleRecordsTechnique(4, 0, row({ dispatch: 8 })), true);
  assert.equal(finaleRecordsTechnique(4, 0, row({ dispatch: 9 })), false);
  assert.equal(finaleRecordsTechnique(4, 0, row({ dispatch: 10 })), false);
  assert.equal(finaleRecordsTechnique(4, 0, row({ dispatch: 12 })), false);
  // The clip byte excludes 5 and 12 even when elem1 would qualify.
  assert.equal(finaleRecordsTechnique(4, 0, row({ elem1: 5, clip: 5 })), false);
  assert.equal(finaleRecordsTechnique(4, 0, row({ elem1: 5, clip: 12 })), false);
  // The caller's category gate: only the two attack categories reach the applier.
  assert.equal(finaleRecordsTechnique(4, 0, row({ category: 4, elem1: 5 })), false);
  assert.equal(finaleRecordsTechnique(4, 0, row({ category: 5, elem1: 5 })), false);
  // Player side and the tail phase only: the kind word must still be 4.
  assert.equal(finaleRecordsTechnique(4, 0x10, row({ elem1: 5 })), false);
  assert.equal(finaleRecordsTechnique(5, 0, row({ elem1: 5 })), false);
  assert.equal(finaleRecordsTechnique(6, 0, row({ elem1: 5 })), false);
  assert.equal(finaleRecordsTechnique(4, 0, null), false);
  // Real shipped rows: Boom Bubble (60) is a wind technique with clip 11 and latches;
  // Swing Swing (54) latches through dispatch 11; the Fight rows (435, clip 9) and
  // Galacticmon's own 438 (clip 5) never do.
  const tech = techRows();
  assert.equal(finaleRecordsTechnique(4, 0, tech["60"]), true, "Boom Bubble (elem1 5, clip 11)");
  assert.equal(finaleRecordsTechnique(4, 0, tech["54"]), true, "Swing Swing (dispatch 11, clip 11)");
  assert.equal(finaleRecordsTechnique(4, 0, tech["435"]), false, "Fight (elem1 1, dispatch 1)");
  assert.equal(finaleRecordsTechnique(4, 0, tech["438"]), false, "clip 5 excludes it");
});

test("the copied attack takes the recorded row's fields, keeping the head's own id and name", () => {
  // The head's attack record is technique 440 — 0x80044aba = 0x80042bca + 18 * 440,
  // enemies.json's `attack` for Galacticmon3, whose shipped name is "?????".
  assert.equal(FINALE_HEAD_ATTACK_ID, 440);
  const head = { id: 440, name: "?????", element: "normal", damage_scalar: 1, effect_id: 1, effect_power: 127, clip: 9 };
  const copied = finaleCopiedAttackSkill(head, { element: "wind", damage_scalar: 72, effect_id: 1, effect_power: 1, clip: 9 });
  assert.equal(copied.id, 440, "the attack id stays the head's own");
  assert.equal(copied.name, "?????", "the record carries no name: the head keeps its own");
  assert.equal(copied.element, "wind");
  assert.equal(copied.damage_scalar, 72);
  assert.equal(copied.effect_id, 1);
  assert.equal(copied.effect_power, 1);
  // Arm 22's own skip: rows whose clip is 5 or 12 are not copied.
  assert.deepEqual(finaleCopiedAttackSkill(head, { element: "wind", clip: 5 }), head);
  assert.deepEqual(finaleCopiedAttackSkill(head, { element: "wind", clip: 12 }), head);
  // A zero latch leaves the head's own attack untouched (arm 22's zero-index path).
  assert.deepEqual(finaleCopiedAttackSkill(head, null), head);
  assert.deepEqual(finaleCopiedAttackSkill(head, undefined), head);
  // With the shipped rows: skill 440 gains Boom Bubble's (60) element and scalar.
  const skills = skillRows();
  const merged = finaleCopiedAttackSkill(skills[440], skills[60]);
  assert.equal(merged.id, 440);
  assert.equal(merged.name, "?????");
  assert.equal(merged.element, skills[60].element);
  assert.equal(merged.damage_scalar, skills[60].damage_scalar);
  assert.equal(merged.effect_id, skills[60].effect_id);
  assert.equal(merged.effect_power, skills[60].effect_power);
  assert.notEqual(merged.damage_scalar, skills[440].damage_scalar, "the scalar actually changes");
});

// ── 4. the walker's wiring ──────────────────────────────────────────────────

test("the walker runs the beats on the tail's fall instead of a plain gauntlet swap", () => {
  const src = battleJs();
  const at = src.indexOf("function defeatCurrentEnemy");
  assert.ok(at > 0);
  const arm = src.slice(at, src.indexOf("\n  function runFinaleBeat", at));
  assert.ok(arm.includes("b.specialMode === 4 && b.partyIndex === 0 && b.party.length === 3"),
    "the finale branch is keyed on the battle's own mode word and the three-member party");
  assert.ok(arm.includes("runFinaleBeat(b, 0);"), "the tail's fall starts beat 0");
  // Never a per-battle name or screen-id check: the branch reads the mode word alone.
  const cond = arm.slice(arm.indexOf("if (b.specialMode === 4"), arm.indexOf("runFinaleBeat(b, 0);"));
  assert.ok(!/Galacticmon|screenId/.test(cond), "no encounter name or screen id in the branch");
});

test("each beat stamps the live kind onto both records", () => {
  const src = battleJs();
  const at = src.indexOf("function runFinaleBeat");
  assert.ok(at > 0);
  const beat = src.slice(at, src.indexOf("\n  function recordFinaleTechnique", at));
  assert.ok(beat.includes("b._finaleKind = beat.kind;"), "the live kind word advances");
  assert.ok(beat.includes("b.player.battleKind = beat.kind;"), "the player's record carries it");
  assert.ok(beat.includes("next.battleKind = beat.kind;"), "a member taking the field carries it");
  // Beat 1 is the cannon: the current Digimon is set to 1 HP.
  assert.ok(beat.includes("b.player.hp = 1;"));
  // Beat 2 rebuilds the head's attack from the recorded row.
  assert.ok(beat.includes("FINALE_HEAD_ATTACK_ID"));
  assert.ok(beat.includes("finaleCopiedAttackSkill(base, recorded)"));
  assert.ok(beat.includes("b._finaleCopiedAttack ="));
  // The two lines are the disc's own, through the shared message machinery.
  assert.ok(beat.includes("payload: [FINALE_MSG_BODY]"), "\"What! The body?!\" is kind 1 with 0x8B");
  assert.ok(beat.includes("kind: 22, payload: [0], slots: [techName]"),
    "\"Galacticmon learned a technique!\" is kind 22 with the copied name");
  // The last beat hands the command menu to the player — the walkthrough's "you
  // should get first attack on the head".
  assert.ok(beat.includes("? ST.PLAYER_MENU : ST.NONE"), "only the head beat opens the menu");
});

test("the beats chain through the result pages, and the latch records the tail-phase technique", () => {
  const src = battleJs();
  assert.ok(src.includes("if (b._finaleAfter) { const run = b._finaleAfter; b._finaleAfter = null; run(); b.timer = 0; return; }"),
    "advanceAfterResult runs the next beat once the pages are read");
  // The latch (F0x800aa06c) sits at the two landed damaging commits that carry a
  // technique row — the basic attack's and the technique's — before the wrapper.
  const calls = src.match(/recordFinaleTechnique\(b, (basicTechId|actionTechId)\)/g) || [];
  assert.equal(calls.length, 2, "the basic and technique commits");
  const rec = src.slice(src.indexOf("function recordFinaleTechnique"), src.indexOf("function applyTagAction"));
  assert.ok(rec.includes("finaleRecordsTechnique(battleKindOf(b), 0, row)"),
    "the engine predicate carries the whole gate");
  assert.ok(rec.includes("b._finaleRecordedTechId = techniqueId | 0;"), "the index is latched");
});

test("the kind word drives the rolls, the counter and the head's attack from the live value", () => {
  const src = battleJs();
  // Setup stamps the live kind instead of a frozen copy of specialMode.
  assert.ok(src.includes("rec.battleKind = battleKindOf(battle);"));
  // The boss04 counter runs only while kind == 6.
  const note = src.slice(src.indexOf("function noteFinalBossPhaseDamage"), src.indexOf("function frozenGateLosesTurn"));
  assert.ok(note.includes("if (battleKindOf(b) !== 6) return;"), "the counter's kind gate");
  assert.ok(note.includes("finalBossPhaseSwitchesTrack(b.specialMode, battleKindOf(b), b._bossPhaseCount)"));
  // The head's attack (id 440) serves the rebuilt record.
  assert.ok(src.includes("if (b._finaleCopiedAttack && (requestedSkillId | 0) === FINALE_HEAD_ATTACK_ID) skill = b._finaleCopiedAttack;"));
  // The switch itself is the pure, kind-gated rule.
  assert.ok(src.includes("return specialMode === 4 && battleKind === 6 && landedCount >= 3;"));
});
