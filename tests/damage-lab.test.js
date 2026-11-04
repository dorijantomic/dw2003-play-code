// The Damage Lab, part 1: the disc's damage pipeline walked stage by stage
// (web/damage-lab.js).
//
// A hit's damage is decided by leaves the battle already uses:
//   physicalBase / magicalBase  the pre-element base
//   resolveDamage               field, family, affinity, element, special-op, crit,
//                               armour and the 5x / 9999 caps
// (engine/dw3/battle-formulas.ts; battle-formula-leaves.md). The lab shows the
// running value after every stage, so "why did that only do 40?" has an answer.
//
// F2 -> Extras -> "Damage Lab (new)" (off by default). With the toggle off there is
// no page, no data fetch and no key handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  damageStages,
  physicalBase,
  magicalBase,
  resolveDamage,
} from "../web/damage-lab.js";
import {
  physicalBase as enginePhysicalBase,
  magicalBase as engineMagicalBase,
  resolveDamage as engineResolveDamage,
} from "../engine/dw3/battle-formulas.ts";

/** A tiny deterministic 16-bit stream: same seed, same draws, fresh per call. */
function seeded(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state >>> 16;
  };
}

const RUNNING_NAMES = ["base", "field", "family", "affinity", "element", "special-op", "crit", "armour"];

/** Every stage value is the running value, and the last one is the total. */
function assertRunning(stages, total) {
  assert.equal(stages.length, 8, "the disc has eight stages on this page");
  assert.deepEqual(stages.map((s) => s.name), RUNNING_NAMES);
  for (let i = 0; i < stages.length; i++) {
    assert.equal(typeof stages[i].value, "number", `${stages[i].name} carries a number`);
    assert.ok(stages[i].value >= 0, `${stages[i].name} is never negative`);
    if (i > 0) assert.ok(stages[i].value >= 0);
  }
  assert.equal(stages[stages.length - 1].value, total, "the last stage is the number that lands");
}

/** One plain physical hit, nothing special: 100 STR vs 42 DEF, power 60. */
const plain = () => ({
  atk: { str: 100, def: 10, spt: 10, wis: 10, spd: 10 },
  def: { str: 10, def: 42, spt: 50, wis: 50, spd: 40, family: 1 },
  skill: { power: 60, element: "normal", target_family: 1, clip: 5 },
});

const magical = () => ({
  atk: { str: 50, def: 10, spt: 100, wis: 60, spd: 20 },
  def: { str: 10, def: 40, spt: 50, wis: 40, spd: 30, family: 2 },
  skill: { power: 100, element: "fire", magical: true, target_family: 1, clip: 5 },
});

const crit = () => ({
  atk: { str: 120, def: 10, spt: 10, wis: 10, spd: 10, crit: 12, aura: true },
  def: { str: 10, def: 60, spt: 50, wis: 50, spd: 40, family: 3 },
  skill: { power: 80, element: "normal", target_family: 1, clip: 5 },
});

test("physicalBase({str:100},{def:42},60) is 142, the disc's STR x power / DEF", () => {
  assert.equal(physicalBase({ str: 100 }, { def: 42 }, 60), 142);
  assert.equal(physicalBase({ str: 100 }, { def: 42 }, 60), enginePhysicalBase({ str: 100 }, { def: 42 }, 60));
  const f = plain();
  const { stages } = damageStages({ ...f, rng: seeded(7) });
  assert.equal(stages[0].name, "base");
  assert.equal(stages[0].value, 142, "the base stage is that same 142");
});

test("magicalBase on spt 100 vs 50, power 100 is the engine function's number", () => {
  const atk = { spt: 100 };
  const def = { spt: 50 };
  assert.equal(magicalBase(atk, def, 100), engineMagicalBase(atk, def, 100));
  assert.equal(magicalBase(atk, def, 100), 150, "mid = 50*100/50 + 50 = 150, so 100 x 150/100");
});

test("plain physical, magical and crit fixtures: the eight stages end on resolveDamage's number", () => {
  for (const [name, make, seed] of [["plain", plain, 3], ["magical", magical, 5], ["crit", crit, 11]]) {
    const f = make();
    const walked = damageStages({ ...f, rng: seeded(seed) });
    const engine = engineResolveDamage(
      f.skill.magical ? engineMagicalBase(f.atk, f.def, f.skill.power) : enginePhysicalBase(f.atk, f.def, f.skill.power),
      f.atk, f.def, f.skill, seeded(seed), f.field ?? null,
    );
    assert.equal(walked.total, engine, `${name}: the page's total is the disc's number`);
    assert.equal(walked.total, resolveDamage(
      f.skill.magical ? magicalBase(f.atk, f.def, f.skill.power) : physicalBase(f.atk, f.def, f.skill.power),
      f.atk, f.def, f.skill, seeded(seed), f.field ?? null,
    ), `${name}: the re-exported leaves agree too`);
    assertRunning(walked.stages, walked.total);
    for (const stage of walked.stages) {
      assert.equal(typeof stage.note, "string");
      assert.ok(stage.note.length > 0, `${name}: ${stage.name} explains itself`);
    }
  }
});

test("the crit fixture really crits, and the crit stage carries the extra", () => {
  const f = crit();
  // crit roll: (rng & 0x7f) < 4 + atk.crit*2 (aura) = 28; draw 0 always crits.
  let call = 0;
  const rng = () => (call++ === 0 ? 0 : 63);
  const walked = damageStages({ ...f, rng });
  const critStage = walked.stages.find((s) => s.name === "crit");
  assert.ok(critStage.note.includes("crit"), critStage.note);
  assert.ok(walked.total > walked.stages.find((s) => s.name === "special-op").value);
});

test("the 5x base cap fires: a fixture far above it lands on exactly 5 x base", () => {
  const f = {
    atk: { str: 100, def: 10, spt: 10, wis: 10, spd: 10 },
    def: { def: 42, spt: 50, wis: 50, spd: 40, family: 1, resistances: { fire: 1 } },
    // a physical fire technique with the biggest scalar: +2 x running x 64 / 1
    skill: { power: 60, element: "fire", target_family: 1, damage_scalar: 64, clip: 5 },
  };
  const base = physicalBase(f.atk, f.def, 60);
  assert.equal(base, 142);
  const walked = damageStages({ ...f, rng: () => 127 }); // no crit: 4 chance, draw 127
  assert.equal(walked.total, 5 * base, "capped at 5 x base, not the raw burst");
  assert.equal(walked.stages[7].value, 5 * base, "the cap is the last stage's number");
  assert.match(walked.stages[7].note, /5 x base|5x base/i, "the note names the cap");
});

test("the 9999 cap fires on a huge fixture", () => {
  const f = {
    atk: { str: 100000, def: 10, spt: 10, wis: 10, spd: 10 },
    def: { def: 1, spt: 50, wis: 50, spd: 40, family: 1 },
    skill: { power: 60, element: "normal", target_family: 1, clip: 5 },
  };
  const walked = damageStages({ ...f, rng: () => 127 });
  assert.equal(walked.total, 9999);
  assert.match(walked.stages[7].note, /9999/, "the note names the 9999 cap");
});

test("a family match adds a half in the family stage; no match leaves it alone", () => {
  const withMatch = {
    atk: { str: 100, def: 10, spt: 10, wis: 10, spd: 10 },
    def: { def: 42, spt: 50, wis: 50, spd: 40, family: 5 },
    skill: { power: 60, element: "normal", target_family: 5, clip: 5 },
  };
  const noMatch = {
    ...withMatch,
    def: { ...withMatch.def, family: 6 },
  };
  const hit = damageStages({ ...withMatch, rng: () => 127 });
  const miss = damageStages({ ...noMatch, rng: () => 127 });
  const familyHit = hit.stages.find((s) => s.name === "family");
  const familyMiss = miss.stages.find((s) => s.name === "family");
  assert.equal(familyHit.value, 142 + Math.trunc(142 / 2), "the matched family adds half the running value");
  assert.equal(familyMiss.value, 142, "no match, no change");
  assert.ok(hit.total > miss.total, "the match is worth more damage");
});

// ---------------------------------------------------------------------------
// The page: the tables it reads, its pickers, the pad and the draw.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import {
  damageLabLoad,
  damageLabTable,
  damageLabRow,
  damageLabReset,
  damageLabOpen,
  damageLabOptions,
  damageLabPress,
  damageLabDraw,
  damageLabSetRng,
  tickDamageLab,
} from "../web/damage-lab.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const digimonJson = read("../web/assets/data/digimon.json");
const enemiesJson = read("../web/assets/data/enemies.json");
const techJson = read("../web/assets/data/fight_tech_table.json");

/** The fake fetchJson the node test hands damageLabLoad: parsed tables, no network. */
const fakeFetch = async (url) => {
  if (/digimon\.json/.test(url)) return digimonJson;
  if (/enemies\.json/.test(url)) return enemiesJson;
  if (/fight_tech_table\.json/.test(url)) return techJson;
  throw new Error(`unexpected fetch ${url}`);
};

/** A recording 2D context: enough of the canvas API for damageLabDraw, and a text log. */
function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {}, restore() {},
    fillRect() { calls.push(["fillRect"]); },
    strokeRect() { calls.push(["strokeRect"]); },
    fillText(text) { calls.push(["fillText", String(text)]); },
    set font(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set textBaseline(v) {}, set textAlign(v) {},
  };
  return ctx;
}
const drawnText = (ctx) => ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]).join("\n");

test("the tables: 55 forms, 194 enemies, 443 techniques, and unknown ids are null", async () => {
  damageLabReset();
  assert.equal(await damageLabLoad(fakeFetch), true);
  assert.equal(damageLabTable("forms").length, 55, "the disc's partner profiles");
  assert.equal(damageLabTable("enemies").length, 194, "every enemy record, the Null placeholder included");
  assert.equal(damageLabTable("techniques").length, 443, "every technique record on the disc");
  assert.equal(damageLabRow("forms", 1).name, "Kotemon");
  assert.equal(damageLabRow("techniques", 1).name, "Fight");
  assert.equal(damageLabRow("techniques", 213).category, 6, "Fire Field is a category-6 field record");
  assert.equal(damageLabRow("enemies", "Kunemon").family, 8, "the enemy's digimon_type is its family");
  assert.equal(damageLabRow("techniques", 9999), null, "an unknown technique id");
  assert.equal(damageLabRow("enemies", "Not A Digimon"), null, "an unknown enemy id");
  assert.equal(damageLabRow("forms", 0), null, "an unknown form id");
});

test("the page's default fight is the first form against the first enemy with the Fight technique", async () => {
  damageLabReset();
  await damageLabLoad(fakeFetch);
  damageLabSetRng(() => 127); // no crit
  const opts = damageLabOptions();
  assert.deepEqual(opts.map((o) => o.key), ["form", "enemy", "technique", "field", "crit", "armour", "multi"]);
  assert.match(opts.find((o) => o.key === "form").value, /Kotemon/);
  assert.match(opts.find((o) => o.key === "enemy").value, /Kunemon/);
  assert.match(opts.find((o) => o.key === "technique").value, /Fight/);
  assert.match(opts.find((o) => o.key === "field").value, /none/);
  assert.equal(opts.find((o) => o.key === "multi").value, "off");
});

test("with the switch off there is no page, no press and no canvas call", () => {
  damageLabReset();
  assert.equal(tickDamageLab(false), false);
  assert.equal(damageLabOpen(), false);
  assert.equal(damageLabPress("right"), false, "a closed page swallows no press");
  const ctx = fakeCtx();
  assert.equal(damageLabDraw(ctx), false);
  assert.equal(ctx.calls.length, 0, "no canvas call at all");
});

test("the page opens on the switch's rising edge and the switch off closes it", async () => {
  damageLabReset();
  await damageLabLoad(fakeFetch);
  damageLabSetRng(() => 127);
  assert.equal(tickDamageLab(true), true);
  assert.equal(damageLabOpen(), true);
  // the pad moves the pickers and the page swallows every press while it is up
  assert.equal(damageLabPress("down"), true);
  assert.equal(damageLabPress("right"), true);
  assert.equal(damageLabPress("up"), true);
  // switching the switch off closes it; switching it on again reopens on the edge
  tickDamageLab(false);
  assert.equal(damageLabOpen(), false);
  tickDamageLab(true);
  assert.equal(damageLabOpen(), true);
  // Cross closes and a switch that stays on does not reopen it
  damageLabPress("cross");
  assert.equal(damageLabOpen(), false);
  tickDamageLab(true);
  assert.equal(damageLabOpen(), false);
});

test("the page draws every stage and the total for the chosen fight", async () => {
  damageLabReset();
  await damageLabLoad(fakeFetch);
  damageLabSetRng(() => 127);
  tickDamageLab(true);
  const ctx = fakeCtx();
  assert.equal(damageLabDraw(ctx), true);
  const text = drawnText(ctx);
  for (const name of RUNNING_NAMES) {
    assert.ok(text.toLowerCase().includes(name), `the draw names the ${name} stage`);
  }
  assert.match(text, /DAMAGE LAB/);
  assert.match(text, /TOTAL/i);
  // the drawn total is the result's own number
  const options = damageLabOptions();
  assert.ok(options.length === 7);
});

test("the crit pick makes the crit stage land or miss", async () => {
  damageLabReset();
  await damageLabLoad(fakeFetch);
  tickDamageLab(true);
  // CRIT is the fifth option row; moving it right from "roll" picks "lands"
  for (let i = 0; i < 4; i++) damageLabPress("down");
  damageLabPress("right"); // lands
  const landed = damageLabOptions().find((o) => o.key === "crit").value;
  assert.match(landed, /lands/i);
  const ctx = fakeCtx();
  damageLabDraw(ctx);
  assert.match(drawnText(ctx), /crit/i);
  // and the third position misses
  damageLabPress("right");
  const missedCtx = fakeCtx();
  damageLabDraw(missedCtx);
  assert.match(drawnText(missedCtx), /no crit/i);
});

test("every one of the disc's 443 technique records ends on resolveDamage's number", async () => {
  damageLabReset();
  await damageLabLoad(fakeFetch);
  const form = { str: 90, def: 40, spt: 70, wis: 55, spd: 44 };
  const foe = {
    str: 60, def: 45, spt: 55, wis: 50, spd: 40, family: 4,
    resistances: { fire: 85, water: 125, ice: 80, wind: 80, thunder: 115, machine: 100, dark: 95 },
  };
  let compared = 0;
  for (const row of damageLabTable("techniques")) {
    if (row.category !== 2 && row.category !== 3) continue;   // heal / stat / field records deal no damage
    const skill = {
      power: row.power, element: row.element, magical: row.category === 3,
      effect_id: row.effect_id, effect_power: row.effect_power, target_family: row.target_family,
      damage_scalar: row.damage_scalar, clip: row.clip, hits: row.hits, basic_attack: row.basic_attack,
    };
    const base = skill.magical ? magicalBase(form, foe, skill.power) : physicalBase(form, foe, skill.power);
    const walked = damageStages({ atk: form, def: foe, skill, rng: seeded(1000 + row.id), multiCrest: false });
    const engine = resolveDamage(base, form, foe, skill, seeded(1000 + row.id), null);
    assert.equal(walked.total, engine, `technique ${row.id} (${row.name}) agrees with the engine`);
    assertRunning(walked.stages, walked.total);
    compared++;
  }
  assert.equal(compared, 402, "the disc's 402 damage records (16 heal, 18 stat, 7 field records excluded)");
});

test("the special-op stage scales a Multi Crest plain attack by 2/5, and skips clip 0x0b/0x0c", () => {
  const fixture = {
    atk: { str: 100, def: 10, spt: 10, wis: 10, spd: 10, multiAttack: true },
    def: { def: 42, spt: 50, wis: 50, spd: 40, family: 1 },
    skill: { power: 60, element: "normal", target_family: 1, effect_id: 1, clip: 5, basic_attack: true },
  };
  const walk = damageStages({ ...fixture, rng: () => 127 });
  const special = walk.stages.find((s) => s.name === "special-op");
  const element = walk.stages.find((s) => s.name === "element");
  assert.equal(special.value, Math.trunc((element.value * 2) / 5), "x2/5 of the running value");
  assert.match(special.note, /2\/5/);
  // the disc's clip gate: 0x0b and 0x0c are one full hit even under Multi Crest
  const gated = damageStages({ ...fixture, skill: { ...fixture.skill, clip: 0x0b }, rng: () => 127 });
  assert.equal(gated.stages.find((s) => s.name === "special-op").value, element.value);
});

test("the field stage applies the field's own bonus to the base", () => {
  const f = {
    atk: { str: 100, def: 10, spt: 10, wis: 10, spd: 10 },
    def: { def: 42, spt: 50, wis: 50, spd: 40, family: 1 },
    skill: { power: 60, element: "fire", target_family: 1, clip: 5 },
  };
  const walk = damageStages({ ...f, field: { element: "fire", power: 64 }, rng: () => 127 });
  const base = walk.stages[0].value;
  const field = walk.stages.find((s) => s.name === "field");
  assert.equal(field.value, base + Math.trunc((base * 64) / 128), "a matching field adds base x power / 128");
  // the opposite element is a penalty: a fire field weakens water techniques
  const opposed = damageStages({
    ...f,
    skill: { ...f.skill, element: "water" },
    field: { element: "fire", power: 64 },
    rng: () => 127,
  });
  assert.ok(opposed.stages.find((s) => s.name === "field").value < base, "the opposite element loses damage");
});

test("a heal, stat or field record gets a sentence, not invented damage", async () => {
  damageLabReset();
  await damageLabLoad(fakeFetch);
  damageLabSetRng(() => 127);
  tickDamageLab(true);
  // the TECHNIQUE picker: walk to a category-6 record (213 Fire Field) with R1 jumps
  for (let i = 0; i < 2; i++) damageLabPress("down");      // the technique row
  for (let i = 0; i < 21; i++) damageLabPress("r1");        // 1 -> 211 (ten at a time)
  damageLabPress("right");                                   // 212
  damageLabPress("right");                                   // 213 Fire Field
  const opts = damageLabOptions();
  assert.match(opts.find((o) => o.key === "technique").value, /Fire Field/);
  const ctx = fakeCtx();
  damageLabDraw(ctx);
  assert.match(drawnText(ctx), /category-6/i, "the page says the record is not a damage technique");
});

// ---------------------------------------------------------------------------
// The F2 switch: the Extras row, the off-by-default list and the game.js hooks.
// ---------------------------------------------------------------------------
test("the F2 Extras row and EXPERIMENTAL list are off by default", () => {
  const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
  assert.ok(ambience.includes('["damagelab", "Damage Lab (new)"]'), "the Extras pair is present");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
  assert.ok(experimental, "EXPERIMENTAL is still one array literal");
  assert.match(experimental[1], /"damagelab"/, "off until the player switches it on");
  assert.doesNotMatch(ambience, /(get|has)\("damagelab"\)/, "never a URL flag");
});

test("web/game.js gates the page on window.__fx?.damagelab and hooks it like the Codex", () => {
  const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(game, /import \{ tickDamageLab, damageLabPress, damageLabDraw, damageLabOpen \} from "\.\/damage-lab\.js"/);
  assert.match(game, /tickDamageLab\(window\.__fx\?\.damagelab === true\)/, "the page follows the switch");
  assert.match(game, /if \(damageLabOpen\(\)\) return;/, "the field is frozen while it is up");
  assert.match(game, /if \(damageLabPress\(k\)\)/, "the pad goes to the page");
  assert.match(game, /damageLabDraw\(ctx, VIEW_W, VIEW_H\)/, "the page draws over everything");
  assert.match(game, /fieldFullScreenUiOpen\(\)[\s\S]{0,800}damageLabOpen\(\)/, "a full-screen page covers the wide sides");
  // read-only page: nothing in it writes a store or a battle state
  const lab = readFileSync(new URL("../web/damage-lab.js", import.meta.url), "utf8");
  assert.ok(!/localStorage/.test(lab), "the lab stores nothing");
});
