// OWN CLIPS FIRST — the operator's rule: a technique slot a model has no script for takes the model's
// OWN clip of the matching kind (a shooter for a ranged move, the close attack - travel and all - for
// a contact move), before DW2 motion and before any donor build.
//
// What is asserted here, by NUMBERS and with the real game modules:
//   * the flag is OFF by default, and with it off `resolveClipScript` is byte-identical to the build
//     that existed before the rule (the composition of resolveClipScriptBase + withDw2Body) for every
//     pack, every technique slot and a sample of techniques, with DW2 motion off AND on;
//   * with it on, an own authored slot is returned untouched (identity);
//   * Garbagemon's spell plays its OWN shooting basic: the body tables are its own clip 5's, the
//     projectile leaves at the tick its own basic leaves at, from its own emitter point, and the
//     damage strike lands on its own strike tick;
//   * Vegiemon's physical technique plays its OWN jump-and-strike basic: the leap op2 mode 3 survives,
//     its return home survives, and a 3-hit technique fires exactly 3 damage contacts, each on one of
//     the body's own op10 beats;
//   * a body that throws a part of itself keeps its own clip and never takes DW2 motion.
// Nothing here uses a picture: the ticks come from replaying the built script through the real
// ActionVM, the emitter point from the op6 record the model itself authored.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const MODELS = path.join(REPO, "web/assets/battle/models");
const DIGIMON = path.join(REPO, "web/assets/data/digimon.json");
const PACKS = fs.existsSync(path.join(MODELS, "m227garb/anim.json")) && fs.existsSync(DIGIMON);
const NO_PACKS = PACKS ? false : "the model packs / skills table are not installed";

const OC = await import("../web/fight/own-clips.js");
const CF = await import("../web/fight/clip-fallback.js");
const DW2 = await import("../web/fight/dw2-motion.js");
const FT = await import("../web/fight/fight-tables.js");
const { ActionVM } = await import("../web/fight/action-vm.js");
const { TimelinePlayer } = await import("../web/fight/timeline-player.js");

// ── a numeric replay of a script through the real VM: every op10 / op6 event and its tick ────────
function replay(model, script, maxTicks = 4000) {
  const events = [];
  let tick = 0;
  const timelineForTable = (i) => {
    const t = model?.timeline?.[i]?.table;
    if (!Array.isArray(t) || !t.length) return null;
    return new TimelinePlayer(t, 0);
  };
  const hooks = {
    onHit: (rec) => events.push({ tick, kind: "hit", type: rec.type | 0 }),
    setLunge: (l) => { if (l && l.sub === 0) events.push({ tick, kind: "launch", id: l.id ?? l.words?.[1], words: l.words ?? null }); },
    onEffect: (rec) => events.push({ tick, kind: "fx", type: rec.type | 0 }),
    onMotion: () => {}, onCamera: () => {}, onMove: () => {}, onRotate: () => {},
  };
  const vm = new ActionVM(script, { timelineForTable, hooks, baseTable: () => 0 });
  const seq = (script?.ops ?? []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words[2] | 0) > 1).map((o) => o.words[2] | 0);
  if (seq.length) { const p = timelineForTable(seq[0]); if (p) vm.player = p; }
  while (!vm.ended && tick < maxTicks) { vm.step(1); tick++; }
  return { ticks: tick, events, ended: vm.ended };
}
const contactsOf = (rep) => rep.events.filter((e) => e.kind === "hit" && (e.type === 98 || e.type === 99));
const launchOf = (rep) => rep.events.filter((e) => e.kind === "launch");
const beatsOf = (rep) => rep.events.filter((e) => e.kind === "hit").map((e) => e.tick);
const bindsOf = (script) => (script?.ops ?? []).filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0 && (o.words[2] | 0) > 1).map((o) => o.words[2] | 0);

const SKILLS = [
  { id: 1, name: "Magic Missile", attack_category: "magical", type: "attack", hits: 1, clip: 9 },
  { id: 123, name: "Hammer Rush", attack_category: "physical", type: "attack", hits: 3, clip: 8 },
  { id: 60, name: "Berserk Sword", attack_category: "physical", type: "attack", hits: 4, clip: 11 },
  { id: 61, name: "Dark Rain", attack_category: "magical", type: "attack", hits: 4, clip: 11 },
  { id: 99, name: "Fight", attack_category: "physical", type: "attack", hits: 1, clip: 5 },
  { id: 200, name: "Double Guard", attack_category: "physical", type: "heal", hits: 1, clip: 10 },
];

// ── a synthetic body: one mesh bone (so the height is real), a shooting basic attack in slot 5 ───
// Its own basic: a sound marker on the first tick, two more beats on the way, the shot at tick 40 and
// the damage strike at tick 65 - the shape the disc's ranged basics have.
function shooter({ own = {}, shoot = true } = {}) {
  const shot = shoot ? [{ op: 6, words: [0, 207, -640, 1920, -4224, 0, 0, 0] }] : [];
  const basic = {
    ops: [
      { op: 3, words: [1, 9999] }, { op: 3, words: [1, 2] },
      { op: 2, words: [0, 0, 14] },
      { op: 10, words: [33, 0] },            // tick 0: a sound marker
      { op: 11, words: [20] },
      { op: 10, words: [23, 0] },            // tick 20: a beat
      { op: 11, words: [20] },
      ...shot,                                // tick 40: the shot
      { op: 11, words: [10] },
      { op: 10, words: [15, 0] },            // tick 50: a beat
      { op: 11, words: [15] },
      { op: 10, words: [99, 0] },            // tick 65: the damage strike
      { op: 3, words: [0, 2, 0, -896, 5120] },
      { op: 1, words: [0] },
      { op: 11, words: [20] },
      { op: 2, words: [0, 0, 1] },
      { op: 255, words: [] },
    ],
  };
  const actions = { 0: { ops: [{ op: 2, words: [0, 0, 1] }, { op: 255, words: [] }] }, 5: basic, ...own };
  const timeline = [
    { table: [{ value: 0 }, { value: 30 }] },
    { table: [{ value: 0 }] },
    { table: [{ value: 0 }] },
    { table: [{ value: 0 }] },
  ];
  for (let i = 4; i <= 13; i++) timeline[i] = { table: [{ value: 0 }] };
  timeline[14] = { table: Array.from({ length: 40 }, (_, i) => ({ value: 100 + i })) };
  return {
    folder: "mTEST",
    num_bones: 2,
    total_frames: 200,
    bones: [
      { parent_slot: 0, verts: [[0, -500, 0], [0, 500, 0]], faces: [[0, 1, 1]], anim: { ch1: [[0, 0, 0, 0], [0, 0, 0, 30000]], ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]], ch3: [[4096, 4096, 4096, 0], [4096, 4096, 4096, 30000]] } },
      { parent_slot: 1, verts: [], faces: [], anim: { ch1: [[0, 0, 0, 0], [0, 0, 0, 30000]], ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]] } },
    ],
    timeline,
    actions,
  };
}

const oldResolve = (model, clip, opts = {}) => {         // clip-fallback BEFORE the own-clips hook
  const base = CF.resolveClipScriptBase(model, clip, opts);
  if (!base || !DW2.dw2MotionEnabled()) return base;
  return CF.withDw2Body(model, base, clip, opts);
};

function withFlag(on, fn) {
  const before = OC.ownClipsEnabled();
  OC.setOwnClipsEnabled(on);
  try { return fn(); } finally { OC.setOwnClipsEnabled(before); }
}
const donorStub = () => [null, null, null, null, null, null, null, null, null, {
  ops: [
    { op: 3, words: [1, 9999] }, { op: 2, words: [0, 0, 2] }, { op: 11, words: [20] },
    { op: 6, words: [0, 220, 0, 0, 0, 0, 2048, 0] }, { op: 10, words: [99, 0] }, { op: 1, words: [0] },
    { op: 2, words: [0, 0, 1] }, { op: 255, words: [] },
  ],
}];

test("the rule is OFF by default, and its flag is read like ?dw2motion=1", () => {
  assert.equal(OC.ownClipsEnabled(), false, "off unless a scope turns it on");
  assert.equal(OC.ownClipsFlagFromUrl("?ownclips=1"), true);
  assert.equal(OC.ownClipsFlagFromUrl("?ownclips=on"), true);
  assert.equal(OC.ownClipsFlagFromUrl("?dw2motion=1"), false);
  assert.equal(OC.ownClipsFlagFromUrl(""), false);
  FT.setSkillTable(SKILLS);
});

test("off, a missing slot resolves exactly as before (synthetic body)", () => {
  const m = shooter();
  FT.setSkillTable(SKILLS);
  CF.setFallbackDonor(donorStub());
  try {
    for (const clip of [6, 8, 9, 11]) {
      const opts = { tech: clip === 8 ? "Hammer Rush" : clip === 9 ? "Magic Missile" : "Berserk Sword", hits: clip === 8 ? 3 : 1, element: 6 };
      const got = withFlag(false, () => CF.resolveClipScript(m, clip, opts));
      assert.deepEqual(got, oldResolve(m, clip, opts), `clip ${clip} is untouched with the rule off`);
    }
  } finally { CF.setFallbackDonor(null); }
});

test("on, a spell takes the body's own shooting clip: same body tables, same launch tick, same emitter", () => {
  const m = shooter();
  FT.setSkillTable(SKILLS);
  const own = m.actions[5];
  const ownRep = replay(m, own);
  const script = withFlag(true, () => CF.resolveClipScript(m, 9, { tech: "Magic Missile", hits: 1, element: 6 }));
  assert.equal(script.buildKind, "ownclip");
  assert.equal(script.ownClip.slot, 5);
  assert.deepEqual(bindsOf(script), bindsOf(own), "the body is the model's own basic attack");
  const rep = replay(m, script);
  const ownShot = launchOf(ownRep);
  const shot = launchOf(rep);
  assert.equal(ownShot[0].tick, 40);
  assert.equal(shot.length, ownShot.length, "one launch, as the body authored");
  assert.equal(shot[0].tick, 40, "the shot leaves at the body's own tick");
  const shotRec = script.ops.find((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
  assert.deepEqual(shotRec.words.slice(2, 5), [-640, 1920, -4224], "the body's own emitter point, word for word");
  assert.equal(shot[0].id, 210, "the technique's projectile (element 6), not the body's own 207");
  const cs = contactsOf(rep);
  assert.equal(cs.length, 1, "a 1-hit spell fires one contact");
  assert.equal(cs[0].type, 99);
  assert.equal(cs[0].tick, contactsOf(ownRep).at(-1).tick, "on the body's own damage-strike tick (65)");
  assert.ok(script.ops.some((o) => o.op === 3 && (o.words?.[0] | 0) === 0 && (o.words[1] | 0) === 9999 && (o.words[4] | 0) === 5120),
    "the technique's own effect lands on the victim line");
  assert.ok(!script.ops.some((o) => o.op === 5), "no camera cut: a built script frames both fighters");
});

test("on, a 3-hit technique fires exactly 3 contacts, each on one of the body's own strike beats", () => {
  const m = shooter();
  FT.setSkillTable(SKILLS);
  const ownRep = replay(m, m.actions[5]);
  const beats = beatsOf(ownRep);
  assert.deepEqual(beats, [0, 20, 50, 65], "the body's own beats");
  const script = withFlag(true, () => CF.resolveClipScript(m, 8, { tech: "Hammer Rush", hits: 3 }));
  assert.equal(script.ownClip.contacts, 3);
  const cs = contactsOf(replay(m, script));
  assert.equal(cs.length, 3, "hits-1 intermediate contacts + the damage strike");
  assert.equal(cs.filter((c) => c.type === 98).length, 2);
  assert.equal(cs.filter((c) => c.type === 99).length, 1);
  for (const c of cs) assert.ok(beats.includes(c.tick), `contact at ${c.tick} is a body beat (${beats.join(",")})`);
  assert.equal(cs.at(-1).tick, 65, "the damage strike keeps the body's own strike tick");
});

test("on, a body with fewer beats than the technique needs keeps its strike tick and splits its own wait", () => {
  const m = shooter();
  FT.setSkillTable(SKILLS);
  const script = withFlag(true, () => CF.resolveClipScript(m, 11, { tech: "Dark Rain", hits: 4 }));
  assert.equal(script.ownClip?.contacts, 4, "clip 11 authors up to 4 contacts");
  const cs = contactsOf(replay(m, script));
  assert.equal(cs.length, 4);
  assert.equal(cs.at(-1).tick, 65, "the strike is still on the body's own tick");
  const beats = beatsOf(replay(m, m.actions[5]));
  const onBeat = cs.filter((c) => beats.includes(c.tick)).length;
  assert.equal(onBeat, 3, "the beats it HAS are used; the fourth is put into the last wait before the strike");
  assert.deepEqual(cs.map((c) => c.type), [98, 98, 98, 99]);
});

test("an own authored slot is never touched, and a heal is never rebuilt", () => {
  const own9 = { ops: [{ op: 2, words: [0, 0, 3] }, { op: 255, words: [] }] };
  const m = shooter({ own: { 9: own9 } });
  FT.setSkillTable(SKILLS);
  withFlag(true, () => {
    assert.equal(CF.resolveClipScript(m, 9, { tech: "Magic Missile", hits: 1 }), own9, "the model's own clip is returned as-is");
    const heal = CF.resolveClipScript(m, 10, { tech: "Double Guard", hits: 1, target: "self" });
    assert.notEqual(heal?.buildKind, "ownclip", "a heal/support move keeps its calm self cast");
    const item = CF.resolveClipScript(m, 10, { hits: 1, target: "enemy" });     // no tech: an item use
    assert.notEqual(item?.buildKind, "ownclip", "an item is not a technique");
  });
});

test("an own clip of the WRONG kind is not used: a melee body does not answer a spell", () => {
  const melee = shooter({ shoot: false });      // slot 5 swings, it does not shoot
  FT.setSkillTable(SKILLS);
  CF.setFallbackDonor(donorStub());
  try {
    const script = withFlag(true, () => CF.resolveClipScript(melee, 9, { tech: "Magic Missile", hits: 1 }));
    assert.notEqual(script?.buildKind, "ownclip", "no own shooting clip -> today's build");
    assert.deepEqual(script, oldResolve(melee, 9, { tech: "Magic Missile", hits: 1 }));
  } finally { CF.setFallbackDonor(null); }
});

// ── a body that throws a part of itself ─────────────────────────────────────────────────────────
function thrower() {
  const m = shooter();
  // bone 1 is a part hidden at idle that comes IN during the basic attack, on a pivot (bone 0) whose
  // ch1 travels 2 body heights - the Boltmon pattern; bone 0 carries the mesh (height 1000)
  m.bones[1].verts = [[0, -100, 0], [0, 100, 0]];
  m.bones[1].faces = [[0, 1, 1]];
  m.bones[1].anim.ch3 = [[0, 0, 0, 0], [0, 0, 0, 106], [4096, 4096, 4096, 107], [4096, 4096, 4096, 119], [0, 0, 0, 120], [0, 0, 0, 30000]];
  m.bones[0].anim.ch1 = [[0, 0, 0, 0], [0, 0, 0, 106], [0, 0, -2000, 107], [0, 0, -2000, 119], [0, 0, 0, 120], [0, 0, 0, 30000]];
  return m;
}

test("a throwing body is measured as one, and it plays its own clip instead of DW2 motion", () => {
  const m = thrower();
  FT.setSkillTable(SKILLS);
  CF.setFallbackDonor(donorStub());
  const inv = OC.ownClipInventory(m);
  assert.equal(inv.throws, true, "a hidden-at-idle part comes in on a travelling pivot");
  assert.match(inv.throwsWhy[0], /hidden-at-idle part/);
  DW2.setDw2MotionEnabled(true);
  DW2.applyDw2Motion(m, {
    motions: { F: { letter: "F", kind: "cast", table: 40, lo: 6000, hi: 6003, used: true, keys: { 0: [[0, 0, 0, 6000], [0, 0, 0, 6003]] }, ch1: [[0, 0, 0, 6000], [0, 0, 0, 6003]], playlist: [{ value: 6000 }, { value: 6003 }] } },
  });
  try {
    assert.equal(DW2.dw2MotionFor(m, 9)?.letter, "F", "the DW2 body is available for slot 9");
    const off = withFlag(false, () => CF.resolveClipScript(m, 9, { tech: "Magic Missile", hits: 1 }));
    assert.equal(off?.dw2Motion?.letter, "F", "with the rule off, today's build takes the DW2 body");
    const on = withFlag(true, () => CF.resolveClipScript(m, 9, { tech: "Magic Missile", hits: 1 }));
    assert.equal(on.buildKind, "ownclip");
    assert.equal(on.dw2Motion, undefined, "never DW2 motion for a body that throws its own part");
    assert.deepEqual(bindsOf(on), bindsOf(m.actions[5]), "its own attack clip is the body");
  } finally { DW2.setDw2MotionEnabled(false); }
});

// ── the real packs ──────────────────────────────────────────────────────────────────────────────
const diskDonors = async (folder) => {
  try { return JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8")); } catch { return null; }
};

test("off, every pack x technique slot resolves byte-identically to the build before the rule", { skip: NO_PACKS }, async () => {
  FT.setSkillTable(JSON.parse(fs.readFileSync(DIGIMON, "utf8")));
  CF.setDonorLoader(diskDonors);
  const folders = fs.readdirSync(MODELS).filter((f) => fs.existsSync(path.join(MODELS, f, "anim.json")));
  const sample = [
    { clip: 5, tech: "Fight", hits: 1 }, { clip: 6, tech: "Fight", hits: 2 }, { clip: 8, tech: "Hammer Rush", hits: 3 },
    { clip: 9, tech: "Magic Missile", hits: 1 }, { clip: 10, tech: "Double Guard", hits: 1, target: "self" },
    { clip: 11, tech: "Berserk Sword", hits: 2 }, { clip: 13, tech: "Giga Fire", hits: 3 }, { clip: 16, tech: "Magic Missile", hits: 1 },
  ];
  let n = 0;
  for (const folder of folders) {
    const m = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
    await CF.prepareModelDonors(m);
    for (const s of sample) {
      const opts = { tech: s.tech, hits: s.hits, target: s.target ?? "enemy", element: 3 };
      const got = withFlag(false, () => CF.resolveClipScript(m, s.clip, opts));
      assert.deepEqual(got, oldResolve(m, s.clip, opts), `${folder} clip ${s.clip}`);
      n++;
    }
  }
  assert.ok(n > 1000, `covered ${n} model x slot resolutions`);
});

test("off + DW2 on, the composition is still byte-identical for a pack with a generated motion", { skip: NO_PACKS }, async () => {
  FT.setSkillTable(JSON.parse(fs.readFileSync(DIGIMON, "utf8")));
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, "m025vegi/anim.json"), "utf8"));
  DW2.applyDw2Motion(m, {
    motions: { F: { letter: "F", kind: "cast", table: 40, lo: 6000, hi: 6003, used: true, keys: { 0: [[0, 0, 0, 6000], [0, 0, 0, 6003]] }, ch1: [[0, 0, 0, 6000], [0, 0, 0, 6003]], playlist: [{ value: 6000 }, { value: 6003 }] } },
  });
  DW2.setDw2MotionEnabled(true);
  try {
    for (const clip of [8, 9, 11]) {
      const opts = { tech: "Hammer Rush", hits: 3 };
      assert.deepEqual(withFlag(false, () => CF.resolveClipScript(m, clip, opts)), oldResolve(m, clip, opts), `clip ${clip} with DW2 on`);
    }
  } finally { DW2.setDw2MotionEnabled(false); }
});

test("on, every slot a pack OWNS is returned untouched", { skip: NO_PACKS }, async () => {
  FT.setSkillTable(JSON.parse(fs.readFileSync(DIGIMON, "utf8")));
  const folders = fs.readdirSync(MODELS).filter((f) => fs.existsSync(path.join(MODELS, f, "anim.json")));
  let owned = 0;
  for (const folder of folders) {
    const m = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
    for (const k of Object.keys(m.actions || {})) {
      const own = m.actions[k];
      if (!own?.ops?.length) continue;
      const got = withFlag(true, () => CF.resolveClipScript(m, Number(k), { tech: "Fight", hits: 1, target: "enemy" }));
      assert.equal(got, own, `${folder} slot ${k} was rebuilt although the pack owns it`);
      owned++;
    }
  }
  assert.ok(owned > 1000, `checked ${owned} owned slots`);
});

test("on, Garbagemon's spell plays its own shooting basic (real pack numbers)", { skip: NO_PACKS }, async () => {
  FT.setSkillTable(JSON.parse(fs.readFileSync(DIGIMON, "utf8")));
  CF.setDonorLoader(diskDonors);
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, "m227garb/anim.json"), "utf8"));
  await CF.prepareModelDonors(m);
  const own = m.actions[5];
  const ownRep = replay(m, own);
  const ownShot = launchOf(ownRep);
  assert.equal(ownShot[0].tick, 55, "its own basic launches at tick 55 (measured)");
  assert.equal(contactsOf(ownRep).at(-1).tick, 125, "its own damage strike is at tick 125 (measured)");
  const off = withFlag(false, () => CF.resolveClipScript(m, 9, { tech: "Dark Elemental", hits: 1, element: 6 }));
  const on = withFlag(true, () => CF.resolveClipScript(m, 9, { tech: "Dark Elemental", hits: 1, element: 6 }));
  assert.notEqual(on, off);
  assert.equal(on.buildKind, "ownclip");
  assert.deepEqual(bindsOf(on), bindsOf(own), "the body is its own clip 5 (table 14)");
  const rep = replay(m, on);
  const shot = launchOf(rep);
  assert.equal(shot[0].tick, 55, "the spell leaves at its own basic's launch tick");
  const shotRec = on.ops.find((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
  assert.deepEqual(shotRec.words.slice(2, 5), [-640, 1920, -4224], "its own emitter point, word for word");
  assert.equal(shot[0].id, 210, "the technique's dark projectile");
  const cs = contactsOf(rep);
  assert.equal(cs.length, 1, "Dark Elemental is one hit");
  assert.equal(cs[0].tick, 125, "on its own strike tick");
});

test("on, Vegiemon's physical technique plays its own jump-and-strike basic (Hammer Rush, 3 hits)", { skip: NO_PACKS }, async () => {
  FT.setSkillTable(JSON.parse(fs.readFileSync(DIGIMON, "utf8")));
  CF.setDonorLoader(diskDonors);
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, "m025vegi/anim.json"), "utf8"));
  await CF.prepareModelDonors(m);
  const own = m.actions[5];
  const ownRep = replay(m, own);
  const beats = beatsOf(ownRep);
  assert.deepEqual(beats, [0, 15, 45, 75, 120, 141, 156, 186, 216], "its own basic's beats (measured)");
  const row = (JSON.parse(fs.readFileSync(DIGIMON, "utf8")).skills || []).find((r) => (r.id | 0) === 123);
  assert.equal(row.name, "Hammer Rush");
  assert.equal(row.attack_category, "physical");
  assert.equal(row.hits, 3);
  assert.equal(row.clip, 8);
  const on = withFlag(true, () => CF.resolveClipScript(m, 8, { tech: row.name, hits: row.hits, element: 1 }));
  assert.equal(on.buildKind, "ownclip");
  assert.equal(on.ownClip.slot, 5);
  assert.deepEqual(bindsOf(on), bindsOf(own), "its own basic attack is the body");
  const leap = on.ops.filter((o) => o.op === 2 && (o.words?.[0] | 0) === 3);
  assert.equal(leap.length, 1, "the jump to the target survives");
  assert.deepEqual(leap[0].words, [3, 0, 0, 0, 2560, 105]);
  assert.ok(on.ops.some((o) => o.op === 2 && (o.words?.[0] | 0) === 7), "and its return home");
  const cs = contactsOf(replay(m, on));
  assert.equal(cs.length, 3, "exactly 3 damage contacts for a 3-hit technique");
  assert.deepEqual(cs.map((c) => c.type), [98, 98, 99]);
  for (const c of cs) assert.ok(beats.includes(c.tick), `contact at ${c.tick} is one of the body's beats`);
  assert.deepEqual(cs.map((c) => c.tick), [15, 75, 120], "the two beats it strikes on, then its own damage tick");
});

test("on, a body with no shooting clip is left to today's build (Vegiemon's spell)", { skip: NO_PACKS }, async () => {
  FT.setSkillTable(JSON.parse(fs.readFileSync(DIGIMON, "utf8")));
  CF.setDonorLoader(diskDonors);
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, "m025vegi/anim.json"), "utf8"));
  await CF.prepareModelDonors(m);
  assert.equal(OC.pickOwnClip(m, "shoot"), null, "its basic leaps and strikes; it owns no shooting clip");
  const on = withFlag(true, () => CF.resolveClipScript(m, 9, { tech: "Air Blast", hits: 1, element: 1 }));
  assert.notEqual(on?.buildKind, "ownclip", "nothing own of that kind -> today's behaviour");
  assert.deepEqual(on, oldResolve(m, 9, { tech: "Air Blast", hits: 1, element: 1 }));
});

test("on + DW2 on, an own clip of the matching kind wins over the DW2 body (the order the rule asks for)", { skip: NO_PACKS }, async () => {
  FT.setSkillTable(JSON.parse(fs.readFileSync(DIGIMON, "utf8")));
  CF.setDonorLoader(diskDonors);
  const m = JSON.parse(fs.readFileSync(path.join(MODELS, "m025vegi/anim.json"), "utf8"));
  await CF.prepareModelDonors(m);
  CF.setFallbackDonor(donorStub());       // the Greymon last resort: clip 8 has no donor-map row
  DW2.applyDw2Motion(m, {
    motions: { F: { letter: "F", kind: "attack", table: 40, lo: 6000, hi: 6003, used: true, keys: { 0: [[0, 0, 0, 6000], [0, 0, 0, 6003]] }, ch1: [[0, 0, 0, 6000], [0, 0, 0, 6003]], playlist: [{ value: 6000 }, { value: 6003 }] } },
  });
  DW2.setDw2MotionEnabled(true);
  try {
    assert.ok(DW2.dw2MotionFor(m, 8), "the DW2 body IS available for slot 8 (the rule has something to win over)");
    const on = withFlag(true, () => CF.resolveClipScript(m, 8, { tech: "Hammer Rush", hits: 3 }));
    assert.equal(on.buildKind, "ownclip", "rule on: the model's own close attack is the body");
    assert.deepEqual(bindsOf(on), bindsOf(m.actions[5]), "its own tables, not the DW2 table");
    assert.equal(on.dw2Motion, undefined);
  } finally { DW2.setDw2MotionEnabled(false); CF.setFallbackDonor(null); }
});
